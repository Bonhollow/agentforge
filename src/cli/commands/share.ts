import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readElement, getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { pushSharedElement, detectOwner } from "../../sync/share.js";
import { loadIgnore, isIgnored } from "../../core/ignore.js";
import { auditLog } from "../../core/audit.js";

export default defineCommand({
  meta: {
    name: "share",
    description: "Share an element to the public registry",
  },
  args: {
    name: {
      type: "positional",
      description: "Element name to share",
      required: true,
    },
    owner: {
      type: "string",
      description: "Owner name (default: AF_SHARE_OWNER env or git user.name)",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    const name = args.name as string;
    const ignoreRules = loadIgnore(cwd);
    if (isIgnored(name, ignoreRules)) {
      consola.warn(`"${name}" is excluded by .agentforgeignore — not sharing.`);
      return;
    }

    const el = readElement(cwd, name);
    if (!el) {
      consola.error(`Element "${name}" not found in local registry.`);
      return;
    }

    const owner = (args.owner as string) || detectOwner();
    if (!owner) {
      consola.error("Could not determine owner. Set AF_SHARE_OWNER env var, pass --owner, or configure git user.name.");
      return;
    }

    try {
      await pushSharedElement(owner, el.type as "agent" | "skill" | "prompt", name, (el.data.version as string) || "1.0.0", el.data as Record<string, unknown>);
      auditLog(cwd, "share", name, owner);
      consola.success(`Shared "${name}" (${el.type}) as ${owner}.`);
    } catch (err) {
      consola.error(`Share failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
