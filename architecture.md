# Architecture: Multi-Channel Scheduling Coordinator

## 1. North Star Principle

The system is a **CLI-driven agentic loop** with three concerns kept strictly separate:

- **Transport** — how a message arrives (Email, SMS, future channels)
- **Intelligence** — what the agent decides to do with it
- **Memory** — what the agent remembers across threads and channels

These three must never bleed into each other. That separation is what makes the system extensible.

---

## 2. Project Structure

```
src/
├── index.ts                  # CLI entrypoint (Commander.js)
├── channels/
│   ├── base.channel.ts       # Abstract Channel interface
│   ├── email.channel.ts      # Email formatting + tone rules
│   └── sms.channel.ts        # SMS formatting + tone rules
├── agent/
│   ├── agent.ts              # Core agentic loop (Vercel AI SDK)
│   ├── tools/
│   │   ├── memory.tools.ts   # storeMemory, retrieveMemory
│   │   ├── thread.tools.ts   # getThread, listThreads
│   │   └── schedule.tools.ts # findOverlap, proposeMeeting
│   └── prompts/
│       ├── system.prompt.ts  # Base system prompt
│       └── channel.prompt.ts # Per-channel tone injections
├── memory/
│   ├── memory.service.ts     # Extract → Embed → Store → Retrieve
│   └── embeddings.ts         # OpenAI text-embedding-3-small wrapper
├── db/
│   ├── schema.ts             # Drizzle schema (threads, messages, memories)
│   ├── client.ts             # Supabase/Postgres connection
│   └── migrations/           # Drizzle migration files
└── types/
    └── index.ts              # Shared types (Thread, Message, Memory, Channel)
```

---

## 3. Data Layer (Drizzle + Supabase + pgvector)

Three tables. Nothing more.

### threads
Stores conversation identity. One row per thread.

| column | type | notes |
|---|---|---|
| id | text PK | e.g. `thread_abc123` |
| channel | enum | `email` \| `sms` |
| participants | jsonb | `{ to, from }` |
| created_at | timestamp | |
| meta | jsonb | subject line, labels, etc |

### messages
Every message exchanged, in order.

| column | type | notes |
|---|---|---|
| id | text PK | |
| thread_id | FK → threads | |
| role | enum | `user` \| `agent` \| `external` |
| content | text | raw message body |
| created_at | timestamp | |

### memories
Extracted facts with vector embeddings. This is the core of cross-thread retrieval.

| column | type | notes |
|---|---|---|
| id | text PK | |
| thread_id | FK → threads | origin thread |
| channel | text | origin channel |
| content | text | human-readable fact: `"Bob is free Wednesday all day"` |
| embedding | vector(1536) | pgvector column, OpenAI embedding |
| entities | jsonb | `{ person: "Bob", type: "availability", ... }` |
| created_at | timestamp | |

The `entities` JSONB column enables structured filtering (e.g. "only retrieve memories about Bob") before or after vector search, keeping retrieval precise.

---

## 4. Channel Abstraction

Adding a new channel (Slack, WhatsApp, voice transcript) must require zero changes to the agent or memory layers. The contract is a simple interface:

```
interface Channel {
  name: string
  formatOutbound(content: string, context: ThreadContext): string
  parseInbound(raw: string): ParsedMessage
  getSystemPromptAddendum(): string   // tone/style rules injected into agent prompt
}
```

Email → formal, subject lines, paragraph structure.
SMS → under 160 chars when possible, casual, no subject.

The channel implementation only knows about formatting. It never touches the database or the agent.

---

## 5. Memory Pipeline (The Core Problem)

This is the system's differentiator. Two distinct flows:

### 5a. Write Path — Fact Extraction

After every inbound external message, the agent runs a lightweight extraction pass:

1. Claude reads the new message in isolation
2. Identifies extractable facts (availability, preferences, constraints, names)
3. Each fact is embedded via `text-embedding-3-small`
4. Stored in the `memories` table with `thread_id`, `channel`, and structured `entities`

This happens as a **tool call** (`storeMemory`) within the agent loop, not as a separate process. The agent decides what's worth storing.

### 5b. Read Path — Relevance Retrieval

When a new thread starts or a new message arrives, the agent has access to a `retrieveMemory` tool:

1. Agent embeds the current intent/query ("schedule Bob and Sarah")
2. pgvector performs cosine similarity search against all stored memory embeddings
3. Returns top-K facts ranked by relevance
4. Agent injects only those facts into its working context

The agent **decides when to call this tool** — it is not called on every turn. The system prompt instructs the agent: "Before scheduling or referencing a person's availability, always call retrieveMemory first."

