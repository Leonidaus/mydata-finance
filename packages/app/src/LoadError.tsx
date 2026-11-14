/** A failed load with a way to try it again. */
export default function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <p className="block-error load-error" role="alert">
      <span>{error}</span>
      <button type="button" className="ghost-btn" onClick={retry}>
        Try again
      </button>
    </p>
  );
}
