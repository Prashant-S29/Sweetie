import { embed } from "ai";
import { openai } from "@ai-sdk/openai";

const EMBEDDING_MODEL = openai.embedding("text-embedding-3-small");

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: text,
  });
  return embedding;
}
