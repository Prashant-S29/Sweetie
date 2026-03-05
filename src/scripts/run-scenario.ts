/**
 * Scenario runner
 * Usage: npx tsx src/scripts/run-scenario.ts 1|2|3
 *
 * Each run generates a fresh sessionId. All memory written during the run
 * is scoped to that sessionId. No DB reset needed — scenarios coexist cleanly.
 */

import { execSync } from "child_process";
import * as dotenv from "dotenv";
dotenv.config();

import {
  parseEmailOutput,
  parseSmsOutput,
  saveScenarioResult,
  type ResultEntry,
} from "../utils/results";

// ── Session ID ────────────────────────────────────────────────────────────────

function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`;
}

// ── Step executor ─────────────────────────────────────────────────────────────

interface StepOptions {
  label: string;
  args: string;
  type: "send" | "replied";
  channel: "email" | "sms";
  senderEmail: string;
  receiverEmail: string;
  threadId?: string;
  replyContent?: string;
  sessionId: string; // ← always required
}

function runStep(opts: StepOptions): ResultEntry & { threadId: string } {
  const { label, args, type, channel, senderEmail, receiverEmail, sessionId } =
    opts;

  console.log(`\n── ${label} ──`);

  if (type === "replied" && opts.replyContent) {
    if (channel === "sms") {
      console.log(`[${senderEmail}]: ${opts.replyContent}`);
    } else {
      console.log(`From: ${senderEmail}`);
      console.log(`Message: ${opts.replyContent}`);
    }
    console.log("");
  }

  const start = Date.now();
  let raw = "";

  try {
    raw = execSync(`npx tsx src/index.ts ${args} --session ${sessionId}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    });
  } catch (err: any) {
    raw = err.stdout ?? "";
  }

  const durationMs = Date.now() - start;
  const threadMatch = raw.match(/Thread ID[:\s]+(\S+)/);
  const threadId = opts.threadId ?? threadMatch?.[1] ?? "unknown";

  process.stdout.write(raw);

  let output: ResultEntry["output"];

  if (type === "replied" && opts.replyContent) {
    output =
      channel === "email"
        ? {
            senderEmail,
            receiverEmail,
            header: `Re: ${opts.replyContent.slice(0, 60)}`,
            body: opts.replyContent,
            attachments: [],
          }
        : {
            sender: senderEmail,
            receiver: receiverEmail,
            message: opts.replyContent,
          };
  } else {
    output =
      channel === "email"
        ? parseEmailOutput(raw, senderEmail, receiverEmail)
        : parseSmsOutput(raw, senderEmail, receiverEmail);
  }

  return {
    threadId,
    title: label,
    type,
    channel,
    output,
    metadata: { durationMs, args },
  };
}

// ── Scenario 1 ────────────────────────────────────────────────────────────────
// PM schedules Q2 roadmap sync between Bob (Engineering) and Sarah (Design)

