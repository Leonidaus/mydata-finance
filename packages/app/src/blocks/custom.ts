/**
 * Example "free-form" blocks: what the LLM will produce when no template fits.
 *
 * - `spec` blocks carry a raw Vega-Lite spec. If the spec has no `data`, the app injects the
 *   engine rows as `data.values`, so the AI never writes numbers into the chart.
 * - `code` blocks carry HTML/JS that runs in a sandboxed iframe (see renderers/IframeBlock.tsx)
 *   and receives the rows through `mydata.onData`.
 *
 * Both still use an engine DataRequest, so the figures come from the same calculations.
 */
import type { Block } from "@mydata/shared";

let seq = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--green-500)", "var(--border)"];

export const custom = {
  /** Donut of spending by category: top 5 plus "Other". */
  donut: (period = "last_month"): Block => ({
    id: id("donut"),
    title: "Spending split",
    explanation: "Money out for the period by category. The five biggest categories are shown separately; the rest are grouped as Other.",
    source: "own",
    data: { kind: "engine", fn: "spendBy", args: { period, by: "category", category: "" } },
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
