import { BrandBar } from "../components/BrandBar";
import { formatBytes, truncatePath } from "../lib/format";
import type { TrashItemResult } from "../types";

interface SummaryScreenProps {
  results: TrashItemResult[];
  bytesMoved: number;
  canContinue?: boolean;
  puttingBack?: boolean;
  putBackError?: string | null;
  onPutBack?: () => void;
  onContinue?: () => void;
  onDone: () => void;
}

export function SummaryScreen({
  results,
  bytesMoved,
  canContinue,
  puttingBack,
  putBackError,
  onPutBack,
  onContinue,
  onDone,
}: SummaryScreenProps) {
  const moved = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const canPutBack = Boolean(onPutBack) && moved.length > 0 && !puttingBack;

  return (
    <section className="screen summary">
      <BrandBar onHome={onDone} />
      <header className="hero compact">
        <p className="eyebrow">Trash</p>
        <h1>{moved.length === 0 ? "Nothing moved" : "Moved to Trash"}</h1>
        <p className="lede">
          {moved.length} {moved.length === 1 ? "file" : "files"} (
          {formatBytes(bytesMoved)}) went to Trash. Put Back restores them to
          where they were.
        </p>
      </header>

      {failed.length > 0 && (
        <div className="panel">
          <h2>Could not move {failed.length}</h2>
          <ul className="queue-list">
            {failed.map((item) => (
              <li key={item.path}>
                <div>
                  <strong>{truncatePath(item.path.split(/[/\\]/).pop() ?? item.path, 40)}</strong>
                  <p className="mono">{item.error ?? "Unknown error"}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {putBackError && <p className="warning">{putBackError}</p>}

      <div className="review-actions">
        {canPutBack && (
          <button
            type="button"
            className="btn ghost"
            disabled={puttingBack}
            onClick={onPutBack}
          >
            {puttingBack ? "Putting back…" : "Put Back"}
          </button>
        )}
        {canContinue && onContinue ? (
          <button type="button" className="btn primary" onClick={onContinue}>
            Continue reviewing
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={onDone}>
            Start over
          </button>
        )}
      </div>
    </section>
  );
}