function runScenario1(): ResultEntry[] {
  const sessionId = generateSessionId();

  console.log("════════════════════════════════════════════════════════");
  console.log("SCENARIO 1 — Q2 Roadmap Sync (Full End-to-End)");
  console.log("════════════════════════════════════════════════════════");
  console.log(`Session: ${sessionId}`);
  console.log("PM → sys → Bob → sys → Bob(ack) → Sarah → sys → Sarah(ack)");
  console.log("→ sys confirms time → sys → [PM, Bob, Sarah] with GMeet link");

  const steps: ResultEntry[] = [];

  // Step 1: PM → Sys
  const pmMessage =
    "I need to schedule a Q2 roadmap sync with Bob from engineering and Sarah from design sometime next week. Can you coordinate availability?";
  const s1 = runStep({
    label: "PM → System (initiate)",
    args: `--channel sms --to scheduler@company.com "${pmMessage}"`,
    type: "replied",
    channel: "sms",
    senderEmail: "pm@company.com",
    receiverEmail: "scheduler@company.com",
    replyContent: pmMessage,
    sessionId,
  });
  steps.push(s1);

  // Step 2: Sys → PM (ack)
  const s2 = runStep({
    label: "System → PM (acknowledging)",
    args: `--thread ${s1.threadId} "Acknowledge the PM's request. Let them know you'll reach out to Bob and Sarah and report back."`,
    type: "send",
    channel: "sms",
    senderEmail: "scheduler@company.com",
    receiverEmail: "pm@company.com",
    threadId: s1.threadId,
    sessionId,
  });
  steps.push(s2);

  // Step 3: Sys → Bob (Email)
  const s3 = runStep({
    label: "System → Bob (Engineering Lead) via Email",
    args: `--channel email --to bob@company.com "Ask Bob for his availability next week for a Q2 roadmap sync with the design team, requested by the PM"`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "bob@company.com",
    sessionId,
  });
  steps.push(s3);

  // Step 4: Bob → Sys
  const bobReply =
    "I'm free Monday 2-4pm and Wednesday all day next week. Happy to sync on the Q2 roadmap!";
  const s4 = runStep({
    label: "Bob (Engineering Lead) → System",
    args: `--thread ${s3.threadId} --from bob@company.com "${bobReply}"`,
    type: "replied",
    channel: "email",
    senderEmail: "bob@company.com",
    receiverEmail: "scheduler@company.com",
    threadId: s3.threadId,
    replyContent: bobReply,
    sessionId,
  });
  steps.push(s4);

  // Step 5: Sys → Bob (ack)
  const s5 = runStep({
    label: "System → Bob (acknowledging, waiting on Sarah)",
    args: `--thread ${s3.threadId} "Acknowledge Bob's availability. Let him know you'll confirm once you hear back from Sarah."`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "bob@company.com",
    threadId: s3.threadId,
    sessionId,
  });
  steps.push(s5);

  // Step 6: Sys → Sarah (SMS)
  const s6 = runStep({
    label: "System → Sarah (Design Lead) via SMS",
    args: `--channel sms --to sarah@company.com "Ask Sarah when she's free next week for a Q2 roadmap sync with Bob from engineering. The PM requested this."`,
    type: "send",
    channel: "sms",
    senderEmail: "scheduler@company.com",
    receiverEmail: "sarah@company.com",
    sessionId,
  });
  steps.push(s6);

  // Step 7: Sarah → Sys
  const sarahReply =
    "Tuesday or Wednesday afternoon works for me! Wednesday is actually better if possible.";
  const s7 = runStep({
    label: "Sarah (Design Lead) → System",
    args: `--thread ${s6.threadId} --from sarah@company.com "${sarahReply}"`,
    type: "replied",
    channel: "sms",
    senderEmail: "sarah@company.com",
    receiverEmail: "scheduler@company.com",
    threadId: s6.threadId,
    replyContent: sarahReply,
    sessionId,
  });
  steps.push(s7);

  // Step 8: Sys → Sarah (ack)
  const s8 = runStep({
    label: "System → Sarah (acknowledging)",
    args: `--thread ${s6.threadId} "Acknowledge Sarah's availability. Wednesday afternoon looks good, confirmation coming shortly."`,
    type: "send",
    channel: "sms",
    senderEmail: "scheduler@company.com",
    receiverEmail: "sarah@company.com",
    threadId: s6.threadId,
    sessionId,
  });
  steps.push(s8);

  // Step 9: Sys → Bob (propose Wednesday 2pm)
  const s9 = runStep({
    label: "System → Bob (proposing Wednesday 2pm)",
    args: `--channel email --to bob@company.com "Based on Sarah's Wednesday afternoon and your Wednesday all day, propose Wednesday 2:00-3:00 PM for the Q2 sync and ask Bob to confirm"`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "bob@company.com",
    sessionId,
  });
  steps.push(s9);

  // Step 10: Bob confirms
  const bobConfirm = "Wednesday 2pm works perfectly for me!";
  const s10 = runStep({
    label: "Bob → System (confirming Wednesday 2pm)",
    args: `--thread ${s9.threadId} --from bob@company.com "${bobConfirm}"`,
    type: "replied",
    channel: "email",
    senderEmail: "bob@company.com",
    receiverEmail: "scheduler@company.com",
    threadId: s9.threadId,
    replyContent: bobConfirm,
    sessionId,
  });
  steps.push(s10);

  // Step 11: Final → PM
  const s11 = runStep({
    label: "System → PM (final confirmation + GMeet link)",
    args: `--channel email --to pm@company.com "The Q2 roadmap sync is confirmed. Send pm@company.com a final summary: Bob and Sarah confirmed for Wednesday 2:00-3:00 PM. Google Meet: meet.google.com/abc-defg-hij. List both attendees."`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "pm@company.com",
    sessionId,
  });
  steps.push(s11);

  // Step 12: Final → Bob
  const s12 = runStep({
    label: "System → Bob (final confirmation + GMeet link)",
    args: `--channel email --to bob@company.com "Send Bob final confirmation: Q2 roadmap sync Wednesday 2:00-3:00 PM with Sarah from design. Google Meet: meet.google.com/abc-defg-hij"`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "bob@company.com",
    sessionId,
  });
  steps.push(s12);

  // Step 13: Final → Sarah
  const s13 = runStep({
    label: "System → Sarah (final confirmation + GMeet link)",
    args: `--channel sms --to sarah@company.com "Text Sarah: Q2 roadmap sync confirmed Wednesday 2:00-3:00 PM with Bob. Meet: meet.google.com/abc-defg-hij"`,
    type: "send",
    channel: "sms",
    senderEmail: "scheduler@company.com",
    receiverEmail: "sarah@company.com",
    sessionId,
  });
  steps.push(s13);

  return steps;
}

