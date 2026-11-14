import {
  ENGINE_FNS,
  EngineArgumentError,
  TRANSACTION_CATEGORIES,
  type TransactionCategory,
  type TxFilter,
} from "@mydata/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { handleStt, handleTts } from "@mydata/voice";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { FinanceDb } from "./db";
import { getCustomer, listCustomers, monthlySummary } from "./finance/customers";
import { isEngineFn, runEngineFor, transactionsFor } from "./finance/engine";
import { isIsoDate, PERIOD_NAMES, resolvePeriod, type Period, type PeriodName } from "./finance/period";
import { BASKETS, GROUP_BY, spending, type Basket, type GroupBy } from "./finance/spending";
import { requestBudget, type RequestBudget } from "./rateLimit";

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

const TX_FILTER_KEYS = ["from", "to", "kind", "category", "mcc", "basket", "month", "date"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps the known string fields of a transaction filter and drops everything else. */
function parseTxFilter(value: unknown): TxFilter {
  if (value === undefined) return {};
  if (!isRecord(value)) badRequest("filter must be an object");
  const filter: Record<string, string> = {};
  for (const key of TX_FILTER_KEYS) {
    const field = value[key];
    if (field === undefined || field === null) continue;
    if (typeof field !== "string") badRequest(`filter.${key} must be a string`);
    filter[key] = field;
  }
  return filter as TxFilter;
}

/** Query-string values for an engine call: whole or decimal numbers become numbers. */
function engineArgsFromQuery(query: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value,
    ]),
  );
}

export interface AppOptions {
  /**
   * Directory of the built web app (packages/app/dist). When given, the server also serves
   * the app, so one process and one origin cover both the interface and the API.
   */
  staticDir?: string;
  /** How often the speech routes may be called. They spend ElevenLabs credits. */
  voiceBudget?: RequestBudget;
  /** The language model behind the chat. Without an apiKey the route answers 503. */
  gemini?: {
    apiKey?: string;
    budget?: RequestBudget;
    /** Replaceable in tests. */
    fetch?: typeof fetch;
  };
}

const DEFAULT_GEMINI_BUDGET: RequestBudget = { perMinute: 30, perHour: 600 };
/** Only this call is forwarded: generateContent on a Gemini model. */
const GEMINI_PATH = /^\/gemini\/v1beta\/models\/(gemini-[a-z0-9.-]+):generateContent$/;
/** The chat prompt, history and tool definitions fit well within this. */
const MAX_GEMINI_BODY_CHARS = 300_000;
const GEMINI_TIMEOUT_MS = 60_000;

/** Errors in the shape Google's API uses, which the app's Gemini client reads. */
const geminiError = (message: string) => ({ error: { message } });

const DEFAULT_VOICE_BUDGET: RequestBudget = { perMinute: 30, perHour: 400 };
/** Same limit as the voice package applies after reading the upload; checked here before reading it. */
const MAX_STT_BYTES = 25 * 1024 * 1024;

