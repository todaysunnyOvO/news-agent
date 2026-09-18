import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

export type NewsDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseContext {
  db: NewsDatabase;
  close: () => void;
}

export function createDatabase(filename: string): DatabaseContext {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const sqlite = new BetterSqlite3(filename);
  sqlite.pragma("foreign_keys = ON");

  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}

export function migrateDatabase(db: NewsDatabase): void {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  migrate(db, { migrationsFolder });
}

