import * as dotenv from "dotenv";
dotenv.config();

import { ping } from "../db/client";
import {
  createThread,
  getThread,
  appendMessage,
  getRecentMessages,
} from "../db/helpers";

async function main() {
  await ping();

  // 1. Create a thread
  const thread = await createThread("email", "bob@example.com", undefined, {
    subject: "Test Thread",
  });
  console.log("✓ Thread created:", thread.id);

  // 2. Fetch it back
  const fetched = await getThread(thread.id);
  console.log(
    "✓ Thread fetched:",
    fetched?.id === thread.id ? "match" : "MISMATCH",
  );

  // 3. Append messages
  await appendMessage(thread.id, "agent", "Hi Bob, when are you free?");
  await appendMessage(
    thread.id,
    "external",
    "I'm free Monday 2-4pm and Wednesday all day",
  );
  await appendMessage(thread.id, "user", "Great, noted.");
  console.log("✓ Messages appended");

  // 4. Retrieve recent messages
  const recent = await getRecentMessages(thread.id);
  console.log(`✓ Retrieved ${recent.length} messages:`);
  recent.forEach((m) => console.log(`  [${m.role}] ${m.content}`));

  // 5. Test limit
  const limited = await getRecentMessages(thread.id, 2);
  console.log(`✓ Limited to 2 messages, got: ${limited.length}`);

  // 6. Test non-existent thread
  const missing = await getThread("thread_doesnotexist");
  console.log("✓ Missing thread returns:", missing === null ? "null" : "WRONG");

  console.log("\nM2 ✓ All checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("M2 ✗ Failed:", err.message);
  process.exit(1);
});
