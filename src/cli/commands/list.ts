import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { listElements } from "../../core/registry.js";
import { getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { colorType, colorName } from "../../utils/colors.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "Show all elements (agents, skills, prompts)",
  },
  args: {
    type: {
      type: "string",
      description: "Filter by type: agent, skill, or prompt",
      required: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    const elements = listElements(cwd, args.type as string | undefined);

    if (elements.length === 0) {
      consola.info("No elements found.");
      return;
    }

    for (const el of elements) {
      consola.log(`${colorType(el.type).padEnd(14)} ${colorName(el.name, el.type).padEnd(28)} v${el.version.padEnd(8)} ${el.description}`);
    }
  },
});
