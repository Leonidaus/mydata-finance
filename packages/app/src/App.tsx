import {
  applyOps,
  type Block,
  type Dashboard,
  defaultDashboard,
  type EngineResult,
  fillPlaceholders,
  placeholderBlockIds,
  type TxFilter,
} from "@mydata/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { askAgent, cannedReply, type RunEngine } from "./agent";
import BlockCard from "./BlockCard";
import Chat from "./Chat";
import DevGallery from "./DevGallery";
import { DataSourceContext, dataSource, fixtureSource, loadIndex } from "./data";
import { formatEur } from "./format";
import { useLatest } from "./latest";
import LoadError from "./LoadError";
import TxDrawer from "./TxDrawer";

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: dashboard simply isn't remembered */
    }
  },
};
// v2: blocks carry `pinned`; older saved dashboards (no pins) are dropped for the new one-card default.
const dashboardKey = (cid: string) => `mydata.dashboard.v2.${cid}`;

/**
 * Dev mode (?dev in the URL, or the Dev button) runs on the static demo fixtures with the engine in
 * the browser, so components can be built and tested without the backend. Inside it, the gallery
 * shows every component; leaving the gallery to try a block or prompt stays on static data.
 */
const devInUrl = () => new URLSearchParams(window.location.search).has("dev");
/** The Dev button shows in `npm run dev`, or in a build opened with ?dev in the URL. */
const devAvailable = import.meta.env.DEV || devInUrl();

function setDevInUrl(on: boolean) {
  const url = new URL(window.location.href);
  if (on) url.searchParams.set("dev", "");
  else url.searchParams.delete("dev");
  window.history.replaceState(null, "", url.toString().replace(/\?dev=(&|$)/, "?dev$1"));
}

/** A result's headline figure for a reply placeholder, e.g. "€312" or "€85/month". */
function formatValue(r: EngineResult): string | undefined {
  if (r.value === undefined) return undefined;
  const unit = r.unit ?? "";
  if (unit.startsWith("€")) return formatEur(r.value) + unit.slice(1).replace(/^\s*\/\s*/, "/").replace(/^\s+/, " ");
  if (unit === "%") return `${Math.round(r.value)}%`;
  return `${Math.round(r.value * 100) / 100}${unit ? ` ${unit}` : ""}`;
}

function loadBlocks(cid: string): Block[] {
  const raw = store.get(dashboardKey(cid));
  if (raw) {
    try {
      return JSON.parse(raw) as Block[];
    } catch {
      /* fall through to the default */
    }
  }
  return defaultDashboard();
}

