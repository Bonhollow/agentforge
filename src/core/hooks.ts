import { spawnSync } from "node:child_process";
import { consola } from "../utils/logger.js";
import { loadConfig } from "./config.js";

function splitCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (const ch of cmd) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " ") {
      if (current) { parts.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function runHook(name: string, target: string, cwd: string): void {
  const cfg = loadConfig(cwd);
  const hooks = cfg.hooks || {};
  const cmds = name === "pre_export" ? hooks.pre_export : hooks.post_export;
  if (!cmds) return;

  const cmd = cmds[target] || cmds["*"];
  if (!cmd) return;

  try {
    consola.info(`[hook ${name}] Running: ${cmd}`);
    const args = splitCommand(cmd);
    const command = args.shift()!;
    const result = spawnSync(command, args, { stdio: "inherit", cwd, shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Exit code ${result.status}`);
  } catch (err) {
    consola.warn(`[hook ${name}] Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
