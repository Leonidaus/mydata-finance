/**
 * What the language model is told about the engine and the views: names, arguments and the
 * column names of each function's rows. Metadata only: no customer data ever goes in here.
 */
import { ENGINE_ARG_SPECS } from "../engine/args";
import type { EngineFn } from "../engine/types";
import { DATASET_MCC_CODES, lookupMcc } from "../mcc";
import { PERIODS, SPENDING_CATEGORIES } from "../engine/util";
import type { TemplateId } from "../blocks";

export interface EngineDoc {
  description: string;
  /** Column names of `rows`, with what they hold. */
  rows: string;
  /** Unit of the headline `value`, if the function has one. */
  unit?: string;
}

export const ENGINE_DOCS: Record<EngineFn, EngineDoc> = {
  spendBy: {
    description:
      "Money spent in a period, grouped by category or by merchant type (MCC). Optional category narrows to one category; " +
      "optional mcc narrows to one merchant type (taxis, fast food, pharmacies, ...), and the value is then the total for that merchant type alone.",
    rows: "key (category or MCC code), label, category, amount (€, positive), count (payments). Sorted by amount, biggest first.",
    unit: "€ total",
  },
  monthlyTrend: {
    description:
      "One figure per calendar month for the last N months: spending, income, net (income minus spending) or saving. " +
      "Optional category or mcc (one merchant type) for spending.",
    rows: "month (YYYY-MM), amount (€)",
    unit: "€/month average",
  },
  baskets: {
    description: "Spending in a period split into the three baskets: regular essentials, unexpected necessities, everyday spending.",
    rows: "basket (regular | irregular | everyday), label, amount (€), count",
    unit: "€ total",
  },
  dailySpend: {
    description: "Spending per day in a period. Good for calendars and weekday patterns.",
    rows: "date (YYYY-MM-DD), amount (€)",
  },
  safeToSpend: {
    description:
      "How much of this pay period's money is left to spend this week or until payday, after bills, essentials, saving and a buffer. " +
      "Money that was on the account before the last salary is a reserve and is not counted, so a large balance does not make a large figure. " +
      "reserve: how much of the account the USER says is savings (0 when all of it is for spending); it replaces the reserve worked out from the last salary.",
    rows:
      "term (text), amount (€; negative terms are deductions), kind (balance | reserve | expected | subtotal | precaution | result). " +
      "expected rows are bills and living costs still to come. precaution rows are money the app suggests keeping available (planned = the full allowance, " +
      "coveredByReserve = the part the reserve pays for); they are not bills or spending. The subtotal is what is left after expected costs, before precautions. The last row is the result.",
    unit: "€",
  },
  safeToSave: {
    description: "How much can be moved to savings now, keeping a cushion of one month of regular essentials.",
    rows: "term (text), amount (€), kind (balance | expected | precaution | result). precaution rows are money kept available, not bills. The last row is the result.",
    unit: "€",
  },
  balanceForecast: {
    description: "Account balance by day up to the next payday: actual history followed by a forecast.",
    rows: "date (YYYY-MM-DD), balance (€), kind (Actual | Forecast)",
    unit: "€ projected balance on payday",
  },
  whatIf: {
    description: "What cutting one category, or one merchant type (mcc), by cutPct percent would save over a year.",
    rows: "month (1..12), saved (€ cumulative)",
    unit: "€ per year",
  },
  peerCompare: {
    description: "The customer's monthly average per category next to the average of customers in the same age band.",
    rows: "category, who (You | Peers <band>), amount (€/month)",
  },
  nationalCompare: {
    description:
      "The customer's monthly average next to what people in Finland in the same age group spend, from Statistics Finland's open data " +
      "(2022 consumption survey raised to today's prices). Covers Housing, Utilities, Groceries, Restaurants and Transportation. " +
      "basis one_adult (default) compares with one adult; household with a whole household.",
    rows: "category, who (You | Finland <age group>), amount (€/month); You rows also have difference (€/month, you minus Finland)",
  },
  recurring: {
    description: "Bills and saving transfers that repeat every month.",
    rows: "label, category, amount (€/month), payments (per month), day (of month), months (seen), lastDate, type (Bill | Saving)",
    unit: "€/month of bills",
  },
  goalProgress: {
    description: "Progress towards a saving goal of `target` euros, at the customer's current saving rate.",
    rows: "label, saved (€), target (€), rate (€/month)",
    unit: "% of target",
  },
  goalPlan: {
    description:
      "A plan towards a savings goal from figures the USER gives: months and date to reach target at a monthly amount, and whether that fits what is left over after spending. " +
      "target is required; saved is what the user says is already set aside (the account cannot tell); monthly defaults to the current saving pace; " +
      "extra adds a row for saving that much more a month (extraFrom spending_cut when it comes from spending less, so the cut pays for it); byMonths adds a row with the monthly amount a deadline needs. No interest is assumed.",
    rows: "scenario, monthly (€/month), months (to go), reached (month/year), sooner (months earlier than the first row), leftOver (€/month still left after spending and this saving), fits (yes | no), summary (text)",
    unit: "€ still to save",
  },
  savingsOptions: {
    description:
      "Where everyday spending could be cut: per category, the monthly average and what cutting it by cutPct (default 20) would free each month. " +
      "Essentials are never included; protect lists the categories the user wants to keep. Rows do not overlap, so savings can be added.",
    rows: "category, monthly (€/month now), saving (€/month freed), perYear (€)",
    unit: "€/month freed in total",
  },
  monthSoFar: {
    description:
      "The calendar month up to today: money in, money out per basket, what was moved to savings and what is left, next to the usual by the same day of the month. " +
      "For questions like how is this month going, am I spending more than usual, how do my income and spending balance.",
    rows: "term (text), amount (€; negative is money out), usualByNow (€, the average of the same days in the last 3 months). The last row is what is left.",
    unit: "€ left of this month's money so far",
  },
  goalReview: {
    description:
      "How a savings plan is going since it started: per month, what the plan asked for and what was really moved to savings, whether the user is on plan, " +
      "and when the target is reached at the agreed amount and at the pace so far. target and monthly are required; saved is what was set aside before the plan; " +
      "since is the month the plan started (YYYY-MM; this month when left out). Take them from the plan card or from the user.",
    rows: "month (YYYY-MM), planned (€ cumulative), moved (€ cumulative, moved to savings), movedThisMonth (€), leftOnAccount (€ left that month without being moved), status (complete | in progress)",
    unit: "€ set aside so far",
  },
  itemSpend: {
    description:
      "Money from the receipts the user has photographed and linked to card payments. The bank data has no shop names and no items; receipts have both. " +
      "per item_type (default): per kind of item (sweets, alcohol, ready meals, fuel, ...). per shop: per shop name as printed on the receipts. " +
      "shop: only receipts from a shop with this in its name (\"how much at Alko\"). search: only item lines with these words in their name, each word starting a word on the line (\"tip man\" finds tips to Man; \"man\" does not find Woman). Several lookups compare them, e.g. search \"man\" and search \"woman\" (\"cola\", \"energy drink\", a person's name on a line); the lines themselves are never shown. " +
      "subcategory: one kind of item. category: the bank category of the payments (e.g. Groceries). Without period: since the first matching receipt. " +
      "Only payments with a receipt count: the summary says how many receipts, over which dates, and what share of that spending they cover.",
    rows: "key (sub-category id, or the shop name in lower case), label, amount (€), count (lines), trips (receipts). Biggest first.",
    unit: "€ in total for what was asked",
  },
  itemTrend: {
    description:
      "Per calendar month, the money on linked receipts: for one kind of item (subcategory), one shop (shop), lines with a word (search) or one bank category, over the last months (default 12, this month included). " +
      "A month without receipts is 0 because nothing was photographed, not because nothing was spent: say so when it matters.",
    rows: "month (YYYY-MM), amount (€), receipts (linked receipts that month)",
    unit: "€ in total over the months",
  },
  afford: {
    description:
      "Whether a one-off price fits: what is safe to spend until payday, minus amount (required, the price in euros). " +
      "kind necessity is for a cost the user could not plan for (a repair, a dentist's bill): it may also use the buffer for unexpected necessities. " +
      "The summary says whether it fits, fits tightly, would come out of the reserve, or is a savings goal. label names the thing; reserve as for safeToSpend. " +
      "price estimate when the amount is your own estimate of a typical price and not one the user gave or the app read: the result then says it is an estimate.",
    rows: "term (text), amount (€; the price is negative). The last row is what is left, or what is missing when negative.",
    unit: "€ left until payday after paying (negative: missing)",
  },
};

