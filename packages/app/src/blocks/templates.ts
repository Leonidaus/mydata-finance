/**
 * Template builders: (block, result) -> Vega-Lite spec, plus how a tapped mark maps to the
 * transactions behind it. `stat` and `recurring_list` render as HTML (see BlockCard).
 */
import type { Block, EngineResult, TemplateId, TxFilter } from "@mydata/shared";
import type { TopLevelSpec } from "vega-lite";
import { type Locale, subcategoryLabel, translate } from "../i18n";

export type Datum = Record<string, unknown>;

export interface VegaTemplate {
  spec: (block: Block, result: EngineResult, locale: Locale) => TopLevelSpec;
  /** Extra filter for a tapped datum, merged into result.filter. Null = not drillable. */
  drill?: (datum: Datum, block: Block) => Partial<TxFilter> | null;
}

const eur = { format: ",.0f", tickCount: 4 } as const;
const values = (result: EngineResult) => ({ values: result.rows });
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const chart = (locale: Locale, key: Parameters<typeof translate>[1]) => translate(locale, key);
const isItems = (b: Block) => b.data.kind === "engine" && b.data.fn === "itemSpend";
/** Item bars per shop: the labels are shop names as printed, not item types to translate. */
const perShop = (b: Block) => isItems(b) && b.data.kind === "engine" && b.data.args.per === "shop";

/** A tapped bar of receipt items: exactly that shop (by its key), or that kind of item. Null for other cards. */
export function itemDrill(datum: Datum, block: Block): Partial<TxFilter> | null {
  const key = str(datum.key);
  if (!isItems(block) || !key) return null;
  return perShop(block) ? { receiptShop: key } : { subcategory: key };
}

/** Bar labels for receipt items: item types and "no shop read" in the user's language, shop names as printed. */
function itemRows(b: Block, r: EngineResult, locale: Locale) {
  if (perShop(b)) return r.rows.map((row) => (row.key === "-" ? { ...row, label: translate(locale, "chart.unknownShop") } : row));
  return r.rows.map((row) => ({ ...row, label: subcategoryLabel(locale, String(row.key)) }));
}

