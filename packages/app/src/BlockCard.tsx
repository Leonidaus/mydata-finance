import { type Block, type Control, type EngineResult, PERIOD_OPTIONS, type TxFilter } from "@mydata/shared";
import { useMemo } from "react";
import type { TopLevelSpec } from "vega-lite";
import { type Datum, VEGA_TEMPLATES } from "./blocks/templates";
import { useDataSource } from "./data";
import { formatEur } from "./format";
import { useLatest } from "./latest";
import LoadError from "./LoadError";
import IframeBlock from "./renderers/IframeBlock";
import VegaBlock from "./renderers/VegaBlock";
import { useI18n } from "./i18n";

interface Props {
  block: Block;
  customerId: string;
  /** The demo's fixed "today", ISO date. */
  today: string;
  onChange: (patch: Partial<Block>) => void;
  /** Omit to hide the remove button (e.g. in the dev gallery). */
  onRemove?: () => void;
  /** Omit to hide the pin button. */
  onPin?: () => void;
  onDrill: (title: string, filter: TxFilter) => void;
}

export default function BlockCard({ block, customerId, today, onChange, onRemove, onPin, onDrill }: Props) {
  const { t } = useI18n();
  const source = useDataSource();
  // The answer is kept together with the block it was computed for, so that the two always match.
  const outcome = useLatest(
    JSON.stringify([source.mode, customerId, block.data]),
    async (signal) => ({ block, result: await source.runData(customerId, block.data, signal) }),
    `${source.mode}:${customerId}`,
  );
  // While new figures load after a control change, the previous ones stay visible but marked as updating.
  const updating = outcome.status === "loading" && outcome.previous !== undefined;
  const shown = outcome.status === "ready" ? { block, result: outcome.data.result } : outcome.status === "loading" ? outcome.previous : undefined;

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
          <span className={`badge badge-${block.source}`}>{t(`card.source.${block.source}`)}</span>
        </div>
        <div className="block-actions">
          {onPin && (
            <button
              type="button"
              className={`pin-btn${block.pinned ? " on" : ""}`}
              onClick={onPin}
              aria-pressed={!!block.pinned}
              title={block.pinned ? t("card.unpinTitle") : t("card.pinTitle")}
            >
              {block.pinned ? t("card.pinned") : t("card.pin")}
            </button>
          )}
          {onRemove && (
            <button type="button" className="icon-btn" onClick={onRemove} aria-label={t("card.remove", { title: block.title })}>
              ×
            </button>
          )}
        </div>
      </header>

      {block.controls && block.controls.length > 0 && (
        <div className="controls">
          {block.controls.map((c) => (
            <ControlInput key={c.arg} control={c} value={args[c.arg]} onChange={(v) => setArg(c.arg, v)} />
          ))}
        </div>
      )}

      {outcome.status === "error" ? (
        <LoadError error={outcome.error} retry={outcome.retry} />
      ) : shown ? (
        <div className={updating ? "block-body updating" : "block-body"} aria-busy={updating}>
          <BlockBody block={shown.block} result={shown.result} onDrill={onDrill} />
        </div>
      ) : (
        <p className="muted" role="status">
          {t("card.loading")}
        </p>
      )}
    </article>
  );
}

