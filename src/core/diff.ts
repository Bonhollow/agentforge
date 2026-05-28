import { diffLines, type Change } from "diff";
import type { UniversalSchema } from "./schema.js";

export interface DiffResult {
  changes: Change[];
  hasChanges: boolean;
}

export function diffSchemas(local: UniversalSchema | null, remote: UniversalSchema | null): DiffResult {
  const localStr = local ? JSON.stringify(local, null, 2) : "";
  const remoteStr = remote ? JSON.stringify(remote, null, 2) : "";

  if (!local && !remote) {
    return { changes: [], hasChanges: false };
  }
  if (!local) {
    return {
      changes: [{ value: remoteStr, added: true, removed: false, count: remoteStr.split("\n").length }],
      hasChanges: true,
    };
  }
  if (!remote) {
    return {
      changes: [{ value: localStr, added: false, removed: true, count: localStr.split("\n").length }],
      hasChanges: true,
    };
  }

  const changes = diffLines(localStr, remoteStr);
  return {
    changes,
    hasChanges: changes.some((c) => c.added || c.removed),
  };
}

export function formatDiff(result: DiffResult): string {
  if (!result.hasChanges) return "No differences found.";

  return result.changes
    .map((change) => {
      if (change.added) return change.value.split("\n").map((l) => `+ ${l}`).join("\n");
      if (change.removed) return change.value.split("\n").map((l) => `- ${l}`).join("\n");
      return change.value.split("\n").map((l) => `  ${l}`).join("\n");
    })
    .join("");
}
