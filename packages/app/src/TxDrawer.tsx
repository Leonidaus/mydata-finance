import { type EngineContext, filterTransactions, lookupMcc, type TxFilter } from "@mydata/shared";
import { useEffect, useMemo, useRef } from "react";
import { formatDate, formatEurCents } from "./format";

interface Props {
  ctx: EngineContext;
  title: string;
  filter: TxFilter;
  onClose: () => void;
}

export default function TxDrawer({ ctx, title, filter, onClose }: Props) {
  const txs = useMemo(() => filterTransactions(ctx, filter).slice().reverse(), [ctx, filter]);
  const total = txs.reduce((a, t) => a + t.tx_amount_eur, 0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div>
            <h2>{title}</h2>
            <p className="muted small">
              {txs.length} transactions{filter.from && filter.to ? ` · ${formatDate(filter.from)}–${formatDate(filter.to)}` : ""} · total{" "}
              {formatEurCents(total)}
            </p>
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <ul className="tx-list">
          {txs.slice(0, 300).map((t, i) => (
            <li key={`${t.tx_timestamp}-${i}`}>
              <div>
                <span>{lookupMcc(t.mcc_code)?.label ?? t.category}</span>
                <span className="muted small">
                  {formatDate(t.tx_date)} · {t.category}
                </span>
              </div>
              <span className={t.tx_amount_eur < 0 ? "" : "pos"}>{formatEurCents(t.tx_amount_eur)}</span>
            </li>
          ))}
          {txs.length > 300 && <li className="muted small">Showing the latest 300 of {txs.length}.</li>}
          {txs.length === 0 && <li className="muted">No transactions match.</li>}
        </ul>
      </section>
    </div>
  );
}
