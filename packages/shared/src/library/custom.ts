/**
 * Ready-made "free-form" blocks: custom views that no template covers, kept in the component
 * library so common questions reuse them instead of the LLM writing a new view.
 *
 * - `spec` blocks carry a raw Vega-Lite spec. If the spec has no `data`, the app injects the
 *   engine rows as `data.values`, so the AI never writes numbers into the chart.
 * - `code` blocks carry HTML/JS that runs in a sandboxed iframe (see renderers/IframeBlock.tsx)
 *   and receives the rows through `mydata.onData`.
 *
 * Both still use an engine DataRequest, so the figures come from the same calculations.
 */
import type { Block } from "../blocks";

let seq = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--green-500)", "var(--border)"];

export const custom = {
  /** Donut of spending by category: top 5 plus "Other". */
  donut: (period = "last_month", category = ""): Block => ({
    id: id("donut"),
    title: category ? `${category} split` : "Spending split",
    explanation: category
      ? `Your purchases in ${category} for the period by type of merchant. The five biggest are shown separately; the rest are grouped as Other.`
      : "Money out for the period by category. The five biggest categories are shown separately; the rest are grouped as Other.",
    source: "own",
    data: { kind: "engine", fn: "spendBy", args: { period, by: category ? "merchant_type" : "category", category } },
    view: {
      kind: "spec",
      spec: {
        height: 220,
        transform: [
          { window: [{ op: "row_number", as: "rank" }], sort: [{ field: "amount", order: "descending" }] },
          { calculate: "datum.rank <= 5 ? datum.label : 'Other'", as: "label" },
          { calculate: "datum.rank <= 5 ? datum.key : null", as: "key" },
          { aggregate: [{ op: "sum", field: "amount", as: "amount" }], groupby: ["label", "key"] },
        ],
        mark: { type: "arc", innerRadius: 58, padAngle: 0.02, cornerRadius: 3, cursor: "pointer" },
        encoding: {
          theta: { field: "amount", type: "quantitative", stack: true },
          order: { field: "amount", type: "quantitative", sort: "descending" },
          color: {
            field: "label",
            type: "nominal",
            title: null,
            sort: { field: "amount", order: "descending" },
            scale: { range: PALETTE },
            legend: { orient: "right" },
          },
          tooltip: [
            { field: "label", title: "Category" },
            { field: "amount", title: "€", format: ",.2f" },
          ],
        },
      },
    },
    controls: [{ kind: "period", arg: "period" }],
  }),

  /** Total spending per day of the week. */
  weekday: (period = "last_3_months"): Block => ({
    id: id("weekday"),
    title: "Spending by weekday",
    explanation: "Your daily spending for the period added up per day of the week. The darkest bar is your biggest spending day.",
    source: "own",
    data: { kind: "engine", fn: "dailySpend", args: { period } },
    view: {
      kind: "spec",
      spec: {
        height: 180,
        transform: [
          { calculate: "day(toDate(datum.date + 'T00:00:00'))", as: "dow" },
          { calculate: "(datum.dow + 6) % 7", as: "order" },
          { calculate: "['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][datum.dow]", as: "weekday" },
          { aggregate: [{ op: "sum", field: "amount", as: "amount" }, { op: "count", as: "days" }], groupby: ["weekday", "order"] },
          { joinaggregate: [{ op: "max", field: "amount", as: "top" }] },
        ],
        mark: { type: "bar", cornerRadiusEnd: 4, cursor: "pointer" },
        encoding: {
          x: { field: "weekday", type: "ordinal", sort: { field: "order" }, title: null, axis: { labelAngle: 0 } },
          y: { field: "amount", type: "quantitative", title: "€", axis: { format: ",.0f", tickCount: 4 } },
          color: { condition: { test: "datum.amount === datum.top", value: "var(--chart-1)" }, value: "var(--chart-4)" },
          tooltip: [
            { field: "weekday", title: "Day" },
            { field: "amount", title: "€", format: ",.2f" },
            { field: "days", title: "Spending days" },
          ],
        },
      },
    },
    controls: [{ kind: "period", arg: "period" }],
  }),

  /**
   * A savings plan towards a target the user gave: one band per scenario (the current pace or
   * the chosen amount, saving more, meeting a deadline) with how long each takes.
   */
  goalPlan: (opts: { target?: number; saved?: number; monthly?: number; extra?: number; byMonths?: number; label?: string } = {}): Block => ({
    id: id("plan"),
    title: opts.label ?? "Your savings plan",
    explanation:
      "What is left to save, and how long it takes at a monthly amount: your current saving pace unless you chose one. The other rows show what saving more a month, or a deadline, would mean. A row turns orange when it needs more than has been left over after your spending. No interest is counted, and what is already set aside is the amount you gave.",
    source: "estimate",
    data: {
      kind: "engine",
      fn: "goalPlan",
      args: {
        ...(opts.target !== undefined && { target: opts.target }),
        ...(opts.saved !== undefined && { saved: opts.saved }),
        ...(opts.monthly !== undefined && { monthly: opts.monthly }),
        extra: opts.extra ?? 0,
        ...(opts.byMonths !== undefined && { byMonths: opts.byMonths }),
        ...(opts.label && { label: opts.label }),
      },
    },
    view: {
      kind: "spec",
      spec: {
        height: { step: 58 },
        // Keep the scenarios in the order the engine gives them: the plan first, then the alternatives.
        transform: [{ window: [{ op: "row_number", as: "order" }] }],
        encoding: { y: { field: "scenario", type: "nominal", sort: { field: "order", op: "min", order: "ascending" }, axis: null } },
        layer: [
          {
            mark: { type: "bar", height: 14, cornerRadius: 7 },
            encoding: {
              x: { field: "months", type: "quantitative", title: "Months to go", axis: { tickMinStep: 1, format: "d" } },
              color: { condition: { test: "datum.fits === 'no'", value: "var(--chart-3)" }, value: "var(--chart-1)" },
              tooltip: [
                { field: "scenario", title: "Plan" },
                { field: "monthly", title: "€ a month", format: ",.0f" },
                { field: "months", title: "Months" },
                { field: "reached", title: "Reached" },
                { field: "leftOver", title: "Left over, € a month", format: ",.0f" },
              ],
            },
          },
          { mark: { type: "text", align: "left", dy: -17, fontWeight: 600, fontSize: 12, color: "var(--text)" }, encoding: { x: { value: 0 }, text: { field: "scenario" } } },
          { mark: { type: "text", align: "left", dy: 17, fontSize: 11, color: "var(--muted)" }, encoding: { x: { value: 0 }, text: { field: "summary" } } },
        ],
      },
    },
    controls: [{ kind: "slider", arg: "extra", label: "Save more each month", min: 0, max: 500, step: 10, unit: "€" }],
    // A plan is something to come back to: it stays on the dashboard when later answers replace other cards.
    pinned: true,
  }),

  /** Where everyday spending could be cut, and what each cut would free a month. */
  savingOptions: (protect: string[] = [], cutPct = 20): Block => ({
    id: id("options"),
    title: "Where you could save",
    explanation:
      "Your everyday spending per category (monthly average over the last 12 months) and what cutting it by the chosen share would free each month. Rent, bills and other essentials are never included, and neither is anything you said you want to keep.",
    source: "estimate",
    data: { kind: "engine", fn: "savingsOptions", args: { protect, cutPct } },
    view: {
      kind: "spec",
      spec: {
        height: { step: 30 },
        encoding: { y: { field: "category", type: "nominal", sort: null, title: null, axis: { labelLimit: 110 } } },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 4, cursor: "pointer", color: "var(--chart-1)" },
            encoding: {
              x: { field: "saving", type: "quantitative", title: "€ freed a month", axis: { format: ",.0f", tickCount: 4 } },
              tooltip: [
                { field: "category", title: "Category" },
                { field: "monthly", title: "Now, € a month", format: ",.0f" },
                { field: "saving", title: "Freed, € a month", format: ",.0f" },
                { field: "perYear", title: "Freed a year, €", format: ",.0f" },
              ],
            },
          },
          {
            mark: { type: "text", align: "left", dx: 5, fontSize: 11, color: "var(--muted)" },
            encoding: { x: { field: "saving", type: "quantitative" }, text: { field: "saving", format: ",.0f" } },
          },
        ],
      },
    },
    controls: [{ kind: "slider", arg: "cutPct", label: "Cut by", min: 5, max: 50, step: 5, unit: "%" }],
  }),

  /** Running total within each month, one line per month, to compare spending pace. */
  pace: (): Block => ({
    id: id("pace"),
    title: "Spending pace by month",
    explanation: "For each month, your spending added up day by day. A steeper line means you spent faster that month.",
    source: "own",
    data: { kind: "engine", fn: "dailySpend", args: { period: "last_3_months" } },
    view: {
      kind: "spec",
      spec: {
        height: 200,
        transform: [
          { calculate: "slice(datum.date, 0, 7)", as: "month" },
          { calculate: "toNumber(slice(datum.date, 8, 10))", as: "dom" },
          { window: [{ op: "sum", field: "amount", as: "running" }], groupby: ["month"], sort: [{ field: "dom" }] },
        ],
        mark: { type: "line", strokeWidth: 2.5, interpolate: "step-after", point: { filled: true, size: 24 } },
        encoding: {
          x: { field: "dom", type: "quantitative", title: "Day of month", scale: { domain: [1, 31] }, axis: { tickCount: 6 } },
          y: { field: "running", type: "quantitative", title: "€ so far", axis: { format: ",.0f", tickCount: 4 } },
          color: { field: "month", type: "ordinal", title: null, scale: { range: ["var(--chart-4)", "var(--chart-3)", "var(--chart-2)", "var(--chart-1)"] }, legend: { orient: "top" } },
          tooltip: [
            { field: "date", title: "Date" },
            { field: "amount", title: "That day €", format: ",.2f" },
            { field: "running", title: "Month so far €", format: ",.2f" },
          ],
        },
      },
    },
  }),

  /** Iframe widget: 10×10 waffle, one square per €1 of every €100 spent. */
  waffle: (period = "last_month"): Block => ({
    id: id("waffle"),
    title: "Where each €100 goes",
    explanation: "Your spending for the period scaled to €100. Each square is €1; the four biggest categories get their own colour.",
    source: "own",
    data: { kind: "engine", fn: "spendBy", args: { period, by: "category", category: "" } },
    view: { kind: "code", code: WAFFLE_CODE },
    controls: [{ kind: "period", arg: "period" }],
  }),

  /** Iframe widget: the month printed as a shop receipt. */
  receipt: (period = "last_month"): Block => ({
    id: id("receipt"),
    title: "Your month as a receipt",
    explanation: "Every spending category for the period, with how many payments and the total, laid out like a till receipt.",
    source: "own",
    data: { kind: "engine", fn: "spendBy", args: { period, by: "category", category: "" } },
    view: { kind: "code", code: RECEIPT_CODE },
    controls: [{ kind: "period", arg: "period" }],
  }),
};

