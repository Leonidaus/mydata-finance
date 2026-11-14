import { useI18n } from "./i18n";

/** A failed load with a way to try it again. */
export default function LoadError({ error, retry }: { error: string; retry: () => void }) {
  const { t } = useI18n();
  return (
    <p className="block-error load-error" role="alert">
      <span>{error}</span>
      <button type="button" className="ghost-btn" onClick={retry}>
        {t("error.retry")}
      </button>
    </p>
  );
}
