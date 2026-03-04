import { Command, InvalidArgumentError } from "commander";
import * as dotenv from "dotenv";
dotenv.config();

import { ping } from "./db/client";
import { getThread } from "./db/helpers";
import type { CLIInput, ChannelType } from "./types";

// ── Validation ────────────────────────────────────────────────────────────────

function validateChannel(value: string): ChannelType {
  if (value !== "email" && value !== "sms") {
    throw new InvalidArgumentError(
      `Channel must be 'email' or 'sms', got '${value}'`,
    );
  }
  return value;
}

function validateAddress(value: string): string {
  if (!value || value.trim().length === 0) {
    throw new InvalidArgumentError("Address cannot be empty");
  }
  return value.trim();
}

// ── Handlers (stubs for now — wired in M4+) ──────────────────────────────────

async function handleNewThread(input: CLIInput & { kind: "new_thread" }) {
  console.log("→ New outbound thread");
  console.log(`  Channel : ${input.channel}`);
  console.log(`  To      : ${input.to}`);
  console.log(`  Message : ${input.message}`);
  // TODO M4: create thread, run agent, print formatted response
}

async function handleContinueThread(
  input: CLIInput & { kind: "continue_thread" },
) {
  console.log("→ Continue thread (inbound reply)");
  console.log(`  Thread  : ${input.threadId}`);
  console.log(`  From    : ${input.from}`);
  console.log(`  Message : ${input.message}`);
  // TODO M4: load thread, append message, run agent
}

async function handleUserThread(input: CLIInput & { kind: "user_thread" }) {
  console.log("→ User continues thread");
  console.log(`  Thread  : ${input.threadId}`);
  console.log(`  Message : ${input.message}`);
  // TODO M4: load thread, append user message, run agent
}

// ── Route ─────────────────────────────────────────────────────────────────────

async function route(
  message: string,
  opts: {
    channel?: string;
    to?: string;
    from?: string;
    thread?: string;
  },
) {
  await ping();

  const { channel, to, from, thread } = opts;

  // Pattern 1: --thread + --from → inbound reply from external party
  if (thread && from) {
    const existing = await getThread(thread);
    if (!existing) {
      console.error(`✗ Thread not found: ${thread}`);
      process.exit(1);
    }
    await handleContinueThread({
      kind: "continue_thread",
      threadId: thread,
      from,
      message,
    });
    return;
  }

  // Pattern 2: --thread only → user continues their own thread
  if (thread && !from) {
    const existing = await getThread(thread);
    if (!existing) {
      console.error(`✗ Thread not found: ${thread}`);
      process.exit(1);
    }
    await handleUserThread({ kind: "user_thread", threadId: thread, message });
    return;
  }

  // Pattern 3: --channel + --to → new outbound thread
  if (channel && to) {
    const validatedChannel = validateChannel(channel);
    const validatedTo = validateAddress(to);
    await handleNewThread({
      kind: "new_thread",
      channel: validatedChannel,
      to: validatedTo,
      message,
    });
    return;
  }

  // Nothing matched
  console.error("✗ Invalid usage. Examples:");
  console.error(
    "  New thread  : --channel email --to bob@example.com 'message'",
  );
  console.error(
    "  Reply       : --thread <id> --from bob@example.com 'message'",
  );
  console.error("  User follow : --thread <id> 'message'");
  process.exit(1);
}

// ── CLI setup ─────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("scheduler")
  .description("Multi-channel scheduling coordinator")
  .version("1.0.0")
  .argument("[message]", "Message to send")
  .option("--channel <channel>", "Channel: email | sms", validateChannel)
  .option("--to <address>", "Recipient address")
  .option("--from <address>", "Sender address (inbound replies)")
  .option("--thread <threadId>", "Thread ID to continue")
  .action(async (message: string | undefined, opts) => {
    if (!message || message.trim().length === 0) {
      console.error("✗ Message is required");
      process.exit(1);
    }
    await route(message.trim(), opts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("✗ Error:", err.message);
  process.exit(1);
});
