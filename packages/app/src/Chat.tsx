import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { type Block, type ChatImage, MAX_HISTORY_TURNS, type PhotoRead, type ProtectedCategory, type ReceiptView, type TxFilter } from "@mydata/shared";
import type { ChatMode } from "./agent";
import BlockCard, { displayTitle } from "./BlockCard";
import CoachFace from "./CoachFace";
import {
  answerCards,
  type AskInput,
  type AskResult,
  loadConversation,
  type Message,
  modelHistory,
  patchCard,
  saveConversation,
  savedState,
  withoutCards,
} from "./conversation";
import { apiBase } from "./data";
import { formatEurCents } from "./format";
import { errorMessage } from "./latest";
import { preparePhoto } from "./photo";
import ReceiptCard, { useReceipts } from "./receipts";
import { createVoiceClient } from "./voice/client";
import { useVoice } from "./voice/useVoice";
import { useI18n } from "./i18n";

/** A photo waiting in the input row: what goes to the coach, and the same picture for the screen. */
type Attached = { image: ChatImage; url: string };

/** At most this many receipt photos go at once: each costs a model call and counts against the chat's budget. */
export const MAX_PHOTOS = 6;

/** What was read from a photo, under the picture: the user checks it against what they see. */
function photoReading(photo: PhotoRead, locale: ReturnType<typeof useI18n>["locale"], t: ReturnType<typeof useI18n>["t"]): string {
  if (photo.amount === null) return t("chat.photoNoPrice");
  const price = `${formatEurCents(photo.amount, locale)}${photo.monthly ? t("chat.photoMonthly") : ""}`;
  const item = photo.item ? `${photo.item}, ` : "";
  if (photo.estimated) return t("chat.photoEstimate", { item, price });
  return t("chat.photoPrice", { item, price });
}

/** A user's message: the photo, if there is one, above the words. A photo may be sent without words. */
function UserBubble({ message }: { message: Message }) {
  const { locale, t } = useI18n();
  // A conversation opened again keeps what was read from a photo, not the photo itself.
  const photoOnly = !message.text && !message.photoUrl && !message.photoUrls;
  return (
    <div className="bubble bubble-user">
      {message.photoUrl && <img className="bubble-photo" src={message.photoUrl} alt={t("chat.photoSent")} />}
      {message.photoUrls && (
        <div className="bubble-photos" role="group" aria-label={t("chat.photosSent")}>
          {message.photoUrls.map((url, i) => (
            <img key={i} className="bubble-photo" src={url} alt="" />
          ))}
        </div>
      )}
      {message.text}
      {photoOnly && message.photoCount !== undefined && t("chat.photosCount", { count: message.photoCount })}
      {photoOnly && message.photoCount === undefined && !message.photo && t("chat.photoSent")}
      {message.photo && <span className={photoOnly ? undefined : "bubble-photo-read"}>{photoReading(message.photo, locale, t)}</span>}
    </div>
  );
}

const voiceClient = createVoiceClient(apiBase);

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

/** The card the user chose to ask about next. */
export interface Focus {
  id: string;
  title: string;
}

export interface VoiceControls {
  available: boolean;
  speechEnabled: boolean;
  toggleSpeech: () => void;
}

interface Props {
  /** Answers a question. Resolves to the reply and the cards that go with it. */
  onAsk: (input: AskInput) => Promise<AskResult>;
  /** Whose conversation this is. Another customer opens their own, as it was left. */
  customerId: string;
  /** The demo's fixed "today", ISO date; empty until the customer's data has loaded. */
  today?: string;
  /** Send a question from outside the conversation (e.g. the dev gallery). A new `n` sends again. */
  request?: { text: string; n: number; canned?: boolean } | null;
  /** What answers typed questions: the backend's model, Gemini through the dev server, or keyword rules. */
  mode: ChatMode;
  /** What comes first in the conversation's scroll: the overview's cards, or the dev gallery. */
  header?: ReactNode;
  /** False while the header has the scroll to itself (the dev gallery). */
  showLog?: boolean;
  /** What the user keeps, to show on each card whether it is saved. */
  overview?: Block[];
  /** Saves a card to the overview, or takes it out when it is saved as shown. */
  onSave?: (block: Block) => void;
  onDrill?: (title: string, filter: TxFilter, evidenceNote?: string) => void;
  focus?: Focus | null;
  onFocus?: (focus: Focus | null) => void;
  /** Told when a conversation starts and when it is empty again. */
  onActive?: (active: boolean) => void;
  /** Makes reply narration available from the app's top-bar controls. */
  onVoiceControls?: (controls: VoiceControls | null) => void;
}

