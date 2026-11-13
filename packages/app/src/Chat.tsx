import { type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "./latest";

type Message = { id: number; role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "How much did I spend on taxis last month?",
  "What is safe for me to spend this week?",
  "What kind of spender am I?",
  "What if I cut eating out by 20%?",
  "Show my bills",
  "How am I doing on my savings goal?",
];

interface Props {
  /** Resolves to the assistant's reply text; dashboard edits happen as a side effect. */
  onAsk: (question: string) => Promise<string>;
  /** Changing this resets the conversation (e.g. when switching customer). */
  resetKey: string;
}

export default function Chat({ onAsk, resetKey }: Props) {
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

  function send(text: string) {
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
    onAsk(trimmed)
      .then(
        (reply) => current() && add("assistant", reply),
        (e: unknown) => current() && add("assistant", `I couldn't answer that: ${errorMessage(e)} Please ask again.`),
      )
      .finally(() => current() && setPending(false));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <section className="chat" aria-label="Chat with your money coach">
      {messages.length > 0 ? (
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
      ) : (
        <div className="suggestions" aria-label="Suggested questions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

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
