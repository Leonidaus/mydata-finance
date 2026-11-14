import { describe, expect, it } from "vitest";
import { createVoiceClient } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("voice client", () => {
  it("remembers available voice and checks again after an unavailable answer", async () => {
    let calls = 0;
    let voice = false;
    const client = createVoiceClient("", async () => (calls++, json({ ok: true, services: { voice } })));
    expect(await client.available()).toBe(false);
    voice = true;
    expect(await client.available()).toBe(true);
    expect(await client.available()).toBe(true);
    expect(calls).toBe(2);
  });

  it("treats an unreachable backend as unavailable and retries later", async () => {
    let down = true;
    let calls = 0;
    const client = createVoiceClient("", async () => {
      calls++;
      if (down) throw new TypeError("network");
      return json({ services: { voice: true } });
    });
    expect(await client.available()).toBe(false);
    down = false;
    expect(await client.available()).toBe(true);
    expect(calls).toBe(2);
  });

  it("posts reply text to TTS and returns its audio", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const client = createVoiceClient("https://api.example", async (url, init) => {
      seen.push({ url: String(url), init });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    });
    const audio = await client.speak("You spent €20.");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.example/api/tts");
    expect(seen[0].init?.method).toBe("POST");
    expect(seen[0].init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ text: "You spent €20." });
    expect(audio.type).toBe("audio/mpeg");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("surfaces TTS errors, including the voice rate limit", async () => {
    const busy = createVoiceClient("", async () => json({ error: "The voice service is busy. Try again in 30 seconds." }, 429));
    await expect(busy.speak("hello")).rejects.toThrow("Try again in 30 seconds");
    const broken = createVoiceClient("", async () => new Response("Bad gateway", { status: 502 }));
    await expect(broken.speak("hello")).rejects.toThrow("status 502");
  });

  it("sends dictation as multipart audio and trims the transcript", async () => {
    const audio = new Blob(["recorded audio"], { type: "audio/webm" });
    let seen: { url: string; init?: RequestInit } | undefined;
    const client = createVoiceClient("", async (url, init) => {
      seen = { url: String(url), init };
      return json({ text: "  What did I spend?  ", languageCode: "en" });
    });
    await expect(client.transcribe(audio)).resolves.toBe("What did I spend?");
    expect(seen?.url).toBe("/api/stt");
    expect(seen?.init?.method).toBe("POST");
    expect(seen?.init?.body).toBeInstanceOf(FormData);
    const uploaded = (seen?.init?.body as FormData).get("audio") as Blob;
    expect(uploaded).toBeInstanceOf(Blob);
    expect(uploaded.type).toBe(audio.type);
    expect(await uploaded.text()).toBe(await audio.text());
  });

  it("surfaces STT backend and connection errors", async () => {
    const denied = createVoiceClient("", async () => json({ error: "ElevenLabs request failed" }, 502));
    await expect(denied.transcribe(new Blob(["audio"]))).rejects.toThrow("ElevenLabs request failed");
    const down = createVoiceClient("", async () => {
      throw new TypeError("network");
    });
    await expect(down.transcribe(new Blob(["audio"]))).rejects.toThrow("Could not reach the voice service");
  });

  it("rejects a transcription response without text", async () => {
    const client = createVoiceClient("", async () => json({ languageCode: "en" }));
    await expect(client.transcribe(new Blob(["audio"]))).rejects.toThrow("could not read");
  });
});
