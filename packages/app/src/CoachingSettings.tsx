import { COACHING_STYLES, SPENDING_CATEGORIES, type CoachingProfile, type ProfileUpdate, type ProtectedCategory } from "@mydata/shared";
import { useState } from "react";

const EVERYDAY: readonly ProtectedCategory[] = ["Restaurants", "Entertainment", "Lifestyle", "Travel", "Home & Tech", "Transportation"];
const ESSENTIALS: readonly ProtectedCategory[] = ["Housing", "Utilities", "Groceries", "Health"];
const labels = {
  encouraging: "Warm and steady",
  direct: "Short and plain",
  exploratory: "Curious and open",
} as const;

interface Props {
  profile: CoachingProfile;
  onboarding?: boolean;
  onSave(update: ProfileUpdate): Promise<void>;
  onSkip(): void;
  onClose(): void;
}

export default function CoachingSettings({ profile, onboarding = false, onSave, onSkip, onClose }: Props) {
  const [step, setStep] = useState(1);
  const [style, setStyle] = useState(profile.style);
  const [selected, setSelected] = useState(() => new Set(profile.protectedCategories));
  const [essentials, setEssentials] = useState(false);
  const [confirm, setConfirm] = useState<ProtectedCategory | null>(null);
  const [saving, setSaving] = useState(false);
  const toggle = (category: ProtectedCategory) => {
    if (selected.has(category) && profile.protectedCategories.includes(category)) return setConfirm(category);
    setSelected((old) => {
      const next = new Set(old);
      next.has(category) ? next.delete(category) : next.add(category);
      return next;
    });
  };
  const save = async () => {
    const add = SPENDING_CATEGORIES.filter((category) => selected.has(category) && !profile.protectedCategories.includes(category));
    const remove = profile.protectedCategories.filter((category) => !selected.has(category));
    const update: ProfileUpdate = {
      ...(style !== profile.style && { style }),
      ...((add.length || remove.length) && { protect: { ...(add.length && { add }), ...(remove.length && { remove }) } }),
    };
    if (!Object.keys(update).length) return onSkip();
    setSaving(true);
    try {
      await onSave(update);
      onClose();
    } finally {
      setSaving(false);
    }
  };
  const chips = (categories: readonly ProtectedCategory[]) => categories.map((category) => (
    <button key={category} type="button" className={`chip${selected.has(category) ? " selected" : ""}`} onClick={() => toggle(category)}>
      {category === "Home & Tech" ? "Home & Tech (small purchases)" : category}
    </button>
  ));
  return (
    <div className="coaching-sheet" role="dialog" aria-modal="true" aria-label="Coaching settings">
      <div className="coaching-card">
        <div className="coaching-heading"><h2>{onboarding ? "Set up your coach" : "Coaching settings"}</h2><button type="button" className="ghost-btn" onClick={onClose}>Close</button></div>
        {step === 1 ? <><p>How should I coach you?</p><div className="style-options">{COACHING_STYLES.map((value) => <button key={value} type="button" className={style === value ? "style-choice selected" : "style-choice"} onClick={() => setStyle(value)}><strong>{value}</strong><span>{labels[value]}</span></button>)}</div><div className="coaching-actions"><button type="button" className="ghost-btn" onClick={onSkip}>Skip</button><button type="button" onClick={() => setStep(2)}>Next</button></div></> : <><p>Anything you would rather not cut?</p><div className="chip-row">{chips(EVERYDAY)}</div><button type="button" className="essentials-toggle" onClick={() => setEssentials(!essentials)}>Essentials {essentials ? "−" : "+"}</button>{essentials && <><p className="muted small">Savings ideas already skip these. Tap to also protect them from what-if questions.</p><div className="chip-row">{chips(ESSENTIALS)}</div></>}<div className="coaching-actions"><button type="button" className="ghost-btn" onClick={onSkip}>Skip</button><button type="button" onClick={() => setStep(1)}>Back</button><button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</button></div></>}
        {confirm && <div className="inline-confirm"><span>Stop keeping {confirm} as is?</span><button type="button" onClick={() => { setSelected((old) => { const next = new Set(old); next.delete(confirm); return next; }); setConfirm(null); }}>Stop keeping it</button><button type="button" className="ghost-btn" onClick={() => setConfirm(null)}>Keep it</button></div>}
      </div>
    </div>
  );
}
