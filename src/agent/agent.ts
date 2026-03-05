import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Message } from "../db/schema";
import type { ThreadContext } from "../types";
import { BASE_SYSTEM_PROMPT } from "./prompts/system.prompt";
import { getChannel } from "../channels/registry";
import { retrieveRelevant } from "../memory/memory.service";

export interface AgentInput {
  thread: ThreadContext;
  messages: Message[];
}

export interface AgentOutput {
  raw: string;
  formatted: string;
}

// Tools are built per-call, closing over the sessionId so retrieval
// is automatically scoped to the current scheduling task.
function makeTools(sessionId: string) {
  return {
    retrieveMemory: tool({
      description:
        "Retrieve relevant facts from previous conversations in this scheduling session. " +
        "Call this BEFORE scheduling, finding overlaps, or referencing anyone's availability.",
      parameters: z.object({
        query: z
          .string()
          .describe("What you are looking for, e.g. 'Bob availability'"),
        limit: z.number().optional(),
      }),
      execute: async ({ query, limit }) => {
        try {
          const facts = await retrieveRelevant(query, sessionId, limit);
          if (facts.length === 0)
            return "No relevant context found in this session.";
          return facts
            .map((f) => `[${f.channel} thread ${f.threadId}] ${f.content}`)
            .join("\n");
        } catch (err) {
          console.error(
            "  ↳ retrieveMemory error (non-fatal):",
            (err as Error).message,
          );
          return "Memory retrieval temporarily unavailable.";
        }
      },
    }),

    findOverlap: tool({
      description:
        "Find overlapping available time slots between multiple people.",
      parameters: z.object({
        availabilities: z.array(
          z.object({
            person: z.string(),
            slots: z.array(z.string()),
          }),
        ),
      }),
      execute: async ({ availabilities }) => {
        try {
          if (availabilities.length < 2)
            return "Need at least two people's availability to find overlap.";

          const normalise = (s: string) => s.toLowerCase().trim();
          const allSlots = availabilities.map((a) => a.slots.map(normalise));
          const overlaps = allSlots[0].filter((slot) =>
            allSlots
              .slice(1)
              .every((other) =>
                other.some(
                  (s) =>
                    s.includes(slot) ||
                    slot.includes(s) ||
                    sharesDayKeyword(s, slot),
                ),
              ),
          );

          const summary = availabilities
            .map((a) => `• ${a.person}: ${a.slots.join(", ")}`)
            .join("\n");

          return overlaps.length === 0
            ? `No overlap found.\n\n${summary}`
            : `Overlapping slots: ${overlaps.join(", ")}\n\n${summary}`;
        } catch (err) {
          return "Overlap calculation unavailable.";
        }
      },
    }),
  };
}

function sharesDayKeyword(a: string, b: string): boolean {
  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return days.some((day) => a.includes(day) && b.includes(day));
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const { thread, messages } = input;
  const channel = getChannel(thread.channel);

  const systemPrompt =
    BASE_SYSTEM_PROMPT +
    "\n\n" +
    channel.getSystemPromptAddendum() +
    `\n\nCONTEXT RETRIEVAL RULES:
- ALWAYS call retrieveMemory before scheduling or mentioning anyone's availability
- Call retrieveMemory for EACH person when coordinating between multiple people
- Use findOverlap after retrieving availabilities to identify common slots
- Never claim you lack information without calling retrieveMemory first`;

  const formattedMessages = messages.map((m) => ({
    role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
    content:
      m.content.length > 4000
        ? m.content.slice(0, 4000) + "\n[truncated]"
        : m.content,
  }));

  try {
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      system: systemPrompt,
      messages: formattedMessages,
      tools: makeTools(thread.sessionId), // ← session-scoped
      maxSteps: 5,
    });

    return { raw: text, formatted: channel.formatOutbound(text, thread) };
  } catch (err) {
    const error = err as Error;
    if (error.message.includes("API key"))
      throw new Error("✗ Anthropic API key invalid or missing");
    if (error.message.includes("rate limit") || error.message.includes("429"))
      throw new Error("✗ Rate limit hit. Wait a moment and retry.");
    throw new Error(`✗ Agent error: ${error.message}`);
  }
}
