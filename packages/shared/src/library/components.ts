/**
 * The component library: every ready-made card the agent can add by name with `use_component`.
 * Common questions should land here, so they get the same tested card every time instead of
 * a newly written view. Each entry wraps a factory from catalog.ts or custom.ts.
 */
import type { Block } from "../blocks";
import { ENGINE_ARG_SPECS, EngineArgumentError, validateEngineArgs } from "../engine/args";
import type { EngineFn } from "../engine/types";
import { catalog } from "./catalog";
import { custom } from "./custom";

export interface ComponentDef {
  description: string;
  /** Typical questions it answers; shown to the model. */
  examples: string[];
  /** The engine function behind the card. */
  fn: EngineFn;
  /** The engine arguments the model may set (a subset of the function's). */
  args: readonly string[];
  /** Builds the card from checked arguments; anything not given uses the factory default. */
  build(args: Record<string, unknown>): Block;
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : undefined);

export const COMPONENTS = {
  safe_to_spend: {
    description: "Headline figure: how much is safe to spend this week or until payday, with how it was worked out.",
    examples: ["What can I spend this week?", "How much do I have left until payday?"],
    fn: "safeToSpend",
    args: ["horizon"],
    build: (a) => catalog.safeToSpend(a.horizon === "until_payday" ? "until_payday" : "week"),
  },
  category_bars: {
    description: "Bars of spending by category, or within one category by merchant type (taxis, cafés, fuel...).",
    examples: ["How much did I spend on taxis last month?", "Where did my money go this month?"],
    fn: "spendBy",
    args: ["period", "category", "by"],
    build: (a) => catalog.categoryBars({ period: s(a.period), category: s(a.category), by: a.by as "category" | "merchant_type" | undefined }),
  },
  spending_trend: {
    description: "Line of one figure per month: spending (optionally one category), income, saving or net.",
    examples: ["Show my income per month", "Is my grocery spending going up?"],
    fn: "monthlyTrend",
    args: ["metric", "category", "months"],
    build: (a) => catalog.trend({ metric: a.metric as "spending" | "income" | "net" | "saving" | undefined, category: s(a.category), months: n(a.months) }),
  },
  baskets: {
    description: "The three spending baskets: regular essentials, unexpected necessities, everyday spending.",
    examples: ["What kind of spender am I?", "How much goes on essentials vs everyday stuff?"],
    fn: "baskets",
    args: ["period"],
    build: (a) => catalog.baskets(s(a.period)),
  },
  balance_forecast: {
    description: "Account balance by day up to payday: actual history, then a forecast.",
    examples: ["Will I run out before payday?", "What will my balance be at the end of the month?"],
    fn: "balanceForecast",
    args: [],
    build: () => catalog.forecast(),
  },
  what_if: {
    description: "What cutting one category by a percentage saves over a year, with a slider.",
    examples: ["What if I cut eating out by 20%?", "How much would I save spending less on clothes?"],
    fn: "whatIf",
    args: ["category", "cutPct"],
    build: (a) => catalog.whatIf(s(a.category), n(a.cutPct)),
  },
  peer_compare: {
    description: "The customer's monthly spending per category next to people in the same age band.",
    examples: ["How does my grocery spending compare with people my age?", "Am I spending more than others?"],
    fn: "peerCompare",
    args: ["category"],
    build: (a) => catalog.peers(s(a.category)),
  },
  spending_calendar: {
    description: "Calendar heatmap of spending per day; tap a day for its payments.",
    examples: ["Show my spending per day", "Which days did I spend the most?"],
    fn: "dailySpend",
    args: ["period"],
    build: (a) => catalog.calendar(s(a.period)),
  },
  recurring_bills: {
    description: "List of bills, subscriptions and saving transfers that repeat every month.",
    examples: ["Show my bills", "What subscriptions do I have?"],
    fn: "recurring",
    args: [],
    build: () => catalog.recurring(),
  },
  goal_progress: {
    description: "Progress towards a saving goal (a target in euros and a label), at the current saving rate.",
    examples: ["How am I doing on my savings goal?", "When will I have €10,000 for a down payment?"],
    fn: "goalProgress",
    args: ["target", "label"],
    build: (a) => catalog.goal(n(a.target), s(a.label)),
  },
  spending_donut: {
    description: "Donut chart of spending by category: top five plus Other.",
    examples: ["Show my spending as a donut chart", "What share does each category take?"],
    fn: "spendBy",
    args: ["period"],
    build: (a) => custom.donut(s(a.period)),
  },
  weekday_pattern: {
    description: "Bars of total spending per day of the week, biggest day highlighted.",
    examples: ["Which day of the week do I spend the most?", "Do I spend more at weekends?"],
    fn: "dailySpend",
    args: ["period"],
    build: (a) => custom.weekday(s(a.period)),
  },
  spending_pace: {
    description: "Running total of spending within each of the last months, one line per month, to compare pace.",
    examples: ["Am I spending faster than in previous months?", "Am I on track this month?"],
    fn: "dailySpend",
    args: [],
    build: () => custom.pace(),
  },
  waffle_100: {
    description: "Widget: a 10×10 waffle showing where each €100 spent goes.",
    examples: ["Where does each €100 I spend go?"],
    fn: "spendBy",
    args: ["period"],
    build: (a) => custom.waffle(s(a.period)),
  },
  month_receipt: {
    description: "Widget: the period's spending per category printed as a shop receipt.",
    examples: ["Print last month as a receipt", "Give me a summary of last month's spending"],
    fn: "spendBy",
    args: ["period"],
    build: (a) => custom.receipt(s(a.period)),
  },
} satisfies Record<string, ComponentDef>;

export type ComponentId = keyof typeof COMPONENTS;
export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];

export const isComponentId = (v: unknown): v is ComponentId => typeof v === "string" && v in COMPONENTS;

/**
 * Checks `args` against what the component accepts and builds its card.
 * Throws EngineArgumentError with a message that is safe to send back to the model.
 */
export function buildComponent(id: ComponentId, args: Record<string, unknown> = {}): Block {
  const def: ComponentDef = COMPONENTS[id];
  for (const key of Object.keys(args)) {
    if (args[key] === undefined || args[key] === null || args[key] === "") continue;
    if (!def.args.includes(key)) {
      throw new EngineArgumentError(`${id} does not take "${key}". ${def.args.length ? `Allowed: ${def.args.join(", ")}.` : "It takes no arguments."}`);
    }
  }
  return def.build(validateEngineArgs(def.fn, args));
}

/** The library as plain text for the system prompt. */
export function libraryCatalogText(): string {
  const lines = COMPONENT_IDS.map((id) => {
    const def: ComponentDef = COMPONENTS[id];
    const args = def.args.length ? def.args.map((a) => `${a} (see ${def.fn})`).join(", ") : "none";
    return `- ${id}: ${def.description}\n  args (all optional): ${args}\n  e.g. ${def.examples.map((e) => `"${e}"`).join(", ")}`;
  });
  return ["COMPONENT LIBRARY (use_component)", ...lines].join("\n");
}

// Keep the library honest: every listed argument must exist on its engine function.
for (const id of COMPONENT_IDS) {
  const def: ComponentDef = COMPONENTS[id];
  for (const a of def.args) if (!(a in ENGINE_ARG_SPECS[def.fn])) throw new Error(`component ${id}: ${def.fn} has no argument ${a}`);
}
