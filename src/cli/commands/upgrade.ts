import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export default defineCommand({
  meta: {
    name: "upgrade",
    description: "Check for and install the latest version of agentforge",
  },
  async run() {
    consola.info("Checking for updates...");

    try {
      const res = await fetch("https://registry.npmjs.org/@bonhollow/agentforge/latest");
      if (!res.ok) {
        consola.error("Could not reach npm registry.");
        return;
      }
      const data = await res.json() as any;
      const latest = data.version as string;

      const __dirname = dirname(fileURLToPath(import.meta.url));
      const pkgPath = join(__dirname, "..", "..", "..", "package.json");
      let current = "0.0.0";
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        current = pkg.version || current;
      } catch {
        // continue
      }

      consola.info(`Current: ${current}, Latest: ${latest}`);

      if (current === latest) {
        consola.success("Already up to date.");
        return;
      }

      consola.info(`Upgrading ${current} -> ${latest}...`);
      execSync("npm install -g @bonhollow/agentforge", { stdio: "inherit" });
      consola.success(`Upgraded to ${latest}.`);
    } catch (err) {
      consola.error(`Upgrade failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
