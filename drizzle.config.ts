import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig } from "drizzle-kit";

// Same default as the server, so a fresh checkout has somewhere to put it.
const dbPath = process.env.DB_PATH ?? "data/app.db";
mkdirSync(dirname(dbPath), { recursive: true });

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: dbPath },
});
