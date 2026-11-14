import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// In API mode the app calls /api on its own origin; the dev and preview servers forward it to the backend.
const apiProxy = { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8787" };

// Dev server is localhost-only. To test on a phone on a trusted network, run: npm run dev -- --host
export default defineConfig(({ mode }) => {
  // GEMINI_API_KEY has no VITE_ prefix, so it is never put into the browser bundle. The dev server
  // forwards /gemini to Google and adds the key there; the app only knows that the route exists.
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const geminiKey = env.GEMINI_API_KEY?.trim() ?? "";
  const geminiProxy: Record<string, ProxyOptions> = geminiKey
    ? {
        "/gemini": {
          target: "https://generativelanguage.googleapis.com",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/gemini/, ""),
          headers: { "x-goog-api-key": geminiKey },
        },
      }
    : {};

  return {
    plugins: [react()],
    define: { __GEMINI_PROXY__: JSON.stringify(Boolean(geminiKey)) },
    server: { proxy: { ...apiProxy, ...geminiProxy } },
    preview: { proxy: apiProxy },
    // Vega (~290 kB gzipped) is lazy-loaded in its own chunk on first chart render.
    build: { chunkSizeWarningLimit: 900 },
  };
});
