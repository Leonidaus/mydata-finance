import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In API mode the app calls /api on its own origin; the dev and preview servers forward it to the backend.
const apiProxy = { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8787" };

// Dev server is localhost-only. To test on a phone on a trusted network, run: npm run dev -- --host
export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  // Vega (~290 kB gzipped) is lazy-loaded in its own chunk on first chart render.
  build: { chunkSizeWarningLimit: 900 },
});
