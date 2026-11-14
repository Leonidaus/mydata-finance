/**
 * What the language model is told about the engine and the views: names, arguments and the
 * column names of each function's rows. Metadata only: no customer data ever goes in here.
 */
import { ENGINE_ARG_SPECS } from "../engine/args";
import type { EngineFn } from "../engine/types";
import { MCC_CODES } from "../mcc";
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
    rows: "key (category or MCC code), label, amount (€, positive), count (payments). Sorted by amount, biggest first.",
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
    description: "How much the customer can safely spend this week or until payday, after bills, essentials, saving and a buffer.",
    rows: "term (text), amount (€; negative terms are deductions). The last row is the result.",
    unit: "€",
  },
  safeToSave: {
    description: "How much can be moved to savings now, keeping a cushion of one month of regular essentials.",
    rows: "term (text), amount (€). The last row is the result.",
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
};

/** The column names of each function's rows: what a custom view may read. Checked against the engine in the tests. */
export const ENGINE_COLUMNS: Record<EngineFn, readonly string[]> = {
  spendBy: ["key", "label", "amount", "count"],
  monthlyTrend: ["month", "amount"],
  baskets: ["basket", "label", "amount", "count"],
  dailySpend: ["date", "amount"],
  safeToSpend: ["term", "amount"],
  safeToSave: ["term", "amount"],
  balanceForecast: ["date", "balance", "kind"],
  whatIf: ["month", "saved"],
  peerCompare: ["category", "who", "amount"],
  nationalCompare: ["category", "who", "amount", "difference"],
  recurring: ["label", "category", "amount", "payments", "day", "months", "lastDate", "type"],
  goalProgress: ["label", "saved", "target", "rate"],
};

/** Which engine functions each built-in template can draw. */
export const TEMPLATE_FNS: Record<TemplateId, readonly EngineFn[]> = {
  stat: ["safeToSpend", "safeToSave"],
  category_bars: ["spendBy"],
  trend_line: ["monthlyTrend"],
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
    case "mcc":
      return `a merchant type code from MERCHANT TYPES; do not combine with category`;
    case "number":
      return `number ${spec.min}..${spec.max}${spec.integer ? ", whole" : ""}`;
    case "text":
      return `text, at most ${spec.maxLength} characters`;
  }
}

/** The engine catalog as plain text for the system prompt. */
export function engineCatalogText(): string {
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
    ...Object.entries(MCC_CODES).map(([code, info]) => `- ${code}: ${info.label} (${info.category})`),
    "",
    "TEMPLATES (view_kind = template)",
    ...templates,
  ].join("\n");
}
