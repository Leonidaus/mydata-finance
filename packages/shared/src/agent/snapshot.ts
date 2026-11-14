/**
 * The customer's finances at a glance, as text for the coach: a fixed set of engine results
 * that covers most questions, so that an answer usually takes one model call. Totals and rows
 * only; the transaction list never goes to the model.
 */
import type { Block } from "../blocks";
import { validateEngineArgs } from "../engine/args";
import type { EngineFn, EngineResult } from "../engine/types";
import { describeResult, requestLabel, resultNumbers } from "./figures";

/** Runs an engine function for the customer being answered. May reject (e.g. wrong arguments). */
export type Lookup = (fn: EngineFn, args: Record<string, unknown>) => Promise<EngineResult> | EngineResult;

/** Figures given to the model, with every number in them (what its reply may quote). */
export interface Figures {
  text: string;
  numbers: number[];
}

/** The headline figure of one snapshot entry, with the request it answers. */
export interface Headline {
  fn: EngineFn;
  args: Record<string, unknown>;
  value: number;
}

export interface Snapshot extends Figures {
  headlines: Headline[];
}

const SNAPSHOT: { title: string; fn: EngineFn; args: Record<string, unknown> }[] = [
  { title: "Safe to spend this week (estimate)", fn: "safeToSpend", args: { horizon: "week" } },
  { title: "Safe to spend until payday (estimate)", fn: "safeToSpend", args: { horizon: "until_payday" } },
  { title: "This calendar month so far, next to the usual by the same day", fn: "monthSoFar", args: {} },
  { title: "ONE-OFF amount that could be moved to savings today. Not a monthly amount", fn: "safeToSave", args: {} },
  { title: "The three baskets, last 3 months", fn: "baskets", args: { period: "last_3_months" } },
  { title: "Spending by category, last full month", fn: "spendBy", args: { period: "last_month" } },
  { title: "Spending by category, this month so far", fn: "spendBy", args: { period: "this_month" } },
  { title: "Spending per month (the newest month may be incomplete)", fn: "monthlyTrend", args: { metric: "spending", months: 6 } },
  { title: "Income per month", fn: "monthlyTrend", args: { metric: "income", months: 6 } },
  { title: "Moved to savings per month", fn: "monthlyTrend", args: { metric: "saving", months: 6 } },
  { title: "Monthly averages next to customers of the same age (context, not a target)", fn: "peerCompare", args: {} },
  { title: "Bills and saving transfers that repeat every month", fn: "recurring", args: {} },
];

const SNAPSHOT_ROWS = 30;
/** A looked-up result is cut to this many characters, so one broad lookup cannot crowd out the rest. */
const MAX_LOOKUP_CHARS = 4000;

/**
 * `blocks` is the dashboard: when the customer has said how much of the account is savings, that
 * is on their safe-to-spend card, and the snapshot's figures use the same amount as the card.
 */
export async function buildSnapshot(lookup: Lookup, blocks: Block[] = []): Promise<Snapshot> {
  const stated = blocks.flatMap((b) => (b.data.kind === "engine" && b.data.fn === "safeToSpend" && typeof b.data.args.reserve === "number" ? [b.data.args.reserve] : []))[0];
  const parts = await Promise.all(
    SNAPSHOT.map(async (entry) => {
      const { title, fn } = entry;
      const args = fn === "safeToSpend" && stated !== undefined ? { ...entry.args, reserve: stated } : entry.args;
      try {
        const result = await lookup(fn, args);
        return {
          text: describeResult(`${title} = ${requestLabel(fn, args)}`, result, SNAPSHOT_ROWS),
          numbers: resultNumbers(result),
          headline: typeof result.value === "number" ? { fn, args, value: result.value } : null,
        };
      } catch {
        return null; // one figure that cannot be computed should not cost the whole snapshot
      }
    }),
  );
  const ok = parts.filter((p) => p !== null);
  return {
    text: ok.map((p) => p.text).join("\n\n") || "(no figures available)",
    numbers: ok.flatMap((p) => p.numbers),
    headlines: ok.flatMap((p) => (p.headline ? [p.headline] : [])),
  };
}

/** Runs one lookup the model asked for. A wrong call comes back as a message the model can act on. */
export async function runLookup(lookup: Lookup, fn: EngineFn, args: Record<string, unknown>): Promise<Figures> {
  const label = requestLabel(fn, args);
  try {
    const result = await lookup(fn, validateEngineArgs(fn, args));
    return { text: describeResult(label, result, SNAPSHOT_ROWS).slice(0, MAX_LOOKUP_CHARS), numbers: resultNumbers(result) };
  } catch (e) {
    return { text: `${label}\n  could not be computed: ${e instanceof Error ? e.message : String(e)}`, numbers: [] };
  }
}
