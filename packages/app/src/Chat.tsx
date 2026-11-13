import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { id: number; role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "How much did I spend on taxis last month?",
  "What is safe for me to spend this week?",
  "What kind of spender am I?",
  "How much could I save by eating out 20% less?",
];

const GREETING: Message = {
  id: 0,
  role: "assistant",
  text: "Hi! I'm your money coach. Ask me anything about your spending, saving or habits.",
};

// Placeholder until the LLM backend is wired up.
const PLACEHOLDER_REPLY =
  "I can't analyse your data just yet — the coach is still being connected. Your question has been noted!";

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role: "user", text: trimmed },
      { id: nextId.current++, role: "assistant", text: PLACEHOLDER_REPLY },
    ]);
    setInput("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  const hasConversation = messages.length > 1;

  return (
    <section className="chat" aria-label="Chat with your money coach">
      <div className="chat-log" ref={logRef} role="log" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}`}>
            {m.text}
          </div>
        ))}
      </div>

      {!hasConversation && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your money…"
          aria-label="Your question"
        />
        <button type="submit" disabled={!input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
