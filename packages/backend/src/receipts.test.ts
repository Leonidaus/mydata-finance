import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChatModel, ChatModelRequest, ReceiptRead, ReceiptView } from "@mydata/shared";
import { createApp } from "./app";
import { ReceiptConflictError, ReceiptStore } from "./receipts";
import { createFixtureDb } from "./testing/fixture";

/** Fixture payment 3: CUST00001, 80 € at a grocery store on 2026-08-05 at 17:00. */
const groceryReceipt: ReceiptRead = {
  merchant: "Prisma",
  mcc: "5411",
  date: "2026-08-05",
  time: "16:58",
  total: 80,
  paidBy: "card",
  lines: [
    { name: "Fazer Sininen", subcategory: "snacks_sweets", amount: 12.5, kind: "item" },
    { name: "Bananas", subcategory: "produce", amount: 67.5, kind: "item" },
  ],
  linesMismatch: false,
};

describe("ReceiptStore", () => {
  it("keeps what was read, newest first, per customer", () => {
    const store = new ReceiptStore();
    const first = store.save("CUST00001", groceryReceipt, "2026-09-01T10:00:00Z");
    const second = store.save("CUST00001", { ...groceryReceipt, merchant: "K-Market" }, "2026-09-02T10:00:00Z");
    store.save("CUST00002", groceryReceipt);
    assert.deepEqual(store.list("CUST00001").map((r) => r.id), [second.id, first.id]);
    assert.deepEqual(first.lines, groceryReceipt.lines);
    assert.equal(first.status, "unmatched");
    assert.equal(store.get("CUST00002", first.id), null); // another customer's receipt is not found
  });

  it("links one receipt per payment, and unlinks and deletes", () => {
    const store = new ReceiptStore();
    const a = store.save("CUST00001", groceryReceipt);
    const b = store.save("CUST00001", groceryReceipt);
    assert.equal(store.link("CUST00001", a.id, 3)?.status, "confirmed");
    assert.throws(() => store.link("CUST00001", b.id, 3), ReceiptConflictError);
    assert.deepEqual(store.linked("CUST00001"), [{ txId: 3, merchant: "Prisma", lines: groceryReceipt.lines }]);
    assert.equal(store.unlink("CUST00001", a.id)?.txId, null);
    assert.equal(store.linked("CUST00001").length, 0);
    assert.equal(store.delete("CUST00001", a.id), true);
    assert.equal(store.get("CUST00001", a.id), null);
    assert.equal(store.delete("CUST00001", a.id), false);
  });
});

