/**
 * Argument checking for engine functions.
 *
 * Callers include a language model and JSON over HTTP, so a wrong argument must be an
 * explicit error. Silently falling back to a default would produce a confident answer
 * to a different question.
 */
import { MCC_CODES } from "../mcc";
import type { EngineFn } from "./types";
import { PERIODS, SPENDING_CATEGORIES } from "./util";

/** Thrown for unknown, mistyped or out-of-range arguments. Safe to show to the caller. */
export class EngineArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineArgumentError";
  }
}

type ArgSpec =
  | { type: "enum"; values: readonly string[] }
  | { type: "category" }
  /** A merchant category code that occurs in the data, e.g. "4121" for taxis. */
  | { type: "mcc" }
  | { type: "number"; min: number; max: number; integer?: boolean; exclusiveMin?: boolean }
  | { type: "text"; maxLength: number };

const period: ArgSpec = { type: "enum", values: Object.keys(PERIODS) };
const category: ArgSpec = { type: "category" };
const mcc: ArgSpec = { type: "mcc" };

export const TREND_METRICS = ["spending", "income", "net", "saving"] as const;

export const ENGINE_ARG_SPECS: Record<EngineFn, Record<string, ArgSpec>> = {
  spendBy: { period, by: { type: "enum", values: ["category", "merchant_type"] }, category, mcc },
  monthlyTrend: {
    months: { type: "number", min: 2, max: 24, integer: true },
    metric: { type: "enum", values: TREND_METRICS },
    category,
    mcc,
  },
  baskets: { period },
  dailySpend: { period },
  safeToSpend: { horizon: { type: "enum", values: ["week", "until_payday"] } },
  safeToSave: {},
  balanceForecast: {},
  whatIf: { category, mcc, cutPct: { type: "number", min: 0, max: 100 } },
  peerCompare: { category },
  recurring: {},
  goalProgress: {
    target: { type: "number", min: 0, max: 100_000_000, exclusiveMin: true },
    label: { type: "text", maxLength: 80 },
  },
};

/**
 * Checks `args` for `fn` and returns them without empty values (undefined, null and ""
 * all mean "not given", which is how the app's controls express "all categories").
 */
export function validateEngineArgs(fn: EngineFn, args: Record<string, unknown>): Record<string, unknown> {
  const specs = ENGINE_ARG_SPECS[fn];
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") continue;
    const spec = specs[key];
    if (!spec) {
      const allowed = Object.keys(specs);
      throw new EngineArgumentError(
        `${fn} does not take "${key}". ${allowed.length ? `Allowed: ${allowed.join(", ")}.` : "It takes no arguments."}`,
      );
    }
    switch (spec.type) {
      case "enum":
        if (typeof value !== "string" || !spec.values.includes(value)) {
          throw new EngineArgumentError(`${key} must be one of: ${spec.values.join(", ")}.`);
        }
        break;
      case "category":
        if (typeof value !== "string" || !(SPENDING_CATEGORIES as readonly string[]).includes(value)) {
          throw new EngineArgumentError(`${key} must be one of: ${SPENDING_CATEGORIES.join(", ")}.`);
        }
        break;
      case "mcc":
        if (typeof value !== "string" || !Object.hasOwn(MCC_CODES, value)) {
          throw new EngineArgumentError(`${key} must be a merchant type code from the list, e.g. "4121" for taxis.`);
        }
        break;
      case "number": {
        const tooLow = spec.exclusiveMin ? (value as number) <= spec.min : (value as number) < spec.min;
        if (typeof value !== "number" || !Number.isFinite(value) || tooLow || value > spec.max) {
          throw new EngineArgumentError(
            `${key} must be a number ${spec.exclusiveMin ? "above" : "from"} ${spec.min} ${spec.exclusiveMin ? "and at most" : "to"} ${spec.max}.`,
          );
        }
        if (spec.integer && !Number.isInteger(value)) {
          throw new EngineArgumentError(`${key} must be a whole number.`);
        }
        break;
      }
      case "text":
        if (typeof value !== "string" || value.length > spec.maxLength) {
          throw new EngineArgumentError(`${key} must be text of at most ${spec.maxLength} characters.`);
        }
        break;
    }
    clean[key] = value;
  }
  // A merchant type belongs to one category; asking for it within another would always be empty.
  if (typeof clean.mcc === "string" && typeof clean.category === "string" && MCC_CODES[clean.mcc].category !== clean.category) {
    throw new EngineArgumentError(
      `mcc ${clean.mcc} (${MCC_CODES[clean.mcc].label}) belongs to ${MCC_CODES[clean.mcc].category}, not ${clean.category}. Leave category out.`,
    );
  }
  return clean;
}
