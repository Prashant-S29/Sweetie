# AI/ML Hiring Task: Multi-Channel Scheduling Coordinator

## Overview

Build a **multi-channel, cross-thread scheduling coordinator** that can intelligently retrieve and utilize context from previous conversations—regardless of which channel or thread that context originated from.

**Time Limit**: 3 hours  
**Language**: TypeScript

---

## The Problem

You are building an AI scheduling assistant that handles conversations across multiple channels (Email and SMS). Both channels are **simulated** via CLI—no actual emails or texts are sent. The assistant must:

1. **Remember context across threads** — Information shared in one conversation must be accessible when relevant in another
2. **Remember context across channels** — An availability mentioned via Email should be known when scheduling via SMS
3. **Handle outbound flows** — User initiates action, agent reaches out to external parties
4. **Scale without context window abuse** — Dumping all historical messages into a single prompt is not acceptable

### Why This Is Hard

Traditional chatbots treat each conversation as isolated. But real scheduling requires connecting information scattered across multiple conversations:

- Bob shares his availability in **Thread A** (Email)
- Sarah shares hers in **Thread B** (SMS)  
- You ask to schedule them together in **Thread C** (Email)

The agent processing Thread C must **automatically** know what Bob said in Thread A and what Sarah said in Thread B—without those threads being explicitly referenced.

---

## Requirements

### Functional Requirements

1. **Multi-Channel Support**
   - Support 2 simulated channels: Email and SMS
   - Each channel has different interaction patterns and tone expectations
   - Channel-appropriate response formatting (formal email vs concise SMS)

2. **Cross-Thread Context Retrieval**
   - Information from Thread A must be retrievable when processing Thread B
   - Retrieval must be based on **relevance** not just recency
   - The system must identify WHEN cross-thread context is needed

3. **Cross-Channel Context Retrieval**
   - Context must flow across channel boundaries
   - Email availability → accessible from SMS query
   - SMS preferences → accessible from Email scheduling

4. **Outbound Flow Support**
   - User initiates action → Agent reaches out to external parties
   - Proper identification of parties involved

5. **Stateful Conversations**
   - Each thread maintains its own conversation state
   - Conversations must be resumable (user can return hours/days later)
   - State persists across process restarts

### Non-Functional Requirements

6. **Extensible Architecture**
   - Adding a new channel should not require rewriting core logic
   - Memory/retrieval system should be pluggable
   - Agent capabilities should be modular

7. **Scalable Context Management**
   - ❌ **Invalid**: Loading all messages into one context window
   - ✅ **Valid**: Intelligent retrieval of relevant context only
   - System should work with 100s of threads without degradation

---

## CLI Interface

All interactions happen via command line. Channels are simulated—no actual emails or SMS messages are sent.

```bash
# Install dependencies
npm install

# Start a new thread (outbound email to Bob)
$ npx tsx src/index.ts --channel email --to bob@example.com "Ask Bob for his availability next week"

> OK
> Channel: email
> To: bob@example.com
> Thread ID: thread_abc123
> 
> Message:
> Subject: Availability Next Week
> 
> Hi Bob,
> 
> I'm reaching out to find a time to meet next week. What times work for you?

# Simulate Bob's reply (continue the thread)
$ npx tsx src/index.ts --thread thread_abc123 --from bob@example.com "I'm free Monday 2-4pm and Wednesday all day"

> OK. Noted Bob's availability: Monday 2-4pm, Wednesday all day.

# Start a NEW thread via SMS to Sarah
$ npx tsx src/index.ts --channel sms --to sarah@example.com "Ask Sarah when she can meet with Bob"

> OK. sound's good.
> Channel: sms
> To: sarah@example.com
> Thread ID: thread_def456
> 
> Message:
> Hi Sarah! When are you free to meet with Bob next week?

# Simulate Sarah's reply
$ npx tsx src/index.ts --thread thread_def456 --from sarah@example.com "Tuesday or Wednesday afternoon"

> OK. Noted Sarah's availability: Tuesday or Wednesday afternoon.

# Start a THIRD thread — agent should retrieve context from threads 1 and 2
$ npx tsx src/index.ts --channel email --to manager@example.com "Schedule Bob and Sarah's meeting"

> Understood, i'll do that.
> Channel: email
> To: manager@example.com
> Thread ID: thread_ghi789
> 
> Message:
> Subject: Bob & Sarah Meeting - Wednesday Afternoon
>
> Hi,
>
> Based on availability I've gathered:
>  • Bob: Monday 2-4pm, Wednesday all day
>  • Sarah: Tuesday or Wednesday afternoon
>
> The overlapping window is Wednesday afternoon. 
> I recommend scheduling for Wednesday 2:00-3:00 PM.
>
> Let me know if you'd like me to send calendar invites.
```

---

## Example Scenarios

### Scenario 1: Cross-Thread Availability Aggregation

