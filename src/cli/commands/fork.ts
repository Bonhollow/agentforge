import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { getRegistryDir, initRegistry, writeRegistry, readRegistry } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { pullSharedElements } from "../../sync/share.js";

export default defineCommand({
  meta: {
    name: "fork",
    description: "Pull a single shared element into your local registry",
  },
  args: {
    ref: {
      type: "positional",
      description: "Reference in the form <owner>/<element-name>",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ref = args.ref as string;
    const parts = ref.split("/");

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      consola.error("Usage: af fork <owner>/<element-name>");
      return;
    }

    const [owner, elementName] = parts;

    if (!existsSync(getRegistryDir(cwd))) {
      initRegistry(cwd);
      consola.info("Initialized registry.");
    }

    consola.info(`Forking "${elementName}" from "${owner}"...`);

    try {
      const schema = await pullSharedElements(owner);
      const existing = readRegistry(cwd);

      let found = false;

      const merged = { ...existing };

      for (const agent of schema.agents) {
        if (agent.name === elementName && !existing.agents.some((a) => a.name === elementName)) {
          merged.agents = [...merged.agents, agent];
          found = true;
        }
      }

      for (const skill of schema.skills) {
        if (skill.name === elementName && !existing.skills.some((s) => s.name === elementName)) {
          merged.skills = [...merged.skills, skill];
          found = true;
        }
      }

      for (const prompt of schema.prompts) {
        if (prompt.name === elementName && !existing.prompts.some((p) => p.name === elementName)) {
          merged.prompts = [...merged.prompts, prompt];
          found = true;
        }
      }

      if (!found) {
        consola.error(`Element "${elementName}" not found in "${owner}"'s shared elements.`);
        return;
      }

      writeRegistry(cwd, merged);
      consola.success(`Forked "${elementName}" from "${owner}" into your registry.`);
    } catch (err) {
      consola.error(`Fork failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
