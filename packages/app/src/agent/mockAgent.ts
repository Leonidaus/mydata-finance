/**
 * Stand-in for the LLM until the backend exists (phase 2): keyword rules that return the same
 * DashboardOp edits the model will produce through tool calls. Replace `respond` with a call to
 * /api/chat and keep the rest of the app unchanged.
 */
import {
  type Block,
  type DashboardOp,
  type EngineFn,
  type EngineResult,
  type Period,
  PERIODS,
  SPENDING_CATEGORIES,
  type TemplateId,
} from "@mydata/shared";
import { custom } from "../blocks/custom";
import { catalog } from "../catalog";
import { formatEur } from "../format";

export interface AgentReply {
  text: string;
  ops: DashboardOp[];
}

/** Runs an engine function for the customer being answered, through the app's data source. */
export type RunEngine = (fn: EngineFn, args?: Record<string, unknown>) => Promise<EngineResult>;

const CATEGORY_WORDS: [RegExp, string][] = [
  [/restaurant|dining|eating out|eat out|takeaway|coffee|cafe/, "Restaurants"],
  [/grocer|food shop|supermarket/, "Groceries"],
  [/transport|bus|train|commut|fuel|taxi/, "Transportation"],
  [/travel|holiday|flight|trip/, "Travel"],
  [/entertainment|stream|games?|movie|concert/, "Entertainment"],
  [/lifestyle|cloth|shopping/, "Lifestyle"],
  [/health|pharmac|doctor|dentist/, "Health"],
  [/home|tech|electronic|furniture/, "Home & Tech"],
  [/rent|housing/, "Housing"],
  [/utilit|electric|water bill/, "Utilities"],
];

const PERIOD_WORDS: [RegExp, Period][] = [
  [/last 30 days|past month/, "last_30_days"],
  [/this month/, "this_month"],
  [/last month|previous month/, "last_month"],
  [/(last|past) (3|three) months|quarter/, "last_3_months"],
  [/(last|past) (12|twelve) months|last year|past year|this year/, "last_12_months"],
];

const findCategory = (q: string) => CATEGORY_WORDS.find(([re]) => re.test(q))?.[1];
const findPeriod = (q: string) => PERIOD_WORDS.find(([re]) => re.test(q))?.[1];
const findPercent = (q: string) => {
  const m = /(\d{1,3})\s*(%|percent|per cent)/.exec(q);
  return m ? Math.min(100, Number(m[1])) : undefined;
};
const findEuros = (q: string) => {
  const m = /(?:€\s*)?(\d[\d\s,.]*\d|\d)\s*(?:€|eur|euros?)?/.exec(q.replace(/(\d)[\s,](\d{3})/g, "$1$2"));
  return m ? Number(m[1].replace(/[\s,]/g, "")) : undefined;
};

/** The arguments that decide what a block is about, e.g. which category. Period and cut size are settings. */
const SUBJECT_ARGS = ["category", "metric", "by", "label"];
const subject = (b: Block) =>
  b.data.kind === "engine" ? `${b.data.fn}|${SUBJECT_ARGS.map((k) => String((b.data as { args: Record<string, unknown> }).args[k] ?? "")).join("|")}` : b.id;

/** Add a block, or update an existing block about the same subject and move it to the top. */
function place(blocks: Block[], block: Block): DashboardOp[] {
  const tpl = (b: Block): TemplateId | undefined => (b.view.kind === "template" ? b.view.template : undefined);
  const same = blocks.find((b) => tpl(b) === tpl(block) && subject(b) === subject(block));
  if (same) {
    const { id: _id, ...patch } = block;
    return [
      { op: "update_block", id: same.id, patch },
      { op: "move_block", id: same.id, index: 0 },
    ];
  }
  return [{ op: "add_block", block, index: 0 }];
}

/** Example prompts for the chat chips and the dev gallery, grouped by the kind of block they create. */
export const DEMO_PROMPTS: { group: string; note: string; prompts: string[] }[] = [
  {
    group: "Templates",
    note: "Ready-made views; the AI only picks the template and its arguments.",
    prompts: [
      "How much did I spend on taxis last month?",
      "What is safe for me to spend this week?",
      "What kind of spender am I?",
      "What if I cut eating out by 20%?",
      "Show my bills",
      "How am I doing on my savings goal?",
      "Will I run out before payday?",
      "Show my income per month",
      "Show my spending per day",
      "How does my grocery spending compare with people my age?",
    ],
  },
  {
    group: "Custom chart (Vega-Lite spec)",
    note: "No template fits, so the AI writes a Vega-Lite spec; the app injects the engine rows.",
    prompts: ["Show my spending as a donut chart", "Which day of the week do I spend the most?", "Am I spending faster than in previous months?"],
  },
  {
    group: "Custom widget (sandboxed iframe)",
    note: "The AI writes HTML/JS that runs in a sandboxed iframe with no network access and gets the rows by postMessage.",
    prompts: ["Where does each €100 I spend go?", "Print last month as a receipt"],
  },
];

