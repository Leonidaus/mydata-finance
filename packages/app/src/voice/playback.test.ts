import { describe, expect, it, vi } from "vitest";
import { ReplyPlayback, type PlaybackEnvironment } from "./playback";

function audioContextEnvironment() {
  const source = {
    buffer: null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const context = {
    state: "suspended" as AudioContextState,
    destination: {} as AudioNode,
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    decodeAudioData: vi.fn(async () => ({} as AudioBuffer)),
    createBufferSource: vi.fn(() => source),
  };
  const environment: PlaybackEnvironment = {
    AudioContext: class {
      constructor() {
        return context;
      }
    } as unknown as PlaybackEnvironment["AudioContext"],
    createAudio: vi.fn(),
    createObjectURL: vi.fn(),
    revokeObjectURL: vi.fn(),
  };
  return { context, environment, source };
}

describe("reply playback", () => {
  it("unlocks Web Audio from a user tap and plays a later agent reply", async () => {
    const { context, environment, source } = audioContextEnvironment();
    const playback = new ReplyPlayback(environment);

    playback.unlock();
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledOnce();

    const playing = await playback.play(new Blob(["mp3"]), () => true);
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(source.connect).toHaveBeenCalledWith(context.destination);
    expect(source.start).toHaveBeenCalledOnce();

    source.onended?.();
    await expect(playing?.finished).resolves.toBeUndefined();
  });

  it("does not start a reply that was superseded while its audio was decoding", async () => {
    const { environment, source } = audioContextEnvironment();
    const playback = new ReplyPlayback(environment);
    playback.unlock();
    await Promise.resolve();

    await expect(playback.play(new Blob(["mp3"]), () => false)).resolves.toBeUndefined();
    expect(source.start).not.toHaveBeenCalled();
  });
});
