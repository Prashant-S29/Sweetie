// ── Channel Types ─────────────────────────────────────────────────────────────

export type ChannelType = "email" | "sms";

export type RoleType = "user" | "agent" | "external";

// ── Thread Context passed to agent ───────────────────────────────────────────

export interface ThreadContext {
  sessionId: string;
  threadId: string;
  channel: ChannelType;
  toAddress: string;
  fromAddress?: string;
  meta?: Record<string, string>;
}

// ── Parsed CLI input ──────────────────────────────────────────────────────────

export interface NewThreadInput {
  kind: "new_thread";
  channel: ChannelType;
  to: string;
  message: string;
}

export interface ContinueThreadInput {
  kind: "continue_thread";
  threadId: string;
  from: string;
  message: string;
}

export interface UserThreadInput {
  kind: "user_thread";
  threadId: string;
  message: string;
}

export type CLIInput = NewThreadInput | ContinueThreadInput | UserThreadInput;

// ── Memory fact ───────────────────────────────────────────────────────────────

export interface MemoryFact {
  id: string;
  sessionId: string;
  content: string;
  threadId: string;
  channel: string;
  entities: {
    person?: string;
    type?: string;
    value?: string;
    [key: string]: string | undefined;
  };
}
