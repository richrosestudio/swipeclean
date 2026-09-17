import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { formatBytes, formatDate, truncatePath } from "../lib/format";
import type { ScannedFile } from "../types";
import { FilePreview } from "./FilePreview";

const SWIPE_THRESHOLD = 110;
const FLING_DISTANCE = 560;

interface FileCardProps {
  file: ScannedFile;
  depth?: number;
  interactive?: boolean;
  hoverSide?: "keep" | "delete" | null;
  onKeep: () => void;
  onDelete: () => void;
}

export function FileCard({
  file,
  depth = 0,
  interactive = true,
  hoverSide = null,
  onKeep,
  onDelete,
}: FileCardProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  const deciding = useRef(false);

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    deciding.current = false;
  }, [file.path]);

  const rotation = offset.x / 18;
  const keepHint =
    hoverSide === "keep" && !dragging ? 0.7 : Math.min(1, Math.max(0, offset.x / SWIPE_THRESHOLD));
  const deleteHint =
    hoverSide === "delete" && !dragging
      ? 0.7
      : Math.min(1, Math.max(0, -offset.x / SWIPE_THRESHOLD));

  function fling(side: "keep" | "delete") {
    if (deciding.current) return;
    deciding.current = true;
    setOffset({ x: side === "keep" ? FLING_DISTANCE : -FLING_DISTANCE, y: last.current.y });
    window.setTimeout(() => {
      if (side === "keep") onKeep();
      else onDelete();
    }, 170);
  }

  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (!interactive || deciding.current || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY };
    last.current = { x: 0, y: 0 };
    setDragging(true);
  }

  function pointerMove(event: PointerEvent<HTMLElement>) {
    if (!interactive || deciding.current || !dragging) return;
    const next = {
      x: event.clientX - start.current.x,
      y: event.clientY - start.current.y,
    };
    last.current = next;
    setOffset(next);
  }

  function pointerUp() {
    if (!dragging || deciding.current) return;
    setDragging(false);
    const dx = last.current.x;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      fling(dx > 0 ? "keep" : "delete");
      return;
    }
    last.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
  }

  const stackStyle =
    depth > 0
      ? {
          transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.04})`,
          opacity: 1 - depth * 0.12,
          pointerEvents: "none" as const,
        }
      : {
          transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`,
          transition: dragging ? "none" : "transform 170ms ease",
        };

  return (
    <article
      className={`file-card ${interactive ? "is-front" : "is-stacked"}`}
      style={stackStyle}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      {interactive && (
        <>
          <div className="side-wash delete" style={{ opacity: deleteHint * 0.35 }} />
          <div className="side-wash keep" style={{ opacity: keepHint * 0.35 }} />
          <div className="swipe-stamp keep" style={{ opacity: keepHint }}>
            Keep
          </div>
          <div className="swipe-stamp delete" style={{ opacity: deleteHint }}>
            Trash
          </div>
        </>
      )}
      <div className="card-preview">
        <FilePreview file={file} />
      </div>
      <div className="card-meta">
        <h2 title={file.name}>{file.name}</h2>
        <p className="mono path" title={file.path}>
          {truncatePath(file.path)}
        </p>
        <dl className="meta-grid">
          <div>
            <dt>Size</dt>
            <dd className="mono">{formatBytes(file.size)}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd className="mono">{file.extension ? file.extension.toUpperCase() : "-"}</dd>
          </div>
          <div>
            <dt>Modified</dt>
            <dd className="mono">{formatDate(file.mtimeMs)}</dd>
          </div>
          <div>
            <dt>Accessed</dt>
            <dd className="mono">
              {file.atimeAvailable ? formatDate(file.atimeMs) : "Unavailable"}
            </dd>
          </div>
        </dl>
        {!file.atimeAvailable && (
          <p className="hint">
            Last accessed isn’t reported on this volume, so Swipe Clean shows last
            modified instead.
          </p>
        )}
      </div>
    </article>
  );
}
