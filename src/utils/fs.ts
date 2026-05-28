import { readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function listFiles(dirPath: string, ext?: string): string[] {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath).filter((f) => !ext || f.endsWith(ext));
}

export function findRegistryRoot(cwd: string): string | null {
  let current = cwd;
  while (true) {
    if (existsSync(join(current, ".agentforge"))) return current;
    const parent = join(current, "..");
    if (parent === current) return null;
    current = parent;
  }
}

export function writeFile(filePath: string, content: string): void {
  ensureDir(filePath.split("/").slice(0, -1).join("/"));
  writeFileSync(filePath, content, "utf-8");
}
