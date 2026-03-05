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
import type { ContinueThreadInput, ChannelType, ThreadContext } from "./types";

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer(): () => number {
  const start = Date.now();
  return () => {
    const ms = Date.now() - start;
    console.log(
      `\n⏱  Completed in ${ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`}`,
    );
    return ms;
  };
}

// ── Session ID ────────────────────────────────────────────────────────────────

export function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateChannel(value: string): ChannelType {
  if (value !== "email" && value !== "sms")
    throw new InvalidArgumentError(
      `Channel must be 'email' or 'sms', got '${value}'`,
    );
  return value;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleNewThread(
  channel: ChannelType,
  to: string,
  message: string,
  sessionId: string,
): Promise<{ output: string; threadId: string }> {
  const thread = await createThread(channel, to);
  await appendMessage(thread.id, "user", message);

  const context: ThreadContext = {
    threadId: thread.id,
    channel,
    toAddress: to,
    sessionId,
  };
  const messages = await getRecentMessages(thread.id);
  const output = await runAgent({ thread: context, messages });
  await appendMessage(thread.id, "agent", output.raw);

  console.log("OK");
  console.log(output.formatted);
  return { output: output.formatted, threadId: thread.id };
}

async function handleContinueThread(
  input: ContinueThreadInput,
  sessionId: string,
): Promise<{ output: string; threadId: string }> {
  const thread = await getThread(input.threadId);
  if (!thread) {
    console.error(`✗ Thread not found: ${input.threadId}`);
    process.exit(1);
  }

  await appendMessage(thread.id, "external", input.message);

  const context: ThreadContext = {
    threadId: thread.id,
    channel: thread.channel,
    toAddress: thread.toAddress,
    fromAddress: input.from,
    sessionId,
  };

  const messages = await getRecentMessages(thread.id);
  const output = await runAgent({ thread: context, messages });
  await appendMessage(thread.id, "agent", output.raw);

  // Fire-and-forget — scoped to session
  extractAndStore(
    input.message,
    thread.id,
    thread.channel,
    sessionId,
    input.from,
  ).catch((err) =>
    console.error("  ↳ Memory store failed (non-fatal):", err.message),
  );

  console.log("OK");
  console.log(output.raw);
  return { output: output.raw, threadId: thread.id };
}

async function handleUserThread(
  threadId: string,
  message: string,
  sessionId: string,
): Promise<{ output: string; threadId: string }> {
  const thread = await getThread(threadId);
  if (!thread) {
    console.error(`✗ Thread not found: ${threadId}`);
    process.exit(1);
  }

  await appendMessage(thread.id, "user", message);

  const context: ThreadContext = {
    threadId: thread.id,
    channel: thread.channel,
    toAddress: thread.toAddress,
    sessionId,
  };

  const messages = await getRecentMessages(thread.id);
  const output = await runAgent({ thread: context, messages });
  await appendMessage(thread.id, "agent", output.raw);

  console.log("OK");
  console.log(output.formatted);
  return { output: output.formatted, threadId: thread.id };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

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
  .option(
    "--session <sessionId>",
    "Session ID for memory scoping (auto-generated if omitted)",
  )
  .action(async (message: string | undefined, opts) => {
    const stop = startTimer();

    if (!message?.trim()) {
      console.error("✗ Message is required");
      process.exit(1);
    }

    await ping();

    const sessionId = opts.session ?? generateSessionId();
    const { channel, to, from, thread } = opts;
    const msg = message.trim();

    let result: { output: string; threadId?: string; channel?: string };

    if (thread && from) {
      const existing = await getThread(thread);
      if (!existing) {
        console.error(`✗ Thread not found: ${thread}`);
        process.exit(1);
      }
      result = {
        ...(await handleContinueThread(
          { kind: "continue_thread", threadId: thread, from, message: msg },
          sessionId,
        )),
        channel: existing.channel,
      };
    } else if (thread) {
      const existing = await getThread(thread);
      if (!existing) {
        console.error(`✗ Thread not found: ${thread}`);
        process.exit(1);
      }
      result = {
        ...(await handleUserThread(thread, msg, sessionId)),
        channel: existing.channel,
      };
    } else if (channel && to) {
      result = {
        ...(await handleNewThread(
          validateChannel(channel),
          to.trim(),
          msg,
          sessionId,
        )),
        channel,
      };
    } else {
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

    stop();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("✗ Error:", err.message);
  process.exit(1);
});
