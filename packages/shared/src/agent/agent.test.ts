import { describe, expect, it } from "vitest";
import type { Block } from "../blocks";
import { buildComponent, COMPONENT_IDS } from "../library/components";
import type { EngineResult } from "../engine/types";
import { type ChatModel, type ChatModelRequest, runChat } from "./chat";
import type { Lookup } from "./snapshot";
import { createGeminiModel, DEFAULT_GEMINI_MODELS, parseGeminiModels } from "./gemini";
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

/** Every component builds without arguments, except a plan and its review, which need the user's figures. */
const exampleArgs = (component: string): Record<string, unknown> =>
  component === "goal_plan" ? { target: 25000 } : component === "goal_review" ? { target: 25000, monthly: 400 } : {};

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
    const spec = add({ view_kind: "spec", spec: JSON.stringify({ mark: "bar" }), template: undefined, why_custom: "No bar-per-month component." });
    const badCode = add({ id: "w", view_kind: "code", code: "<div>no data</div>", why_custom: "x" });
    const r = parseToolCalls([spec, badCode], []);
    expect(r.ops[0]).toMatchObject({ block: { view: { kind: "spec", spec: { mark: "bar" } } } });
    expect(r.errors[0]).toMatch(/mydata.onData/);
  });

  it("asks why a custom view was needed", () => {
    const r = parseToolCalls([add({ view_kind: "spec", spec: JSON.stringify({ mark: "bar" }), template: undefined })], []);
    expect(r.ops).toEqual([]);
    expect(r.errors[0]).toMatch(/why_custom/);
  });

  it("builds library components with the factory's view and controls", () => {
    const r = parseToolCalls(
      [{ name: "use_component", args: { id: "taxi", component: "category_bars", args: { period: "last_month", category: "Transportation" }, title: "Taxis" } }],
      [],
    );
    expect(r.errors).toEqual([]);
    const { id: _a, title: _b, ...expected } = buildComponent("category_bars", { period: "last_month", category: "Transportation" });
    expect(r.ops).toEqual([{ op: "add_block", index: 0, block: { ...expected, id: "taxi", title: "Taxis" } }]);
    expect(r.picks).toEqual([{ blockId: "taxi", via: "library", component: "category_bars" }]);
  });

  it("offers the comparison with Finland as a library card with a public-statistics badge", () => {
    const r = parseToolCalls(
      [
        { name: "use_component", args: { id: "food-fi", component: "finland_compare", args: { category: "Groceries", basis: "household" } } },
        { name: "use_component", args: { id: "travel-fi", component: "finland_compare", args: { category: "Travel" } } },
      ],
      [],
    );
    expect(r.ops).toHaveLength(1);
    const block = r.ops[0].op === "add_block" ? r.ops[0].block : null;
    expect(block?.source).toBe("public");
    expect(block?.data).toEqual({ kind: "engine", fn: "nationalCompare", args: { category: "Groceries", basis: "household" } });
    expect(block?.view).toEqual({ kind: "template", template: "peer_compare" });
    expect(r.errors[0]).toMatch(/category must be one of: Housing, Utilities, Groceries, Restaurants, Transportation/);
    expect(buildSystemPrompt([], "2026-09-15")).toMatch(/finland_compare/);
    expect(buildSystemPrompt([], "2026-09-15", { language: "fi" })).toMatch(/app language is Finnish/);
  });

  it("builds a savings plan only from a target the user gave", () => {
    const r = parseToolCalls(
      [
        { name: "use_component", args: { id: "home", component: "goal_plan", args: { saved: 10000 }, reply: "Here is a plan." } },
        { name: "use_component", args: { id: "home", component: "goal_plan", args: { target: 25000, saved: 10000, extra: 100 }, reply: "Here is your plan." } },
        { name: "use_component", args: { id: "cuts", component: "saving_options", args: { protect: ["Travel", "Groceries"], cutPct: 20 }, reply: "Here." } },
        { name: "use_component", args: { id: "cuts2", component: "saving_options", args: { protect: ["Holidays"] }, reply: "Here." } },
      ],
      [],
    );
    expect(r.errors[0]).toMatch(/goal_plan needs target/);
    expect(r.errors[1]).toMatch(/protect must be a list of categories/);
    expect(r.ops.map((op) => (op.op === "add_block" ? op.block.data : null))).toEqual([
      { kind: "engine", fn: "goalPlan", args: { target: 25000, saved: 10000, extra: 100 } },
      { kind: "engine", fn: "savingsOptions", args: { protect: ["Travel", "Groceries"], cutPct: 20 } },
    ]);
  });

  it("rejects unknown components and arguments the component doesn't take", () => {
    const r = parseToolCalls(
      [
        { name: "use_component", args: { id: "a", component: "pie_of_doom" } },
        { name: "use_component", args: { id: "b", component: "weekday_pattern", args: { category: "Groceries" } } },
        { name: "use_component", args: { id: "c", component: "what_if", args: { cutPct: 500 } } },
      ],
      [],
    );
    expect(r.ops).toEqual([]);
    expect(r.errors[0]).toMatch(/component must be one of: .*safe_to_spend/);
    expect(r.errors[1]).toMatch(/weekday_pattern does not take "category". Allowed: period/);
    expect(r.errors[2]).toMatch(/cutPct/);
  });

  it("accepts known widget libraries and rejects others", () => {
    const code = "<script>mydata.onData(function () { gsap.to('#a', { x: 1 }); new THREE.Scene(); })</script>";
    const widget = (libs: unknown) => add({ view_kind: "code", code, why_custom: "x", libs });
    const r = parseToolCalls([widget(["gsap", "three", "gsap", "matter"]), widget(["jquery"]), widget(["gsap"])], []);
    // A library the code never uses is dropped; one it uses without listing is an error.
    expect(r.ops[0]).toMatchObject({ block: { view: { kind: "code", libs: ["gsap", "three"] } } });
    expect(r.errors[0]).toMatch(/libs may only contain: gsap, matter, three/);
    expect(r.errors[1]).toMatch(/code uses three but libs does not list "three"/);
  });

  it("rejects custom views that would come out broken", () => {
    const spec = (value: unknown) => add({ view_kind: "spec", spec: JSON.stringify(value), template: undefined, why_custom: "x" });
    const code = (text: string) => add({ view_kind: "code", code: text, template: undefined, why_custom: "x" });
    const r = parseToolCalls(
      [
        spec({ encoding: { x: { field: "month" } } }),
        spec({ mark: "bar", data: { values: [{ month: "2026-08", amount: 300 }] }, encoding: { x: { field: "month" } } }),
        spec({ mark: "bar", encoding: { x: { field: "month" }, y: { field: "total" } } }),
        code("<script>mydata.onData(function (rows) { draw(rows }</script>"),
        code('<script src="https://cdn.example/chart.js"></script><script>mydata.onData(function () {})</script>'),
        code("<div>mydata.onData</div>"),
        // These are fine: a field made by a transform, and a composition without a top-level mark.
        spec({ transform: [{ calculate: "datum.amount / 2", as: "half" }], mark: "bar", encoding: { x: { field: "month" }, y: { field: "half" } } }),
        spec({ layer: [{ mark: "line", encoding: { x: { field: "month" }, y: { field: "amount" } } }] }),
      ].map((call, n) => ({ ...call, args: { ...call.args, id: `view-${n}` } })),
      [],
    );
    expect(r.errors[0]).toMatch(/no mark/);
    expect(r.errors[1]).toMatch(/must not contain "data"/);
    expect(r.errors[2]).toMatch(/reads "total", but rows of monthlyTrend only have: month, amount/);
    expect(r.errors[3]).toMatch(/does not parse/);
    expect(r.errors[4]).toMatch(/must not load anything/);
    expect(r.errors[5]).toMatch(/needs an inline <script>/);
    expect(r.errors).toHaveLength(6);
    expect(r.ops.map((op) => (op.op === "add_block" ? op.block.id : ""))).toEqual(["view-6", "view-7"]);
  });

  it("reads the coach's mood and suggestions from any answering call", () => {
    const r = parseToolCalls(
      [{ name: "reply", args: { text: "Well done.", mood: "proud", suggestions: ["Show my savings", " ", "Show my savings", "x".repeat(200), "a", "b"] } }],
      [],
    );
    expect(r.mood).toBe("proud");
    expect(r.suggestions).toEqual(["Show my savings", "x".repeat(60), "a"]);
    expect(parseToolCalls([{ name: "reply", args: { text: "Hi.", mood: "furious" } }], [])).toMatchObject({ mood: null, suggestions: [] });
  });

  it("ships library widgets whose scripts parse and only use libraries they declare", () => {
    const globals = { gsap: /\bgsap\./, matter: /\bMatter\./, three: /\bTHREE\./ } as const;
    for (const c of COMPONENT_IDS) {
      const { view } = buildComponent(c, exampleArgs(c));
      if (view.kind !== "code") continue;
      const scripts = [...view.code.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(scripts.length, c).toBeGreaterThan(0);
      for (const js of scripts) expect(() => new Function(js), c).not.toThrow();
      for (const [lib, re] of Object.entries(globals)) expect(re.test(view.code), `${c} ${lib}`).toBe((view.libs ?? []).includes(lib as keyof typeof globals));
    }
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

  it("takes the chat answer from the card call, so one request is a whole answer", async () => {
    const model = scripted([{ name: "use_component", args: { id: "food", component: "category_bars", args: { category: "Groceries" }, reply: "You spent {{food.value}}." } }]);
    const out = await runChat(model, input);
    expect(model.requests).toHaveLength(1);
    expect(out).toMatchObject({ text: "You spent {{food.value}}.", rejected: [] });
    expect(out.ops).toHaveLength(1);
  });

  it("asks only for the sentence when a valid card came without one, and keeps the card", async () => {
    const model = scripted([add()], [{ name: "reply", args: { text: "Here it is: {{food-trend.value}}." } }]);
    const out = await runChat(model, input);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1].tools.map((t) => t.name)).toEqual(["reply"]);
    expect(out.text).toBe("Here it is: {{food-trend.value}}.");
    expect(out.ops).toMatchObject([{ op: "add_block", block: { id: "food-trend" } }]);
  });

  it("shows the model a custom view and names library cards, so follow-ups can edit them", () => {
    const customCard: Block = { ...existing, id: "bars", view: { kind: "spec", spec: { mark: "bar" } } };
    const prompt = buildSystemPrompt([customCard, { ...existing, pinned: true, component: "safe_to_spend" }], "2026-09-15");
    expect(prompt).toContain('custom spec:\n    {"mark":"bar"}, the latest answer');
    expect(prompt).toContain("view library component safe_to_spend, pinned");
  });

  it("sends block definitions to the model, never results", () => {
    const prompt = buildSystemPrompt([existing], "2026-09-15");
    expect(prompt).toContain('id safe-week: "Safe to spend" = safeToSpend({"horizon":"week"})');
    expect(prompt).not.toMatch(/customer_id|CUST\d/);
  });

  it("lists every library component in the prompt, and each builds with defaults", () => {
    const prompt = buildSystemPrompt([], "2026-09-15");
    for (const c of COMPONENT_IDS) {
      expect(prompt).toContain(`- ${c}:`);
      expect(buildComponent(c, exampleArgs(c)).data.kind).toBe("engine");
    }
  });
});

