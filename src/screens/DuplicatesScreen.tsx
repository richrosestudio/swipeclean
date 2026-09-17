import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { BrandBar } from "../components/BrandBar";
import { FilePreview } from "../components/FilePreview";
import { StatsBar } from "../components/StatsBar";
import { clusterSimilar, pickKeeper } from "../lib/duplicates";
import { formatBytes } from "../lib/format";
import { SkipBanner } from "../components/SkipBanner";
import type {
  DuplicateCluster,
  KeeperMode,
  ScannedFile,
  SimilarHash,
  SkipSummary,
} from "../types";
import { DEFAULT_HAMMING } from "../types";

interface DuplicatesScreenProps {
  exactClusters: DuplicateCluster[];
  similarHashes: SimilarHash[];
  total: number;
  kept: number;
  queued: number;
  queuedBytes: number;
  reviewed: number;
  onAcceptExact: (keeper: ScannedFile, rest: ScannedFile[]) => void;
  onQueueSimilar: (file: ScannedFile) => void;
  onUnqueueSimilar: (path: string) => void;
  onContinue: () => void;
  onReview: () => void;
  onHome: () => void;
  index: number;
  onIndexChange: (index: number) => void;
  queuedPaths: Set<string>;
  skipSummary?: SkipSummary | null;
  onSeeSkips?: () => void;
}

type Step =
  | { kind: "exact"; cluster: DuplicateCluster }
  | { kind: "similar"; cluster: DuplicateCluster };

