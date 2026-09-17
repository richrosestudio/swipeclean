export const FILE_KINDS = [
  "image",
  "video",
  "audio",
  "document",
  "archive",
  "other",
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

export type SortMode = "size-desc" | "oldest" | "newest" | "type";

export type Screen =
  | "home"
  | "protect"
  | "scan"
  | "duplicates"
  | "swipe"
  | "skips"
  | "review"
  | "progress"
  | "summary";

export type ScanPhase = "listing" | "duplicates";

export type KeeperMode = "newest" | "largest";

export interface ScannedFile {
  path: string;
  name: string;
  size: number;
  mtimeMs: number | null;
  atimeMs: number | null;
  atimeAvailable: boolean;
  extension: string;
  kind: FileKind;
}

export interface ScanRequest {
  path: string;
  recursive: boolean;
  minSize: number;
}

export interface ScanProgress {
  filesFound: number;
  bytesFound: number;
  skipped: number;
  currentPath: string;
}

export interface ScanComplete {
  filesFound: number;
  bytesFound: number;
  skipped: number;
  cancelled: boolean;
  files: ScannedFile[];
  skipSummary: SkipSummary;
}

export type SkipReason =
  | "system"
  | "inUse"
  | "recent"
  | "userFolder"
  | "userExt"
  | "userName"
  | "vcs";

export interface SkipEntry {
  reason: SkipReason;
  path: string;
  detail: string | null;
  count: number;
}

export interface SkipCounts {
  system: number;
  inUse: number;
  recent: number;
  userFolder: number;
  userExt: number;
  userName: number;
  vcs: number;
}

export interface SkipSummary {
  total: number;
  counts: SkipCounts;
  entries: SkipEntry[];
  broadRuleWarning: boolean;
}

export interface ProtectionSettings {
  folders: string[];
  extensions: string[];
  folderNames: string[];
  recentHours: number;
}

export interface RootCheck {
  allowed: boolean;
  applicationsWarning: boolean;
  message: string | null;
}

export const DEFAULT_PROTECTION: ProtectionSettings = {
  folders: [],
  extensions: [],
  folderNames: [],
  recentHours: 24,
};

export const EMPTY_SKIP_SUMMARY: SkipSummary = {
  total: 0,
  counts: {
    system: 0,
    inUse: 0,
    recent: 0,
    userFolder: 0,
    userExt: 0,
    userName: 0,
    vcs: 0,
  },
  entries: [],
  broadRuleWarning: false,
};

export interface ScanOptions {
  root: string;
  recursive: boolean;
  largeFilesFirst: boolean;
  minSizeBytes: number;
  sort: SortMode;
}

export interface Decision {
  file: ScannedFile;
  action: "keep" | "delete";
}

export interface TrashItemResult {
  path: string;
  ok: boolean;
  error: string | null;
}

export interface TrashProgress {
  done: number;
  total: number;
  path: string;
}

export interface DuplicateCluster {
  id: string;
  files: ScannedFile[];
}

export interface SimilarHash {
  file: ScannedFile;
  dhash: string;
}

export interface FindDuplicatesResult {
  exactClusters: DuplicateCluster[];
  similarHashes: SimilarHash[];
  cancelled: boolean;
}

export interface DupProgress {
  phase: string;
  done: number;
  total: number;
  path: string;
}

export const DEFAULT_HAMMING = 5;

export const SIZE_THRESHOLDS = [
  { label: "Any size", bytes: 0 },
  { label: "10 MB", bytes: 10 * 1024 * 1024 },
  { label: "50 MB", bytes: 50 * 1024 * 1024 },
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
  { label: "500 MB", bytes: 500 * 1024 * 1024 },
] as const;

export const DEFAULT_OPTIONS: ScanOptions = {
  root: "",
  recursive: true,
  largeFilesFirst: true,
  minSizeBytes: 0,
  sort: "size-desc",
};
