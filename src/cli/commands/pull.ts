import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { getRegistryDir, writeRegistry, initRegistry, readRegistry } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { pullSharedElements } from "../../sync/share.js";
import { UniversalSchema } from "../../core/schema.js";

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
    element: {
      type: "positional",
      description: "Specific element name to pull (optional)",
      required: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const from = args.from as string;
    const elementName = args.element as string | undefined;

    if (!existsSync(getRegistryDir(cwd))) {
      initRegistry(cwd);
      consola.info("Initialized registry.");
    }

    if (elementName) {
      consola.info(`Pulling shared element "${elementName}" from "${from}"...`);
    } else {
      consola.info(`Pulling shared elements from "${from}"...`);
    }

    try {
      const rawSchema = await pullSharedElements(from, elementName);
      const parsed = UniversalSchema.safeParse(rawSchema);
      if (!parsed.success) {
        consola.error(`Invalid pulled data: ${parsed.error.message}`);
        return;
      }
      const schema = parsed.data;
      const total = schema.agents.length + schema.skills.length + schema.prompts.length;

      if (total === 0) {
        if (elementName) {
          consola.warn(`Shared element "${elementName}" not found for "${from}".`);
        } else {
          consola.warn(`No shared elements found for "${from}".`);
        }
        return;
      }

      const existing = readRegistry(cwd);
      const merged = mergeInto(existing, schema);
      writeRegistry(cwd, merged);

      if (elementName) {
        consola.success(`Pulled shared element "${elementName}" from "${from}".`);
      } else {
        consola.success(`Pulled ${total} shared element(s) from "${from}".`);
      }
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
