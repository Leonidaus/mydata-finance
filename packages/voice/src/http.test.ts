import { beforeEach, describe, expect, it } from "vitest";
import { handleStt, handleTts } from "./http.js";

beforeEach(() => {
  delete process.env.ELEVENLABS_API_KEY;
});

function ttsRequest(body: unknown): Request {
  return new Request("http://localhost/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sttRequest(body: BodyInit, contentType: string): Request {
  return new Request("http://localhost/api/stt", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("handleTts", () => {
  it("rejects non-POST methods", async () => {
    expect((await handleTts(new Request("http://localhost/api/tts"))).status).toBe(405);
  });

  it("400 on invalid JSON", async () => {
    const request = new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect((await handleTts(request)).status).toBe(400);
  });

  it("400 on empty text", async () => {
    expect((await handleTts(ttsRequest({ text: " " }))).status).toBe(400);
    expect((await handleTts(ttsRequest({}))).status).toBe(400);
  });

  it("413 when text exceeds 5000 characters", async () => {
    expect((await handleTts(ttsRequest({ text: "a".repeat(5001) }))).status).toBe(413);
  });

  it("accepts 5000 characters (503 without a key)", async () => {
    expect((await handleTts(ttsRequest({ text: "a".repeat(5000) }))).status).toBe(503);
  });

  it("503 without an api key", async () => {
    const response = await handleTts(ttsRequest({ text: "hello" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "ELEVENLABS_API_KEY is not set. Copy packages/voice/.env.example to .env and add your key.",
    });
  });
});

describe("handleStt", () => {
  it("rejects non-POST methods", async () => {
    expect((await handleStt(new Request("http://localhost/api/stt"))).status).toBe(405);
  });

  it("400 on unsupported content type", async () => {
    expect((await handleStt(sttRequest("hello", "text/plain"))).status).toBe(400);
  });

  it("400 on a malformed multipart body instead of throwing", async () => {
    const response = await handleStt(sttRequest("not a valid multipart body", "multipart/form-data; boundary=abc"));
    expect(response.status).toBe(400);
  });

  it("400 on empty audio", async () => {
    expect((await handleStt(sttRequest("", "audio/webm"))).status).toBe(400);
  });

  it("413 when audio exceeds 25 MB", async () => {
    const body = new Uint8Array(25 * 1024 * 1024 + 1);
    expect((await handleStt(sttRequest(body, "audio/webm"))).status).toBe(413);
  });

  it("503 without an api key", async () => {
    expect((await handleStt(sttRequest("fake audio", "audio/webm"))).status).toBe(503);
  });
});
