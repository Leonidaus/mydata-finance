export interface VoiceConfig {
  apiKey?: string;
  voiceId: string;
  ttsModelId: string;
  sttModelId: string;
  ttsLanguageCode?: string;
  sttLanguageCode?: string;
}

export function getVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  return {
    apiKey: env.ELEVENLABS_API_KEY || undefined,
    voiceId: env.ELEVENLABS_VOICE_ID ?? "hxakRxllsjiR8LZPUfMd",
    ttsModelId: env.ELEVENLABS_TTS_MODEL_ID ?? "eleven_multilingual_v2",
    sttModelId: env.ELEVENLABS_STT_MODEL_ID ?? "scribe_v3",
    ttsLanguageCode: env.ELEVENLABS_TTS_LANGUAGE_CODE || undefined,
    sttLanguageCode: env.ELEVENLABS_STT_LANGUAGE_CODE || undefined,
  };
}
