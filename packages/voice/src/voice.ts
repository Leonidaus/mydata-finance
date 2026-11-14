import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { getVoiceConfig, type VoiceConfig } from "./config.js";

export class VoiceNotConfiguredError extends Error {
  constructor() {
    super("ELEVENLABS_API_KEY is not set. Copy packages/voice/.env.example to .env and add your key.");
    this.name = "VoiceNotConfiguredError";
  }
}

export interface SpeakOptions {
  voiceId?: string;
  modelId?: string;
  languageCode?: string;
}

export interface ListenOptions {
  modelId?: string;
  languageCode?: string;
}

export interface Transcription {
  text: string;
  languageCode: string;
}

let cached: { apiKey: string; client: ElevenLabsClient } | undefined;

function getClient(): { client: ElevenLabsClient; config: VoiceConfig } {
  const config = getVoiceConfig();
  if (!config.apiKey) {
    throw new VoiceNotConfiguredError();
  }
  if (!cached || cached.apiKey !== config.apiKey) {
    cached = { apiKey: config.apiKey, client: new ElevenLabsClient({ apiKey: config.apiKey }) };
  }
  return { client: cached.client, config };
}

export async function speak(text: string, options: SpeakOptions = {}): Promise<ReadableStream<Uint8Array>> {
  const { client, config } = getClient();
  const modelId = options.modelId ?? config.ttsModelId;
  const languageCode = options.languageCode ?? config.ttsLanguageCode;
  return client.textToSpeech.convert(options.voiceId ?? config.voiceId, {
    text,
    modelId,
    outputFormat: "mp3_44100_128",
    // multilingual_v2 infers the language from the text and does not accept languageCode.
    // When no language is set, omit it so other models auto-detect too.
    ...(modelId !== "eleven_multilingual_v2" && languageCode ? { languageCode } : {}),
    // Flash skips number normalization by default, which mangles currency amounts.
    ...(modelId === "eleven_flash_v2_5" ? { applyTextNormalization: "on" as const } : {}),
  });
}

export async function listen(audio: Blob, options: ListenOptions = {}): Promise<Transcription> {
  const { client, config } = getClient();
  const result = await client.speechToText.convert({
    file: audio,
    modelId: options.modelId ?? config.sttModelId,
    languageCode: options.languageCode ?? config.sttLanguageCode,
  });
  return { text: result.text, languageCode: result.languageCode };
}
