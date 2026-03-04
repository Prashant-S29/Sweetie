import { Command } from "commander";
import * as dotenv from "dotenv";
import { ping } from "@db/client";
dotenv.config();

const program = new Command();

program
  .name("scheduler")
  .description("Multi-channel scheduling coordinator")
  .version("1.0.0");

program
  .argument("[message]", "Message to send")
  .option("--channel <channel>", "Channel to use: email | sms")
  .option("--to <address>", "Recipient address")
  .option("--from <address>", "Sender address (for inbound replies)")
  .option("--thread <threadId>", "Thread ID to continue")
  .action(async (message: string | undefined, opts) => {
    await ping();
    console.log("OK");
    console.log("Args:", { message, ...opts });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});