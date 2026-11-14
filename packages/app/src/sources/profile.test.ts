import { describe, expect, it } from "vitest";
import { createProfileClient } from "./profile";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const response = { profile: { version: 1, style: "encouraging", protectedCategories: [], updatedAt: null }, isDefault: true };

describe("profile client", () => {
  it("uses the customer profile URL for reads and patches", async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    const client = createProfileClient("https://api.example", async (url, init) => {
      seen.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      return json(response);
    });
    await client.get("CUST00001");
    await client.update("CUST00002", { protect: { add: ["Travel"] } });
    expect(seen).toEqual([
      { url: "https://api.example/api/customers/CUST00001/profile", method: undefined, body: undefined },
      { url: "https://api.example/api/customers/CUST00002/profile", method: "PATCH", body: '{"protect":{"add":["Travel"]}}' },
    ]);
  });
});
