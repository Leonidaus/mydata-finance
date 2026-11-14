/// <reference types="vite/client" />

/** See data.ts for what these do. */
interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: string;
  readonly VITE_API_BASE?: string;
  /** Gemini models for the chat in dev mode, comma-separated, e.g. gemini-3.5-flash-lite. */
  readonly VITE_GEMINI_MODEL?: string;
}

/** Widget library sources as text; served by the widget-libs plugin in vite.config.ts. */
declare module "virtual:widgetlib/*" {
  const source: string;
  export default source;
}

/** Set by vite.config.ts: the dev server has a GEMINI_API_KEY and forwards /gemini to Google. */
declare const __GEMINI_PROXY__: boolean;
