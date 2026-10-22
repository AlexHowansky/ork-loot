import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";
import { logger } from "../lib/logger.ts";

export type Db = BunSQLiteDatabase<typeof schema>;

const MIGRATIONS = join(import.meta.dir, "../../../drizzle");

/** Opens (creating if needed) and migrates the database at `path`. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") sqlite.run("PRAGMA journal_mode = WAL");
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  logger.debug("database ready", { path });
  return db;
}

/** A transaction handle; most query helpers accept either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
