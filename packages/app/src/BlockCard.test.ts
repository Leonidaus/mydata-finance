import { describe, expect, it } from "vitest";
import { catalog, type EngineResult } from "@mydata/shared";
import { displayTitle, presentResult } from "./BlockCard";
import { itemDrill } from "./blocks/templates";
import { translate } from "./i18n";

const fi = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate("fi", key, values);

describe("localized default-card content", () => {
  it("localizes the safe-to-spend scope, calculation and explanation", () => {
    const result: EngineResult = {
      rows: [
        { term: "", amount: 100, kind: "balance" },
        { term: "", amount: -20, kind: "reserve" },
        { term: "", amount: -10, kind: "expected" },
        { term: "", amount: -30, kind: "expected" },
        { term: "", amount: -5, kind: "expected" },
        { term: "", amount: 35, kind: "subtotal" },
        { term: "", amount: -10, kind: "precaution" },
        { term: "", amount: 25, kind: "result" },
      ],
      caption: "",
      assumptions: [""],
    };

    const shown = presentResult(catalog.safeToSpend(), result, "fi", fi);
    expect(shown.caption).toBe("Arvioitu käyttöraha tälle viikolle.");
    expect(shown.explanation).toContain("palkkapäivään asti");
    expect(shown.rows.map((row) => row.term)).toEqual([
      "Tämän päivän saldo",
      "Edelliseltä palkkakaudelta jäänyt varaus",
      "Ennen palkkapäivää erääntyvät laskut",
      "Ruoka ja muut välttämättömät menot palkkapäivään asti",
      "Suunnitellut säästöt ennen palkkapäivää",
      "Palkkakauden rahoista jäljellä odotettujen menojen jälkeen",
      "Yllättäviin menoihin varattu raha",
      "Käyttövaraa palkkapäivään asti",
    ]);
  });

  it("localizes the month card's scope, rows and assumptions", () => {
    const result: EngineResult = {
      rows: Array.from({ length: 6 }, () => ({ term: "", amount: 0 })),
      caption: "",
      assumptions: [""],
    };

    const shown = presentResult(catalog.monthSoFar(), result, "fi", fi);
    expect(shown.caption).toBe("Tämä kalenterikuukausi kuun 1. päivästä tähän päivään.");
    expect(shown.rows.map((row) => row.term)).toContain("Arjen kulutus");
    expect(shown.assumptions).toContain("Jäljellä oleva raha on tulojen, menojen ja säästösiirtojen erotus, ei tilin saldo.");
  });
});

describe("receipt cards in Finnish", () => {
  it("words the receipts, dates, shop and coverage from the engine's facts", () => {
    const result: EngineResult = {
      rows: [{ key: "kino kamppi", label: "Kino Kamppi", amount: 59.55, count: 4, trips: 2 }],
      value: 59.55,
      caption: "2 receipts from 26.1.2026 to 25.7.2026, at \"Kino Kamppi\" (3% of Entertainment spending)",
      facts: { receipts: 2, first: "2026-01-26", last: "2026-07-25", coverage: 3, categories: "Entertainment", shop: "Kino Kamppi" },
    };
    const shown = presentResult(catalog.itemBars({ shop: "Kino Kamppi" }), result, "fi", fi);
    expect(shown.caption).toBe("Kuitteja 2, 26.1.2026–25.7.2026, kauppa Kino Kamppi · 3 % kulutuksesta luokissa Viihde");
    expect(shown.assumptions).toEqual([fi("card.itemsAssumption")]);
    expect(presentResult(catalog.itemBars(), { rows: [], facts: { receipts: 0 } }, "fi", fi).caption).toBe("Ei kuitteja");
  });

  it("says in Finnish that an empty month means nothing was photographed", () => {
    const result: EngineResult = { rows: [], caption: "", facts: { receipts: 3, months: 12, coverage: 10, categories: "Groceries", subcategory: "snacks_sweets" } };
    const shown = presentResult(catalog.itemTrend({ subcategory: "snacks_sweets" }), result, "fi", fi);
    expect(shown.caption).toBe("Kuukausittain, viimeiset 12 kk, Herkut ja naposteltavat: kuitteja 3");
    expect(shown.assumptions?.[0]).toContain("mitään ei kuvattu");
  });
});

describe("receipt cards: titles, matches and drill-down", () => {
  it("names the card by what it shows, in the user's language", () => {
    expect(displayTitle(catalog.itemBars({ subcategory: "snacks_sweets" }), fi, "fi")).toBe("Herkut ja naposteltavat kuiteissasi");
    expect(displayTitle(catalog.itemBars({ per: "shop" }), fi, "fi")).toBe("Kaupat kuiteissasi");
    expect(displayTitle(catalog.itemTrend({ shop: "Alko" }), fi, "fi")).toBe("Alko kuukausittain");
    expect(displayTitle(catalog.itemBars({ search: "cola" }), (k, v) => translate("en", k, v), "en")).toBe('"cola" on your receipts');
  });

  it("says how many of the receipts checked had what was asked", () => {
    const result: EngineResult = { rows: [], facts: { receipts: 10, matching: 2, first: "2026-08-01", last: "2026-09-14", coverage: 20, categories: "Groceries", subcategory: "snacks_sweets" } };
    expect(presentResult(catalog.itemBars({ subcategory: "snacks_sweets" }), result, "fi", fi).caption).toBe(
      "Kuitteja 10, 1.8.2026–14.9.2026, joista 2: Herkut ja naposteltavat · 20 % kulutuksesta luokissa Ruokaostokset",
    );
  });

  it("opens exactly the tapped shop, or the tapped kind of item", () => {
    expect(itemDrill({ key: "prisma", label: "Prisma" }, catalog.itemBars({ per: "shop" }))).toEqual({ receiptShop: "prisma" });
    expect(itemDrill({ key: "alcohol" }, catalog.itemBars())).toEqual({ subcategory: "alcohol" });
    expect(itemDrill({ key: "Groceries" }, catalog.categoryBars())).toBeNull();
  });
});