// ── Scenario 2 ────────────────────────────────────────────────────────────────
// HR schedules new hire Bob's onboarding with Carol (Product) and Dave (Engineering)

function runScenario2(): ResultEntry[] {
  const sessionId = generateSessionId();

  console.log("════════════════════════════════════════════════════════");
  console.log("SCENARIO 2 — New Hire Onboarding (Full End-to-End)");
  console.log("════════════════════════════════════════════════════════");
  console.log(`Session: ${sessionId}`);
  console.log("HR → sys → Carol(email) + Dave(sms) → replies → acks");
  console.log("→ sys finds overlap → HR confirms → final to Carol + Dave");

  const steps: ResultEntry[] = [];

  // Step 1: HR → Sys
  const hrMessage =
    "We have a new hire Bob joining engineering on Monday. Can you schedule a 1-hour onboarding session with Carol from product and Dave from engineering this Friday?";
  const s1 = runStep({
    label: "HR → System (initiate onboarding)",
    args: `--channel email --to scheduler@company.com "${hrMessage}"`,
    type: "replied",
    channel: "email",
    senderEmail: "hr@company.com",
    receiverEmail: "scheduler@company.com",
    replyContent: hrMessage,
    sessionId,
  });
  steps.push(s1);

  // Step 2: Sys → HR (ack)
  const s2 = runStep({
    label: "System → HR (acknowledging)",
    args: `--thread ${s1.threadId} "Acknowledge HR's request. Let them know you'll reach out to Carol and Dave to find a Friday slot."`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "hr@company.com",
    threadId: s1.threadId,
    sessionId,
  });
  steps.push(s2);

  // Step 3: Sys → Carol (Email)
  const s3 = runStep({
    label: "System → Carol (Product Lead) via Email",
    args: `--channel email --to carol@company.com "Ask Carol when she's free this Friday for a 1-hour onboarding session for new hire Bob who joins Monday"`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "carol@company.com",
    sessionId,
  });
  steps.push(s3);

  // Step 4: Sys → Dave (SMS)
  const s4 = runStep({
    label: "System → Dave (Engineering Lead) via SMS",
    args: `--channel sms --to dave@company.com "Ask Dave if he's free this Friday for a 1-hour new hire onboarding with Bob joining engineering Monday"`,
    type: "send",
    channel: "sms",
    senderEmail: "scheduler@company.com",
    receiverEmail: "dave@company.com",
    sessionId,
  });
  steps.push(s4);

  // Step 5: Carol → Sys
  const carolReply =
    "Friday works great! I'm free anytime after 10am. Morning would be ideal for onboarding.";
  const s5 = runStep({
    label: "Carol (Product Lead) → System",
    args: `--thread ${s3.threadId} --from carol@company.com "${carolReply}"`,
    type: "replied",
    channel: "email",
    senderEmail: "carol@company.com",
    receiverEmail: "scheduler@company.com",
    threadId: s3.threadId,
    replyContent: carolReply,
    sessionId,
  });
  steps.push(s5);

  // Step 6: Sys → Carol (ack)
  const s6 = runStep({
    label: "System → Carol (acknowledging, waiting on Dave)",
    args: `--thread ${s3.threadId} "Acknowledge Carol's Friday morning availability. Confirm once you hear back from Dave."`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "carol@company.com",
    threadId: s3.threadId,
    sessionId,
  });
  steps.push(s6);

  // Step 7: Dave → Sys
  const daveReply =
    "Friday afternoon works for me, free after 2pm. Can't do morning, I have standups till noon.";
  const s7 = runStep({
    label: "Dave (Engineering Lead) → System",
    args: `--thread ${s4.threadId} --from dave@company.com "${daveReply}"`,
    type: "replied",
    channel: "sms",
    senderEmail: "dave@company.com",
    receiverEmail: "scheduler@company.com",
    threadId: s4.threadId,
    replyContent: daveReply,
    sessionId,
  });
  steps.push(s7);

  // Step 8: Sys → Dave (ack)
  const s8 = runStep({
    label: "System → Dave (acknowledging)",
    args: `--thread ${s4.threadId} "Acknowledge Dave's Friday afternoon availability. Confirming time shortly."`,
    type: "send",
    channel: "sms",
    senderEmail: "scheduler@company.com",
    receiverEmail: "dave@company.com",
    threadId: s4.threadId,
    sessionId,
  });
  steps.push(s8);

  // Step 9: Sys → HR (overlap found)
  const s9 = runStep({
    label: "System → HR (overlap found: Friday 2pm)",
    args: `--channel email --to hr@company.com "Carol is free Friday after 10am, Dave is free Friday after 2pm. Overlap is Friday after 2pm. Propose Friday 2:00-3:00 PM for Bob's onboarding and ask HR to confirm."`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "hr@company.com",
    sessionId,
  });
  steps.push(s9);

  // Step 10: HR confirms
  const hrConfirm =
    "Friday 2pm works. Please send confirmations to Carol and Dave with a meet link.";
  const s10 = runStep({
    label: "HR → System (confirming Friday 2pm)",
    args: `--thread ${s9.threadId} --from hr@company.com "${hrConfirm}"`,
    type: "replied",
    channel: "email",
    senderEmail: "hr@company.com",
    receiverEmail: "scheduler@company.com",
    threadId: s9.threadId,
    replyContent: hrConfirm,
    sessionId,
  });
  steps.push(s10);

  // Step 11: Final → Carol
  const s11 = runStep({
    label: "System → Carol (final confirmation + GMeet link)",
    args: `--channel email --to carol@company.com "Send Carol final confirmation: Bob's onboarding Friday 2:00-3:00 PM, Dave from engineering also attending. Google Meet: meet.google.com/xyz-onbd-123"`,
    type: "send",
    channel: "email",
    senderEmail: "scheduler@company.com",
    receiverEmail: "carol@company.com",
    sessionId,
  });
  steps.push(s11);

  // Step 12: Final → Dave
  const s12 = runStep({
    label: "System → Dave (final confirmation + GMeet link)",
    args: `--channel sms --to dave@company.com "Text Dave: Bob onboarding confirmed Friday 2-3pm with Carol. Meet: meet.google.com/xyz-onbd-123"`,
    type: "send",
    channel: "sms",
    senderEmail: "scheduler@company.com",
    receiverEmail: "dave@company.com",
    sessionId,
  });
  steps.push(s12);

  return steps;
}

