/**
 * Gemini without the backend, for dev mode: the request goes through the Vite dev server's /gemini
 * route (vite.config.ts adds the API key there, so the key never reaches the browser).
 * With the backend, the chat runs on the server instead (see ./server.ts and POST /api/chat).
 * The request format, timeouts and model fallback are shared: createGeminiModel in @mydata/shared.
 */
import { createGeminiModel, parseGeminiModels } from "@mydata/shared";

/** True when `npm run dev` was started with GEMINI_API_KEY set. */
export const geminiAvailable: boolean = typeof __GEMINI_PROXY__ !== "undefined" && __GEMINI_PROXY__;

export const gemini = createGeminiModel(
  (model, body, signal) =>
    fetch(`/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body,
    }),
  {
    // VITE_GEMINI_MODEL may list several models, comma-separated.
    models: parseGeminiModels(import.meta.env.VITE_GEMINI_MODEL),
    log: (level, message) => (level === "warn" ? console.warn : console.info)(`[agent] ${message}`),
  },
);
