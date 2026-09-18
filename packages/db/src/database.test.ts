import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createDatabase, migrateDatabase } from "./database.js";
import { users } from "./schema.js";

describe("database migrations", () => {
  it("can apply the migration set repeatedly", () => {
    const database = createDatabase(":memory:");

    migrateDatabase(database.db);
    migrateDatabase(database.db);

    const rows = database.db.select().from(users).all();
    expect(rows).toEqual([]);
    database.close();
  });

  it("upgrades a Phase 1 articles table with the source ID column", () => {
    const database = createDatabase(":memory:");
    database.db.run(sql.raw(`CREATE TABLE articles (
      id text PRIMARY KEY NOT NULL,
      provider text NOT NULL,
      source_name text NOT NULL,
      title text NOT NULL,
      canonical_url text NOT NULL,
      language text NOT NULL,
      published_at text NOT NULL,
      retrieved_at text NOT NULL
    )`));

    migrateDatabase(database.db);

    const columns = database.db.all<{ name: string }>(sql.raw("PRAGMA table_info(articles)"));
    expect(columns.some((column) => column.name === "source_id")).toBe(true);
    database.close();
  });
});
