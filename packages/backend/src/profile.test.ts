import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { MemoryProfileStore, SqliteProfileStore } from "./profiles";
import { createApp } from "./app";
import { createFixtureDb } from "./testing/fixture";

describe.each([
  ["memory", () => new MemoryProfileStore()],
  ["sqlite", () => new SqliteProfileStore(join(mkdtempSync(join(tmpdir(), "mydata-profiles-")), "profiles.sqlite"))],
])("%s profile store", (_name, make) => {
  it("updates additively and isolates customers", () => {
    const store = make();
    const saved = store.update("CUST00001", { protect: { add: ["Travel"] } }, "2026-11-14T00:00:00.000Z");
    assert.deepEqual(saved.protectedCategories, ["Travel"]);
    assert.deepEqual(store.update("CUST00001", { style: "direct" }, "2026-11-14T00:01:00.000Z").protectedCategories, ["Travel"]);
    assert.equal(store.get("CUST00002"), null);
    if (store instanceof SqliteProfileStore) store.close();
  });
});

describe("profile API", () => {
  it("only removes categories through protect.remove", async () => {
    const app = createApp(createFixtureDb(), { profiles: new MemoryProfileStore() });
    const patch = async (body: unknown) =>
      app.request("/api/customers/CUST00001/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let response = await app.request("/api/customers/CUST00001/profile");
    assert.deepEqual(await response.json(), { profile: { version: 1, style: "encouraging", protectedCategories: [], updatedAt: null }, isDefault: true });
    response = await patch({ protect: { add: ["Travel"] } });
    assert.equal(response.status, 200);
    response = await patch({ style: "direct" });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { profile: { protectedCategories: string[] } }).profile.protectedCategories, ["Travel"]);
    response = await patch({ protectedCategories: [] });
    assert.equal(response.status, 400);
    response = await patch({ protect: { remove: ["Travel"] } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { profile: { protectedCategories: string[] } }).profile.protectedCategories, []);
  });
});

describe("preferences changed from the chat", () => {
  /** A model that asks to take Restaurants off the keep-as-is list, then says `reply`. */
  function model(reply: string) {
    let calls = 0;
    return {
      async generate() {
        calls++;
        return { calls: calls === 1 ? [{ name: "update_preferences", args: { keep_remove: ["Restaurants"] } }] : [{ name: "reply", args: { text: reply } }] };
      },
    };
  }
  const chat = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.request("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  type Answer = { text: string; proposedUnprotect: string[]; profile?: { protectedCategories: string[] } };

  it("asks first, saves the change after the yes, and the settings show it", async () => {
    const profiles = new MemoryProfileStore();
    profiles.update("CUST00001", { protect: { add: ["Restaurants", "Travel"] } });

    // The user is willing to cut restaurants: nothing is saved, and the answer says what was asked about.
    let app = createApp(createFixtureDb(), { profiles, chatModel: model("Restaurants is on your keep-as-is list. Shall I take it off?") });
    let answer = (await (await chat(app, { customerId: "CUST00001", question: "I could spend less on restaurants." })).json()) as Answer;
    assert.deepEqual(answer.proposedUnprotect, ["Restaurants"]);
    assert.equal(answer.profile, undefined);
    assert.deepEqual(profiles.get("CUST00001")?.protectedCategories, ["Restaurants", "Travel"]);

    // The yes arrives with the question it answers.
    app = createApp(createFixtureDb(), { profiles, chatModel: model("Done.") });
    answer = (await (await chat(app, { customerId: "CUST00001", question: "Yes, take it off.", pendingUnprotect: ["Restaurants"] })).json()) as Answer;
    assert.deepEqual(answer.proposedUnprotect, []);
    assert.deepEqual(answer.profile?.protectedCategories, ["Travel"]);
    const shown = (await (await app.request("/api/customers/CUST00001/profile")).json()) as { profile: { protectedCategories: string[] } };
    assert.deepEqual(shown.profile.protectedCategories, ["Travel"]);
    // Another customer's preferences are untouched.
    assert.equal(profiles.get("CUST00002"), null);
  });

  it("rejects a pending list that is not a list of categories", async () => {
    const app = createApp(createFixtureDb(), { profiles: new MemoryProfileStore(), chatModel: model("x") });
    assert.equal((await chat(app, { customerId: "CUST00001", question: "Yes", pendingUnprotect: ["Holidays"] })).status, 400);
  });
});
