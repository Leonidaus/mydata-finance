import { COACHING_STYLES, SPENDING_CATEGORIES, type CoachingProfile, type ProfileUpdate, type ProtectedCategory } from "@mydata/shared";
import { useState } from "react";
import { useI18n } from "./i18n";

const EVERYDAY: readonly ProtectedCategory[] = ["Restaurants", "Entertainment", "Lifestyle", "Travel", "Home & Tech", "Transportation"];
const ESSENTIALS: readonly ProtectedCategory[] = ["Housing", "Utilities", "Groceries", "Health"];
interface Props {
  profile: CoachingProfile;
  onboarding?: boolean;
  onSave(update: ProfileUpdate): Promise<void>;
  onSkip(): void;
  onClose(): void;
}

export default function CoachingSettings({ profile, onboarding = false, onSave, onSkip, onClose }: Props) {
  const { category, t } = useI18n();
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
  const chips = (categories: readonly ProtectedCategory[]) => categories.map((item) => (
    <button key={item} type="button" className={`chip${selected.has(item) ? " selected" : ""}`} onClick={() => toggle(item)}>
      {category(item)}
    </button>
  ));
  return (
    <div className="coaching-sheet" role="dialog" aria-modal="true" aria-label={t("coach.settings")}>
      <div className="coaching-card">
        <div className="coaching-heading"><h2>{onboarding ? t("coach.setup") : t("coach.settings")}</h2><button type="button" className="ghost-btn" onClick={onClose}>{t("drawer.close")}</button></div>
        {step === 1 ? <><p>{t("coach.how")}</p><div className="style-options">{COACHING_STYLES.map((value) => <button key={value} type="button" className={style === value ? "style-choice selected" : "style-choice"} onClick={() => setStyle(value)}><strong>{value}</strong><span>{t(`coach.style.${value}`)}</span></button>)}</div><div className="coaching-actions"><button type="button" className="ghost-btn" onClick={onSkip}>{t("coach.skip")}</button><button type="button" onClick={() => setStep(2)}>{t("coach.next")}</button></div></> : <><p>{t("coach.protect")}</p><div className="chip-row">{chips(EVERYDAY)}</div><button type="button" className="essentials-toggle" onClick={() => setEssentials(!essentials)}>{t("coach.essentials", { symbol: essentials ? "−" : "+" })}</button>{essentials && <><p className="muted small">{t("coach.essentialHelp")}</p><div className="chip-row">{chips(ESSENTIALS)}</div></>}<div className="coaching-actions"><button type="button" className="ghost-btn" onClick={onSkip}>{t("coach.skip")}</button><button type="button" onClick={() => setStep(1)}>{t("coach.back")}</button><button type="button" onClick={() => void save()} disabled={saving}>{saving ? t("coach.saving") : t("coach.save")}</button></div></>}
        {confirm && <div className="inline-confirm"><span>{t("coach.stopKeeping", { category: category(confirm) })}</span><button type="button" onClick={() => { setSelected((old) => { const next = new Set(old); next.delete(confirm); return next; }); setConfirm(null); }}>{t("coach.stopKeepingAction")}</button><button type="button" className="ghost-btn" onClick={() => setConfirm(null)}>{t("coach.keep")}</button></div>}
      </div>
    </div>
  );
}
