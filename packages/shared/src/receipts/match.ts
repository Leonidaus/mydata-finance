/**
 * Finds the card payment a receipt belongs to. Deterministic: no model takes part.
 *
 * Candidates are card purchases from the day before the receipt to three days after it (a card
 * payment can be booked a few days late), whose amount is the receipt's total or within 2% of
 * it. Each is scored on how close the amount is, how close the time is, and whether the kind of
 * shop agrees. A strong match is linked straight away; a possible one waits for the user.
 */
import { lookupMcc } from "../mcc";
import type { Transaction } from "../schema";
import { addDays, daysBetween } from "../engine/util";
import type { MatchCandidate, MatchResult, ReceiptRead } from "./types";

export const MATCH_DAYS_BEFORE = 1;
export const MATCH_DAYS_AFTER = 3;
/** A payment within this share of the total still counts (rounding, a discount the bank applied). */
export const MATCH_AMOUNT_TOLERANCE = 0.02;
export const STRONG_SCORE = 80;
export const STRONG_LEAD = 15;
export const POSSIBLE_SCORE = 55;
const MAX_CANDIDATES = 5;

const cents = (n: number) => Math.round(n * 100);

function minutesOfDay(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** How many points a payment gets for this receipt, or null when it cannot be the one. */
export function scoreCandidate(read: ReceiptRead, t: Transaction): number | null {
  if (read.total === null || read.date === null) return null;
  const paid = -t.tx_amount_eur;
  if (t.transaction_type !== "purchase" || paid <= 0) return null;
  const diff = Math.abs(cents(paid) - cents(read.total));
  let score: number;
  if (diff <= 1) score = 50;
  else if (diff <= cents(read.total * MATCH_AMOUNT_TOLERANCE)) score = 20;
  else return null;

  const days = daysBetween(read.date, t.tx_date);
  if (days < -MATCH_DAYS_BEFORE || days > MATCH_DAYS_AFTER) return null;
  if (days === 0) {
    const receiptMin = read.time === null ? null : minutesOfDay(read.time);
    const paidMin = minutesOfDay(t.tx_timestamp.slice(11, 16));
    const gap = receiptMin === null || paidMin === null ? null : Math.abs(paidMin - receiptMin);
    score += gap !== null && gap <= 15 ? 30 : gap !== null && gap <= 120 ? 20 : 10;
  } else {
    score += 5;
  }

  if (t.mcc_code === null) score += 4;
  else if (read.mcc !== null && t.mcc_code === read.mcc) score += 15;
  else if (read.mcc !== null && lookupMcc(read.mcc)?.category === t.category) score += 8;
  return score;
}

/**
 * Matches a receipt against one customer's transactions. `linked` holds the transaction ids that
 * already have a receipt: a payment gets at most one. `today` is the last day of bank data.
 */
export function matchReceipt(read: ReceiptRead, tx: readonly Transaction[], today: string, linked: ReadonlySet<number> = new Set()): MatchResult {
  if (read.total === null) return { confidence: "none", candidates: [], reason: "no_total" };
  if (read.date === null) return { confidence: "none", candidates: [], reason: "no_date" };
  if (read.paidBy === "cash") return { confidence: "none", candidates: [], reason: "cash" };
  if (read.date > today) return { confidence: "none", candidates: [], reason: "after_data_end" };

  const from = addDays(read.date, -MATCH_DAYS_BEFORE);
  const to = addDays(read.date, MATCH_DAYS_AFTER);
  const candidates: MatchCandidate[] = [];
  for (const t of tx) {
    if (t.tx_id === undefined || linked.has(t.tx_id) || t.tx_date < from || t.tx_date > to) continue;
    const score = scoreCandidate(read, t);
    if (score === null) continue;
    candidates.push({
      txId: t.tx_id,
      date: t.tx_date,
      timestamp: t.tx_timestamp,
      amount: Math.round(-t.tx_amount_eur * 100) / 100,
      category: t.category,
      mcc: t.mcc_code,
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.timestamp.localeCompare(b.timestamp));
  const [best, second] = candidates;
  if (!best) return { confidence: "none", candidates: [], reason: "no_candidates" };
  const confidence =
    best.score >= STRONG_SCORE && (!second || best.score - second.score >= STRONG_LEAD) ? "strong" : best.score >= POSSIBLE_SCORE ? "possible" : "none";
  return { confidence, candidates: candidates.slice(0, MAX_CANDIDATES), ...(confidence === "none" && { reason: "no_candidates" as const }) };
}

/**
 * Payments near the receipt's date for the user to choose from when no candidate fits:
 * card purchases in the same window, closest amount first.
 */
export function nearbyPayments(read: ReceiptRead, tx: readonly Transaction[], linked: ReadonlySet<number> = new Set(), max = 8): MatchCandidate[] {
  if (read.date === null) return [];
  const from = addDays(read.date, -MATCH_DAYS_BEFORE);
  const to = addDays(read.date, MATCH_DAYS_AFTER);
  return tx
    .filter((t) => t.tx_id !== undefined && !linked.has(t.tx_id) && t.transaction_type === "purchase" && t.tx_amount_eur < 0 && t.tx_date >= from && t.tx_date <= to)
    .map((t) => ({
      txId: t.tx_id as number,
      date: t.tx_date,
      timestamp: t.tx_timestamp,
      amount: Math.round(-t.tx_amount_eur * 100) / 100,
      category: t.category,
      mcc: t.mcc_code,
      score: scoreCandidate(read, t) ?? 0,
    }))
    .sort((a, b) => b.score - a.score || Math.abs(a.amount - (read.total ?? 0)) - Math.abs(b.amount - (read.total ?? 0)))
    .slice(0, max);
}
