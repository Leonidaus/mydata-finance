import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  isItemSubcategory,
  type LinkedReceipt,
  matchReceipt,
  type PaidBy,
  type ReceiptLine,
  type ReceiptRead,
  type ReceiptView,
  type Transaction,
} from "@mydata/shared";

/** The payment already has another receipt. */
export class ReceiptConflictError extends Error {}

interface ReceiptRow {
  receipt_id: string;
  created_at: string;
  merchant: string;
  mcc: string | null;
  receipt_date: string | null;
  receipt_time: string | null;
  total_eur: number | null;
  paid_by: string;
  status: string;
  tx_id: number | null;
  auto_matched: number;
  lines_mismatch: number;
}

interface LineRow {
  receipt_id: string;
  name: string;
  subcategory: string;
  line_kind: string;
  amount_eur: number;
}

/**
 * Receipts the user has sent, in a writable SQLite file of their own (the finance database is
 * read-only). Only what was read from a photo is kept, never the photo. ":memory:" for tests.
 */
export class ReceiptStore {
  private db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS receipt (
        receipt_id     TEXT PRIMARY KEY,
        customer_id    TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        merchant       TEXT NOT NULL,
        mcc            TEXT,
        receipt_date   TEXT,
        receipt_time   TEXT,
        total_eur      REAL,
        paid_by        TEXT NOT NULL,
        status         TEXT NOT NULL CHECK (status IN ('unmatched', 'confirmed')),
        tx_id          INTEGER,
        auto_matched   INTEGER NOT NULL DEFAULT 0,
        lines_mismatch INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS receipt_customer ON receipt(customer_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS receipt_tx ON receipt(customer_id, tx_id) WHERE tx_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS receipt_line (
        receipt_id  TEXT NOT NULL REFERENCES receipt(receipt_id) ON DELETE CASCADE,
        line_no     INTEGER NOT NULL,
        name        TEXT NOT NULL,
        subcategory TEXT NOT NULL,
        line_kind   TEXT NOT NULL,
        amount_eur  REAL NOT NULL,
        PRIMARY KEY (receipt_id, line_no)
      );`);
  }

  private linesOf(ids: string[]): Map<string, ReceiptLine[]> {
    const out = new Map<string, ReceiptLine[]>(ids.map((id) => [id, []]));
    if (!ids.length) return out;
    const rows = this.db
      .prepare(`SELECT receipt_id, name, subcategory, line_kind, amount_eur FROM receipt_line WHERE receipt_id IN (${ids.map(() => "?").join(",")}) ORDER BY receipt_id, line_no`)
      .all(...ids) as unknown as LineRow[];
    for (const row of rows) {
      out.get(row.receipt_id)?.push({
        name: row.name,
        subcategory: isItemSubcategory(row.subcategory) ? row.subcategory : "other",
        amount: row.amount_eur,
        kind: row.line_kind === "deposit_return" ? "deposit_return" : "item",
      });
    }
    return out;
  }

  private views(rows: ReceiptRow[]): ReceiptView[] {
    const lines = this.linesOf(rows.map((r) => r.receipt_id));
    return rows.map((r) => ({
      id: r.receipt_id,
      createdAt: r.created_at,
      merchant: r.merchant,
      mcc: r.mcc,
      date: r.receipt_date,
      time: r.receipt_time,
      total: r.total_eur,
      paidBy: (["card", "cash"].includes(r.paid_by) ? r.paid_by : "unknown") as PaidBy,
      lines: lines.get(r.receipt_id) ?? [],
      linesMismatch: r.lines_mismatch === 1,
      status: r.status === "confirmed" ? "confirmed" : "unmatched",
      txId: r.tx_id,
      autoMatched: r.auto_matched === 1,
    }));
  }

  /** Newest first. */
  list(customerId: string): ReceiptView[] {
    const rows = this.db.prepare("SELECT * FROM receipt WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC").all(customerId) as unknown as ReceiptRow[];
    return this.views(rows);
  }

  get(customerId: string, receiptId: string): ReceiptView | null {
    const row = this.db.prepare("SELECT * FROM receipt WHERE customer_id = ? AND receipt_id = ?").get(customerId, receiptId) as unknown as ReceiptRow | undefined;
    return row ? this.views([row])[0] : null;
  }

  save(customerId: string, read: ReceiptRead, now = new Date().toISOString()): ReceiptView {
    const id = randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO receipt (receipt_id, customer_id, created_at, merchant, mcc, receipt_date, receipt_time, total_eur, paid_by, status, lines_mismatch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', ?)`,
        )
        .run(id, customerId, now, read.merchant, read.mcc, read.date, read.time, read.total, read.paidBy, read.linesMismatch ? 1 : 0);
      const insert = this.db.prepare("INSERT INTO receipt_line (receipt_id, line_no, name, subcategory, line_kind, amount_eur) VALUES (?, ?, ?, ?, ?, ?)");
      read.lines.forEach((line, i) => insert.run(id, i, line.name, line.subcategory, line.kind, line.amount));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(customerId, id) as ReceiptView;
  }

  /** Links a receipt to a payment. Throws ReceiptConflictError when that payment has another receipt. */
  link(customerId: string, receiptId: string, txId: number, auto = false): ReceiptView | null {
    const other = this.db.prepare("SELECT receipt_id FROM receipt WHERE customer_id = ? AND tx_id = ? AND receipt_id <> ?").get(customerId, txId, receiptId);
    if (other) throw new ReceiptConflictError("That payment already has a receipt");
    const changed = this.db
      .prepare("UPDATE receipt SET status = 'confirmed', tx_id = ?, auto_matched = ? WHERE customer_id = ? AND receipt_id = ?")
      .run(txId, auto ? 1 : 0, customerId, receiptId);
    return changed.changes ? this.get(customerId, receiptId) : null;
  }

  unlink(customerId: string, receiptId: string): ReceiptView | null {
    const changed = this.db.prepare("UPDATE receipt SET status = 'unmatched', tx_id = NULL, auto_matched = 0 WHERE customer_id = ? AND receipt_id = ?").run(customerId, receiptId);
    return changed.changes ? this.get(customerId, receiptId) : null;
  }

  delete(customerId: string, receiptId: string): boolean {
    return this.db.prepare("DELETE FROM receipt WHERE customer_id = ? AND receipt_id = ?").run(customerId, receiptId).changes > 0;
  }

  /** The payments that have a receipt. */
  linkedTxIds(customerId: string): Set<number> {
    const rows = this.db.prepare("SELECT tx_id FROM receipt WHERE customer_id = ? AND tx_id IS NOT NULL").all(customerId) as unknown as { tx_id: number }[];
    return new Set(rows.map((r) => r.tx_id));
  }

  /** What the engine gets: each linked receipt's lines, by payment. */
  linked(customerId: string): LinkedReceipt[] {
    return this.list(customerId)
      .filter((r) => r.status === "confirmed" && r.txId !== null)
      .map((r) => ({ txId: r.txId as number, lines: r.lines }));
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Saves a receipt that was read and matches it against the customer's payments. A strong match
 * is linked straight away; the result carries the match either way, for the app to show.
 */
export function saveAndMatch(store: ReceiptStore, customerId: string, read: ReceiptRead, tx: readonly Transaction[], today: string): ReceiptView {
  const saved = store.save(customerId, read);
  const match = matchReceipt(read, tx, today, store.linkedTxIds(customerId));
  const best = match.candidates[0];
  const linked = match.confidence === "strong" && best ? store.link(customerId, saved.id, best.txId, true) : null;
  return { ...(linked ?? saved), match, ...(linked && best && { payment: best }) };
}
