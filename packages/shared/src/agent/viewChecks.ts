/**
 * Checks on views the model wrote itself (a Vega-Lite spec or widget code), run before the
 * card reaches the dashboard. They catch the common ways such a view ends up broken: fields
 * the data does not have, figures typed into the view, a script that does not parse, a
 * library that was never loaded. Each returns a message for the model, or null when fine.
 */
import { WIDGET_LIBS, type WidgetLib } from "../blocks";
import type { EngineFn } from "../engine/types";
import { ENGINE_COLUMNS } from "./catalog";

/** A hand-written widget longer than this is more likely to be broken than impressive. */
export const MAX_CUSTOM_CODE_CHARS = 12_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const COMPOSITIONS = ["layer", "concat", "hconcat", "vconcat", "facet", "repeat", "spec"];
/** Transforms that rename or generate fields in ways this check does not follow: with them, fields are not checked. */
const OPAQUE = ["repeat", "pivot", "flatten", "lookup", "impute", "density", "regression", "loess", "quantile", "stack", "bin"];

function walk(node: unknown, visit: (key: string, value: unknown, parent: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    visit(key, value, node);
    walk(value, visit);
  }
}

export function checkSpec(spec: Record<string, unknown>, fn: EngineFn): string | null {
  if (spec.mark === undefined && !COMPOSITIONS.some((k) => k in spec)) return "spec has no mark (or layer/concat): nothing would be drawn.";

  const used = new Set<string>();
  const made = new Set<string>(["key", "value"]); // what fold produces by default
  let hasData = false;
  let opaque = false;
  walk(spec, (key, value) => {
    if (key === "data" && value !== null) hasData = true;
    if (OPAQUE.includes(key)) opaque = true;
    if (key === "field" && typeof value === "string") used.add(value);
    if (key === "groupby" && Array.isArray(value)) value.forEach((v) => typeof v === "string" && used.add(v));
    if (key === "as") (Array.isArray(value) ? value : [value]).forEach((v) => typeof v === "string" && made.add(v));
  });
  if (hasData) return 'spec must not contain "data": the rows come from the engine function, and figures are never typed into a view.';
  if (opaque) return null;

  const columns = ENGINE_COLUMNS[fn];
  const unknown = [...used].filter((f) => !columns.includes(f) && !made.has(f) && !/[.[\]]/.test(f));
  if (unknown.length) {
    return `spec reads ${unknown.map((f) => `"${f}"`).join(", ")}, but rows of ${fn} only have: ${columns.join(", ")}. Use those, or define the field with a transform ("as").`;
  }
  return null;
}

const LIB_GLOBALS: Record<WidgetLib, RegExp> = { gsap: /\bgsap\./, matter: /\bMatter\./, three: /\bTHREE\./ };

/** Checks widget code. `libs` is narrowed to the libraries the code really uses. */
export function checkCode(code: string, libs: WidgetLib[]): { error: string } | { libs: WidgetLib[] } {
  if (code.length > MAX_CUSTOM_CODE_CHARS) {
    return { error: `code is ${code.length} characters; the limit is ${MAX_CUSTOM_CODE_CHARS}. Build something simpler, or use a library component.` };
  }
  if (!code.includes("mydata.onData")) return { error: "code must read its rows with mydata.onData(function (rows, result) { ... })." };
  if (/<script[^>]+src\s*=|<link\b|@import|\bfetch\s*\(|XMLHttpRequest|<img[^>]+src\s*=\s*["']?https?:/i.test(code)) {
    return { error: "code must not load anything: the frame has no network. No external scripts, styles, fonts, images or requests." };
  }
  const scripts = [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) return { error: "code needs an inline <script> that draws the rows." };
  for (const js of scripts) {
    try {
      new Function(js); // parses only; nothing runs
    } catch (e) {
      // Where creating functions from text is not allowed at all, the check is skipped.
      if (e instanceof SyntaxError) return { error: `the script does not parse (${e.message}). Send the whole code again, corrected.` };
    }
  }
  for (const lib of WIDGET_LIBS) {
    if (LIB_GLOBALS[lib].test(code) && !libs.includes(lib)) return { error: `code uses ${lib} but libs does not list "${lib}".` };
  }
  return { libs: libs.filter((lib) => LIB_GLOBALS[lib].test(code)) };
}
