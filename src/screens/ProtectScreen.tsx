import { useEffect, useState } from "react";
import { BrandBar } from "../components/BrandBar";
import { pickFolder, saveProtectionSettings } from "../lib/ipc";
import { truncatePath } from "../lib/format";
import type { ProtectionSettings } from "../types";

interface ProtectScreenProps {
  settings: ProtectionSettings;
  onChange: (settings: ProtectionSettings) => void;
  onBack: () => void;
}

export function ProtectScreen({ settings, onChange, onBack }: ProtectScreenProps) {
  const [extDraft, setExtDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError(null);
  }, [settings]);

  async function persist(next: ProtectionSettings) {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveProtectionSettings(next);
      onChange(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addFolder() {
    const path = await pickFolder();
    if (!path) return;
    if (settings.folders.includes(path)) return;
    await persist({ ...settings, folders: [...settings.folders, path] });
  }

  function removeFolder(path: string) {
    void persist({
      ...settings,
      folders: settings.folders.filter((item) => item !== path),
    });
  }

  function addExtension() {
    const value = extDraft.trim().replace(/^\./, "");
    if (!value) return;
    setExtDraft("");
    const ext = value.toLowerCase();
    void persist({
      ...settings,
      extensions: settings.extensions.includes(ext)
        ? settings.extensions
        : [...settings.extensions, ext],
    });
  }

  function addFolderName() {
    const value = nameDraft.trim();
    if (!value) return;
    setNameDraft("");
    const exists = settings.folderNames.some(
      (name) => name.toLowerCase() === value.toLowerCase(),
    );
    if (exists) return;
    void persist({ ...settings, folderNames: [...settings.folderNames, value] });
  }

  return (
    <section className="screen review">
      <BrandBar onHome={onBack} />
      <header className="hero compact">
        <p className="eyebrow">Safety</p>
        <h1>Protected folders</h1>
        <p className="lede">
          These rules apply to every scan. Protected files never enter swipe or
          duplicate review.
        </p>
      </header>

      <div className="panel" style={{ width: "min(640px, 100%)" }}>
        <h2>Always on</h2>
        <p className="hint">
          System locations, version control folders (.git, .svn, .hg), and files
          in use by another app cannot be turned off.
        </p>

        <label className="select-row">
          Skip recently modified
          <select
            value={settings.recentHours}
            disabled={saving}
            onChange={(event) =>
              void persist({
                ...settings,
                recentHours: Number(event.target.value),
              })
            }
          >
            <option value={24}>Last 24 hours</option>
            <option value={12}>Last 12 hours</option>
            <option value={6}>Last 6 hours</option>
            <option value={0}>Off</option>
          </select>
        </label>

        <h2>Your folders</h2>
        {settings.folders.length === 0 ? (
          <p className="hint">No extra folders yet.</p>
        ) : (
          <ul className="queue-list">
            {settings.folders.map((folder) => (
              <li key={folder}>
                <div>
                  <strong className="mono">{truncatePath(folder, 56)}</strong>
                </div>
                <button
                  type="button"
                  className="btn ghost tiny"
                  onClick={() => removeFolder(folder)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn ghost" onClick={() => void addFolder()} disabled={saving}>
          Add protected folder
        </button>

        <h2>Never touch these extensions</h2>
        <div className="chips">
          {settings.extensions.map((ext) => (
            <button
              key={ext}
              type="button"
              className="chip on"
              onClick={() =>
                void persist({
                  ...settings,
                  extensions: settings.extensions.filter((item) => item !== ext),
                })
              }
            >
              .{ext}
            </button>
          ))}
        </div>
        <label className="select-row">
          <input
            value={extDraft}
            onChange={(event) => setExtDraft(event.target.value)}
            placeholder="psd"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addExtension();
              }
            }}
          />
          <button type="button" className="btn ghost tiny" onClick={addExtension}>
            Add
          </button>
        </label>

        <h2>Skip folders with these names</h2>
        <div className="chips">
          {settings.folderNames.map((name) => (
            <button
              key={name}
              type="button"
              className="chip on"
              onClick={() =>
                void persist({
                  ...settings,
                  folderNames: settings.folderNames.filter((item) => item !== name),
                })
              }
            >
              {name}
            </button>
          ))}
        </div>
        <label className="select-row">
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="Archive"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addFolderName();
              }
            }}
          />
          <button type="button" className="btn ghost tiny" onClick={addFolderName}>
            Add
          </button>
        </label>

        {error && <p className="warning">{error}</p>}
        <button type="button" className="btn primary" onClick={onBack}>
          Done
        </button>
      </div>
    </section>
  );
}