describe("runChat when the model sends one tool call per turn", () => {
  const card: ToolCall = {
    name: "add_block",
    args: { id: "safe-week", title: "Safe to spend", explanation: "Balance minus what is still due.", source: "estimate", fn: "safeToSpend", args: { horizon: "week" }, view_kind: "template", template: "stat" },
  };
  function oneCallPerTurn() {
    const seen: ChatModelRequest[] = [];
    const model: ChatModel = {
      async generate(request) {
        seen.push(request);
        return seen.length === 1 ? { calls: [card] } : { calls: [{ name: "reply", args: { text: "You can safely spend {{safe-week.value}} this week." } }] };
      },
    };
    return { model, seen };
  }
  const input = { question: "What is safe to spend?", history: [], blocks: [], today: "2026-09-15" };

  it("asks for the reply alone and keeps the card", async () => {
    const { model, seen } = oneCallPerTurn();
    const out = await runChat(model, input);
    expect(out.text).toBe("You can safely spend {{safe-week.value}} this week.");
    expect(out.ops).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[1].tools.map((t) => t.name)).toEqual(["reply"]);
    expect(seen[1].turns.at(-1)?.text).toContain("Your answer had no reply. The cards are in place.");
    expect(out.checked).toBe(true);
  });
});

describe("runChat with a fast and a stronger model", () => {
  const results: Record<string, EngineResult> = {
    whatIf: { rows: [{ month: 12, saved: 444 }], value: 444, unit: "€ / year" },
    goalPlan: { rows: [{ scenario: "Your plan", monthly: 200, months: 50, reached: "11/2030" }], value: 10000, unit: "€" },
  };
  const lookup: Lookup = (fn) => {
    const result = results[fn];
    if (!result) throw new Error(`${fn} is not available here`);
    return result;
  };
  type Step = ToolCall[] | Error;
  function scripted(name: string, ...steps: Step[]) {
    const requests: ChatModelRequest[] = [];
    const model: ChatModel = {
      async generate(req) {
        requests.push(structuredClone(req));
        const step = steps[requests.length - 1] ?? [];
        if (step instanceof Error) throw step;
        return { calls: step, raw: { from: name, n: requests.length } };
      },
    };
    return { model, requests };
  }
  const say = (text: string): ToolCall => ({ name: "reply", args: { text } });
  const handOver: ToolCall = { name: "hand_over", args: { why: "a savings goal" } };
  const ask = (fast: ChatModel, strong: ChatModel | undefined, question = "How much on groceries?") =>
    runChat({ fast, strong }, { question, history: [], blocks: [], today: "2026-09-15", lookup });
  const toolNames = (req: ChatModelRequest) => req.tools.map((t) => t.name);

  it("lets the fast model answer a simple question by itself", async () => {
    const fast = scripted("fast", [say("Not much.")]);
    const strong = scripted("strong");
    const out = await ask(fast.model, strong.model);
    expect(toolNames(fast.requests[0])).toContain("hand_over");
    expect(strong.requests).toHaveLength(0);
    expect(out).toMatchObject({ text: "Not much.", answeredBy: "fast", checked: true });
  });

  it("passes the turn to the stronger model when the fast one hands it over", async () => {
    const fast = scripted("fast", [{ name: "lookup", args: { fn: "whatIf", args: { cutPct: 20 } } }], [handOver]);
    const strong = scripted("strong", [{ name: "lookup", args: { fn: "goalPlan", args: { target: 12000 } } }], [say("That takes 50 months, to 11/2030.")]);
    const out = await ask(fast.model, strong.model, "I want to save 12 000 euros for a home.");
    expect(fast.requests).toHaveLength(2);
    expect(strong.requests).toHaveLength(2);
    // The stronger model cannot hand the turn on, and sees what the fast one had looked up: as text, not as that model's own message.
    expect(toolNames(strong.requests[0])).not.toContain("hand_over");
    expect(strong.requests[0].turns.map((t) => [t.role, t.raw === undefined])).toEqual([["user", true], ["model", true], ["user", true]]);
    expect(strong.requests[0].turns[1].text).toContain('"name":"lookup"');
    expect(strong.requests[0].turns[2].text).toMatch(/^LOOKED UP\nwhatIf/);
    // Its own lookup comes back to it as its own message.
    expect(strong.requests[1].turns.at(-2)).toMatchObject({ role: "model", raw: { from: "strong", n: 1 } });
    expect(out).toMatchObject({ text: "That takes 50 months, to 11/2030.", answeredBy: "strong", checked: true });
  });

  it("takes a planning turn to the stronger model even when the fast one answers it", async () => {
    const plan: Block = { id: "home", title: "Home", explanation: "", source: "estimate", data: { kind: "engine", fn: "goalPlan", args: { target: 12000 } }, view: { kind: "template", template: "stat" } };
    const attempts: ToolCall[][] = [
      [{ name: "lookup", args: { fn: "goalPlan", args: { target: 12000 } } }],
      [{ name: "use_component", args: { id: "home", component: "goal_plan", args: { target: 12000 }, reply: "Here is your plan." } }],
      [{ name: "use_component", args: { id: "cuts", component: "saving_options", args: {}, reply: "Here." } }],
      [{ name: "update_block", args: { id: "home", args: { extra: 100 }, reply: "Done." } }],
    ];
    for (const calls of attempts) {
      const fast = scripted("fast", calls);
      const strong = scripted("strong", [say("Let us look at your plan.")]);
      const out = await runChat({ fast: fast.model, strong: strong.model }, { question: "And 100 more a month?", history: [], blocks: [plan], today: "2026-09-15", lookup });
      expect(strong.requests, JSON.stringify(calls)).toHaveLength(1);
      // The stronger model starts from the user's question, not from what the fast one did.
      expect(strong.requests[0].turns).toEqual([{ role: "user", text: "And 100 more a month?" }]);
      expect(out).toMatchObject({ text: "Let us look at your plan.", answeredBy: "strong", ops: [] });
    }
    // Changing a card that is not a plan stays with the fast model.
    const other: Block = { ...plan, id: "food", data: { kind: "engine", fn: "spendBy", args: {} } };
    const fast = scripted("fast", [{ name: "update_block", args: { id: "food", args: { period: "last_month" }, reply: "Done." } }]);
    const strong = scripted("strong");
    const out = await runChat({ fast: fast.model, strong: strong.model }, { question: "Last month instead", history: [], blocks: [other], today: "2026-09-15", lookup });
    expect(strong.requests).toHaveLength(0);
    expect(out).toMatchObject({ answeredBy: "fast" });
  });

  it("offers no hand-over when there is no stronger model", async () => {
    const fast = scripted("fast", [handOver, say("Here you go.")]);
    const out = await ask(fast.model, undefined);
    expect(toolNames(fast.requests[0])).not.toContain("hand_over");
    expect(out).toMatchObject({ text: "Here you go.", answeredBy: "fast", rejected: [] });
  });

  it("lets the fast model answer after all when the stronger one fails", async () => {
    const fast = scripted("fast", [handOver], [say("Let me answer that myself.")]);
    const strong = scripted("strong", new Error("Gemini is busy right now."));
    const out = await ask(fast.model, strong.model);
    expect(strong.requests).toHaveLength(1);
    expect(fast.requests).toHaveLength(2);
    expect(toolNames(fast.requests[1])).not.toContain("hand_over");
    expect(out).toMatchObject({ text: "Let me answer that myself.", answeredBy: "fast", checked: true });
  });

  it("gives second tries to the stronger model", async () => {
    // The fast model answers with a number from nowhere: the reply alone is asked of the stronger one.
    const fast = scripted("fast", [say("You spent 999 €.")]);
    const strong = scripted("strong", [say("I can't see that figure.")]);
    const out = await ask(fast.model, strong.model);
    expect(fast.requests).toHaveLength(1);
    expect(strong.requests).toHaveLength(1);
    expect(toolNames(strong.requests[0])).toEqual(["reply"]);
    expect(strong.requests[0].turns.at(-2)).toEqual({ role: "model", text: 'Tool calls: [{"name":"reply","args":{"text":"You spent 999 €."}}]' });
    expect(out).toMatchObject({ text: "I can't see that figure.", answeredBy: "fast", checked: true });
  });
});

