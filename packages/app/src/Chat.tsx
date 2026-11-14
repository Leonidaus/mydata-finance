import { type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { DEMO_PROMPTS } from "./agent/mockAgent";
import type { Mood } from "@mydata/shared";
import type { ChatMode } from "./agent";
import CoachFace from "./CoachFace";
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

/** How the coach looked and what it offered next in its latest answer. */
export interface CoachState {
  mood: Mood | null;
  suggestions: string[];
}

interface Props {
  /** Resolves to the assistant's reply text; dashboard edits happen as a side effect. */
  onAsk: (question: string, canned?: boolean) => Promise<string>;
  /** Changing this resets the conversation (e.g. when switching customer). */
  resetKey: string;
  /** Send a question from outside the chat (e.g. the dev gallery). A new `n` sends again. */
  request?: { text: string; n: number; canned?: boolean } | null;
  /** What answers typed questions: the backend's model, Gemini through the dev server, or keyword rules. */
  mode: ChatMode;
  /** The latest answer's mood and suggested next steps, shown with the last reply. */
  coach?: CoachState | null;
}

export default function Chat({ onAsk, resetKey, request, mode, coach }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [chatHeight, setChatHeight] = useState<number | null>(null);
  const resizeStart = useRef<{ y: number; height: number } | null>(null);
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
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "auto" });
  }, [chatHeight]);

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
      : "Typed questions go to Gemini. It sees totals worked out from your account, never single transactions. Chips are instant keyword answers.";
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

  function startResize(e: ReactPointerEvent<HTMLButtonElement>) {
    const panel = e.currentTarget.closest(".chat");
    resizeStart.current = { y: e.clientY, height: panel?.getBoundingClientRect().height ?? 300 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function resize(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!resizeStart.current) return;
    const minHeight = Math.min(190, window.innerHeight * 0.35);
    setChatHeight(Math.max(minHeight, Math.min(window.innerHeight * 0.8, resizeStart.current.height + resizeStart.current.y - e.clientY)));
  }

  function stopResize() {
    resizeStart.current = null;
  }

  if (collapsed) {
    return (
      <button className="chat-launcher" type="button" onClick={() => setCollapsed(false)} aria-label="Open chat with your money coach" title="Open chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2v-9.5a7.5 7.5 0 0 1 7.5-7.5h2A7.5 7.5 0 0 1 20 11.5Z" />
          <path d="M8 11h8M8 14.5h5" />
        </svg>
      </button>
    );
  }

  return (
    <section className="chat" aria-label="Chat with your money coach" style={chatHeight !== null ? { height: chatHeight } : undefined}>
      <div className="chat-panel-controls">
        <button
          className="chat-resize"
          type="button"
          aria-label="Resize chat panel; drag up or down, or use arrow keys"
          title="Drag to resize chat"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const currentHeight = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect().height ?? 300;
              const delta = e.key === "ArrowUp" ? 32 : -32;
              const minHeight = Math.min(190, window.innerHeight * 0.35);
              setChatHeight((height) => Math.max(minHeight, Math.min(window.innerHeight * 0.8, (height ?? currentHeight) + delta)));
            }
          }}
        >
          <span aria-hidden="true" />
        </button>
        <span className="chat-panel-label">Chat</span>
        <button className="chat-collapse" type="button" onClick={() => setCollapsed(true)} aria-label="Minimize chat">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2v-9.5a7.5 7.5 0 0 1 7.5-7.5h2A7.5 7.5 0 0 1 20 11.5Z" />
            <path d="M8 11h8M8 14.5h5" />
          </svg>
        </button>
      </div>
      {messages.length > 0 && (
        <div className="chat-log" ref={logRef} role="log" aria-live="polite">
          <div className="chat-history">
            {messages.map((m, i) => {
              // The coach shows its face with its latest answer only.
              const latest = !pending && m.role === "assistant" && i === messages.length - 1;
              return latest ? (
                <div key={m.id} className="coach-row">
                  <CoachFace face={coach?.mood ?? "neutral"} />
                  <div className="bubble bubble-assistant">{m.text}</div>
                </div>
              ) : (
                <div key={m.id} className={`bubble bubble-${m.role}`}>
                  {m.text}
                </div>
              );
            })}
            {pending && (
              <div className="coach-row" role="status">
                <CoachFace face="thinking" />
                <div className="bubble bubble-assistant">{mode === "mock" ? "Thinking…" : "Let me look at your figures…"}</div>
              </div>
            )}
            {!pending && messages.at(-1)?.role === "assistant" && (coach?.suggestions.length ?? 0) > 0 && (
              <div className="coach-next" aria-label="Suggested next steps">
                {coach?.suggestions.map((s) => (
                  <button key={s} type="button" className="chip chip-next" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
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
