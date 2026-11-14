import { listen, speak, VoiceNotConfiguredError } from "./voice.js";

const MAX_TTS_CHARACTERS = 5000;
const MAX_STT_BYTES = 25 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof VoiceNotConfiguredError) {
      return error(503, cause.message);
    }
    console.error("ElevenLabs request failed:", cause);
    return error(502, "ElevenLabs request failed");
  }
}

export async function handleTts(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error(405, "Method not allowed");
  }
  let body: { text?: unknown; languageCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, "Expected a JSON body like { \"text\": \"...\" }");
  }
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    return error(400, 'Body must include a non-empty "text" string');
  }
  if (body.text.length > MAX_TTS_CHARACTERS) {
    return error(413, `Text exceeds the ${MAX_TTS_CHARACTERS} character limit`);
  }
  const languageCode = typeof body.languageCode === "string" ? body.languageCode : undefined;
  return guard(async () => {
    const audio = await speak(body.text as string, { languageCode });
    return new Response(audio, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  });
}

export async function handleStt(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return error(405, "Method not allowed");
  }
  const contentType = request.headers.get("content-type") ?? "";
  let audio: Blob;
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return error(400, "Malformed multipart body");
    }
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return error(400, 'Expected a multipart form field named "audio"');
    }
    audio = file;
  } else if (/^(audio|video)\//.test(contentType) || contentType.startsWith("application/octet-stream")) {
    audio = await request.blob();
  } else {
    return error(400, "Send multipart/form-data with an \"audio\" file, or a raw audio/* request body");
  }
  if (audio.size === 0) {
    return error(400, "Audio is empty");
  }
  if (audio.size > MAX_STT_BYTES) {
    return error(413, "Audio exceeds the 25 MB limit");
  }
  const languageCode = new URL(request.url).searchParams.get("languageCode") ?? undefined;
  return guard(async () => json(await listen(audio, { languageCode })));
}
