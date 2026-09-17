import type {
  DuplicateCluster,
  KeeperMode,
  ScannedFile,
  SimilarHash,
} from "../types";
import { DEFAULT_HAMMING } from "../types";

export function clampHamming(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HAMMING;
  return Math.min(8, Math.max(1, Math.round(value)));
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

export function clusterSimilar(
  items: SimilarHash[],
  maxDist: number,
): DuplicateCluster[] {
  const threshold = clampHamming(maxDist);
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hammingDistance(items[i].dhash, items[j].dhash) <= threshold) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, ScannedFile[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(items[i].file);
    groups.set(root, list);
  }

  return [...groups.values()]
    .filter((files) => files.length >= 2)
    .sort((a, b) => b.length - a.length || a[0].path.localeCompare(b[0].path))
    .map((files, index) => ({
      id: `similar-${index}-${files.map((file) => file.path).sort().join("|")}`,
      files,
    }));
}

export function pickKeeper(files: ScannedFile[], mode: KeeperMode): ScannedFile {
  const ranked = [...files].sort((a, b) => {
    if (mode === "newest") {
      const mt = (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0);
      if (mt !== 0) return mt;
    }
    const size = b.size - a.size;
    if (size !== 0) return size;
    return a.path.localeCompare(b.path);
  });
  return ranked[0];
}

export function dupSteps(
  exactClusters: DuplicateCluster[],
  similarHashes: SimilarHash[],
): DuplicateCluster[] {
  return [...exactClusters, ...clusterSimilar(similarHashes, DEFAULT_HAMMING)];
}

export function nextDupIndex(
  before: DuplicateCluster[],
  after: DuplicateCluster[],
  index: number,
): number {
  if (after.length === 0) return 0;
  const current = before[index];
  if (current) {
    const currentPaths = new Set(current.files.map((file) => file.path));
    const found = after.findIndex((step) =>
      step.files.some((file) => currentPaths.has(file.path)),
    );
    if (found >= 0) return found;
  }
  let remainBefore = 0;
  for (let i = 0; i < Math.min(index, before.length); i += 1) {
    const paths = new Set(before[i].files.map((file) => file.path));
    if (after.some((step) => step.files.some((file) => paths.has(file.path)))) {
      remainBefore += 1;
    }
  }
  return Math.min(remainBefore, after.length - 1);
}