export function createApp(db: FinanceDb, options: AppOptions = {}): Hono {
  const app = new Hono();

  // The data is synthetic and the API read-only, so any origin may call it during the demo.
  app.use("/api/*", cors());

  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    if (error instanceof EngineArgumentError) return c.json({ error: error.message }, 400);
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
      // Which optional services have a key on this server, so the app can offer them.
      services: { chat: Boolean(options.gemini?.apiKey), voice: Boolean(process.env.ELEVENLABS_API_KEY) },
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

  // ---- finance engine (safe to spend, what-if, baskets, forecast, ...) ----

  function requireEngineFn(name: unknown) {
    if (typeof name !== "string" || !isEngineFn(name)) {
      badRequest(`fn must be one of: ${ENGINE_FNS.join(", ")}`);
    }
    return name;
  }

  async function jsonBody(request: Request): Promise<Record<string, unknown>> {
    const body: unknown = await request.json().catch(() => badRequest("Body must be JSON"));
    if (!isRecord(body)) badRequest("Body must be a JSON object");
    return body;
  }

  /** Convenience form for trying things out: /api/customers/CUST00001/engine/whatIf?cutPct=20 */
  app.get("/api/customers/:id/engine/:fn", (c) => {
    const id = customerId(c.req.param("id"));
    const fn = requireEngineFn(c.req.param("fn"));
    const result = runEngineFor(db, id, fn, engineArgsFromQuery(c.req.query()));
    if (!result) throw new HTTPException(404, { message: "Customer not found" });
    return c.json(result);
  });

  /** Runs a dashboard block's DataRequest, as defined in @mydata/shared. */
  app.post("/api/data", async (c) => {
    const body = await jsonBody(c.req.raw);
    if (typeof body.customerId !== "string") badRequest("customerId is required");
    const id = customerId(body.customerId);
    const data = body.data;
    if (!isRecord(data)) badRequest("data is required");
    if (data.kind === "sql") {
      throw new HTTPException(501, { message: "SQL data requests are not supported yet" });
    }
    if (data.kind !== "engine") badRequest('data.kind must be "engine" or "sql"');
    const fn = requireEngineFn(data.fn);
    if (data.args !== undefined && !isRecord(data.args)) badRequest("data.args must be an object");
    const result = runEngineFor(db, id, fn, (data.args as Record<string, unknown>) ?? {});
    if (!result) throw new HTTPException(404, { message: "Customer not found" });
    return c.json(result);
  });

  /** The transactions behind a result: pass the result's `filter` back, newest first. */
  app.post("/api/transactions", async (c) => {
    const body = await jsonBody(c.req.raw);
    if (typeof body.customerId !== "string") badRequest("customerId is required");
    const id = customerId(body.customerId);
    const limit = body.limit;
    if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0)) {
      badRequest("limit must be a whole number");
    }
    const result = transactionsFor(db, id, parseTxFilter(body.filter), limit as number | undefined);
    if (!result) throw new HTTPException(404, { message: "Customer not found" });
    return c.json(result);
  });

  // ---- voice: text to speech and speech to text (packages/voice, ElevenLabs) ----
  // Without ELEVENLABS_API_KEY the handlers answer 503, and the rest of the API is unaffected.

  app.use("/api/tts", requestBudget("voice", options.voiceBudget ?? DEFAULT_VOICE_BUDGET));
  app.use("/api/stt", requestBudget("voice", options.voiceBudget ?? DEFAULT_VOICE_BUDGET));
  app.post("/api/tts", (c) => handleTts(c.req.raw));
  app.post("/api/stt", (c) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_STT_BYTES) {
      return c.json({ error: "Audio exceeds the 25 MB limit" }, 413);
    }
    return handleStt(c.req.raw);
  });

  // ---- chat model: Gemini, with the key kept on the server ----
  // The app's chat agent (packages/shared/src/agent) calls /gemini/v1beta/models/<model>:generateContent.
  // In development the Vite server forwards that to Google; here the backend does, so the built
  // app works the same way. Only that one call is forwarded, with a size limit and a request budget.

  app.use("/gemini/*", requestBudget("chat", options.gemini?.budget ?? DEFAULT_GEMINI_BUDGET));
  app.post("/gemini/*", async (c) => {
    const match = GEMINI_PATH.exec(c.req.path);
    if (!match) return c.json(geminiError("Only generateContent on a Gemini model is forwarded."), 404);
    const apiKey = options.gemini?.apiKey;
    if (!apiKey) return c.json(geminiError("GEMINI_API_KEY is not set on the server."), 503);

    const body = await c.req.text();
    if (body.length > MAX_GEMINI_BODY_CHARS) return c.json(geminiError("The request is too large."), 413);
    try {
      JSON.parse(body);
    } catch {
      return c.json(geminiError("The request body must be JSON."), 400);
    }

    let upstream: Response;
    try {
      upstream = await (options.gemini?.fetch ?? fetch)(
        `https://generativelanguage.googleapis.com/v1beta/models/${match[1]}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      );
    } catch (cause) {
      console.error("Gemini request failed:", cause);
      return c.json(geminiError("Could not reach the language model."), 502);
    }
    // Pass Google's answer through as it is, errors included; the app reads both.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  });

  if (options.staticDir) {
    // Everything that is not an API route is the web app; unknown paths fall back to its
    // index page so client-side navigation works after a reload.
    const isService = (path: string) => path.startsWith("/api/") || path.startsWith("/gemini/");
    app.use("*", async (c, next) => (isService(c.req.path) ? next() : serveStatic({ root: options.staticDir })(c, next)));
    app.get("*", async (c, next) =>
      isService(c.req.path) ? next() : serveStatic({ root: options.staticDir, path: "index.html" })(c, next),
    );
  }

  return app;
}
