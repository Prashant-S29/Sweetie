# Dataflow & Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MULTI-CHANNEL SCHEDULING COORDINATOR             │
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │   CLI    │───▶│  Router  │───▶│  Agent   │───▶│   Channel    │  │
│  │ (index)  │    │          │    │  (LLM)   │    │  Formatter   │  │
│  └──────────┘    └──────────┘    └────┬─────┘    └──────────────┘  │
│                                       │                             │
│                              ┌────────▼────────┐                   │
│                              │  Memory Service  │                   │
│                              │  (pgvector)      │                   │
│                              └────────┬─────────┘                  │
│                                       │                             │
│                              ┌────────▼────────┐                   │
│                              │   PostgreSQL     │                   │
│                              │  + pgvector      │                   │
│                              └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TRANSPORT LAYER                       │
│                                                         │
│   EmailChannel              SmsChannel                  │
│   ┌─────────────────┐       ┌─────────────────┐         │
│   │ • Formal tone   │       │ • Casual tone   │         │
│   │ • Subject lines │       │ • 160 char limit│         │
│   │ • Paragraphs    │       │ • No formatting │         │
│   └────────┬────────┘       └────────┬────────┘         │
│            └──────────┬─────────────┘                   │
│                       │ Channel interface                │
└───────────────────────┼─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  INTELLIGENCE LAYER                      │
│                                                         │
│   ┌─────────────────────────────────────────────┐       │
│   │              Agent (Claude Sonnet)           │       │
│   │                                             │       │
│   │   Tools:                                    │       │
│   │   ┌──────────────────┐  ┌───────────────┐   │       │
│   │   │ retrieveMemory() │  │ findOverlap() │   │       │
│   │   │ • embeds query   │  │ • normalises  │   │       │
│   │   │ • vector search  │  │   time slots  │   │       │
│   │   │ • returns facts  │  │ • finds       │   │       │
│   │   │   scoped to      │  │   common      │   │       │
│   │   │   session        │  │   windows     │   │       │
│   │   └──────────────────┘  └───────────────┘   │       │
│   └─────────────────────────────────────────────┘       │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                    MEMORY LAYER                          │
│                                                         │
│   Write Path (after every inbound message)              │
│   ┌──────────────────────────────────────────────┐      │
│   │  message text                                │      │
│   │      │                                       │      │
│   │      ▼                                       │      │
│   │  Claude Haiku  ──▶  structured facts         │      │
│   │  (extraction)       [{content, entities}]    │      │
│   │      │                                       │      │
│   │      ▼                                       │      │
│   │  OpenAI embed  ──▶  vector [1536 dims]        │      │
│   │      │                                       │      │
│   │      ▼                                       │      │
│   │  INSERT memories (sessionId, threadId, ...)  │      │
│   └──────────────────────────────────────────────┘      │
│                                                         │
│   Read Path (agent tool call)                           │
│   ┌──────────────────────────────────────────────┐      │
│   │  query string                                │      │
│   │      │                                       │      │
│   │      ▼                                       │      │
│   │  OpenAI embed  ──▶  query vector              │      │
│   │      │                                       │      │
│   │      ▼                                       │      │
│   │  pgvector cosine similarity                  │      │
│   │  WHERE session_id = :sessionId               │      │
│   │  ORDER BY embedding <=> :queryVec            │      │
│   │  LIMIT k                                     │      │
│   │      │                                       │      │
│   │      ▼                                       │      │
│   │  top-K relevant facts  ──▶  agent context    │      │
│   └──────────────────────────────────────────────┘      │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  PERSISTENCE LAYER                       │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌────────────────────┐ │
│  │ threads  │    │ messages │    │      memories      │ │
│  │──────────│    │──────────│    │────────────────────│ │
│  │ id       │◀──▶│ threadId │    │ id                 │ │
│  │ channel  │    │ role     │    │ sessionId  ◀─ scope │ │
│  │ toAddr   │    │ content  │    │ threadId           │ │
│  │ fromAddr │    │ createdAt│    │ content            │ │
│  │ meta     │    └──────────┘    │ embedding vector   │ │
│  └──────────┘                   │ entities (JSONB)   │ │
│                                 └────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Session Scoping — Memory Isolation

