import { extractAndStore } from "./memory/memory.service";
import { Command, InvalidArgumentError } from "commander";

import * as dotenv from "dotenv";
dotenv.config();

import { ping } from "./db/client";
import {
  createThread,
  getThread,
  appendMessage,
  getRecentMessages,
} from "./db/helpers";
import { runAgent } from "./agent/agent";
import type {
  CLIInput,
  ContinueThreadInput,
  ChannelType,
  ThreadContext,
} from "./types";

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

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleNewThread(input: CLIInput & { kind: "new_thread" }) {
  // 1. Create thread in DB
  const thread = await createThread(input.channel, input.to);

  // 2. Store user instruction as "user" role
  await appendMessage(thread.id, "user", input.message);
  const context: ThreadContext = {
    threadId: thread.id,
    channel: input.channel,
    toAddress: input.to,
  };

  // 3. Run agent — no prior messages, just the user instruction
  const messages = await getRecentMessages(thread.id);
  const output = await runAgent({ thread: context, messages });

  // 4. Store agent response
  await appendMessage(thread.id, "agent", output.raw);

  // 5. Print
  console.log("OK");
  console.log(output.formatted);
}

async function handleContinueThread(input: ContinueThreadInput) {
  const thread = await getThread(input.threadId);
  if (!thread) {
    console.error(`✗ Thread not found: ${input.threadId}`);
    process.exit(1);
  }

  // 1. Store inbound external message
  await appendMessage(thread.id, "external", input.message);

  const context: ThreadContext = {
    threadId: thread.id,
    channel: thread.channel,
    toAddress: thread.toAddress,
    fromAddress: input.from,
  };

  // 2. Run agent with recent thread history
  const messages = await getRecentMessages(thread.id);
  const output = await runAgent({ thread: context, messages });

  // 3. Store agent response
  await appendMessage(thread.id, "agent", output.raw);
  await extractAndStore(input.message, thread.id, thread.channel, input.from);
  

  // 4. Print acknowledgment
  console.log("OK");
  console.log(output.raw);
}

async function handleUserThread(input: CLIInput & { kind: "user_thread" }) {
  const thread = await getThread(input.threadId);
  if (!thread) {
    console.error(`✗ Thread not found: ${input.threadId}`);
    process.exit(1);
  }

  // 1. Store user message
  await appendMessage(thread.id, "user", input.message);

  const context: ThreadContext = {
    threadId: thread.id,
    channel: thread.channel,
    toAddress: thread.toAddress,
  };

  // 2. Run agent with recent thread history
  const messages = await getRecentMessages(thread.id);
  const output = await runAgent({ thread: context, messages });

  // 3. Store agent response
  await appendMessage(thread.id, "agent", output.raw);

  // 4. Print formatted output
  console.log("OK");
  console.log(output.formatted);
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

  if (thread && !from) {
    const existing = await getThread(thread);
    if (!existing) {
      console.error(`✗ Thread not found: ${thread}`);
      process.exit(1);
    }
    await handleUserThread({ kind: "user_thread", threadId: thread, message });
    return;
  }

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