// ── Scenario 3 ────────────────────────────────────────────────────────────────
// Recruiter Lisa coordinates technical interview: Alex (candidate) vs Jordan (CTO)
// Conflict: Alex only free Friday, Jordan at conference Friday → no overlap

function runScenario3(): ResultEntry[] {
  const sessionId = generateSessionId();

  console.log("════════════════════════════════════════════════════════");
  console.log("SCENARIO 3 — Technical Interview: Conflict Detection");
  console.log("════════════════════════════════════════════════════════");
  console.log(`Session: ${sessionId}`);
  console.log("Lisa → sys → Alex(email) → Alex → sys → Alex(ack)");
  console.log(
    "→ Jordan(sms) → Jordan → sys → Jordan(ack) → sys detects conflict → Lisa",
  );

  const steps: ResultEntry[] = [];

  // Step 1: Lisa → Sys
  const lisaMessage =
    "I need to schedule a 90-minute technical interview for Alex who applied for our Senior Engineer role. Can you coordinate with Alex and Jordan our CTO to find a time next week?";
  const s1 = runStep({
    label: "Lisa (Recruiter) → System (initiate)",
    args: `--channel email --to recruiting@company.com "${lisaMessage}"`,
    type: "replied",
    channel: "email",
    senderEmail: "lisa@company.com",
    receiverEmail: "recruiting@company.com",
    replyContent: lisaMessage,
    sessionId,
  });
  steps.push(s1);

  // Step 2: Sys → Lisa (ack)
  const s2 = runStep({
    label: "System → Lisa (acknowledging)",
    args: `--thread ${s1.threadId} "Acknowledge Lisa's request to schedule Alex's interview with Jordan. You'll reach out to both and report back."`,
    type: "send",
    channel: "email",
    senderEmail: "recruiting@company.com",
    receiverEmail: "lisa@company.com",
    threadId: s1.threadId,
    sessionId,
  });
  steps.push(s2);

  // Step 3: Sys → Alex (Email)
  const s3 = runStep({
    label: "System → Alex (candidate) via Email",
    args: `--channel email --to alex@gmail.com "Ask Alex for his availability next week for a 90-minute technical interview for the Senior Engineer role"`,
    type: "send",
    channel: "email",
    senderEmail: "recruiting@company.com",
    receiverEmail: "alex@gmail.com",
    sessionId,
  });
  steps.push(s3);

  // Step 4: Alex → Sys
  const alexReply =
    "I can only do Friday next week — I'm giving notice at my current job Monday through Thursday. I've taken Friday off specifically for this.";
  const s4 = runStep({
    label: "Alex (candidate) → System",
    args: `--thread ${s3.threadId} --from alex@gmail.com "${alexReply}"`,
    type: "replied",
    channel: "email",
    senderEmail: "alex@gmail.com",
    receiverEmail: "recruiting@company.com",
    threadId: s3.threadId,
    replyContent: alexReply,
    sessionId,
  });
  steps.push(s4);

  // Step 5: Sys → Alex (ack)
  const s5 = runStep({
    label: "System → Alex (acknowledging Friday availability)",
    args: `--thread ${s3.threadId} "Acknowledge Alex's Friday availability. Let him know you'll confirm the exact time once you've coordinated with the interview panel."`,
    type: "send",
    channel: "email",
    senderEmail: "recruiting@company.com",
    receiverEmail: "alex@gmail.com",
    threadId: s3.threadId,
    sessionId,
  });
  steps.push(s5);

  // Step 6: Sys → Jordan (SMS)
  const s6 = runStep({
    label: "System → Jordan (CTO) via SMS",
    args: `--channel sms --to jordan@company.com "Ask Jordan when they can do a 90-minute technical interview with Alex for the Senior Engineer role next week"`,
    type: "send",
    channel: "sms",
    senderEmail: "recruiting@company.com",
    receiverEmail: "jordan@company.com",
    sessionId,
  });
  steps.push(s6);

  // Step 7: Jordan → Sys
  const jordanReply =
    "I'm at AWS re:Invent all day Friday. Any other day next week works fine.";
  const s7 = runStep({
    label: "Jordan (CTO) → System",
    args: `--thread ${s6.threadId} --from jordan@company.com "${jordanReply}"`,
    type: "replied",
    channel: "sms",
    senderEmail: "jordan@company.com",
    receiverEmail: "recruiting@company.com",
    threadId: s6.threadId,
    replyContent: jordanReply,
    sessionId,
  });
  steps.push(s7);

  // Step 8: Sys → Jordan (ack)
  const s8 = runStep({
    label: "System → Jordan (acknowledging)",
    args: `--thread ${s6.threadId} "Acknowledge Jordan's availability Mon-Thu. Let him know you're checking options and will follow up."`,
    type: "send",
    channel: "sms",
    senderEmail: "recruiting@company.com",
    receiverEmail: "jordan@company.com",
    threadId: s6.threadId,
    sessionId,
  });
  steps.push(s8);

  // Step 9: Sys → Lisa (conflict + options)
  const s9 = runStep({
    label: "System → Lisa (conflict detected + 3 options)",
    args: `--channel email --to lisa@company.com "Update lisa@company.com: Alex is only free Friday (giving notice Mon-Thu), Jordan is at AWS re:Invent all day Friday. There is no overlap next week. Present 3 concrete options to resolve this scheduling conflict."`,
    type: "send",
    channel: "email",
    senderEmail: "recruiting@company.com",
    receiverEmail: "lisa@company.com",
    sessionId,
  });
  steps.push(s9);

  return steps;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const RUNNERS: Record<number, () => ResultEntry[]> = {
  1: runScenario1,
  2: runScenario2,
  3: runScenario3,
};

const SCENARIO_NAMES: Record<number, string> = {
  1: "Cross-Thread Availability Aggregation",
  2: "Multi-Channel Parallel Outreach",
  3: "Conflict Detection",
};

const scenarioNum = parseInt(process.argv[2] ?? "1");
const runner = RUNNERS[scenarioNum];

if (!runner) {
  console.error(`✗ Unknown scenario: ${scenarioNum}. Use 1, 2, or 3.`);
  process.exit(1);
}

const startMs = Date.now();
let steps: ResultEntry[];

try {
  steps = runner();
} catch (err) {
  console.error("✗ Scenario failed:", (err as Error).message);
  process.exit(1);
}

const totalDurationMs = Date.now() - startMs;
const filename = saveScenarioResult(
  scenarioNum,
  SCENARIO_NAMES[scenarioNum],
  steps,
  totalDurationMs,
);

console.log(`\n📄 Results saved → results/${filename}`);
console.log(
  `✓ Scenario ${scenarioNum} complete (${(totalDurationMs / 1000).toFixed(2)}s total)`,
);
