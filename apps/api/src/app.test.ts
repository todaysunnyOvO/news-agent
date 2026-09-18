import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, migrateDatabase, type DatabaseContext } from "@news-agent/db";
import type { Subscription, User } from "@news-agent/shared";

import { createApp } from "./app.js";

describe("user and subscription API", () => {
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates and reads a user", async () => {
    const app = await createApp({ db: database.db });
    const created = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: { displayName: "Ada" },
    });

    expect(created.statusCode).toBe(201);
    const user = created.json<User>();
    expect(user.displayName).toBe("Ada");

    const fetched = await app.inject({ method: "GET", url: `/api/users/${user.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<User>()).toEqual(user);
    await app.close();
  });

  it("creates and updates a subscription", async () => {
    const app = await createApp({ db: database.db });
    const createdUser = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: { displayName: "Grace" },
    });
    const user = createdUser.json<User>();
    const basePayload = {
      topics: ["AI Agent"],
      keywords: ["Pi"],
      excludedKeywords: [],
      languages: ["zh-CN", "en"],
      sourceIds: [],
      maxItems: 5,
      scheduleCron: "0 8 * * *",
      timezone: "Asia/Shanghai",
      deliveryChannel: "web",
      enabled: true,
    };

    const created = await app.inject({
      method: "PUT",
      url: `/api/users/${user.id}/subscription`,
      payload: basePayload,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json<Subscription>().maxItems).toBe(5);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/users/${user.id}/subscription`,
      payload: { ...basePayload, maxItems: 8 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<Subscription>().maxItems).toBe(8);

    const fetched = await app.inject({
      method: "GET",
      url: `/api/users/${user.id}/subscription`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<Subscription>().topics).toEqual(["AI Agent"]);
    await app.close();
  });

  it("rejects invalid subscription input", async () => {
    const app = await createApp({ db: database.db });
    const createdUser = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: { displayName: "Lin" },
    });
    const user = createdUser.json<User>();

    const response = await app.inject({
      method: "PUT",
      url: `/api/users/${user.id}/subscription`,
      payload: { maxItems: 0 },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

