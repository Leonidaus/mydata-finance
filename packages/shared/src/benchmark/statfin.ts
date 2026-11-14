/**
 * What people in Finland spend per month, from Statistics Finland's open data, for comparing
 * with one customer's own spending.
 *
 * Two tables are behind it (both in statfin.json, fetched by data/prep/fetch_statfin.py):
 * - Households' consumption 2022, by age of the household's reference person (table 14q4).
 * - The consumer price index per commodity group (table 15b5), which raises each 2022 figure
 *   to the price level of the months the customer's own average covers.
 *
 * The match with the bank's categories is approximate, and every result says so: see `note`
 * on each category and the assumptions in the engine's nationalCompare.
 */
import type { TransactionCategory } from "../schema";
import raw from "./statfin.json";

export const BENCHMARK_BASES = ["one_adult", "household"] as const;
/**
 * one_adult: per consumption unit, which is what one adult living alone would spend for the
 * same standard of living. household: the whole household, whatever its size.
 */
export type BenchmarkBasis = (typeof BENCHMARK_BASES)[number];

interface Part {
  /** Expenditure group (COICOP code) in the consumption table. */
  consumption: string;
  /** Group in the price index that follows the same prices. */
  prices: string;
}

interface CategoryMapping {
  /** What the national figure covers, in Statistics Finland's terms. */
  covers: string;
  parts: Part[];
  /** Where the bank category and the national figure differ. */
  note: string;
}

/** The bank categories that have a reasonable counterpart in the consumption survey. */
export const BENCHMARK_CATEGORIES: Partial<Record<TransactionCategory, CategoryMapping>> = {
  Housing: {
    covers: "rents, upkeep of the home and housing loan interest",
    parts: [
      { consumption: "041", prices: "041" },
      // No price index for imputed rents; they are estimated from actual rents, so those prices are used.
      { consumption: "042", prices: "041" },
      { consumption: "043", prices: "043" },
      { consumption: "046", prices: "046" },
    ],
    note: "Housing: for people who own their home the national figure counts an estimated rent, not their loan payments.",
  },
  Utilities: {
    covers: "electricity, heating, water and waste collection",
    parts: [
      { consumption: "044", prices: "044" },
      { consumption: "045", prices: "045" },
    ],
    note: "Utilities: the national figure has no phone or internet bills.",
  },
  Groceries: {
    covers: "food and non-alcoholic drinks",
    parts: [{ consumption: "01", prices: "01" }],
    note: "Groceries: the bank sees everything bought in a grocery store; the national figure is food and non-alcoholic drinks only.",
  },
  Restaurants: {
    covers: "restaurants, cafés and takeaway",
    parts: [{ consumption: "111", prices: "111" }],
    note: "",
  },
  Transportation: {
    covers: "fuel, upkeep of a car and tickets",
    parts: [
      { consumption: "072", prices: "072" },
      { consumption: "073", prices: "073" },
    ],
    note: "Transportation: buying a car is left out of the national figure; flights are in it.",
  },
};

export const BENCHMARK_CATEGORY_NAMES = Object.keys(BENCHMARK_CATEGORIES) as TransactionCategory[];

type Amounts = Record<string, Record<string, number | null>>;
const consumption = raw.consumption as unknown as { year: number; table: string; updated: string } & Record<BenchmarkBasis, Amounts>;
const prices = raw.prices as { table: string; updated: string; index: Record<string, Record<string, number>> };

export const STATFIN = {
  source: raw.source,
  licence: raw.licence,
  fetched: raw.fetched,
  surveyYear: consumption.year,
  consumptionTable: consumption.table,
  priceTable: prices.table,
};

/** The survey's age groups, by the age of the household member with the highest income. */
const AGE_BANDS: [number, string][] = [
  [24, "17-24"],
  [34, "25-34"],
  [44, "35-44"],
  [54, "45-54"],
  [64, "55-64"],
  [74, "65-74"],
  [84, "75-84"],
];

export function benchmarkAgeBand(age: number): string {
  return AGE_BANDS.find(([upTo]) => age <= upTo)?.[1] ?? "85-";
}

/** "85-" → "85+"; the others read as they are. */
export const ageBandLabel = (band: string) => (band.endsWith("-") ? `${band.slice(0, -1)}+` : band);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let [year, month] = first.split("-").map(Number);
  while (months.length < 240) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    months.push(key);
    if (++month > 12) (month = 1), year++;
  }
  return months;
}

/**
 * The months whose prices the figures are raised to: the months asked for that the index
 * has, or its latest ones when it does not reach that far.
 */
function priceMonths(series: Record<string, number>, first: string, last: string): string[] {
  const wanted = monthsBetween(first, last);
  const available = wanted.filter((m) => m in series);
  if (available.length) return available;
  return Object.keys(series).sort().slice(-Math.max(1, wanted.length));
}

export interface NationalFigure {
  category: TransactionCategory;
  covers: string;
  note: string;
  /** €/month in the survey year's prices. */
  surveyAmount: number;
  /** €/month raised to the price level of `priceWindow`. */
  amount: number;
}

export interface NationalBenchmark {
  band: string;
  basis: BenchmarkBasis;
  figures: NationalFigure[];
  /** First and last month ("YYYY-MM") of the prices the figures are in. */
  priceWindow: [string, string];
}

/**
 * National monthly spending per mapped category for a person of `age`, in the prices of the
 * months `firstMonth`..`lastMonth` ("YYYY-MM").
 */
export function nationalBenchmark(age: number, basis: BenchmarkBasis, firstMonth: string, lastMonth: string): NationalBenchmark {
  const band = benchmarkAgeBand(age);
  const amounts = consumption[basis][band];
  const surveyMonths = monthsBetween(`${consumption.year}-01`, `${consumption.year}-12`);
  let window: [string, string] = [firstMonth, lastMonth];
  const figures = BENCHMARK_CATEGORY_NAMES.map((category) => {
    const mapping = BENCHMARK_CATEGORIES[category] as CategoryMapping;
    let surveyAmount = 0;
    let amount = 0;
    for (const part of mapping.parts) {
      const series = prices.index[part.prices];
      const months = priceMonths(series, firstMonth, lastMonth);
      window = [months[0], months[months.length - 1]];
      const factor = mean(months.map((m) => series[m])) / mean(surveyMonths.map((m) => series[m]));
      // Not published for a very small group: counts as zero.
      const value = amounts[part.consumption] ?? 0;
      surveyAmount += value;
      amount += value * factor;
    }
    return { category, covers: mapping.covers, note: mapping.note, surveyAmount, amount };
  });
  return { band, basis, figures, priceWindow: window };
}
