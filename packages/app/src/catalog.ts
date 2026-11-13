/**
 * Ready-made block factories, one per template. The default dashboard and the stand-in agent
 * use these; the LLM tools (phase 2) will expose the same templates and arguments.
 */
import { type Block, type Control, PERIODS, SPENDING_CATEGORIES } from "@mydata/shared";

let seq = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const periodControl: Control = { kind: "period", arg: "period" };
const categoryControl = (withAll: boolean): Control => ({
  kind: "select",
  arg: "category",
  label: "Category",
  options: [...(withAll ? [{ value: "", label: "All categories" }] : []), ...SPENDING_CATEGORIES.map((c) => ({ value: c, label: c }))],
});

export const PERIOD_OPTIONS = Object.entries(PERIODS).map(([value, label]) => ({ value, label }));

export const catalog = {
  safeToSpend: (horizon: "week" | "until_payday" = "week"): Block => ({
    id: id("safe"),
    title: horizon === "week" ? "Safe to spend this week" : "Safe to spend until payday",
    explanation:
      "Your balance today, minus regular bills and planned saving still due before payday, minus a buffer for unexpected costs based on your last 12 months. The rest is spread evenly over the days until payday.",
    source: "estimate",
    data: { kind: "engine", fn: "safeToSpend", args: { horizon } },
    view: { kind: "template", template: "stat" },
    controls: [
      {
        kind: "select",
        arg: "horizon",
        label: "Horizon",
        options: [
          { value: "week", label: "This week" },
          { value: "until_payday", label: "Until payday" },
        ],
      },
    ],
  }),

  categoryBars: (opts: { period?: string; category?: string; by?: "category" | "merchant_type"; title?: string } = {}): Block => ({
    id: id("bars"),
    title: opts.title ?? (opts.category ? `${opts.category} by merchant type` : "Spending by category"),
    explanation: opts.category
      ? `All your card purchases in ${opts.category} for the chosen period, grouped by the type of merchant (merchant category code).`
      : "All money going out for the chosen period, grouped by the category your bank assigned. Income and transfers to savings are left out.",
    source: "own",
    data: {
      kind: "engine",
      fn: "spendBy",
      args: { period: opts.period ?? "last_month", by: opts.by ?? (opts.category ? "merchant_type" : "category"), category: opts.category ?? "" },
    },
    view: { kind: "template", template: "category_bars" },
    controls: [periodControl, categoryControl(true)],
  }),

  trend: (opts: { metric?: "spending" | "income" | "net" | "saving"; category?: string; months?: number } = {}): Block => ({
    id: id("trend"),
    title: opts.category ? `${opts.category} per month` : `${capitalise(opts.metric ?? "spending")} per month`,
    explanation: "Monthly totals for full calendar months, so the current, unfinished month is left out.",
    source: "own",
    data: { kind: "engine", fn: "monthlyTrend", args: { metric: opts.metric ?? "spending", category: opts.category ?? "", months: opts.months ?? 12 } },
    view: { kind: "template", template: "trend_line" },
    controls: [
      {
        kind: "select",
        arg: "metric",
        label: "Show",
        options: [
          { value: "spending", label: "Spending" },
          { value: "income", label: "Income" },
          { value: "saving", label: "Saving" },
          { value: "net", label: "Net (in − out)" },
        ],
      },
      categoryControl(true),
    ],
  }),

  baskets: (period = "last_3_months"): Block => ({
    id: id("baskets"),
    title: "Your three spending baskets",
    explanation:
      "Regular essentials are housing, utilities and anything that repeats monthly at a similar amount. Unexpected necessities are purchases in Home & Tech, Lifestyle, Travel or Health at least 2.5× your usual purchase there. Everything else is everyday spending.",
    source: "own",
    data: { kind: "engine", fn: "baskets", args: { period } },
    view: { kind: "template", template: "baskets" },
    controls: [periodControl],
  }),

  forecast: (): Block => ({
    id: id("forecast"),
    title: "Balance until payday",
    explanation:
      "The last 30 days are your actual balance. After today it is a forecast: your usual everyday spending per day, bills on their usual dates, and the buffer for unexpected costs.",
    source: "estimate",
    data: { kind: "engine", fn: "balanceForecast", args: {} },
    view: { kind: "template", template: "balance_forecast" },
  }),

  whatIf: (category = "Restaurants", cutPct = 20): Block => ({
    id: id("whatif"),
    title: `What if I cut ${category}?`,
    explanation: `Your average monthly spending on ${category} over the last 12 months, times the cut you choose, added up month by month for a year.`,
    source: "estimate",
    data: { kind: "engine", fn: "whatIf", args: { category, cutPct } },
    view: { kind: "template", template: "what_if" },
    controls: [
      categoryControl(false),
      { kind: "slider", arg: "cutPct", label: "Cut by", min: 0, max: 100, step: 5, unit: "%" },
    ],
  }),

  peers: (category = ""): Block => ({
    id: id("peers"),
    title: "You vs people your age",
    explanation:
      "Your monthly average over the last 12 months next to the average of all customers in your age band in this dataset (synthetic S-Pankki data).",
    source: "peer",
    data: { kind: "engine", fn: "peerCompare", args: { category } },
    view: { kind: "template", template: "peer_compare" },
    controls: [categoryControl(true)],
  }),

  calendar: (period = "last_3_months"): Block => ({
    id: id("calendar"),
    title: "Spending per day",
    explanation: "Total money out per day. Darker days are bigger spending days; tap a day to see what happened.",
    source: "own",
    data: { kind: "engine", fn: "dailySpend", args: { period } },
    view: { kind: "template", template: "calendar_heatmap" },
    controls: [periodControl],
  }),

  recurring: (): Block => ({
    id: id("recurring"),
    title: "Bills and regular payments",
    explanation: "Payments that came in at least 6 of the last 12 months at a similar amount, plus housing, utilities and savings transfers.",
    source: "own",
    data: { kind: "engine", fn: "recurring", args: {} },
    view: { kind: "template", template: "recurring_list" },
  }),

  goal: (target?: number, label?: string): Block => ({
    id: id("goal"),
    title: label ?? "Savings goal",
    explanation:
      "Saved = transfers to investments and savings minus withdrawals. The time to go uses your average net saving over the last 6 months. Without a goal set, it uses your mortgage down payment or a 3-month emergency fund.",
    source: "estimate",
    data: { kind: "engine", fn: "goalProgress", args: { ...(target ? { target } : {}), ...(label ? { label } : {}) } },
    view: { kind: "template", template: "goal_progress" },
  }),
};

export function defaultDashboard(): Block[] {
  return [catalog.safeToSpend(), catalog.baskets(), catalog.categoryBars(), catalog.forecast()];
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
