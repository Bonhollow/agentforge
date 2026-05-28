import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { diffSchemas, formatDiff } from "../../core/diff.js";
import { readRegistry } from "../../core/registry.js";
import { getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";

export default defineCommand({
  meta: {
    name: "diff",
    description: "Diff local vs remote registry",
  },
  async run() {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    const local = readRegistry(cwd);
    const result = diffSchemas(local, null);
    consola.log(formatDiff(result));
  },
});
