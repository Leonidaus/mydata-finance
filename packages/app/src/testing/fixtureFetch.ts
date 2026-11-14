/** Test helper: a stand-in for `fetch` that serves public/fixtures/ from disk under `base`. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../public/fixtures/", import.meta.url));

export function fixtureFetch(base: string) {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const file = dir + url.slice(base.length);
    if (!url.startsWith(base) || !existsSync(file)) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(file, "utf8"), { headers: { "content-type": "application/json" } });
  };
  return { fetchFn, calls };
}
