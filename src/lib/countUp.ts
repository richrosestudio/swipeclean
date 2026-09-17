import { useEffect, useRef, useState } from "react";

function durationFor(delta: number, settle: boolean): number {
  const abs = Math.abs(delta);
  if (abs === 0) return 0;
  if (!settle) return Math.min(160, Math.max(80, abs * 4));
  if (abs <= 24) return Math.max(560, abs * 60);
  if (abs <= 250) return 680 + abs * 2.4;
  return Math.min(1400, 980 + Math.log10(abs) * 160);
}

export function useCountUp(target: number, settle = false): number {
  const safeTarget = Number.isFinite(target) ? Math.max(0, Math.round(target)) : 0;
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    if (safeTarget === from) return;

    if (safeTarget < from) {
      shownRef.current = safeTarget;
      setShown(safeTarget);
      return;
    }

    const start = performance.now();
    const duration = durationFor(safeTarget - from, settle);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(from + (safeTarget - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [safeTarget, settle]);

  return shown;
}
