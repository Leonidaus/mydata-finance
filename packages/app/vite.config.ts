import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server is localhost-only. To test on a phone on a trusted network, run: npm run dev -- --host
export default defineConfig({
  plugins: [react()],
});