/** The column names of each function's rows: what a custom view may read. Checked against the engine in the tests. */
export const ENGINE_COLUMNS: Record<EngineFn, readonly string[]> = {
  spendBy: ["key", "label", "category", "amount", "count"],
  monthlyTrend: ["month", "amount"],
  baskets: ["basket", "label", "amount", "count"],
  dailySpend: ["date", "amount"],
  safeToSpend: ["term", "amount", "kind"],
  safeToSave: ["term", "amount", "kind"],
  balanceForecast: ["date", "balance", "kind"],
  whatIf: ["month", "saved"],
  peerCompare: ["category", "who", "amount"],
  nationalCompare: ["category", "who", "amount", "difference"],
  recurring: ["label", "category", "amount", "payments", "day", "months", "lastDate", "type"],
  goalProgress: ["label", "saved", "target", "rate"],
  goalPlan: ["scenario", "monthly", "months", "reached", "sooner", "leftOver", "fits", "summary"],
  savingsOptions: ["category", "monthly", "saving", "perYear"],
  monthSoFar: ["term", "amount", "usualByNow"],
  goalReview: ["month", "planned", "moved", "movedThisMonth", "leftOnAccount", "status"],
  afford: ["term", "amount"],
  itemSpend: ["key", "label", "amount", "count", "trips"],
  itemTrend: ["month", "amount", "receipts"],
};

