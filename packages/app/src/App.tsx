import { applyOps, type Block, type Dashboard, type TxFilter } from "@mydata/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { respond } from "./agent/mockAgent";
import BlockCard from "./BlockCard";
import { defaultDashboard } from "./catalog";
import Chat from "./Chat";
import { dataSource, loadIndex } from "./data";
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
  const index = useLatest("index", loadIndex);
  const indexData = index.status === "ready" ? index.data : null;
  // The selected customer and their blocks are one value, so the blocks always belong to that customer.
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [drill, setDrill] = useState<{ customerId: string; title: string; filter: TxFilter } | null>(null);
  const customerId = dashboard?.customerId ?? null;
  // Keyed by customer: an answer for a customer who is no longer selected is never shown.
  const customer = useLatest(customerId, (signal) => dataSource.customer(customerId ?? "", signal));
  const info = customer.status === "ready" ? customer.data : null;
  const shownCustomer = useRef(customerId);
  shownCustomer.current = customerId;

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

  const ask = async (question: string) => {
    if (customer.status === "error") return "I couldn't load your data. Use “Try again” above first.";
    if (!dashboard || !info) return "Still loading your data…";
    // The whole answer is for the customer who asked, also if another one is selected before it is ready.
    const { customerId: askedFor, blocks } = dashboard;
    const reply = await respond(question, blocks, (fn, args = {}) => dataSource.runData(askedFor, { kind: "engine", fn, args }));
    if (reply.ops.length) updateBlocks(askedFor, (prev) => applyOps({ customerId: askedFor, blocks: prev }, reply.ops).blocks);
    if (reply.ops.length && shownCustomer.current === askedFor) document.querySelector(".dashboard")?.scrollTo({ top: 0, behavior: "smooth" });
    return reply.text;
  };

  const pickRandom = () => {
    if (!indexData) return;
    const others = indexData.pool.filter((c) => c !== customerId);
    selectCustomer(others[Math.floor(Math.random() * others.length)]);
  };

  const preset = indexData?.presets.find((p) => p.customer_id === customerId);

  return (
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
          </div>
        )}
      </header>

      <main className="dashboard" aria-label="Your dashboard">
        {index.status === "error" && <LoadError error={index.error} retry={index.retry} />}
        {customer.status === "error" && <LoadError error={customer.error} retry={customer.retry} />}
        {info && (
          <p className="intro muted small">
            {preset ? `${preset.label} · ${preset.blurb}` : `Customer ${info.customerId}, age ${info.age}`} · data up to {info.today}
          </p>
        )}
        {index.status !== "error" && customer.status === "loading" && (
          <p className="muted" role="status">
            Loading your data…
          </p>
        )}
        {info &&
          dashboard &&
          dashboard.blocks.map((b) => (
            <BlockCard
              key={b.id}
              block={b}
              customerId={dashboard.customerId}
              today={info.today}
              onChange={(patch) => updateBlocks(dashboard.customerId, (prev) => prev.map((x) => (x.id === b.id ? { ...x, ...patch } : x)))}
              onRemove={() => updateBlocks(dashboard.customerId, (prev) => prev.filter((x) => x.id !== b.id))}
              onDrill={(title, filter) => setDrill({ customerId: dashboard.customerId, title, filter })}
            />
          ))}
        {info && dashboard && (
          <button type="button" className="ghost-btn reset" onClick={() => updateBlocks(dashboard.customerId, () => defaultDashboard())}>
            Reset dashboard
          </button>
        )}
      </main>

      <Chat onAsk={ask} resetKey={customerId ?? ""} />

      {drill && drill.customerId === customerId && (
        <TxDrawer customerId={drill.customerId} title={drill.title} filter={drill.filter} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}
