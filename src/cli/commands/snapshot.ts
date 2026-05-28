import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { createSnapshot, listSnapshots, restoreSnapshot, diffSnapshot } from "../../core/snapshot.js";

const listCmd = defineCommand({
  meta: { name: "list", description: "List snapshots" },
  async run() {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }

    const snapshots = listSnapshots(cwd);
    if (snapshots.length === 0) {
      consola.warn("No snapshots found. Create one: af snapshot save <name>");
      return;
    }

    consola.info(`${snapshots.length} snapshot(s):`);
    for (const s of snapshots) {
      consola.log(`  ${s.name}  (${s.stamp})`);
    }
  },
});

const saveCmd = defineCommand({
  meta: { name: "save", description: "Create a named snapshot" },
  args: {
    name: {
      type: "positional",
      description: "Snapshot name (e.g. 'before refactor')",
      required: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }
    createSnapshot(cwd, (args.name as string) || undefined);
  },
});

const restoreCmd = defineCommand({
  meta: { name: "restore", description: "Restore a snapshot" },
  args: {
    name: {
      type: "positional",
      description: "Snapshot name to restore",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }
    restoreSnapshot(cwd, args.name as string);
  },
});

const diffCmd = defineCommand({
  meta: { name: "diff", description: "Diff current registry against a snapshot" },
  args: {
    name: {
      type: "positional",
      description: "Snapshot name to compare against",
      required: true,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }
    const output = diffSnapshot(cwd, args.name as string);
    if (output) {
      consola.log(output);
    }
  },
});

export default defineCommand({
  meta: {
    name: "snapshot",
    description: "List, create, restore, and diff registry snapshots",
  },
  subCommands: {
    list: listCmd,
    save: saveCmd,
    restore: restoreCmd,
    diff: diffCmd,
  },
});
