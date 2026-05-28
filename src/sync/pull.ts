import { consola } from "../utils/logger.js";
import { writeRegistry } from "../core/registry.js";
import { getSyncBackend } from "./backend.js";
import { createSnapshot } from "../core/snapshot.js";

export async function readRemoteRegistry() {
  try {
    const backend = await getSyncBackend();
    consola.info(`Using sync backend: ${backend.name}`);
    const schema = await backend.pull();
    return schema;
  } catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function pullRegistry(cwd: string) {
  const schema = await readRemoteRegistry();
  if (!schema) return;

  const total = schema.agents.length + schema.skills.length + schema.prompts.length;
  createSnapshot(cwd);
  writeRegistry(cwd, schema);
  consola.success(`Pulled ${total} elements from remote.`);
}
