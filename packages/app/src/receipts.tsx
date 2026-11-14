/**
 * Receipts in the app: the client, a version that moves whenever a receipt is linked, unlinked or
 * deleted (so item cards and the drawer fetch again), and the card that shows one receipt.
 */
import type { MatchCandidate, ReceiptView } from "@mydata/shared";
import { createContext, useContext, useState } from "react";
import { formatDate, formatEurCents } from "./format";
import { useI18n } from "./i18n";
import { errorMessage, useLatest } from "./latest";
import LoadError from "./LoadError";
import type { ReceiptCandidates, ReceiptClient } from "./sources/receipts";

export interface ReceiptsState {
  /** Null where receipts are not available (fixture mode). */
  client: ReceiptClient | null;
  version: number;
  changed: () => void;
}

export const ReceiptsContext = createContext<ReceiptsState>({ client: null, version: 0, changed: () => undefined });
export const useReceipts = () => useContext(ReceiptsContext);

type T = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];

const itemLines = (r: ReceiptView) => r.lines.filter((l) => l.kind === "item");

/** The coach's reply to a receipt sent without words, written here in the user's language. */
export function receiptReply(r: ReceiptView, locale: Locale, t: T): string {
  if (r.total === null && r.lines.length === 0) return t("receipt.replyUnread");
  const values = {
    merchant: r.merchant || t("receipt.unknownMerchant"),
    total: r.total === null ? "?" : formatEurCents(r.total, locale),
    count: itemLines(r).length,
  };
  if (r.status === "confirmed") return t("receipt.replyLinked", { ...values, date: r.payment ? formatDate(r.payment.date, locale) : r.date ? formatDate(r.date, locale) : "" });
  if (r.match?.confidence === "possible") return t("receipt.replyPossible", values);
  return t("receipt.replyUnmatched", values);
}

/** What the coach is told later that the user sent. Not shown; the model reads English. */
export function receiptModelText(r: ReceiptView): string {
  return `[RECEIPT sent: ${r.merchant || "unknown shop"}, ${r.total ?? "?"} €, ${itemLines(r).length} items, ${r.status === "confirmed" ? "linked to its card payment" : "not linked to a payment"}]`;
}

function PaymentLine({ payment }: { payment: MatchCandidate }) {
  const { locale, category } = useI18n();
  return (
    <span className="receipt-payment">
      {formatDate(payment.date, locale)} {payment.timestamp.slice(11, 16)} · {category(payment.category as Parameters<typeof category>[0])} · {formatEurCents(-payment.amount, locale)}
    </span>
  );
}

interface Props {
  receipt: ReceiptView;
  customerId: string;
  /** The last day of bank data. */
  today?: string;
  /** The receipt as it is now, or null when it was deleted. */
  onChange: (receipt: ReceiptView | null) => void;
}

