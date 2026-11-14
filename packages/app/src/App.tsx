import {
  type Block,
  type ChatImage,
  type Dashboard,
  defaultDashboard,
  type EngineResult,
  fillPlaceholders,
  photoQuestion,
  placeholderBlockIds,
  type TxFilter,
  type ProtectedCategory,
  type ProfileUpdate,
} from "@mydata/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { askAgent, cannedReply, type ChatMode, chatMode, geminiAvailable, type RunEngine } from "./agent";
import BlockCard from "./BlockCard";
import Chat, { type CoachState } from "./Chat";
import CoachingSettings from "./CoachingSettings";
import CoachFace from "./CoachFace";
import DevGallery from "./DevGallery";
import { applyDashboardOps, uniqueWidgetTypes } from "./dashboard";
import { apiBase, DataSourceContext, dataSource, fixtureSource, loadIndex } from "./data";
import { formatDate, formatEur } from "./format";
import { useLatest } from "./latest";
import LoadError from "./LoadError";
import TxDrawer from "./TxDrawer";
import { createProfileClient } from "./sources/profile";

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
// v2: blocks carry `pinned`; older saved dashboards (no pins) are dropped for the new default.
// v3: the default first screen has two cards (safe to spend, this month so far).
const dashboardKey = (cid: string) => `mydata.dashboard.v3.${cid}`;
const coachingPromptKey = (cid: string) => `mydata.coachingPrompt.v1.${cid}`;
const profileClient = createProfileClient(apiBase);

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
      return uniqueWidgetTypes((JSON.parse(raw) as Block[]).filter((block) => !block.id.startsWith("city-") && block.title !== "Your spending city"));
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
  const [profileReload, setProfileReload] = useState(0);
  const profile = useLatest(
    source.mode === "api" && customerId ? `profile:${customerId}:${profileReload}` : null,
    (signal) => profileClient.get(customerId ?? "", signal),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // What answers typed questions. Known at once without the backend; with it, the backend is asked.
  const [mode, setMode] = useState<ChatMode>(geminiAvailable ? "browser" : "mock");
  useEffect(() => {
    let current = true;
    void chatMode(source.mode === "api").then((m) => current && setMode(m));
    return () => {
      current = false;
    };
  }, [source.mode]);
  // Keyed by source and customer: an answer for a customer who is no longer selected is never shown.
  const customer = useLatest(customerId && `${source.mode}:${customerId}`, (signal) => source.customer(customerId ?? "", signal));
  const info = customer.status === "ready" ? customer.data : null;
  const shownCustomer = useRef(customerId);
  shownCustomer.current = customerId;
  const [chatRequest, setChatRequest] = useState<{ text: string; n: number; canned?: boolean } | null>(null);
  /** How the coach looked and what it offered next in its latest answer. */
  const [coach, setCoach] = useState<CoachState | null>(null);
  // What the model said, with placeholders unfilled: figures are never sent back to it.
  const history = useRef<{ customerId: string; turns: { role: "user" | "assistant"; text: string }[] }>({ customerId: "", turns: [] });

  const toggleDev = (on: boolean) => {
    setDev(on);
    setGallery(on);
    setDevInUrl(on);
  };

  useEffect(() => {
    if (profile.status === "ready" && profile.data.isDefault && customerId && store.get(coachingPromptKey(customerId)) !== "done") {
      setSettingsOpen(true);
    }
  }, [profile.status, customerId, profile.status === "ready" ? profile.data.isDefault : false]);

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

  /** The categories the coach's latest answer asked about taking off the keep-as-is list, per customer. */
  const askedUnprotect = useRef<{ customerId: string; categories: ProtectedCategory[] }>({ customerId: "", categories: [] });

  /** Suggested prompts are canned (answered locally, no API call); typed questions go to the agent. */
  const ask = async (question: string, canned = false, allowProtected?: ProtectedCategory[], image?: ChatImage) => {
    if (customer.status === "error") return { text: "I couldn't load your data. Use “Try again” above first." };
    if (!dashboard || !info) return { text: "Still loading your data…" };
    // The whole answer is for the customer who asked, also if another one is selected before it is ready.
    const { customerId: askedFor, blocks } = dashboard;
    if (history.current.customerId !== askedFor) history.current = { customerId: askedFor, turns: [] };
    const ctx = {
      customerId: askedFor,
      blocks,
      today: info.today,
      history: history.current.turns,
      run: ((fn, args = {}) => source.runData(askedFor, { kind: "engine", fn, args })) as RunEngine,
      useBackend: source.mode === "api",
      allowProtected,
      // What the previous answer asked about taking off the keep-as-is list: this message may be the yes.
      pendingUnprotect: askedUnprotect.current.customerId === askedFor ? askedUnprotect.current.categories : [],
      image,
    };
    const reply = await (canned ? cannedReply : askAgent)(question, ctx);
    askedUnprotect.current = { customerId: askedFor, categories: (reply.proposedUnprotect ?? []) as ProtectedCategory[] };
    // The coach changed the saved preferences: show the new ones in the coaching settings too.
    if (reply.profileChanged) {
      store.set(coachingPromptKey(askedFor), "done");
      setProfileReload((n) => n + 1);
    }
    if (shownCustomer.current === askedFor) setCoach({ mood: reply.mood ?? null, suggestions: reply.suggestions ?? [] });
    const after = applyDashboardOps({ customerId: askedFor, blocks }, reply.ops).blocks;
    if (reply.ops.length) {
      // Keep older cards on the dashboard; add_block with an existing id still updates that card.
      updateBlocks(askedFor, (prev) => applyDashboardOps({ customerId: askedFor, blocks: prev }, reply.ops).blocks);
      if (shownCustomer.current === askedFor) document.querySelector(".dashboard")?.scrollTo({ top: 0, behavior: "smooth" });
    }
    history.current.turns = [...history.current.turns, { role: "user" as const, text: reply.photo ? photoQuestion(question, reply.photo) : question }, { role: "assistant" as const, text: reply.text }].slice(-10);

    // Fill {{blockId.value}} / {{blockId.caption}} from the computed results, here in the browser.
    const results = new Map<string, EngineResult>();
    await Promise.all(
      placeholderBlockIds(reply.text).map(async (id) => {
        const b = after.find((x) => x.id === id);
        if (b) results.set(id, await source.runData(askedFor, b.data).catch(() => ({ rows: [] }) as EngineResult));
      }),
    );
    return {
      text: fillPlaceholders(reply.text, (id, field) => {
      const r = results.get(id);
      return r && (field === "value" ? formatValue(r) : r.caption);
      }),
      blocked: reply.blocked as ProtectedCategory[] | undefined,
      proposedUnprotect: reply.proposedUnprotect as ProtectedCategory[] | undefined,
      photo: reply.photo,
    };
  };

  const saveProfile = async (update: ProfileUpdate) => {
    if (!customerId) return;
    await profileClient.update(customerId, update);
    store.set(coachingPromptKey(customerId), "done");
    setProfileReload((n) => n + 1);
  };

  const skipProfile = () => {
    if (customerId) store.set(coachingPromptKey(customerId), "done");
    setSettingsOpen(false);
  };

  const addBlock = (block: Block) => {
    if (!customerId) return;
    updateBlocks(customerId, (prev) => applyDashboardOps({ customerId, blocks: prev }, [{ op: "add_block", block: { ...block, pinned: true }, index: 0 }]).blocks);
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
        {/* The top bar mirrors a screen inside S-mobiili: back, centred title, messages. Both icons are decorative here. */}
        <header className="topbar">
          <span className="topbar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </span>
          <h1 className="topbar-title"><CoachFace face="neutral" />Money coach</h1>
          <span className="topbar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M4 5h16v11H9l-5 4z" />
            </svg>
          </span>
        </header>
        {/* Demo controls, kept apart from the product: which synthetic customer to show. */}
        {indexData && (
          <div className="demo-bar">
            <span>Demo customer</span>
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
              {source.mode === "api" && profile.status === "ready" && (
                <button type="button" className="ghost-btn" onClick={() => setSettingsOpen(true)} title="Change coaching settings">
                  Coaching
                </button>
              )}
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
          </div>
        )}

        <main className="dashboard" aria-label={gallery ? "Component gallery" : "Your dashboard"}>
          {index.status === "error" && <LoadError error={index.error} retry={index.retry} />}
          {customer.status === "error" && <LoadError error={customer.error} retry={customer.retry} />}
          {info && (
            <p className="intro muted small">
              {preset ? `${preset.label} · ${preset.blurb}` : `Customer ${info.customerId}, age ${info.age}`} · data up to {formatDate(info.today)}
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

        <Chat onAsk={ask} resetKey={customerId ?? ""} request={chatRequest} mode={mode} coach={coach} />

        {settingsOpen && profile.status === "ready" && source.mode === "api" && (
          <CoachingSettings
            profile={profile.data.profile}
            onboarding={profile.data.isDefault && store.get(coachingPromptKey(customerId ?? "")) !== "done"}
            onSave={saveProfile}
            onSkip={skipProfile}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        {drill && drill.customerId === customerId && (
          <TxDrawer customerId={drill.customerId} title={drill.title} filter={drill.filter} onClose={() => setDrill(null)} />
        )}
      </div>
    </DataSourceContext.Provider>
  );
}
