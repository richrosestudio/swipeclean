const SYSTEM_PATHS = new Set([
  "/",
  "/system",
  "/library",
  "/usr",
  "/bin",
  "/sbin",
  "/opt",
  "/private",
  "c:",
  "c:/",
  "c:/windows",
  "c:/windows/system32",
  "c:/program files",
  "c:/program files (x86)",
]);

export function isSystemPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!normalized) return false;
  if (SYSTEM_PATHS.has(normalized)) return true;
  if (/^[a-z]:$/.test(normalized)) return true;
  return (
    normalized === "/windows" ||
    normalized.startsWith("c:/windows/") ||
    normalized === "/system" ||
    normalized.startsWith("/system/")
  );
}