const WAFFLE_CODE = `<style>
  .wrap { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; padding: 4px 0 8px; }
  .grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; width: 200px; }
  .cell { aspect-ratio: 1; border-radius: 3px; cursor: pointer; transition: opacity .15s; }
  .grid.hover .cell:not(.on) { opacity: .25; }
  ul { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  li { display: flex; align-items: center; gap: 8px; margin: 4px 0; cursor: pointer; }
  .sw { width: 11px; height: 11px; border-radius: 3px; flex: none; }
  b { font-variant-numeric: tabular-nums; }
</style>
<div class="wrap"><div class="grid" id="grid"></div><ul id="legend"></ul></div>
<script>
  var COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
  mydata.onData(function (rows) {
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    var grid = document.getElementById("grid"), legend = document.getElementById("legend");
    grid.innerHTML = ""; legend.innerHTML = "";
    if (!total) { legend.textContent = "No spending in this period."; return; }
    var groups = rows.slice(0, 4).map(function (r, i) { return { label: r.label, key: r.key, amount: r.amount, color: COLORS[i] }; });
    var rest = rows.slice(4).reduce(function (s, r) { return s + r.amount; }, 0);
    if (rest > 0) groups.push({ label: "Everything else", amount: rest, color: "var(--border)" });
    // Largest-remainder rounding so the squares add up to exactly 100.
    groups.forEach(function (g) { g.exact = g.amount / total * 100; g.n = Math.floor(g.exact); });
    var left = 100 - groups.reduce(function (s, g) { return s + g.n; }, 0);
    groups.slice().sort(function (a, b) { return (b.exact - b.n) - (a.exact - a.n); }).slice(0, left).forEach(function (g) { g.n++; });
    groups.forEach(function (g, gi) {
      for (var i = 0; i < g.n; i++) {
        var c = document.createElement("div");
        c.className = "cell"; c.style.background = g.color; c.dataset.g = gi;
        c.title = g.label + ": " + mydata.formatEur(g.amount);
        c.onclick = function () { mydata.select({ key: g.key, label: g.label }); };
        grid.appendChild(c);
      }
      var li = document.createElement("li");
      var sw = document.createElement("span"); sw.className = "sw"; sw.style.background = g.color;
      var t = document.createElement("span"); t.textContent = g.label + " ";
      var n = document.createElement("b"); n.textContent = "€" + g.n;
      t.appendChild(n); li.append(sw, t);
      li.onmouseenter = function () { grid.classList.add("hover"); grid.querySelectorAll(".cell").forEach(function (c) { c.classList.toggle("on", c.dataset.g == gi); }); };
      li.onmouseleave = function () { grid.classList.remove("hover"); };
      li.onclick = function () { mydata.select({ key: g.key, label: g.label }); };
      legend.appendChild(li);
    });
  });
</script>`;

