import {
  type Block,
  type Dashboard,
  defaultDashboard,
  type EngineResult,
  fillPlaceholders,
  photoQuestion,
  placeholderBlockIds,
  receiptQuestion,
  type TxFilter,
  type ProtectedCategory,
  type ProfileUpdate,
} from "@mydata/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { askAgent, cannedReply, type ChatMode, chatMode, geminiAvailable, type RunEngine } from "./agent";
import BlockCard, { displayTitle } from "./BlockCard";
import Chat, { type Focus, type VoiceControls } from "./Chat";
import CoachingSettings from "./CoachingSettings";
import CoachFace from "./CoachFace";
import { applyReply, type AskInput, type AskResult, contextBlocks, savedCard, savedState, saveToOverview } from "./conversation";
import DevGallery from "./DevGallery";
import { uniqueWidgetTypes } from "./dashboard";
import { apiBase, DataSourceContext, dataSource, fixtureSource, loadIndex } from "./data";
import { formatDate, formatValue } from "./format";
import { useI18n } from "./i18n";
import { useLatest } from "./latest";
import LoadError from "./LoadError";
import OverviewBar from "./Overview";
import TxDrawer from "./TxDrawer";
import { createProfileClient } from "./sources/profile";
import { createReceiptClient } from "./sources/receipts";
import { ReceiptList, ReceiptsContext, receiptModelText, receiptReply } from "./receipts";

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
// The cards under this key are the overview: what the user keeps. From the time when every answer
// added a card to a dashboard, a stored list may be long; it is kept as it is, and can be reset.
const dashboardKey = (cid: string) => `mydata.dashboard.v3.${cid}`;
const coachingPromptKey = (cid: string) => `mydata.coachingPrompt.v1.${cid}`;
const profileClient = createProfileClient(apiBase);
const receiptClient = createReceiptClient(apiBase);

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

function loadBlocks(cid: string): Block[] {
  const raw = store.get(dashboardKey(cid));
  if (raw) {
    try {
      return uniqueWidgetTypes((JSON.parse(raw) as Block[]).filter((block) => !block.id.startsWith("city-"))).map(savedCard);
    } catch {
      /* fall through to the default */
    }
  }
  return defaultDashboard();
}

