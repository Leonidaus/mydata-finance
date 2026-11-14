import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../latest";
import type { VoiceClient } from "./client";

interface PlayingAudio {
  element: HTMLAudioElement;
  url: string;
}

export function useVoice(client: VoiceClient) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const playing = useRef<PlayingAudio | null>(null);
  const speechVersion = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recordingVersion = useRef(0);
  const requestingMic = useRef(false);

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

  const clearAudio = useCallback(() => {
    if (!playing.current) return;
    playing.current.element.pause();
    URL.revokeObjectURL(playing.current.url);
    playing.current = null;
  }, []);

  const stopSpeaking = useCallback(() => {
    speechVersion.current++;
    clearAudio();
  }, [clearAudio]);

  const cancelRecording = useCallback(() => {
    recordingVersion.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setRecording(false);
  }, []);

  const reset = useCallback(() => {
    stopSpeaking();
    cancelRecording();
    setError(null);
  }, [stopSpeaking, cancelRecording]);

  useEffect(
    () => () => {
      enabledRef.current = false;
      stopSpeaking();
      cancelRecording();
    },
    [stopSpeaking, cancelRecording],
  );

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      reset();
    } else {
      enabledRef.current = true;
      setEnabled(true);
      setError(null);
    }
  }, [reset]);

  const speak = useCallback(
    async (text: string) => {
      if (!enabledRef.current || !text.trim()) return;
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
        element.onended = () => {
          if (playing.current?.element === element) clearAudio();
        };
        element.onerror = () => {
          if (enabledRef.current && version === speechVersion.current) {
            clearAudio();
            setError("The reply audio could not be played.");
          }
        };
        await element.play();
      } catch (cause: unknown) {
        if (enabledRef.current && version === speechVersion.current) {
          if (element) clearAudio();
          setError(errorMessage(cause));
        }
      }
    },
    [client, stopSpeaking, clearAudio],
  );

  const dictate = useCallback(async (): Promise<string> => {
    if (recorder.current) {
      if (recorder.current.state === "recording") recorder.current.stop();
      return "";
    }
    if (!enabledRef.current || requestingMic.current) return "";
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice dictation is not supported in this browser.");
      return "";
    }

    const version = ++recordingVersion.current;
    requestingMic.current = true;
    setError(null);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause: unknown) {
      if (enabledRef.current && version === recordingVersion.current) setError(errorMessage(cause));
      return "";
    } finally {
      requestingMic.current = false;
    }
    if (!enabledRef.current || version !== recordingVersion.current) {
      media.getTracks().forEach((track) => track.stop());
      return "";
    }

    let current: MediaRecorder;
    try {
      current = new MediaRecorder(media);
    } catch (cause: unknown) {
      media.getTracks().forEach((track) => track.stop());
      if (enabledRef.current && version === recordingVersion.current) setError(errorMessage(cause));
      return "";
    }
    recorder.current = current;
    stream.current = media;
    const chunks: Blob[] = [];

    return new Promise<string>((resolve) => {
      current.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      current.onerror = () => {
        if (enabledRef.current && version === recordingVersion.current) setError("The recording failed. Please try again.");
      };
      current.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (recorder.current === current) recorder.current = null;
        if (stream.current === media) stream.current = null;
        if (!enabledRef.current || version !== recordingVersion.current) {
          resolve("");
          return;
        }
        setRecording(false);
        const audio = new Blob(chunks, { type: current.mimeType || chunks[0]?.type });
        if (!audio.size) {
          setError("No audio was recorded. Please try again.");
          resolve("");
          return;
        }
        client.transcribe(audio).then(
          (text) => {
            if (!enabledRef.current || version !== recordingVersion.current) {
              resolve("");
              return;
            }
            if (!text) setError("I didn't catch that. Please try again.");
            resolve(text);
          },
          (cause: unknown) => {
            if (enabledRef.current && version === recordingVersion.current) setError(errorMessage(cause));
            resolve("");
          },
        );
      };
      try {
        current.start();
        setRecording(true);
      } catch (cause: unknown) {
        media.getTracks().forEach((track) => track.stop());
        if (recorder.current === current) recorder.current = null;
        if (stream.current === media) stream.current = null;
        if (enabledRef.current && version === recordingVersion.current) setError(errorMessage(cause));
        resolve("");
      }
    });
  }, [client]);

  return { available, enabled, recording, error, toggle, speak, dictate, stopSpeaking, reset };
}