const RECEIPT_CODE = `<style>
  .receipt { font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; max-width: 320px; margin: 4px auto 10px;
    padding: 16px 18px 20px; background: var(--bg); border: 1px dashed var(--border); border-radius: 4px; }
  .c { text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 10px; cursor: pointer; }
  .row:hover { color: var(--chart-1); }
  .row span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  hr { border: 0; border-top: 1px dashed var(--muted); margin: 8px 0; }
  .total { font-weight: 700; font-size: 15px; cursor: default; }
</style>
<div class="receipt" id="r"></div>
<script>
  mydata.onData(function (rows, result) {
    var el = document.getElementById("r");
    el.innerHTML = "";
    function line(cls, text) { var d = document.createElement("div"); d.className = cls; d.textContent = text; el.appendChild(d); return d; }
    function row(cls, left, right) {
      var d = line(cls, ""), a = document.createElement("span"), b = document.createElement("span");
      a.textContent = left; b.textContent = right; d.append(a, b); return d;
    }
    line("c", "*** MY SPENDING ***");
    line("c muted", result.caption || "");
    el.appendChild(document.createElement("hr"));
    rows.forEach(function (r) {
      row("row", r.label + "  x" + r.count, mydata.formatEur(r.amount)).onclick = function () { mydata.select({ key: r.key, label: r.label }); };
    });
    el.appendChild(document.createElement("hr"));
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    var count = rows.reduce(function (s, r) { return s + r.count; }, 0);
    row("row total", "TOTAL", mydata.formatEur(total));
    line("muted", count + " payments");
    line("c muted", "Thank you for shopping with yourself");
  });
</script>`;
