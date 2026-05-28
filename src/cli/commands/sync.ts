import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { pushRegistry } from "../../sync/push.js";
import { pullRegistry, readRemoteRegistry } from "../../sync/pull.js";
import { getRegistryDir, readRegistry } from "../../core/registry.js";
import { existsSync } from "node:fs";
import { diffSchemas, formatDiff } from "../../core/diff.js";

function backendHint(): string {
  return process.env.AF_SYNC_BACKEND || "supabase";
}

export default defineCommand({
  meta: {
    name: "sync",
    description: `Sync registry (backend: ${backendHint()})`,
  },
  subCommands: {
    push: defineCommand({
      meta: { name: "push", description: "Push local registry to Supabase" },
      async run() {
        const cwd = process.cwd();
        if (!existsSync(getRegistryDir(cwd))) {
          consola.error("No registry found. Run `af init` first.");
          return;
        }
        await pushRegistry(cwd);
      },
    }),
    pull: defineCommand({
      meta: { name: "pull", description: "Pull remote registry" },
      async run() {
        const cwd = process.cwd();
        if (!existsSync(getRegistryDir(cwd))) {
          consola.error("No registry found. Run `af init` first.");
          return;
        }
        await pullRegistry(cwd);
      },
    }),
    status: defineCommand({
      meta: { name: "status", description: "Show local vs remote diff" },
      async run() {
        const cwd = process.cwd();
        const local = existsSync(getRegistryDir(cwd)) ? readRegistry(cwd) : null;

        if (local) {
          consola.info(`Local: ${local.agents.length} agent(s), ${local.skills.length} skill(s), ${local.prompts.length} prompt(s)`);
        }

        const remote = await readRemoteRegistry();
        if (!remote) {
          consola.warn("Remote: unavailable (auth or connection issue)");
          if (local) {
            const json = JSON.stringify(local, null, 2);
            consola.log(json);
          }
          return;
        }

        consola.info(`Remote: ${remote.agents.length} agent(s), ${remote.skills.length} skill(s), ${remote.prompts.length} prompt(s)`);

        if (!local) {
          consola.info("No local registry found. Use `af sync pull` to download.");
          return;
        }

        const result = diffSchemas(local, remote);
        if (!result.hasChanges) {
          consola.success("Local and remote registries are in sync.");
          return;
        }

        consola.log("Differences (- local / + remote):");
        consola.log(formatDiff(result));
      },
    }),
  },
});
