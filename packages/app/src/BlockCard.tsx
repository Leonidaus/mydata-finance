import type { Block, Control, EngineContext, EngineResult, TxFilter } from "@mydata/shared";
import { useMemo } from "react";
import { type Datum, VEGA_TEMPLATES } from "./blocks/templates";
import { PERIOD_OPTIONS } from "./catalog";
import { runBlock } from "./data";
import { formatEur } from "./format";
import VegaBlock from "./renderers/VegaBlock";

const SOURCE_LABELS: Record<Block["source"], string> = {
  own: "Your data",
  peer: "Peer average",
  estimate: "Estimate",
};

interface Props {
  block: Block;
  ctx: EngineContext;
  onChange: (patch: Partial<Block>) => void;
  onRemove: () => void;
  onDrill: (title: string, filter: TxFilter) => void;
}

export default function BlockCard({ block, ctx, onChange, onRemove, onDrill }: Props) {
  const outcome = useMemo((): { result: EngineResult } | { error: string } => {
    try {
      return { result: runBlock(ctx, block) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [ctx, block]);

  const args = block.data.kind === "engine" ? block.data.args : {};
  const setArg = (arg: string, value: unknown) => {
    if (block.data.kind !== "engine") return;
    onChange({ data: { ...block.data, args: { ...block.data.args, [arg]: value } } });
  };

  return (
    <article className="block" aria-labelledby={`${block.id}-title`}>
      <header className="block-head">
        <div>
          <h3 id={`${block.id}-title`}>{block.title}</h3>
          <span className={`badge badge-${block.source}`}>{SOURCE_LABELS[block.source]}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remove ${block.title}`}>
          ×
        </button>
      </header>

      {block.controls && block.controls.length > 0 && (
        <div className="controls">
          {block.controls.map((c) => (
            <ControlInput key={c.arg} control={c} value={args[c.arg]} onChange={(v) => setArg(c.arg, v)} />
          ))}
        </div>
      )}

      {"error" in outcome ? (
        <p className="block-error">{outcome.error}</p>
      ) : (
        <BlockBody block={block} result={outcome.result} onDrill={onDrill} />
      )}

      <details className="how">
        <summary>How was this made?</summary>
        <p>{block.explanation}</p>
        <p className="muted small">
          Computed from your transactions up to {ctx.today}. The AI chose what to show; the numbers come from the
          calculation below, not from the AI.
        </p>
        <pre>{JSON.stringify({ data: block.data, view: block.view }, null, 2)}</pre>
      </details>
    </article>
  );
}

function BlockBody({ block, result, onDrill }: { block: Block; result: EngineResult; onDrill: Props["onDrill"] }) {
  const view = block.view;
  const template = view.kind === "template" ? VEGA_TEMPLATES[view.template] : undefined;
  const spec = useMemo(() => template?.spec(block, result), [template, block, result]);

  const drillAll = () => result.filter && onDrill(block.title, result.filter);

  if (view.kind !== "template") {
    return <p className="block-error">Custom {view.kind} blocks arrive in a later phase.</p>;
  }

  if (view.template === "stat") {
    return (
      <div className="stat">
        <button type="button" className="stat-value" onClick={drillAll} title="Show the transactions behind this">
          {formatEur(result.value ?? 0)}
        </button>
        {result.caption && <p className="stat-caption">{result.caption}</p>}
        <ul className="stat-terms">
          {result.rows.map((r) => (
            <li key={String(r.term)}>
              <span>{r.term}</span>
              <span className={(r.amount as number) < 0 ? "neg" : ""}>{formatEur(r.amount as number)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (view.template === "recurring_list") {
    return (
      <>
        {result.caption && <p className="muted small">{result.caption}</p>}
        <table className="list">
          <thead>
            <tr>
              <th>Payment</th>
              <th>Usually</th>
              <th className="num">€</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr
                key={`${r.category}-${r.label}-${r.day}`}
                onClick={() => onDrill(String(r.label), { ...result.filter, category: String(r.category) })}
              >
                <td>
                  {r.label}
                  <span className="muted small"> · {r.type}</span>
                </td>
                <td>day {r.day}</td>
                <td className="num">{formatEur(r.amount as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  if (!template || !spec) return <p className="block-error">Unknown template {view.template}.</p>;

  const onSelect = (datum: Datum) => {
    const extra = template.drill?.(datum, block);
    if (extra === undefined) return drillAll();
    const what = datum.label ?? datum.category ?? datum.month ?? datum.iso;
    if (extra) onDrill(what ? `${block.title}: ${String(what)}` : block.title, { ...result.filter, ...extra });
  };

  return (
    <>
      {result.value !== undefined && view.template !== "goal_progress" && (
        <p className="block-figure">
          <strong>{result.unit === "%" ? `${result.value}%` : formatEur(result.value)}</strong>
          {result.unit && result.unit !== "€" && result.unit !== "%" && <span className="muted"> {result.unit.replace("€", "")}</span>}
        </p>
      )}
      {result.caption && <p className="muted small">{result.caption}</p>}
      <VegaBlock spec={spec} onSelect={onSelect} label={block.title} />
      {view.template === "goal_progress" && result.value !== undefined && (
        <p className="block-figure">
          <strong>{Math.round(result.value)}%</strong> <span className="muted">of the goal</span>
        </p>
      )}
    </>
  );
}

function ControlInput({ control, value, onChange }: { control: Control; value: unknown; onChange: (v: unknown) => void }) {
  if (control.kind === "slider") {
    const v = typeof value === "number" ? value : control.min;
    return (
      <label className="control slider">
        <span>
          {control.label} <strong>{v}{control.unit ?? ""}</strong>
        </span>
        <input type="range" min={control.min} max={control.max} step={control.step} value={v} onChange={(e) => onChange(Number(e.target.value))} />
      </label>
    );
  }
  const options = control.kind === "period" ? PERIOD_OPTIONS : control.options;
  const label = control.kind === "period" ? "Period" : control.label;
  return (
    <label className="control">
      <span className="sr-only">{label}</span>
      <select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
