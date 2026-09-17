import type { ScannedFile, SortMode } from "../types";
import type { Decision } from "../types";

export function sortFiles(files: ScannedFile[], mode: SortMode): ScannedFile[] {
  const copy = [...files];
  copy.sort((a, b) => {
    switch (mode) {
      case "size-desc":
        return b.size - a.size || a.name.localeCompare(b.name);
      case "oldest":
        return (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0) || a.name.localeCompare(b.name);
      case "newest":
        return (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || a.name.localeCompare(b.name);
      case "type":
        return (
          a.kind.localeCompare(b.kind) ||
          a.extension.localeCompare(b.extension) ||
          b.size - a.size
        );
      default:
        return 0;
    }
  });
  return copy;
}

export function remainingFiles(
  files: ScannedFile[],
  decisions: Decision[],
  sort: SortMode,
): ScannedFile[] {
  const decided = new Set(decisions.map((d) => d.file.path));
  return sortFiles(
    files.filter((file) => !decided.has(file.path)),
    sort,
  );
}

export function queuedFiles(decisions: Decision[]): ScannedFile[] {
  return decisions.filter((d) => d.action === "delete").map((d) => d.file);
}

export function keptCount(decisions: Decision[]): number {
  return decisions.filter((d) => d.action === "keep").length;
}

export function queuedBytes(decisions: Decision[]): number {
  return queuedFiles(decisions).reduce((sum, file) => sum + file.size, 0);
}
