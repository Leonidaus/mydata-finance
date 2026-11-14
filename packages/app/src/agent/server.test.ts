import { describe, expect, it } from "vitest";
import { createServerChat } from "./server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("server chat client", () => {
  it("asks /api/health once whether chat is on, and again after a failed check", async () => {
    let calls = 0;
    let chat = false;
    const client = createServerChat("", async () => (calls++, json({ ok: true, services: { chat } })));
    expect(await client.available()).toBe(false);
    chat = true;
    expect(await client.available()).toBe(true); // the failed check was not remembered
    expect(await client.available()).toBe(true);
    expect(calls).toBe(2);
  });

  it("treats an unreachable backend as no chat", async () => {
    const client = createServerChat("", async () => {
      throw new TypeError("network");
    });
    expect(await client.available()).toBe(false);
  });

  it("posts the question, history and card definitions and returns the reply", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const client = createServerChat("https://api.example", async (url, init) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return json({ text: "You spent {{taxi.value}}.", ops: [], rejected: [], picks: [] });
    });
    const input = { customerId: "CUST00001", question: "taxis?", history: [{ role: "user" as const, text: "hi" }], blocks: [] };
    const out = await client.ask(input);
    expect(out.text).toBe("You spent {{taxi.value}}.");
    expect(seen).toEqual([{ url: "https://api.example/api/chat", body: input }]);
  });

  it("shows the backend's error message, and a plain one when there is none", async () => {
    const input = { customerId: "CUST00001", question: "q", history: [], blocks: [] };
    const busy = createServerChat("", async () => json({ error: "Gemini is busy right now. Try again in a moment." }, 502));
    await expect(busy.ask(input)).rejects.toThrow("Gemini is busy right now");
    const broken = createServerChat("", async () => new Response("<html>", { status: 500 }));
    await expect(broken.ask(input)).rejects.toThrow("status 500");
    const down = createServerChat("", async () => {
      throw new TypeError("network");
    });
    await expect(down.ask(input)).rejects.toThrow("Could not reach the coach");
    const odd = createServerChat("", async () => json({ nothing: true }));
    await expect(odd.ask(input)).rejects.toThrow("could not read");
  });
});
