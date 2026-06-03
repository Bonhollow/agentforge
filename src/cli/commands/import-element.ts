import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readFileSync, existsSync } from "node:fs";
import { saveElement } from "../../core/registry.js";
import { RegistryElement } from "../../core/schema.js";
import { syncExposed } from "../../core/sync.js";
import yaml from "js-yaml";

export default defineCommand({
  meta: {
    name: "import-element",
    description: "Import a single agent, skill, or prompt from a JSON/YAML file or stdin",
  },
  args: {
    file: {
      type: "positional",
      description: "File path (omit for stdin/paste)",
      required: false,
      default: "",
    },
    paste: {
      type: "boolean",
      description: "Force paste mode (read from stdin)",
      alias: "p",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const fileArg = args.file as string;
    const pasteMode = args.paste as boolean;

    let raw: string;

    if (fileArg && !pasteMode) {
      if (!existsSync(fileArg)) {
        consola.error(`File not found: ${fileArg}`);
        return;
      }
      raw = readFileSync(fileArg, "utf-8");
      consola.info(`Read ${fileArg}`);
    } else {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin });
      const lines: string[] = [];
      consola.info("Paste JSON/YAML (Ctrl+D to end, Ctrl+C to cancel):");
      for await (const line of rl) {
        lines.push(line);
      }
      raw = lines.join("\n");
      if (!raw.trim()) {
        consola.error("No input provided.");
        return;
      }
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch {
      try {
        parsed = JSON.parse(raw);
      } catch {
        consola.error("Could not parse input as YAML or JSON.");
        return;
      }
    }

    const result = RegistryElement.safeParse(parsed);
    if (!result.success) {
      consola.error(`Invalid element data: ${result.error.message}`);
      return;
    }

    const { type, data } = result.data;
    const filePath = saveElement(cwd, type, data.name, data);
    consola.success(`Imported ${type} "${data.name}" -> ${filePath}`);
    syncExposed(cwd, true);
  },
});
