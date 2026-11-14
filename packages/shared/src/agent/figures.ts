/**
 * Figures as the model sees them, and the check that keeps its replies honest.
 *
 * The coach gets results of the finance engine (totals and rows, never the transaction list)
 * as text, and is told not to calculate. Every number in its reply must then appear in what it
 * was shown; a reply with a number from nowhere is sent back once and otherwise discarded.
 */
import type { Block } from "../blocks";
import type { EngineResult } from "../engine/types";

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
  // A comparison (you next to peers or Finland) puts two parties side by side: its rows are not parts of one total.
  if (result.rows.some((row) => "who" in row)) return out;
  if (amounts.length !== result.rows.length || amounts.length < 2 || amounts.length > MAX_ROWS || total <= 0) return out;
  result.rows.forEach((row, index) => out.set(index, round((100 * (row.amount as number)) / total, 0)));
  return out;
}

function describeRow(row: EngineResult["rows"][number], share?: number): string {
  const fields = Object.entries(row)
    .filter(([key, value]) => value !== null && key !== "key")
    .map(([key, value]) => `${key}=${typeof value === "number" ? round(value, 2) : value}`);
  if (share !== undefined) fields.push(`share of this total=${share}%`);
  return fields.join("; ");
}

/** One engine result as text for the model, under a heading that says what was asked. */
export function describeResult(heading: string, result: EngineResult, maxRows = MAX_ROWS): string {
  const lines = [heading];
  if (typeof result.value === "number") lines.push(`  value: ${round(result.value, 2)} ${result.unit ?? ""}`.trimEnd());
  if (result.caption) lines.push(`  summary: ${result.caption}`);
  const share = shares(result);
  if (result.rows.length <= maxRows) {
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

/** What a data request is called in the text given to the model, e.g. `spendBy({"period":"last_month"})`. */
export const requestLabel = (fn: string, args: Record<string, unknown>) => `${fn}(${JSON.stringify(args)})`;

/** The figures of one card as text for the model. */
export function describeFacts({ block, result }: CardFacts): string {
  const request = block.data.kind === "engine" ? requestLabel(block.data.fn, block.data.args) : "query";
  return describeResult(`Card ${block.id}: "${block.title}" = ${request}`, result);
}

/** Finnish or English, from the question itself. A guess is enough: it only picks the reply's language. */
export function questionLanguage(question: string): "fi" | "en" {
  const text = ` ${question.toLowerCase()} `;
  if (/[äöå]/.test(text)) return "fi";
  const finnish = /[ ,.?!](paljonko|kuinka|mihin|miten|mitä|mikä|montako|voinko|olenko|onko|minä|minun|rahani|rahaa|käytin|kulutin|säästää|säästin|viime|kuussa|vuonna|viikolla|tällä|turvallisesti|paljon|kuukaudessa|euroa)[ ,.?!]/;
  return finnish.test(text) ? "fi" : "en";
}

/**
 * Whole numbers this small are counts, days and months, unless they are written as money or a percentage.
 * A year is not let through like that: "you will get there in December 2027" is a figure, and a wrong
 * year is a wrong answer. Years in the figures, in the conversation and today's own are backed like any number.
 */
const ALWAYS_ALLOWED_UP_TO = 31;
const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.(?:\d{4}\b)?/g;
const MONEY_OR_PERCENT_BEFORE = /€\s?$/;
const MONEY_OR_PERCENT_AFTER = /^\s?(€|%|eur\b|euro)/i;
const PLACEHOLDER = /\{\{[^}]*\}\}/g;

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
  // Neither are {{card.value}} placeholders: the app fills those in from the engine.
  const blank = (s: string) => " ".repeat(s.length);
  const checked = text.replace(PLACEHOLDER, blank).replace(DATE, blank);
  for (const match of checked.matchAll(NUMBER)) {
    const token = match[0];
    const start = match.index;
    // An amount or a percentage is a figure however small it is: "€22 per visit" must be backed.
    const isFigure = MONEY_OR_PERCENT_BEFORE.test(checked.slice(0, start)) || MONEY_OR_PERCENT_AFTER.test(checked.slice(start + token.length));
    const backed = numberReadings(token).some(
      (n) =>
        allowed.has(round(n, 2)) ||
        (!isFigure && Number.isInteger(n) && n <= ALWAYS_ALLOWED_UP_TO),
    );
    if (!backed) unbacked.push(token);
  }
  return unbacked;
}

/** Every number in an engine result: its value, its rows, and the numbers in its text. */
export function resultNumbers(result: EngineResult): number[] {
  const numbers = numbersIn(describeResult("", result));
  if (typeof result.value === "number") numbers.push(result.value);
  for (const row of result.rows) {
    for (const value of Object.values(row)) if (typeof value === "number") numbers.push(value);
  }
  return numbers;
}
