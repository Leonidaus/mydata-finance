/**
 * Dev mode: every kind of block the app can render, live on the current customer's data,
 * plus the demo prompts and a playground for pasting Block JSON (e.g. copied from an LLM
 * response) before the backend exists. Open with ?dev in the URL or the Dev button.
 */
import { investmentDownsideScenario, investmentGoalScenario, type Block, catalog, custom, type TxFilter, widgets } from "@mydata/shared";
import { useState } from "react";
import { geminiAvailable } from "./agent/gemini";
import { demoPrompts } from "./agent/mockAgent";
import BlockCard from "./BlockCard";
import { type TranslationKey, useI18n } from "./i18n";

interface Props {
  customerId: string;
  today: string;
  onAdd: (block: Block) => void;
  /** canned: keyword answer; otherwise the question goes to the agent (Gemini when configured). */
  onAsk: (prompt: string, canned?: boolean) => void;
  onDrill: (title: string, filter: TxFilter) => void;
}

function gallery(): { section: TranslationKey; note: TranslationKey; blocks: Block[] }[] {
  return [
    {
      section: "dev.investmentScenarios",
      note: "dev.investmentScenariosHelp",
      blocks: [investmentDownsideScenario(), investmentGoalScenario()],
    },
    {
      section: "dev.templates",
      note: "dev.templatesHelp",
      blocks: [
        catalog.safeToSpend(),
        catalog.monthSoFar(),
        catalog.categoryBars(),
        catalog.categoryBars({ category: "Restaurants" }),
        catalog.trend(),
        catalog.baskets(),
        catalog.forecast(),
        catalog.whatIf(),
        catalog.peers(),
        catalog.national(),
        catalog.calendar(),
        catalog.recurring(),
        catalog.goal(),
      ],
    },
    {
      section: "dev.customCharts",
      note: "dev.customChartsHelp",
      blocks: [custom.donut(), custom.weekday(), custom.pace(), custom.goalPlan({ target: 25000, saved: 10000, extra: 100, byMonths: 24, label: "Home deposit" }), custom.savingOptions(["Travel"]), custom.goalReview({ target: 25000, saved: 10000, monthly: 400, since: "2026-04", label: "Home deposit" })],
    },
    {
      section: "dev.iframeWidgets",
      note: "dev.iframeWidgetsHelp",
      blocks: [custom.waffle(), custom.receipt()],
    },
    {
      section: "dev.animatedWidgets",
      note: "dev.animatedWidgetsHelp",
      blocks: [widgets.story(), widgets.jar(), widgets.gauge(), widgets.flow(), widgets.coins()],
    },
  ];
}

const viewLabel = (b: Block) => (b.view.kind === "template" ? `template: ${b.view.template}` : b.view.kind === "spec" ? "spec: Vega-Lite" : "code: iframe");

const freshId = (b: Block): Block => ({ ...b, id: `${b.id.split("-")[0]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` });

const SAMPLE = JSON.stringify(
  {
    id: "pasted",
    title: "Groceries per month",
    explanation: "Pasted from the playground.",
    source: "own",
    data: { kind: "engine", fn: "monthlyTrend", args: { metric: "spending", category: "Groceries", months: 12 } },
    view: {
      kind: "spec",
      spec: {
        height: 160,
        mark: { type: "bar", color: "var(--chart-2)", cornerRadiusEnd: 3 },
        encoding: {
          x: { field: "month", type: "ordinal", title: null },
          y: { field: "amount", type: "quantitative", title: "€" },
        },
      },
    },
  },
  null,
  2,
);

function parseBlock(text: string): Block {
  const b = JSON.parse(text) as Partial<Block>;
  if (!b || typeof b !== "object") throw new Error("Expected a JSON object.");
  for (const k of ["title", "data", "view"] as const) if (!b[k]) throw new Error(`Missing "${k}".`);
  if (b.data?.kind !== "engine") throw new Error('Only data.kind "engine" is supported in the playground.');
  return { id: b.id ?? "pasted", explanation: b.explanation ?? "", source: b.source ?? "own", ...b } as Block;
}

export default function DevGallery({ customerId, today, onAdd, onAsk, onDrill }: Props) {
  const { locale, t } = useI18n();
  const [sections, setSections] = useState(gallery);
  const [json, setJson] = useState(SAMPLE);
  const [pasted, setPasted] = useState<Block | null>(() => parseBlock(SAMPLE));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const update = (id: string, patch: Partial<Block>) =>
    setSections((prev) => prev.map((s) => ({ ...s, blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })));

  const render = () => {
    try {
      setPasted(parseBlock(json));
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <section className="dev-section">
        <h2>{t("dev.askAgent")}</h2>
        <p className="muted small">
          {geminiAvailable
            ? t("dev.agentWithGemini")
            : t("dev.agentWithoutGemini")}
        </p>
        <form
          className="chat-input dev-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) onAsk(question.trim(), false);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("dev.questionPlaceholder")}
            aria-label={t("dev.questionLabel")}
          />
          <button type="submit" disabled={!question.trim()}>
            {t("chat.ask")}
          </button>
        </form>
      </section>

      <section className="dev-section">
        <h2>{t("dev.demoPrompts")}</h2>
        <p className="muted small">{t("dev.demoPromptsHelp")}</p>
        {demoPrompts(locale).map((g) => (
          <div key={g.group} className="dev-prompts">
            <h3>{g.group}</h3>
            <p className="muted small">{g.note}</p>
            <div className="dev-chips">
              {g.prompts.map((p) => (
                <button key={p} type="button" className="chip" onClick={() => onAsk(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {sections.map((s) => (
        <section key={s.section} className="dev-section">
          <h2>{t(s.section)}</h2>
          <p className="muted small">{t(s.note)}</p>
          {s.blocks.map((b) => (
            <div key={b.id} className="dev-item">
              <div className="dev-item-bar">
                <code>{viewLabel(b)}</code>
                <code>
                  {b.data.kind === "engine" ? b.data.fn : "sql"}
                </code>
                <button type="button" className="dev-add" onClick={() => onAdd(freshId(b))}>
                  + {t("dev.add")}
                </button>
              </div>
              <BlockCard block={b} customerId={customerId} today={today} onChange={(patch) => update(b.id, patch)} onDrill={onDrill} />
            </div>
          ))}
        </section>
      ))}

      <section className="dev-section">
        <h2>{t("dev.playground")}</h2>
        <p className="muted small">{t("dev.playgroundHelp")}</p>
        <textarea className="dev-json" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label={t("dev.jsonLabel")} />
        <div className="dev-item-bar">
          <button type="button" className="dev-add" onClick={render}>
            {t("dev.render")}
          </button>
          {pasted && (
            <button type="button" className="dev-add" onClick={() => onAdd(freshId(pasted))}>
              + {t("dev.add")}
            </button>
          )}
        </div>
        {jsonError && <p className="block-error">{jsonError}</p>}
        {pasted && !jsonError && <BlockCard block={pasted} customerId={customerId} today={today} onChange={(patch) => setPasted({ ...pasted, ...patch })} onDrill={onDrill} />}
      </section>
    </>
  );
}
