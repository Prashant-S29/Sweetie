# Build Timeline: Multi-Channel Scheduling Coordinator

## Guiding Principle: Incremental, Never Breaking

Every milestone produces a **working, testable system**. Each one builds on the last without touching what already works. If a milestone breaks a previous one, the milestone is wrong — not the previous code.

The rule: **vertical slices, not horizontal layers.** We never build an entire layer in isolation. We build one thin slice end-to-end, then widen it.

---

## Milestone Overview

| # | Milestone | Outcome | Est. Time |
|---|---|---|---|
| M1 | Foundation | Repo runs, DB connects, env works | 30 min |
| M2 | Thread Persistence | Create + retrieve threads and messages | 45 min |
| M3 | CLI Shell | All three CLI patterns parse and route correctly | 30 min |
| M4 | First Channel (Email) | Agent responds via email, no memory yet | 45 min |
| M5 | Memory Write Path | Facts extracted and stored after every inbound | 45 min |
| M6 | Memory Read Path | Agent retrieves relevant facts via pgvector | 45 min |
| M7 | Second Channel (SMS) | SMS works, email still works, channels are isolated | 30 min |
| M8 | Scenario Validation | All 3 scenarios from the spec pass | 45 min |
| M9 | Hardening | Error handling, edge cases, graceful degradation | 30 min |
| M10 | Demo Prep | Clean output, scenario scripts, video ready | 30 min |

**Total: ~6 hours** (padded for real-world pace; 3-hour crunch is doable hitting M1–M8 only)

---

## M1 — Foundation
**Goal:** The project scaffolds, connects to Supabase, and environment is verified.

**Targets:**
- `npm init`, TypeScript config, `tsconfig.json` with path aliases
- Install all dependencies in one shot: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `drizzle-orm`, `drizzle-kit`, `postgres`, `commander`, `zod`, `dotenv`
- `.env` file with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- `src/db/client.ts` — Supabase Postgres connection verified with a ping
- Drizzle config file pointing at schema
- `npx tsx src/index.ts` runs without errors (even if it does nothing yet)

**Test:** `npx tsx src/index.ts` → prints "OK" and exits cleanly.

**Freeze contract:** DB client interface. Nothing downstream should ever import `postgres` directly — always through `src/db/client.ts`.

---

## M2 — Thread + Message Persistence
**Goal:** We can create threads, store messages, and retrieve them. No agent yet.

**Targets:**
- Write Drizzle schema: `threads`, `messages`, `memories` tables (all three upfront — schema changes are expensive later)
- Run migration against Supabase, verify tables exist
- `src/db/schema.ts` — all columns defined including `vector(1536)` on memories
- Write and test three DB helper functions:
  - `createThread(channel, to, from)` → returns thread with generated ID
  - `appendMessage(threadId, role, content)` → stores message
  - `getRecentMessages(threadId, limit)` → returns last N messages ordered by time
- No agent, no CLI yet — test these functions directly with a small scratch script

**Test:** Run scratch script → thread appears in Supabase dashboard, messages are queryable.

**Freeze contract:** Thread and Message types in `src/types/index.ts`. Agent and CLI will depend on these — they must not change shape after this point.

---

## M3 — CLI Shell
**Goal:** All three CLI usage patterns parse correctly and route to the right handler stub.

**Targets:**
- `src/index.ts` with Commander.js wired up
- Parse three patterns:
  - `--channel <ch> --to <addr> <message>` → new outbound thread
  - `--thread <id> --from <addr> <message>` → continue existing thread
  - `--thread <id> <message>` → user continues their own thread
- Each pattern calls a stub function that prints what it received
- Validation with Zod: channel must be `email` or `sms`, thread ID must exist if `--thread` is passed
- Helpful error messages for invalid input

**Test:** Run all three patterns from the spec's example commands. Each prints the correct parsed payload. Invalid inputs print clear errors and exit with code 1.

**Freeze contract:** CLI arg shape. The three patterns are fixed. Adding a new channel later does NOT change the CLI — it only adds a new value to the `--channel` enum.

---

## M4 — First Channel: Email (No Memory)
**Goal:** End-to-end working system for email. Agent responds. No cross-thread context yet.

**Targets:**
- `src/channels/base.channel.ts` — abstract `Channel` interface defined
- `src/channels/email.channel.ts` — implements interface, formats outbound as subject + body, injects formal tone addendum
- `src/agent/prompts/system.prompt.ts` — base system prompt establishing the agent's role
- `src/agent/prompts/channel.prompt.ts` — returns channel-specific tone rules given a channel name
- `src/agent/agent.ts` — core loop using Vercel AI SDK `generateText`, takes thread context + channel, returns response text
- Wire CLI stubs to real handlers: new thread creates DB record, runs agent, prints formatted output with Thread ID
- Continuing a thread loads recent messages, runs agent with that context, prints response

