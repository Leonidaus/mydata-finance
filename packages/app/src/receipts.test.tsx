import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MatchCandidate, ReceiptView } from "@mydata/shared";
import { LocaleProvider, translate } from "./i18n";
import ReceiptCard, { receiptModelText, receiptReply, ReceiptsContext } from "./receipts";
import type { ReceiptClient } from "./sources/receipts";

const payment: MatchCandidate = { txId: 3, date: "2026-08-05", timestamp: "2026-08-05T17:00:00", amount: 80, category: "Groceries", mcc: "5411", score: 95 };
const receipt: ReceiptView = {
  id: "r1",
  createdAt: "2026-09-10T10:00:00Z",
  merchant: "Prisma Kamppi",
  mcc: "5411",
  date: "2026-08-05",
  time: "16:58",
  total: 80,
  paidBy: "card",
  lines: [
    { name: "Fazer Sininen", subcategory: "snacks_sweets", amount: 12.5, kind: "item" },
    { name: "Bananas", subcategory: "produce", amount: 67.9, kind: "item" },
    { name: "PULLOPALAUTUS", subcategory: "other", amount: -0.4, kind: "deposit_return" },
  ],
  linesMismatch: false,
  status: "confirmed",
  txId: 3,
  autoMatched: true,
  payment,
};
const client = {} as ReceiptClient;
const render = (r: ReceiptView) =>
  renderToStaticMarkup(
    <LocaleProvider>
      <ReceiptsContext.Provider value={{ client, version: 0, changed: () => {} }}>
        <ReceiptCard receipt={r} customerId="CUST00001" today="2026-09-15" onChange={() => {}} />
      </ReceiptsContext.Provider>
    </LocaleProvider>,
  );

describe("ReceiptCard", () => {
  it("shows a strong match as linked, with a way to undo it", () => {
    const html = render(receipt);
    expect(html).toContain("Prisma Kamppi");
    expect(html).toContain("Linked automatically to your card payment");
    expect(html).toContain("Not this payment");
    expect(html).toContain("2 items"); // the bottle return is not an item
    expect(html).toContain("Fruit and vegetables");
  });

  it("asks about a possible match", () => {
    const html = render({ ...receipt, status: "unmatched", txId: null, autoMatched: false, payment: undefined, match: { confidence: "possible", candidates: [payment] } });
    expect(html).toContain("Is this the card payment?");
    expect(html).toContain("Yes, that&#x27;s it");
    expect(html).toContain("Choose another");
  });

  it("says why nothing matched, and offers no choice when there is nothing to choose", () => {
    const html = render({ ...receipt, status: "unmatched", txId: null, autoMatched: false, payment: undefined, date: "2026-11-02", match: { confidence: "none", candidates: [], reason: "after_data_end" } });
    expect(html).toContain("the last day of bank data in this demo");
    expect(html).not.toContain("Choose payment");
  });

  it("flags lines that do not add up", () => {
    expect(render({ ...receipt, linesMismatch: true })).toContain("some may be misread");
  });
});

describe("the reply to a receipt sent without words", () => {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate("fi", key, values);

  it("is written in the user's language from what was saved", () => {
    expect(receiptReply(receipt, "fi", t)).toBe(`Tallensin kuitin (Prisma Kamppi, ${formatted(80)}, 2 tuotetta) ja yhdistin sen korttimaksuusi 5.8.2026. Voit nyt kysyä, mitä ostoksissasi on.`);
    expect(receiptReply({ ...receipt, status: "unmatched", match: { confidence: "possible", candidates: [payment] } }, "fi", t)).toContain("Kuuluuko se tähän korttimaksuun?");
    expect(receiptReply({ ...receipt, total: null, lines: [] }, "fi", t)).toContain("En saanut kuittia luettua");
  });

  it("tells the coach later what was sent, without item names", () => {
    const said = receiptModelText(receipt);
    expect(said).toContain("Prisma Kamppi");
    expect(said).not.toContain("Fazer");
  });
});

const formatted = (n: number) => new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);
