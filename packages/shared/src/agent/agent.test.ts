import { describe, expect, it } from "vitest";
import type { Block } from "../blocks";
import { type ChatModel, type ChatModelRequest, runChat } from "./chat";
import { fillPlaceholders, placeholderBlockIds } from "./placeholders";
import { buildSystemPrompt } from "./prompt";
import type { ToolCall } from "./tools";
import { parseToolCalls } from "./validate";

const existing: Block = {
  id: "safe-week",
  title: "Safe to spend",
  explanation: "x",
  source: "estimate",
  data: { kind: "engine", fn: "safeToSpend", args: { horizon: "week" } },
  view: { kind: "template", template: "stat" },
};

const add = (over: Record<string, unknown> = {}): ToolCall => ({
  name: "add_block",
  args: {
    id: "food-trend",
    title: "Groceries per month",
    explanation: "Monthly grocery spending.",
    source: "own",
    fn: "monthlyTrend",
    args: { metric: "spending", category: "Groceries", months: 12 },
    view_kind: "template",
    template: "trend_line",
    ...over,
  },
});

describe("parseToolCalls", () => {
  it("turns valid calls into ops and the reply", () => {
    const r = parseToolCalls([add(), { name: "reply", args: { text: "Here: {{food-trend.value}}" } }], [existing]);
    expect(r.errors).toEqual([]);
    expect(r.text).toBe("Here: {{food-trend.value}}");
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ op: "add_block", block: { id: "food-trend", data: { fn: "monthlyTrend" } } });
  });

  it("rejects unknown functions, bad arguments and mismatched templates", () => {
    const r = parseToolCalls(
      [add({ fn: "stealData" }), add({ args: { months: 99 } }), add({ template: "stat" }), add({ id: "Bad Id" })],
      [],
    );
    expect(r.ops).toEqual([]);
    expect(r.errors).toHaveLength(4);
    expect(r.errors[1]).toMatch(/months must be a number from 2 to 24/);
    expect(r.errors[2]).toMatch(/template stat draws safeToSpend or safeToSave/);
  });

  it("parses Vega-Lite specs given as JSON strings and checks code widgets", () => {
    const spec = add({ view_kind: "spec", spec: JSON.stringify({ mark: "bar" }), template: undefined });
    const badCode = add({ id: "w", view_kind: "code", code: "<div>no data</div>" });
    const r = parseToolCalls([spec, badCode], []);
    expect(r.ops[0]).toMatchObject({ block: { view: { kind: "spec", spec: { mark: "bar" } } } });
    expect(r.errors[0]).toMatch(/mydata.onData/);
  });

  it("checks controls against the function's arguments", () => {
    const r = parseToolCalls([add({ controls: [{ kind: "period", arg: "period" }] })], []);
    expect(r.errors[0]).toMatch(/control arg must be an argument of monthlyTrend/);
  });

  it("merges update args and refuses unknown ids", () => {
    const r = parseToolCalls(
      [
        { name: "update_block", args: { id: "safe-week", args: { horizon: "until_payday" } } },
        { name: "remove_block", args: { id: "nope" } },
      ],
      [existing],
    );
    expect(r.ops).toEqual([
      { op: "update_block", id: "safe-week", patch: { data: { kind: "engine", fn: "safeToSpend", args: { horizon: "until_payday" } } } },
    ]);
    expect(r.errors[0]).toMatch(/no card with id nope/);
  });
});

describe("placeholders", () => {
  it("finds and fills block references", () => {
    const text = "Spend {{safe-week.value}} ({{safe-week.caption}}), not {{gone.value}}.";
    expect(placeholderBlockIds(text)).toEqual(["safe-week", "gone"]);
    expect(fillPlaceholders(text, (id, f) => (id === "safe-week" ? (f === "value" ? "€312" : "until payday") : undefined))).toBe(
      "Spend €312 (until payday), not —.",
    );
  });
});

describe("runChat", () => {
  function scripted(...answers: ToolCall[][]): ChatModel & { requests: ChatModelRequest[] } {
    const requests: ChatModelRequest[] = [];
    return {
      requests,
      async generate(req) {
        requests.push(structuredClone(req));
        return { calls: answers[requests.length - 1] ?? [], raw: { n: requests.length } };
      },
    };
  }
  const input = { question: "How much on groceries?", history: [], blocks: [existing], today: "2026-09-15" };

  it("returns ops and text after one call when everything is valid", async () => {
    const model = scripted([add(), { name: "reply", args: { text: "{{food-trend.value}} a month." } }]);
    const out = await runChat(model, input);
    expect(model.requests).toHaveLength(1);
    expect(out).toMatchObject({ text: "{{food-trend.value}} a month.", rejected: [] });
    expect(out.ops).toHaveLength(1);
  });

  it("retries once with the errors and uses the corrected answer", async () => {
    const model = scripted([add({ fn: "nope" })], [add(), { name: "reply", args: { text: "Fixed." } }]);
    const out = await runChat(model, input);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1].turns.at(-1)?.text).toMatch(/rejected:[\s\S]*fn must be one of/);
    expect(model.requests[1].turns.at(-2)).toMatchObject({ role: "model", raw: { n: 1 } });
    expect(out).toMatchObject({ text: "Fixed.", rejected: [] });
  });

  it("sends block definitions to the model, never results", () => {
    const prompt = buildSystemPrompt([existing], "2026-09-15");
    expect(prompt).toContain('id safe-week: "Safe to spend" = safeToSpend({"horizon":"week"})');
    expect(prompt).not.toMatch(/customer_id|CUST\d/);
  });
});
