import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../latest";
import type { VoiceClient } from "./client";

const VOICE_LEVEL = 0.025;
const VOICE_ONSET_MS = 120;
const SILENCE_MS = 800;
const MIN_UTTERANCE_MS = 350;
const MAX_UTTERANCE_MS = 15_000;

interface PlayingAudio {
  element: HTMLAudioElement;
  url: string;
}

export function useVoice(client: VoiceClient, onQuestion: (text: string) => void) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const paused = useRef(false);
  const starting = useRef(false);
  const question = useRef(onQuestion);
  const playing = useRef<PlayingAudio | null>(null);
  const finishPlayback = useRef<(() => void) | null>(null);
  const speechVersion = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const monitorFrame = useRef(0);
  const captureVersion = useRef(0);
  const startCapture = useRef<() => void>(() => {});
  question.current = onQuestion;

  useEffect(() => {
    let current = true;
    void client.available().then(
      (ok) => current && setAvailable(ok),
      () => current && setAvailable(false),
    );
    return () => {
      current = false;
    };
  }, [client]);

  const releaseMedia = useCallback(() => {
    cancelAnimationFrame(monitorFrame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (audioContext.current) void audioContext.current.close().catch(() => undefined);
    audioContext.current = null;
  }, []);

  const clearAudio = useCallback(() => {
    playing.current?.element.pause();
    if (playing.current) URL.revokeObjectURL(playing.current.url);
    playing.current = null;
    const finish = finishPlayback.current;
    finishPlayback.current = null;
    finish?.();
  }, []);

  const stopSpeaking = useCallback(() => {
    speechVersion.current++;
    clearAudio();
  }, [clearAudio]);

  const stopCapture = useCallback(() => {
    captureVersion.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    releaseMedia();
    setRecording(false);
    setProcessing(false);
  }, [releaseMedia]);

  const pause = useCallback(() => {
    paused.current = true;
    stopCapture();
  }, [stopCapture]);

  const resume = useCallback(() => {
    if (!enabledRef.current) return;
    paused.current = false;
    setProcessing(false);
    startCapture.current();
  }, []);

  const disable = useCallback(() => {
    enabledRef.current = false;
    paused.current = true;
    setEnabled(false);
    stopCapture();
  }, [stopCapture]);

  const reset = useCallback(() => {
    stopSpeaking();
    stopCapture();
    paused.current = false;
    setError(null);
    if (enabledRef.current) startCapture.current();
  }, [stopSpeaking, stopCapture]);

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      stopSpeaking();
      stopCapture();
      setError(null);
    } else {
      enabledRef.current = true;
      paused.current = false;
      setEnabled(true);
      setError(null);
      startCapture.current();
    }
  }, [stopSpeaking, stopCapture]);

  useEffect(
    () => () => {
      enabledRef.current = false;
      paused.current = true;
      stopSpeaking();
      stopCapture();
    },
    [stopSpeaking, stopCapture],
  );

  const speak = useCallback(
    async (text: string) => {
      if (!enabledRef.current || !text.trim()) return;
      pause();
      stopSpeaking();
      const version = speechVersion.current;
      setError(null);
      let element: HTMLAudioElement | null = null;
      try {
        const blob = await client.speak(text);
        if (!enabledRef.current || version !== speechVersion.current) return;
        const url = URL.createObjectURL(blob);
        element = new Audio(url);
        playing.current = { element, url };
        const ended = new Promise<void>((resolve) => {
          finishPlayback.current = resolve;
        });
        element.onended = clearAudio;
        element.onerror = () => {
          if (enabledRef.current && version === speechVersion.current) setError("The reply audio could not be played.");
          clearAudio();
        };
        await element.play();
        await ended;
      } catch (cause: unknown) {
        if (enabledRef.current && version === speechVersion.current) setError(errorMessage(cause));
        clearAudio();
      } finally {
        if (enabledRef.current && version === speechVersion.current) resume();
      }
    },
    [client, pause, stopSpeaking, clearAudio, resume],
  );

  const beginCapture = useCallback(async () => {
    if (!enabledRef.current || paused.current || starting.current || stream.current) return;
    if (typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Continuous voice conversation is not supported in this browser.");
      return;
    }

    const version = ++captureVersion.current;
    starting.current = true;
    let media: MediaStream | null = null;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!enabledRef.current || paused.current || version !== captureVersion.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const context = new AudioContext();
      audioContext.current = context;
      await context.resume();
      if (!enabledRef.current || paused.current || version !== captureVersion.current) return;

      const source = context.createMediaStreamSource(media);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let candidateSince: number | null = null;
      let active: MediaRecorder | null = null;
      let startedAt = 0;
      let lastVoiceAt = 0;

      const live = () => enabledRef.current && !paused.current && version === captureVersion.current;
      const finish = () => {
        if (!active || active.state !== "recording") return;
        paused.current = true;
        setRecording(false);
        setProcessing(true);
        cancelAnimationFrame(monitorFrame.current);
        active.stop();
      };
      const begin = (now: number) => {
        try {
          const current = new MediaRecorder(media as MediaStream);
          active = current;
          recorder.current = current;
          const chunks: Blob[] = [];
          let failed = false;
          current.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          current.onerror = () => {
            failed = true;
            if (enabledRef.current && version === captureVersion.current) setError("The recording failed. Please try again.");
          };
          current.onstop = () => {
            active = null;
            paused.current = true;
            setRecording(false);
            if (recorder.current === current) recorder.current = null;
            releaseMedia();
            if (!enabledRef.current || version !== captureVersion.current) return;
            if (failed) {
              setProcessing(false);
              resume();
              return;
            }
            const audio = new Blob(chunks, { type: current.mimeType || chunks[0]?.type });
            if (!audio.size) {
              setProcessing(false);
              setError("No audio was recorded. Please try again.");
              resume();
              return;
            }
            client.transcribe(audio).then(
              (text) => {
                if (!enabledRef.current || version !== captureVersion.current) return;
                setProcessing(false);
                if (!text) {
                  setError("I didn't catch that. Please try again.");
                  resume();
                  return;
                }
                setError(null);
                disable();
                question.current(text);
              },
              (cause: unknown) => {
                if (!enabledRef.current || version !== captureVersion.current) return;
                setError(errorMessage(cause));
                resume();
              },
            );
          };
          current.start();
          startedAt = now;
          lastVoiceAt = now;
          setRecording(true);
        } catch (cause: unknown) {
          active = null;
          recorder.current = null;
          paused.current = true;
          releaseMedia();
          setRecording(false);
          setProcessing(false);
          if (enabledRef.current && version === captureVersion.current) setError(errorMessage(cause));
        }
      };

      const monitor = () => {
        if (!live()) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }
        const level = Math.sqrt(sum / samples.length);
        const now = performance.now();
        if (active) {
          if (level >= VOICE_LEVEL) lastVoiceAt = now;
          const utteranceLongEnough = now - startedAt >= MIN_UTTERANCE_MS;
          if ((utteranceLongEnough && now - lastVoiceAt >= SILENCE_MS) || now - startedAt >= MAX_UTTERANCE_MS) finish();
        } else if (level >= VOICE_LEVEL) {
          candidateSince ??= now;
          if (now - candidateSince >= VOICE_ONSET_MS) begin(now);
        } else {
          candidateSince = null;
        }
        monitorFrame.current = requestAnimationFrame(monitor);
      };
      monitor();
    } catch (cause: unknown) {
      media?.getTracks().forEach((track) => track.stop());
      if (version === captureVersion.current) {
        releaseMedia();
        setRecording(false);
        setProcessing(false);
        if (enabledRef.current) setError(errorMessage(cause));
      }
    } finally {
      starting.current = false;
      if (version !== captureVersion.current && enabledRef.current && !paused.current && !stream.current) startCapture.current();
    }
  }, [client, releaseMedia, resume, disable]);

  useEffect(() => {
    startCapture.current = () => void beginCapture();
    return () => {
      startCapture.current = () => {};
    };
  }, [beginCapture]);

  return { available, enabled, recording, processing, error, toggle, speak, pause, resume, reset };
}
