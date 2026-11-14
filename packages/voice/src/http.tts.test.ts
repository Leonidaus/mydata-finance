import { beforeEach, describe, expect, it, vi } from "vitest";

const { speak } = vi.hoisted(() => ({ speak: vi.fn() }));

vi.mock("./voice.js", () => ({
  speak,
  listen: vi.fn(),
  VoiceNotConfiguredError: class VoiceNotConfiguredError extends Error {},
}));

import { handleTts } from "./http.js";

describe("handleTts language selection", () => {
  beforeEach(() => {
    speak.mockReset();
    speak.mockResolvedValue(new ReadableStream<Uint8Array>());
  });

  it("forwards the app's selected locale to ElevenLabs", async () => {
    const response = await handleTts(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Paljonko voin käyttää?", languageCode: "fi" }),
      }),
    );

    expect(speak).toHaveBeenCalledWith("Paljonko voin käyttää?", { languageCode: "fi" });
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
  });
});
