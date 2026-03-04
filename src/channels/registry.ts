import type { Channel } from "./base.channel";
import { EmailChannel } from "./email.channel";
import { SmsChannel } from "./sms.channel";
import type { ChannelType } from "../types";

// ── Channel registry ──────────────────────────────────────────────────────────
// To add a new channel: import it, add one entry to this map.
// Zero other files change.

const registry: Record<ChannelType, Channel> = {
  email: new EmailChannel(),
  sms: new SmsChannel(),
};

export function getChannel(type: ChannelType): Channel {
  const channel = registry[type];
  if (!channel) {
    throw new Error(
      `Unknown channel: ${type}. Register it in src/channels/registry.ts`,
    );
  }
  return channel;
}
