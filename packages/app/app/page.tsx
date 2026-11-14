"use client";

import { useRef, useState } from "react";
import styles from "./page.module.css";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export default function Home() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function speak() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setStatus("Generating speech…");
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Text to speech failed"));
      }
      const url = URL.createObjectURL(await response.blob());
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setStatus("");
        setBusy(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setStatus("Playback failed");
        setBusy(false);
      };
      await audio.play();
      setStatus("Playing…");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Text to speech failed");
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (busy) return;
    setStatus("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("Microphone access denied. Allow microphone access and try again.");
      return;
    }
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setBusy(true);
      setStatus("Transcribing…");
      try {
        const response = await fetch("/api/stt", {
          method: "POST",
          headers: { "content-type": recorder.mimeType },
          body: new Blob(chunksRef.current, { type: recorder.mimeType }),
        });
        if (!response.ok) {
          throw new Error(await errorMessage(response, "Speech to text failed"));
        }
        const result = await response.json();
        setText(result.text);
        setStatus(`Transcribed (${result.languageCode}). Edit if needed, then read it back.`);
      } catch (cause) {
        setStatus(cause instanceof Error ? cause.message : "Speech to text failed");
      } finally {
        setBusy(false);
      }
    };
    recorder.start();
    setRecording(true);
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Talk to your money</h1>
      <p className={styles.subtitle}>
        Voice demo: record a question to transcribe it, or type text and have it read aloud.
        Finnish and English are detected automatically.
      </p>
      <textarea
        className={styles.input}
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Type something, or record your voice…"
      />
      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.button} ${recording ? styles.recording : ""}`}
          onClick={toggleRecording}
          disabled={busy && !recording}
        >
          {recording ? "Stop recording" : "Record"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={speak}
          disabled={busy || !text.trim()}
        >
          Read aloud
        </button>
      </div>
      <p className={styles.status} role="status">
        {status}
      </p>
    </main>
  );
}
