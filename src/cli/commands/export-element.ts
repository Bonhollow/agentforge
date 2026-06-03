import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readElement } from "../../core/registry.js";
import yaml from "js-yaml";

export default defineCommand({
  meta: {
    name: "export-element",
    description: "Export a single agent, skill, or prompt as JSON or YAML",
  },
  args: {
    name: {
      type: "positional",
      description: "Element name to export",
      required: false,
    },
    file: {
      type: "positional",
      description: "Output file path (omit for stdout)",
      required: false,
      default: "",
    },
    format: {
      type: "string",
      description: "Output format: json or yaml (default: yaml)",
      default: "yaml",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const name = args.name as string | undefined;
    const filePath = args.file as string;
    const format = args.format as string;

    let elementName = name;
    if (!elementName) {
      const { listElements } = await import("../../core/registry.js");
      const elements = listElements(cwd);
      if (elements.length === 0) {
        consola.error("No elements found in registry.");
        return;
      }
      consola.log("Available elements:");
      for (const e of elements) {
        consola.log(`  ${e.type.padEnd(10)} ${e.name.padEnd(28)} v${e.version}`);
      }
      return;
    }

    const el = readElement(cwd, elementName);
    if (!el) {
      consola.error(`Element "${elementName}" not found.`);
      return;
    }

    const output = { type: el.type, data: el.body ? { ...el.data, body: el.body } : el.data };
    const serialized = format === "json"
      ? JSON.stringify(output, null, 2)
      : yaml.dump(output, { indent: 2, lineWidth: 120 });

    if (filePath) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, serialized, "utf-8");
      consola.success(`Exported "${elementName}" to ${filePath}`);
    } else {
      consola.log(serialized);
    }
  },
});
