import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  DupProgress,
  FindDuplicatesResult,
  ProtectionSettings,
  RootCheck,
  ScanComplete,
  ScanProgress,
  ScanRequest,
  TrashItemResult,
  TrashProgress,
} from "../types";

export async function pickFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose a folder to review",
  });
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

export async function scanFolder(request: ScanRequest): Promise<ScanComplete> {
  return invoke<ScanComplete>("scan_folder", { request });
}

export async function cancelScan(): Promise<void> {
  await invoke("cancel_scan");
}

export async function moveToTrash(paths: string[]): Promise<TrashItemResult[]> {
  return invoke<TrashItemResult[]>("move_to_trash", { paths });
}

export async function restoreFromTrash(paths: string[]): Promise<TrashItemResult[]> {
  return invoke<TrashItemResult[]>("restore_from_trash", { paths });
}

export async function readFileBytes(
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_file_bytes", { path, maxBytes });
  return Uint8Array.from(bytes);
}

export async function onScanProgress(
  handler: (progress: ScanProgress) => void,
): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan-progress", (event) => handler(event.payload));
}

export async function onTrashProgress(
  handler: (progress: TrashProgress) => void,
): Promise<UnlistenFn> {
  return listen<TrashProgress>("trash-progress", (event) => handler(event.payload));
}

export async function findDuplicates(): Promise<FindDuplicatesResult> {
  return invoke<FindDuplicatesResult>("find_duplicates");
}

export async function onDupProgress(
  handler: (progress: DupProgress) => void,
): Promise<UnlistenFn> {
  return listen<DupProgress>("dup-progress", (event) => handler(event.payload));
}

export async function getProtectionSettings(): Promise<ProtectionSettings> {
  return invoke<ProtectionSettings>("get_protection_settings");
}

export async function saveProtectionSettings(
  settings: ProtectionSettings,
): Promise<ProtectionSettings> {
  return invoke<ProtectionSettings>("save_protection_settings", { settings });
}

export async function checkScanRoot(path: string): Promise<RootCheck> {
  return invoke<RootCheck>("check_scan_root", { path });
}
