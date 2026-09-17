import type { SkipReason } from "../types";

export function skipReasonLabel(reason: SkipReason): string {
  switch (reason) {
    case "system":
      return "System location";
    case "inUse":
      return "In use";
    case "recent":
      return "Recently modified";
    case "userFolder":
      return "Your folder";
    case "userExt":
      return "Extension rule";
    case "userName":
      return "Folder name";
    case "vcs":
      return "Version control";
    default:
      return "protected";
  }
}