describe("Gemini model list", () => {
  function recording(statuses: number[]) {
    const sent: { model: string; body: Record<string, any> }[] = [];
    const model = createGeminiModel(
      async (name, body) => {
        sent.push({ model: name, body: JSON.parse(body) });
        const status = statuses[sent.length - 1] ?? 200;
        const answer = { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "reply", args: { text: "Hi." } } }] } }] };
        return new Response(JSON.stringify(status === 200 ? answer : { error: { message: "busy" } }), { status });
      },
      { models: ["fast-model", "strong-model:low"], retryDelayMs: 0 },
    );
    return { sent, ask: () => model.generate({ system: "s", turns: [{ role: "user", text: "hi" }], tools: [] }) };
  }

  it("sends a model's thinking level only to that model, and the name without it", async () => {
    const { sent, ask } = recording([503, 503, 200]);
    const out = await ask();
    expect(out.calls).toEqual([{ name: "reply", args: { text: "Hi." } }]);
    // The first model twice, then the next one.
    expect(sent.map((s) => s.model)).toEqual(["fast-model", "fast-model", "strong-model"]);
    expect(sent[0].body.generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 8192 });
    expect(sent[2].body.generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "low" } });
  });

  it("reads the list from one text, and falls back to the defaults", () => {
    expect(parseGeminiModels(" a , b:low ,")).toEqual(["a", "b:low"]);
    expect(parseGeminiModels("")).toEqual(DEFAULT_GEMINI_MODELS);
    expect(parseGeminiModels(undefined)).toEqual(DEFAULT_GEMINI_MODELS);
  });
});

