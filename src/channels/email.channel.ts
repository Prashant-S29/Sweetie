import type { Channel } from "./base.channel";
import type { ThreadContext } from "../types";

export class EmailChannel implements Channel {
  readonly name = "email";

  formatOutbound(content: string, context: ThreadContext): string {
    const lines = content.trim().split("\n");

    // Extract subject if agent included one (Subject: ... on first line)
    let subject = context.meta?.subject ?? "Following Up";
    let body = content.trim();

    const subjectMatch = lines[0].match(/^Subject:\s*(.+)$/i);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      body = lines.slice(1).join("\n").trim();
    }

    return [
      `Channel  : email`,
      `To       : ${context.toAddress}`,
      `Thread ID: ${context.threadId}`,
      ``,
      `Subject: ${subject}`,
      ``,
      body,
    ].join("\n");
  }

  getSystemPromptAddendum(): string {
    return `
You are communicating via EMAIL.
- Use formal, professional tone
- Always include a Subject line as the first line of your message in the format: "Subject: <subject>"
- Use proper paragraphs and full sentences
- Sign off appropriately
- Keep responses focused and concise but complete
`.trim();
  }
}
