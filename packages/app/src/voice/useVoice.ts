import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { errorMessage } from "../latest";
import type { VoiceClient } from "./client";

interface PlayingAudio {
  element: HTMLAudioElement;
  url: string;
}

export function useVoice(client: VoiceClient, onQuestion: (text: string) => void) {
  const { locale, t } = useI18n();
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
  const captureVersion = useRef(0);
  /** The recording the user explicitly stopped and wants sent for transcription. */
  const transcribeOnStop = useRef<number | null>(null);
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
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
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
    transcribeOnStop.current = null;
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
      setError(null);
      if (recorder.current?.state === "recording") {
        transcribeOnStop.current = captureVersion.current;
        paused.current = true;
        setRecording(false);
        setProcessing(true);
        recorder.current.stop();
      } else {
        stopCapture();
      }
    } else {
      enabledRef.current = true;
      paused.current = false;
      setEnabled(true);
      setError(null);
      setProcessing(false);
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
        const blob = await client.speak(text, locale);
        if (!enabledRef.current || version !== speechVersion.current) return;
        const url = URL.createObjectURL(blob);
        element = new Audio(url);
        playing.current = { element, url };
        const ended = new Promise<void>((resolve) => {
          finishPlayback.current = resolve;
        });
        element.onended = clearAudio;
        element.onerror = () => {
          if (enabledRef.current && version === speechVersion.current) setError(t("chat.voicePlaybackError"));
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
    [client, locale, pause, stopSpeaking, clearAudio, resume, t],
  );

  const beginCapture = useCallback(async () => {
    if (!enabledRef.current || paused.current || starting.current || stream.current) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(t("chat.voiceUnsupported"));
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
      const current = new MediaRecorder(media);
      recorder.current = current;
      const chunks: Blob[] = [];
      let failed = false;
      current.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      current.onerror = () => {
        failed = true;
        if (version === captureVersion.current) setError(t("chat.voiceRecordingError"));
      };
      current.onstop = () => {
        const shouldTranscribe = transcribeOnStop.current === version;
        if (shouldTranscribe) transcribeOnStop.current = null;
        paused.current = true;
        setRecording(false);
        if (recorder.current === current) recorder.current = null;
        releaseMedia();
        if (!shouldTranscribe || version !== captureVersion.current) return;
        if (failed) {
          setProcessing(false);
          return;
        }
        const audio = new Blob(chunks, { type: current.mimeType || chunks[0]?.type });
        if (!audio.size) {
          setProcessing(false);
          setError(t("chat.voiceNoAudio"));
          return;
        }
        client.transcribe(audio).then(
          (text) => {
            if (version !== captureVersion.current) return;
            setProcessing(false);
            if (!text) {
              setError(t("chat.voiceNoTranscript"));
              return;
            }
            setError(null);
            question.current(text);
          },
          (cause: unknown) => {
            if (version !== captureVersion.current) return;
            setProcessing(false);
            setError(errorMessage(cause));
          },
        );
      };
      current.start();
      setRecording(true);
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
  }, [client, releaseMedia, t]);

  useEffect(() => {
    startCapture.current = () => void beginCapture();
    return () => {
      startCapture.current = () => {};
    };
  }, [beginCapture]);

  return { available, enabled, recording, processing, error, toggle, speak, pause, resume, reset };
}
