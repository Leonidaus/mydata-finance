import { describe, expect, it } from "vitest";
import { catalog, type EngineResult } from "@mydata/shared";
import { presentResult } from "./BlockCard";
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