```
  DB contains memories from multiple sessions

  ┌─────────────────────────────────────────────────┐
  │                memories table                   │
  │                                                 │
  │  sess_aaa │ thread_1 │ "Bob free Monday 2-4pm"  │
  │  sess_aaa │ thread_2 │ "Sarah free Wednesday"   │
  │  sess_bbb │ thread_3 │ "Carol free Friday 10am" │  ← Scenario 2
  │  sess_bbb │ thread_4 │ "Dave free Friday 2pm"   │  ← Scenario 2
  │  sess_ccc │ thread_5 │ "Alex only free Friday"  │  ← Scenario 3
  └─────────────────────────────────────────────────┘
            │
            │  retrieveMemory("Bob availability", sessionId="sess_aaa")
            │
            ▼
  ┌─────────────────────────────────────────────────┐
  │  WHERE session_id = 'sess_aaa'                  │
  │  ORDER BY embedding <=> queryVec                │
  │                                                 │
  │  ✓ "Bob free Monday 2-4pm"     (score: 0.97)   │
  │  ✓ "Sarah free Wednesday"       (score: 0.82)   │
  │  ✗ "Carol free Friday 10am"    (different sess) │
  │  ✗ "Alex only free Friday"     (different sess) │
  └─────────────────────────────────────────────────┘
```

---

## Cross-Thread, Cross-Channel Retrieval

```
  THREAD 1 (Email)               THREAD 2 (SMS)
  bob@company.com                sarah@company.com
  ┌─────────────────┐            ┌─────────────────┐
  │ Bob: "Monday    │            │ Sarah: "Wed      │
  │  2-4pm and Wed  │            │  afternoon       │
  │  all day"       │            │  works for me"   │
  └────────┬────────┘            └────────┬────────┘
           │ extract + embed               │ extract + embed
           ▼                              ▼
  memories table (same sessionId)
  ┌──────────────────────────────────────────────────┐
  │ "bob@company.com is available Monday 2-4pm"      │
  │ "bob@company.com is available Wednesday all day" │
  │ "sarah@company.com is available Wednesday aft."  │
  └──────────────────────┬───────────────────────────┘
                         │
                  THREAD 3 (Email)
                  manager@company.com
                  ┌──────────────────────────────┐
                  │ User: "Schedule Bob & Sarah"  │
                  └──────────────┬───────────────┘
                                 │
                    agent calls retrieveMemory()
                    query: "Bob Sarah availability"
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ top-K facts returned:         │
                  │ • Bob: Mon 2-4pm, Wed all day │  ← from Email thread
                  │ • Sarah: Wed afternoon        │  ← from SMS thread
                  └──────────────┬───────────────┘
                                 │
                    agent calls findOverlap()
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Overlap: Wednesday afternoon  │
                  │ → Propose Wednesday 2:00 PM  │
                  └──────────────────────────────┘
```

---

## CLI Routing — Three Patterns

```
  npx tsx src/index.ts [message] [flags]

  ┌────────────────────────────────────────────────────────┐
  │                     CLI Input                          │
  └──────────────────────┬─────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    --channel         --thread        --thread
    --to              --from          (no --from)
          │              │              │
          ▼              ▼              ▼
   New Thread      Inbound Reply   User Follow-up
   (outbound)      (external →     (user continues
                    system)         own thread)
          │              │              │
          └──────────────┼──────────────┘
                         │
                    ┌────▼─────┐
                    │  Agent   │
                    └────┬─────┘
                         │
              extractAndStore()  ← only on inbound replies
              (fire-and-forget,
               never blocks response)
```

---

## Full End-to-End Flow: Scenario 1

