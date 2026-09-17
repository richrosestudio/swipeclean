import { formatBytes } from "../lib/format";

interface ConfirmDialogProps {
  count: number;
  bytes: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  count,
  bytes,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Move to Trash?</h2>
        <p>
          Move {count} {count === 1 ? "file" : "files"} ({formatBytes(bytes)}) to
          Trash. You can Put Back after they move.
        </p>
        <p className="hint">Nothing is permanently deleted.</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            Move to Trash
          </button>
        </div>
      </div>
    </div>
  );
}
