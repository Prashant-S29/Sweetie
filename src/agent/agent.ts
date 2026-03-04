import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Message } from "../db/schema";
import type { ThreadContext } from "../types";
import { BASE_SYSTEM_PROMPT } from "./prompts/system.prompt";
import { getChannel } from "../channels/registry";
import { retrieveRelevant } from "../memory/memory.service";

// ── Agent input — signature frozen after M4 ───────────────────────────────────

export interface AgentInput {
  thread: ThreadContext;
  messages: Message[];
}

export interface AgentOutput {
  raw: string;
  formatted: string;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const retrieveMemoryTool = tool({
  description:
    "Retrieve relevant facts from previous conversations across all threads and channels. " +
    "Call this BEFORE scheduling, finding overlaps, or referencing anyone's availability. " +
    "Also call this when asked to coordinate between multiple people.",
  parameters: z.object({
    query: z
      .string()
      .describe(
        "What you are looking for, e.g. 'Bob availability' or 'Sarah preferences'",
      ),
    limit: z
      .number()
      .optional()
      .describe("Max number of facts to retrieve (default 8)"),
  }),
  execute: async ({ query, limit }) => {
    const facts = await retrieveRelevant(query, limit);
    if (facts.length === 0) {
      return "No relevant context found in previous conversations.";
    }
    return facts
      .map((f) => `[${f.channel} thread ${f.threadId}] ${f.content}`)
      .join("\n");
  },
});

const findOverlapTool = tool({
  description:
    "Find overlapping available time slots between multiple people. " +
    "Use this after retrieving availability facts to identify when everyone is free.",
  parameters: z.object({
    availabilities: z
      .array(
        z.object({
          person: z.string().describe("Person's name or identifier"),
          slots: z
            .array(z.string())
            .describe(
              "Their available time slots, e.g. ['Monday 2-4pm', 'Wednesday all day']",
            ),
        }),
      )
      .describe("List of people and their available slots"),
  }),
  execute: async ({ availabilities }) => {
    if (availabilities.length === 0) return "No availability data provided.";
    if (availabilities.length === 1)
      return `Only one person's availability provided: ${availabilities[0].person}. Need at least two to find overlap.`;

    // Normalise slot strings for comparison
    const normalise = (s: string) => s.toLowerCase().trim();

    const allSlots = availabilities.map((a) => a.slots.map(normalise));

    // Find slots that appear in ALL availabilities
    const firstPersonSlots = allSlots[0];
    const overlaps = firstPersonSlots.filter((slot) =>
      allSlots
        .slice(1)
        .every((otherSlots) =>
          otherSlots.some(
            (s) =>
              s.includes(slot) || slot.includes(s) || sharesDayKeyword(s, slot),
          ),
        ),
    );

    const summary = availabilities
      .map((a) => `• ${a.person}: ${a.slots.join(", ")}`)
      .join("\n");

    if (overlaps.length === 0) {
      return `No direct overlap found.\n\nAvailabilities:\n${summary}\n\nConflict: No common time slots detected. Consider asking parties for alternative times.`;
    }

    return `Overlapping slots: ${overlaps.join(", ")}\n\nAvailabilities:\n${summary}`;
  },
});

// Simple keyword overlap check for day names
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

// ── Core agent loop ───────────────────────────────────────────────────────────

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const { thread, messages } = input;
  const channel = getChannel(thread.channel);

  const systemPrompt =
    BASE_SYSTEM_PROMPT +
    "\n\n" +
    channel.getSystemPromptAddendum() +
    `\n\n` +
    `IMPORTANT INSTRUCTIONS FOR CONTEXT RETRIEVAL:
- Before scheduling a meeting or proposing times, ALWAYS call retrieveMemory first
- Before mentioning anyone's availability, ALWAYS call retrieveMemory to check what you know
- When asked to coordinate between people, call retrieveMemory for EACH person involved
- After retrieving availability, use findOverlap to identify common slots
- Never claim you don't have information without first calling retrieveMemory`;

  const formattedMessages = messages.map((m) => ({
    role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    system: systemPrompt,
    messages: formattedMessages,
    tools: {
      retrieveMemory: retrieveMemoryTool,
      findOverlap: findOverlapTool,
    },
    maxSteps: 5,
  });

  const formatted = channel.formatOutbound(text, thread);
  return { raw: text, formatted };
}
