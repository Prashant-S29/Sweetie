import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { memories } from "../db/schema";
import { embedText } from "./embeddings";
import type { MemoryFact } from "../types";

// ── Schemas ───────────────────────────────────────────────────────────────────

const FactSchema = z.object({
  content: z
    .string()
    .describe("Human-readable fact, e.g. 'Bob is available Monday 2-4pm'"),
  entities: z.object({
    person: z.string().optional().describe("Person this fact is about"),
    type: z.enum([
      "availability",
      "preference",
      "constraint",
      "contact",
      "other",
    ]),
    value: z.string().optional().describe("The core value of the fact"),
  }),
});

const ExtractionSchema = z.object({
  facts: z
    .array(FactSchema)
    .describe("List of extracted facts. Empty array if nothing worth storing."),
});

// ── ID generation ─────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 9);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

// ── Write path ────────────────────────────────────────────────────────────────
// Called after every inbound external message.
// Failures are logged and swallowed — never block the main response.

export async function extractAndStore(
  message: string,
  threadId: string,
  channel: string,
  fromAddress?: string,
): Promise<void> {
  try {
    // 1. Extract structured facts via Claude
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"), // cheap + fast for extraction
      schema: ExtractionSchema,
      prompt: `Extract scheduling-relevant facts from this message.

      Message: "${message}"
      Sender: ${fromAddress ?? "Unknown sender"}

      Rules:
      - Always include the sender's name/identifier in the fact content
      - Format: "Bob is available Monday 2-4pm" using the sender's name from above
      - Only extract facts useful for future scheduling. Return empty array if none.`,
    });

    if (object.facts.length === 0) return;

    // 2. Embed and store each fact
    await Promise.all(
      object.facts.map(async (fact) => {
        const embedding = await embedText(fact.content);

        await db.insert(memories).values({
          id: generateId("mem"),
          threadId,
          channel,
          content: fact.content,
          embedding,
          entities: fact.entities,
        });
      }),
    );

    console.log(`  ↳ Stored ${object.facts.length} memory fact(s)`);
  } catch (err) {
    // Memory failures must never surface to the user
    console.error(
      "  ↳ Memory extraction failed (non-fatal):",
      (err as Error).message,
    );
  }
}

// ── Read path ─────────────────────────────────────────────────────────────────
// Returns top-K relevant memories for a given query string.

export async function retrieveRelevant(
  query: string,
  limit?: number,
): Promise<MemoryFact[]> {
  const k = limit ?? parseInt(process.env.RETRIEVAL_LIMIT ?? "8");

  try {
    const queryEmbedding = await embedText(query);
    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT
        id,
        content,
        thread_id  AS "threadId",
        channel,
        entities
      FROM memories
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${k}
    `);

    return results as unknown as MemoryFact[];
  } catch (err) {
    console.error(
      "  ↳ Memory retrieval failed (non-fatal):",
      (err as Error).message,
    );
    return [];
  }
}
