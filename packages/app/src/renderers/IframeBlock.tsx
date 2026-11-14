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
 *   mydata.formatEur(n)  "1 234 €"
 *   mydata.whenVisible(cb)  runs cb once, when the card scrolls into view (start animations here)
 *   mydata.reducedMotion  true when the user asked for less motion: show the end state instead
 *   mydata.css("--chart-1")  a theme colour as a value, for canvas and WebGL
 *   mydata.loop((dt, t) => { ... })  animation loop that pauses while the card is off screen; returns stop()
 *   mydata.onResize((width, height, fullscreen) => { ... })  on resize and when full screen is switched
 *   mydata.visible / mydata.fullscreen  current state; <html> has class "fullscreen" in full screen
 * Libraries named in `libs` (gsap, matter, three) are inlined before the code: gsap, Matter, THREE.
 * Theme tokens (--text, --muted, --surface, --border, --chart-1..4, ...) are set on :root.
 */
import type { EngineResult, WidgetLib } from "@mydata/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Datum } from "../blocks/templates";
import { useColorScheme } from "./VegaBlock";
import { loadWidgetLibs } from "./widgetLibs";

const THEME_TOKENS = ["--bg", "--surface", "--text", "--muted", "--border", "--danger", "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--heat-0", "--green-500"];

function themeTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(THEME_TOKENS.map((t) => [t, style.getPropertyValue(t).trim()]));
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const BOOTSTRAP = `
(function () {
  var callbacks = [], last = null;
  var eur = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
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
    formatEur: function (n) { return eur.format(Math.round(n) === 0 ? 0 : n); },
    reducedMotion: !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches),
    css: function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },
    whenVisible: function (cb) {
      if (!("IntersectionObserver" in window)) return cb();
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); try { cb(); } catch (err) { showError(err); } }
      }, { threshold: 0.3 });
      io.observe(document.body || document.documentElement);
    },
    visible: true, fullscreen: false,
    // An animation loop that only runs while the card is on screen: fn(dt, t) in seconds. Returns stop().
    loop: function (fn) {
      var h = { on: true, raf: 0, last: 0 };
      function frame(t) {
        h.raf = 0;
        if (!h.on) return;
        var dt = h.last ? Math.min(50, t - h.last) : 16.7;
        h.last = t;
        try { fn(dt / 1000, t / 1000); } catch (err) { h.on = false; showError(err); return; }
        h.wake();
      }
      h.wake = function () { if (h.on && mydata.visible && !h.raf) h.raf = requestAnimationFrame(frame); };
      loops.push(h); h.wake();
      return function () { h.on = false; if (h.raf) cancelAnimationFrame(h.raf); };
    },
    // cb(width, height, fullscreen) now, on every resize, and when full screen is switched.
    onResize: function (cb) { resizers.push(cb); try { cb(window.innerWidth, window.innerHeight, mydata.fullscreen); } catch (err) { showError(err); } }
  };
  var loops = [], resizers = [], tabHidden = false, onScreen = true;
  function resized() { resizers.forEach(function (cb) { try { cb(window.innerWidth, window.innerHeight, mydata.fullscreen); } catch (err) { showError(err); } }); }
  // Off screen or in a background tab: loops stop and GSAP's clock pauses, then both pick up again.
  function setVisible() {
    var v = onScreen && !tabHidden;
    if (v === mydata.visible) return;
    mydata.visible = v;
    if (window.gsap && gsap.globalTimeline) gsap.globalTimeline.paused(!v);
    if (v) loops.forEach(function (h) { h.last = 0; h.wake(); });
  }
  document.addEventListener("visibilitychange", function () { tabHidden = document.hidden; setVisible(); });
  window.addEventListener("resize", resized);
  window.addEventListener("error", function (e) { showError(e.error || e.message); });
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === "mydata:mode") {
      mydata.fullscreen = !!e.data.fullscreen;
      document.documentElement.classList.toggle("fullscreen", mydata.fullscreen);
      resized(); setTimeout(resized, 60);
      return;
    }
    if (e.data.type !== "mydata:data") return;
    last = e.data;
    var root = document.documentElement;
    for (var k in last.theme) root.style.setProperty(k, last.theme[k]);
    mydata.rows = last.result.rows; mydata.result = last.result; mydata.title = last.title;
    callbacks.forEach(run);
  });
  function size() { if (!mydata.fullscreen) parent.postMessage({ type: "mydata:height", height: document.documentElement.scrollHeight }, "*"); }
  window.addEventListener("load", function () {
    new ResizeObserver(size).observe(document.body); size();
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) { onScreen = entries[entries.length - 1].isIntersecting; setVisible(); }, { threshold: 0.01 }).observe(document.documentElement);
    }
  });
  parent.postMessage({ type: "mydata:ready" }, "*");
})();`;

