import { readRegistry } from "./registry.js";
import { loadVars, resolveSchemaVars } from "./vars.js";
import { resolveSchemaForPlatform } from "./overrides.js";
import { loadConfig } from "./config.js";
import { loadIgnore, filterIgnored } from "./ignore.js";
import { readLock, writeLock, getChangedElements, updateLock } from "./lock.js";
import { auditLog } from "./audit.js";
import { claudeCodeAdapter } from "../adapters/claude-code.js";
import { codexAdapter } from "../adapters/codex.js";
import { opencodeAdapter } from "../adapters/opencode.js";
import { cursorAdapter } from "../adapters/cursor.js";
import { windsurfAdapter } from "../adapters/windsurf.js";
import { consola } from "../utils/logger.js";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "../adapters/base.js";

const adapters: Record<string, Adapter> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  windsurf: windsurfAdapter,
};

let syncing = false;

export function isSyncing(): boolean {
  return syncing;
}

export function syncExposed(cwd: string, quiet?: boolean): void {
  if (syncing) return;
  syncing = true;
  const origSuccess = quiet ? consola.success : null;
  const origInfo = quiet ? consola.info : null;
  const origWarn = quiet ? consola.warn : null;
  if (quiet) {
    consola.success = () => {};
    consola.info = () => {};
    consola.warn = () => {};
  }
  try {
    const cfg = loadConfig(cwd);
    const targets = cfg.platforms ?? ["claude_code", "codex", "opencode", "cursor", "windsurf"];

    const rawSchema = readRegistry(cwd);
    const vars = loadVars(cwd);
    const schema = resolveSchemaVars(rawSchema, vars);
    const ignoreRules = loadIgnore(cwd);
    const filtered = {
      agents: filterIgnored(schema.agents, ignoreRules),
      skills: filterIgnored(schema.skills, ignoreRules),
      prompts: filterIgnored(schema.prompts, ignoreRules),
    };

    const lock = readLock(cwd);

    for (const key of targets) {
      const adapter = adapters[key];
      if (!adapter) continue;

      const platformSchema = {
        agents: filtered.agents.filter((a) => a.expose && a.expose.length > 0 && a.expose.includes(key as never)),
        skills: filtered.skills,
        prompts: filtered.prompts,
      };

      const { changed, unchanged } = getChangedElements(platformSchema, key, lock);
      const lockCount = Object.keys(lock.targets[key] || {}).length;
      const schemaCount = platformSchema.agents.length + platformSchema.skills.length + platformSchema.prompts.length;

      if (changed.agents.length === 0 && changed.skills.length === 0 && changed.prompts.length === 0 && lockCount === schemaCount) continue;

      const resolved = resolveSchemaForPlatform(platformSchema, key);
      try {
        adapter.write(resolved, cwd);
        updateLock(lock, key, platformSchema);
        auditLog(cwd, "sync", key, `${schemaCount} elements`);
      } catch {
        // adapter write may fail (e.g. missing target dir) — skip silently
      }
    }

    writeLock(cwd, lock);
  } finally {
    if (origSuccess) consola.success = origSuccess;
    if (origInfo) consola.info = origInfo;
    if (origWarn) consola.warn = origWarn;
    syncing = false;
  }
}
