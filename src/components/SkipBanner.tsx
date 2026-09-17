import { skipReasonLabel } from "../lib/protect";
import { truncatePath } from "../lib/format";
import type { SkipSummary } from "../types";

interface SkipBannerProps {
  summary: SkipSummary | null;
  onSeeWhy: () => void;
}

export function SkipBanner({ summary, onSeeWhy }: SkipBannerProps) {
  if (!summary || summary.total <= 0) return null;
  const n = summary.total.toLocaleString();
  return (
    <p className="skip-banner">
      {n} {summary.total === 1 ? "file" : "files"} skipped (protected locations).{" "}
      <button type="button" className="text-link" onClick={onSeeWhy}>
        See why
      </button>
    </p>
  );
}

export function SkipList({ summary }: { summary: SkipSummary }) {
  return (
    <>
      {summary.broadRuleWarning && (
        <p className="warning">
          A custom rule may be too broad. Most files in this folder were skipped.
          Check your protected folders and name or extension rules.
        </p>
      )}
      {summary.entries.length === 0 ? (
        <p className="hint">No skip details were recorded.</p>
      ) : (
        <ul className="queue-list skip-list">
          {summary.entries.map((entry) => (
            <li key={`${entry.reason}-${entry.path}`}>
              <div>
                <strong>{skipReasonLabel(entry.reason)}</strong>
                <p className="mono">{truncatePath(entry.path, 72)}</p>
                {entry.detail && <p className="hint">{entry.detail}</p>}
              </div>
              <span className="mono size">{entry.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
