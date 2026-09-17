import { truncatePath } from "../lib/format";
import type { TrashProgress } from "../types";

interface ProgressScreenProps {
  progress: TrashProgress | null;
  total: number;
}

export function ProgressScreen({ progress, total }: ProgressScreenProps) {
  const done = progress?.done ?? 0;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <section className="screen scan">
      <header className="hero compact">
        <p className="eyebrow">Moving to Trash</p>
        <h1>Putting files in Trash</h1>
        <p className="lede">
          Recoverable from the OS Trash or Recycle Bin. This is not a permanent
          delete.
        </p>
      </header>
      <div className="panel scan-panel">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="mono path-display">
          {done} / {total}
          {progress?.path ? ` · ${truncatePath(progress.path, 60)}` : ""}
        </p>
      </div>
    </section>
  );
}
