import { defineCommand } from "citty";
import { getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { listSnapshots, restoreSnapshot } from "../../core/snapshot.js";
import { consola } from "../../utils/logger.js";

export default defineCommand({
  meta: {
    name: "rollback",
    description: "Restore a previous snapshot (alias for snapshot restore)",
  },
  args: {
    restore: {
      type: "string",
      description: "Snapshot name to restore",
      alias: "r",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }

    const name = args.restore as string | undefined;
    if (name) {
      restoreSnapshot(cwd, name);
      return;
    }

    const snapshots = listSnapshots(cwd);
    if (snapshots.length === 0) {
      consola.warn("No snapshots found.");
      return;
    }

    consola.info("Snapshots:");
    for (const s of snapshots) {
      consola.log(`  ${s.name}`);
    }
    consola.log("");
    consola.log("Restore: af rollback --restore <name>");
  },
});
