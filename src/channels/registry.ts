import type { Channel } from "./base.channel";
import { EmailChannel } from "./email.channel";
import type { ChannelType } from "../types";

// ── Channel registry ──────────────────────────────────────────────────────────
// To add a new channel: import it and add one entry to this map.
// No other files need to change.

const registry: Record<ChannelType, Channel> = {
  email: new EmailChannel(),
  sms: new EmailChannel(), // placeholder until M7 when SmsChannel is built
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
