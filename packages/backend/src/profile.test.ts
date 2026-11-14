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
