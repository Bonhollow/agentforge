import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getRegistryDir } from "./registry.js";
import { consola } from "../utils/logger.js";

export interface ModelVersionRecord {
  platform: string;
  model: string;
  recordedAt: string;
}

export function loadModelVersions(cwd: string): ModelVersionRecord[] {
  const path = join(getRegistryDir(cwd), "model-versions.json");
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export function recordModelVersion(cwd: string, platform: string, model: string): void {
  const versions = loadModelVersions(cwd);
  const existing = versions.findIndex((v) => v.platform === platform);
  const entry: ModelVersionRecord = { platform, model, recordedAt: new Date().toISOString() };

  if (existing >= 0) {
    versions[existing] = entry;
  } else {
    versions.push(entry);
  }

  const dir = getRegistryDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "model-versions.json"), JSON.stringify(versions, null, 2), "utf-8");
}

export function checkModelVersion(
  cwd: string,
  platform: string,
  currentModel: string,
): string | null {
  const versions = loadModelVersions(cwd);
  const prev = versions.find((v) => v.platform === platform);
  if (!prev) return null;
  if (prev.model !== currentModel) {
    return `Agent was tuned for ${prev.model} but exporting to ${currentModel}. Review may be needed.`;
  }
  return null;
}
