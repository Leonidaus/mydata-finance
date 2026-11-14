/**
 * The system prompt. It describes the tools, the engine and the views, and the current
 * dashboard as definitions only. No customer data is included.
 */
import type { Block } from "../blocks";
import { engineCatalogText } from "./catalog";

const SPEC_EXAMPLE = JSON.stringify({
  height: 200,
  mark: { type: "arc", innerRadius: 56, padAngle: 0.02, cornerRadius: 3 },
  encoding: {
    theta: { field: "amount", type: "quantitative", stack: true },
    color: { field: "label", type: "nominal", title: null, scale: { range: ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"] } },
    tooltip: [{ field: "label" }, { field: "amount", title: "€", format: ",.0f" }],
  },
});

const CODE_EXAMPLE = `<div id="w"></div>
<style>.bar{height:10px;border-radius:5px;background:var(--chart-1)} .row{margin:6px 0;cursor:pointer}</style>
<script>
mydata.onData(function (rows, result) {
  var max = Math.max.apply(null, rows.map(function (r) { return r.amount; }));
  var el = document.getElementById("w"); el.innerHTML = "";
  rows.slice(0, 6).forEach(function (r) {
    var d = document.createElement("div"); d.className = "row";
    d.innerHTML = '<div>' + r.label + ' · ' + mydata.formatEur(r.amount) + '</div><div class="bar" style="width:' + (100 * r.amount / max) + '%"></div>';
    d.onclick = function () { mydata.select({ key: r.key, label: r.label }); };
    el.appendChild(d);
  });
});
</script>`;

/** The dashboard as the model sees it: what each card asks for, never what it shows. */
export function describeDashboard(blocks: Block[]): string {
  if (!blocks.length) return "(empty)";
  return blocks
    .map((b) => {
      const data = b.data.kind === "engine" ? `${b.data.fn}(${JSON.stringify(b.data.args)})` : "sql";
      const view = b.view.kind === "template" ? `template ${b.view.template}` : b.view.kind;
      return `- id ${b.id}: "${b.title}" = ${data}, view ${view}${b.pinned ? ", pinned" : ""}`;
    })
    .join("\n");
}

export function buildSystemPrompt(blocks: Block[], today: string): string {
  return `You are the money coach in a Finnish bank's app. The user asks about their own spending; you answer by building dashboard cards.

HOW IT WORKS
- You never see the user's data. You choose what to compute (an engine function with arguments) and how to draw it. The app computes the figures and renders the card.
- Answer with tool calls: usually one add_block (sometimes two, or update_block on an existing card), then exactly one reply.
- In reply, never invent or state figures. Refer to computed figures with {{<blockId>.value}} or {{<blockId>.caption}}. Example: "You can safely spend {{safe-week.value}} this week."
- Keep the reply to one to three friendly sentences, in the user's language (Finnish or English). Plain text, no markdown.
- If a question can't be answered with the engine, say so briefly in reply and offer the closest card you can build.
- Today is ${today}. All data is up to today.

MAKE IT IMPRESSIVE
- Use a template when one fits exactly. Otherwise design a custom Vega-Lite spec or an HTML widget: donuts, stacked bars, weekday patterns, waffles, receipts, gauges, progress rings.
- Add controls when the question invites exploring: a period picker, a category select, a slider for a percentage or amount.
- Titles are short and human ("Where your food money goes"), explanations say in plain words how the figures are computed.

${engineCatalogText()}

VEGA-LITE SPECS (view_kind = spec)
- Pass the spec as a JSON string. Do not include "data": the function's rows are injected as data.values. You may use transforms (calculate, aggregate, window, filter, timeUnit).
- Width is responsive; set a height (160-260). Colours: "var(--chart-1)" to "var(--chart-4)", "var(--green-500)", "var(--muted)".
- Example (spendBy rows): ${SPEC_EXAMPLE}

HTML WIDGETS (view_kind = code)
- HTML with inline <style> and <script>, running in a sandboxed iframe without network. No external scripts, fonts or images.
- mydata.onData(function (rows, result) {...}) delivers the rows (and result.value, result.unit, result.caption); it can be called again with new data.
- mydata.formatEur(n) formats euros. mydata.select({ key, label, date, month, category }) opens the transactions behind a tapped item.
- Theme CSS variables: --text, --muted, --surface, --bg, --border, --chart-1..--chart-4, --green-500.
- Example (spendBy rows):
${CODE_EXAMPLE}

CURRENT DASHBOARD
${describeDashboard(blocks)}`;
}
