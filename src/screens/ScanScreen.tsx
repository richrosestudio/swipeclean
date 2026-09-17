import { useEffect, useRef } from "react";
import { BrandBar } from "../components/BrandBar";
import { useCountUp } from "../lib/countUp";
import { formatBytes, truncatePath } from "../lib/format";
import type { DupProgress, ScanPhase, ScanProgress } from "../types";

interface ScanScreenProps {
  phase: ScanPhase;
  progress: ScanProgress | null;
  dupProgress: DupProgress | null;
  fileCount: number;
  holdListing?: boolean;
  onListingReady?: () => void;
  onCancel: () => void;
  onHome: () => void;
}

export function ScanScreen({
  phase,
  progress,
  dupProgress,
  fileCount,
  holdListing,
  onListingReady,
  onCancel,
  onHome,
}: ScanScreenProps) {
  const listing = phase === "listing";
  const done = dupProgress?.done ?? 0;
  const total = dupProgress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const found = progress?.filesFound ?? fileCount;
  const skipped = progress?.skipped ?? 0;
  const bytes = progress?.bytesFound ?? 0;
  const shownFound = useCountUp(found, Boolean(holdListing));
  const shownSkipped = useCountUp(skipped, Boolean(holdListing));
  const shownBytes = useCountUp(bytes, Boolean(holdListing));
  const shownDone = useCountUp(done);
  const currentPath = listing
    ? progress?.currentPath
    : dupProgress?.path || progress?.currentPath;
  const similar = dupProgress?.phase === "similar";
  const readyRef = useRef(onListingReady);
  readyRef.current = onListingReady;

  useEffect(() => {
    if (!holdListing) return;
    if (shownFound !== found || shownSkipped !== skipped || shownBytes !== bytes) {
      return;
    }
    readyRef.current?.();
  }, [holdListing, shownFound, found, shownSkipped, skipped, shownBytes, bytes]);

  return (
    <section className="screen scan">
      <BrandBar onHome={onHome} />
      <header className="hero compact">
        <p className="eyebrow">{listing ? "Scanning" : "Checking duplicates"}</p>
        <h1>{listing ? "Looking through files" : "Comparing contents"}</h1>
        <p className="lede">
          {listing
            ? "Counting every file as we find it. You can cancel anytime. Nothing is being deleted."
            : similar
              ? "Checking photos that look alike. You can cancel anytime. Nothing is being deleted."
              : "Looking for identical files. You can cancel anytime. Nothing is being deleted."}
        </p>
      </header>
      <div className="panel scan-panel">
        <div
          className={`scan-meter ${listing || total === 0 ? "" : "determinate"}`}
          aria-hidden="true"
        >
          <span style={listing || total === 0 ? undefined : { width: `${pct}%` }} />
        </div>
        {listing ? (
          <div className="scan-count-block">
            <p className="scan-count mono">{shownFound.toLocaleString()}</p>
            <p className="scan-count-label">
              {shownFound === 1 ? "file found" : "files found"}
            </p>
          </div>
        ) : (
          <div className="scan-count-block">
            <p className="scan-count mono">
              {total > 0
                ? `${shownDone.toLocaleString()} / ${total.toLocaleString()}`
                : "…"}
            </p>
            <p className="scan-count-label">
              {similar ? "photos checked" : "files hashed"}
            </p>
          </div>
        )}
        <dl className="meta-grid">
          <div>
            <dt>Size found</dt>
            <dd className="mono">{formatBytes(listing ? shownBytes : bytes)}</dd>
          </div>
          <div>
            <dt>{listing ? "Skipped" : "Queued"}</dt>
            <dd className="mono">
              {listing ? shownSkipped.toLocaleString() : found.toLocaleString()}
            </dd>
          </div>
        </dl>
        <p className="mono path-display">
          {currentPath ? truncatePath(currentPath, 88) : "Starting…"}
        </p>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel scan
        </button>
      </div>
    </section>
  );
}
