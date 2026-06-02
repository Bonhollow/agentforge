import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync, rmSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { consola } from "../utils/logger.js";
import { getRegistryDir, readRegistry, readRegistryFromDir } from "./registry.js";
import { diffSchemas, formatDiff } from "./diff.js";

interface SnapshotMeta {
  name: string;
  stamp: string;
  label?: string;
}

const META_FILE = "snapshots.json";

function snapshotsDir(cwd: string): string {
  const dir = join(getRegistryDir(cwd), ".snapshots");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function metaPath(cwd: string): string {
  return join(snapshotsDir(cwd), META_FILE);
}

function loadMeta(cwd: string): SnapshotMeta[] {
  const path = metaPath(cwd);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

function saveMeta(cwd: string, meta: SnapshotMeta[]): void {
  writeFileSync(metaPath(cwd), JSON.stringify(meta, null, 2), "utf-8");
}

export function createSnapshot(cwd: string, label?: string): string | null {
  const regDir = getRegistryDir(cwd);
  if (!existsSync(regDir)) return null;

  const stamp = timestamp();
  const dest = join(snapshotsDir(cwd), stamp);

  mkdirSync(dest, { recursive: true });
  for (const sub of ["agents", "skills", "prompts"]) {
    const srcSub = join(regDir, sub);
    if (existsSync(srcSub)) {
      cpSync(srcSub, join(dest, sub), { recursive: true });
    }
  }

  const name = label || stamp;
  const meta = loadMeta(cwd);
  meta.push({ name, stamp, label });
  saveMeta(cwd, meta);

  const count = countElements(dest);
  consola.info(`Snapshot saved: ${name} (${count} elements)`);
  return stamp;
}

export function listSnapshots(cwd: string): SnapshotMeta[] {
  return loadMeta(cwd);
}

export function resolveSnapshot(cwd: string, name: string): string | null {
  const meta = loadMeta(cwd);
  const found = meta.find((m) => m.name === name);
  if (found) return found.stamp;

  const dir = snapshotsDir(cwd);
  if (existsSync(join(dir, name))) return name;

  return null;
}

export function restoreSnapshot(cwd: string, name: string): boolean {
  const stamp = resolveSnapshot(cwd, name);
  if (!stamp) {
    consola.error(`Snapshot "${name}" not found.`);
    return false;
  }

  const src = join(snapshotsDir(cwd), stamp);
  if (!existsSync(src)) {
    consola.error(`Snapshot directory "${stamp}" missing.`);
    return false;
  }

  const regDir = getRegistryDir(cwd);
  const tmpDir = join(regDir, `.restore_${Date.now()}`);

  // Copy snapshot to a temp directory first — if this fails, current state is untouched
  mkdirSync(tmpDir, { recursive: true });
  try {
    for (const sub of ["agents", "skills", "prompts"]) {
      const srcSub = join(src, sub);
      if (existsSync(srcSub)) {
        cpSync(srcSub, join(tmpDir, sub), { recursive: true });
      }
    }
  } catch (err) {
    rmSync(tmpDir, { recursive: true });
    consola.error(`Failed to copy snapshot: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  // Now safe to delete old state
  for (const sub of ["agents", "skills", "prompts"]) {
    const subDir = join(regDir, sub);
    if (existsSync(subDir)) {
      rmSync(subDir, { recursive: true });
    }
  }

  // Move temp to final location
  for (const sub of ["agents", "skills", "prompts"]) {
    const tmpSub = join(tmpDir, sub);
    const dstSub = join(regDir, sub);
    if (existsSync(tmpSub)) {
      renameSync(tmpSub, dstSub);
    }
  }

  // Clean up temp (should be empty now, but remove if rename failed for some paths)
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }

  const count = countElements(regDir);
  consola.success(`Restored snapshot "${name}" (${count} elements).`);
  return true;
}

export function diffSnapshot(cwd: string, name: string): string | null {
  const stamp = resolveSnapshot(cwd, name);
  if (!stamp) {
    consola.error(`Snapshot "${name}" not found.`);
    return null;
  }

  const src = join(snapshotsDir(cwd), stamp);
  if (!existsSync(src)) {
    consola.error(`Snapshot directory "${stamp}" missing.`);
    return null;
  }

  const current = readRegistryFromDir(getRegistryDir(cwd));
  const snap = readRegistryFromDir(src);

  const result = diffSchemas(current, snap);
  return formatDiff(result);
}

function countElements(dir: string): number {
  let total = 0;
  for (const sub of ["agents", "skills", "prompts"]) {
    const subDir = join(dir, sub);
    if (existsSync(subDir)) {
      total += readdirSync(subDir).filter((f) => !f.startsWith(".")).length;
    }
  }
  return total;
}
