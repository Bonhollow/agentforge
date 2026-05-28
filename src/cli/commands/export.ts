import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readRegistry } from "../../core/registry.js";
import { getRegistryDir } from "../../core/registry.js";
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import { claudeCodeAdapter } from "../../adapters/claude-code.js";
import { codexAdapter } from "../../adapters/codex.js";
import { opencodeAdapter } from "../../adapters/opencode.js";
import { cursorAdapter } from "../../adapters/cursor.js";
import { windsurfAdapter } from "../../adapters/windsurf.js";
import { loadVars, resolveSchemaVars } from "../../core/vars.js";
import { readLock, writeLock, getChangedElements, updateLock } from "../../core/lock.js";
import { runHook } from "../../core/hooks.js";
import { loadConfig, resolvePlatforms } from "../../core/config.js";
import { checkTokenBudget } from "../../core/tokens.js";
import { createSnapshot } from "../../core/snapshot.js";
import { resolveSchemaForPlatform } from "../../core/overrides.js";
import { readMCPServers } from "../../core/mcp.js";
import { loadIgnore, filterIgnored } from "../../core/ignore.js";
import { auditLog } from "../../core/audit.js";
import { recordModelVersion, checkModelVersion } from "../../core/model-versions.js";

const adapters: Record<string, Adapter> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  windsurf: windsurfAdapter,
};

import type { Adapter } from "../../adapters/base.js";

interface ExportResult {
  target: string;
  name: string;
  agents: number;
  skills: number;
  prompts: number;
  skipped: number;
  status: "written" | "skipped" | "error";
  error?: string;
}

function doExport(cwd: string, target: string, dryRun: boolean, jsonMode: boolean, model?: string): ExportResult[] {
  const results: ExportResult[] = [];

  if (!existsSync(getRegistryDir(cwd))) {
    if (jsonMode) {
      results.push({ target, name: "error", agents: 0, skills: 0, prompts: 0, skipped: 0, status: "error", error: "No registry found" });
    }
    return results;
  }

  const vars = loadVars(cwd);
  const rawSchema = readRegistry(cwd);
  const ignoreRules = loadIgnore(cwd);

  const filtered: typeof rawSchema = {
    agents: filterIgnored(rawSchema.agents, ignoreRules),
    skills: filterIgnored(rawSchema.skills, ignoreRules),
    prompts: filterIgnored(rawSchema.prompts, ignoreRules),
  };

  const schema = resolveSchemaVars(filtered, vars);
  const lock = readLock(cwd);
  const cfg = loadConfig(cwd);
  const targets = resolvePlatforms(cfg, target);

  if (!dryRun) {
    createSnapshot(cwd);
  }

  for (const key of targets) {
    const adapter = adapters[key];
    if (!adapter) {
      if (jsonMode) {
        results.push({ target: key, name: "unknown", agents: 0, skills: 0, prompts: 0, skipped: 0, status: "error", error: "Unknown platform" });
      }
      continue;
    }

    const budgetWarnings = checkTokenBudget(schema, key);
    for (const w of budgetWarnings) {
      consola.warn(`${w.agent} on ${key}: ~${w.tokens.toLocaleString()} tokens (${w.label} of ${w.limit.toLocaleString()} limit)`);
    }

    if (model) {
      const cfgModel = cfg.model_versions?.[key];
      const effectiveModel = cfgModel || model;
      const drift = checkModelVersion(cwd, key, effectiveModel);
      if (drift) {
        consola.warn(`${key}: ${drift}`);
      }
    }

    const { changed, unchanged } = getChangedElements(schema, key, lock);
    if (changed.agents.length === 0 && changed.skills.length === 0 && changed.prompts.length === 0) {
      if (jsonMode) {
        results.push({ target: key, name: adapter.name, agents: 0, skills: 0, prompts: 0, skipped: unchanged, status: "skipped" });
      }
      continue;
    }

    const platformSchema = resolveSchemaForPlatform(changed, key);

    // Resolve MCP server fields from global registry for tools missing them
    const mcpConfig = readMCPServers(cwd);
    for (const agent of platformSchema.agents) {
      agent.tools = agent.tools.map((tool) => {
        if (typeof tool !== "string" && tool.type === "mcp") {
          const registered = mcpConfig.servers[tool.name];
          if (registered) {
            const { description: _d, ...fields } = registered;
            return { ...tool, ...fields };
          }
        }
        return tool;
      });
    }

    if (dryRun) {
      const total = changed.agents.length + changed.skills.length + changed.prompts.length;
      if (jsonMode) {
        results.push({ target: key, name: adapter.name, agents: changed.agents.length, skills: changed.skills.length, prompts: changed.prompts.length, skipped: unchanged, status: "skipped", error: "dry-run" });
      }
    } else {
      runHook("pre_export", key, cwd);
      adapter.write(platformSchema, cwd);
      runHook("post_export", key, cwd);
      updateLock(lock, key, changed);
      auditLog(cwd, "export", key, `${changed.agents.length + changed.skills.length + changed.prompts.length} elements`);

      if (model) {
        const cfgModel = cfg.model_versions?.[key];
        recordModelVersion(cwd, key, cfgModel || model);
      }

      if (jsonMode) {
        results.push({ target: key, name: adapter.name, agents: changed.agents.length, skills: changed.skills.length, prompts: changed.prompts.length, skipped: unchanged, status: "written" });
      }
    }
  }

  if (!dryRun) {
    writeLock(cwd, lock);
  }

  return results;
}

