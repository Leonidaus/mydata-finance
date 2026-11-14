import { type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { DEMO_PROMPTS } from "./agent/mockAgent";
import type { ChatImage, Mood, PhotoRead, ProtectedCategory } from "@mydata/shared";
import type { ChatMode } from "./agent";
import CoachFace from "./CoachFace";
import { apiBase } from "./data";
import { formatEurCents } from "./format";
import { errorMessage } from "./latest";
import { preparePhoto } from "./photo";
import { createVoiceClient } from "./voice/client";
import { useVoice } from "./voice/useVoice";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  question?: string;
  blocked?: ProtectedCategory[];
  overrideUsed?: boolean;
  /** Categories this answer asked about taking off the keep-as-is list. */
  proposedUnprotect?: ProtectedCategory[];
  /** A photo sent with the message, as a data URL, and what the coach read from it once it has answered. */
  photoUrl?: string;
  photo?: PhotoRead;
};

/** A photo waiting in the input row: what goes to the coach, and the same picture for the screen. */
type Attached = { image: ChatImage; url: string };

/** What was read from a photo, under the picture: the user checks it against what they see. */
function photoReading(photo: PhotoRead): string {
  if (photo.amount === null) return "No price found in the photo";
  const price = `${formatEurCents(photo.amount)}${photo.monthly ? " a month" : ""}`;
  return `Read from the photo: ${photo.item ? `${photo.item}, ` : ""}${price}`;
}

/** A user's message: the photo, if there is one, above the words. A photo may be sent without words. */
function UserBubble({ message }: { message: Message }) {
  return (
    <div className="bubble bubble-user">
      {message.photoUrl && <img className="bubble-photo" src={message.photoUrl} alt="The photo you sent" />}
      {message.text}
      {message.photo && <span className="bubble-photo-read">{photoReading(message.photo)}</span>}
    </div>
  );
}

/** A few of each kind, so the chips show templates, custom charts and widgets. */
const SUGGESTIONS = [
  ...DEMO_PROMPTS[0].prompts.slice(0, 4),
  ...DEMO_PROMPTS[1].prompts.slice(0, 2),
  ...DEMO_PROMPTS[2].prompts,
  ...DEMO_PROMPTS[0].prompts.slice(4, 6),
];

const voiceClient = createVoiceClient(apiBase);
const MIN_CHAT_HEIGHT = 320;
const MIN_CHAT_VIEWPORT = 0.45;

function minimumChatHeight() {
  return Math.min(MIN_CHAT_HEIGHT, window.innerHeight * MIN_CHAT_VIEWPORT);
}

/**
 * A single row of chips that scrolls sideways. Touch swipes it natively; a mouse wheel only
 * scrolls up and down, so here the wheel moves the row sideways while it has room to move.
 */
