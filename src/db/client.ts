import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dotenv from "dotenv";
import * as schema from "./schema";
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// Connection for queries (pooled)
const queryClient = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

// Verify connection
export async function ping(): Promise<void> {
  try {
    await queryClient`SELECT 1`;
    console.log("✓ Database connected");
  } catch (err) {
    console.error("✗ Database connection failed:", err);
    process.exit(1);
  }
}