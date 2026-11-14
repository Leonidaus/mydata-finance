import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
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

  // Browser builds of the widget libraries, read as text and injected into the sandboxed frame
  // (see src/renderers/widgetLibs.ts). `virtual:widgetlib/<name>` is a module whose default export
  // is the file's source as a string. A plugin does this rather than an alias plus `?raw`, because
  // the dev server and the build treat the query differently (one of them ran the library instead).
  const WIDGET_LIB_FILES: Record<string, string> = {
    gsap: "gsap/dist/gsap.min.js",
    matter: "matter-js/build/matter.min.js",
    three: "three/build/three.min.js",
  };
  const PREFIX = "virtual:widgetlib/";
  const widgetLibs: Plugin = {
    name: "widget-libs",
    resolveId: (id) => (id.startsWith(PREFIX) && id.slice(PREFIX.length) in WIDGET_LIB_FILES ? `\0${id}` : null),
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return null;
      const name = id.slice(PREFIX.length + 1);
      const read = (file: string) => readFileSync(fileURLToPath(new URL(`../../node_modules/${file}`, import.meta.url)), "utf8");
      let source = read(WIDGET_LIB_FILES[name]);
      if (name === "three") {
        // OrbitControls only ships as an ES module. Turn its import and export into globals so
        // widgets get THREE.OrbitControls (drag to rotate, pinch to zoom) from the same script.
        const orbit = read("three/examples/jsm/controls/OrbitControls.js")
          .replace(/import\s*\{([^}]*)\}\s*from\s*'three';/, "const {$1} = THREE;")
          .replace(/export\s*\{\s*OrbitControls\s*\};/, "THREE.OrbitControls = OrbitControls;");
        if (/^\s*(import|export)\s/m.test(orbit)) throw new Error("widget-libs: OrbitControls has imports or exports this plugin doesn't handle");
        source += `\n(function () {\n${orbit}\n})();`;
      }
      return `export default ${JSON.stringify(source)};`;
    },
  };

  return {
    plugins: [react(), widgetLibs],
    define: { __GEMINI_PROXY__: JSON.stringify(Boolean(geminiKey)) },
    server: { proxy: { ...apiProxy, ...geminiProxy } },
    preview: { proxy: apiProxy },
    // Vega (~290 kB gzipped) is lazy-loaded in its own chunk on first chart render.
    build: { chunkSizeWarningLimit: 900 },
  };
});