export default defineCommand({
  meta: {
    name: "export",
    description: "Export registry to platform-native formats",
  },
  args: {
    target: {
      type: "positional",
      description: "Target platform: claude_code, codex, opencode, cursor, windsurf, or all (default: all)",
      default: "all",
    },
    "dry-run": {
      type: "boolean",
      description: "Preview output without writing",
      default: false,
    },
    watch: {
      type: "boolean",
      description: "Watch .agentforge/ for changes and re-export automatically",
      alias: "w",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output structured JSON summary",
      alias: "j",
      default: false,
    },
    model: {
      type: "string",
      description: "Model version targeting this export (e.g. gpt-4o, claude-3-5-sonnet). Records and warns on drift.",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const target = args.target as string;
    const dryRun = args["dry-run"] as boolean;
    const watchMode = args.watch as boolean;
    const jsonMode = args.json as boolean;
    const model = args.model as string | undefined;

    const results = doExport(cwd, target, dryRun, jsonMode, model);

    if (jsonMode) {
      consola.log(JSON.stringify({ export: results }, null, 2));
      return;
    }

    for (const r of results) {
      if (r.status === "written") {
        consola.success(`${r.name}: wrote ${r.agents + r.skills + r.prompts} elements (${r.skipped} skipped)`);
      } else if (r.status === "skipped") {
        consola.info(`${r.name}: all ${r.skipped} elements unchanged, skipped.`);
      }
    }

    if (watchMode) {
      const regDir = getRegistryDir(cwd);
      if (!existsSync(regDir)) return;

      consola.info(`Watching ${regDir} for changes...`);

      const debounce = new Map<string, NodeJS.Timeout>();

      const watcher = watch(regDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith("~") || filename.startsWith(".")) return;

        const key = filename.toString();
        if (debounce.has(key)) clearTimeout(debounce.get(key)!);

        debounce.set(key, setTimeout(() => {
          debounce.delete(key);
          const ts = new Date().toLocaleTimeString();
          consola.log(`\n[${ts}] Change detected: ${key}`);
          doExport(cwd, target, false, false);
        }, 300));
      });

      process.on("SIGINT", () => {
        watcher.close();
        process.exit(0);
      });

      await new Promise(() => {});
    }
  },
});