**Test (exact commands from spec):**
```
npx tsx src/index.ts --channel email --to bob@example.com "Ask Bob for his availability next week"
→ Prints Thread ID + formatted email with subject line

npx tsx src/index.ts --thread <id> --from bob@example.com "I'm free Monday 2-4pm and Wednesday all day"
→ Agent acknowledges, prints confirmation
```

**What is NOT done yet:** Agent does not extract or retrieve memories. That comes in M5 and M6. The agent at this stage only has the current thread's last N messages.

**Freeze contract:** `Channel` interface is locked. `agent.ts` function signature is locked — it takes `(thread, messages, channel)` and returns `string`. Memory will be injected as additional context later without changing this signature.

---

## M5 — Memory Write Path
**Goal:** After every inbound external message, facts are extracted, embedded, and stored.

**Targets:**
- `src/memory/embeddings.ts` — thin wrapper around OpenAI `text-embedding-3-small`, takes a string, returns `number[]`
- `src/memory/memory.service.ts` — `extractAndStore(message, threadId, channel)` function:
  - Calls Claude with a focused extraction prompt (not the full agent loop)
  - Parses structured facts: `{ content: string, entities: { person, type, value } }`
  - Embeds each fact
  - Stores in `memories` table with `thread_id`, `channel`, `embedding`, `entities`
- Add `storeMemory` as an agent tool in `src/agent/tools/memory.tools.ts`
- Agent calls this tool automatically after processing an inbound message
- Verify pgvector is storing correctly by querying raw embeddings in Supabase

**Test:**
```
npx tsx src/index.ts --thread <id> --from bob@example.com "I'm free Monday 2-4pm and Wednesday all day"
→ Agent acknowledges (same as M4)
→ Check Supabase: memories table has a new row with content "Bob is available Monday 2-4pm and Wednesday all day" and a non-null embedding vector
```

**Critically:** M4 behavior must be unchanged. Same commands, same output. Memory write is a side effect — it must never alter the agent's visible response.

**Freeze contract:** `extractAndStore` function signature. The agent tool wrapper will call this — the internals (embedding model, extraction prompt) can change without touching the agent.

---

## M6 — Memory Read Path (Cross-Thread Retrieval)
**Goal:** Agent retrieves relevant memories from other threads using pgvector similarity search. This is the system's core value.

**Targets:**
- `src/memory/memory.service.ts` — add `retrieveRelevant(query, limit)` function:
  - Embeds the query string
  - Runs pgvector cosine similarity search: `ORDER BY embedding <=> $1 LIMIT $2`
  - Optionally pre-filters by `entities->>'person'` if a name is detected in the query
  - Returns array of `{ content, threadId, channel, entities }`
- Add `retrieveMemory` as an agent tool in `memory.tools.ts`
- Update system prompt to instruct agent: "Before scheduling or referencing a person's availability, call retrieveMemory"
- Add `findOverlap` tool in `src/agent/tools/schedule.tools.ts` — takes two or more availability strings, returns overlapping windows

**Test (Scenario 1 from spec — first full cross-thread test):**
```
# Thread 1 — Email to Bob
npx tsx src/index.ts --channel email --to bob@example.com "Ask Bob for his availability"
npx tsx src/index.ts --thread <t1> --from bob@example.com "Free Monday 2-4pm and Wednesday all day"

# Thread 2 — SMS to Sarah
npx tsx src/index.ts --channel sms --to sarah@example.com "Ask Sarah when she can meet with Bob"
npx tsx src/index.ts --thread <t2> --from sarah@example.com "Tuesday or Wednesday afternoon"

# Thread 3 — This must retrieve from BOTH previous threads
npx tsx src/index.ts --channel email --to manager@example.com "Schedule Bob and Sarah's meeting"

→ Response must contain Bob's availability, Sarah's availability, and the overlap (Wednesday afternoon)
→ Response must NOT have been given this information explicitly
```

**This is the milestone that proves the architecture works.**

**Freeze contract:** `retrieveRelevant` function signature. The similarity threshold and `limit` are tunable via env vars — not hardcoded.

---

## M7 — Second Channel: SMS
**Goal:** SMS works end-to-end. Email continues to work unchanged.

**Targets:**
- `src/channels/sms.channel.ts` — implements `Channel` interface, formats output concisely, injects casual tone addendum
- Register SMS in channel router (a simple map in `index.ts`: `{ email: EmailChannel, sms: SmsChannel }`)
- Verify SMS responses are shorter and less formal than email
- Verify Email responses are unchanged

**Test:**
```
npx tsx src/index.ts --channel sms --to sarah@example.com "Ask Sarah when she can meet"
→ Output is short, no subject line, casual tone

npx tsx src/index.ts --channel email --to bob@example.com "Ask Bob for his availability"
→ Output is unchanged from M4 — formal, with subject line
```

**Adding a third channel later:** Create `slack.channel.ts`, add one line to the channel router map. Zero other files change. This should be demonstrably true by M7.

**Freeze contract:** Channel router map. New channels are added by appending to this map only.