const noCards: Block[] = [];

export default function Chat({ onAsk, customerId, today = "", request, mode, header, showLog = true, overview = noCards, onSave, onDrill, focus = null, onFocus, onActive, onVoiceControls }: Props) {
  const { t, category: categoryName } = useI18n();
  // The conversation and the customer it is with are one value, so the messages always belong to that customer.
  const [conv, setConv] = useState(() => ({ customerId, messages: loadConversation(customerId) }));
  const messages = conv.customerId === customerId ? conv.messages : [];
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [showBackToLatest, setShowBackToLatest] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  /** Photos the user has taken and not yet sent: they go out with their next message. Several are receipts. */
  const [attached, setAttached] = useState<Attached[]>([]);
  /** How far reading several receipts has got. */
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const { client: receiptClient, changed: receiptsChanged } = useReceipts();
  // Several photos at once are receipts, read one by one by the backend; that needs it and its model.
  const canBatch = mode === "server" && receiptClient !== null;
  const cameraRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  /** Counts conversation resets, so that a reply can tell whether its conversation is still open. */
  const conversation = useRef(0);
  const pendingRef = useRef(false);
  // Read when a message is sent, which can be from a callback made on an earlier render (voice).
  const live = useRef({ customerId, messages, focus });
  live.current = { customerId, messages, focus };
  const voice = useVoice(voiceClient, (text) => sendOwn(text));
  useEffect(() => {
    onVoiceControls?.({ available: voice.available, speechEnabled: voice.speechEnabled, toggleSpeech: voice.toggleSpeech });
    return () => onVoiceControls?.(null);
  }, [onVoiceControls, voice.available, voice.speechEnabled, voice.toggleSpeech]);
  const starterSuggestions = [
    { label: t("chat.starter.spending"), question: t("chat.starter.spendingQuestion") },
    { label: t("chat.starter.month"), question: t("chat.starter.monthQuestion") },
    { label: t("chat.starter.goal"), question: t("chat.starter.goalQuestion") },
  ];

  /** Changes the conversation with `forCustomer`. Does nothing if another customer's is open by now. */
  const setMessages = (forCustomer: string, next: (prev: Message[]) => Message[]) =>
    setConv((prev) => (prev.customerId === forCustomer ? { customerId: forCustomer, messages: next(prev.messages) } : prev));

  /** Whatever is on its way belongs to the conversation that was open: drop it, and start clean. */
  function startOver() {
    conversation.current++;
    pendingRef.current = false;
    setPending(false);
    setPhotoError(null);
    setAttached([]);
    setBatch(null);
    setShowBackToLatest(false);
    onFocus?.(null);
    voice.reset();
  }

  useEffect(() => {
    startOver();
    setConv((prev) => (prev.customerId === customerId ? prev : { customerId, messages: loadConversation(customerId) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, voice.reset]);
  useEffect(() => {
    saveConversation(conv.customerId, conv.messages);
  }, [conv]);
  const active = messages.length > 0;
  useEffect(() => {
    onActive?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, customerId]);

  // While the coach is thinking, the question and the wait are in view. When the answer is there,
  // the question that led to it moves to the top, so the answer and its cards read from the start.
  const lastId = messages.at(-1)?.id;
  const opened = useRef("");
  useEffect(() => {
    const log = logRef.current;
    if (!log || !showLog) return;
    const reopened = opened.current !== customerId;
    opened.current = customerId;
    const asked = [...log.querySelectorAll<HTMLElement>("[data-asked]")].at(-1);
    if (pending || !asked) {
      if (pending) log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
      return;
    }
    const toQuestion = (behavior: ScrollBehavior) =>
      log.scrollTo({ top: log.scrollTop + asked.getBoundingClientRect().top - log.getBoundingClientRect().top - 8, behavior });
    toQuestion(reopened ? "auto" : "smooth");
    // The answer's cards draw themselves once their figures arrive, and only then is there room to
    // bring the question all the way up. Follow that for a moment, unless the user takes over.
    const history = asked.parentElement;
    if (!history || typeof ResizeObserver === "undefined") return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) first = false;
      else toQuestion(reopened ? "auto" : "smooth");
    });
    observer.observe(history);
    const stop = () => observer.disconnect();
    const timer = window.setTimeout(stop, 2500);
    const taken = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of taken) log.addEventListener(event, stop, { passive: true, once: true });
    return () => {
      stop();
      window.clearTimeout(timer);
      for (const event of taken) log.removeEventListener(event, stop);
    };
  }, [lastId, pending, customerId, showLog]);
  useEffect(() => {
    if (focus) inputRef.current?.focus();
  }, [focus?.id]);

  function updateBackToLatest(log: HTMLDivElement) {
    setShowBackToLatest(log.scrollHeight - log.clientHeight - log.scrollTop > 24);
  }

  function scrollToLatest() {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }

  /** Adds a message to `forCustomer`'s conversation and returns its id. */
  function addTo(forCustomer: string, role: Message["role"], text: string, extra: Omit<Message, "id" | "role" | "text"> = {}) {
    const id = (nextId.current = Math.max(nextId.current, ...live.current.messages.map((m) => m.id + 1)));
    nextId.current++;
    setMessages(forCustomer, (prev) => [...prev, { id, role, text, ...extra }]);
    return id;
  }

  function send(text: string, canned = false, allowProtected?: ProtectedCategory[], photo?: Attached) {
    const trimmed = text.trim();
    // A photo can go without words; the coach then takes it as "can I afford this?".
    if ((!trimmed && !photo) || pendingRef.current) return;
    voice.pause();
    const { customerId: forCustomer, messages: before, focus: about } = live.current;
    const add = (role: Message["role"], text: string, extra: Omit<Message, "id" | "role" | "text"> = {}) => addTo(forCustomer, role, text, extra);
    // A reply that arrives after the conversation was reset belongs to the previous one: drop it.
    const askedIn = conversation.current;
    const current = () => conversation.current === askedIn;
    const askedId = add("user", trimmed, { photoUrl: photo?.url, about: about?.title });
    setInput("");
    onFocus?.(null);
    pendingRef.current = true;
    setPending(true);
    const previous = before.at(-1);
    onAsk({
      question: trimmed,
      canned,
      allowProtected,
      image: photo?.image,
      history: modelHistory(before, MAX_HISTORY_TURNS),
      answers: answerCards(before),
      focusId: about?.id,
      pendingUnprotect: previous?.role === "assistant" ? (previous.proposedUnprotect ?? []) : [],
    })
      .then(
        (reply) => {
          if (!current()) return;
          // What the coach read goes under the photo, where the user can check it against the picture.
          setMessages(forCustomer, (prev) =>
            withoutCards(prev, reply.removed ?? []).map((m) => (m.id === askedId ? { ...m, modelText: reply.userText, ...(reply.photo && { photo: reply.photo }) } : m)),
          );
          add("assistant", reply.text, {
            modelText: reply.modelText,
            question: trimmed,
            blocked: reply.blocked,
            proposedUnprotect: reply.proposedUnprotect,
            overrideUsed: Boolean(allowProtected?.length),
            cards: reply.cards,
            receipt: reply.receipt,
            mood: reply.mood,
            suggestions: reply.suggestions,
          });
          return voice.speak(reply.text);
        },
        (e: unknown) => current() && add("assistant", t("chat.error", { error: errorMessage(e) })),
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

  /** The user's own message, typed or spoken: it takes the waiting photos with it. Chips and buttons do not. */
  function sendOwn(text: string) {
    if ((!text.trim() && attached.length === 0) || pendingRef.current) return;
    if (attached.length > 1) void sendReceipts(text, attached);
    else send(text, false, undefined, attached[0]);
    setAttached([]);
  }

  /**
   * Several photos at once are receipts: each is read, saved and matched by the backend, one after
   * the other, and one reply sums them up. Words sent with them go to the coach afterwards, when the
   * receipts are in its figures.
   */
  async function sendReceipts(text: string, photos: Attached[]) {
    if (!receiptClient || pendingRef.current) return;
    voice.pause();
    const forCustomer = live.current.customerId;
    const askedIn = conversation.current;
    const current = () => conversation.current === askedIn;
    addTo(forCustomer, "user", "", { photoUrls: photos.map((p) => p.url), photoCount: photos.length, modelText: `[${photos.length} RECEIPT PHOTOS sent]` });
    setInput("");
    onFocus?.(null);
    pendingRef.current = true;
    setPending(true);
    setBatch({ done: 0, total: photos.length });
    const saved: ReceiptView[] = [];
    const failed: string[] = [];
    let unread = 0;
    for (const [i, photo] of photos.entries()) {
      try {
        const read = await receiptClient.read(forCustomer, photo.image);
        if (read.receipt) saved.push(read.receipt);
        else unread++;
      } catch (e) {
        failed.push(errorMessage(e));
      }
      if (!current()) return;
      setBatch({ done: i + 1, total: photos.length });
    }
    const linked = saved.filter((r) => r.status === "confirmed").length;
    if (linked) receiptsChanged();
    const summary = [
      saved.length ? t("receipt.batchReply", { saved: saved.length, linked, waiting: saved.length - linked }) : "",
      unread ? t("receipt.batchUnread", { count: unread }) : "",
      failed.length ? t("receipt.batchFailed", { count: failed.length, error: failed[0] }) : "",
    ]
      .filter(Boolean)
      .join(" ");
    addTo(forCustomer, "assistant", summary, {
      modelText: `Saved ${saved.length} receipts: ${linked} linked to their card payments, ${saved.length - linked} not linked yet${unread ? `; ${unread} could not be read` : ""}.`,
      receipts: saved,
    });
    try {
      await voice.speak(summary);
    } finally {
      if (current()) {
        pendingRef.current = false;
        setPending(false);
        setBatch(null);
        voice.resume();
      }
    }
    if (current() && text.trim()) send(text);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    sendOwn(input);
  }

  /**
   * A photo from the camera waits in the input row, so the user can ask what they like about it.
   * With the backend, more photos can be added: several at once are read as receipts.
   */
  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = ""; // so that the same photo can be chosen again
    if (!files.length) return;
    const askedIn = conversation.current;
    setPhotoError(null);
    try {
      const photos = await Promise.all(files.slice(0, MAX_PHOTOS).map((file) => preparePhoto(file)));
      if (conversation.current !== askedIn) return;
      if (!canBatch) return setAttached(photos.slice(0, 1));
      const next = [...attached, ...photos];
      if (next.length > MAX_PHOTOS || files.length > MAX_PHOTOS) setPhotoError(t("chat.photosTooMany", { max: MAX_PHOTOS }));
      setAttached(next.slice(0, MAX_PHOTOS));
    } catch (error) {
      setPhotoError(errorMessage(error));
    }
  }

  const modeNote =
    mode === "mock"
      ? t("chat.modeMock")
      : t("chat.modeBrowser");
  const note = photoError
    ? photoError
    : voice.error
    ? voice.error
    : voice.processing
      ? t("chat.voiceTranscribing")
      : voice.enabled
        ? voice.recording
          ? t("chat.voiceListeningStop")
          : pending
            ? t("chat.voicePaused")
            : t("chat.voiceOn")
      : modeNote;

  const last = messages.at(-1);
  const lastAnswered = !pending && last?.role === "assistant";
  // While the coach's question about the keep-as-is list is open, its own buttons are the next steps.
  const nextSteps = lastAnswered && (last.proposedUnprotect?.length ?? 0) === 0 ? (last.suggestions ?? []) : [];

  return (
    <section className="coach" aria-label={t("chat.label")}>
      <div className="conversation-wrap">
        <div className="conversation" ref={logRef} onScroll={(e) => updateBackToLatest(e.currentTarget)}>
          {header}
          {showLog && messages.length > 0 && (
            <div className="chat-history" role="log" aria-live="polite">
            <button
              type="button"
              className="ghost-btn reset"
              onClick={() => {
                startOver();
                setMessages(customerId, () => []);
              }}
            >
              {t("chat.newConversation")}
            </button>
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              if (m.role === "user") {
                return (
                  <div key={m.id} className="turn turn-user" data-asked>
                    {m.about && <span className="bubble-about">{t("chat.about", { title: m.about })}</span>}
                    <UserBubble message={m} />
                  </div>
                );
              }
              // A comparison, not the length itself: with nothing blocked the length is 0, and React would print that 0.
              const showOverride = isLast && (m.blocked?.length ?? 0) > 0 && !m.overrideUsed && !pending;
              // The coach asked whether to take something off the keep-as-is list: the answer is one tap, or typed.
              const asked = isLast && !pending ? (m.proposedUnprotect ?? []) : [];
              return (
                <div key={m.id} className="turn turn-coach">
                  {/* The coach shows its face with its latest answer only. */}
                  {isLast && !pending ? (
                    <div className="coach-row">
                      <CoachFace face={m.mood ?? "neutral"} />
                      <div className="bubble bubble-assistant">{m.text}</div>
                    </div>
                  ) : (
                    <div className="bubble bubble-assistant">{m.text}</div>
                  )}
                  {/* A receipt the answer saved: what was read, and which payment it belongs to. */}
                  {m.receipt && (
                    <ReceiptCard
                      receipt={m.receipt}
                      customerId={customerId}
                      today={today}
                      onChange={(next) => setMessages(customerId, (prev) => prev.map((x) => (x.id === m.id ? (next ? { ...x, receipt: next } : { ...x, receipt: undefined }) : x)))}
                    />
                  )}
                  {/* Receipts sent several at once: one card each. */}
                  {m.receipts?.map((r) => (
                    <ReceiptCard
                      key={r.id}
                      receipt={r}
                      customerId={customerId}
                      today={today}
                      onChange={(next) =>
                        setMessages(customerId, (prev) =>
                          prev.map((x) => (x.id === m.id ? { ...x, receipts: (x.receipts ?? []).flatMap((old) => (old.id !== r.id ? [old] : next ? [next] : [])) } : x)),
                        )
                      }
                    />
                  ))}
                  {/* What the answer is about, right under it: the card is this answer's own copy. */}
                  {m.cards?.map((card) => (
                    <BlockCard
                      key={card.id}
                      variant="answer"
                      block={card}
                      customerId={customerId}
                      today={today}
                      onChange={(patch) => setMessages(customerId, (prev) => patchCard(prev, m.id, card.id, patch))}
                      onDrill={(title, filter, evidenceNote) => onDrill?.(title, filter, evidenceNote)}
                      onSave={onSave && (() => onSave(card))}
                      saved={savedState(overview, card)}
                      onAsk={onFocus && (() => onFocus({ id: card.id, title: displayTitle(card, t) }))}
                    />
                  ))}
                  {(asked.length > 0 || showOverride) && (
                    <div className="bubble-actions">
                      {asked.map((category) => (
                        <button key={category} type="button" className="chip chip-next" onClick={() => send(t("chat.unprotectYesMessage", { category: categoryName(category) }))}>
                          {t("chat.unprotectYes", { category: categoryName(category) })}
                        </button>
                      ))}
                      {asked.length > 0 && (
                        <button type="button" className="chip chip-next" onClick={() => send(t("chat.unprotectNoMessage", { category: asked.map(categoryName).join(", ") }))}>
                          {t("chat.unprotectNo")}
                        </button>
                      )}
                      {showOverride && <button type="button" className="chip chip-next" onClick={() => send(m.question ?? "", false, m.blocked)}>{t("chat.showAnyway")}</button>}
                    </div>
                  )}
                </div>
              );
            })}
            {pending && (
              <div className="coach-row" role="status">
                <CoachFace face="thinking" />
                <div className="bubble bubble-assistant">
                  {mode === "mock" ? t("chat.thinking") : batch ? t("chat.readingReceipts", batch) : last?.photoUrl ? t("chat.readingPhoto") : t("chat.looking")}
                </div>
              </div>
            )}
            {nextSteps.length > 0 && (
              <ChipRow className="coach-next" label={t("chat.suggestedSteps")}>
                {nextSteps.map((s) => (
                  <button key={s} type="button" className="chip chip-next" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </ChipRow>
            )}
              </div>
          )}
        </div>
        {showLog && showBackToLatest && (
          <button className="chat-back-to-latest" type="button" onClick={scrollToLatest} aria-label={t("chat.backToLatest")} title={t("chat.backToLatest")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      <div className="composer">
        {/* Starter prompts only: they go away once the conversation has begun. */}
        {messages.length === 0 && (
          <details className="suggestions-panel" open>
            <summary>{t("chat.suggestedTitle")}</summary>
            <ChipRow className="suggestions" label={t("chat.suggestedQuestions")}>
              {starterSuggestions.map((suggestion) => (
                <button key={suggestion.question} type="button" className="chip" onClick={() => send(suggestion.question, true)} disabled={pending}>
                  {suggestion.label}
                </button>
              ))}
            </ChipRow>
          </details>
        )}

        {focus && (
          <div className="chat-about">
            <span>{t("chat.about", { title: focus.title })}</span>
            <button type="button" onClick={() => onFocus?.(null)} aria-label={t("chat.aboutClear")} title={t("chat.aboutClear")}>
              ×
            </button>
          </div>
        )}
        {attached.length > 1 && (
          <div className="chat-attached">
            <div className="chat-attached-photos">
              {attached.map((photo, i) => (
                <div key={photo.url} className="chat-attached-photo">
                  <img src={photo.url} alt={t("chat.photoPending")} />
                  <button type="button" onClick={() => setAttached((prev) => prev.filter((_, j) => j !== i))} aria-label={t("chat.photoRemove")} title={t("chat.photoRemove")}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <span>{t("chat.photosAttached", { count: attached.length })}</span>
          </div>
        )}
        {attached.length === 1 && (
          <div className="chat-attached">
            <img src={attached[0].url} alt={t("chat.photoPending")} />
            <span>{t("chat.photoAdd")}</span>
            <button type="button" onClick={() => setAttached([])} aria-label={t("chat.photoRemove")} title={t("chat.photoRemove")}>
              ×
            </button>
          </div>
        )}
        <form className="chat-input" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={attached.length ? t("chat.photoPlaceholder") : focus ? t("chat.aboutPlaceholder") : t("chat.placeholder")}
            aria-label={t("chat.question")}
          />
          {mode !== "mock" && (
            <>
              {/* capture opens the phone's camera directly; a computer shows its file picker instead. */}
              {/* With the backend several photos can be picked at once (receipts); without, the camera opens directly. */}
              <input ref={cameraRef} type="file" accept="image/*" hidden onChange={onPhoto} {...(canBatch ? { multiple: true } : { capture: "environment" })} />
              <button
                type="button"
                className={`voice-btn${attached.length ? " on" : ""}`}
                onClick={() => cameraRef.current?.click()}
                aria-label={attached.length && !canBatch ? t("chat.photoRetake") : t("chat.photoAdd")}
                title={attached.length && !canBatch ? t("chat.photoRetake") : t("chat.photoAddTitle")}
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
              aria-label={voice.enabled ? t("chat.voiceStop") : t("chat.voiceEnable")}
              title={voice.enabled ? t("chat.voiceStop") : t("chat.voiceEnable")}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
              </svg>
            </button>
          )}
          <button type="submit" disabled={(!input.trim() && attached.length === 0) || pending}>
            {t("chat.ask")}
          </button>
        </form>
        <p className="chat-note" role={photoError || voice.error ? "alert" : undefined}>
          {note}
        </p>
      </div>
    </section>
  );
}
