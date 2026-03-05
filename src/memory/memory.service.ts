import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { sql, ilike, or, eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { memories } from "../db/schema";
import { embedText } from "./embeddings";
import type { MemoryFact } from "../types";

const MAX_EMBED_CHARS = 8000;

const ExtractionSchema = z.object({
  facts: z.array(
    z.object({
      content: z.string(),
      entities: z.object({
        person: z.string().optional(),
        type: z.enum([
          "availability",
          "preference",
          "constraint",
          "contact",
          "other",
        ]),
        value: z.string().optional(),
      }),
    }),
  ),
});

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 9);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

// ── Write path ────────────────────────────────────────────────────────────────
// sessionId is required — every fact is scoped to one scheduling task.

export async function extractAndStore(
  message: string,
  threadId: string,
  channel: string,
  sessionId: string, // ← required
  fromAddress?: string,
): Promise<void> {
  try {
    const safeMessage =
      message.length > MAX_EMBED_CHARS
        ? message.slice(0, MAX_EMBED_CHARS) + "\n[truncated]"
        : message;

    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: ExtractionSchema,
      prompt: `Extract scheduling-relevant facts from this message.

Message: "${safeMessage}"
Sender: ${fromAddress ?? "Unknown sender"}

Rules:
- Always include the sender identifier in the fact: "bob@company.com is available Monday 2-4pm"
- Only extract facts useful for future scheduling. Return empty array if none.`,
    });

    if (object.facts.length === 0) return;

    await Promise.all(
      object.facts.map(async (fact) => {
        const embedding = await embedText(fact.content);
        await db.insert(memories).values({
          id: generateId("mem"),
          sessionId, // ← scoped to this task
          threadId,
          channel,
          content: fact.content,
          embedding,
          entities: fact.entities,
        });
      }),
    );

    console.log(
      `  ↳ Stored ${object.facts.length} memory fact(s) [session: ${sessionId}]`,
    );
  } catch (err) {
    console.error(
      "  ↳ Memory extraction failed (non-fatal):",
      (err as Error).message,
    );
  }
}

// ── Read path ─────────────────────────────────────────────────────────────────
// Always scoped to sessionId — facts from other tasks never surface here.

export async function retrieveRelevant(
  query: string,
  sessionId: string, // ← required
  limit?: number,
): Promise<MemoryFact[]> {
  const k = limit ?? parseInt(process.env.RETRIEVAL_LIMIT ?? "8");

  try {
    const queryEmbedding = await embedText(query);
    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT
        id,
        session_id  AS "sessionId",
        content,
        thread_id   AS "threadId",
        channel,
        entities
      FROM memories
      WHERE session_id = ${sessionId}
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${k}
    `);

    return results as unknown as MemoryFact[];
  } catch (vectorErr) {
    console.error(
      "  ↳ Vector search failed, falling back to keyword search:",
      (vectorErr as Error).message,
    );

    try {
      const words = query.split(/\s+/).filter((w) => w.length > 3);
      if (words.length === 0) return [];

      const conditions = words.map((w) => ilike(memories.content, `%${w}%`));
      const rows = await db
        .select({
          id: memories.id,
          sessionId: memories.sessionId,
          content: memories.content,
          threadId: memories.threadId,
          channel: memories.channel,
          entities: memories.entities,
        })
        .from(memories)
        .where(and(eq(memories.sessionId, sessionId), or(...conditions)))
        .limit(k);

      return rows as MemoryFact[];
    } catch (fallbackErr) {
      console.error(
        "  ↳ Keyword fallback failed (non-fatal):",
        (fallbackErr as Error).message,
      );
      return [];
    }
  }
}
