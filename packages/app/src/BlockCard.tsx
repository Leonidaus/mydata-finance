import { type Block, type Control, type EngineResult, PERIOD_OPTIONS, type TxFilter } from "@mydata/shared";
import { type ReactNode, useId, useMemo } from "react";
import type { TopLevelSpec } from "vega-lite";
import { type Datum, VEGA_TEMPLATES } from "./blocks/templates";
import type { SavedState } from "./conversation";
import { useDataSource } from "./data";
import { formatEur } from "./format";
import { useLatest } from "./latest";
import LoadError from "./LoadError";
import IframeBlock from "./renderers/IframeBlock";
import VegaBlock from "./renderers/VegaBlock";
import { type TranslationKey, useI18n } from "./i18n";
import { useReceipts } from "./receipts";

interface Props {
  block: Block;
  customerId: string;
  /** The demo's fixed "today", ISO date. */
  today: string;
  onChange: (patch: Partial<Block>) => void;
  /** Omit to hide the remove button (in an answer, in the dev gallery). */
  onRemove?: () => void;
  /** Saves the card to the overview, or takes it out again when it is saved as shown. Omit to hide the button. */
  onSave?: () => void;
  /** Whether the overview has this card, and has it as it is shown here. */
  saved?: SavedState;
  /** Makes this card the subject of the user's next question. Omit to hide the button. */
  onAsk?: () => void;
  /** Where the card sits: on its own (overview, gallery) or attached to one of the coach's answers. */
  variant?: "card" | "answer";
  onDrill: (title: string, filter: TxFilter, evidenceNote?: string) => void;
}