---

## M8 — Scenario Validation
**Goal:** All three scenarios from the spec pass cleanly, end to end.

**Targets:**

**Scenario 1 — Cross-Thread Availability Aggregation** (already validated in M6, run again clean)
- Thread 1: Email to Bob → Bob replies with availability
- Thread 2: SMS to Sarah → Sarah replies with availability
- Thread 3: Email to manager → Agent synthesizes both without being told where to look

**Scenario 2 — Multi-Channel Parallel Outreach**
- Single user command spawns two threads (SMS to Bob, Email to Carol)
- Each thread captures availability independently
- Agent synthesizes when asked
- Validate that creating two threads from one command works without race conditions

**Scenario 3 — Conflict Detection**
- Thread 1: Email to Alex → Alex only free Friday
- Thread 2: SMS to Jordan → Jordan unavailable Friday
- Thread 3: Email to Lisa → Agent must detect conflict and propose options, not just report availability
- Validate that `findOverlap` tool returns empty and agent handles it gracefully with suggested paths forward

**Test:** Run all three scenario scripts in sequence. Each must produce output matching the spec's expected responses in substance (wording can differ).

**This milestone is the submission checkpoint.** Everything after this is polish.

---

## M9 — Hardening
**Goal:** The system fails gracefully. No crashes on bad input. No silent failures.

**Targets:**
- `--thread <nonexistent-id>` → clear error "Thread not found", exit 1
- DB connection failure → human-readable error, not a stack trace
- Embedding API failure → agent falls back to keyword search on `entities` JSONB column
- Agent tool call failure → logged, agent continues with what it has rather than crashing
- Memory extraction returns nothing → silently skipped, never blocks the main response
- Long messages (>10k chars) → truncated with warning before embedding
- Add `RETRIEVAL_LIMIT` and `RETRIEVAL_THRESHOLD` env vars so similarity cutoffs are tunable without code changes
- Add `MAX_THREAD_MESSAGES` env var for the recent history window

**Test:** Deliberately trigger each failure condition. System either recovers gracefully or exits with a useful message.

---

## M10 — Demo Prep
**Goal:** Clean, reproducible demo. Video-ready output.

**Targets:**
- Write `scripts/scenario1.sh`, `scripts/scenario2.sh`, `scripts/scenario3.sh` — exact commands from the spec, runnable in sequence
- Add a `scripts/reset.sh` that wipes the `memories` and `messages` tables for a clean demo run (threads too)
- Verify output formatting is clean in terminal — no raw JSON leaking, no stack traces
- Write `README.md`:
  - Prerequisites (Node 18+, Supabase project, API keys)
  - Setup steps (clone → install → env → migrate → run)
  - How to run each scenario
  - Architecture summary (3 paragraphs max, links to `architecture.md`)
- Record demo video following the three scenarios in order, with voiceover explaining:
  - Why cross-thread retrieval works (pgvector similarity, not message dumping)
  - How adding a new channel works (one file + one line)
  - The tradeoff made with pgvector vs. dedicated vector DB and why it's swappable

---

## Incremental Safety Rules

These rules apply to every single milestone. If any of them are violated, stop and fix before continuing.

1. **Every milestone ends with a passing test.** No "it should work" — run the command, see the output.

2. **Never change a frozen contract.** Frozen contracts are marked per milestone. If a downstream need requires a change, add a new function — do not modify the existing one.

3. **New channels are additive.** The test for this: adding SMS in M7 must not require opening `email.channel.ts` at all.

4. **Memory is always a side effect.** The agent's visible response must be identical whether memory extraction succeeds, fails, or is skipped. Memory write failures are logged and discarded.

5. **Agent tools are independent.** Each tool in `src/agent/tools/` must be testable in isolation with a direct function call. No tool should import another tool.

6. **Schema is set in M2 and frozen.** If a new column is genuinely needed after M2, it must be additive (nullable or with a default). No column renames, no type changes.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| pgvector cosine search returns irrelevant results | Medium | High | Add entity pre-filter on person name; tune `RETRIEVAL_THRESHOLD` |
| Supabase free tier memory limits block vector index creation | Low | Medium | Skip HNSW index for demo scale; document production recommendation |
| OpenAI embedding API latency slows CLI | Low | Low | Embeddings happen after response is printed; non-blocking |
| Claude extraction misses a fact | Medium | Medium | Entities JSONB is secondary lookup; agent can retry with explicit `retrieveMemory` tool call |
| Two threads created in M8 Scenario 2 race on DB | Low | Medium | Sequential thread creation with awaited promises; no parallelism needed at CLI scale |

---

## Definition of Done

The system is complete when:

- All three scenarios from the spec produce correct output
- Adding a new channel requires creating one file and adding one line to the router
- The system does not degrade with 200 stored memories (test by seeding dummy data)
- `scripts/reset.sh && scripts/scenario1.sh` runs without manual intervention
- README setup instructions work on a fresh clone