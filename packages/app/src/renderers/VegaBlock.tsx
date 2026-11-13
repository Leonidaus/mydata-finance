import { useEffect, useRef, useState } from "react";
import type { TopLevelSpec } from "vega-lite";
import type { Datum } from "../blocks/templates";

/** Replace "var(--token)" strings anywhere in a spec with the computed CSS value. */
function resolveCssVars<T>(value: T, style: CSSStyleDeclaration): T {
  if (typeof value === "string") {
    const m = /^var\((--[\w-]+)\)$/.exec(value);
    return (m ? style.getPropertyValue(m[1]).trim() || value : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveCssVars(v, style)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveCssVars(v, style)])) as T;
  }
  return value;
}

function themeConfig() {
  return {
    background: "transparent",
    font: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    view: { stroke: null },
    axis: {
      labelColor: "var(--muted)",
      titleColor: "var(--muted)",
      gridColor: "var(--border)",
      domainColor: "var(--border)",
      tickColor: "var(--border)",
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
    },
    legend: { labelColor: "var(--text)", titleColor: "var(--muted)", labelFontSize: 11 },
  };
}

function useColorScheme() {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  return dark;
}

interface Props {
  spec: TopLevelSpec;
  onSelect?: (datum: Datum) => void;
  label: string;
}

export default function VegaBlock({ spec, onSelect, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = useColorScheme();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let finalize: (() => void) | undefined;
    let cancelled = false;
    setError(null);
    // Loaded on demand: Vega is the largest dependency.
    import("vega-embed")
      .then(({ default: embed }) => {
        if (cancelled) return;
        const style = getComputedStyle(el);
        const full = resolveCssVars(
          {
            $schema: "https://vega.github.io/schema/vega-lite/v6.json",
            width: "container",
            autosize: { type: "fit-x", contains: "padding" },
            ...spec,
            config: themeConfig(),
          } as TopLevelSpec,
          style,
        );
        return embed(el, full, { actions: false, renderer: "svg", logLevel: 1 /* errors only */, tooltip: { theme: dark ? "dark" : "light" } }).then((res) => {
          if (cancelled) return res.finalize();
          finalize = res.finalize;
          res.view.addEventListener("click", (_event, item) => {
            const datum = (item as { datum?: Datum } | null | undefined)?.datum;
            if (datum && onSelectRef.current) onSelectRef.current(datum);
          });
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [spec, dark]);

  if (error) return <p className="block-error">Could not draw this chart: {error}</p>;
  return <div ref={ref} className="vega" role="img" aria-label={label} />;
}
