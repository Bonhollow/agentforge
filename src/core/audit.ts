import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getRegistryDir } from "./registry.js";

export function auditLog(cwd: string, operation: string, element: string, detail?: string): void {
  const logDir = getRegistryDir(cwd);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const stamp = new Date().toISOString();
  const user = process.env.USER || process.env.USERNAME || "unknown";
  const line = `[${stamp}] ${user} ${operation} ${element}${detail ? ` ${detail}` : ""}\n`;

  try {
    appendFileSync(join(logDir, "audit.log"), line, "utf-8");
  } catch {
    // silent
  }
}