export default function App() {
  const index = useLatest("index", loadIndex);
  const indexData = index.status === "ready" ? index.data : null;
  // The selected customer and their blocks are one value, so the blocks always belong to that customer.
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [drill, setDrill] = useState<{ customerId: string; title: string; filter: TxFilter } | null>(null);
  const customerId = dashboard?.customerId ?? null;
  const [dev, setDev] = useState(devInUrl);
  const [gallery, setGallery] = useState(devInUrl);
  const source = dev ? fixtureSource : dataSource;
  // Keyed by source and customer: an answer for a customer who is no longer selected is never shown.
  const customer = useLatest(customerId && `${source.mode}:${customerId}`, (signal) => source.customer(customerId ?? "", signal));
  const info = customer.status === "ready" ? customer.data : null;
  const shownCustomer = useRef(customerId);
  shownCustomer.current = customerId;
  const [chatRequest, setChatRequest] = useState<{ text: string; n: number; canned?: boolean } | null>(null);
  // What the model said, with placeholders unfilled: figures are never sent back to it.
  const history = useRef<{ customerId: string; turns: { role: "user" | "assistant"; text: string }[] }>({ customerId: "", turns: [] });

  const toggleDev = (on: boolean) => {
    setDev(on);
    setGallery(on);
    setDevInUrl(on);
  };

  const selectCustomer = useCallback((id: string) => {
    store.set("mydata.customer", id);
    setDrill(null);
    setDashboard({ customerId: id, blocks: loadBlocks(id) });
  }, []);

  useEffect(() => {
    if (!indexData) return;
    const saved = store.get("mydata.customer");
    const known = saved && (indexData.pool.includes(saved) || indexData.presets.some((p) => p.customer_id === saved));
    selectCustomer(known ? saved : indexData.presets[0].customer_id);
  }, [indexData, selectCustomer]);

  /** Edits the dashboard of `forCustomer`. Does nothing if another customer has been selected since. */
  const updateBlocks = useCallback((forCustomer: string, next: (prev: Block[]) => Block[]) => {
    setDashboard((prev) => {
      if (prev?.customerId !== forCustomer) return prev;
      const blocks = next(prev.blocks);
      store.set(dashboardKey(forCustomer), JSON.stringify(blocks));
      return { customerId: forCustomer, blocks };
    });
  }, []);

  /** Suggested prompts are canned (answered locally, no API call); typed questions go to the agent. */
  const ask = async (question: string, canned = false) => {
    if (customer.status === "error") return "I couldn't load your data. Use “Try again” above first.";
    if (!dashboard || !info) return "Still loading your data…";
    // The whole answer is for the customer who asked, also if another one is selected before it is ready.
    const { customerId: askedFor, blocks } = dashboard;
    if (history.current.customerId !== askedFor) history.current = { customerId: askedFor, turns: [] };
    const ctx = {
      blocks,
      today: info.today,
      history: history.current.turns,
      run: ((fn, args = {}) => source.runData(askedFor, { kind: "engine", fn, args })) as RunEngine,
    };
    const reply = await (canned ? cannedReply : askAgent)(question, ctx);
    const after = applyOps({ customerId: askedFor, blocks }, reply.ops).blocks;
    if (reply.ops.length) {
      // The new answer replaces the previous unpinned one; pinned blocks and blocks this reply touched stay.
      const touched = new Set(reply.ops.map((o) => (o.op === "add_block" ? o.block.id : o.id)));
      updateBlocks(askedFor, (prev) =>
        applyOps({ customerId: askedFor, blocks: prev }, reply.ops).blocks.filter((b) => b.pinned || touched.has(b.id)),
      );
      if (shownCustomer.current === askedFor) document.querySelector(".dashboard")?.scrollTo({ top: 0, behavior: "smooth" });
    }
    history.current.turns = [...history.current.turns, { role: "user" as const, text: question }, { role: "assistant" as const, text: reply.text }].slice(-10);

    // Fill {{blockId.value}} / {{blockId.caption}} from the computed results, here in the browser.
    const results = new Map<string, EngineResult>();
    await Promise.all(
      placeholderBlockIds(reply.text).map(async (id) => {
        const b = after.find((x) => x.id === id);
        if (b) results.set(id, await source.runData(askedFor, b.data).catch(() => ({ rows: [] }) as EngineResult));
      }),
    );
    return fillPlaceholders(reply.text, (id, field) => {
      const r = results.get(id);
      return r && (field === "value" ? formatValue(r) : r.caption);
    });
  };

  const addBlock = (block: Block) => {
    if (!customerId) return;
    updateBlocks(customerId, (prev) => applyOps({ customerId, blocks: prev }, [{ op: "add_block", block: { ...block, pinned: true }, index: 0 }]).blocks);
    setGallery(false);
  };

  /** Demo prompts are canned; a typed question from the gallery goes to the agent (Gemini when configured). */
  const askFromGallery = (prompt: string, canned = true) => {
    setGallery(false);
    setChatRequest((prev) => ({ text: prompt, n: (prev?.n ?? 0) + 1, canned }));
  };

  const pickRandom = () => {
    if (!indexData) return;
    const others = indexData.pool.filter((c) => c !== customerId);
    selectCustomer(others[Math.floor(Math.random() * others.length)]);
  };

  const preset = indexData?.presets.find((p) => p.customer_id === customerId);

  return (
    <DataSourceContext.Provider value={source}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">€</span>
            <span className="brand-name">MyData Finance</span>
          </div>
          {indexData && (
            <div className="persona">
              <select value={customerId ?? ""} onChange={(e) => selectCustomer(e.target.value)} aria-label="Whose data to show">
                <optgroup label="Personas">
                  {indexData.presets.map((p) => (
                    <option key={p.customer_id} value={p.customer_id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other customers">
                  {indexData.pool.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              </select>
              <button type="button" className="ghost-btn" onClick={pickRandom} title="Random customer">
                Random
              </button>
              {devAvailable && (
                <button
                  type="button"
                  className={`ghost-btn${dev ? " on" : ""}`}
                  onClick={() => toggleDev(!dev)}
                  aria-pressed={dev}
                  title={dev ? "Leave dev mode and use the configured data source" : "Show every component, on static demo data"}
                >
                  Dev
                </button>
              )}
              {dev && !gallery && (
                <button type="button" className="ghost-btn" onClick={() => setGallery(true)} title="Back to the component gallery">
                  Gallery
                </button>
              )}
            </div>
          )}
        </header>

        <main className="dashboard" aria-label={gallery ? "Component gallery" : "Your dashboard"}>
          {index.status === "error" && <LoadError error={index.error} retry={index.retry} />}
          {customer.status === "error" && <LoadError error={customer.error} retry={customer.retry} />}
          {info && (
            <p className="intro muted small">
              {preset ? `${preset.label} · ${preset.blurb}` : `Customer ${info.customerId}, age ${info.age}`} · data up to {info.today}
              {dev && " · static demo data"}
            </p>
          )}
          {index.status !== "error" && customer.status === "loading" && (
            <p className="muted" role="status">
              Loading your data…
            </p>
          )}
          {info && dashboard && gallery && (
            <DevGallery
              customerId={dashboard.customerId}
              today={info.today}
              onAdd={addBlock}
              onAsk={askFromGallery}
              onDrill={(title, filter) => setDrill({ customerId: dashboard.customerId, title, filter })}
            />
          )}
          {info &&
            dashboard &&
            !gallery &&
            dashboard.blocks.map((b) => (
              <BlockCard
                key={b.id}
                block={b}
                customerId={dashboard.customerId}
                today={info.today}
                onChange={(patch) => updateBlocks(dashboard.customerId, (prev) => prev.map((x) => (x.id === b.id ? { ...x, ...patch } : x)))}
                onRemove={() => updateBlocks(dashboard.customerId, (prev) => prev.filter((x) => x.id !== b.id))}
                onPin={() => updateBlocks(dashboard.customerId, (prev) => prev.map((x) => (x.id === b.id ? { ...x, pinned: !x.pinned } : x)))}
                onDrill={(title, filter) => setDrill({ customerId: dashboard.customerId, title, filter })}
              />
            ))}
          {info && dashboard && !gallery && (
            <button type="button" className="ghost-btn reset" onClick={() => updateBlocks(dashboard.customerId, () => defaultDashboard())}>
              Reset dashboard
            </button>
          )}
        </main>

        <Chat onAsk={ask} resetKey={customerId ?? ""} request={chatRequest} />

        {drill && drill.customerId === customerId && (
          <TxDrawer customerId={drill.customerId} title={drill.title} filter={drill.filter} onClose={() => setDrill(null)} />
        )}
      </div>
    </DataSourceContext.Provider>
  );
}