function BlockBody({ block, result, onDrill }: { block: Block; result: EngineResult; onDrill: Props["onDrill"] }) {
  const { locale, t } = useI18n();
  const view = block.view;
  const template = view.kind === "template" ? VEGA_TEMPLATES[view.template] : undefined;
  const spec = useMemo(
    () => (view.kind === "spec" ? withRows(view.spec, result) : template?.spec(block, result)),
    [view, template, block, result],
  );

  const drillAll = () => result.filter && onDrill(block.title, result.filter);

  /** Free-form views have no template drill rule, so infer the filter from the tapped datum's fields. */
  const onSelectGeneric = (datum: Datum) => {
    const extra = genericDrill(datum, block);
    if (!extra) return drillAll();
    const what = datum.label ?? datum.category ?? datum.month ?? datum.date;
    onDrill(what ? `${block.title}: ${String(what)}` : block.title, { ...result.filter, ...extra });
  };

  if (view.kind === "code") {
    return (
      <>
        {result.caption && <p className="muted small">{result.caption}</p>}
        <IframeBlock code={view.code} libs={view.libs} result={result} label={block.title} onSelect={onSelectGeneric} />
      </>
    );
  }

  if (view.kind === "spec") {
    return (
      <>
        {result.caption && <p className="muted small">{result.caption}</p>}
        {spec && <VegaBlock spec={spec} onSelect={onSelectGeneric} label={block.title} />}
      </>
    );
  }

  if (view.template === "stat") {
    // What has happened and what is expected comes first, up to a subtotal when the engine gives one.
    // What follows it (the precautions and the suggestion they lead to) is shown on request.
    const cut = result.rows.findIndex((r) => r.kind === "subtotal");
    const summary = cut >= 0 ? result.rows.slice(0, cut + 1) : result.rows;
    const detail = cut >= 0 ? result.rows.slice(cut + 1) : [];
    const term = (r: (typeof result.rows)[number]) => (
      <li key={String(r.term)}>
        <span>
          {r.term}
          {typeof r.coveredByReserve === "number" && r.coveredByReserve > 0 && (
            <span className="muted small"> · {t("card.coveredByReserve", { amount: formatEur(r.coveredByReserve, locale) })}</span>
          )}
        </span>
        <span className={(r.amount as number) < 0 ? "neg" : ""}>{formatEur(r.amount as number, locale)}</span>
      </li>
    );
    return (
      <div className="stat">
        <button type="button" className="stat-value" onClick={drillAll} title="Show the transactions behind this">
          {formatEur(result.value ?? 0, locale)}
        </button>
        {result.caption && <p className="stat-caption">{result.caption}</p>}
        <ul className="stat-terms">{summary.map(term)}</ul>
        {detail.length > 0 && (
          <>
            {/* The precautions are money kept available, not costs: they are in the calculation, not in the list above. */}
            <p className="stat-note">{t("card.precautionNote")}</p>
            <details className="stat-calc">
              <summary>{t("card.calcToggle")}</summary>
              <ul className="stat-terms">{detail.map(term)}</ul>
              <p className="muted small">{t("card.precautionPlanning")}</p>
            </details>
          </>
        )}
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
              <th>{t("card.payment")}</th>
              <th>{t("card.usually")}</th>
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
                <td>{t("card.day", { day: String(r.day) })}</td>
                <td className="num">{formatEur(r.amount as number, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  if (!template || !spec) return <p className="block-error">{t("card.unknownTemplate", { template: view.template })}</p>;

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
          <strong>{result.unit === "%" ? `${result.value}%` : formatEur(result.value, locale)}</strong>
          {result.unit && result.unit !== "€" && result.unit !== "%" && <span className="muted"> {result.unit.replace("€", "")}</span>}
        </p>
      )}
      {result.caption && <p className="muted small">{result.caption}</p>}
      <VegaBlock spec={spec} onSelect={onSelect} label={block.title} />
      {view.template === "goal_progress" && result.value !== undefined && (
        <p className="block-figure">
          <strong>{Math.round(result.value)}%</strong> <span className="muted">{t("card.goalProgress")}</span>
        </p>
      )}
    </>
  );
}

/** A free-form spec without its own `data` gets the engine rows injected as `data.values`. */
function withRows(spec: Record<string, unknown>, result: EngineResult): TopLevelSpec {
  return (spec.data ? spec : { ...spec, data: { values: result.rows } }) as unknown as TopLevelSpec;
}

const isStr = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);

function genericDrill(datum: Datum, block: Block): Partial<TxFilter> | null {
  const args = block.data.kind === "engine" ? block.data.args : {};
  if (block.data.kind === "engine" && block.data.fn === "spendBy" && typeof datum.key === "string" && datum.key) {
    return args.by === "merchant_type" ? { mcc: datum.key } : { category: datum.key };
  }
  if (isStr(datum.date, /^\d{4}-\d{2}-\d{2}$/)) return { date: datum.date };
  if (isStr(datum.month, /^\d{4}-\d{2}$/)) return { month: datum.month };
  if (isStr(datum.category, /./)) return { category: datum.category };
  if (isStr(datum.basket, /^(regular|irregular|everyday)$/)) return { basket: datum.basket as TxFilter["basket"] };
  return null;
}

function ControlInput({ control, value, onChange }: { control: Control; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useI18n();
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
  const label = control.kind === "period" ? t("controls.period") : control.label;
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
