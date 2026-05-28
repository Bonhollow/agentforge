import { defineCommand } from "citty";
import { readElement } from "../../core/registry.js";
import { getRegistryDir } from "../../core/registry.js";
import { consola } from "../../utils/logger.js";
import { existsSync } from "node:fs";
import yaml from "js-yaml";
import { colorType } from "../../utils/colors.js";

export default defineCommand({
  meta: {
    name: "show",
    description: "Inspect a specific element",
  },
  args: {
    name: {
      type: "positional",
      description: "Element name",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    const el = readElement(cwd, args.name as string);
    if (!el) {
      consola.error(`Element "${args.name}" not found.`);
      return;
    }

    consola.log(`Type: ${colorType(el.type)}`);
    consola.log(yaml.dump(el.data, { indent: 2, lineWidth: 120 }));

    if (el.body) {
      consola.log("--- Body ---");
      consola.log(el.body);
    }
  },
});
