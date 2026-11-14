import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { listen, speak, VoiceNotConfiguredError } from "./voice.js";

const { ttsConvert, sttConvert } = vi.hoisted(() => ({
  ttsConvert: vi.fn(),
  sttConvert: vi.fn(),
}));

vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: vi.fn(function () {
    return {
      textToSpeech: { convert: ttsConvert },
      speechToText: { convert: sttConvert },
    };
  }),
}));

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "sk-test";
  delete process.env.ELEVENLABS_TTS_MODEL_ID;
  delete process.env.ELEVENLABS_STT_MODEL_ID;
  delete process.env.ELEVENLABS_TTS_LANGUAGE_CODE;
  delete process.env.ELEVENLABS_STT_LANGUAGE_CODE;
  ttsConvert.mockReset();
  ttsConvert.mockResolvedValue(new ReadableStream());
  sttConvert.mockReset();
  sttConvert.mockResolvedValue({ text: "hello", languageCode: "eng" });
});

describe("speak", () => {
  it("throws VoiceNotConfiguredError without an api key", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(speak("hello")).rejects.toBeInstanceOf(VoiceNotConfiguredError);
  });

  it("omits languageCode for eleven_multilingual_v2", async () => {
    await speak("hello");
    expect(ttsConvert.mock.calls[0][0]).toBe("hxakRxllsjiR8LZPUfMd");
    const request = ttsConvert.mock.calls[0][1];
    expect(request.modelId).toBe("eleven_multilingual_v2");
    expect(request.outputFormat).toBe("mp3_44100_128");
    expect(request).not.toHaveProperty("languageCode");
  });

  it("sends languageCode and forced text normalization for flash", async () => {
    await speak("240 euroa", { modelId: "eleven_flash_v2_5", languageCode: "fi" });
    const request = ttsConvert.mock.calls[0][1];
    expect(request.languageCode).toBe("fi");
    expect(request.applyTextNormalization).toBe("on");
  });

  it("omits languageCode when unset so the model auto-detects", async () => {
    await speak("hello", { modelId: "eleven_flash_v2_5" });
    expect(ttsConvert.mock.calls[0][1]).not.toHaveProperty("languageCode");
  });

  it("reuses the client across calls", async () => {
    await speak("warmup");
    const constructed = vi.mocked(ElevenLabsClient).mock.calls.length;
    await speak("one");
    await speak("two");
    expect(vi.mocked(ElevenLabsClient).mock.calls.length).toBe(constructed);
  });
});

describe("listen", () => {
  it("transcribes without a language hint by default", async () => {
    const result = await listen(new Blob(["audio"]));
    expect(result).toEqual({ text: "hello", languageCode: "eng" });
    const request = sttConvert.mock.calls[0][0];
    expect(request.modelId).toBe("scribe_v3");
    expect(request.languageCode).toBeUndefined();
  });

  it("passes a language override through", async () => {
    await listen(new Blob(["audio"]), { languageCode: "fi" });
    expect(sttConvert.mock.calls[0][0].languageCode).toBe("fi");
  });
});
