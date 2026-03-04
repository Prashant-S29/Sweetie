import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { Message } from "../db/schema";
import type { ThreadContext, MemoryFact } from "../types";
import { BASE_SYSTEM_PROMPT } from "./prompts/system.prompt";
import { getChannel } from "../channels/registry";

// ── Agent input — signature frozen after M4 ───────────────────────────────────
// Memory facts injected here in M6 without changing this signature

export interface AgentInput {
  thread: ThreadContext;
  messages: Message[];
  relevantMemories?: MemoryFact[]; // injected in M6
}

export interface AgentOutput {
  raw: string; // raw text from the model
  formatted: string; // channel-formatted output
}

// ── Core agent loop ───────────────────────────────────────────────────────────

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const { thread, messages, relevantMemories = [] } = input;
  const channel = getChannel(thread.channel);

  // Build system prompt = base + channel addendum + memory context (M6)
  let systemPrompt =
    BASE_SYSTEM_PROMPT + "\n\n" + channel.getSystemPromptAddendum();

  if (relevantMemories.length > 0) {
    const memoryBlock = relevantMemories
      .map((m) => `- ${m.content}`)
      .join("\n");
    systemPrompt += `\n\nRELEVANT CONTEXT FROM OTHER CONVERSATIONS:\n${memoryBlock}\n\nUse this context when relevant. Do not mention that you retrieved it from other threads.`;
  }

  // Convert DB messages to Vercel AI SDK format
  const formattedMessages = messages.map((m) => ({
    role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    system: systemPrompt,
    messages: formattedMessages,
  });

  const formatted = channel.formatOutbound(text, thread);

  return { raw: text, formatted };
}
