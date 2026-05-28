import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { removeElement } from "../../core/registry.js";
import { auditLog } from "../../core/audit.js";
import { syncExposed } from "../../core/sync.js";

export default defineCommand({
  meta: {
    name: "remove",
    description: "Remove an element",
  },
  args: {
    name: {
      type: "positional",
      description: "Element name",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();

    const ok = removeElement(cwd, args.name as string);
    if (!ok) {
      consola.error(`Element "${args.name}" not found.`);
      return;
    }

    auditLog(cwd, "remove", args.name as string);
    consola.success(`Removed element "${args.name}".`);
    syncExposed(cwd);
  },
});
