import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, InferredPreferenceRepository, migrateDatabase, type DatabaseContext } from "@news-agent/db";
import type { InferredPreference, PersonalizationProfile, Subscription, User } from "@news-agent/shared";

import { createApp } from "./app.js";

describe("R2 personalization API", () => {
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
  });

  afterEach(() => database.close());

  it("lets the owner review, accept, tune, delete, and pause inferred preferences", async () => {
    const app = await createApp({ db: database.db });
    const created = await app.inject({ method: "POST", url: "/api/users", payload: { displayName: "Reader" } });
    const user = created.json<User>();
    await app.inject({
      method: "PUT",
      url: `/api/users/${user.id}/subscription`,
      payload: {
        topics: ["AI"], keywords: [], excludedKeywords: [], languages: ["zh-CN"], sourceIds: [],
        maxItems: 5, scheduleCron: "0 8 * * *", timezone: "Asia/Shanghai", deliveryChannel: "web", enabled: true,
      },
    });
    const inferred = new InferredPreferenceRepository(database.db).upsertSuggestion(user.id, {
      kind: "topic",
      value: "AI Agent",
      weight: 1,
      confidence: 0.8,
      evidenceIds: ["one", "two"],
      lastReinforcedAt: "2026-09-18T08:00:00.000Z",
      expiresAt: "2099-09-18T08:00:00.000Z",
    });

    const profile = await app.inject({ method: "GET", url: `/api/users/${user.id}/preference-profile` });
    expect(profile.statusCode).toBe(200);
    expect(profile.json<PersonalizationProfile>().inferredPreferences[0]?.status).toBe("suggested");

    const accepted = await app.inject({
      method: "PATCH",
      url: `/api/inferred-preferences/${inferred.id}`,
      payload: { userId: user.id, status: "accepted", weight: 1.25 },
    });
    expect(accepted.json<InferredPreference>()).toMatchObject({ status: "accepted", weight: 1.25 });

    const paused = await app.inject({
      method: "PATCH",
      url: `/api/users/${user.id}/personalization`,
      payload: { enabled: false },
    });
    expect(paused.json<Subscription>().personalizationEnabled).toBe(false);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/inferred-preferences/${inferred.id}`,
      payload: { userId: user.id },
    });
    expect(removed.json()).toEqual({ removed: true });
    await app.close();
  });

  it("does not let another user mutate an inferred preference", async () => {
    const app = await createApp({ db: database.db });
    const owner = (await app.inject({ method: "POST", url: "/api/users", payload: { displayName: "Owner" } })).json<User>();
    const other = (await app.inject({ method: "POST", url: "/api/users", payload: { displayName: "Other" } })).json<User>();
    const inferred = new InferredPreferenceRepository(database.db).upsertSuggestion(owner.id, {
      kind: "source", value: "Official", weight: 1, confidence: 1, evidenceIds: ["one", "two"],
      lastReinforcedAt: "2026-09-18T08:00:00.000Z", expiresAt: "2099-09-18T08:00:00.000Z",
    });
    const response = await app.inject({
      method: "PATCH", url: `/api/inferred-preferences/${inferred.id}`,
      payload: { userId: other.id, status: "accepted" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