export async function respond(question: string, blocks: Block[], run: RunEngine): Promise<AgentReply> {
  const q = question.toLowerCase();
  const category = findCategory(q);
  const period = findPeriod(q);

  // Remove a block: "remove the forecast", "hide bills"
  if (/\b(remove|delete|hide)\b/.test(q)) {
    const target = blocks.find((b) => q.split(/\W+/).some((w) => w.length > 3 && b.title.toLowerCase().includes(w)));
    return target
      ? { text: `Removed “${target.title}” from your dashboard.`, ops: [{ op: "remove_block", id: target.id }] }
      : { text: "I couldn't tell which block to remove. Try using words from its title.", ops: [] };
  }

  if (/taxi/.test(q)) {
    const p = period ?? "last_month";
    const r = await run("spendBy", { period: p, by: "merchant_type", category: "Transportation" });
    const taxi = r.rows.find((row) => row.key === "4121");
    const block = catalog.categoryBars({ period: p, category: "Transportation", title: "Transportation by merchant type" });
    return {
      text: taxi
        ? `${r.caption}: you spent ${formatEur(taxi.amount as number)} on taxis in ${taxi.count} ${taxi.count === 1 ? "ride" : "rides"}. I added your transport spending to the dashboard; tap the taxi bar to see the details.`
        : `I found no taxi rides (${(r.caption ?? "").toLowerCase()}). Here is your transport spending instead.`,
      ops: place(blocks, block),
    };
  }

  // ---- free-form views: Vega-Lite specs ----
  if (/donut|pie\b|pie chart/.test(q)) {
    const p = period ?? "last_month";
    const r = await run("spendBy", { period: p, by: "category", category: "" });
    const top = r.rows[0];
    const share = top && r.value ? Math.round(((top.amount as number) / r.value) * 100) : 0;
    return {
      text: top
        ? `${top.label} is your biggest slice: ${share}% of ${formatEur(r.value ?? 0)} (${PERIODS[p].toLowerCase()}). There's no donut template, so I drew a custom Vega-Lite chart.`
        : "No spending in that period, so the donut is empty.",
      ops: [{ op: "add_block", block: custom.donut(p), index: 0 }],
    };
  }

  if (/weekday|day of (the )?week/.test(q)) {
    const p = period ?? "last_3_months";
    const r = await run("dailySpend", { period: p });
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const totals = new Array<number>(7).fill(0);
    for (const row of r.rows) totals[new Date(`${String(row.date)}T00:00:00`).getDay()] += row.amount as number;
    const top = totals.indexOf(Math.max(...totals));
    return {
      text: `${names[top]} is your biggest spending day: ${formatEur(totals[top])} in total (${PERIODS[p].toLowerCase()}). I built a custom Vega-Lite chart from your daily spending.`,
      ops: [{ op: "add_block", block: custom.weekday(p), index: 0 }],
    };
  }

  if (/faster|pace|running total|cumulative/.test(q)) {
    return {
      text: "Here is your spending added up day by day, one line per month. A steeper line means a faster month. This one is a custom Vega-Lite chart.",
      ops: [{ op: "add_block", block: custom.pace(), index: 0 }],
    };
  }

  // ---- free-form views: sandboxed iframe widgets ----
  if (/waffle|(each|every|per) €?\s?100|widget|iframe/.test(q)) {
    const p = period ?? "last_month";
    const r = await run("spendBy", { period: p, by: "category", category: "" });
    const top = r.rows[0];
    return {
      text: top
        ? `Of every €100 you spent, about €${Math.round(((top.amount as number) / (r.value || 1)) * 100)} went on ${top.label}. I made a small custom widget for this; it runs sandboxed and only sees your spending totals.`
        : "No spending in that period.",
      ops: [{ op: "add_block", block: custom.waffle(p), index: 0 }],
    };
  }

  if (/receipt/.test(q)) {
    const p = period ?? "last_month";
    const r = await run("spendBy", { period: p, by: "category", category: "" });
    return {
      text: `${formatEur(r.value ?? 0)} across ${r.rows.reduce((n, row) => n + (row.count as number), 0)} payments. Here it is as a receipt (a custom widget in a sandbox). Tap a line to see the payments.`,
      ops: [{ op: "add_block", block: custom.receipt(p), index: 0 }],
    };
  }

  if (/safe\b.*\bspend|safe-to-spend|can i spend|afford this week|how much can i/.test(q)) {
    const horizon = /payday|month/.test(q) ? "until_payday" : "week";
    const r = await run("safeToSpend", { horizon });
    return {
      text: `${formatEur(r.value ?? 0)} is safe to spend ${horizon === "week" ? "this week" : "until payday"}. ${r.caption}. The card shows how I got there.`,
      ops: place(blocks, catalog.safeToSpend(horizon)),
    };
  }

  if (/\b(save|cut|reduce|less|fewer)\b/.test(q) && (findPercent(q) !== undefined || category)) {
    const cat = category ?? "Restaurants";
    const pct = findPercent(q) ?? 20;
    const r = await run("whatIf", { category: cat, cutPct: pct });
    return {
      text: `${r.caption}, which is ${formatEur(r.value ?? 0)} over a year. Drag the slider on the card to try other cuts.`,
      ops: place(blocks, catalog.whatIf(cat, pct)),
    };
  }

  if (/kind of spender|spender am i|where does my money go|basket/.test(q)) {
    const r = await run("baskets", { period: period ?? "last_3_months" });
    const total = r.value || 1;
    const share = (b: string) => Math.round(((r.rows.find((x) => x.basket === b)?.amount as number) / total) * 100);
    const everyday = share("everyday");
    const kind = everyday >= 60 ? "an everyday spender: most of your money goes on small daily things" : everyday >= 40 ? "a balanced spender" : "an essentials-first spender: most of your money goes on fixed bills";
    return {
      text: `You're ${kind}. Of your spending (${(r.caption ?? "").toLowerCase()}), ${share("regular")}% went on regular essentials, ${share("irregular")}% on unexpected necessities and ${everyday}% on everyday spending. I've added your baskets and a comparison with people your age.`,
      ops: [...place(blocks, catalog.peers()), ...place(blocks, catalog.baskets(period ?? "last_3_months"))],
    };
  }

  if (/peer|compare|others|average|people my age|normal/.test(q)) {
    return { text: "Here's how your monthly spending compares with customers in your age band.", ops: place(blocks, catalog.peers(category ?? "")) };
  }

  if (/bill|subscription|recurring|regular payment|fixed cost/.test(q)) {
    const r = await run("recurring");
    return { text: `I found ${r.rows.length} regular payments, about ${formatEur(r.value ?? 0)} a month in bills.`, ops: place(blocks, catalog.recurring()) };
  }

  if (/goal|mortgage|down payment|emergency fund|saving for/.test(q)) {
    const target = /€|eur|\d{3,}/.test(q) ? findEuros(q) : undefined;
    const label = /emergency/.test(q) ? "Emergency fund" : /mortgage|down payment|flat|home/.test(q) ? "Mortgage down payment" : target ? "Savings goal" : undefined;
    const r = await run("goalProgress", { ...(target ? { target } : {}), ...(label ? { label } : {}) });
    return { text: `${r.rows[0].label}: ${Math.round(r.value ?? 0)}% there. ${r.caption}.`, ops: place(blocks, catalog.goal(target, label)) };
  }

  if (/forecast|payday|balance|end of (the )?month|run out/.test(q)) {
    const r = await run("balanceForecast");
    return { text: `${r.caption}: about ${formatEur(r.value ?? 0)}.`, ops: place(blocks, catalog.forecast()) };
  }

  if (/calendar|which days|per day|daily|weekday|weekend/.test(q)) {
    return { text: "Here is your spending day by day. Tap a day to see what happened.", ops: place(blocks, catalog.calendar(period ?? "last_3_months")) };
  }

  if (/trend|per month|monthly|over time|income|earn/.test(q)) {
    const metric = /income|earn/.test(q) ? "income" : /saving/.test(q) ? "saving" : "spending";
    return { text: `Here is your ${metric} per month${category ? ` on ${category}` : ""}.`, ops: place(blocks, catalog.trend({ metric, category })) };
  }

  if (category || /spend|spent|cost/.test(q)) {
    const p = period ?? "last_month";
    const r = await run("spendBy", { period: p, category: category ?? "" });
    return {
      text: `You spent ${formatEur(r.value ?? 0)}${category ? ` on ${category}` : " in total"} (${PERIODS[p].toLowerCase()}).`,
      ops: place(blocks, catalog.categoryBars({ period: p, category })),
    };
  }

  return {
    text: `I'm the demo coach and I only understand some phrasings for now. Try asking what's safe to spend, about taxis or a category like ${SPENDING_CATEGORIES[2]}, what kind of spender you are, your bills, a savings goal, "what if I cut eating out by 20%", "show my spending as a donut chart" or "print last month as a receipt".`,
    ops: [],
  };
}
