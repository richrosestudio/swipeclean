import { formatBytes } from "../lib/format";

interface StatsBarProps {
  reviewed: number;
  total: number;
  kept: number;
  queued: number;
  queuedBytes: number;
  onReview?: () => void;
}

export function StatsBar({
  reviewed,
  total,
  kept,
  queued,
  queuedBytes,
  onReview,
}: StatsBarProps) {
  const canReview = Boolean(onReview) && queued > 0;
  return (
    <div className="stats-bar">
      <Stat label="Reviewed" value={`${reviewed} / ${total}`} />
      <Stat label="Kept" value={String(kept)} />
      <Stat
        label="Queued"
        value={String(queued)}
        accent="delete"
        onClick={canReview ? onReview : undefined}
      />
      <Stat
        label="Space saved"
        value={formatBytes(queuedBytes)}
        accent="keep"
        onClick={canReview ? onReview : undefined}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  accent?: "keep" | "delete";
  onClick?: () => void;
}) {
  const className = `stat ${accent ?? ""} ${onClick ? "action" : ""}`;
  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={`Review queued files, ${label} ${value}`}
      >
        <span className="stat-label">{label}</span>
        <span className="stat-value mono">{value}</span>
      </button>
    );
  }
  return (
    <div className={className}>
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{value}</span>
    </div>
  );
}
