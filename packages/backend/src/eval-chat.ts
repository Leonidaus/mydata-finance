/**
 * A small end-to-end check of the chat with the real model: asks the challenge's questions for
 * one customer and compares each answer with what the finance engine says.
 *
 *   npm run eval:chat -w @mydata/backend                 (needs GEMINI_API_KEY in .env)
 *   npm run eval:chat -w @mydata/backend -- CUST01700
 *
 * For each question it checks that the model built a card with the expected function and
 * arguments, that nothing was rejected, and that the card's headline figure, as the engine
 * computes it, is the figure in the reply. Exits with 1 when a question fails.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DashboardOp, EngineFn } from "@mydata/shared";
import { createApp } from "./app";
import { type ChatAnswer, createServerGeminiModel } from "./chat";
import { openDatabase } from "./db";
import { numbersIn } from "./explain";
import { runEngineFor } from "./finance/engine";

interface Case {
  question: string;
  /** Any of these functions is a good answer. */
  fns: EngineFn[];
  /** Arguments the card must have. */
  args?: Record<string, unknown>;
}

const CASES: Case[] = [
  { question: "How much did I spend on taxis last month?", fns: ["spendBy"], args: { mcc: "4121", period: "last_month" } },
  { question: "What is safe for me to spend this week?", fns: ["safeToSpend"], args: { horizon: "week" } },
  { question: "What kind of spender am I?", fns: ["baskets", "peerCompare", "spendBy"] },
  { question: "How much could I save if I reduced dining out by 20%?", fns: ["whatIf"], args: { category: "Restaurants", cutPct: 20 } },
  { question: "Where did my money go last month?", fns: ["spendBy", "baskets"], args: { period: "last_month" } },
  { question: "How could I save more?", fns: ["safeToSave", "whatIf", "baskets", "spendBy", "peerCompare"] },
  { question: "How much did I spend on fast food in the last 12 months?", fns: ["spendBy"], args: { mcc: "5814", period: "last_12_months" } },
  { question: "Paljonko käytin ruokakauppaan viime kuussa?", fns: ["spendBy"], args: { category: "Groceries", period: "last_month" } },
];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main(): Promise<void> {
  const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set (put it in .env at the repository root).");

  const customerId = process.argv[2] ?? "CUST03004";
  const db = openDatabase();
  const app = createApp(db, { chatModel: createServerGeminiModel(key, process.env.GEMINI_MODEL), chatBudget: { perMinute: 1000, perHour: 10000 } });

  let failed = 0;
  let explained = 0;
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
      if (answer.explained) explained++;
      if (answer.rejected.length) problems.push(`rejected tool calls: ${answer.rejected.join("; ")}`);
      const cards = answer.ops.flatMap((op: DashboardOp) => (op.op === "add_block" && op.block.data.kind === "engine" ? [op.block] : []));
      const card = cards.find((b) => b.data.kind === "engine" && test.fns.includes(b.data.fn));
      if (!card || card.data.kind !== "engine") {
        problems.push(`no card with ${test.fns.join(" or ")} (got ${cards.map((b) => (b.data.kind === "engine" ? b.data.fn : "?")).join(", ") || "none"})`);
      } else {
        const { fn, args } = card.data;
        for (const [name, expected] of Object.entries(test.args ?? {})) {
          if (args[name] !== expected) problems.push(`${fn} has ${name}=${JSON.stringify(args[name])}, expected ${JSON.stringify(expected)}`);
        }
        const truth = runEngineFor(db, customerId, fn, args);
        summary = `${fn}(${JSON.stringify(args)})`;
        if (typeof truth?.value === "number" && answer.explained) {
          // The reply must state the figure the engine computed, as written or rounded.
          const said = numbersIn(answer.text);
          const value = truth.value;
          if (!said.some((n) => Math.abs(n - value) < 0.006 || n === Math.round(value))) {
            problems.push(`the reply does not state the engine's figure ${value}`);
          }
        }
      }
      summary += `\n      ${answer.explained ? "explained" : "placeholder"}: ${answer.text}`;
    }
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "ok  "} ${seconds}s  ${test.question}\n      ${summary}`);
    for (const problem of problems) console.log(`      ! ${problem}`);
    await sleep(1500); // stay well inside a free-tier rate limit
  }
  console.log(`\n${CASES.length - failed} of ${CASES.length} questions passed for ${customerId}; ${explained} replies explained the figures.`);
  db.close();
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
