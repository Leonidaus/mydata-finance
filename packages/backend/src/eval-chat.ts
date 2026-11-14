/**
 * A small end-to-end check of the chat with the real model: asks the challenge's questions for
 * one customer and compares each answer with what the finance engine says.
 *
 *   npm run eval:chat -w @mydata/backend                 (needs GEMINI_API_KEY in .env)
 *   npm run eval:chat -w @mydata/backend -- CUST01700
 *
 * For each question it checks that the coach either built a card with the expected function
 * and arguments or answered in words, that nothing was rejected, that its reply passed the
 * number check, and that the figure the engine computes is the figure in the reply. Exits
 * with 1 when a question fails.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type DashboardOp, type EngineFn, numbersIn } from "@mydata/shared";
import { createApp } from "./app";
import { type ChatAnswer, createServerChatModels } from "./chat";
import { openDatabase } from "./db";
import { runEngineFor } from "./finance/engine";

interface Case {
  question: string;
  /** A card with any of these functions is a good answer. */
  fns: EngineFn[];
  /** Arguments the card must have. */
  args?: Record<string, unknown>;
  /**
   * The coach may also answer in words without a card. Then the reply must state the headline
   * figure of this engine request.
   */
  inWords?: { fn: EngineFn; args: Record<string, unknown> };
  /** Which model should write the answer, where that is clear-cut: a lookup stays fast, coaching goes to the stronger one. */
  by?: "fast" | "strong";
}

const CASES: Case[] = [
  // A card for taxis alone or for transport by merchant type are both fine; the reply has to state the taxi figure.
  { question: "How much did I spend on taxis last month?", fns: ["spendBy"], args: { period: "last_month" }, inWords: { fn: "spendBy", args: { mcc: "4121", period: "last_month" } }, by: "fast" },
  { question: "What is safe for me to spend this week?", fns: ["safeToSpend"], args: { horizon: "week" }, inWords: { fn: "safeToSpend", args: { horizon: "week" } }, by: "fast" },
  { question: "What kind of spender am I?", fns: ["baskets", "peerCompare", "spendBy"] },
  { question: "How much could I save if I reduced dining out by 20%?", fns: ["whatIf"], args: { category: "Restaurants", cutPct: 20 }, inWords: { fn: "whatIf", args: { category: "Restaurants", cutPct: 20 } } },
  { question: "Where did my money go last month?", fns: ["spendBy", "baskets"], args: { period: "last_month" }, inWords: { fn: "spendBy", args: { period: "last_month" } } },
  { question: "How could I save more?", fns: ["savingsOptions", "safeToSave", "whatIf", "baskets", "spendBy", "peerCompare"], by: "strong" },
  { question: "How much did I spend on fast food in the last 12 months?", fns: ["spendBy"], args: { mcc: "5814", period: "last_12_months" }, inWords: { fn: "spendBy", args: { mcc: "5814", period: "last_12_months" } }, by: "fast" },
  { question: "Do I spend more on groceries than the average Finn my age?", fns: ["nationalCompare"], args: { category: "Groceries" } },
  { question: "Onko asumiseni kalliimpaa kuin suomalaisilla keskimäärin?", fns: ["nationalCompare"], args: { category: "Housing" } },
  {
    question: "I want to save 12 000 euros for a home deposit. I have 2 000 set aside and can put in 200 a month. When do I get there?",
    fns: ["goalPlan"],
    args: { target: 12000, saved: 2000, monthly: 200 },
    inWords: { fn: "goalPlan", args: { target: 12000, saved: 2000, monthly: 200 } },
    by: "strong",
  },
  { question: "Paljonko käytin ruokakauppaan viime kuussa?", fns: ["spendBy"], args: { category: "Groceries", period: "last_month" }, inWords: { fn: "spendBy", args: { category: "Groceries", period: "last_month" } }, by: "fast" },
];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main(): Promise<void> {
  const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set (put it in .env at the repository root).");

  const customerId = process.argv[2] ?? "CUST03004";
  const db = openDatabase();
  const models = createServerChatModels(key, process.env);
  const app = createApp(db, { chatModel: models, chatBudget: { perMinute: 1000, perHour: 10000 } });
  console.log(models.strong ? "Two models: a fast one, and a stronger one for handed-over turns.\n" : "One model (GEMINI_STRONG_MODEL=off).\n");

  let failed = 0;
  let checked = 0;
  for (const test of CASES) {
    const started = Date.now();
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId, question: test.question }),
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const problems: string[] = [];
    let summary = "";
    if (response.status !== 200) {
      problems.push(`status ${response.status}: ${((await response.json()) as { error?: string }).error}`);
    } else {
      const answer = (await response.json()) as ChatAnswer;
      if (answer.checked) checked++;
      if (answer.rejected.length) problems.push(`rejected tool calls: ${answer.rejected.join("; ")}`);
      if (models.strong && test.by && answer.answeredBy !== test.by) problems.push(`answered by the ${answer.answeredBy} model, expected the ${test.by} one`);
      if (!answer.checked) problems.push("the coach's own reply was not usable; a standard sentence was sent");
      const cards = answer.ops.flatMap((op: DashboardOp) => (op.op === "add_block" && op.block.data.kind === "engine" ? [op.block] : []));
      const card = cards.find((b) => b.data.kind === "engine" && test.fns.includes(b.data.fn));
      // The figure the reply has to state: the card's headline, or the request the question is about.
      let asked: { fn: EngineFn; args: Record<string, unknown> } | undefined;
      if (card && card.data.kind === "engine") {
        asked = card.data;
        for (const [name, expected] of Object.entries(test.args ?? {})) {
          if (asked.args[name] !== expected) problems.push(`${asked.fn} has ${name}=${JSON.stringify(asked.args[name])}, expected ${JSON.stringify(expected)}`);
        }
        summary = `card ${asked.fn}(${JSON.stringify(asked.args)})`;
      } else if (cards.length === 0 && (test.inWords || answer.text.trim())) {
        asked = test.inWords;
        summary = "answered in words";
      } else {
        problems.push(`no card with ${test.fns.join(" or ")} (got ${cards.map((b) => (b.data.kind === "engine" ? b.data.fn : "?")).join(", ") || "none"})`);
      }
      const about = test.inWords ?? asked;
      const truth = about && runEngineFor(db, customerId, about.fn, about.args);
      const usesPlaceholder = /\{\{[^}]+\}\}/.test(answer.text);
      // Only for questions about one figure; an open question ("what kind of spender am I?") can be answered in other terms.
      if (test.inWords && typeof truth?.value === "number" && answer.checked && !usesPlaceholder) {
        // The reply must state the figure the engine computed, as written or rounded.
        const said = numbersIn(answer.text);
        const value = truth.value;
        if (value !== 0 && !said.some((n) => Math.abs(n - value) < 0.006 || n === Math.round(value))) {
          problems.push(`the reply does not state the engine's figure ${value}`);
        }
      }
      summary += `\n      ${answer.answeredBy}, ${answer.checked ? "checked" : "standard"}: ${answer.text}`;
    }
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "ok  "} ${seconds}s  ${test.question}\n      ${summary}`);
    for (const problem of problems) console.log(`      ! ${problem}`);
    await sleep(5000); // an answer is one to three model calls: stay inside a free-tier limit of 15 a minute
  }
  console.log(`\n${CASES.length - failed} of ${CASES.length} questions passed for ${customerId}; ${checked} replies were the coach's own, with every number checked.`);
  db.close();
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