export default function BlockCard({ block, customerId, today, onChange, onRemove, onSave, saved = "no", onAsk, variant = "card", onDrill }: Props) {
  const { t } = useI18n();
  // The same card can be on screen more than once (in two answers, or in an answer and the overview).
  const titleId = useId();
  const source = useDataSource();
  // Item figures come from receipts, so they are fetched again when a receipt is linked or unlinked.
  const receiptsVersion = useReceipts().version;
  const fromReceipts = block.data.kind === "engine" && block.data.fn === "itemSpend";
  // The answer is kept together with the block it was computed for, so that the two always match.
  const outcome = useLatest(
    JSON.stringify([source.mode, customerId, block.data, fromReceipts ? receiptsVersion : 0]),
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
  const title = displayTitle(block, t);

  return (
    <article className={variant === "answer" ? "block block-answer" : "block"} aria-labelledby={titleId}>
      <header className="block-head">
        <div>
          <h3 id={titleId}>{title}</h3>
          <CardBadges source={block.source} />
        </div>
        {onRemove && (
          <button type="button" className="icon-btn" onClick={onRemove} aria-label={t("card.remove", { title })}>
            ×
          </button>
        )}
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

      {(onAsk || onSave) && (
        <footer className="card-actions">
          {onAsk && (
            <button type="button" className="card-action" onClick={onAsk}>
              {t("card.ask")}
            </button>
          )}
          {onSave && (
            <button
              type="button"
              className={`card-action${saved === "saved" ? " on" : ""}`}
              onClick={onSave}
              aria-pressed={saved === "saved"}
              title={saved === "saved" ? t("card.unsaveTitle") : saved === "changed" ? t("card.saveChangesTitle") : t("card.saveTitle")}
            >
              {saved === "saved" ? t("card.saved") : saved === "changed" ? t("card.saveChanges") : t("card.save")}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

function BlockBody({ block, result, onDrill }: { block: Block; result: EngineResult; onDrill: Props["onDrill"] }) {
  const { locale, t } = useI18n();
  const presented = presentResult(block, result, locale, t);
  const view = block.view;
  const template = view.kind === "template" ? VEGA_TEMPLATES[view.template] : undefined;
  const spec = useMemo(
    () => (view.kind === "spec" ? withRows(view.spec, presented) : template?.spec(block, presented, locale)),
    [view, template, block, presented, locale],
  );

  const drillAll = () => presented.filter && onDrill(block.title, presented.filter);

  /** Free-form views have no template drill rule, so infer the filter from the tapped datum's fields. */
  const onSelectGeneric = (datum: Datum) => {
    const extra = genericDrill(datum, block);
    if (!extra) return drillAll();
    const what = datum.label ?? datum.category ?? datum.month ?? datum.date;
    onDrill(what ? `${block.title}: ${String(what)}` : block.title, { ...presented.filter, ...extra });
  };

  if (view.kind === "code") {
    return (
      <>
        <ResultCaption caption={presented.caption} />
        <IframeBlock code={view.code} libs={view.libs} result={presented} label={block.title} onSelect={onSelectGeneric} />
        <CardContext block={block} result={presented} onDrill={onDrill} explanation={presented.explanation} />
      </>
    );
  }

  if (view.kind === "spec") {
    return (
      <>
        <ResultCaption caption={presented.caption} />
        {spec && <VegaBlock spec={spec} onSelect={onSelectGeneric} label={block.title} />}
        <CardContext block={block} result={presented} onDrill={onDrill} explanation={presented.explanation} />
      </>
    );
  }

  if (view.template === "stat") {
    const isMonthSummary = block.data.kind === "engine" && block.data.fn === "monthSoFar";
    const isSafeToSpend = block.data.kind === "engine" && block.data.fn === "safeToSpend";
    const value = isMonthSummary ? monthSpend(presented) : presented.value ?? 0;
    return (
      <div className="stat">
        <p className="stat-value">{formatEur(value, locale)}</p>
        <ResultCaption caption={presented.caption} className="stat-caption" />
        {isMonthSummary && <p className="stat-note">{t("card.monthNotAllowance")}</p>}
        <CardContext
          block={block}
          result={presented}
          onDrill={onDrill}
          explanation={presented.explanation}
          calculation={isSafeToSpend ? <SafeToSpendCalculation rows={presented.rows} /> : <StatTerms rows={presented.rows} />}
        />
      </div>
    );
  }

  if (view.template === "recurring_list") {
    return (
      <>
        <ResultCaption caption={presented.caption} />
        <table className="list">
          <thead>
            <tr>
              <th>{t("card.payment")}</th>
              <th>{t("card.usually")}</th>
              <th className="num">€</th>
            </tr>
          </thead>
          <tbody>
            {presented.rows.map((r) => (
              <tr
                key={`${r.category}-${r.label}-${r.day}`}
                onClick={() => onDrill(String(r.label), { ...presented.filter, category: String(r.category) })}
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
        <CardContext block={block} result={presented} onDrill={onDrill} explanation={presented.explanation} />
      </>
    );
  }

  if (!template || !spec) return <p className="block-error">{t("card.unknownTemplate", { template: view.template })}</p>;

  const onSelect = (datum: Datum) => {
    const extra = template.drill?.(datum, block);
    if (extra === undefined) return drillAll();
    const what = datum.label ?? datum.category ?? datum.month ?? datum.iso;
    if (extra) onDrill(what ? `${block.title}: ${String(what)}` : block.title, { ...presented.filter, ...extra });
  };

  return (
    <>
      {presented.value !== undefined && view.template !== "goal_progress" && (
        <p className="block-figure">
          <strong>{presented.unit === "%" ? `${presented.value}%` : formatEur(presented.value, locale)}</strong>
          {presented.unit && presented.unit !== "€" && presented.unit !== "%" && <span className="muted"> {presented.unit.replace("€", "")}</span>}
        </p>
      )}
      <ResultCaption caption={presented.caption} />
      <VegaBlock spec={spec} onSelect={onSelect} label={block.title} />
      {view.template === "goal_progress" && presented.value !== undefined && (
        <p className="block-figure">
          <strong>{Math.round(presented.value)}%</strong> <span className="muted">{t("card.goalProgress")}</span>
        </p>
      )}
      <CardContext block={block} result={presented} onDrill={onDrill} explanation={presented.explanation} />
    </>
  );
}

function CardBadges({ source }: { source: Block["source"] }) {
  const { t } = useI18n();
  const origin = source === "estimate" ? t("card.basedOnYourData") : source === "own" ? t("card.source.own") : source === "peer" ? t("card.source.peer") : t("card.source.public");
  const status = source === "estimate" ? t("card.status.estimated") : source === "own" ? t("card.status.recorded") : t("card.status.benchmark");
  return (
    <div className="card-badges">
      <span className={`badge badge-${source}`}>{origin}</span>
      <span className="badge badge-status">{status}</span>
    </div>
  );
}

function CardContext({ block, result, onDrill, calculation, explanation = block.explanation }: { block: Block; result: EngineResult; onDrill: Props["onDrill"]; calculation?: ReactNode; explanation?: string }) {
  const { t } = useI18n();
  const hasExplanation = Boolean(explanation || result.assumptions?.length || calculation);
  return (
    <div className="card-context">
      {hasExplanation && (
        <details className="how">
          <summary>{t("card.howCalculated")}</summary>
          {explanation && <p>{explanation}</p>}
          {calculation}
          {(result.assumptions?.length ?? 0) > 0 && (
            <>
              <h4>{t("card.assumptions")}</h4>
              <ul className="card-assumptions">
                {result.assumptions?.map((assumption) => <li key={assumption}>{assumption}</li>)}
              </ul>
            </>
          )}
        </details>
      )}
      {result.filter && (
        <button
          type="button"
          className="evidence-btn"
          onClick={() => onDrill(`${block.title}: ${t("card.transactionEvidence")}`, result.filter!, t("drawer.evidenceNote"))}
        >
          {t("card.viewTransactions")}
        </button>
      )}
    </div>
  );
}

function ResultCaption({ caption, className = "muted small card-scope" }: { caption?: string; className?: string }) {
  const { t } = useI18n();
  return caption ? <p className={className}><strong>{t("card.scope")}:</strong> {caption}</p> : null;
}

/**
 * The initial dashboard's engine result has no localized presentation fields. Turn its stable
 * calculation data into the selected UI language here, alongside the other card presentation.
 * Model-created cards already arrive in the language passed to the model.
 */
type PresentedResult = EngineResult & { explanation?: string };
type Translate = ReturnType<typeof useI18n>["t"];

export function presentResult(block: Block, result: EngineResult, locale: ReturnType<typeof useI18n>["locale"], t: Translate): PresentedResult {
  // The engine's current English copy remains the complete English presentation. It carries no
  // parallel Finnish fields, so only Finnish needs the localized display projection below.
  if (locale === "en") return result;
  if (block.data.kind !== "engine") return result;
  const args = block.data.args;

  if (block.data.fn === "safeToSpend") {
    let expected = 0;
    let precaution = 0;
    const rows = result.rows.map((row) => {
      let key: TranslationKey | undefined;
      if (row.kind === "balance") key = "card.term.balanceToday";
      else if (row.kind === "reserve") key = typeof args.reserve === "number" ? "card.term.statedReserve" : "card.term.reserve";
      else if (row.kind === "expected") key = (["card.term.billsDue", "card.term.essentialsDue", "card.term.savingDue"] as const)[expected++];
      else if (row.kind === "subtotal") key = "card.term.payPeriodLeft";
      else if (row.kind === "precaution") key = (["card.term.unexpectedBuffer", "card.term.latePayday"] as const)[precaution++];
      else if (row.kind === "result") key = "card.term.safeToSpend";
      return key ? { ...row, term: t(key) } : row;
    });
    return {
      ...result,
      rows,
      caption: t(args.horizon === "until_payday" ? "card.safeScopePayday" : "card.safeScopeWeek"),
      explanation: t("card.safeDescription"),
      assumptions: [t("card.safeAssumption")],
    };
  }

  if (block.data.fn === "monthSoFar") {
    const terms: readonly TranslationKey[] = [
      "card.term.moneyIn",
      "card.term.regular",
      "card.term.irregular",
      "card.term.everyday",
      "card.term.movedToSavings",
      "card.term.monthLeft",
    ];
    return {
      ...result,
      rows: result.rows.map((row, index) => (terms[index] ? { ...row, term: t(terms[index]) } : row)),
      caption: t("card.monthScope"),
      explanation: t("card.monthDescription"),
      assumptions: [t("card.monthAssumptionPeriod"), t("card.monthAssumptionIncome"), t("card.monthAssumptionBalance")],
    };
  }

  return result;
}

function SafeToSpendCalculation({ rows }: { rows: EngineResult["rows"] }) {
  const { t } = useI18n();
  // Recorded and expected activity is shown before the subtotal. Precautions are planning
  // allowances, rather than costs, so they remain in a separate disclosure.
  const cut = rows.findIndex((row) => row.kind === "subtotal");
  const summary = cut >= 0 ? rows.slice(0, cut + 1) : rows;
  const detail = cut >= 0 ? rows.slice(cut + 1) : [];
  return (
    <>
      <StatTerms rows={summary} />
      {detail.length > 0 && (
        <>
          <p className="stat-note">{t("card.precautionNote")}</p>
          <details className="stat-calc">
            <summary>{t("card.calcToggle")}</summary>
            <StatTerms rows={detail} />
            <p className="muted small">{t("card.precautionPlanning")}</p>
          </details>
        </>
      )}
    </>
  );
}

function StatTerms({ rows }: { rows: EngineResult["rows"] }) {
  const { locale, t } = useI18n();
  return (
    <ul className="stat-terms">
      {rows.map((r) => (
        <li key={String(r.term)}>
          <span>
            {r.term}
            {typeof r.coveredByReserve === "number" && r.coveredByReserve > 0 && (
              <span className="muted small"> · {t("card.coveredByReserve", { amount: formatEur(r.coveredByReserve, locale) })}</span>
            )}
          </span>
          <span className={(r.amount as number) < 0 ? "neg" : ""}>{formatEur(r.amount as number, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

export function monthSpend(result: EngineResult): number {
  // `monthSoFar` returns income, the three spending baskets, saving and the remaining balance
  // in that order. The three baskets are the recorded spend; saving is deliberately excluded.
  return result.rows.slice(1, 4).reduce((total, row) => total - Number(row.amount), 0);
}

/** A card's title as shown: the two starting cards are named by the app, in the user's language. */
export function displayTitle(block: Block, t: ReturnType<typeof useI18n>["t"]): string {
  if (block.data.kind !== "engine") return block.title;
  if (block.data.fn === "safeToSpend") return block.data.args.horizon === "until_payday" ? t("card.safeTitlePayday") : t("card.safeTitleWeek");
  if (block.data.fn === "monthSoFar") return t("card.monthTitle");
  return block.title;
}

/** A free-form spec without its own `data` gets the engine rows injected as `data.values`. */
function withRows(spec: Record<string, unknown>, result: EngineResult): TopLevelSpec {
  return (spec.data ? spec : { ...spec, data: { values: result.rows } }) as unknown as TopLevelSpec;
}

const isStr = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);

function genericDrill(datum: Datum, block: Block): Partial<TxFilter> | null {
  const args = block.data.kind === "engine" ? block.data.args : {};
  if (block.data.kind === "engine" && block.data.fn === "itemSpend" && typeof datum.key === "string" && datum.key) return { subcategory: datum.key };
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
