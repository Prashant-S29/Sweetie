import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
  vector,
  index,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const channelEnum = pgEnum("channel", ["email", "sms"]);
export const roleEnum = pgEnum("role", ["user", "agent", "external"]);

// ── Threads ──────────────────────────────────────────────────────────────────

export const threads = pgTable("threads", {
  id: text("id").primaryKey(),
  channel: channelEnum("channel").notNull(),
  toAddress: text("to_address").notNull(),
  fromAddress: text("from_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  meta: jsonb("meta").$type<Record<string, string>>().default({}),
});

// ── Messages ─────────────────────────────────────────────────────────────────

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Memories ─────────────────────────────────────────────────────────────────

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    entities: jsonb("entities")
      .$type<{
        person?: string;
        type?: string;
        value?: string;
        [key: string]: string | undefined;
      }>()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("memories_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;