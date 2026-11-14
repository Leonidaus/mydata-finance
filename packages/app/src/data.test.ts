import { describe, expect, it } from "vitest";
import { resolveDataConfig } from "./data";

describe("resolveDataConfig", () => {
  it("defaults to the API on the app's own origin", () => {
    expect(resolveDataConfig({})).toEqual({ mode: "api", apiBase: "" });
    expect(resolveDataConfig({ VITE_DATA_SOURCE: "", VITE_API_BASE: " " })).toEqual({ mode: "api", apiBase: "" });
  });

  it("takes the mode and an API origin, without its trailing slash", () => {
    expect(resolveDataConfig({ VITE_DATA_SOURCE: "fixtures" })).toEqual({ mode: "fixtures", apiBase: "" });
    expect(resolveDataConfig({ VITE_DATA_SOURCE: "api", VITE_API_BASE: "http://localhost:8787/" })).toEqual({
      mode: "api",
      apiBase: "http://localhost:8787",
    });
  });

  it("rejects an unknown mode instead of guessing", () => {
    expect(() => resolveDataConfig({ VITE_DATA_SOURCE: "fixture" })).toThrow(/VITE_DATA_SOURCE must be "api" or "fixtures"/);
  });
});