export const VEGA_TEMPLATES: Partial<Record<TemplateId, VegaTemplate>> = {
  category_bars: {
    spec: (b, r, locale) => ({
      // Item sub-categories are named in the user's language; their ids stay as the key.
      data: isItems(b) ? { values: itemRows(b, r, locale) } : values(r),
      height: { step: 26 },
      mark: { type: "bar", cornerRadiusEnd: 4, cursor: "pointer" },
      encoding: {
        y: { field: "label", type: "nominal", sort: "-x", title: null, axis: { labelLimit: 140 } },
        x: { field: "amount", type: "quantitative", title: "€", axis: eur },
        color: { value: "var(--chart-1)" },
        tooltip: [
          { field: "label", title: chart(locale, "chart.what") },
          { field: "amount", title: "€", format: ",.2f" },
          { field: "count", title: chart(locale, isItems(b) ? "chart.items" : "chart.payments") },
        ],
      },
    }),
    drill: (d, b) => {
      const by = b.data.kind === "engine" ? b.data.args.by : "category";
      const key = str(d.key);
      if (!key) return null;
      if (isItems(b)) return itemDrill(d, b);
      return by === "merchant_type" ? { mcc: key } : { category: key };
    },
  },

  trend_line: {
    spec: (_b, r, locale) => ({
      data: values(r),
      height: 180,
      layer: [
        { mark: { type: "area", color: "var(--chart-1)", opacity: 0.12, interpolate: "monotone" } },
        { mark: { type: "line", color: "var(--chart-1)", strokeWidth: 2.5, interpolate: "monotone" } },
        { mark: { type: "point", filled: true, size: 60, color: "var(--chart-1)", cursor: "pointer" } },
      ],
      encoding: {
        x: { field: "month", type: "ordinal", title: null, axis: { labelAngle: -40 } },
        y: { field: "amount", type: "quantitative", title: "€", axis: eur },
        tooltip: [
          { field: "month", title: chart(locale, "chart.month") },
          { field: "amount", title: "€", format: ",.2f" },
        ],
      },
    }),
    drill: (d) => (str(d.month) ? { month: str(d.month) } : null),
  },

  baskets: {
    spec: (_b, r, locale) => ({
      data: values(r),
      height: { step: 34 },
      transform: [
        { joinaggregate: [{ op: "sum", field: "amount", as: "total" }] },
        { calculate: "datum.total > 0 ? datum.amount / datum.total : 0", as: "share" },
        { calculate: "datum.label + '  ' + format(datum.share, '.0%')", as: "axisLabel" },
      ],
      mark: { type: "bar", cornerRadiusEnd: 4, cursor: "pointer" },
      encoding: {
        y: { field: "axisLabel", type: "nominal", sort: null, title: null, axis: { labelLimit: 190 } },
        x: { field: "amount", type: "quantitative", title: "€", axis: eur },
        color: {
          field: "basket",
          type: "nominal",
          legend: null,
          scale: { domain: ["regular", "irregular", "everyday"], range: ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)"] },
        },
        tooltip: [
          { field: "label", title: chart(locale, "chart.basket") },
          { field: "amount", title: "€", format: ",.2f" },
          { field: "share", title: chart(locale, "chart.share"), format: ".0%" },
          { field: "count", title: chart(locale, "chart.payments") },
        ],
      },
    }),
    drill: (d) => (str(d.basket) ? { basket: d.basket as TxFilter["basket"] } : null),
  },

  balance_forecast: {
    spec: (_b, r, locale) => ({
      data: {
        values: r.rows.map((row) => ({
          ...row,
          kind: row.kind === "Actual" ? chart(locale, "chart.actual") : row.kind === "Forecast" ? chart(locale, "chart.forecast") : row.kind,
        })),
      },
      height: 190,
      layer: [
        { mark: { type: "rule", color: "var(--danger)", strokeDash: [2, 3] }, encoding: { y: { datum: 0 } } },
        {
          mark: { type: "line", strokeWidth: 2.5, interpolate: "step-after" },
          encoding: {
            x: { field: "date", type: "temporal", title: null, axis: { format: "%d.%m.", tickCount: 6 } },
            y: { field: "balance", type: "quantitative", title: "€", axis: eur },
            color: {
              field: "kind",
              type: "nominal",
              title: null,
              scale: { domain: [chart(locale, "chart.actual"), chart(locale, "chart.forecast")], range: ["var(--chart-1)", "var(--chart-2)"] },
              legend: { orient: "top", direction: "horizontal" },
            },
            strokeDash: { field: "kind", type: "nominal", legend: null, scale: { domain: [chart(locale, "chart.actual"), chart(locale, "chart.forecast")], range: [[1, 0], [5, 4]] } },
            tooltip: [
              { field: "date", type: "temporal", title: chart(locale, "chart.date"), format: "%a %d.%m." },
              { field: "balance", title: "€", format: ",.2f" },
              { field: "kind", title: "" },
            ],
          },
        },
      ],
    }),
  },

  what_if: {
    spec: (_b, r, locale) => ({
      data: values(r),
      height: 170,
      mark: { type: "bar", cornerRadiusEnd: 3, color: "var(--chart-2)" },
      encoding: {
        x: { field: "month", type: "ordinal", title: chart(locale, "chart.monthsFromNow"), axis: { labelAngle: 0 } },
        y: { field: "saved", type: "quantitative", title: chart(locale, "chart.saved"), axis: eur },
        tooltip: [
          { field: "month", title: chart(locale, "chart.month") },
          { field: "saved", title: chart(locale, "chart.savedSoFar"), format: ",.0f" },
        ],
      },
    }),
  },

  peer_compare: {
    spec: (_b, r, locale) => ({
      data: values(r),
      height: { step: 14 },
      mark: { type: "bar", cornerRadiusEnd: 3, cursor: "pointer" },
      encoding: {
        y: { field: "category", type: "nominal", title: null, axis: { labelLimit: 120 } },
        yOffset: { field: "who", type: "nominal" },
        x: { field: "amount", type: "quantitative", title: chart(locale, "chart.perMonth"), axis: eur },
        color: {
          field: "who",
          type: "nominal",
          title: null,
          legend: { orient: "top", direction: "horizontal" },
          scale: { range: ["var(--chart-4)", "var(--chart-1)"] },
        },
        tooltip: [
          { field: "category", title: chart(locale, "chart.category") },
          { field: "who", title: "" },
          { field: "amount", title: chart(locale, "chart.perMonth"), format: ",.0f" },
        ],
      },
    }),
    drill: (d) => (str(d.category) && d.who === "You" ? { category: str(d.category) } : null),
  },

  calendar_heatmap: {
    spec: (_b, r, locale) => ({
      data: { values: r.rows.map((row) => ({ ...row, iso: row.date })) },
      transform: [{ calculate: "toDate(datum.iso + 'T00:00:00')", as: "day" }],
      height: { step: 16 },
      mark: { type: "rect", cornerRadius: 3, cursor: "pointer", stroke: "var(--surface)", strokeWidth: 2 },
      encoding: {
        x: { field: "day", timeUnit: "day", type: "ordinal", title: null, axis: { format: "%a", labelAngle: 0 } },
        y: { field: "day", timeUnit: "yearweek", type: "ordinal", title: null, axis: { format: "%d.%m.", labelAngle: 0 } },
        color: {
          field: "amount",
          type: "quantitative",
          title: "€",
          scale: { range: ["var(--heat-0)", "var(--chart-1)"] },
          legend: { orient: "top", gradientLength: 140 },
        },
        tooltip: [
          { field: "iso", title: chart(locale, "chart.date") },
          { field: "amount", title: "€", format: ",.2f" },
        ],
      },
    }),
    drill: (d) => (str(d.iso) ? { date: str(d.iso) } : null),
  },

  goal_progress: {
    spec: (_b, r, locale) => ({
      data: values(r),
      height: 46,
      layer: [
        { mark: { type: "bar", color: "var(--heat-0)", cornerRadius: 6, height: 26 }, encoding: { x: { field: "target", type: "quantitative" } } },
        { mark: { type: "bar", color: "var(--chart-1)", cornerRadius: 6, height: 26 }, encoding: { x: { field: "saved", type: "quantitative" } } },
      ],
      encoding: {
        x: { type: "quantitative", title: "€", axis: eur },
        tooltip: [
          { field: "label", title: chart(locale, "chart.goal") },
          { field: "saved", title: chart(locale, "chart.saved"), format: ",.0f" },
          { field: "target", title: chart(locale, "chart.target"), format: ",.0f" },
        ],
      },
    }),
  },
};
