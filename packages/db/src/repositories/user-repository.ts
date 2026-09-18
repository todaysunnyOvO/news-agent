import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { CreateUserInput, User } from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import { users } from "../schema.js";

export class UserRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public create(input: CreateUserInput): User {
    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      displayName: input.displayName.trim(),
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(users).values(user).run();
    return user;
  }

  public findById(id: string): User | undefined {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }
}