/** Which engine functions each built-in template can draw. */
export const TEMPLATE_FNS: Record<TemplateId, readonly EngineFn[]> = {
  stat: ["safeToSpend", "safeToSave", "monthSoFar", "afford"],
  category_bars: ["spendBy", "itemSpend"],
  trend_line: ["monthlyTrend", "itemTrend"],
  baskets: ["baskets"],
  balance_forecast: ["balanceForecast"],
  what_if: ["whatIf"],
  peer_compare: ["peerCompare", "nationalCompare"],
  calendar_heatmap: ["dailySpend"],
  recurring_list: ["recurring"],
  goal_progress: ["goalProgress"],
};

function describeArg(spec: (typeof ENGINE_ARG_SPECS)[EngineFn][string]): string {
  switch (spec.type) {
    case "enum":
      return `one of ${spec.values.join(" | ")}`;
    case "category":
      return spec.only ? `one of ${spec.only.join(" | ")}` : `a spending category`;
    case "categories":
      return `a list of spending categories`;
    case "month":
      return `a month as YYYY-MM`;
    case "mcc":
      return `a four-digit merchant type code, see MERCHANT TYPES; do not combine with category`;
    case "number":
      return `number ${spec.min}..${spec.max}${spec.integer ? ", whole" : ""}`;
    case "text":
      return `text, at most ${spec.maxLength} characters`;
  }
}

/** A merchant type the customer has paid at, as it appears in their own transactions. */
export interface UsedMerchantType {
  code: string;
  label: string;
  category?: string;
}

/**
 * The merchant types the coach is told about: the ones the bank's data is known to contain, and
 * any others this customer has paid at. The full code list has hundreds of entries; listing all
 * of them would crowd the prompt and say nothing about this customer.
 */
function merchantTypeLines(used: readonly UsedMerchantType[]): string[] {
  const lines = new Map<string, string>();
  for (const code of DATASET_MCC_CODES) {
    const info = lookupMcc(code);
    if (info) lines.set(code, `- ${code}: ${info.label} (${info.category})`);
  }
  for (const { code, label, category } of used) {
    if (!lines.has(code)) lines.set(code, `- ${code}: ${label}${category ? ` (${category})` : ""}, which this customer has used`);
  }
  return [...lines.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, line]) => line);
}

/** The engine catalog as plain text for the system prompt. */
export function engineCatalogText(used: readonly UsedMerchantType[] = []): string {
  const fns = Object.entries(ENGINE_DOCS).map(([fn, doc]) => {
    const args = Object.entries(ENGINE_ARG_SPECS[fn as EngineFn]);
    const argText = args.length ? args.map(([k, s]) => `${k}: ${describeArg(s)}`).join("; ") : "none";
    return `- ${fn}: ${doc.description}\n  args (all optional): ${argText}\n  rows: ${doc.rows}${doc.unit ? `\n  value: ${doc.unit}` : ""}`;
  });
  const templates = Object.entries(TEMPLATE_FNS).map(([t, fns]) => `- ${t}: for ${fns.join(", ")}`);
  return [
    "ENGINE FUNCTIONS",
    ...fns,
    "",
    `Periods: ${Object.keys(PERIODS).join(", ")}`,
    `Spending categories: ${SPENDING_CATEGORIES.join(", ")}`,
    "",
    "MERCHANT TYPES (mcc)",
    "When the question is about one kind of merchant (taxis, fast food, a pharmacy), pass its code as mcc, so the figure is",
    "for exactly that and not for the whole category. A category is broader: Transportation also holds fuel, parking and public transport.",
    ...merchantTypeLines(used),
    "Other four-digit merchant category codes (ISO 18245) are accepted too; use one only when you are sure of it.",
    "",
    "TEMPLATES (view_kind = template)",
    ...templates,
  ].join("\n");
}
