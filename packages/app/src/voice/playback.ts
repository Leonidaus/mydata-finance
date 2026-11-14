export interface PlayingAudio {
  /** Stops playback and settles `finished`. It is safe to call more than once. */
  stop(): void;
  /** Resolves when playback ends, fails, or is stopped. */
  finished: Promise<void>;
}

export class ReplyPlaybackError extends Error {
  constructor(cause?: unknown) {
    super("Reply audio could not be played.", { cause });
    this.name = "ReplyPlaybackError";
  }
}

interface BufferSource {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  connect(destination: AudioNode): void;
  start(): void;
  stop(): void;
}

interface PlaybackContext {
  state: AudioContextState;
  destination: AudioNode;
  resume(): Promise<void>;
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): BufferSource;
}

interface PlaybackContextConstructor {
  new (): PlaybackContext;
}

export interface PlaybackEnvironment {
  AudioContext?: PlaybackContextConstructor;
  createAudio(url: string): HTMLAudioElement;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

function browserEnvironment(): PlaybackEnvironment {
  const browser = globalThis as typeof globalThis & { webkitAudioContext?: PlaybackContextConstructor };
  return {
    AudioContext: (browser.AudioContext as unknown as PlaybackContextConstructor | undefined) ?? browser.webkitAudioContext,
    createAudio: (url) => new Audio(url),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * Browsers require sound to be enabled directly from a tap. `unlock` is therefore called from
 * the narration control; a reply may arrive later and still play through the unlocked context.
 */
export class ReplyPlayback {
  private context: PlaybackContext | null | undefined;

  constructor(private readonly environment: PlaybackEnvironment = browserEnvironment()) {}

  unlock() {
    if (this.context === undefined) {
      this.context = this.environment.AudioContext ? new this.environment.AudioContext() : null;
    }
    if (this.context?.state === "suspended") {
      // The audio-element fallback remains available if this browser cannot resume Web Audio.
      void this.context.resume().catch(() => {});
    }
  }

  async play(blob: Blob, canStart: () => boolean): Promise<PlayingAudio | undefined> {
    if (this.context?.state === "running") {
      let buffer: AudioBuffer;
      try {
        buffer = await this.context.decodeAudioData(await blob.arrayBuffer());
      } catch (error) {
        throw new ReplyPlaybackError(error);
      }
      if (!canStart()) return undefined;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      return this.start(source, canStart);
    }
    return this.playElement(blob, canStart);
  }

  private start(source: BufferSource, canStart: () => boolean): PlayingAudio | undefined {
    if (!canStart()) return undefined;
    let settled = false;
    let resolve!: () => void;
    const finished = new Promise<void>((done) => {
      resolve = () => {
        if (settled) return;
        settled = true;
        done();
      };
    });
    source.onended = resolve;
    source.start();
    return {
      finished,
      stop: () => {
        source.onended = null;
        try {
          source.stop();
        } finally {
          resolve();
        }
      },
    };
  }

  private async playElement(blob: Blob, canStart: () => boolean): Promise<PlayingAudio | undefined> {
    if (!canStart()) return undefined;
    const url = this.environment.createObjectURL(blob);
    const element = this.environment.createAudio(url);
    let settled = false;
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const finished = new Promise<void>((done, fail) => {
      resolve = () => {
        if (settled) return;
        settled = true;
        element.onended = null;
        element.onerror = null;
        this.environment.revokeObjectURL(url);
        done();
      };
      reject = (error) => {
        if (settled) return;
        settled = true;
        element.onended = null;
        element.onerror = null;
        this.environment.revokeObjectURL(url);
        fail(error);
      };
    });
    element.onended = resolve;
    element.onerror = () => reject(new ReplyPlaybackError());
    try {
      await element.play();
      // `play()` resolves asynchronously. The narration control may have been switched off
      // while the browser was starting the element, before its handle could be returned to
      // the caller and stopped there.
      if (!canStart()) {
        element.pause();
        resolve();
        return undefined;
      }
    } catch (error) {
      // No handle has been returned yet, so settle this internal promise before surfacing the
      // failure through `play` itself.
      resolve();
      throw new ReplyPlaybackError(error);
    }
    return {
      finished,
      stop: () => {
        element.pause();
        resolve();
      },
    };
  }
}