describe("receipts in the chat and the API", () => {
  /** A model that reads the photo as a receipt, reads the receipt, and answers a question with a fixed reply. */
  function receiptModel(read: Record<string, unknown>) {
    const seen: ChatModelRequest[] = [];
    const model: ChatModel = {
      async generate(request) {
        seen.push(request);
        const tool = request.tools[0]?.name;
        if (tool === "photo_read") return { calls: [{ name: "photo_read", args: { item: "grocery receipt", amount: 80, kind: "receipt" } }] };
        if (tool === "receipt_read") return { calls: [{ name: "receipt_read", args: read }] };
        return { calls: [{ name: "reply", args: { text: "Saved it." } }] };
      },
    };
    return { model, seen };
  }
  const readArgs = {
    merchant: "Prisma",
    mcc: "5411",
    date: "2026-08-05",
    time: "16:58",
    total: 80,
    paidBy: "card",
    lines: [
      { name: "Fazer Sininen", amount: 12.5, type: "item", subcategory: "snacks_sweets" },
      { name: "Bananas", amount: 67.5, type: "item", subcategory: "produce" },
    ],
  };
  const image = { mimeType: "image/jpeg", data: "AAAA" };

  async function call<T>(app: ReturnType<typeof createApp>, path: string, init?: { method: string; body?: unknown }) {
    const res = await app.request(path, {
      method: init?.method ?? "GET",
      ...(init?.body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  it("saves a receipt sent without words, links a strong match, and does not call the coach", async () => {
    const { model, seen } = receiptModel(readArgs);
    const receipts = new ReceiptStore();
    const app = createApp(createFixtureDb(), { chatModel: model, receipts });
    const { status, body } = await call<{ text: string; receipt: ReceiptView }>(app, "/api/chat", { method: "POST", body: { customerId: "CUST00001", question: "", image } });
    assert.equal(status, 200);
    assert.equal(body.text, "");
    assert.equal(body.receipt.status, "confirmed");
    assert.equal(body.receipt.txId, 3);
    assert.equal(body.receipt.autoMatched, true);
    assert.equal(body.receipt.match?.confidence, "strong");
    assert.deepEqual(seen.map((r) => r.tools[0]?.name), ["photo_read", "receipt_read"]);

    // The engine now itemises the shopping, and the drawer finds the payment behind it.
    const items = await call<{ rows: { key: string; amount: number }[]; caption: string; filter: Record<string, unknown> }>(app, "/api/customers/CUST00001/engine/itemSpend");
    assert.deepEqual(items.body.rows.map((r) => [r.key, r.amount]), [["produce", 67.5], ["snacks_sweets", 12.5]]);
    assert.match(items.body.caption, /^1 receipt on 5\.8\.2026 \(\d+% of Groceries spending\)$/);
    // The shop's name comes from the receipt: the bank data has none.
    const shop = await call<{ value: number; rows: { label: string }[] }>(app, "/api/customers/CUST00001/engine/itemSpend?shop=prisma");
    assert.equal(shop.body.value, 80);
    const byShop = await call<{ transactions: { tx_id: number }[] }>(app, "/api/transactions", { method: "POST", body: { customerId: "CUST00001", filter: { withReceipt: true, shop: "Prisma", item: "fazer" } } });
    assert.deepEqual(byShop.body.transactions.map((t) => t.tx_id), [3]);
    const behind = await call<{ transactions: { tx_id: number }[] }>(app, "/api/transactions", { method: "POST", body: { customerId: "CUST00001", filter: { ...items.body.filter, subcategory: "snacks_sweets" } } });
    assert.deepEqual(behind.body.transactions.map((t) => t.tx_id), [3]);
  });

  it("answers a question that came with a receipt, without the item names", async () => {
    const { model, seen } = receiptModel(readArgs);
    const app = createApp(createFixtureDb(), { chatModel: model });
    const { body } = await call<{ text: string; receipt: ReceiptView }>(app, "/api/chat", { method: "POST", body: { customerId: "CUST00001", question: "Was this a lot?", image } });
    assert.equal(body.text, "Saved it.");
    assert.ok(body.receipt);
    const coach = seen.find((r) => r.tools.some((t) => t.name === "reply"));
    const asked = coach?.turns.at(-1)?.text ?? "";
    assert.match(asked, /\[RECEIPT from the user, from Prisma, 80 €/);
    assert.equal(asked.includes("Fazer"), false);
  });

  it("leaves an unclear match for the user to confirm, and confirms, unlinks and deletes", async () => {
    const { model } = receiptModel({ ...readArgs, time: null, date: "2026-08-04" });
    const app = createApp(createFixtureDb(), { chatModel: model });
    const sent = await call<{ receipt: ReceiptView }>(app, "/api/chat", { method: "POST", body: { customerId: "CUST00001", question: "", image } });
    const receipt = sent.body.receipt;
    assert.equal(receipt.status, "unmatched");
    assert.equal(receipt.match?.confidence, "possible");
    assert.equal(receipt.match?.candidates[0].txId, 3);

    const base = `/api/customers/CUST00001/receipts/${receipt.id}`;
    const candidates = await call<{ match: { candidates: { txId: number }[] }; nearby: unknown[] }>(app, `${base}/candidates`);
    assert.equal(candidates.body.match.candidates[0].txId, 3);
    assert.equal((await call(app, `${base}/confirm`, { method: "POST", body: { txId: 1 } })).status, 400); // a housing payment, not a purchase
    const confirmed = await call<{ receipt: ReceiptView }>(app, `${base}/confirm`, { method: "POST", body: { txId: 3 } });
    assert.equal(confirmed.body.receipt.txId, 3);
    assert.equal(confirmed.body.receipt.autoMatched, false);
    assert.equal((await call<{ receipts: ReceiptView[] }>(app, "/api/customers/CUST00001/receipts")).body.receipts.length, 1);

    const unlinked = await call<{ receipt: ReceiptView }>(app, `${base}/unlink`, { method: "POST" });
    assert.equal(unlinked.body.receipt.status, "unmatched");
    assert.equal((await call(app, base, { method: "DELETE" })).status, 200);
    assert.equal((await call(app, base, { method: "DELETE" })).status, 404);
    assert.equal((await call(app, "/api/customers/CUST00001/receipts/not-a-uuid", { method: "DELETE" })).status, 400);
  });

  it("refuses a second receipt for a payment that already has one", async () => {
    const receipts = new ReceiptStore();
    const app = createApp(createFixtureDb(), { receipts });
    const a = receipts.save("CUST00001", groceryReceipt);
    const b = receipts.save("CUST00001", groceryReceipt);
    receipts.link("CUST00001", a.id, 3);
    const res = await call(app, `/api/customers/CUST00001/receipts/${b.id}/confirm`, { method: "POST", body: { txId: 3 } });
    assert.equal(res.status, 409);
  });
});
