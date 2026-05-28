import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default defineCommand({
  meta: {
    name: "version",
    description: "Show version info",
  },
  async run() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    consola.log(`agentforge v${pkg.version}`);
  },
});
