import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { existsSync } from "node:fs";
import { getRegistryDir, initRegistry, writeRegistry, readRegistry } from "../../core/registry.js";
import { claudeCodeAdapter } from "../../adapters/claude-code.js";
import { codexAdapter } from "../../adapters/codex.js";
import { opencodeAdapter } from "../../adapters/opencode.js";
import { cursorAdapter } from "../../adapters/cursor.js";
import { windsurfAdapter } from "../../adapters/windsurf.js";
import type { Adapter } from "../../adapters/base.js";
import type { UniversalSchema, SupportedTarget } from "../../core/schema.js";
import { auditLog } from "../../core/audit.js";
import { syncExposed } from "../../core/sync.js";

const adapters: Record<string, Adapter> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  windsurf: windsurfAdapter,
};

function mergeSchema(target: UniversalSchema, source: UniversalSchema): void {
  for (const agent of source.agents) {
    if (!target.agents.some((a) => a.name === agent.name)) {
      target.agents.push(agent);
    }
  }
  for (const skill of source.skills) {
    if (!target.skills.some((s) => s.name === skill.name)) {
      target.skills.push(skill);
    }
  }
  for (const prompt of source.prompts) {
    if (!target.prompts.some((p) => p.name === prompt.name)) {
      target.prompts.push(prompt);
    }
  }
}

export default defineCommand({
  meta: {
    name: "import",
    description: "Import agents, skills and prompts from platform config files",
  },
  args: {
    from: {
      type: "string",
      description: "Source platform: claude_code, codex, opencode, cursor, or auto-detect",
      default: "auto",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const from = args.from as string;

    const sources = from === "auto"
      ? Object.entries(adapters).filter(([, a]) => a.detect(cwd))
      : (adapters[from as SupportedTarget]
        ? [[from, adapters[from as SupportedTarget]] as [string, Adapter]]
        : []);

    if (sources.length === 0) {
      if (from === "auto") {
        consola.error("No supported platform config files detected in this directory.");
        consola.log("Looked for: opencode.json, AGENTS.md, CLAUDE.md, .cursorrules");
      } else {
        consola.error(`No config found for "${from}". Supported: ${Object.keys(adapters).join(", ")}, auto`);
      }
      return;
    }

    if (!existsSync(getRegistryDir(cwd))) {
      initRegistry(cwd, false);
    }

    const merged: UniversalSchema = from === "auto" ? readRegistry(cwd) : { agents: [], skills: [], prompts: [] };

    for (const [key, adapter] of sources) {
      consola.info(`Reading from ${adapter.name}...`);
      try {
        const schema = adapter.read(cwd);
        mergeSchema(merged, schema);
        consola.success(`Imported ${schema.agents.length} agent(s), ${schema.skills.length} skill(s) from ${adapter.name}`);
      } catch (err) {
        consola.error(`Failed to import from ${adapter.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    writeRegistry(cwd, merged);

    const total = merged.agents.length + merged.skills.length + merged.prompts.length;
    consola.success(`Registry now has ${merged.agents.length} agent(s), ${merged.skills.length} skill(s), ${merged.prompts.length} prompt(s) (${total} total).`);
    syncExposed(cwd);
  },
});
