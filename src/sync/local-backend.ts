import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { consola } from "../utils/logger.js";
import type { UniversalSchema } from "../core/schema.js";
import type { SyncBackend } from "./backend.js";

function getSyncPath(): string {
  return process.env.AF_SYNC_PATH || join(process.cwd(), ".agentforge", "sync-data.json");
}

export class LocalBackend implements SyncBackend {
  readonly name = "Local";

  async push(schema: UniversalSchema): Promise<void> {
    const filePath = getSyncPath();
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(schema, null, 2), "utf-8");
    const total = schema.agents.length + schema.skills.length + schema.prompts.length;
    consola.success(`Pushed ${total} elements to local sync file: ${filePath}`);
  }

  async pull(): Promise<UniversalSchema> {
    const filePath = getSyncPath();
    if (!existsSync(filePath)) {
      consola.warn(`No local sync file found at ${filePath}`);
      return { agents: [], skills: [], prompts: [] };
    }
    const raw = readFileSync(filePath, "utf-8");
    const schema = JSON.parse(raw) as UniversalSchema;
    const total = schema.agents.length + schema.skills.length + schema.prompts.length;
    consola.success(`Pulled ${total} elements from local sync file: ${filePath}`);
    return schema;
  }
}
