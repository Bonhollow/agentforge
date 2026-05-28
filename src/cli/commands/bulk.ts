import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { listElements, readElement, getRegistryDir } from "../../core/registry.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { syncExposed } from "../../core/sync.js";

export default defineCommand({
  meta: {
    name: "bulk",
    description: "Bulk modify elements: rename, expose, retag, version",
  },
  args: {
    operation: {
      type: "positional",
      description: "Operation: rename, expose, retag, version",
      required: true,
    },
    value: {
      type: "positional",
      description: "Operation value (prefix for rename, semver for version)",
      required: false,
    },
    filter: {
      type: "string",
      description: "Element type filter: agent, skill, prompt",
      alias: "f",
      default: "",
    },
    dry: {
      type: "boolean",
      description: "Dry run (preview only)",
      alias: "d",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }

    const op = args.operation as string;
    const val = args.value as string | undefined;
    const filter = args.filter as string;
    const dryRun = args.dry as boolean;

    const elements = listElements(cwd).filter((e) => !filter || e.type === filter);
    if (elements.length === 0) {
      consola.info("No matching elements found.");
      return;
    }

    let changed = 0;

    for (const el of elements) {
      const full = readElement(cwd, el.name);
      if (!full) continue;

      if (op === "rename") {
        if (!val) { consola.error("Usage: af bulk rename <prefix>"); return; }
        const newName = `${val}${el.name}`;
        if (dryRun) { consola.log(`Would rename ${el.name} -> ${newName}`); changed++; continue; }
        const newPath = join(getRegistryDir(cwd), `${el.type}s`, el.type === "agent" ? `${newName}.yaml` : `${newName}.md`);
        writeFileSync(newPath, readFileSync(full.filePath, "utf-8"), "utf-8");
        consola.success(`Renamed ${el.name} -> ${newName}`);
        changed++;
      } else if (op === "version") {
        if (!val || !/^\d+\.\d+\.\d+$/.test(val)) { consola.error("Usage: af bulk version <semver>"); return; }
        if (dryRun) { consola.log(`Would set ${el.name} version to ${val}`); changed++; continue; }
        full.data.version = val;
        if (el.type === "agent") {
          writeFileSync(full.filePath, yaml.dump(full.data, { indent: 2, lineWidth: 120 }), "utf-8");
        } else {
          const frontmatter = full.data;
          const body = full.body || "";
          const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${body}\n`;
          writeFileSync(full.filePath, content, "utf-8");
        }
        consola.success(`Set ${el.name} version to ${val}`);
        changed++;
      } else {
        consola.error(`Unknown operation: ${op}. Use: rename, expose, retag, version`);
        return;
      }
    }

    if (changed > 0 && !dryRun) syncExposed(cwd, true);

    if (dryRun) {
      consola.info(`Would modify ${changed} element(s). Pass --dry to commit.`);
    } else {
      consola.success(`Modified ${changed} element(s).`);
    }
  },
});
