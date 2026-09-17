import { useEffect, useState } from "react";
import { BrandBar } from "../components/BrandBar";
import { FileCard } from "../components/FileCard";
import { StatsBar } from "../components/StatsBar";
import { SkipBanner } from "../components/SkipBanner";
import { type ScanOptions, type ScannedFile, type SkipSummary, type SortMode } from "../types";

interface SwipeScreenProps {
  current: ScannedFile;
  upcoming: ScannedFile[];
  options: ScanOptions;
  reviewed: number;
  total: number;
  kept: number;
  queued: number;
  queuedBytes: number;
  canUndo: boolean;
  onKeep: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onChangeOptions: (options: ScanOptions) => void;
  onReview: () => void;
  onHome: () => void;
  skipSummary?: SkipSummary | null;
  onSeeSkips?: () => void;
}

export function SwipeScreen({
  current,
  upcoming,
  options,
  reviewed,
  total,
  kept,
  queued,
  queuedBytes,
  canUndo,
  onKeep,
  onDelete,
  onUndo,
  onChangeOptions,
  onReview,
  onHome,
  skipSummary,
  onSeeSkips,
}: SwipeScreenProps) {
  const [hoverSide, setHoverSide] = useState<"keep" | "delete" | null>(null);
  const [showCoach, setShowCoach] = useState(true);

  function keep() {
    setShowCoach(false);
    onKeep();
  }

  function trash() {
    setShowCoach(false);
    onDelete();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      if (event.key === "ArrowRight") keep();
      if (event.key === "ArrowLeft") trash();
      if ((event.key === "Backspace" || event.key.toLowerCase() === "u") && canUndo) {
        event.preventDefault();
        onUndo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKeep, onDelete, onUndo, canUndo]);

  return (
    <section className="screen swipe">
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

      <div className="toolbar">
        <div className="chips compact">
          {(
            [
              ["size-desc", "Largest"],
              ["oldest", "Oldest"],
              ["newest", "Newest"],
              ["type", "Type"],
            ] as [SortMode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip ${options.sort === value ? "on" : ""}`}
              onClick={() => onChangeOptions({ ...options, sort: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`swipe-stage ${showCoach ? "coaching" : ""}`}>
        <button
          type="button"
          className={`side-zone delete ${hoverSide === "delete" ? "hot" : ""}`}
          aria-label="Queue for Trash"
          onClick={trash}
          onPointerEnter={() => setHoverSide("delete")}
          onPointerLeave={() => setHoverSide((side) => (side === "delete" ? null : side))}
        >
          <span>Trash</span>
        </button>
        <div className="deck">
          {upcoming
            .slice(0, 2)
            .reverse()
            .map((file, index, arr) => (
              <FileCard
                key={file.path}
                file={file}
                depth={arr.length - index}
                interactive={false}
                onKeep={() => undefined}
                onDelete={() => undefined}
              />
            ))}
          <FileCard
            key={current.path}
            file={current}
            hoverSide={hoverSide}
            onKeep={keep}
            onDelete={trash}
          />
        </div>
        <button
          type="button"
          className={`side-zone keep ${hoverSide === "keep" ? "hot" : ""}`}
          aria-label="Keep file"
          onClick={keep}
          onPointerEnter={() => setHoverSide("keep")}
          onPointerLeave={() => setHoverSide((side) => (side === "keep" ? null : side))}
        >
          <span>Keep</span>
        </button>
      </div>

      {showCoach && (
        <div className="coach" role="note">
          <p>
            Click the <strong className="delete">left</strong> to Trash, the{" "}
            <strong className="keep">right</strong> to keep.
          </p>
          <p className="sub">Or drag the card. This tip hides after your first choice.</p>
        </div>
      )}

      {!showCoach && (
        <p className="hint center">U undoes the last card.</p>
      )}
      <div className="swipe-actions">
        <button
          type="button"
          className="text-link"
          onClick={onUndo}
          disabled={!canUndo}
        >
          Undo last
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
    </section>
  );
}
