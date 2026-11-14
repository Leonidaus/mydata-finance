import { describe, expect, it } from "vitest";
import { getVoiceConfig } from "./config.js";

describe("getVoiceConfig", () => {
  it("defaults models and voice, leaves languages unset for auto-detect", () => {
    const config = getVoiceConfig({});
    expect(config.apiKey).toBeUndefined();
    expect(config.voiceId).toBe("hxakRxllsjiR8LZPUfMd");
    expect(config.ttsModelId).toBe("eleven_multilingual_v2");
    expect(config.sttModelId).toBe("scribe_v3");
    expect(config.ttsLanguageCode).toBeUndefined();
    expect(config.sttLanguageCode).toBeUndefined();
  });

  it("reads overrides from env", () => {
    const config = getVoiceConfig({
      ELEVENLABS_API_KEY: "sk-test",
      ELEVENLABS_VOICE_ID: "voice-1",
      ELEVENLABS_TTS_MODEL_ID: "eleven_flash_v2_5",
      ELEVENLABS_STT_MODEL_ID: "scribe_v2",
      ELEVENLABS_TTS_LANGUAGE_CODE: "fi",
      ELEVENLABS_STT_LANGUAGE_CODE: "en",
    });
    expect(config.apiKey).toBe("sk-test");
    expect(config.voiceId).toBe("voice-1");
    expect(config.ttsModelId).toBe("eleven_flash_v2_5");
    expect(config.sttModelId).toBe("scribe_v2");
    expect(config.ttsLanguageCode).toBe("fi");
    expect(config.sttLanguageCode).toBe("en");
  });

  it("treats empty values as unset", () => {
    const config = getVoiceConfig({
      ELEVENLABS_API_KEY: "",
      ELEVENLABS_TTS_LANGUAGE_CODE: "",
      ELEVENLABS_STT_LANGUAGE_CODE: "",
    });
    expect(config.apiKey).toBeUndefined();
    expect(config.ttsLanguageCode).toBeUndefined();
    expect(config.sttLanguageCode).toBeUndefined();
  });
});
