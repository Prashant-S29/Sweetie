import * as fs from "fs";
import * as path from "path";

// ── Output formats ────────────────────────────────────────────────────────────

export interface EmailOutput {
  senderEmail: string;
  receiverEmail: string;
  header: string;
  body: string;
  attachments: string[];
}

export interface SmsOutput {
  sender: string;
  receiver: string;
  message: string;
}

// ── Result entry ──────────────────────────────────────────────────────────────

export interface ResultEntry {
  threadId: string;
  title: string;
  type: "send" | "replied";
  channel: "email" | "sms";
  output: EmailOutput | SmsOutput;
  metadata: {
    durationMs: number;
    args: string;
  };
}

// ── Scenario result ───────────────────────────────────────────────────────────

export interface ScenarioResult {
  scenario: string;
  scenarioNumber: number;
  timestamp: string;
  totalDurationMs: number;
  steps: ResultEntry[];
}

// ── Noise patterns to strip from output ──────────────────────────────────────

const NOISE_PATTERNS = [
  /^✓ Database connected\s*$/,
  /^OK\s*$/,
  /^⏱\s+Completed in .+$/,
  /^↳ Stored \d+ memory fact\(s\)\s*$/,
  /^\s*↳ Stored \d+ memory fact\(s\)\s*$/,
  /^Channel\s*:\s*.+$/,
  /^To\s*:\s*.+$/,
  /^Thread ID\s*:\s*.+$/,
];

function stripNoise(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !NOISE_PATTERNS.some((p) => p.test(line)))
    .join("\n")
    .trim();
}

// ── Parsers ───────────────────────────────────────────────────────────────────

export function parseEmailOutput(
  raw: string,
  senderEmail: string,
  receiverEmail: string,
): EmailOutput {
  const clean = stripNoise(raw);
  const lines = clean.split("\n");

  const subjectIdx = lines.findIndex((l) => l.match(/^Subject:/i));
  const header =
    subjectIdx >= 0
      ? lines[subjectIdx].replace(/^Subject:\s*/i, "").trim()
      : "";

  const body =
    subjectIdx >= 0
      ? lines
          .slice(subjectIdx + 1)
          .join("\n")
          .trim()
      : clean;

  return {
    senderEmail,
    receiverEmail,
    header,
    body,
    attachments: [],
  };
}

export function parseSmsOutput(
  raw: string,
  sender: string,
  receiver: string,
): SmsOutput {
  const message = stripNoise(raw);
  return { sender, receiver, message };
}

// ── Save ──────────────────────────────────────────────────────────────────────

export function saveScenarioResult(
  scenarioNum: number,
  scenarioName: string,
  steps: ResultEntry[],
  totalDurationMs: number,
): string {
  const resultsDir = path.join(process.cwd(), "results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);

  const filename = `sc_${scenarioNum}_${ts}.json`;
  const filepath = path.join(resultsDir, filename);

  const result: ScenarioResult = {
    scenario: scenarioName,
    scenarioNumber: scenarioNum,
    timestamp: new Date().toISOString(),
    totalDurationMs,
    steps,
  };

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  return filename;
}