function ChipRow({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const onWheel = (e: WheelEvent) => {
      // Trackpads and shift+wheel already scroll sideways.
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 0) return;
      const to = Math.max(0, Math.min(max, row.scrollLeft + e.deltaY));
      if (to === row.scrollLeft) return; // at the end: let the conversation scroll
      e.preventDefault();
      row.scrollLeft = to;
    };
    // Not React's onWheel: that listener is passive and cannot stop the conversation scrolling.
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div ref={ref} className={className} role="group" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** How the coach looked and what it offered next in its latest answer. */
export interface CoachState {
  mood: Mood | null;
  suggestions: string[];
}

interface Props {
  /** Resolves to the assistant's reply text; dashboard edits happen as a side effect. */
  onAsk: (
    question: string,
    canned?: boolean,
    allowProtected?: ProtectedCategory[],
    /** A photo sent with the message. The question may then be empty. */
    image?: ChatImage,
  ) => Promise<{ text: string; blocked?: ProtectedCategory[]; proposedUnprotect?: ProtectedCategory[]; photo?: PhotoRead }>;
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
  const [photoError, setPhotoError] = useState<string | null>(null);
  /** A photo the user has taken and not yet sent: it goes out with their next message. */
  const [attached, setAttached] = useState<Attached | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const resizeStart = useRef<{ y: number; height: number } | null>(null);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  /** Counts conversation resets, so that a reply can tell whether its conversation is still open. */
  const conversation = useRef(0);
  const pendingRef = useRef(false);
  const voice = useVoice(voiceClient, (text) => sendOwn(text));

  useEffect(() => {
    conversation.current++;
    pendingRef.current = false;
    setMessages([]);
    setPending(false);
    setPhotoError(null);
    setAttached(null);
    voice.reset();
  }, [resetKey, voice.reset]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "auto" });
  }, [chatHeight]);

  function send(text: string, canned = false, allowProtected?: ProtectedCategory[], photo?: Attached) {
    const trimmed = text.trim();
    // A photo can go without words; the coach then takes it as "can I afford this?".
    if ((!trimmed && !photo) || pendingRef.current) return;
    voice.pause();
    const add = (role: Message["role"], text: string, extra: Omit<Message, "id" | "role" | "text"> = {}) => {
      const id = nextId.current++;
      setMessages((prev) => [...prev, { id, role, text, ...extra }]);
      return id;
    };
    // A reply that arrives after the conversation was reset belongs to the previous customer: drop it.
    const askedIn = conversation.current;
    const current = () => conversation.current === askedIn;
    const askedId = add("user", trimmed, { photoUrl: photo?.url });
    setInput("");
    pendingRef.current = true;
    setPending(true);
    onAsk(trimmed, canned, allowProtected, photo?.image)
      .then(
        ({ text: reply, blocked, proposedUnprotect, photo: read }) => {
          if (!current()) return;
          // What the coach read goes under the photo, where the user can check it against the picture.
          if (read) setMessages((prev) => prev.map((m) => (m.id === askedId ? { ...m, photo: read } : m)));
          add("assistant", reply, { question: trimmed, blocked, proposedUnprotect, overrideUsed: Boolean(allowProtected?.length) });
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

  /** The user's own message, typed or spoken: it takes the waiting photo with it. Chips and buttons do not. */
  function sendOwn(text: string) {
    if ((!text.trim() && !attached) || pendingRef.current) return;
    send(text, false, undefined, attached ?? undefined);
    setAttached(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    sendOwn(input);
  }

  /** A photo from the camera waits in the input row, so the user can ask what they like about it. */
  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so that the same photo can be chosen again
    if (!file) return;
    const askedIn = conversation.current;
    setPhotoError(null);
    try {
      const photo = await preparePhoto(file);
      if (conversation.current === askedIn) setAttached(photo);
    } catch (error) {
      setPhotoError(errorMessage(error));
    }
  }

  const modeNote =
    mode === "mock"
      ? "Demo coach: keyword-based. Set GEMINI_API_KEY (in .env for the backend, or packages/app/.env.local for dev mode) to use Gemini."
      : "Typed questions go to Gemini. It sees totals worked out from your account, never single transactions. Chips are instant keyword answers.";
  const note = photoError
    ? photoError
    : voice.error
    ? voice.error
    : voice.processing
      ? "Transcribing your question…"
      : voice.enabled
        ? voice.recording
          ? "Listening… Turn off voice when you're ready to send."
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
    const minHeight = minimumChatHeight();
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
              const minHeight = minimumChatHeight();
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
              // A comparison, not the length itself: with nothing blocked the length is 0, and React would print that 0.
              const showOverride = m.role === "assistant" && i === messages.length - 1 && (m.blocked?.length ?? 0) > 0 && !m.overrideUsed && !pending;
              // The coach asked whether to take something off the keep-as-is list: the answer is one tap, or typed.
              const asked = m.role === "assistant" && i === messages.length - 1 && !pending ? (m.proposedUnprotect ?? []) : [];
              const actions = (asked.length > 0 || showOverride) && (
                <div className="bubble-actions">
                  {asked.map((category) => (
                    <button key={category} type="button" className="chip chip-next" onClick={() => send(`Yes, take ${category} off my keep-as-is list.`)}>
                      Yes, stop keeping {category} as is
                    </button>
                  ))}
                  {asked.length > 0 && (
                    <button type="button" className="chip chip-next" onClick={() => send(`No, keep ${asked.join(" and ")} as it is.`)}>
                      No, keep it
                    </button>
                  )}
                  {showOverride && <button type="button" className="chip chip-next" onClick={() => send(m.question ?? "", false, m.blocked)}>Show it anyway</button>}
                </div>
              );
              return latest ? (
                <div key={m.id} className="coach-row">
                  <CoachFace face={coach?.mood ?? "neutral"} />
                  <div>
                    <div className="bubble bubble-assistant">{m.text}</div>
                    {actions}
                  </div>
                </div>
              ) : (
                <div key={m.id}>
                  {m.role === "user" ? <UserBubble message={m} /> : <div className="bubble bubble-assistant">{m.text}</div>}
                  {actions}
                </div>
              );
            })}
            {pending && (
              <div className="coach-row" role="status">
                <CoachFace face="thinking" />
                <div className="bubble bubble-assistant">
                  {mode === "mock" ? "Thinking…" : messages.at(-1)?.photoUrl ? "Reading your photo…" : "Let me look at your figures…"}
                </div>
              </div>
            )}
            {/* While the coach's question about the keep-as-is list is open, its own buttons are the next steps. */}
            {!pending && messages.at(-1)?.role === "assistant" && (messages.at(-1)?.proposedUnprotect?.length ?? 0) === 0 && (coach?.suggestions.length ?? 0) > 0 && (
              <ChipRow className="coach-next" label="Suggested next steps">
                {coach?.suggestions.map((s) => (
                  <button key={s} type="button" className="chip chip-next" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </ChipRow>
            )}
          </div>
        </div>
      )}
      {/* Starter prompts only: they go away once the conversation has begun. */}
      {messages.length === 0 && (
        <details className="suggestions-panel" open>
          <summary>Suggested questions</summary>
          <ChipRow className="suggestions" label="Suggested questions (answered instantly)">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => send(s, true)} disabled={pending}>
                {s}
              </button>
            ))}
          </ChipRow>
        </details>
      )}

      {attached && (
        <div className="chat-attached">
          <img src={attached.url} alt="The photo you are about to send" />
          <span>Ask anything about it, or send it as it is to check whether you can afford it.</span>
          <button type="button" onClick={() => setAttached(null)} aria-label="Remove the photo" title="Remove the photo">
            ×
          </button>
        </div>
      )}
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={attached ? "Ask about the photo…" : "Ask about your money…"}
          aria-label="Your question"
        />
        {mode !== "mock" && (
          <>
            {/* capture opens the phone's camera directly; a computer shows its file picker instead. */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
            <button
              type="button"
              className={`voice-btn${attached ? " on" : ""}`}
              onClick={() => cameraRef.current?.click()}
              aria-label={attached ? "Take another photo instead" : "Add a photo of a price, a bill or a listing to your message"}
              title={attached ? "Take another photo instead" : "Add a photo to your message"}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
                <circle cx="12" cy="13.5" r="3.5" />
              </svg>
            </button>
          </>
        )}
        {voice.available && (
          <button
            type="button"
            className={`voice-btn${voice.enabled ? " on" : ""}`}
            onClick={voice.toggle}
            aria-pressed={voice.enabled}
            aria-label={voice.enabled ? "Stop recording and transcribe" : "Activate voice prompt"}
            title={voice.enabled ? "Stop recording and transcribe" : "Activate voice prompt"}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
            </svg>
          </button>
        )}
        <button type="submit" disabled={(!input.trim() && !attached) || pending}>
          Ask
        </button>
      </form>
      <p className="chat-note" role={photoError || voice.error ? "alert" : undefined}>
        {note}
      </p>
    </section>
  );
}
