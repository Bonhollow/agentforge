import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readRegistry, getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { diffSchemas, formatDiff } from "../../core/diff.js";
import { readRemoteRegistry } from "../../sync/pull.js";
import { getChangedElements, readLock } from "../../core/lock.js";
import { loadConfig } from "../../core/config.js";
import { DEFAULT_EXPOSE, filterAgentsByExpose } from "../../core/platforms.js";
import { loadVars, resolveSchemaVars } from "../../core/vars.js";
import { loadIgnore, filterIgnored } from "../../core/ignore.js";
import { colors as C } from "../../utils/colors.js";

import { claudeCodeAdapter } from "../../adapters/claude-code.js";
import { codexAdapter } from "../../adapters/codex.js";
import { opencodeAdapter } from "../../adapters/opencode.js";
import { cursorAdapter } from "../../adapters/cursor.js";
import { windsurfAdapter } from "../../adapters/windsurf.js";
import { continueAdapter } from "../../adapters/continue.js";
import { piMonoAdapter } from "../../adapters/pi-mono.js";
import { antigravityAdapter } from "../../adapters/antigravity.js";

const adapters: Record<string, { name: string }> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  windsurf: windsurfAdapter,
  continue_dev: continueAdapter,
  pi_mono: piMonoAdapter,
  antigravity: antigravityAdapter,
};

export default defineCommand({
  meta: {
    name: "status",
    description: "Show a consolidated status of local registry sync and platform exports",
  },
  async run() {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    consola.info(`${C.bold}--- AgentForge Workspace Status ---${C.reset}\n`);

    const rawSchema = readRegistry(cwd);
    const vars = loadVars(cwd);
    const ignoreRules = loadIgnore(cwd);
    const filtered = {
      agents: filterIgnored(rawSchema.agents, ignoreRules),
      skills: filterIgnored(rawSchema.skills, ignoreRules),
      prompts: filterIgnored(rawSchema.prompts, ignoreRules),
    };
    const schema = resolveSchemaVars(filtered, vars);

    consola.log(`${C.bold}Local Elements:${C.reset}`);
    consola.log(`  Agents:  ${schema.agents.length}`);
    consola.log(`  Skills:  ${schema.skills.length}`);
    consola.log(`  Prompts: ${schema.prompts.length}\n`);

    // 1. Cloud Sync Status
    consola.log(`${C.bold}Cloud Sync Status:${C.reset}`);
    const remote = await readRemoteRegistry();
    if (!remote) {
      consola.warn("  Remote registry unavailable or offline.\n");
    } else {
      const diff = diffSchemas(schema, remote);
      if (!diff.hasChanges) {
        consola.success("  ✓ Local and remote registries are in sync.\n");
      } else {
        consola.warn("  ✗ Local and remote registries have diverged.");
        let added = 0;
        let removed = 0;
        for (const change of diff.changes) {
          if (change.added) added += change.count || 1;
          if (change.removed) removed += change.count || 1;
        }
        consola.log(`    Cloud has ${added} line additions / Local has ${removed} line differences.`);
        consola.log("    Run `af sync status` or `af diff` to view full differences.\n");
      }
    }

    // 2. Platform Export Status
    consola.log(`${C.bold}Platform Export Status:${C.reset}`);
    const lock = readLock(cwd);
    const cfg = loadConfig(cwd);
    const targets = cfg.platforms ?? DEFAULT_EXPOSE;

    let upToDateCount = 0;
    for (const key of targets) {
      const adapter = adapters[key];
      if (!adapter) continue;

      const platformSchema = {
        agents: filterAgentsByExpose(schema.agents, key),
        skills: schema.skills,
        prompts: schema.prompts,
      };

      const { changed } = getChangedElements(platformSchema, key, lock);
      const totalChanges = changed.agents.length + changed.skills.length + changed.prompts.length;

      if (totalChanges === 0) {
        consola.success(`  ✓ ${adapter.name}: Up to date`);
        upToDateCount++;
      } else {
        consola.warn(`  ✗ ${adapter.name}: Out of date (${totalChanges} element(s) changed)`);
        if (changed.agents.length > 0) consola.log(`    - Agents: ${changed.agents.map(a => a.name).join(", ")}`);
        if (changed.skills.length > 0) consola.log(`    - Skills: ${changed.skills.map(s => s.name).join(", ")}`);
        if (changed.prompts.length > 0) consola.log(`    - Prompts: ${changed.prompts.map(p => p.name).join(", ")}`);
      }
    }

    if (targets.length === 0) {
      consola.info("  No platform targets configured in config.yaml.");
    } else if (upToDateCount === targets.length) {
      consola.success("\n  ✓ All platform configurations are fully up to date.");
    } else {
      consola.info("\n  Run `af export` to compile and write changes to all platform directories.");
    }
  },
});
