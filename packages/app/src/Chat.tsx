import { type FormEvent, useEffect, useRef, useState } from "react";
import { DEMO_PROMPTS } from "./agent/mockAgent";
import { errorMessage } from "./latest";

type Message = { id: number; role: "user" | "assistant"; text: string };

/** A few of each kind, so the chips show templates, custom charts and widgets. */
const SUGGESTIONS = [
  ...DEMO_PROMPTS[0].prompts.slice(0, 4),
  ...DEMO_PROMPTS[1].prompts.slice(0, 2),
  ...DEMO_PROMPTS[2].prompts,
  ...DEMO_PROMPTS[0].prompts.slice(4, 6),
];

interface Props {
  /** Resolves to the assistant's reply text; dashboard edits happen as a side effect. */
  onAsk: (question: string, canned?: boolean) => Promise<string>;
  /** Changing this resets the conversation (e.g. when switching customer). */
  resetKey: string;
  /** Send a question from outside the chat (e.g. the dev gallery). A new `n` sends again. */
  request?: { text: string; n: number } | null;
}

export default function Chat({ onAsk, resetKey, request }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  /** Counts conversation resets, so that a reply can tell whether its conversation is still open. */
  const conversation = useRef(0);

  useEffect(() => {
    conversation.current++;
    setMessages([]);
    setPending(false);
  }, [resetKey]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function send(text: string, canned = false) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const add = (role: Message["role"], text: string) => {
      const id = nextId.current++;
      setMessages((prev) => [...prev, { id, role, text }]);
    };
    // A reply that arrives after the conversation was reset belongs to the previous customer: drop it.
    const askedIn = conversation.current;
    const current = () => conversation.current === askedIn;
    add("user", trimmed);
    setInput("");
    setPending(true);
    onAsk(trimmed, canned)
      .then(
        (reply) => current() && add("assistant", reply),
        (e: unknown) => current() && add("assistant", `I couldn't answer that: ${errorMessage(e)} Please ask again.`),
      )
      .finally(() => current() && setPending(false));
  }

  useEffect(() => {
    if (request) send(request.text, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

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
              Thinking…
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
        <button type="submit" disabled={!input.trim() || pending}>
          Ask
        </button>
      </form>
      <p className="chat-note">Demo coach: keyword-based until the AI model is connected.</p>
    </section>
  );
}