describe("runChat with the customer's figures", () => {
  const results: Record<string, EngineResult> = {
    safeToSpend: { rows: [{ term: "Balance", amount: 2500 }, { term: "Safe to spend", amount: 312.4 }], value: 312.4, unit: "€", caption: "Until Sunday" },
    spendBy: { rows: [{ key: "Groceries", label: "Groceries", amount: 371.09, count: 18 }, { key: "Travel", label: "Travel", amount: 128.91, count: 2 }], value: 500, unit: "€" },
    whatIf: { rows: [{ month: 12, saved: 444 }], value: 444, unit: "€ / year" },
    safeToSave: { rows: [{ term: "Can be moved to savings", amount: 150 }], value: 150, unit: "€" },
  };
  function harness(...answers: ToolCall[][]) {
    const requests: ChatModelRequest[] = [];
    const looked: string[] = [];
    const model: ChatModel = {
      async generate(req) {
        requests.push(structuredClone(req));
        return { calls: answers[requests.length - 1] ?? [], raw: { n: requests.length } };
      },
    };
    const lookup: Lookup = (fn, args) => {
      looked.push(`${fn}(${JSON.stringify(args)})`);
      const result = results[fn];
      if (!result) throw new Error(`${fn} is not available here`);
      return result;
    };
    const ask = (question = "How much on groceries?") => runChat(model, { question, history: [], blocks: [], today: "2026-09-15", lookup });
    return { requests, looked, ask };
  }
  const say = (text: string, extra: Record<string, unknown> = {}): ToolCall => ({ name: "reply", args: { text, ...extra } });

  it("gives the coach a snapshot, so a plain question is one model call with real figures", async () => {
    const { requests, ask } = harness([say("You spent 371,09 € on groceries, 74 % of the total.", { mood: "neutral", suggestions: ["Cut it by 10%"] })]);
    const out = await ask();
    expect(requests).toHaveLength(1);
    expect(requests[0].system).toMatch(/SNAPSHOT[\s\S]*Spending by category, last full month = spendBy\({"period":"last_month"}\)[\s\S]*label=Groceries; amount=371.09; count=18; share of this total=74%/);
    expect(requests[0].system).toContain("ONE-OFF amount that could be moved to savings today");
    expect(requests[0].tools.map((t) => t.name)).toContain("lookup");
    expect(out).toMatchObject({ text: "You spent 371,09 € on groceries, 74 % of the total.", ops: [], checked: true, mood: "neutral", suggestions: ["Cut it by 10%"], rejected: [] });
  });

  it("looks up what the snapshot lacks, then answers with it", async () => {
    const { requests, looked, ask } = harness(
      [{ name: "lookup", args: { fn: "whatIf", args: { category: "Restaurants", cutPct: 20 } } }, { name: "lookup", args: { fn: "dropTables" } }],
      [say("Cutting eating out by a fifth would save about 444 € a year.")],
    );
    const out = await ask("What if I cut eating out by 20%?");
    expect(looked).toContain('whatIf({"category":"Restaurants","cutPct":20})');
    expect(requests).toHaveLength(2);
    expect(requests[1].turns.at(-2)).toMatchObject({ role: "model", raw: { n: 1 } });
    expect(requests[1].turns.at(-1)?.text).toMatch(/^LOOKED UP\nwhatIf\({"category":"Restaurants","cutPct":20}\)\n  value: 444 € \/ year[\s\S]*lookup: fn must be one of/);
    expect(out).toMatchObject({ text: "Cutting eating out by a fifth would save about 444 € a year.", checked: true });
  });

  it("stops offering lookups after two rounds, and reports a lookup that cannot be computed", async () => {
    const look: ToolCall = { name: "lookup", args: { fn: "recurring" } };
    const { requests, ask } = harness([look], [look], [look, say("I can't see that.")]);
    const out = await ask();
    expect(requests).toHaveLength(3);
    expect(requests[1].turns.at(-1)?.text).toContain("could not be computed: recurring is not available here");
    expect(requests[2].tools.map((t) => t.name)).not.toContain("lookup");
    expect(out).toMatchObject({ text: "I can't see that.", checked: true });
  });

  it("sends back a reply with a number from nowhere, with the figures of the card it built", async () => {
    const card: ToolCall = { name: "use_component", args: { id: "cut", component: "what_if", args: { category: "Restaurants", cutPct: 20 }, reply: "You would save 600 € a year." } };
    const { requests, ask } = harness([card], [say("You would save 444 € a year.", { mood: "happy" })]);
    const out = await ask("What if I cut eating out by 20%?");
    expect(requests).toHaveLength(2);
    expect(requests[1].tools.map((t) => t.name)).toEqual(["reply"]);
    expect(requests[1].turns.at(-1)?.text).toMatch(/numbers that are not in your figures: 600\.[\s\S]*CARD FIGURES\nCard cut: [\s\S]*value: 444/);
    expect(out).toMatchObject({ text: "You would save 444 € a year.", checked: true, mood: "happy", rejected: [] });
    expect(out.ops).toHaveLength(1);
  });

  it("replaces a reply that fails twice with the card's own figure, and says so", async () => {
    const card: ToolCall = { name: "use_component", args: { id: "cut", component: "what_if", args: { cutPct: 20 }, reply: "You would save 600 € a year.", mood: "happy" } };
    const { ask } = harness([card], [say("About 50 € a month, so 600 €.")]);
    const out = await ask();
    expect(out.checked).toBe(false);
    expect(out.text).toMatch(/: \{\{cut\.value\}\}\.$/);
    expect(out.mood).toBeNull();
    expect(out.rejected).toEqual(["reply: numbers not in the figures: 50, 600"]);
    expect(out.ops).toHaveLength(1);
  });

  it("answers without figures in the user's language when nothing checked can be said", async () => {
    const { ask } = harness([say("Käytit 999 € ruokaan.")], [say("Käytit 998 € ruokaan.")]);
    const out = await ask("Paljonko käytin ruokaan?");
    expect(out).toMatchObject({ checked: false, ops: [] });
    expect(out.text).toMatch(/^En saanut/);
  });

  it("accepts numbers the user gave and placeholders for cards it has not seen", async () => {
    const goal = (reply: string): ToolCall => ({ name: "use_component", args: { id: "goal", component: "what_if", args: { cutPct: 20 }, reply } });
    const { ask } = harness([goal("With 25 000 € as the target, see {{goal.value}}. That is 1 500 € more than before.")]);
    const out = await ask("My target is 25000 euros");
    expect(out.checked).toBe(false); // 1 500 is from nowhere
    const fine = harness([goal("With 25 000 € as the target, see {{goal.value}}.")]);
    expect(await fine.ask("My target is 25000 euros")).toMatchObject({ checked: true });
  });

  it("sends back a reply that quotes the figure from before the change the card makes", async () => {
    // The snapshot has safe to spend for the week (312,40 €). The card sets a reserve, which here changes it to 92 €.
    const reserved: Lookup = (fn, args) => {
      if (fn === "safeToSpend" && args.reserve === 1000) return { rows: [{ term: "Safe to spend", amount: 92 }], value: 92, unit: "€" };
      const result = results[fn];
      if (!result) throw new Error(`${fn} is not available here`);
      return result;
    };
    const card = (reply: string): ToolCall => ({ name: "use_component", args: { id: "safe", component: "safe_to_spend", args: { reserve: 1000 }, reply } });
    const run = async (...answers: ToolCall[][]) => {
      const requests: ChatModelRequest[] = [];
      const model: ChatModel = {
        async generate(req) {
          requests.push(structuredClone(req));
          return { calls: answers[requests.length - 1] ?? [] };
        },
      };
      const out = await runChat(model, { question: "1 000 euros of this account is savings. What is safe to spend?", history: [], blocks: [], today: "2026-09-15", lookup: reserved });
      return { out, requests };
    };

    const wrong = await run([card("You have 312,40 € safe to spend this week, with your 1 000 € kept aside.")], [say("With 1 000 € kept aside, 92 € is safe to spend this week.")]);
    expect(wrong.requests).toHaveLength(2);
    expect(wrong.requests[1].turns.at(-1)?.text).toMatch(/Your reply says 312.4, the figure from before this change\. The card you built shows 92/);
    expect(wrong.out).toMatchObject({ text: "With 1 000 € kept aside, 92 € is safe to spend this week.", checked: true });

    // Saying both is fine, once the coach has looked the new figure up.
    const both = await run(
      [{ name: "lookup", args: { fn: "safeToSpend", args: { horizon: "week", reserve: 1000 } } }],
      [card("That brings it from 312,40 € down to 92 € this week.")],
    );
    expect(both.requests).toHaveLength(2);
    expect(both.out).toMatchObject({ text: "That brings it from 312,40 € down to 92 € this week.", checked: true });

    const stubborn = await run([card("You have 312,40 € safe to spend this week.")], [say("You have 312,40 € safe to spend this week.")]);
    expect(stubborn.out.checked).toBe(false);
    expect(stubborn.out.text).toMatch(/\{\{safe\.value\}\}/);
    expect(stubborn.out.rejected).toEqual(["reply: figures from before the change: 312.4"]);
  });

  it("sends back a placeholder the app could not fill", async () => {
    // spendBy by category has a total; the card called "ghost" does not exist, and a caption is missing here.
    const card = (reply: string): ToolCall => ({ name: "use_component", args: { id: "food", component: "category_bars", args: {}, reply } });
    const { requests, ask } = harness([card("You spent {{ghost.value}}, see {{food.caption}}.")], [say("You spent 500 € in total.")]);
    const out = await ask();
    expect(requests).toHaveLength(2);
    expect(requests[1].turns.at(-1)?.text).toMatch(/used \{\{ghost\.value\}\}, \{\{food\.caption\}\}, which the app cannot fill in/);
    expect(out).toMatchObject({ text: "You spent 500 € in total.", checked: true, rejected: [] });

    const stubborn = harness([card("You spent {{ghost.value}}.")], [say("You spent {{ghost.value}}.")]);
    const failed = await stubborn.ask();
    expect(failed.checked).toBe(false);
    expect(failed.text).toMatch(/: \{\{food\.value\}\}\.$/);
    expect(failed.rejected).toEqual(["reply: placeholders that cannot be filled: {{ghost.value}}"]);
  });

  it("works without figures: no snapshot, no lookups, placeholders only", async () => {
    const requests: ChatModelRequest[] = [];
    const model: ChatModel = {
      async generate(req) {
        requests.push(req);
        return { calls: [{ name: "use_component", args: { id: "food", component: "category_bars", args: { category: "Groceries" }, reply: "You spent {{food.value}}." } }] };
      },
    };
    const out = await runChat(model, { question: "Groceries?", history: [], blocks: [], today: "2026-09-15" });
    expect(requests[0].system).toContain("(not available: look up what you need)");
    expect(requests[0].tools.map((t) => t.name)).not.toContain("lookup");
    expect(out).toMatchObject({ text: "You spent {{food.value}}.", checked: true });
  });
});