```
THREAD 1 — Email (Outbound to Bob)
────────────────────────────────────
User: "Ask Bob for his availability next week"

Agent → Bob: "Hi Bob, when are you free next week?"

Bob replies: "I'm available Monday 2-4pm and Wednesday all day"

[Agent stores: Bob available Mon 2-4pm, Wed all day]

---

THREAD 2 — SMS (Outbound to Sarah)  
────────────────────────────────────
User: "Text Sarah to ask when she can interview Bob"

Agent → Sarah: "Hi Sarah! When works for you to interview Bob?"

Sarah replies: "Tuesday or Wednesday afternoon works for me"

[Agent stores: Sarah available Tue afternoon, Wed afternoon]

---

THREAD 3 — Email (Outbound to Hiring Manager)
────────────────────────────────────
User: "Email Mike to confirm Bob's interview with Sarah"

[Agent must retrieve Bob's availability from Thread 1 (Email) 
 AND Sarah's availability from Thread 2 (SMS)
 to find overlap: Wednesday afternoon]

Expected Agent Response:
"Based on the availability I've gathered:
 • Bob: Monday 2-4pm, Wednesday all day
 • Sarah: Tuesday or Wednesday afternoon
 
 The overlapping window is Wednesday afternoon. 
 I recommend scheduling for Wednesday 2:00-3:00 PM.
 
 Shall I draft the confirmation email to Mike?"
```

---

### Scenario 2: Multi-Channel Parallel Outreach

```
USER REQUEST (Single Command)
────────────────────────────────────
User: "Schedule a meeting with Bob and Carol for Friday. 
       Text Bob via SMS, email Carol."

[Agent must create TWO threads and coordinate responses]

---

THREAD 1 — SMS (Outbound to Bob, auto-created)
────────────────────────────────────
Agent → Bob: "Hi Bob! Are you free Friday for a meeting?"

Bob replies: "Friday afternoon works, after 2pm"

[Agent stores: Bob available Fri after 2pm]

---

THREAD 2 — Email (Outbound to Carol, auto-created)
────────────────────────────────────
Agent → Carol: "Hi Carol, are you available Friday for a meeting?"

Carol replies: "Yes, I'm free all day Friday"

[Agent stores: Carol available Fri all day]

---

BACK TO USER
────────────────────────────────────
[Agent synthesizes both responses across threads/channels]

Expected Agent Response:
"I've heard back from both:
 • Bob (SMS): Available Friday after 2pm
 • Carol (Email): Available all day Friday
 
 Both are free Friday afternoon. Shall I confirm 2:00-3:00 PM?"
```

---

### Scenario 3: Recruiting Coordination with Conflict

```
THREAD 1 — Email (Outbound to Alex, the Candidate)
────────────────────────────────────
User: "Email Alex to get his availability for an interview next week"

Agent → Alex: "Hi Alex, we'd like to schedule your interview. When are you available next week?"

Alex replies: "I can only do Friday - I'm giving notice at my current job Mon-Thu"

[Agent stores: Alex (candidate) available Fri only]

---

THREAD 2 — SMS (Outbound to Jordan, the Client/Hiring Manager)
────────────────────────────────────
User: "Text Jordan to see when they can interview Alex"

Agent → Jordan: "Hi Jordan! When can you interview Alex next week?"

Jordan replies: "I'm at a conference Friday. Any other day works."

[Agent stores: Jordan (client) available Mon-Thu, not Fri]

---

THREAD 3 — Email (Outbound to Lisa, the Recruiter)
────────────────────────────────────
User: "Update Lisa on scheduling Alex's interview with Jordan"

[Agent must synthesize: Alex=Fri only, Jordan=Mon-Thu only → CONFLICT]

Expected Agent Response:
"I've gathered availability for Alex's interview:
 • Alex (candidate): Only available Friday (giving notice Mon-Thu)
 • Jordan (hiring manager): Available Mon-Thu (conference Friday)
 
 Unfortunately, there's no overlap next week.
 
 Options:
 1. Ask if Jordan can do a quick video call from the conference Friday
 2. See if Alex can take a long lunch Mon-Thu
 3. Push to the following week
 
 How would you like me to proceed with Lisa?"
```

---

## Provided Resources

- **Anthropic API Key**: Provided for your use (Claude models)

---

## Submission

Provide a GitHub repository containing:

1. **Source code** with clear project structure
2. **README** with setup and run instructions
3. **Demo video** (keep it short) with voiceover that:
   - Demonstrates all three scenarios working
   - Explains your architecture and design decisions
   - Discusses tradeoffs you made and why

### Important Constraint

Your solution must use **intelligent context management** that scales. Simply concatenating all thread/message history into a single prompt is not an acceptable solution—the system should work efficiently even with hundreds of threads.

---

## Notes

- You may use any frameworks, libraries, or external services you find appropriate
- Focus on the **architecture** — we care more about how you solve the cross-thread problem than perfect NLP
- All channels are simulated via CLI; no actual messages are sent

Good luck!
