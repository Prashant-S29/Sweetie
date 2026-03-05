# Multi-Channel Scheduling Coordinator

An AI scheduling assistant that coordinates meetings across Email and SMS channels with intelligent cross-thread, cross-channel memory retrieval. Built as a CLI tool powered by Claude Sonnet, pgvector semantic search, and session-scoped memory isolation.

---

## What It Does

You interact with the system via CLI commands that simulate real-world scheduling flows. The agent:

- **Reaches out** to participants across different channels (Email or SMS)
- **Remembers** what each person said in their own thread
- **Retrieves** context across threads and channels when scheduling — Bob's availability from an Email thread is automatically available when the agent is working in Sarah's SMS thread
- **Detects conflicts** when there is no overlapping availability and presents concrete options
- **Confirms** meetings with calendar invites and Google Meet links

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript |
| LLM (agent reasoning) | Claude Sonnet 4.5 via Vercel AI SDK |
| LLM (fact extraction) | Claude Haiku 4.5 |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Database | PostgreSQL + pgvector (Supabase) |
| ORM | Drizzle ORM |
| Package manager | pnpm |

---

## Project Structure

```
src/
├── index.ts                 CLI entry point and router
├── agent/
│   ├── agent.ts             LLM loop with session-scoped tools
│   └── prompts/
│       └── system.prompt.ts Base system prompt
├── channels/
│   ├── base.channel.ts      Channel interface
│   ├── email.channel.ts     Formal tone, subject lines, paragraphs
│   ├── sms.channel.ts       Casual tone, concise, no formatting
│   └── registry.ts          Channel registry (add channels here)
├── memory/
│   ├── embeddings.ts        OpenAI embedding wrapper
│   └── memory.service.ts    extractAndStore + retrieveRelevant (session-scoped)
├── db/
│   ├── client.ts            PostgreSQL connection
│   ├── schema.ts            threads / messages / memories tables
│   └── helpers.ts           DB helper functions
├── types/
│   └── index.ts             Shared TypeScript types
└── utils/
    └── results.ts           Scenario result parsing and saving

src/scripts/
└── run-scenario.ts          Automated scenario runner
```

---

## Setup

### 1. Prerequisites

- Node.js 22+
- pnpm
- A Supabase project (free tier works) with pgvector enabled
- Anthropic API key
- OpenAI API key

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Environment Variables

Create a `.env` file in the project root:

```env
# Supabase — pooled connection for queries (port 6543)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Supabase — direct connection for migrations (port 5432)
DIRECT_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres

ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

> Both URLs point to the same Supabase database. `DATABASE_URL` uses the connection pooler for runtime queries. `DIRECT_URL` connects directly for schema migrations.

### 4. Run Database Migration

```bash
pnpm db:push
```

This creates three tables: `threads`, `messages`, and `memories` (with HNSW vector index and session index).

---

## How It Works

### Channels

The system supports two channels with distinct formatting and tone:

**Email** — formal tone, subject lines, structured paragraphs, full sign-offs.

**SMS** — casual tone, concise messages (160 chars where possible), no markdown, no subject lines.

Adding a new channel requires one new file in `src/channels/` and one line in `src/channels/registry.ts`. The agent, memory service, and CLI are unaffected.

### Threads

Each conversation is a **thread** — a persistent sequence of messages between the scheduling system and one party. Threads are identified by a `thread_id` and survive process restarts.

```bash
# Start a new thread
npx tsx src/index.ts --channel email --to bob@company.com "message"

# Continue a thread (inbound reply from external party)
npx tsx src/index.ts --thread thread_xxx --from bob@company.com "message"

# Continue a thread (you following up)
npx tsx src/index.ts --thread thread_xxx "message"
```

### Multi-Thread Memory

When an external party sends a message, the system:

1. Stores the message in the thread
2. Runs the agent to produce a response
3. **Asynchronously** extracts scheduling facts using Claude Haiku and stores them as embeddings (fire-and-forget — never blocks the response)

When the agent needs to schedule a meeting, it calls the `retrieveMemory` tool which runs a pgvector cosine similarity search to find relevant facts from any thread in the current session.

```
Thread 1 (Email): Bob says "I'm free Monday 2-4pm and Wednesday all day"
                       ↓ stored as embeddings
Thread 2 (SMS):   Sarah says "Wednesday afternoon works"
                       ↓ stored as embeddings
