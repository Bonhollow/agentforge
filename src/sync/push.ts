import { consola } from "../utils/logger.js";
import { readRegistry } from "../core/registry.js";
import { getSyncBackend } from "./backend.js";
import { loadIgnore, filterIgnored } from "../core/ignore.js";
import { auditLog } from "../core/audit.js";

export async function pushRegistry(cwd: string) {
  const ignoreRules = loadIgnore(cwd);
  const rawSchema = readRegistry(cwd);

  const schema = {
    agents: filterIgnored(rawSchema.agents, ignoreRules),
    skills: filterIgnored(rawSchema.skills, ignoreRules),
    prompts: filterIgnored(rawSchema.prompts, ignoreRules),
  };

  if (schema.agents.length === 0 && schema.skills.length === 0 && schema.prompts.length === 0) {
    consola.warn("Nothing to push — registry is empty or all elements ignored.");
    return;
  }

  try {
    const backend = await getSyncBackend();
    consola.info(`Using sync backend: ${backend.name}`);
    await backend.push(schema);
    auditLog(cwd, "sync-push", "registry", `${schema.agents.length + schema.skills.length + schema.prompts.length} elements`);
  } catch (err) {
    consola.error(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
