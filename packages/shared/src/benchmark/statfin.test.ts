import { describe, expect, it } from "vitest";
import raw from "./statfin.json";
import { ageBandLabel, BENCHMARK_CATEGORY_NAMES, benchmarkAgeBand, nationalBenchmark } from "./statfin";

const figure = (b: ReturnType<typeof nationalBenchmark>, category: string) => b.figures.find((f) => f.category === category)!;

describe("Statistics Finland benchmark", () => {
  it("places every age in one of the survey's age groups", () => {
    expect([18, 24, 25, 34, 64, 65, 84, 85, 90].map(benchmarkAgeBand)).toEqual([
      "17-24", "17-24", "25-34", "25-34", "55-64", "65-74", "75-84", "85-", "85-",
    ]);
    expect(ageBandLabel("85-")).toBe("85+");
    expect(ageBandLabel("25-34")).toBe("25-34");
    for (const band of new Set(Array.from({ length: 83 }, (_, i) => benchmarkAgeBand(i + 18)))) {
      expect(raw.consumption.one_adult).toHaveProperty(band);
    }
  });

  it("gives a figure for every mapped category, in the survey year's prices and raised to the window", () => {
    const b = nationalBenchmark(30, "one_adult", "2025-09", "2026-08");
    expect(b.band).toBe("25-34");
    expect(b.priceWindow).toEqual(["2025-09", "2026-08"]);
    expect(b.figures.map((f) => f.category)).toEqual(BENCHMARK_CATEGORY_NAMES);
    // Food is a single group, so the survey amount is the published figure itself.
    expect(figure(b, "Groceries").surveyAmount).toBe(raw.consumption.one_adult["25-34"]["01"]);
    // Food prices rose clearly after 2022.
    const rise = figure(b, "Groceries").amount / figure(b, "Groceries").surveyAmount;
    expect(rise).toBeGreaterThan(1.05);
    expect(rise).toBeLessThan(1.3);
  });

  it("leaves the survey year's own prices unchanged", () => {
    const b = nationalBenchmark(30, "one_adult", "2022-01", "2022-12");
    for (const f of b.figures) expect(f.amount).toBeCloseTo(f.surveyAmount, 6);
  });

  it("a whole household spends at least as much as one adult in it", () => {
    for (const age of [20, 40, 70, 90]) {
      const one = nationalBenchmark(age, "one_adult", "2025-09", "2026-08");
      const all = nationalBenchmark(age, "household", "2025-09", "2026-08");
      for (const f of one.figures) expect(figure(all, f.category).amount).toBeGreaterThanOrEqual(f.amount);
    }
  });

  it("uses the latest prices it has when asked for months beyond the index", () => {
    const b = nationalBenchmark(30, "one_adult", "2040-01", "2040-12");
    const latest = Object.keys(raw.prices.index["01"]).sort().at(-1);
    expect(b.priceWindow[1]).toBe(latest);
    for (const f of b.figures) expect(Number.isFinite(f.amount) && f.amount > 0).toBe(true);
  });

  it("counts a figure that is not published as zero instead of failing", () => {
    // Housing loan interest is not published for the oldest group.
    const b = nationalBenchmark(90, "household", "2025-09", "2026-08");
    expect(figure(b, "Housing").amount).toBeGreaterThan(0);
  });
});
