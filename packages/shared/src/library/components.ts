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
import { widgets } from "./widgets";

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
    description:
      "Bars of spending by category, or within one category by merchant type. For a question about one kind of merchant " +
      "(taxis, fast food, a pharmacy) pass its code as mcc and leave category out: the figure is then for that merchant type alone.",
    examples: ["How much did I spend on taxis last month? (mcc 4121)", "Where did my money go this month?"],
    fn: "spendBy",
    args: ["period", "category", "by", "mcc"],
    build: (a) => catalog.categoryBars({ period: s(a.period), category: s(a.category), by: a.by as "category" | "merchant_type" | undefined, mcc: s(a.mcc) }),
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
    description: "What cutting one category, or one merchant type (mcc), by a percentage saves over a year, with a slider.",
    examples: ["What if I cut eating out by 20%?", "How much would I save with half the fast food? (mcc 5814)"],
    fn: "whatIf",
    args: ["category", "mcc", "cutPct"],
    build: (a) => catalog.whatIf(s(a.category), n(a.cutPct), s(a.mcc)),
  },
  peer_compare: {
    description: "The customer's monthly spending per category next to people in the same age band.",
    examples: ["How does my grocery spending compare with people my age?", "Am I spending more than others?"],
    fn: "peerCompare",
    args: ["category"],
    build: (a) => catalog.peers(s(a.category)),
  },
  finland_compare: {
    description:
      "The customer's monthly spending next to the average for their age group in Finland (Statistics Finland, in today's prices), " +
      "for housing, utilities, groceries, restaurants and transport. Use it for questions about the average person, Finns or Finland; " +
      "peer_compare is for other customers of the bank.",
    examples: ["Do I spend more on food than the average Finn?", "How does my spending compare with people my age in Finland?", "Is my rent normal?"],
    fn: "nationalCompare",
    args: ["category", "basis"],
    build: (a) => catalog.national(s(a.category), a.basis === "household" ? "household" : "one_adult"),
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
  goal_plan: {
    description:
      "A savings plan towards a target the USER gave: what is left, and the months and date at a monthly amount, next to saving more a month (extra) or meeting a deadline (byMonths), " +
      "with a slider for the extra amount. Use it once the user has given the target; goal_progress is for progress counted from the account's own transfers.",
    examples: ["I want to save 25 000 € for a home and I have 10 000 €", "What if I saved 100 € more a month towards it?", "Can I get there in two years?"],
    fn: "goalPlan",
    args: ["target", "saved", "monthly", "extra", "byMonths", "label"],
    build: (a) => {
      if (n(a.target) === undefined) throw new EngineArgumentError("goal_plan needs target: the amount the user wants to reach. Ask them for it first.");
      return custom.goalPlan({ target: n(a.target), saved: n(a.saved), monthly: n(a.monthly), extra: n(a.extra), byMonths: n(a.byMonths), label: s(a.label) });
    },
  },
  saving_options: {
    description:
      "Where everyday spending could be cut, per category, and what a cut would free each month, with a slider for the size of the cut. Essentials are never included; protect lists what the user wants to keep.",
    examples: ["Where could I save?", "I want to keep travelling: what else could I cut?"],
    fn: "savingsOptions",
    args: ["protect", "cutPct"],
    build: (a) => custom.savingOptions(Array.isArray(a.protect) ? (a.protect as string[]) : [], n(a.cutPct)),
  },
  spending_donut: {
    description: "Donut chart of spending by category: top five plus Other. With a category, the donut splits that category by merchant type.",
    examples: ["Show my spending as a donut chart", "What share does each category take?"],
    fn: "spendBy",
    args: ["period", "category"],
    build: (a) => custom.donut(s(a.period), s(a.category)),
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
  spending_city: {
    description:
      "Showpiece: an interactive 3D city with one tower per spending category, as tall as the amount. Tap a tower for its figure; in full screen it can be rotated and zoomed. Pick this when the user asks for 3D, something impressive, or to explore their spending.",
    examples: ["Show my spending in 3D", "Give me a cool view of where my money goes"],
    fn: "spendBy",
    args: ["period"],
    build: (a) => widgets.city(s(a.period)),
  },
  money_story: {
    description:
      "Showpiece: a step-by-step story from the balance today, through each bill and buffer, down to what is safe to spend, with Back and Next. Pick this when the user asks to be walked through it, for a story, or why the safe amount is what it is.",
    examples: ["Walk me through how much I can spend", "Tell me the story of my money this month"],
    fn: "safeToSpend",
    args: ["horizon"],
    build: (a) => widgets.story(a.horizon === "until_payday" ? "until_payday" : "week"),
  },
  savings_jar: {
    description:
      "Animated 3D jar that fills with coins up to the saving goal. Same figures as goal_progress; pick this when the user wants to see, visualise or feel their progress.",
    examples: ["Show me my savings goal", "Visualise how close I am to my down payment"],
    fn: "goalProgress",
    args: ["target", "label"],
    build: (a) => widgets.jar(n(a.target), s(a.label)),
  },
  safe_gauge: {
    description:
      "Animated gauge of the safe-to-spend amount, with the deductions appearing one by one. Same figures as safe_to_spend; pick this when the user asks to see how it is worked out or wants a visual.",
    examples: ["Show me how my safe-to-spend is worked out", "Visualise what I can spend this week"],
    fn: "safeToSpend",
    args: ["horizon"],
    build: (a) => widgets.gauge(a.horizon === "until_payday" ? "until_payday" : "week"),
  },
  money_flow: {
    description:
      "Animated streams of spending flowing into the three baskets. Same figures as baskets; pick this for 'where does my money go/flow' or when the user wants an animation.",
    examples: ["Show me where my money flows", "Animate where my money went"],
    fn: "baskets",
    args: ["period"],
    build: (a) => widgets.flow(s(a.period)),
  },
  whatif_coins: {
    description:
      "Interactive pile of coins showing a year of savings from cutting one category; the slider adds and removes coins. Same figures as what_if; pick this when the user wants to play with or see the saving.",
    examples: ["Let me play with cutting my restaurant spending", "Show what I'd save as coins"],
    fn: "whatIf",
    args: ["category", "cutPct"],
    build: (a) => widgets.coins(s(a.category), n(a.cutPct)),
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
  return { ...def.build(validateEngineArgs(def.fn, args)), component: id };
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