This is what keeps the system scalable. With 1000 threads, the agent still only sees 5-10 relevant facts per turn.

---

## 6. The Agentic Loop

Built on Vercel AI SDK's `generateText` with `maxSteps` (multi-turn tool use). The loop is the same regardless of channel.

```
Inbound message arrives
        ↓
Build context: thread history (last N messages only) + system prompt + channel addendum
        ↓
generateText({
  model: anthropic("claude-sonnet-4-5"),
  system: systemPrompt + channelPrompt,
  messages: recentThreadMessages,
  tools: { retrieveMemory, storeMemory, findOverlap, getThread, proposeMeeting }
  maxSteps: 5
})
        ↓
Agent calls tools as needed (retrieve context, store new facts, find overlaps)
        ↓
Agent produces final response text
        ↓
Channel formats the output
        ↓
Print to CLI + persist to DB
```

The `maxSteps: 5` cap prevents runaway loops. The agent has full autonomy within that budget to call any combination of tools.

---

## 7. CLI Interface (Commander.js)

Three usage patterns map to two code paths:

**New outbound thread**
```
npx tsx src/index.ts --channel email --to bob@example.com "Ask Bob for availability"
```
→ Creates thread → Runs agent loop → Prints formatted outbound message

**Continue existing thread (inbound reply)**
```
npx tsx src/index.ts --thread thread_abc123 --from bob@example.com "Free Monday 2-4pm"
```
→ Loads thread → Appends message → Runs agent loop → Extracts + stores memory → Prints agent acknowledgment

**No explicit thread (agent decides)**
```
npx tsx src/index.ts --channel email --to manager@example.com "Schedule Bob and Sarah"
```
→ Agent has no existing thread context → Immediately calls `retrieveMemory` to find Bob + Sarah facts → Synthesizes and responds

---

## 8. Extensibility Matrix

| Concern | How to extend | Effort |
|---|---|---|
| New channel (Slack) | Add `slack.channel.ts` implementing `Channel` interface | ~1 hour |
| New memory backend (Pinecone) | Swap `memory.service.ts` internals, same interface | ~2 hours |
| New agent capability | Add a tool to `tools/` folder, register in agent | ~30 min |
| Different LLM provider | Change `anthropic(...)` to `openai(...)` in one line | ~5 min |
| New DB (Neon, local PG) | Change `DATABASE_URL` in env | ~0 min |

The Vercel AI SDK is the linchpin of the LLM extensibility — the tool calling interface is identical across providers.

---

## 9. Environment & Configuration

```
DATABASE_URL=          # Supabase connection string (pgvector enabled)
ANTHROPIC_API_KEY=     # Claude via Vercel AI SDK
OPENAI_API_KEY=        # Embeddings only (text-embedding-3-small)
```

---

## 10. Tradeoffs & Decisions

**pgvector over a dedicated vector DB (Pinecone, Weaviate)**
Supabase already gives us pgvector. Keeping vectors co-located with relational data means one connection, atomic transactions, and simpler infra for a 3-hour build. At true scale (millions of vectors) you'd migrate — but the `memory.service.ts` abstraction makes that a swap, not a rewrite.

**OpenAI embeddings alongside Claude**
Claude doesn't expose an embedding model. `text-embedding-3-small` is cheap, fast, and produces 1536-dim vectors that work well with pgvector. This is the standard pattern in the ecosystem.

**Agent decides when to retrieve vs. always retrieving**
Auto-retrieval on every turn would add latency and noise. The system prompt instructs the agent to call `retrieveMemory` when dealing with people's schedules or when asked to coordinate. This keeps the happy path fast and the complex path correct.

**Recent thread history (last N messages) not full history**
For the thread currently being processed, the last 10 messages are loaded directly into context. This covers conversational continuity without exploding the context window. Cross-thread knowledge always comes through `retrieveMemory`, never through raw message loading.

**Single process, no queue**
For a 3-hour build, synchronous CLI is correct. In production you'd wrap each inbound message in a job queue (BullMQ + Redis) so multiple threads can be processed concurrently. The architecture supports this — each CLI invocation is already stateless except for the DB.

---

## 11. Build Order

1. DB schema + Drizzle migrations + Supabase setup
2. `Channel` interface + Email + SMS implementations
3. Memory service (embed + store + retrieve with pgvector)
4. Core agent loop with tool definitions
5. CLI entrypoint wiring it all together
6. Test Scenario 1 (cross-thread retrieval)
7. Test Scenario 2 (parallel outreach)
8. Test Scenario 3 (conflict detection)
