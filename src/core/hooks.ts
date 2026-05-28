import { execSync } from "node:child_process";
import { consola } from "../utils/logger.js";
import { loadConfig } from "./config.js";

export function runHook(name: string, target: string, cwd: string): void {
  const cfg = loadConfig(cwd);
  const hooks = cfg.hooks || {};
  const cmds = name === "pre_export" ? hooks.pre_export : hooks.post_export;
  if (!cmds) return;

  const cmd = cmds[target] || cmds["*"];
  if (!cmd) return;

  try {
    consola.info(`[hook ${name}] Running: ${cmd}`);
    execSync(cmd, { stdio: "inherit", cwd });
  } catch (err) {
    consola.warn(`[hook ${name}] Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
