/**
 * The customer's receipts on the backend. Receipts arrive through the chat (a photo of one);
 * this lists them, links one to a card payment, unlinks it, or deletes it. API mode only: the
 * bundled fixtures have nowhere to keep a receipt.
 */
import type { ChatImage, MatchCandidate, MatchResult, ReceiptView } from "@mydata/shared";
import { failureMessage } from "./api";

export interface ReceiptCandidates {
  match: MatchResult;
  /** Other card payments around the receipt's date, for when the matcher found none. */
  nearby: MatchCandidate[];
}

/** One photo read as a receipt: saved and matched, or nothing readable on it (not saved). */
export interface ReceiptReadResult {
  receipt: ReceiptView | null;
  unreadable: boolean;
}

export interface ReceiptClient {
  /** Reads one receipt photo, saves it and matches it to a payment, without a chat answer. */
  read(customerId: string, image: ChatImage, signal?: AbortSignal): Promise<ReceiptReadResult>;
  list(customerId: string, signal?: AbortSignal): Promise<ReceiptView[]>;
  candidates(customerId: string, receiptId: string, signal?: AbortSignal): Promise<ReceiptCandidates>;
  confirm(customerId: string, receiptId: string, txId: number): Promise<ReceiptView>;
  unlink(customerId: string, receiptId: string): Promise<ReceiptView>;
  remove(customerId: string, receiptId: string): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function createReceiptClient(base = "", fetchFn: typeof fetch = (...args) => fetch(...args)): ReceiptClient {
  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetchFn(base + path, init).catch((error: unknown) => {
      if (isRecord(error) && error.name === "AbortError") throw error;
      throw new Error("Could not reach the finance API. Is the backend running?");
    });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(failureMessage(res.status, body));
    if (!isRecord(body)) throw new Error("The finance API gave an unexpected answer about receipts.");
    return body;
  }
  const path = (customerId: string, receiptId?: string) =>
    `/api/customers/${encodeURIComponent(customerId)}/receipts${receiptId ? `/${encodeURIComponent(receiptId)}` : ""}`;
  const receipt = (body: Record<string, unknown>) => {
    if (!isRecord(body.receipt)) throw new Error("The finance API gave an unexpected answer about receipts.");
    return body.receipt as unknown as ReceiptView;
  };
  const post = (url: string, body?: unknown) =>
    call(url, { method: "POST", ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });

  return {
    async read(customerId, image, signal) {
      const body = await call(path(customerId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }), signal });
      return { receipt: isRecord(body.receipt) ? (body.receipt as unknown as ReceiptView) : null, unreadable: body.unreadable === true };
    },
    async list(customerId, signal) {
      const body = await call(path(customerId), { signal });
      return Array.isArray(body.receipts) ? (body.receipts as ReceiptView[]) : [];
    },
    async candidates(customerId, receiptId, signal) {
      const body = await call(`${path(customerId, receiptId)}/candidates`, { signal });
      return body as unknown as ReceiptCandidates;
    },
    confirm: async (customerId, receiptId, txId) => receipt(await post(`${path(customerId, receiptId)}/confirm`, { txId })),
    unlink: async (customerId, receiptId) => receipt(await post(`${path(customerId, receiptId)}/unlink`)),
    async remove(customerId, receiptId) {
      await call(path(customerId, receiptId), { method: "DELETE" });
    },
  };
}
