import { TRANSACTION_CATEGORIES, type TransactionCategory } from "@mydata/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { FinanceDb } from "./db";
import { getCustomer, listCustomers, monthlySummary } from "./finance/customers";
import { isIsoDate, PERIOD_NAMES, resolvePeriod, type Period, type PeriodName } from "./finance/period";
import { BASKETS, GROUP_BY, spending, type Basket, type GroupBy } from "./finance/spending";

const CUSTOMER_ID = /^CUST\d{5}$/;
const MCC = /^\d{4}$/;

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]) {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    badRequest(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function integer(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{1,4}$/.test(value)) badRequest(`${name} must be a whole number`);
  return Number(value);
}

/** Either `period=<name>` or both `from` and `to`. Defaults to this month. */
function parsePeriod(query: Record<string, string>, today: string): Period {
  const { period, from, to } = query;
  if (period !== undefined) {
    if (from !== undefined || to !== undefined) badRequest("Give either period or from and to");
    return resolvePeriod(oneOf("period", period, PERIOD_NAMES) as PeriodName, today);
  }
  if (from === undefined && to === undefined) return resolvePeriod("this_month", today);
  if (from === undefined || to === undefined) badRequest("from and to must be given together");
  if (!isIsoDate(from) || !isIsoDate(to)) badRequest("from and to must be dates as YYYY-MM-DD");
  if (from > to) badRequest("from must not be after to");
  return { from, to };
}

export function createApp(db: FinanceDb): Hono {
  const app = new Hono();

  // The data is synthetic and the API read-only, so any origin may call it during the demo.
  app.use("/api/*", cors());

  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: "Internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      today: db.today,
      customers: Number(db.meta.rows_customers),
      transactions: Number(db.meta.rows_transactions),
      builtAt: db.meta.built_at,
    }),
  );

  app.get("/api/customers", (c) => {
    const mortgage = oneOf("mortgage", c.req.query("mortgage"), ["true", "false"] as const);
    return c.json({
      customers: listCustomers(db, {
        limit: integer("limit", c.req.query("limit")),
        hasMortgageApplication: mortgage === undefined ? undefined : mortgage === "true",
      }),
    });
  });

  /** Routes below need an existing customer; this resolves the id or answers 400/404. */
  function customerId(raw: string): string {
    if (!CUSTOMER_ID.test(raw)) badRequest("Customer id must look like CUST00001");
    return raw;
  }

  app.get("/api/customers/:id", (c) => {
    const customer = getCustomer(db, customerId(c.req.param("id")));
    if (!customer) throw new HTTPException(404, { message: "Customer not found" });
    return c.json(customer);
  });

  app.get("/api/customers/:id/summary", (c) => {
    const id = customerId(c.req.param("id"));
    const customer = getCustomer(db, id);
    if (!customer) throw new HTTPException(404, { message: "Customer not found" });
    return c.json({
      customer,
      today: db.today,
      months: monthlySummary(db, id, integer("months", c.req.query("months"))),
    });
  });

  app.get("/api/customers/:id/spending", (c) => {
    const id = customerId(c.req.param("id"));
    if (!getCustomer(db, id)) throw new HTTPException(404, { message: "Customer not found" });

    const query = c.req.query();
    const mcc = query.mcc;
    if (mcc !== undefined && !MCC.test(mcc)) badRequest("mcc must be four digits");

    return c.json(
      spending(db, {
        customerId: id,
        period: parsePeriod(query, db.today),
        category: oneOf("category", query.category, TRANSACTION_CATEGORIES) as
          | TransactionCategory
          | undefined,
        mcc,
        basket: oneOf("basket", query.basket, BASKETS) as Basket | undefined,
        groupBy: oneOf("groupBy", query.groupBy, GROUP_BY) as GroupBy | undefined,
        limit: integer("limit", query.limit),
      }),
    );
  });

  return app;
}
