import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { existsSync } from "node:fs";
import { getRegistryDir } from "../../core/registry.js";
import { join } from "node:path";

export default defineCommand({
  meta: {
    name: "use",
    description: "Activate agent for current project",
  },
  args: {
    name: {
      type: "positional",
      description: "Agent name",
      required: true,
    },
    global: {
      type: "boolean",
      description: "Set as default across all projects",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    const target = args.global
      ? join(process.env.HOME || "~", ".agentforge", ".active-agent")
      : join(getRegistryDir(cwd), ".active-agent");

    const fs = await import("node:fs");
    fs.writeFileSync(target, (args.name as string) + "\n", "utf-8");
    consola.success(`Agent "${args.name}" is now active.`);
  },
});
