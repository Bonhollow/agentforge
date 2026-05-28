import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { listElements, readElement, getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";

export default defineCommand({
  meta: {
    name: "search",
    description: "Search inside system prompts, skill bodies, and prompt bodies",
  },
  args: {
    query: {
      type: "positional",
      description: "Search term",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }

    const q = (args.query as string).toLowerCase();
    const elements = listElements(cwd);
    let found = 0;

    for (const el of elements) {
      const full = readElement(cwd, el.name);
      if (!full) continue;
      const text = full.body || "";
      const dataStr = JSON.stringify(full.data).toLowerCase();
      const bodyLower = text.toLowerCase();
      if (dataStr.includes(q) || bodyLower.includes(q)) {
        const idx = bodyLower.indexOf(q);
        const snippet = idx >= 0
          ? text.slice(Math.max(0, idx - 40), idx + q.length + 40).replace(/\n/g, " ")
          : "(match in metadata)";
        consola.log(`${el.type}:${el.name}  ${snippet.length > 80 ? snippet.slice(0, 80) + "..." : snippet}`);
        found++;
      }
    }

    if (found === 0) {
      consola.info(`No matches for "${args.query}"`);
    } else {
      consola.success(`Found ${found} match(es)`);
    }
  },
});
