/// <reference types="vite/client" />

/** See data.ts for what these do. */
interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: string;
  readonly VITE_API_BASE?: string;
  /** Gemini model id for the chat, e.g. gemini-flash-latest. */
  readonly VITE_GEMINI_MODEL?: string;
}

/** Set by vite.config.ts: the dev server has a GEMINI_API_KEY and forwards /gemini to Google. */
declare const __GEMINI_PROXY__: boolean;
