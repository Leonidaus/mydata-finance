/**
 * Dev mode: every kind of block the app can render, live on the current customer's data,
 * plus the demo prompts and a playground for pasting Block JSON (e.g. copied from an LLM
 * response) before the backend exists. Open with ?dev in the URL or the Dev button.
 */
import type { Block, TxFilter } from "@mydata/shared";
import { useState } from "react";
import { geminiAvailable } from "./agent/gemini";
import { DEMO_PROMPTS } from "./agent/mockAgent";
import BlockCard from "./BlockCard";
import { custom } from "./blocks/custom";
import { catalog } from "./catalog";

interface Props {
  customerId: string;
  today: string;
  onAdd: (block: Block) => void;
  /** canned: keyword answer; otherwise the question goes to the agent (Gemini when configured). */
  onAsk: (prompt: string, canned?: boolean) => void;
  onDrill: (title: string, filter: TxFilter) => void;
}

function gallery(): { section: string; note: string; blocks: Block[] }[] {
  return [
    {
      section: "Templates",
      note: "view.kind = \"template\": fixed views the app knows how to draw.",
      blocks: [
        catalog.safeToSpend(),
        catalog.categoryBars(),
        catalog.categoryBars({ category: "Restaurants" }),
        catalog.trend(),
        catalog.baskets(),
        catalog.forecast(),
        catalog.whatIf(),
        catalog.peers(),
        catalog.calendar(),
        catalog.recurring(),
        catalog.goal(),
      ],
    },
    {
      section: "Custom charts",
      note: "view.kind = \"spec\": a raw Vega-Lite spec. Without its own data, the engine rows are injected as data.values.",
      blocks: [custom.donut(), custom.weekday(), custom.pace()],
    },
    {
      section: "Iframe widgets",
      note: "view.kind = \"code\": HTML/JS in a sandboxed iframe (no network, opaque origin). Rows arrive via mydata.onData.",
      blocks: [custom.waffle(), custom.receipt()],
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
        <h2>Ask the agent</h2>
        <p className="muted small">
          {geminiAvailable
            ? "Typed questions go to Gemini with only the block definitions, never the figures. The answer opens on the dashboard."
            : "No GEMINI_API_KEY in packages/app/.env.local, so typed questions use the keyword stand-in."}
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
            placeholder="e.g. Show my spending by weekday in a fun way"
            aria-label="Question for the agent"
          />
          <button type="submit" disabled={!question.trim()}>
            Ask
          </button>
        </form>
      </section>

      <section className="dev-section">
        <h2>Demo prompts</h2>
        <p className="muted small">Tap one to send it to the stand-in agent and see the dashboard edit it makes.</p>
        {DEMO_PROMPTS.map((g) => (
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
          <h2>{s.section}</h2>
          <p className="muted small">{s.note}</p>
          {s.blocks.map((b) => (
            <div key={b.id} className="dev-item">
              <div className="dev-item-bar">
                <code>{viewLabel(b)}</code>
                <code>
                  {b.data.kind === "engine" ? b.data.fn : "sql"}
                </code>
                <button type="button" className="dev-add" onClick={() => onAdd(freshId(b))}>
                  + Add to dashboard
                </button>
              </div>
              <BlockCard block={b} customerId={customerId} today={today} onChange={(patch) => update(b.id, patch)} onDrill={onDrill} />
            </div>
          ))}
        </section>
      ))}

      <section className="dev-section">
        <h2>Block JSON playground</h2>
        <p className="muted small">
          Paste a Block (e.g. what an LLM returned for an add_block tool call) to check that it renders. Any view kind works;
          data must be an engine request.
        </p>
        <textarea className="dev-json" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label="Block JSON" />
        <div className="dev-item-bar">
          <button type="button" className="dev-add" onClick={render}>
            Render
          </button>
          {pasted && (
            <button type="button" className="dev-add" onClick={() => onAdd(freshId(pasted))}>
              + Add to dashboard
            </button>
          )}
        </div>
        {jsonError && <p className="block-error">{jsonError}</p>}
        {pasted && !jsonError && <BlockCard block={pasted} customerId={customerId} today={today} onChange={(patch) => setPasted({ ...pasted, ...patch })} onDrill={onDrill} />}
      </section>
    </>
  );
}
