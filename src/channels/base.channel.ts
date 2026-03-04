import type { ThreadContext } from "../types";

// ── Channel interface — frozen after M4 ──────────────────────────────────────
// Adding a new channel = create a new file implementing this interface
// + one line in the channel router. Nothing else changes.

export interface Channel {
  readonly name: string;
  formatOutbound(content: string, context: ThreadContext): string;
  getSystemPromptAddendum(): string;
}
