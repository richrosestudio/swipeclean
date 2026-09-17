import { useState } from "react";
import {
  SIZE_THRESHOLDS,
  type RootCheck,
  type ScanOptions,
  type SkipSummary,
  type SortMode,
} from "../types";

interface HomeProps {
  options: ScanOptions;
  onChange: (options: ScanOptions) => void;
  onPickFolder: () => Promise<void>;
  onStart: () => void;
  onProtect: () => void;
  onSeeSkips?: () => void;
  picking?: boolean;
  rootCheck: RootCheck | null;
  lastSkipSummary: SkipSummary | null;
  scanError: string | null;
}

export function Home({
  options,
  onChange,
  onPickFolder,
  onStart,
  onProtect,
  onSeeSkips,
  picking,
  rootCheck,
  lastSkipSummary,
  scanError,
}: HomeProps) {
  const [picked, setPicked] = useState(false);
  const blocked = Boolean(rootCheck && !rootCheck.allowed);
  const canStart = Boolean(options.root) && !blocked;

  async function pick() {
    await onPickFolder();
    setPicked(true);
  }

  return (
    <section className="screen home">
      <header className="hero">
        <p className="eyebrow">Desktop cleaner</p>
        <h1>Swipe Clean</h1>
        <p className="lede">
          Review files one at a time. Swipe right to keep, left to queue. Nothing
          is deleted until you confirm, and then it goes to Trash, not into the
          void.
        </p>
      </header>

      <div className="panel">
        <button type="button" className="btn primary block" onClick={pick} disabled={picking}>
          {options.root ? "Change folder" : "Choose a folder"}
        </button>
        <p className={`mono path-display ${picked || options.root ? "" : "placeholder"}`}>
          {options.root || "No folder selected yet"}
        </p>
        <p className="hint">
          Protected locations, version control, in-use files, and recent work
          are skipped automatically.
        </p>

        <label className="toggle">
          <input
            type="checkbox"
            checked={options.recursive}
            onChange={(e) =>
              onChange({ ...options, recursive: e.target.checked })
            }
          />
          Include everything in subfolders
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={options.largeFilesFirst}
            onChange={(e) =>
              onChange({
                ...options,
                largeFilesFirst: e.target.checked,
                sort: e.target.checked ? "size-desc" : options.sort,
              })
            }
          />
          Show largest files first
        </label>

        <label className="select-row">
          Hide files smaller than
          <select
            value={options.minSizeBytes}
            onChange={(e) =>
              onChange({ ...options, minSizeBytes: Number(e.target.value) })
            }
          >
            {SIZE_THRESHOLDS.map((t) => (
              <option key={t.bytes} value={t.bytes}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="chip-field">
          <legend>Sort</legend>
          <div className="chips">
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
                onClick={() => onChange({ ...options, sort: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {rootCheck?.message && <p className="warning">{rootCheck.message}</p>}

        {scanError && <p className="warning">{scanError}</p>}
        {lastSkipSummary && lastSkipSummary.total > 0 && onSeeSkips && (
          <button type="button" className="text-link" onClick={onSeeSkips}>
            See why {lastSkipSummary.total.toLocaleString()} files were skipped
          </button>
        )}

        <button
          type="button"
          className="btn primary block"
          disabled={!canStart}
          onClick={onStart}
        >
          Start reviewing
        </button>
        <button type="button" className="text-link" onClick={onProtect}>
          Protected folders
        </button>
      </div>
    </section>
  );
}
