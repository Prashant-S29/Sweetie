import { eq, desc } from "drizzle-orm";
import { db } from "./client";
import { threads, messages } from "./schema";
import type { Thread, Message, NewThread, NewMessage } from "./schema";
import type { ChannelType } from "../types";

// ── ID generation ─────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 9);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

// ── Thread helpers ────────────────────────────────────────────────────────────

export async function createThread(
  channel: ChannelType,
  toAddress: string,
  fromAddress?: string,
  meta?: Record<string, string>,
): Promise<Thread> {
  const newThread: NewThread = {
    id: generateId("thread"),
    channel,
    toAddress,
    fromAddress,
    meta: meta ?? {},
  };

  const [created] = await db.insert(threads).values(newThread).returning();
  return created;
}

export async function getThread(threadId: string): Promise<Thread | null> {
  const result = await db
    .select()
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);

  return result[0] ?? null;
}

// ── Message helpers ───────────────────────────────────────────────────────────

export async function appendMessage(
  threadId: string,
  role: "user" | "agent" | "external",
  content: string,
): Promise<Message> {
  const newMessage: NewMessage = {
    id: generateId("msg"),
    threadId,
    role,
    content,
  };

  const [created] = await db.insert(messages).values(newMessage).returning();
  return created;
}

export async function getRecentMessages(
  threadId: string,
  limit?: number,
): Promise<Message[]> {
  const maxMessages =
    limit ?? parseInt(process.env.MAX_THREAD_MESSAGES ?? "20");

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.createdAt))
    .limit(maxMessages);

  // Return in chronological order
  return rows.reverse();
}
