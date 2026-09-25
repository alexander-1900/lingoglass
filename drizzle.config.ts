import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:lingoglass.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
});
