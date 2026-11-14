import type { Mood } from "@mydata/shared";
import { useI18n } from "./i18n";

/** The coach as it appears in the chat: a 20 euro note with a face that follows what it says. */
export type Face = Mood | "thinking";

const LABELS: Record<Face, "coach.face.happy" | "coach.face.proud" | "coach.face.concerned" | "coach.face.neutral" | "coach.face.thinking"> = {
  happy: "coach.face.happy",
  proud: "coach.face.proud",
  concerned: "coach.face.concerned",
  neutral: "coach.face.neutral",
  thinking: "coach.face.thinking",
};

const INK = "#0b2a4a";

function Eyes({ face }: { face: Face }) {
  // Proud: eyes closed in a smile. Thinking: looking up.
  if (face === "proud") {
    return (
      <g fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round">
        <path d="M15.5 12.5 q2 -2.4 4 0" />
        <path d="M24.5 12.5 q2 -2.4 4 0" />
      </g>
    );
  }
  const y = face === "thinking" ? 10.6 : 12;
  return (
    <g fill={INK}>
      <circle cx="17.5" cy={y} r="1.5" />
      <circle cx="26.5" cy={y} r="1.5" />
      {face === "concerned" && (
        <g fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round">
          <path d="M15 9.2 l4 -1.2" />
          <path d="M29 9.2 l-4 -1.2" />
        </g>
      )}
    </g>
  );
}

const MOUTHS: Record<Face, string> = {
  happy: "M17.5 16.2 q4.5 4 9 0",
  proud: "M16.5 16 q5.5 5 11 0",
  concerned: "M18 18.4 q4 -2.6 8 0",
  neutral: "M18.5 17.2 q3.5 1.4 7 0",
  thinking: "M20.5 17.6 h3",
};

export default function CoachFace({ face }: { face: Face }) {
  const { t } = useI18n();
  return (
    <svg className={`coach-face coach-${face}`} viewBox="0 0 44 28" role="img" aria-label={t(LABELS[face])}>
      <rect x="1" y="1" width="42" height="26" rx="5" fill="#cfe4f7" stroke="#3f7fbf" strokeWidth="1.5" />
      <text x="5" y="10" fontSize="7" fontWeight="700" fill="#2f6aa8">
        20
      </text>
      <text x="39" y="24" fontSize="7" fontWeight="700" fill="#2f6aa8" textAnchor="end">
        €
      </text>
      <Eyes face={face} />
      <path d={MOUTHS[face]} fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
