/**
 * The second step of a chat answer: the model sees the figures the finance engine computed
 * for the cards it asked for, and writes a reply that says what they mean.
 *
 * Two safeguards keep the figures right:
 * - the model gets results only (totals, rows of a card), never the transaction list, and is
 *   told not to calculate;
 * - every number in its reply must appear in those results. If one does not, the reply is
 *   thrown away and the caller falls back to a reply whose figures the app fills in itself.
 */
import type { Block, ChatModel, EngineResult } from "@mydata/shared";

export interface CardFacts {
  block: Block;
  result: EngineResult;
}

const MAX_ROWS = 14;
const NUMBER = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*/g;

/** The values a written number might stand for: "1,913" is 1913 or 1.913, "227,57" is 227.57. */
export function numberReadings(token: string): number[] {
  const t = token.replace(/[   ]/g, "");
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  const readings = new Set<number>();
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? "." : ",";
    const grouping = decimal === "." ? "," : ".";
    readings.add(Number(t.split(grouping).join("").replace(decimal, ".")));
  } else if (lastDot !== -1 || lastComma !== -1) {
    const separator = lastDot !== -1 ? "." : ",";
    readings.add(Number(t.split(separator).join(""))); // as a thousands separator
    if (t.indexOf(separator) === t.lastIndexOf(separator)) readings.add(Number(t.replace(separator, "."))); // as a decimal mark
  } else {
    readings.add(Number(t));
  }
  return [...readings].filter(Number.isFinite);
}

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).flatMap(numberReadings);
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Share of the total per row, for results whose rows have an `amount` and add up to something. */
function shares(result: EngineResult): Map<number, number> {
  const amounts = result.rows.map((row) => row.amount).filter((a): a is number => typeof a === "number" && a > 0);
  const total = amounts.reduce((a, b) => a + b, 0);
  const out = new Map<number, number>();
  if (amounts.length !== result.rows.length || amounts.length < 2 || amounts.length > MAX_ROWS || total <= 0) return out;
  result.rows.forEach((row, index) => out.set(index, round((100 * (row.amount as number)) / total, 0)));
  return out;
}

function describeRow(row: EngineResult["rows"][number], share?: number): string {
  const fields = Object.entries(row)
    .filter(([key, value]) => value !== null && key !== "key")
    .map(([key, value]) => `${key}=${typeof value === "number" ? round(value, 2) : value}`);
  if (share !== undefined) fields.push(`share of this card's total=${share}%`);
  return fields.join("; ");
}

/** The figures of one card as text for the model. */
export function describeFacts({ block, result }: CardFacts): string {
  const request = block.data.kind === "engine" ? `${block.data.fn}(${JSON.stringify(block.data.args)})` : "query";
  const lines = [`Card ${block.id}: "${block.title}" = ${request}`];
  if (typeof result.value === "number") lines.push(`  value: ${round(result.value, 2)} ${result.unit ?? ""}`.trimEnd());
  if (result.caption) lines.push(`  summary: ${result.caption}`);
  const share = shares(result);
  if (result.rows.length <= MAX_ROWS) {
    result.rows.forEach((row, index) => lines.push(`  row: ${describeRow(row, share.get(index))}`));
  } else {
    // A long series (days, months): the extremes and the average say more than every row.
    const withAmount = result.rows.filter((row) => typeof row.amount === "number");
    const sorted = [...withAmount].sort((a, b) => (b.amount as number) - (a.amount as number));
    lines.push(`  rows: ${result.rows.length} in total`);
    if (withAmount.length) {
      const total = withAmount.reduce((sum, row) => sum + (row.amount as number), 0);
      lines.push(`  average amount per row: ${round(total / withAmount.length, 2)}`);
      sorted.slice(0, 3).forEach((row) => lines.push(`  among the highest: ${describeRow(row)}`));
      lines.push(`  lowest: ${describeRow(sorted[sorted.length - 1])}`);
    } else {
      result.rows.slice(-5).forEach((row) => lines.push(`  latest: ${describeRow(row)}`));
    }
  }
  for (const assumption of result.assumptions ?? []) lines.push(`  assumption: ${assumption}`);
  return lines.join("\n");
}

/** Finnish or English, from the question itself. A guess is enough: it only picks the reply's language. */
export function questionLanguage(question: string): "fi" | "en" {
  const text = ` ${question.toLowerCase()} `;
  if (/[äöå]/.test(text)) return "fi";
  const finnish = /[ ,.?!](paljonko|kuinka|mihin|miten|mitä|mikä|montako|voinko|olenko|onko|minä|minun|rahani|rahaa|käytin|kulutin|säästää|säästin|viime|kuussa|vuonna|viikolla|tällä|turvallisesti|paljon|kuukaudessa|euroa)[ ,.?!]/;
  return finnish.test(text) ? "fi" : "en";
}

