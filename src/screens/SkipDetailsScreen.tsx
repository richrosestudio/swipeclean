import { BrandBar } from "../components/BrandBar";
import { SkipList } from "../components/SkipBanner";
import type { SkipSummary } from "../types";

interface SkipDetailsScreenProps {
  summary: SkipSummary;
  allProtected?: boolean;
  onBack: () => void;
  onHome: () => void;
}

export function SkipDetailsScreen({
  summary,
  allProtected,
  onBack,
  onHome,
}: SkipDetailsScreenProps) {
  return (
    <section className="screen review">
      <BrandBar onHome={onHome} />
      <header className="hero compact">
        <p className="eyebrow">Skipped</p>
        <h1>Why files were skipped</h1>
        <p className="lede">
          {allProtected
            ? "Everything in this folder was protected or skipped. Nothing was added to swipe."
            : `${summary.total.toLocaleString()} ${
                summary.total === 1 ? "file was" : "files were"
              } kept out of the queue before swipe. Nothing here can be trashed from this session.`}
        </p>
      </header>
      <div className="panel skip-details">
        <SkipList summary={summary} />
        <button type="button" className="btn ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  );
}
