import { applyOps, type Block, type EngineContext, type FixtureIndex, type TxFilter } from "@mydata/shared";
import { useCallback, useEffect, useState } from "react";
import { respond } from "./agent/mockAgent";
import BlockCard from "./BlockCard";
import { defaultDashboard } from "./catalog";
import Chat from "./Chat";
import { loadContext, loadIndex } from "./data";
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
const dashboardKey = (cid: string) => `mydata.dashboard.${cid}`;

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
  const [index, setIndex] = useState<FixtureIndex | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<EngineContext | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [drill, setDrill] = useState<{ title: string; filter: TxFilter } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndex()
      .then((idx) => {
        setIndex(idx);
        const saved = store.get("mydata.customer");
        const known = saved && (idx.pool.includes(saved) || idx.presets.some((p) => p.customer_id === saved));
        setCustomerId(known ? saved : idx.presets[0].customer_id);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!customerId) return;
    store.set("mydata.customer", customerId);
    setCtx(null);
    setBlocks(loadBlocks(customerId));
    loadContext(customerId)
      .then(setCtx)
      .catch((e: unknown) => setError(String(e)));
  }, [customerId]);

  const updateBlocks = useCallback(
    (next: (prev: Block[]) => Block[]) => {
      setBlocks((prev) => {
        const result = next(prev);
        if (customerId) store.set(dashboardKey(customerId), JSON.stringify(result));
        return result;
      });
    },
    [customerId],
  );

  const ask = (question: string) => {
    if (!ctx || !customerId) return "Still loading your data…";
    const reply = respond(question, blocks, ctx);
    if (reply.ops.length) updateBlocks((prev) => applyOps({ customerId, blocks: prev }, reply.ops).blocks);
    if (reply.ops.length) document.querySelector(".dashboard")?.scrollTo({ top: 0, behavior: "smooth" });
    return reply.text;
  };

  const pickRandom = () => {
    if (!index) return;
    const others = index.pool.filter((c) => c !== customerId);
    setCustomerId(others[Math.floor(Math.random() * others.length)]);
  };

  const preset = index?.presets.find((p) => p.customer_id === customerId);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">€</span>
          <span className="brand-name">MyData Finance</span>
        </div>
        {index && (
          <div className="persona">
            <select value={customerId ?? ""} onChange={(e) => setCustomerId(e.target.value)} aria-label="Whose data to show">
              <optgroup label="Personas">
                {index.presets.map((p) => (
                  <option key={p.customer_id} value={p.customer_id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other customers">
                {index.pool.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            </select>
            <button type="button" className="ghost-btn" onClick={pickRandom} title="Random customer">
              Random
            </button>
          </div>
        )}
      </header>

      <main className="dashboard" aria-label="Your dashboard">
        {error && <p className="block-error">{error}</p>}
        {ctx && (
          <p className="intro muted small">
            {preset ? `${preset.label} · ${preset.blurb}` : `Customer ${ctx.customer.customer_id}, age ${ctx.customer.customer_age}`} · data
            up to {ctx.today}
          </p>
        )}
        {!ctx && !error && <p className="muted">Loading your data…</p>}
        {ctx &&
          blocks.map((b) => (
            <BlockCard
              key={b.id}
              block={b}
              ctx={ctx}
              onChange={(patch) => updateBlocks((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...patch } : x)))}
              onRemove={() => updateBlocks((prev) => prev.filter((x) => x.id !== b.id))}
              onDrill={(title, filter) => setDrill({ title, filter })}
            />
          ))}
        {ctx && (
          <button type="button" className="ghost-btn reset" onClick={() => updateBlocks(() => defaultDashboard())}>
            Reset dashboard
          </button>
        )}
      </main>

      <Chat onAsk={ask} resetKey={customerId ?? ""} />

      {drill && ctx && <TxDrawer ctx={ctx} title={drill.title} filter={drill.filter} onClose={() => setDrill(null)} />}
    </div>
  );
}