/** One receipt: what was read, which payment it belongs to, and the actions to fix that. */
export default function ReceiptCard({ receipt, customerId, today = "", onChange }: Props) {
  const { locale, t, subcategory } = useI18n();
  const { client, changed } = useReceipts();
  const [showItems, setShowItems] = useState(false);
  const [choosing, setChoosing] = useState<ReceiptCandidates | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = itemLines(receipt);
  const bySub = new Map<string, number>();
  for (const l of items) bySub.set(l.subcategory, (bySub.get(l.subcategory) ?? 0) + l.amount);
  const top = [...bySub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const suggestion = receipt.status === "unmatched" && receipt.match?.confidence === "possible" ? receipt.match.candidates[0] : undefined;
  const reason = receipt.status === "unmatched" && !suggestion ? receipt.match?.reason : undefined;
  const canChoose = receipt.total !== null && receipt.date !== null && reason !== "cash" && reason !== "after_data_end";

  async function act(run: () => Promise<ReceiptView | null>) {
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await run();
      setChoosing(null);
      changed();
      onChange(next);
    } catch (e) {
      setError(t("receipt.error", { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  }
  const confirm = (txId: number) => act(() => client!.confirm(customerId, receipt.id, txId));
  // "Not this payment": unlink it, then offer the payments to choose from instead.
  const unlink = async () => {
    await act(() => client!.unlink(customerId, receipt.id));
    await openChoice();
  };
  const remove = () =>
    act(async () => {
      await client!.remove(customerId, receipt.id);
      return null;
    });
  async function openChoice() {
    if (!client) return;
    setError(null);
    try {
      setChoosing(await client.candidates(customerId, receipt.id));
    } catch (e) {
      setError(t("receipt.error", { error: errorMessage(e) }));
    }
  }
  const choices = choosing ? [...choosing.match.candidates, ...choosing.nearby.filter((n) => !choosing.match.candidates.some((c) => c.txId === n.txId))] : [];

  return (
    <article className="receipt-card" aria-label={t("receipt.label")}>
      <header className="receipt-head">
        <div>
          <strong>{receipt.merchant || t("receipt.unknownMerchant")}</strong>
          <span className="muted small">
            {receipt.date ? formatDate(receipt.date, locale) : ""}
            {receipt.time ? ` ${receipt.time}` : ""}
            {receipt.date || receipt.time ? " · " : ""}
            {t("receipt.items", { count: items.length })}
          </span>
        </div>
        {receipt.total !== null && <strong className="receipt-total">{formatEurCents(receipt.total, locale)}</strong>}
      </header>

      {top.length > 0 && (
        <ul className="receipt-top">
          {top.map(([key, amount]) => (
            <li key={key}>
              {subcategory(key)} <span>{formatEurCents(amount, locale)}</span>
            </li>
          ))}
        </ul>
      )}
      {receipt.linesMismatch && <p className="receipt-note small">{t("receipt.mismatch")}</p>}

      <div className="receipt-status">
        {receipt.status === "confirmed" ? (
          <>
            <p className="small">
              <span className="receipt-ok" aria-hidden="true">✓</span> {receipt.autoMatched ? t("receipt.linkedAuto") : t("receipt.linked")}
              {receipt.payment && (
                <>
                  <br />
                  <PaymentLine payment={receipt.payment} />
                </>
              )}
            </p>
            {!choosing && (
              <div className="receipt-actions">
                <button type="button" className="card-action" disabled={busy} onClick={unlink}>
                  {t("receipt.notThis")}
                </button>
              </div>
            )}
          </>
        ) : suggestion && !choosing ? (
          <>
            <p className="small">
              {t("receipt.possible")}
              <br />
              <PaymentLine payment={suggestion} />
            </p>
            <div className="receipt-actions">
              <button type="button" className="card-action on" disabled={busy} onClick={() => confirm(suggestion.txId)}>
                {t("receipt.confirm")}
              </button>
              <button type="button" className="card-action" disabled={busy} onClick={() => openChoice()}>
                {t("receipt.chooseAnother")}
              </button>
            </div>
          </>
        ) : (
          !choosing && (
            <>
              <p className="small muted">{reason ? t(`receipt.reason.${reason}`, { date: today ? formatDate(today, locale) : "" }) : t("receipt.unmatched")}</p>
              {canChoose && (
                <div className="receipt-actions">
                  <button type="button" className="card-action" disabled={busy} onClick={() => openChoice()}>
                    {t("receipts.linkPayment")}
                  </button>
                </div>
              )}
            </>
          )
        )}

        {choosing && (
          <div className="receipt-choose" role="group" aria-label={t("receipt.choose")}>
            <p className="small">{t("receipt.choose")}</p>
            {choices.length === 0 && <p className="small muted">{t("receipt.noPayments")}</p>}
            {choices.map((c) => (
              <button key={c.txId} type="button" className="receipt-choice" disabled={busy} onClick={() => confirm(c.txId)}>
                <PaymentLine payment={c} />
              </button>
            ))}
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => setChoosing(null)}>
              {t("receipt.noneOfThese")}
            </button>
          </div>
        )}
      </div>

      {busy && <p className="small muted" role="status">{t("receipt.working")}</p>}
      {error && <p className="small receipt-note" role="alert">{error}</p>}

      <div className="receipt-foot">
        {receipt.lines.length > 0 && (
          <button type="button" className="ghost-btn" aria-expanded={showItems} onClick={() => setShowItems(!showItems)}>
            {showItems ? t("receipt.hideItems") : t("receipt.showItems")}
          </button>
        )}
        {client && (
          <button type="button" className="ghost-btn" disabled={busy} onClick={remove}>
            {t("receipt.delete")}
          </button>
        )}
      </div>
      {showItems && <ReceiptLines receipt={receipt} />}
    </article>
  );
}

/** The receipt's lines with their sub-category: also used in the transaction drawer. */
export function ReceiptLines({ receipt }: { receipt: ReceiptView }) {
  const { locale, t, subcategory } = useI18n();
  return (
    <ul className="receipt-lines">
      {receipt.lines.map((line, i) => (
        <li key={i}>
          <div>
            <span>{line.name}</span>
            <span className="muted small">{line.kind === "deposit_return" ? t("receipt.depositReturn") : subcategory(line.subcategory)}</span>
          </div>
          <span>{formatEurCents(line.amount, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

const LIST_SIZE = 5;

/** The newest receipts, on the overview: to check and fix what was linked. */
export function ReceiptList({ customerId, today }: { customerId: string; today: string }) {
  const { t } = useI18n();
  const { client, version } = useReceipts();
  const list = useLatest(client ? `receipts:${customerId}:${version}` : null, (signal) => (client as ReceiptClient).list(customerId, signal), customerId);
  const receipts = list.status === "ready" ? list.data : list.status === "loading" ? (list.previous ?? []) : [];
  return (
    <section className="receipt-list" aria-label={t("receipts.title")}>
      <h3>{t("receipts.title")}</h3>
      {list.status === "error" && <LoadError error={list.error} retry={list.retry} />}
      {list.status === "loading" && !list.previous && <p className="muted small" role="status">{t("receipts.loading")}</p>}
      {list.status === "ready" && receipts.length === 0 && <p className="muted small">{t("receipts.empty")}</p>}
      {/* Each card tells the context when it changes, and the list fetches again. */}
      {receipts.slice(0, LIST_SIZE).map((r) => (
        <ReceiptCard key={`${r.id}:${r.status}:${r.txId}`} receipt={r} customerId={customerId} today={today} onChange={() => undefined} />
      ))}
    </section>
  );
}
