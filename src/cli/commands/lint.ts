import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default defineCommand({
  meta: {
    name: "lint",
    description: "Validate agentforge.json config fields",
  },
  args: {
    fix: {
      type: "boolean",
      description: "Auto-fix common issues",
      alias: "f",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const configPath = join(cwd, "agentforge.json");

    if (!existsSync(configPath)) {
      consola.info("No agentforge.json found.");
      return;
    }

    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      const issues: string[] = [];
      const fixes: string[] = [];

      if (!config.version) issues.push("Missing 'version' field (add \"version\": \"0.1.0\")");
      if (config.platforms) {
        if (!Array.isArray(config.platforms)) issues.push("'platforms' must be an array");
      }
      if (config.vars && typeof config.vars !== "object") issues.push("'vars' must be an object");
      if (config.hooks && typeof config.hooks !== "object") issues.push("'hooks' must be an object");
      if (config.ignore && !Array.isArray(config.ignore)) issues.push("'ignore' must be an array");

      if (args.fix && !config.version) {
        config.version = "0.1.0";
        fixes.push("Added missing 'version': \"0.1.0\"");
      }

      if (fixes.length > 0) {
        writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
        for (const f of fixes) consola.info(f);
      }

      if (issues.length === 0) {
        consola.success("agentforge.json looks good.");
      } else {
        consola.warn(`Found ${issues.length} issue(s):`);
        for (const issue of issues) consola.log(`  \u2716 ${issue}`);
      }
    } catch (err) {
      consola.error(`Failed to parse: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
