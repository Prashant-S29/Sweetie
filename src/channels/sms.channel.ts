import type { Channel } from "./base.channel";
import type { ThreadContext } from "../types";

export class SmsChannel implements Channel {
  readonly name = "sms";

  formatOutbound(content: string, context: ThreadContext): string {
    // Strip any subject lines — SMS has no subject
    const lines = content.trim().split("\n");
    const body = lines
      .filter((l) => !l.match(/^Subject:/i))
      .join("\n")
      .trim();

    return [
      `Channel  : sms`,
      `To       : ${context.toAddress}`,
      `Thread ID: ${context.threadId}`,
      ``,
      body,
    ].join("\n");
  }

  getSystemPromptAddendum(): string {
    return `
You are communicating via SMS TEXT MESSAGE.
- Be concise — aim for under 160 characters when possible
- Use casual, conversational tone
- No subject lines, no formal sign-offs
- Use plain text only, no markdown, no bullet formatting
- Get straight to the point
`.trim();
  }
}