import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
dotenv.config();

if (!process.env.DIRECT_URL) {
  throw new Error("DIRECT_URL is required for migrations");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL,
  },
  verbose: true,
  strict: true,
});