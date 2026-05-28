import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getRegistryDir } from "../../core/registry.js";
import { validateElement, fixElement, lintElement } from "../../core/validate.js";
import { loadConfig } from "../../core/config.js";

export default defineCommand({
  meta: {
    name: "validate",
    description: "Lint and validate all schema files",
  },
  args: {
    fix: {
      type: "boolean",
      description: "Auto-correct common schema issues",
      alias: "f",
      default: false,
    },
    lint: {
      type: "boolean",
      description: "Apply configurable lint rules from config.yaml",
      alias: "l",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    const regDir = getRegistryDir(cwd);
    const dirs = ["agents", "skills", "prompts"];
    const cfg = loadConfig(cwd);
    const lintCfg = cfg.lint;
    let totalErrors = 0;
    let totalFixes = 0;

    for (const dir of dirs) {
      const dirPath = join(regDir, dir);
      if (!existsSync(dirPath)) continue;

      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        const filePath = join(dirPath, entry);

        if (args.fix) {
          const result = fixElement(filePath);
          for (const fix of result.fixes) {
            consola.info(`${entry}: ${fix}`);
            totalFixes++;
          }
        }

        const errors = validateElement(filePath);
        for (const err of errors) {
          consola.error(`${entry}: ${err.message}`);
          totalErrors++;
        }

        if (args.lint && lintCfg) {
          const lintErrors = lintElement(filePath, lintCfg);
          for (const err of lintErrors) {
            consola.warn(`${entry}: ${err.message}`);
            totalErrors++;
          }
        }

        if (errors.length === 0) {
          consola.success(`${entry} ok`);
        }
      }
    }

    if (totalFixes > 0) {
      consola.success(`${totalFixes} issue(s) fixed.`);
    }

    if (totalErrors === 0) {
      consola.success("All elements valid.");
    } else {
      consola.error(`${totalErrors} error(s) remaining.`);
    }
  },
});
