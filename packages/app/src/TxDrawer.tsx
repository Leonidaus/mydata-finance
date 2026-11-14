import { lookupMcc, type ReceiptView, type TxFilter } from "@mydata/shared";
import { useEffect, useRef, useState } from "react";
import { useDataSource } from "./data";
import { formatDate, formatEurCents } from "./format";
import { useLatest } from "./latest";
import LoadError from "./LoadError";
import { useI18n } from "./i18n";
import { MAX_TX_LIMIT } from "./sources/types";
import { ReceiptLines, useReceipts } from "./receipts";

const SHOW_LIMIT = 300;

interface Props {
  customerId: string;
  title: string;
  filter: TxFilter;
  /** Explains why this evidence was opened, without making its total look like a forecast. */
  evidenceNote?: string;
  onClose: () => void;
}

export default function TxDrawer({ customerId, title, filter, evidenceNote, onClose }: Props) {
  const { locale, t, category } = useI18n();
  // Asks for as many as a data source gives at once, so that the total covers every match in practice.
  const source = useDataSource();
  const { client: receiptClient, version } = useReceipts();
  const page = useLatest(JSON.stringify([source.mode, customerId, filter, version]), (signal) =>
    source.transactions(customerId, filter, MAX_TX_LIMIT, signal),
  );
  // The customer's receipts, by the payment they are linked to: a row with one can show its items.
  const receiptList = useLatest(receiptClient ? `drawer-receipts:${customerId}:${version}` : null, (signal) => receiptClient!.list(customerId, signal));
  const receiptOf = new Map<number, ReceiptView>(
    (receiptList.status === "ready" ? receiptList.data : []).flatMap((r) => (r.txId === null ? [] : [[r.txId, r] as const])),
  );
  const [openReceipt, setOpenReceipt] = useState<number | null>(null);
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
                {t("drawer.transactions", { count })}{filter.from && filter.to ? ` · ${formatDate(filter.from, locale)}–${formatDate(filter.to, locale)}` : ""} ·{" "}
                {count > txs.length ? t("drawer.latestTotal", { count: txs.length }) : t("drawer.total")} {formatEurCents(total, locale)}
              </p>
            )}
            {evidenceNote && <p className="drawer-evidence muted small">{evidenceNote}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label={t("drawer.close")}>
            ×
          </button>
        </header>
        {page.status === "error" ? (
          <div className="sheet-status">
            <LoadError error={page.error} retry={page.retry} />
          </div>
        ) : page.status === "loading" ? (
          <p className="sheet-status muted" role="status">
            {t("drawer.loading")}
          </p>
        ) : (
          <ul className="tx-list">
            {txs.slice(0, SHOW_LIMIT).map((tx, i) => {
              const receipt = tx.tx_id === undefined ? undefined : receiptOf.get(tx.tx_id);
              const open = receipt !== undefined && openReceipt === tx.tx_id;
              return (
                <li key={`${tx.tx_timestamp}-${i}`} className={receipt ? "tx-with-receipt" : undefined}>
                  <div className="tx-row">
                    <div>
                      <span>{receipt?.merchant || (lookupMcc(tx.mcc_code)?.label ?? tx.category)}</span>
                      <span className="muted small">
                        {formatDate(tx.tx_date, locale)} · {category(tx.category)}
                      </span>
                    </div>
                    {receipt && (
                      <button
                        type="button"
                        className={`receipt-toggle${open ? " on" : ""}`}
                        aria-expanded={open}
                        aria-label={open ? t("drawer.hideReceipt") : t("drawer.showReceipt")}
                        title={open ? t("drawer.hideReceipt") : t("drawer.showReceipt")}
                        onClick={() => setOpenReceipt(open ? null : (tx.tx_id as number))}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
                          <path d="M9 8h6M9 12h6M9 16h4" />
                        </svg>
                      </button>
                    )}
                    <span className={tx.tx_amount_eur < 0 ? "" : "pos"}>{formatEurCents(tx.tx_amount_eur, locale)}</span>
                  </div>
                  {open && <ReceiptLines receipt={receipt} />}
                </li>
              );
            })}
            {count > SHOW_LIMIT && (
              <li className="muted small">
                {t("drawer.showing", { shown: SHOW_LIMIT, count })}
              </li>
            )}
            {count === 0 && <li className="muted">{t("drawer.empty")}</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