export function DuplicatesScreen({
  exactClusters,
  similarHashes,
  total,
  kept,
  queued,
  queuedBytes,
  reviewed,
  onAcceptExact,
  onQueueSimilar,
  onUnqueueSimilar,
  onContinue,
  onReview,
  onHome,
  queuedPaths,
  index,
  onIndexChange,
  skipSummary,
  onSeeSkips,
}: DuplicatesScreenProps) {
  const [keeperMode, setKeeperMode] = useState<KeeperMode>("newest");
  const [keeperOverride, setKeeperOverride] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [fullSize, setFullSize] = useState<ScannedFile | null>(null);

  const similarClusters = useMemo(
    () => clusterSimilar(similarHashes, DEFAULT_HAMMING),
    [similarHashes],
  );

  const steps = useMemo<Step[]>(
    () => [
      ...exactClusters.map((cluster) => ({ kind: "exact" as const, cluster })),
      ...similarClusters.map((cluster) => ({ kind: "similar" as const, cluster })),
    ],
    [exactClusters, similarClusters],
  );

  const step = steps[index] ?? null;
  const exactTotal = exactClusters.length;
  const similarTotal = similarClusters.length;

  useEffect(() => {
    setKeeperOverride(null);
    setPreviewPath(null);
  }, [index, step?.cluster.id]);

  useEffect(() => {
    if (steps.length === 0) return;
    if (index >= steps.length) onIndexChange(steps.length - 1);
  }, [index, steps.length, onIndexChange]);

  useEffect(() => {
    if (steps.length === 0) onContinue();
  }, [steps.length, onContinue]);

  if (!step) {
    return (
      <section className="screen duplicates">
        <BrandBar onHome={onHome} />
        <p className="hint center">Continuing to swipe…</p>
      </section>
    );
  }

  const suggested = pickKeeper(step.cluster.files, keeperMode);
  const keeper =
    step.cluster.files.find((file) => file.path === keeperOverride) ?? suggested;
  const preview =
    step.cluster.files.find((file) => file.path === previewPath) ??
    (step.kind === "similar" ? suggested : keeper);
  const restBytes = step.cluster.files
    .filter((file) => file.path !== keeper.path)
    .reduce((sum, file) => sum + file.size, 0);

  const exactNumber =
    steps.slice(0, index).filter((item) => item.kind === "exact").length + 1;
  const similarNumber =
    steps.slice(0, index).filter((item) => item.kind === "similar").length + 1;

  function advance() {
    if (index + 1 >= steps.length) onContinue();
    else onIndexChange(index + 1);
  }

  function acceptExact() {
    const rest = step.cluster.files.filter((file) => file.path !== keeper.path);
    onAcceptExact(keeper, rest);
    advance();
  }

  return (
    <section className="screen duplicates">
      <BrandBar onHome={onHome} />
      <StatsBar
        reviewed={reviewed}
        total={total}
        kept={kept}
        queued={queued}
        queuedBytes={queuedBytes}
        onReview={onReview}
      />
      {onSeeSkips && <SkipBanner summary={skipSummary ?? null} onSeeWhy={onSeeSkips} />}

      <header className="dup-head">
        <p className="eyebrow">
          {step.kind === "exact"
            ? `Exact ${exactNumber} of ${exactTotal}`
            : `Similar ${similarNumber} of ${similarTotal}`}
        </p>
        <h1>
          {step.kind === "exact"
            ? "Keep this copy, queue the rest?"
            : "These look alike. Trash any extras?"}
        </h1>
        <p className="dup-cluster-meta">
          {step.kind === "exact"
            ? `${step.cluster.files.length} identical files · ${formatBytes(restBytes)} extra`
            : `${step.cluster.files.length} similar images · nothing queued until you choose`}
        </p>
        {step.kind === "exact" && (
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setKeeperMode((mode) => (mode === "newest" ? "largest" : "newest"));
              setKeeperOverride(null);
            }}
          >
            {keeperMode === "newest" ? "Keeping newest" : "Keeping largest"}. Switch
          </button>
        )}
      </header>

      <div className="dup-thumbs" role="list">
        {step.cluster.files.map((file) => {
          const isKeeper = file.path === keeper.path;
          const isPreview = file.path === preview.path;
          const isQueued = queuedPaths.has(file.path);
          return (
            <button
              key={file.path}
              type="button"
              role="listitem"
              className={`dup-thumb-card ${isPreview ? "selected" : ""} ${isQueued ? "queued" : ""}`}
              onClick={() => {
                if (step.kind === "exact") setKeeperOverride(file.path);
                else setPreviewPath(file.path);
              }}
            >
              {file.kind === "image" ? (
                <img src={convertFileSrc(file.path)} alt={file.name} />
              ) : (
                <span className="dup-badge">{file.extension || "file"}</span>
              )}
              {step.kind === "exact" && isKeeper && (
                <span className="keeper-tag">Keep</span>
              )}
              {step.kind === "similar" && isQueued && (
                <span className="queued-tag">Queued</span>
              )}
            </button>
          );
        })}
      </div>

      {step.kind === "similar" && (
        <div
          className="similar-hero"
          role="button"
          tabIndex={0}
          onClick={() => setFullSize(preview)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setFullSize(preview);
            }
          }}
          aria-label={`View ${preview.name} full-size`}
        >
          <FilePreview file={preview} />
        </div>
      )}

      <p className="dup-selected-meta">
        <strong>{preview.name}</strong>
        <span className="mono"> {formatBytes(preview.size)}</span>
      </p>

      <div className="dup-cluster-actions">
        <button type="button" className="btn ghost" onClick={advance}>
          Skip
        </button>
        {step.kind === "exact" ? (
          <button type="button" className="btn keep" onClick={acceptExact}>
            Keep this, queue the rest
          </button>
        ) : (
          <button
            type="button"
            className={`btn ${queuedPaths.has(preview.path) ? "ghost" : "danger"}`}
            onClick={() => {
              if (queuedPaths.has(preview.path)) onUnqueueSimilar(preview.path);
              else onQueueSimilar(preview);
            }}
          >
            {queuedPaths.has(preview.path) ? "Undo queue" : "Queue for Trash"}
          </button>
        )}
      </div>

      <div className="dup-footer">
        <button type="button" className="text-link" onClick={onContinue}>
          Skip remaining
        </button>
        {queued > 0 && (
          <>
            <button type="button" className="text-link" onClick={onReview}>
              Review list
            </button>
            <button type="button" className="btn danger" onClick={onReview}>
              Move {queued} to Trash
            </button>
          </>
        )}
      </div>

      {fullSize && (
        <div
          className="similar-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={fullSize.name}
          onClick={() => setFullSize(null)}
        >
          <div
            className="similar-lightbox-card"
            onClick={(event) => event.stopPropagation()}
          >
            <FilePreview file={fullSize} />
            <p>
              <strong>{fullSize.name}</strong>
              <span className="mono"> {formatBytes(fullSize.size)}</span>
            </p>
            <button
              type="button"
              className="btn ghost tiny"
              onClick={() => setFullSize(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
