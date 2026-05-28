import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { getRegistryDir, writeRegistry, initRegistry, readRegistry } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { pullSharedElements } from "../../sync/share.js";
import type { UniversalSchema } from "../../core/schema.js";

export default defineCommand({
  meta: {
    name: "pull",
    description: "Pull shared elements from a user or org",
  },
  args: {
    from: {
      type: "string",
      description: "Owner (user or org) to pull shared elements from",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const from = args.from as string;

    if (!existsSync(getRegistryDir(cwd))) {
      initRegistry(cwd);
      consola.info("Initialized registry.");
    }

    consola.info(`Pulling shared elements from "${from}"...`);

    try {
      const schema = await pullSharedElements(from);
      const total = schema.agents.length + schema.skills.length + schema.prompts.length;

      if (total === 0) {
        consola.warn(`No shared elements found for "${from}".`);
        return;
      }

      const existing = readRegistry(cwd);
      const merged = mergeInto(existing, schema);
      writeRegistry(cwd, merged);

      consola.success(`Pulled ${total} shared element(s) from "${from}".`);
    } catch (err) {
      consola.error(`Pull failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

function mergeInto(target: UniversalSchema, source: UniversalSchema): UniversalSchema {
  const seenAgents = new Set(target.agents.map((a) => a.name));
  const seenSkills = new Set(target.skills.map((s) => s.name));
  const seenPrompts = new Set(target.prompts.map((p) => p.name));

  return {
    agents: [...target.agents, ...source.agents.filter((a) => !seenAgents.has(a.name))],
    skills: [...target.skills, ...source.skills.filter((s) => !seenSkills.has(s.name))],
    prompts: [...target.prompts, ...source.prompts.filter((p) => !seenPrompts.has(p.name))],
  };
}
