import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { listElements, readElement, findReferences, getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";

export default defineCommand({
  meta: {
    name: "graph",
    description: "Show agent-to-skill dependency graph",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output JSON",
      alias: "j",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }

    const elements = listElements(cwd);
    const agents = elements.filter((e) => e.type === "agent");
    const nodes: Array<{ name: string; type: string; uses: string[]; referencedBy: string[] }> = [];

    for (const agent of agents) {
      const refs = findReferences(cwd, agent.name);
      const el = readElement(cwd, agent.name);
      const skills = (el?.data?.skills as Array<{ ref: string }> | undefined) || [];
      nodes.push({ name: agent.name, type: "agent", uses: skills.map((s) => s.ref), referencedBy: refs });
    }

    if (args.json) {
      consola.log(JSON.stringify({ nodes }, null, 2));
      return;
    }

    if (nodes.length === 0) {
      consola.info("No agents found.");
      return;
    }

    for (const n of nodes) {
      consola.log(`\n  ${n.name}`);
      if (n.uses.length > 0) {
        for (const s of n.uses) consola.log(`    uses skill: ${s}`);
      }
      if (n.referencedBy.length > 0) {
        for (const r of n.referencedBy) consola.log(`    referenced by: ${r}`);
      }
    }
  },
});
