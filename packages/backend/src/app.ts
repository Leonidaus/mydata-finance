import {
  type ChatModel,
  type ChatModels,
  ENGINE_FNS,
  EngineArgumentError,
  DEFAULT_PROFILE,
  parseProfileUpdate,
  type ProfileUpdate,
  ProfileError,
  TRANSACTION_CATEGORIES,
  type TransactionCategory,
  type TxFilter,
  type ReceiptView,
  nearbyPayments,
  matchReceipt,
  isChatImage,
  readReceipt,
  isEmptyReceipt,
  type ReceiptRead,
  IMAGE_MIME_TYPES,
} from "@mydata/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { handleStt, handleTts } from "@mydata/voice";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { answerChat, CHAT_TIMEOUT_MS, type ChatRequest, ChatRequestError, parseChatRequest } from "./chat";
import type { FinanceDb } from "./db";
import { getCustomer, listCustomers, monthlySummary } from "./finance/customers";
import { isEngineFn, loadEngineContext, transactionsFor } from "./finance/engine";
import { ProtectedEngine } from "./finance/protected";
import { isIsoDate, PERIOD_NAMES, resolvePeriod, type Period, type PeriodName } from "./finance/period";
import { BASKETS, GROUP_BY, spending, type Basket, type GroupBy } from "./finance/spending";
import { requestBudget, type RequestBudget } from "./rateLimit";
import { MemoryProfileStore, type ProfileStore } from "./profiles";
import { ReceiptConflictError, ReceiptStore, saveAndMatch } from "./receipts";

const CUSTOMER_ID = /^CUST\d{5}$/;
const RECEIPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

const TX_FILTER_KEYS = ["from", "to", "kind", "category", "mcc", "basket", "month", "date", "subcategory", "shop", "item", "receiptShop"] as const;

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
  if (value.withReceipt !== undefined && typeof value.withReceipt !== "boolean") badRequest("filter.withReceipt must be true or false");
  return { ...(filter as TxFilter), ...(value.withReceipt === true && { withReceipt: true }) };
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
  /**
   * The language model behind the chat: one model, or a fast one with a stronger one for the
   * turns it hands over. Without one, POST /api/chat answers 503.
   */
  chatModel?: ChatModel | ChatModels;
  /** How often the chat may be called. Each answer costs one or two model calls. */
  chatBudget?: RequestBudget;
  /** Customer coaching preferences; memory is the test and embedded-server default. */
  profiles?: ProfileStore;
  /** Receipts customers have sent; in memory unless given. */
  receipts?: ReceiptStore;
}

const DEFAULT_CHAT_BUDGET: RequestBudget = { perMinute: 20, perHour: 400 };
const DEFAULT_VOICE_BUDGET: RequestBudget = { perMinute: 30, perHour: 400 };
/** Same limit as the voice package applies after reading the upload; checked here before reading it. */
const MAX_STT_BYTES = 25 * 1024 * 1024;