const BASE_CSS = `
html, body { margin: 0; background: transparent; color: var(--text); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
html.fullscreen, html.fullscreen body { height: 100%; }
html.fullscreen body { box-sizing: border-box; padding: 12px 16px; }
.muted { color: var(--muted); }
.frame-error { color: var(--danger); font-size: 13px; }`;

/** Library source inlined as a script; a literal closing tag inside it must not end the element. */
const inlineScript = (source: string) => `<script>${source.replace(/<\/script/gi, "<\\/script")}</script>`;

function buildSrcDoc(code: string, libSources: string[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${BASE_CSS}</style><script>${BOOTSTRAP}</script>${libSources.map(inlineScript).join("")}</head><body>${code}</body></html>`;
}

const NO_LIBS: readonly WidgetLib[] = [];

interface Props {
  code: string;
  /** Libraries to inject before the code runs (gsap, matter, three). */
  libs?: readonly WidgetLib[];
  result: EngineResult;
  label: string;
  onSelect?: (datum: Datum) => void;
}

export default function IframeBlock({ code, libs = NO_LIBS, result, label, onSelect }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [full, setFull] = useState(false);
  const dark = useColorScheme();
  const libKey = libs.join(",");
  // null while the libraries download; [] straight away for a widget that needs none.
  const [sources, setSources] = useState<{ key: string; list: string[] } | null>(libs.length ? null : { key: "", list: [] });
  const [libError, setLibError] = useState<string | null>(null);
  useEffect(() => {
    if (!libKey) return setSources({ key: "", list: [] });
    let live = true;
    setLibError(null);
    loadWidgetLibs(libKey.split(",") as WidgetLib[]).then(
      (list) => live && setSources({ key: libKey, list }),
      () => live && setLibError("Couldn't load what this widget needs. Check your connection and try again."),
    );
    return () => {
      live = false;
    };
  }, [libKey]);
  const ready = sources?.key === libKey ? sources.list : null;
  const srcDoc = useMemo(() => (ready ? buildSrcDoc(code, ready) : null), [code, ready]);

  const latest = useRef({ result, label, onSelect });
  latest.current = { result, label, onSelect };
  const fullRef = useRef(full);
  fullRef.current = full;

  const post = () =>
    ref.current?.contentWindow?.postMessage({ type: "mydata:data", result: latest.current.result, title: latest.current.label, theme: themeTokens() }, "*");

  // Re-send when the data or theme changes (the first send happens on "mydata:ready").
  useEffect(post, [result, label, dark]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const msg = e.data as { type?: string; height?: unknown; datum?: unknown };
      if (msg?.type === "mydata:ready") {
        post();
        // A reloaded frame (new code or libraries) starts in normal mode; tell it if we are full screen.
        if (fullRef.current) ref.current.contentWindow?.postMessage({ type: "mydata:mode", fullscreen: true }, "*");
      }
      else if (msg?.type === "mydata:height" && typeof msg.height === "number") setHeight(Math.min(Math.max(Math.ceil(msg.height), 40), 1200));
      else if (msg?.type === "mydata:select" && msg.datum && typeof msg.datum === "object") latest.current.onSelect?.(msg.datum as Datum);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Full screen is a CSS change on the wrapper: moving the iframe in the DOM would reload it.
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: "mydata:mode", fullscreen: full }, "*");
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  if (libError) return <p className="block-error">{libError}</p>;
  if (srcDoc === null) return <div className="frame" style={{ height }} aria-busy="true" />;
  return (
    <div className={full ? "frame-wrap full" : "frame-wrap"}>
      <button type="button" className="frame-expand" onClick={() => setFull(!full)} aria-label={full ? "Close full screen" : `Show ${label} full screen`}>
        {full ? "Close ✕" : "⤢"}
      </button>
      <iframe ref={ref} className="frame" title={label} sandbox="allow-scripts" srcDoc={srcDoc} style={full ? undefined : { height }} />
    </div>
  );
}
