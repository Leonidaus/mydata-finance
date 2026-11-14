import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createServerGeminiModel } from "./chat";
import { openDatabase, resolveFromInvocationDir } from "./db";

// Keys for outside services (ELEVENLABS_API_KEY, ...) may live in a .env file at the
// repository root. It is gitignored; see .env.example. Variables already set win.
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const db = openDatabase();
const port = Number(process.env.PORT ?? 8787);
// STATIC_DIR: the built web app to serve alongside the API (set in the Docker image).
const staticDir = process.env.STATIC_DIR && resolveFromInvocationDir(process.env.STATIC_DIR);
if (staticDir && !existsSync(staticDir)) {
  throw new Error(`STATIC_DIR ${staticDir} does not exist. Build the app first: npm run build`);
}

const geminiKey = process.env.GEMINI_API_KEY?.trim() || undefined;

// GEMINI_MODEL may list several models, comma-separated; the next one is tried when one is overloaded.
const chatModel = geminiKey ? createServerGeminiModel(geminiKey, process.env.GEMINI_MODEL) : undefined;

serve({ fetch: createApp(db, { staticDir, chatModel }).fetch, port }, (info) => {
  console.log(
    `Finance API on http://localhost:${info.port} ` +
      `(${db.meta.rows_customers} customers, today is ${db.today})` +
      (staticDir ? `, serving the app from ${staticDir}` : "") +
      `; chat model ${geminiKey ? "on" : "off (no GEMINI_API_KEY)"}` +
      `, voice ${process.env.ELEVENLABS_API_KEY ? "on" : "off (no ELEVENLABS_API_KEY)"}`,
  );
});
