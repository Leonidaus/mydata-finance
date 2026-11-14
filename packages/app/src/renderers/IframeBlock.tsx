/**
 * Renders a `{ kind: "code" }` block: AI-written HTML/JS in a sandboxed iframe.
 *
 * Isolation: `sandbox="allow-scripts"` without `allow-same-origin` gives the frame an opaque
 * origin (no cookies, storage or access to this page), and the CSP below blocks all network
 * requests, so the code can only see the rows we post to it and can't send them anywhere.
 *
 * Contract for the code (see `mydata` in the frame):
 *   mydata.onData((rows, result) => { ... })  called with the block's engine result, and again on change
 *   mydata.select({ key, label, date, month, category })  drill into the transactions behind a datum
 *   mydata.formatEur(n)  "€1,234"
 * Theme tokens (--text, --muted, --surface, --border, --chart-1..4, ...) are set on :root.
 */
import type { EngineResult } from "@mydata/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Datum } from "../blocks/templates";
import { useColorScheme } from "./VegaBlock";

const THEME_TOKENS = ["--bg", "--surface", "--text", "--muted", "--border", "--danger", "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--heat-0", "--green-500"];

function themeTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(THEME_TOKENS.map((t) => [t, style.getPropertyValue(t).trim()]));
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const BOOTSTRAP = `
(function () {
  var callbacks = [], last = null;
  var eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  function showError(err) {
    var p = document.createElement("p");
    p.className = "frame-error";
    p.textContent = "Widget error: " + (err && err.message ? err.message : String(err));
    (document.body || document.documentElement).appendChild(p);
  }
  function run(cb) { try { cb(last.result.rows, last.result); } catch (err) { showError(err); } }
  window.mydata = {
    rows: [], result: null, title: "",
    onData: function (cb) { callbacks.push(cb); if (last) run(cb); },
    select: function (datum) { parent.postMessage({ type: "mydata:select", datum: datum }, "*"); },
    formatEur: function (n) { return eur.format(Math.round(n) === 0 ? 0 : n); }
  };
  window.addEventListener("error", function (e) { showError(e.error || e.message); });
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data || e.data.type !== "mydata:data") return;
    last = e.data;
    var root = document.documentElement;
    for (var k in last.theme) root.style.setProperty(k, last.theme[k]);
    mydata.rows = last.result.rows; mydata.result = last.result; mydata.title = last.title;
    callbacks.forEach(run);
  });
  function size() { parent.postMessage({ type: "mydata:height", height: document.documentElement.scrollHeight }, "*"); }
  window.addEventListener("load", function () { new ResizeObserver(size).observe(document.body); size(); });
  parent.postMessage({ type: "mydata:ready" }, "*");
})();`;

const BASE_CSS = `
html, body { margin: 0; background: transparent; color: var(--text); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.muted { color: var(--muted); }
.frame-error { color: var(--danger); font-size: 13px; }`;

function buildSrcDoc(code: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${BASE_CSS}</style><script>${BOOTSTRAP}</script></head><body>${code}</body></html>`;
}

interface Props {
  code: string;
  result: EngineResult;
  label: string;
  onSelect?: (datum: Datum) => void;
}

export default function IframeBlock({ code, result, label, onSelect }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const dark = useColorScheme();
  const srcDoc = useMemo(() => buildSrcDoc(code), [code]);

  const latest = useRef({ result, label, onSelect });
  latest.current = { result, label, onSelect };

  const post = () =>
    ref.current?.contentWindow?.postMessage({ type: "mydata:data", result: latest.current.result, title: latest.current.label, theme: themeTokens() }, "*");

  // Re-send when the data or theme changes (the first send happens on "mydata:ready").
  useEffect(post, [result, label, dark]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const msg = e.data as { type?: string; height?: unknown; datum?: unknown };
      if (msg?.type === "mydata:ready") post();
      else if (msg?.type === "mydata:height" && typeof msg.height === "number") setHeight(Math.min(Math.max(Math.ceil(msg.height), 40), 1200));
      else if (msg?.type === "mydata:select" && msg.datum && typeof msg.datum === "object") latest.current.onSelect?.(msg.datum as Datum);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return <iframe ref={ref} className="frame" title={label} sandbox="allow-scripts" srcDoc={srcDoc} style={{ height }} />;
}
