import type { Block, EngineResult } from "@mydata/shared";
import { displayTitle, monthSpend } from "./BlockCard";
import { useDataSource } from "./data";
import { formatEur, formatValue } from "./format";
import { type Locale, useI18n } from "./i18n";
import { useLatest } from "./latest";

/** The one figure that stands for a saved card while the overview is folded. */
export function headline(block: Block, result: EngineResult, locale: Locale): string | undefined {
  // "This month's spending" shows what was spent, as its card does; the result's own value is what is left.
  if (block.data.kind === "engine" && block.data.fn === "monthSoFar") return formatEur(monthSpend(result), locale);
  return result.value === undefined ? undefined : formatValue(result.value, result.unit, locale);
}

function Figure({ block, customerId }: { block: Block; customerId: string }) {
  const { locale, t } = useI18n();
  const source = useDataSource();
  const outcome = useLatest(
    JSON.stringify([source.mode, customerId, block.data]),
    (signal) => source.runData(customerId, block.data, signal),
    `${source.mode}:${customerId}`,
  );
  const result = outcome.status === "ready" ? outcome.data : outcome.status === "loading" ? outcome.previous : undefined;
  const figure = result && headline(block, result, locale);
  return (
    <span className="overview-figure">
      {figure && <strong>{figure}</strong>} {displayTitle(block, t, locale)}
    </span>
  );
}

interface Props {
  blocks: Block[];
  customerId: string;
  open: boolean;
  onToggle: () => void;
}

/**
 * The bar between the top of the app and the conversation: the way back to what the user keeps,
 * from anywhere in the conversation. Folded, it shows each saved card's headline figure; open,
 * the cards themselves are the first thing in the conversation's scroll.
 */
export default function OverviewBar({ blocks, customerId, open, onToggle }: Props) {
  const { t } = useI18n();
  return (
    <button type="button" className="overview-bar" onClick={onToggle} aria-expanded={open} title={open ? t("overview.hide") : t("overview.show")}>
      <span className="overview-label">{t("overview.title")}</span>
      <span className="overview-figures">
        {!open && blocks.map((b) => <Figure key={b.id} block={b} customerId={customerId} />)}
        {!open && blocks.length === 0 && <span className="overview-figure">{t("overview.empty")}</span>}
      </span>
      <span className="overview-chevron" aria-hidden="true" />
    </button>
  );
}
