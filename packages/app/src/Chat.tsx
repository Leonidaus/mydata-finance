import { type FormEvent, useEffect, useRef, useState } from "react";
import { DEMO_PROMPTS } from "./agent/mockAgent";
import type { ChatMode } from "./agent";
import { apiBase } from "./data";
import { errorMessage } from "./latest";
import { createVoiceClient } from "./voice/client";
import { useVoice } from "./voice/useVoice";

type Message = { id: number; role: "user" | "assistant"; text: string };

/** A few of each kind, so the chips show templates, custom charts and widgets. */
const SUGGESTIONS = [
  ...DEMO_PROMPTS[0].prompts.slice(0, 4),
  ...DEMO_PROMPTS[1].prompts.slice(0, 2),
  ...DEMO_PROMPTS[2].prompts,
  ...DEMO_PROMPTS[0].prompts.slice(4, 6),
];

const voiceClient = createVoiceClient(apiBase);

interface Props {
  /** Resolves to the assistant's reply text; dashboard edits happen as a side effect. */
  onAsk: (question: string, canned?: boolean) => Promise<string>;
  /** Changing this resets the conversation (e.g. when switching customer). */
  resetKey: string;
  /** Send a question from outside the chat (e.g. the dev gallery). A new `n` sends again. */
  request?: { text: string; n: number; canned?: boolean } | null;
  /** What answers typed questions: the backend's model, Gemini through the dev server, or keyword rules. */
  mode: ChatMode;
}

export default function Chat({ onAsk, resetKey, request, mode }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  /** Counts conversation resets, so that a reply can tell whether its conversation is still open. */
  const conversation = useRef(0);
  const pendingRef = useRef(false);
  const voice = useVoice(voiceClient, (text) => send(text));

  useEffect(() => {
    conversation.current++;
    pendingRef.current = false;
    setMessages([]);
    setPending(false);
    voice.reset();
  }, [resetKey, voice.reset]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function send(text: string, canned = false) {
    const trimmed = text.trim();
    if (!trimmed || pendingRef.current) return;
    voice.pause();
    const add = (role: Message["role"], text: string) => {
      const id = nextId.current++;
      setMessages((prev) => [...prev, { id, role, text }]);
    };
    // A reply that arrives after the conversation was reset belongs to the previous customer: drop it.
    const askedIn = conversation.current;
    const current = () => conversation.current === askedIn;
    add("user", trimmed);
    setInput("");
    pendingRef.current = true;
    setPending(true);
    onAsk(trimmed, canned)
      .then(
        (reply) => {
          if (!current()) return;
          add("assistant", reply);
          return voice.speak(reply);
        },
        (e: unknown) => current() && add("assistant", `I couldn't answer that: ${errorMessage(e)} Please ask again.`),
      )
      .finally(() => {
        if (!current()) return;
        pendingRef.current = false;
        setPending(false);
        voice.resume();
      });
  }

  useEffect(() => {
    if (request) send(request.text, request.canned ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  const modeNote =
    mode === "mock"
      ? "Demo coach: keyword-based. Set GEMINI_API_KEY (in .env for the backend, or packages/app/.env.local for dev mode) to use Gemini."
      : mode === "server"
        ? "Typed questions go to Gemini. It sees the totals on the cards it builds, never your transactions. Chips are instant keyword answers."
        : "Typed questions go to Gemini, which never sees your figures. Chips are instant keyword answers.";
  const note = voice.error
    ? voice.error
    : voice.enabled
      ? voice.processing
        ? "Transcribing your question…"
        : voice.recording
          ? "Listening… I'll answer when you pause."
          : pending
            ? "Voice is paused while your coach answers…"
            : "Voice on. Start speaking."
      : modeNote;

  return (
    <section className="chat" aria-label="Chat with your money coach">
      {messages.length > 0 && (
        <div className="chat-log" ref={logRef} role="log" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`bubble bubble-${m.role}`}>
              {m.text}
            </div>
          ))}
          {pending && (
            <div className="bubble bubble-assistant" role="status">
              {mode === "mock" ? "Thinking…" : "Building your answer…"}
            </div>
          )}
        </div>
      )}
      <div className="suggestions" aria-label="Suggested questions (answered instantly)">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => send(s, true)} disabled={pending}>
            {s}
          </button>
        ))}
      </div>

      <form className="chat-input" onSubmit={onSubmit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your money…" aria-label="Your question" />
        {voice.available && (
          <button
            type="button"
            className={`voice-btn${voice.enabled ? " on" : ""}`}
            onClick={voice.toggle}
            aria-pressed={voice.enabled}
            aria-label={voice.enabled ? "Disable continuous voice conversation" : "Enable continuous voice conversation"}
            title={voice.enabled ? "Disable continuous voice conversation" : "Enable continuous voice conversation"}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
            </svg>
          </button>
        )}
        <button type="submit" disabled={!input.trim() || pending}>
          Ask
        </button>
      </form>
      <p className="chat-note" role={voice.error ? "alert" : undefined}>
        {note}
      </p>
    </section>
  );
}
