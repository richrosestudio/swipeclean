import { useState } from "react";
import { BrandBar } from "../components/BrandBar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatsBar } from "../components/StatsBar";
import { formatBytes, truncatePath } from "../lib/format";
import type { ScannedFile, TrashItemResult } from "../types";

interface ReviewScreenProps {
  queued: ScannedFile[];
  remaining: number;
  reviewed: number;
  total: number;
  kept: number;
  queuedBytes: number;
  backLabel?: string;
  failedTrash?: TrashItemResult[];
  onUnqueue: (path: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  onHome: () => void;
}

export function ReviewScreen({
  queued,
  remaining,
  reviewed,
  total,
  kept,
  queuedBytes,
  backLabel = "Back",
  failedTrash = [],
  onUnqueue,
  onBack,
  onConfirm,
  onHome,
}: ReviewScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const failedByPath = new Map(failedTrash.map((item) => [item.path, item.error]));

  return (
    <section className="screen review">
      <BrandBar onHome={onHome} />
      <StatsBar
        reviewed={reviewed}
        total={total}
        kept={kept}
        queued={queued.length}
        queuedBytes={queuedBytes}
      />
      <header className="hero compact">
        <p className="eyebrow">Review</p>
        <h1>Queued for Trash</h1>
        <p className="lede">
          {queued.length === 0
            ? "Nothing is queued. Everything you reviewed will be kept."
            : "You can move these to Trash anytime. Unreviewed files are left alone."}
        </p>
      </header>

      {remaining > 0 && (
        <p className="hint center">
          {remaining} {remaining === 1 ? "file" : "files"} still unreviewed and will
          not be touched.
        </p>
      )}

      {failedTrash.length > 0 && (
        <p className="warning">
          Could not move {failedTrash.length}{" "}
          {failedTrash.length === 1 ? "file" : "files"}. They are still queued.
        </p>
      )}

      {queued.length > 0 && (
        <ul className="queue-list">
          {queued.map((file) => (
            <li key={file.path}>
              <div>
                <strong>{file.name}</strong>
                <p className="mono">{truncatePath(file.path, 64)}</p>
                {failedByPath.get(file.path) && (
                  <p className="hint">{failedByPath.get(file.path)}</p>
                )}
              </div>
              <span className="mono size">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="btn ghost tiny"
                onClick={() => onUnqueue(file.path)}
              >
                Keep
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="review-actions">
        <button type="button" className="btn ghost" onClick={onBack}>
          {backLabel}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={queued.length === 0}
          onClick={() => setConfirming(true)}
        >
          Move to Trash
        </button>
      </div>

      {confirming && (
        <ConfirmDialog
          count={queued.length}
          bytes={queuedBytes}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onConfirm();
          }}
        />
      )}
    </section>
  );
}