Thread 3 (Email): "Schedule Bob and Sarah"
                       ↓ agent calls retrieveMemory("Bob Sarah availability")
                       ↓ retrieves facts from Thread 1 AND Thread 2
                       ↓ calls findOverlap() → Wednesday afternoon
                       ↓ proposes Wednesday 2pm
```

This is **relevance-based** retrieval, not recency. The system finds what matters, not just what was recent.

### Cross-Channel Retrieval

Memory has no channel filter. Facts extracted from an Email thread are fully retrievable when the agent is working in an SMS thread, and vice versa.

```
Bob's availability (stored from Email thread)
    → retrievable when scheduling in Sarah's SMS thread
    → retrievable when reporting to PM via Email
```

### Session Scoping

Every scheduling task gets a `sessionId`. All memory writes and reads are scoped to that session. This means:

- Multiple scheduling tasks coexist in the database without interfering
- The system scales to hundreds of concurrent sessions

```
sess_aaa: Q2 roadmap sync (Bob + Sarah facts)
sess_bbb: New hire onboarding (Carol + Dave facts)   ← completely isolated
sess_ccc: Technical interview (Alex + Jordan facts)  ← completely isolated
```

### Stateful Conversations

Every thread's messages are stored in PostgreSQL. Conversations are fully resumable — you can return hours or days later and the agent has full context of the previous exchange.

---

## Running Scenarios

Three pre-built scenarios demonstrate the full system. Each scenario auto-generates a `sessionId`, runs all steps in sequence, and saves a structured JSON result to `results/`.

```bash
# Scenario 1 — Cross-Thread Availability Aggregation
# PM requests a Q2 roadmap sync. System coordinates Bob (Email) and Sarah (SMS),
# finds Wednesday 2pm overlap, sends final confirmations with GMeet link to all.
npx tsx src/scripts/run-scenario.ts 1

# Scenario 2 — Multi-Channel Parallel Outreach
# HR needs to onboard new hire Bob. System reaches out to Carol (Email) and
# Dave (SMS) in parallel, finds Friday 2pm overlap, confirms with both.
npx tsx src/scripts/run-scenario.ts 2

# Scenario 3 — Conflict Detection
# Recruiter Lisa needs to schedule a technical interview. Alex can only do Friday,
# Jordan (CTO) is at a conference Friday. System detects the conflict and
# presents 3 concrete resolution options to Lisa.
npx tsx src/scripts/run-scenario.ts 3
```
Each run is fully isolated by `sessionId`.

Results are saved to:
```
results/sc_1_2026-03-05_12-21-53.json
results/sc_2_2026-03-05_12-28-29.json
results/sc_3_2026-03-05_12-33-37.json
```

Each result file contains the full structured conversation including sender/receiver, message content, channel, type (`send` or `replied`), and timing metadata.

---

## Manual Usage

### Send an outbound message

```bash
npx tsx src/index.ts \
  --channel email \
  --to bob@company.com \
  "Ask Bob for his availability next week for a Q2 sync"
```

### Simulate an inbound reply

```bash
npx tsx src/index.ts \
  --thread thread_abc123 \
  --from bob@company.com \
  "I'm free Monday 2-4pm and Wednesday all day"
```

### Follow up on a thread

```bash
npx tsx src/index.ts \
  --thread thread_abc123 \
  "Acknowledge Bob's availability and let him know we'll confirm soon"
```

### Use an explicit session

```bash
npx tsx src/index.ts \
  --channel email \
  --to bob@company.com \
  --session sess_my_custom_session \
  "message"
```

If `--session` is omitted, a new session ID is auto-generated.

---

## Functional Requirements

| Requirement | Status | Implementation |
|---|---|---|
| Multi-Channel Support | ✅ | EmailChannel + SmsChannel, extensible registry |
| Cross-Thread Context Retrieval | ✅ | pgvector cosine similarity, `retrieveMemory` tool |
| Cross-Channel Context Retrieval | ✅ | No channel filter on memory reads |
| Outbound Flow Support | ✅ | `--channel --to` creates new outbound threads |
| Stateful Conversations | ✅ | PostgreSQL persistence, resumable threads |
| Memory Isolation at Scale | ✅ | `sessionId` scoping, unlimited sessions coexist |

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled Supabase connection (port 6543) |
| `DIRECT_URL` | Yes | Direct Supabase connection for migrations (port 5432) |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings |
| `MAX_THREAD_MESSAGES` | No | Max messages loaded per thread (default: 20) |
| `RETRIEVAL_LIMIT` | No | Max facts returned per memory query (default: 8) |
