/**
 * The libraries a sandboxed widget may ask for (`view.libs`). The frame has no network access,
 * so the app fetches the library source as its own lazy chunk and inlines it into the frame.
 * A card only costs the download of the libraries it names.
 *
 * Globals inside the frame: gsap → `gsap`, matter → `Matter`, three → `THREE`.
 */
import type { WidgetLib } from "@mydata/shared";

const LOADERS: Record<WidgetLib, () => Promise<{ default: string }>> = {
  gsap: () => import("virtual:widgetlib/gsap"),
  matter: () => import("virtual:widgetlib/matter"),
  three: () => import("virtual:widgetlib/three"),
};

const cache = new Map<WidgetLib, Promise<string>>();

/** Source text of each library, in the order given. */
export function loadWidgetLibs(libs: readonly WidgetLib[]): Promise<string[]> {
  return Promise.all(
    libs.map((lib) => {
      let p = cache.get(lib);
      if (!p) {
        p = LOADERS[lib]().then((m) => {
          if (typeof m.default !== "string") throw new Error(`widget library ${lib} did not load as text`);
          return m.default;
        });
        p.catch(() => cache.delete(lib));
        cache.set(lib, p);
      }
      return p;
    }),
  );
}