```
  pm@company.com
       │
       │ SMS: "Schedule Q2 sync with Bob and Sarah"
       ▼
  ┌──────────────────────┐
  │   Thread 1 (SMS)     │  sessionId: sess_xxx
  │   sys ←── PM         │
  │   sys ──▶ PM (ack)   │
  └──────────────────────┘
       │
       │ new thread, same session
       ▼
  ┌──────────────────────┐
  │   Thread 2 (Email)   │  sessionId: sess_xxx
  │   sys ──▶ Bob        │
  │   Bob ──▶ sys        │──▶ extractAndStore()
  │                      │    "Bob free Mon 2-4pm"
  │   sys ──▶ Bob (ack)  │    "Bob free Wed all day"
  └──────────────────────┘
       │
       │ new thread, same session
       ▼
  ┌──────────────────────┐
  │   Thread 3 (SMS)     │  sessionId: sess_xxx
  │   sys ──▶ Sarah      │
  │   Sarah ──▶ sys      │──▶ extractAndStore()
  │                      │    "Sarah free Wed aft."
  │   sys ──▶ Sarah (ack)│
  └──────────────────────┘
       │
       │ new thread, same session
       ▼
  ┌──────────────────────┐
  │   Thread 4 (Email)   │  sessionId: sess_xxx
  │   sys ──▶ Bob        │◀── retrieveMemory()
  │          "Wed 2pm?"  │    finds Bob + Sarah facts
  │   Bob ──▶ sys "yes!" │    from threads 2 and 3
  └──────────────────────┘
       │
       │ broadcast, same session
       ▼
  ┌──────────────────────────────────────────────┐
  │  Final confirmations                         │
  │  sys ──▶ PM     (Email) — meeting summary    │
  │  sys ──▶ Bob    (Email) — confirmed + GMeet  │
  │  sys ──▶ Sarah  (SMS)   — confirmed + GMeet  │
  └──────────────────────────────────────────────┘
```

---

## Component Responsibilities

```
  src/
  ├── index.ts              CLI entry point, routing, session ID generation
  │
  ├── agent/
  │   ├── agent.ts          LLM loop, tool registration (session-scoped)
  │   └── prompts/
  │       └── system.ts     Base prompt + channel addendum
  │
  ├── channels/
  │   ├── base.channel.ts   Channel interface (formatOutbound, getSystemPromptAddendum)
  │   ├── email.channel.ts  Subject extraction, formal tone, paragraph formatting
  │   ├── sms.channel.ts    160-char guidance, casual tone, no markdown
  │   └── registry.ts       Channel map — adding a channel = 1 file + 1 line here
  │
  ├── memory/
  │   ├── embeddings.ts     OpenAI text-embedding-3-small wrapper (1536 dims)
  │   └── memory.service.ts extractAndStore (write) + retrieveRelevant (read)
  │                         Both scoped by sessionId
  │
  ├── db/
  │   ├── client.ts         Postgres connection + ping
  │   ├── schema.ts         threads / messages / memories (pgvector, HNSW index)
  │   └── helpers.ts        createThread, getThread, appendMessage, getRecentMessages
  │
  ├── types/
  │   └── index.ts          ThreadContext (includes sessionId), MemoryFact, CLIInput
  │
  └── utils/
      └── results.ts        ResultEntry types, parseEmailOutput, parseSmsOutput, save

  src/scripts/
  └── run-scenario.ts       Scenario runner — generates sessionId, runs steps,
                            captures outputs, saves sc_N_<timestamp>.json
```

---

## Memory Write/Read Timing

```
  Inbound message arrives
         │
         ▼
  ┌─────────────────┐
  │  appendMessage  │  synchronous — message stored before agent runs
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │   runAgent()    │  synchronous — agent produces response
  │   (may call     │
  │   retrieveMemory│
  │   tool inside)  │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ appendMessage   │  synchronous — agent response stored
  │ (agent reply)   │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ extractAndStore │  fire-and-forget — never blocks response time
  │ (async, .catch) │  Haiku extracts facts → OpenAI embeds → INSERT
  └─────────────────┘

  ⚠ Note: extraction runs AFTER the response is returned.
    Facts from the current message are NOT available to the
    current agent call — only to future calls in this session.
```

---

## Functional Requirements Coverage

```
  Requirement                         Implementation
  ─────────────────────────────────────────────────────────────────
  Multi-Channel Support               EmailChannel + SmsChannel
                                      Channel interface in registry
                                      Adding channel = 1 file + 1 line

  Cross-Thread Context Retrieval      pgvector cosine similarity search
                                      retrieveMemory tool called by agent
                                      Relevance-based, not recency-based

  Cross-Channel Context Retrieval     memories table has no channel filter
                                      Email facts retrievable from SMS thread
                                      SMS facts retrievable from Email thread

  Outbound Flow Support               --channel --to flags create new threads
                                      Agent contacts external parties directly

  Stateful Conversations              messages table persists all turns
                                      getRecentMessages() resumes any thread
                                      Survives process restarts (PostgreSQL)

  Memory Isolation (scalability)      sessionId column on memories table
                                      All reads/writes scoped to session
                                      100s of sessions coexist without bleed
```