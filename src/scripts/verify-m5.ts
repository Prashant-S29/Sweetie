import * as dotenv from "dotenv";
dotenv.config();

import { ping } from "../db/client";
import { extractAndStore, retrieveRelevant } from "../memory/memory.service";
import { db } from "../db/client";
import { memories } from "../db/schema";
import { createThread } from "../db/helpers";

async function main() {
  await ping();

  // Create a dummy thread to attach memories to
  const thread = await createThread("email", "bob@example.com");
  console.log("✓ Test thread:", thread.id);

  // 1. Extract and store
  console.log("\n→ Extracting facts from Bob's message...");
  await extractAndStore(
    "I'm free Monday 2-4pm and Wednesday all day",
    thread.id,
    "email",
  );

  // 2. Extract from a second message
  console.log("→ Extracting facts from Sarah's message...");
  const thread2 = await createThread("sms", "sarah@example.com");
  await extractAndStore(
    "Tuesday or Wednesday afternoon works for me",
    thread2.id,
    "sms",
  );

  // 3. Verify rows exist
  const allMemories = await db.select().from(memories);
  console.log(`\n✓ Total memories stored: ${allMemories.length}`);
  allMemories.forEach((m) => {
    console.log(`  [${m.channel}] ${m.content}`);
    console.log(`    entities: ${JSON.stringify(m.entities)}`);
    console.log(`    has embedding: ${m.embedding !== null}`);
  });

  // 4. Retrieve relevant
  console.log(
    "\n→ Retrieving memories relevant to 'schedule Bob and Sarah'...",
  );
  const relevant = await retrieveRelevant("schedule Bob and Sarah", 5);
  console.log(`✓ Retrieved ${relevant.length} relevant memories:`);
  relevant.forEach((m) => console.log(`  - ${m.content}`));

  console.log("\nM5 ✓ All checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("M5 ✗ Failed:", err.message);
  process.exit(1);
});
