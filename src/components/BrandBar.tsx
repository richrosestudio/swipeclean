interface BrandBarProps {
  onHome: () => void;
}

export function BrandBar({ onHome }: BrandBarProps) {
  return (
    <div className="top-row">
      <button type="button" className="brand-mark" onClick={onHome}>
        Swipe Clean
      </button>
      <button type="button" className="text-link" onClick={onHome}>
        Start over
      </button>
    </div>
  );
}
