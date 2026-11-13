/**
 * Template builders: (block, result) -> Vega-Lite spec, plus how a tapped mark maps to the
 * transactions behind it. `stat` and `recurring_list` render as HTML (see BlockCard).
 */
import type { Block, EngineResult, TemplateId, TxFilter } from "@mydata/shared";
import type { TopLevelSpec } from "vega-lite";

export type Datum = Record<string, unknown>;

export interface VegaTemplate {
  spec: (block: Block, result: EngineResult) => TopLevelSpec;
  /** Extra filter for a tapped datum, merged into result.filter. Null = not drillable. */
  drill?: (datum: Datum, block: Block) => Partial<TxFilter> | null;
}

const eur = { format: ",.0f", tickCount: 4 } as const;
const values = (result: EngineResult) => ({ values: result.rows });
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export const VEGA_TEMPLATES: Partial<Record<TemplateId, VegaTemplate>> = {
  category_bars: {
    spec: (_b, r) => ({
      data: values(r),
      height: { step: 26 },
      mark: { type: "bar", cornerRadiusEnd: 4, cursor: "pointer" },
      encoding: {
        y: { field: "label", type: "nominal", sort: "-x", title: null, axis: { labelLimit: 140 } },
        x: { field: "amount", type: "quantitative", title: "€", axis: eur },
        color: { value: "var(--chart-1)" },
        tooltip: [
          { field: "label", title: "What" },
          { field: "amount", title: "€", format: ",.2f" },
          { field: "count", title: "Payments" },
        ],
      },
    }),
    drill: (d, b) => {
      const by = b.data.kind === "engine" ? b.data.args.by : "category";
      const key = str(d.key);
      if (!key) return null;
      return by === "merchant_type" ? { mcc: key } : { category: key };
    },
  },

  trend_line: {
    spec: (_b, r) => ({
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
          { field: "month", title: "Month" },
          { field: "amount", title: "€", format: ",.2f" },
        ],
      },
    }),
    drill: (d) => (str(d.month) ? { month: str(d.month) } : null),
  },

  baskets: {
    spec: (_b, r) => ({
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
          { field: "label", title: "Basket" },
          { field: "amount", title: "€", format: ",.2f" },
          { field: "share", title: "Share", format: ".0%" },
          { field: "count", title: "Payments" },
        ],
      },
    }),
    drill: (d) => (str(d.basket) ? { basket: d.basket as TxFilter["basket"] } : null),
  },

  balance_forecast: {
    spec: (_b, r) => ({
      data: values(r),
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
              scale: { domain: ["Actual", "Forecast"], range: ["var(--chart-1)", "var(--chart-2)"] },
              legend: { orient: "top", direction: "horizontal" },
            },
            strokeDash: { field: "kind", type: "nominal", legend: null, scale: { domain: ["Actual", "Forecast"], range: [[1, 0], [5, 4]] } },
            tooltip: [
              { field: "date", type: "temporal", title: "Date", format: "%a %d.%m." },
              { field: "balance", title: "€", format: ",.2f" },
              { field: "kind", title: "" },
            ],
          },
        },
      ],
    }),
  },

  what_if: {
    spec: (_b, r) => ({
      data: values(r),
      height: 170,
      mark: { type: "bar", cornerRadiusEnd: 3, color: "var(--chart-2)" },
      encoding: {
        x: { field: "month", type: "ordinal", title: "Months from now", axis: { labelAngle: 0 } },
        y: { field: "saved", type: "quantitative", title: "Saved, €", axis: eur },
        tooltip: [
          { field: "month", title: "Month" },
          { field: "saved", title: "Saved so far, €", format: ",.0f" },
        ],
      },
    }),
  },

  peer_compare: {
    spec: (_b, r) => ({
      data: values(r),
      height: { step: 14 },
      mark: { type: "bar", cornerRadiusEnd: 3, cursor: "pointer" },
      encoding: {
        y: { field: "category", type: "nominal", title: null, axis: { labelLimit: 120 } },
        yOffset: { field: "who", type: "nominal" },
        x: { field: "amount", type: "quantitative", title: "€ per month", axis: eur },
        color: {
          field: "who",
          type: "nominal",
          title: null,
          legend: { orient: "top", direction: "horizontal" },
          scale: { range: ["var(--chart-4)", "var(--chart-1)"] },
        },
        tooltip: [
          { field: "category", title: "Category" },
          { field: "who", title: "" },
          { field: "amount", title: "€/month", format: ",.0f" },
        ],
      },
    }),
    drill: (d) => (str(d.category) && d.who === "You" ? { category: str(d.category) } : null),
  },

  calendar_heatmap: {
    spec: (_b, r) => ({
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
          { field: "iso", title: "Date" },
          { field: "amount", title: "€", format: ",.2f" },
        ],
      },
    }),
    drill: (d) => (str(d.iso) ? { date: str(d.iso) } : null),
  },

  goal_progress: {
    spec: (_b, r) => ({
      data: values(r),
      height: 46,
      layer: [
        { mark: { type: "bar", color: "var(--heat-0)", cornerRadius: 6, height: 26 }, encoding: { x: { field: "target", type: "quantitative" } } },
        { mark: { type: "bar", color: "var(--chart-1)", cornerRadius: 6, height: 26 }, encoding: { x: { field: "saved", type: "quantitative" } } },
      ],
      encoding: {
        x: { type: "quantitative", title: "€", axis: eur },
        tooltip: [
          { field: "label", title: "Goal" },
          { field: "saved", title: "Saved, €", format: ",.0f" },
          { field: "target", title: "Target, €", format: ",.0f" },
        ],
      },
    }),
  },
};
