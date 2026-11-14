import { lookupMcc, type TxFilter } from "@mydata/shared";
import { useEffect, useRef } from "react";
import { dataSource } from "./data";
import { formatDate, formatEurCents } from "./format";
import { useLatest } from "./latest";
import LoadError from "./LoadError";
import { MAX_TX_LIMIT } from "./sources/types";

const SHOW_LIMIT = 300;

interface Props {
  customerId: string;
  title: string;
  filter: TxFilter;
  onClose: () => void;
}

export default function TxDrawer({ customerId, title, filter, onClose }: Props) {
  // Asks for as many as a data source gives at once, so that the total covers every match in practice.
  const page = useLatest(JSON.stringify([customerId, filter]), (signal) => dataSource.transactions(customerId, filter, MAX_TX_LIMIT, signal));
  const txs = page.status === "ready" ? page.data.transactions : [];
  const count = page.status === "ready" ? page.data.count : 0;
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
            {page.status === "ready" && (
              <p className="muted small">
                {count} transactions{filter.from && filter.to ? ` · ${formatDate(filter.from)}–${formatDate(filter.to)}` : ""} ·{" "}
                {count > txs.length ? `total of the latest ${txs.length}` : "total"} {formatEurCents(total)}
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {page.status === "error" ? (
          <div className="sheet-status">
            <LoadError error={page.error} retry={page.retry} />
          </div>
        ) : page.status === "loading" ? (
          <p className="sheet-status muted" role="status">
            Loading transactions…
          </p>
        ) : (
          <ul className="tx-list">
            {txs.slice(0, SHOW_LIMIT).map((t, i) => (
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
            {count > SHOW_LIMIT && (
              <li className="muted small">
                Showing the latest {SHOW_LIMIT} of {count}.
              </li>
            )}
            {count === 0 && <li className="muted">No transactions match.</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