export default function App() {
  const { locale, setLocale, t } = useI18n();
  const index = useLatest("index", loadIndex);
  const indexData = index.status === "ready" ? index.data : null;
  // The selected customer and their overview are one value, so the saved cards always belong to that customer.
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  // The overview opens the conversation and folds into its bar once the user starts talking.
  const [overviewOpen, setOverviewOpen] = useState(true);
  /** The card the user chose to ask about next. */
  const [focus, setFocus] = useState<Focus | null>(null);
  const [drill, setDrill] = useState<{ customerId: string; title: string; filter: TxFilter; evidenceNote?: string } | null>(null);
  const customerId = dashboard?.customerId ?? null;
  const [dev, setDev] = useState(devInUrl);
  const [gallery, setGallery] = useState(devInUrl);
  const source = dev ? fixtureSource : dataSource;
  const [profileReload, setProfileReload] = useState(0);
  // Moves whenever a receipt is linked, unlinked or deleted: item cards and the drawer fetch again.
  const [receiptsVersion, setReceiptsVersion] = useState(0);
  const receiptsChanged = useCallback(() => setReceiptsVersion((n) => n + 1), []);
  const receipts = useMemo(
    () => ({ client: source.mode === "api" ? receiptClient : null, version: receiptsVersion, changed: receiptsChanged }),
    [source.mode, receiptsVersion, receiptsChanged],
  );
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
  const [chatRequest, setChatRequest] = useState<{ text: string; n: number; canned?: boolean } | null>(null);
  const [voiceControls, setVoiceControls] = useState<VoiceControls | null>(null);
  const onVoiceControls = useCallback((controls: VoiceControls | null) => setVoiceControls(controls), []);

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

  /** Edits the overview of `forCustomer`. Does nothing if another customer has been selected since. */
  const updateBlocks = useCallback((forCustomer: string, next: (prev: Block[]) => Block[]) => {
    setDashboard((prev) => {
      if (prev?.customerId !== forCustomer) return prev;
      const blocks = next(prev.blocks);
      store.set(dashboardKey(forCustomer), JSON.stringify(blocks));
      return { customerId: forCustomer, blocks };
    });
  }, []);

  /**
   * Suggested prompts are canned (answered locally, no API call); typed questions go to the agent.
   * The coach is told about the cards of recent answers and the overview, edits those, and what it
   * added or changed comes back as this answer's cards.
   */
  const ask = async ({ question, canned, allowProtected, image, history, answers, focusId, pendingUnprotect }: AskInput): Promise<AskResult> => {
    if (customer.status === "error") return { text: t("chat.loadError") };
    if (!dashboard || !info) return { text: t("chat.stillLoading") };
    // The whole answer is for the customer who asked, also if another one is selected before it is ready.
    const { customerId: askedFor, blocks: overview } = dashboard;
    const context = contextBlocks(overview, answers, focusId);
    const ctx = {
      customerId: askedFor,
      blocks: context,
      today: info.today,
      history,
      run: ((fn, args = {}) => source.runData(askedFor, { kind: "engine", fn, args })) as RunEngine,
      useBackend: source.mode === "api",
      allowProtected,
      pendingUnprotect,
      image,
      language: locale,
    };
    const reply = await (canned ? cannedReply : askAgent)(question, ctx);
    // A receipt sent without words: saving it was the answer, and the app says so in the user's language.
    if (reply.receipt && !reply.text) {
      if (reply.receipt.status === "confirmed") receiptsChanged();
      const text = receiptReply(reply.receipt, locale, t);
      return { text, modelText: text, userText: receiptModelText(reply.receipt), photo: reply.photo, receipt: reply.receipt, cards: [], mood: null, suggestions: [] };
    }
    if (reply.receipt?.status === "confirmed") receiptsChanged();
    // The coach changed the saved preferences: show the new ones in the coaching settings too.
    if (reply.profileChanged) {
      store.set(coachingPromptKey(askedFor), "done");
      setProfileReload((n) => n + 1);
    }
    const applied = applyReply(overview, context, reply.ops);
    // A saved card the coach changed is changed in the overview as well, and a savings plan is saved.
    if (reply.ops.length) updateBlocks(askedFor, (prev) => applyReply(prev, context, reply.ops).overview);

    // Fill {{blockId.value}} / {{blockId.caption}} from the computed results, here in the browser.
    const results = new Map<string, EngineResult>();
    await Promise.all(
      placeholderBlockIds(reply.text).map(async (id) => {
        const b = applied.after.find((x) => x.id === id);
        if (b) results.set(id, await source.runData(askedFor, b.data).catch(() => ({ rows: [] }) as EngineResult));
      }),
    );
    return {
      text: fillPlaceholders(reply.text, (id, field) => {
        const r = results.get(id);
        if (!r) return undefined;
        return field === "value" ? (r.value === undefined ? undefined : formatValue(r.value, r.unit, locale)) : r.caption;
      }),
      // What the coach is given later as the conversation so far: its own words before the figures
      // were filled in (figures are never sent back to it), and the question with what a photo showed.
      modelText: reply.text,
      userText: reply.receipt ? receiptQuestion(question, reply.receipt) : reply.photo ? photoQuestion(question, reply.photo) : question,
      cards: applied.cards,
      removed: applied.removed,
      mood: reply.mood ?? null,
      suggestions: reply.suggestions ?? [],
      blocked: reply.blocked as ProtectedCategory[] | undefined,
      proposedUnprotect: reply.proposedUnprotect as ProtectedCategory[] | undefined,
      photo: reply.photo,
      receipt: reply.receipt,
    };
  };

  /** The Save button on an answer's card: saves it, saves its changes, or takes it out when it is saved as shown. */
  const toggleSaved = (block: Block) => {
    if (!customerId) return;
    updateBlocks(customerId, (prev) => (savedState(prev, block) === "saved" ? prev.filter((b) => b.id !== block.id) : saveToOverview(prev, block)));
  };

  const showOverview = (open: boolean) => {
    setOverviewOpen(open);
    if (open) document.querySelector(".conversation")?.scrollTo({ top: 0, behavior: "smooth" });
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
    updateBlocks(customerId, (prev) => saveToOverview(prev, block));
    setGallery(false);
    showOverview(true);
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
      <ReceiptsContext.Provider value={receipts}>
      <div className="app">
        {/* The top bar mirrors a screen inside S-mobiili: back, centred title, messages. Both icons are decorative here. */}
        <header className="topbar">
          <span className="topbar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </span>
          <h1 className="topbar-title"><CoachFace face="neutral" />{t("app.title")}</h1>
          <div className="topbar-actions">
            {voiceControls?.available && (
              <button
                className={`topbar-icon topbar-narration${voiceControls.speechEnabled ? " on" : ""}`}
                type="button"
                onClick={voiceControls.toggleSpeech}
                aria-pressed={voiceControls.speechEnabled}
                aria-label={voiceControls.speechEnabled ? t("chat.voiceReplyDisable") : t("chat.voiceReplyEnable")}
                title={voiceControls.speechEnabled ? t("chat.voiceReplyDisable") : t("chat.voiceReplyEnable")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
              </button>
            )}
            <button
              className="topbar-icon topbar-language"
              type="button"
              onClick={() => setLocale(locale === "en" ? "fi" : "en")}
              aria-label={t("language.switch", { language: t(locale === "en" ? "language.finnish" : "language.english") })}
              title={t("language.switch", { language: t(locale === "en" ? "language.finnish" : "language.english") })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="4" ry="9" />
                <path d="M12 3v18M3 12h18M4.5 7.5Q12 10 19.5 7.5M4.5 16.5Q12 14 19.5 16.5" />
              </svg>
              <span className="topbar-language-code" aria-hidden="true">{locale.toUpperCase()}</span>
            </button>
          </div>
        </header>
        {/* Demo controls, kept apart from the product: which synthetic customer to show. */}
        {indexData && (
          <div className="demo-bar">
            <span>{t("demo.customer")}</span>
            <div className="persona">
              <select value={customerId ?? ""} onChange={(e) => selectCustomer(e.target.value)} aria-label={t("demo.customerSelect")}>
                <optgroup label={t("demo.personas")}>
                  {indexData.presets.map((p) => (
                    <option key={p.customer_id} value={p.customer_id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("demo.otherCustomers")}>
                  {indexData.pool.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              </select>
              <button type="button" className="ghost-btn" onClick={pickRandom} title={t("demo.randomTitle")}>
                {t("demo.random")}
              </button>
              {source.mode === "api" && profile.status === "ready" && (
                <button type="button" className="ghost-btn" onClick={() => setSettingsOpen(true)} title={t("demo.coachingTitle")}>
                  {t("demo.coaching")}
                </button>
              )}
              {devAvailable && (
                <button
                  type="button"
                  className={`ghost-btn${dev ? " on" : ""}`}
                  onClick={() => toggleDev(!dev)}
                  aria-pressed={dev}
                  title={t(dev ? "dev.toggleOn" : "dev.toggleOff")}
                >
                  {t("dev.button")}
                </button>
              )}
              {dev && !gallery && (
                <button type="button" className="ghost-btn" onClick={() => setGallery(true)} title={t("dev.galleryTitle")}>
                  {t("dev.gallery")}
                </button>
              )}
            </div>
          </div>
        )}

        <main className="main">
          {info && dashboard && !gallery && (
            <OverviewBar blocks={dashboard.blocks} customerId={dashboard.customerId} open={overviewOpen} onToggle={() => showOverview(!overviewOpen)} />
          )}
          <Chat
            onAsk={ask}
            customerId={customerId ?? ""}
            today={info?.today}
            request={chatRequest}
            mode={mode}
            showLog={!gallery}
            overview={dashboard?.blocks}
            onSave={toggleSaved}
            onDrill={(title, filter, evidenceNote) => customerId && setDrill({ customerId, title, filter, evidenceNote })}
            focus={focus}
            onFocus={setFocus}
            onActive={(active) => setOverviewOpen(!active)}
            onVoiceControls={onVoiceControls}
            header={
              <>
                {index.status === "error" && <LoadError error={index.error} retry={index.retry} />}
                {customer.status === "error" && <LoadError error={customer.error} retry={customer.retry} />}
                {info && (
                  <p className="intro muted small">
                    {preset ? `${preset.label} · ${preset.blurb}` : t("dashboard.customer", { id: info.customerId, age: info.age })} · {t("dashboard.dataUpTo", { date: formatDate(info.today, locale) })}
                    {dev && ` · ${t("dashboard.staticDemo")}`}
                  </p>
                )}
                {index.status !== "error" && customer.status === "loading" && (
                  <p className="muted" role="status">
                    {t("dashboard.loading")}
                  </p>
                )}
                {info && dashboard && gallery && (
                  <div className="gallery" role="region" aria-label={t("dashboard.gallery")}>
                    <DevGallery
                      customerId={dashboard.customerId}
                      today={info.today}
                      onAdd={addBlock}
                      onAsk={askFromGallery}
                      onDrill={(title, filter) => setDrill({ customerId: dashboard.customerId, title, filter })}
                    />
                  </div>
                )}
                {/* What the user keeps, at the start of the conversation's scroll. */}
                {info && dashboard && !gallery && overviewOpen && (
                  <section className="overview" aria-label={t("overview.title")}>
                    {dashboard.blocks.length === 0 && <p className="muted small">{t("overview.empty")}</p>}
                    {dashboard.blocks.map((b) => (
                      <BlockCard
                        key={b.id}
                        block={b}
                        customerId={dashboard.customerId}
                        today={info.today}
                        onChange={(patch) => updateBlocks(dashboard.customerId, (prev) => prev.map((x) => (x.id === b.id ? { ...x, ...patch } : x)))}
                        onRemove={() => updateBlocks(dashboard.customerId, (prev) => prev.filter((x) => x.id !== b.id))}
                        onAsk={() => setFocus({ id: b.id, title: displayTitle(b, t, locale) })}
                        onDrill={(title, filter, evidenceNote) => setDrill({ customerId: dashboard.customerId, title, filter, evidenceNote })}
                      />
                    ))}
                    <button type="button" className="ghost-btn reset" onClick={() => updateBlocks(dashboard.customerId, () => defaultDashboard().map(savedCard))}>
                      {t("overview.reset")}
                    </button>
                    {receipts.client && <ReceiptList customerId={dashboard.customerId} today={info.today} />}
                  </section>
                )}
              </>
            }
          />
        </main>

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
          <TxDrawer customerId={drill.customerId} title={drill.title} filter={drill.filter} evidenceNote={drill.evidenceNote} onClose={() => setDrill(null)} />
        )}
      </div>
      </ReceiptsContext.Provider>
    </DataSourceContext.Provider>
  );
}
