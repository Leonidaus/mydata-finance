export interface VoiceClient {
  available(): Promise<boolean>;
  speak(text: string): Promise<Blob>;
  transcribe(audio: Blob): Promise<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function failure(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => undefined);
  const message = isRecord(body) && typeof body.error === "string" && body.error ? body.error : `The voice service answered with status ${response.status}.`;
  return new Error(message);
}

export function createVoiceClient(base = "", fetchFn: typeof fetch = (...args) => fetch(...args)): VoiceClient {
  let availability: Promise<boolean> | null = null;

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(`${base}${path}`, init);
    } catch {
      throw new Error("Could not reach the voice service. Is the backend running?");
    }
  }

  return {
    available() {
      if (!availability) {
        const check = fetchFn(`${base}/api/health`)
          .then((response) => (response.ok ? response.json() : null))
          .then((health: unknown) => isRecord(health) && isRecord(health.services) && health.services.voice === true)
          .catch(() => false);
        check.then((ok) => {
          if (!ok && availability === check) availability = null;
        });
        availability = check;
      }
      return availability;
    },

    async speak(text) {
      const response = await request("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw await failure(response);
      return response.blob();
    },

    async transcribe(audio) {
      const form = new FormData();
      form.append("audio", audio);
      const response = await request("/api/stt", { method: "POST", body: form });
      if (!response.ok) throw await failure(response);
      const body: unknown = await response.json().catch(() => undefined);
      if (!isRecord(body) || typeof body.text !== "string") throw new Error("The voice service gave an answer the app could not read.");
      return body.text.trim();
    },
  };
}