export function createApp(db: FinanceDb, options: AppOptions = {}): Hono {
  const app = new Hono();
  const profiles = options.profiles ?? new MemoryProfileStore();
  const receipts = options.receipts ?? new ReceiptStore();
  const linkedReceipts = (id: string) => receipts.linked(id);
  /** Saves a receipt read for a customer and matches it to their payments: the chat and the receipts route alike. */
  const saveReceiptFor = (id: string) => (read: ReceiptRead) => saveAndMatch(receipts, id, read, loadEngineContext(db, id)?.tx ?? [], db.today);
  // Chat answers and receipt photos share one budget: each costs model calls.
  const chatLimit = requestBudget("chat", options.chatBudget ?? DEFAULT_CHAT_BUDGET);
  const protectedEngine = new ProtectedEngine(db, profiles, linkedReceipts);

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
      services: { chat: Boolean(options.chatModel), voice: Boolean(process.env.ELEVENLABS_API_KEY) },
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

  app.get("/api/customers/:id/profile", (c) => {
    const id = customerId(c.req.param("id"));
    if (!getCustomer(db, id)) throw new HTTPException(404, { message: "Customer not found" });
    const profile = profiles.get(id);
    return c.json({ profile: profile ?? DEFAULT_PROFILE, isDefault: profile === null });
  });

  app.patch("/api/customers/:id/profile", async (c) => {
    const id = customerId(c.req.param("id"));
    if (!getCustomer(db, id)) throw new HTTPException(404, { message: "Customer not found" });
    let update: ProfileUpdate;
    try {
      update = parseProfileUpdate(await jsonBody(c.req.raw));
    } catch (error) {
      if (error instanceof ProfileError) badRequest(error.message);
      throw error;
    }
    return c.json({ profile: profiles.update(id, update), isDefault: false });
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
    const result = protectedEngine.run(id, fn, engineArgsFromQuery(c.req.query()));
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
    const result = protectedEngine.run(id, fn, (data.args as Record<string, unknown>) ?? {});
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
    const result = transactionsFor(db, id, parseTxFilter(body.filter), limit as number | undefined, linkedReceipts);
    if (!result) throw new HTTPException(404, { message: "Customer not found" });
    return c.json(result);
  });

  // ---- receipts: read in the chat, listed, linked to a payment, unlinked, deleted ----

  function receiptRoute(c: { req: { param(name: string): string } }) {
    const id = customerId(c.req.param("id"));
    if (!getCustomer(db, id)) throw new HTTPException(404, { message: "Customer not found" });
    const rid = c.req.param("rid");
    if (!RECEIPT_ID.test(rid)) badRequest("Receipt id must be a UUID");
    const receipt = receipts.get(id, rid);
    if (!receipt) throw new HTTPException(404, { message: "Receipt not found" });
    return { id, rid, receipt };
  }

  /** A receipt with the payment it is linked to, for the app to show. */
  function withPayment(id: string, receipt: ReceiptView | null): ReceiptView | null {
    const t = receipt?.txId == null ? undefined : loadEngineContext(db, id)?.tx.find((x) => x.tx_id === receipt.txId);
    if (!receipt || !t) return receipt;
    return { ...receipt, payment: { txId: receipt.txId as number, date: t.tx_date, timestamp: t.tx_timestamp, amount: Math.round(-t.tx_amount_eur * 100) / 100, category: t.category, mcc: t.mcc_code, score: 0 } };
  }

  /**
   * One receipt photo, read, saved and matched to a payment, without a chat answer: for sending
   * several receipts at once. A photo with nothing readable on it is not saved.
   */
  app.post("/api/customers/:id/receipts", chatLimit, async (c) => {
    const id = customerId(c.req.param("id"));
    if (!getCustomer(db, id)) throw new HTTPException(404, { message: "Customer not found" });
    if (!options.chatModel) throw new HTTPException(503, { message: "Reading receipts needs the language model (GEMINI_API_KEY)." });
    const body = await jsonBody(c.req.raw);
    if (!isChatImage(body.image)) badRequest(`image must be { mimeType, data }: a ${IMAGE_MIME_TYPES.join(", ")} picture as base64`);
    const model = "generate" in options.chatModel ? options.chatModel : options.chatModel.fast;
    let read: Awaited<ReturnType<typeof readReceipt>>;
    try {
      // Strict: a model that fails is an error to report, not a photo that could not be read.
      read = await readReceipt(model, { mimeType: body.image.mimeType, data: body.image.data }, AbortSignal.timeout(CHAT_TIMEOUT_MS), { strict: true });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new HTTPException(504, { message: "Reading the receipt took too long. Try again in a moment." });
      console.error("Receipt reading failed:", error);
      throw new HTTPException(502, { message: "The model could not read the receipt just now. Try again in a moment." });
    }
    if (isEmptyReceipt(read)) return c.json({ receipt: null, unreadable: true });
    return c.json({ receipt: saveReceiptFor(id)(read), unreadable: false });
  });

  app.get("/api/customers/:id/receipts", (c) => {
    const id = customerId(c.req.param("id"));
    if (!getCustomer(db, id)) throw new HTTPException(404, { message: "Customer not found" });
    return c.json({ receipts: receipts.list(id).map((r) => withPayment(id, r)) });
  });

  /** The payments a receipt may belong to: the matcher's candidates, and the others nearby to choose from. */
  app.get("/api/customers/:id/receipts/:rid/candidates", (c) => {
    const { id, receipt } = receiptRoute(c);
    const tx = loadEngineContext(db, id)?.tx ?? [];
    const linked = receipts.linkedTxIds(id);
    if (receipt.txId !== null) linked.delete(receipt.txId);
    return c.json({ match: matchReceipt(receipt, tx, db.today, linked), nearby: nearbyPayments(receipt, tx, linked) });
  });

  app.post("/api/customers/:id/receipts/:rid/confirm", async (c) => {
    const { id, rid } = receiptRoute(c);
    const body = await jsonBody(c.req.raw);
    const txId = body.txId;
    if (typeof txId !== "number" || !Number.isInteger(txId)) badRequest("txId must be a whole number");
    const payment = loadEngineContext(db, id)?.tx.find((t) => t.tx_id === txId);
    if (!payment || payment.transaction_type !== "purchase" || payment.tx_amount_eur >= 0) badRequest("txId must be one of this customer's card purchases");
    try {
      return c.json({ receipt: withPayment(id, receipts.link(id, rid, txId)) });
    } catch (error) {
      if (error instanceof ReceiptConflictError) throw new HTTPException(409, { message: error.message });
      throw error;
    }
  });

  app.post("/api/customers/:id/receipts/:rid/unlink", (c) => {
    const { id, rid } = receiptRoute(c);
    return c.json({ receipt: receipts.unlink(id, rid) });
  });

  app.delete("/api/customers/:id/receipts/:rid", (c) => {
    const { id, rid } = receiptRoute(c);
    receipts.delete(id, rid);
    return c.json({ deleted: true });
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

  // ---- chat: the question goes in, a validated reply and card operations come out ----
  // The prompt is built here, the model is called here with the server's key, and the model's
  // tool calls are checked here. The caller cannot supply instructions or choose the model.

  app.use("/api/chat", chatLimit);
  app.post("/api/chat", async (c) => {
    let request: ChatRequest;
    try {
      request = parseChatRequest(await jsonBody(c.req.raw));
    } catch (error) {
      if (error instanceof ChatRequestError) badRequest(error.message);
      throw error;
    }
    const id = customerId(request.customerId);
    if (!getCustomer(db, id)) throw new HTTPException(404, { message: "Customer not found" });
    if (!options.chatModel) {
      throw new HTTPException(503, { message: "The chat model is not configured on this server (GEMINI_API_KEY)." });
    }
    try {
      const blocked = new Set<string>();
      const answer = await answerChat(options.chatModel, request, {
        today: db.today,
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        // The engine runs here, for this customer only: the snapshot, the coach's lookups and its cards' figures.
        lookup: (fn, args) => {
          const result = protectedEngine.run(id, fn, args, {
            allow: request.allowProtected,
            onBlocked: (categories) => categories.forEach((category) => blocked.add(category)),
          });
          if (!result) throw new Error("Customer not found");
          return result;
        },
        profile: profiles.get(id) ?? DEFAULT_PROFILE,
        allowProtected: request.allowProtected,
        // A receipt photo is saved for this customer and matched to one of their payments.
        saveReceipt: saveReceiptFor(id),
        // The coach may change the saved preferences when the user asks. Taking a category off the
        // keep-as-is list only goes through for categories the previous answer asked the user about.
        preferences: {
          pendingUnprotect: request.pendingUnprotect ?? [],
          apply: (update) => profiles.update(id, update),
        },
      });
      // A refused lookup is also something to ask about: the next message may confirm taking it off the list.
      const kept = (profiles.get(id) ?? DEFAULT_PROFILE).protectedCategories;
      const proposedUnprotect = [...new Set([...answer.proposedUnprotect, ...kept.filter((category) => blocked.has(category))])];
      return c.json({ ...answer, blocked: [...blocked], proposedUnprotect });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new HTTPException(504, { message: "The coach took too long to answer. Try again in a moment." });
      }
      console.error("Chat failed:", error);
      throw new HTTPException(502, { message: error instanceof Error ? error.message : "The chat model could not answer." });
    }
  });

  if (options.staticDir) {
    // Everything that is not an API route is the web app; unknown paths fall back to its
    // index page so client-side navigation works after a reload.
    app.use("*", async (c, next) => (c.req.path.startsWith("/api/") ? next() : serveStatic({ root: options.staticDir })(c, next)));
    app.get("*", async (c, next) =>
      c.req.path.startsWith("/api/") ? next() : serveStatic({ root: options.staticDir, path: "index.html" })(c, next),
    );
  }

  return app;
}