const explainPrompt = (today: string, language: "fi" | "en") => `You are the money coach in a bank's app. You get the user's question and the figures the bank's finance engine computed for the cards now on their screen. Write the chat reply.

- Write in ${language === "fi" ? "Finnish" : "English"}, whatever language the figures are labelled in. Translate labels such as category and basket names.
- Two to four short sentences. Plain text: no markdown, no lists.
- First answer the question with the key figure. Then say what it means for this person: the biggest part, how the parts compare, whether money is tight, or one concrete thing they could look at next. Be specific to these figures, kind and practical. No generic advice, no moralising.
- Use only numbers that appear in the figures. Do not calculate: no sums, differences or percentages of your own.
- A "share of this card's total" is that row's part of the card's total and nothing else: not a share of income, of the balance or of another card.
- Write amounts the way this bank's app does, also in English: 1 234,56 € (space for thousands, comma for decimals, euro sign after). Keep the precision given.
- Write dates as given, like 15.10.2026.
- If a figure is an estimate, say so in a few words. The assumptions tell you what it rests on.
- This is information about their own money, not financial advice: do not recommend products, investments or loans.
- Today is ${today}.

Call reply exactly once.`;

const REPLY_TOOL = {
  name: "reply",
  description: "The chat answer shown to the user. Call exactly once.",
  parametersJsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

/** Whole numbers this small are counts, days and months, unless they are written as money or a percentage. */
const ALWAYS_ALLOWED_UP_TO = 31;
const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.(?:\d{4}\b)?/g;
const MONEY_OR_PERCENT_BEFORE = /€\s?$/;
const MONEY_OR_PERCENT_AFTER = /^\s?(€|%|eur\b|euro)/i;

/**
 * The numbers in `text` that are not backed by `sources`. A number is backed when it equals a
 * source number, or that number rounded to a whole or to one decimal.
 */
export function unbackedNumbers(text: string, sources: number[]): string[] {
  const allowed = new Set<number>();
  for (const value of sources) {
    for (const v of [value, Math.abs(value)]) {
      allowed.add(round(v, 2));
      allowed.add(round(v, 1));
      allowed.add(round(v, 0));
    }
  }
  const unbacked: string[] = [];
  // Dates are not figures: "15.10.2026", "15.10." and "2026-10-15" are left out of the check.
  const withoutDates = text.replace(DATE, (date) => " ".repeat(date.length));
  for (const match of withoutDates.matchAll(NUMBER)) {
    const token = match[0];
    const start = match.index;
    // An amount or a percentage is a figure however small it is: "€22 per visit" must be backed.
    const isFigure = MONEY_OR_PERCENT_BEFORE.test(withoutDates.slice(0, start)) || MONEY_OR_PERCENT_AFTER.test(withoutDates.slice(start + token.length));
    const backed = numberReadings(token).some(
      (n) =>
        allowed.has(round(n, 2)) ||
        (!isFigure && Number.isInteger(n) && (n <= ALWAYS_ALLOWED_UP_TO || (n >= 2000 && n <= 2100))),
    );
    if (!backed) unbacked.push(token);
  }
  return unbacked;
}

/** Every number the model may quote: the cards' values, rows, shares and the numbers in their text and arguments. */
function sourceNumbers(facts: CardFacts[], question: string): number[] {
  const numbers = numbersIn(question);
  for (const fact of facts) {
    numbers.push(...numbersIn(describeFacts(fact)));
    if (typeof fact.result.value === "number") numbers.push(fact.result.value);
    for (const row of fact.result.rows) {
      for (const value of Object.values(row)) if (typeof value === "number") numbers.push(value);
    }
  }
  return numbers;
}

export interface Explanation {
  /** The reply, or null when the model gave none or quoted a number that is not in the figures. */
  text: string | null;
  /** The numbers that were not backed, when the reply was rejected for that. */
  unbacked: string[];
}

export async function explainFigures(
  model: ChatModel,
  input: { question: string; facts: CardFacts[]; today: string },
  signal?: AbortSignal,
): Promise<Explanation> {
  const figures = input.facts.map(describeFacts).join("\n\n");
  const answer = await model.generate(
    {
      system: explainPrompt(input.today, questionLanguage(input.question)),
      turns: [{ role: "user", text: `QUESTION\n${input.question}\n\nFIGURES\n${figures}` }],
      tools: [REPLY_TOOL],
    },
    signal,
  );
  const call = answer.calls.find((c) => c.name === "reply");
  const text = typeof call?.args.text === "string" ? call.args.text.trim() : "";
  if (!text || text.length > 1500) return { text: null, unbacked: [] };
  const unbacked = unbackedNumbers(text, sourceNumbers(input.facts, input.question));
  return unbacked.length ? { text: null, unbacked } : { text, unbacked: [] };
}
