import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./base.js";
import type { UniversalSchema } from "../core/schema.js";
import { consola } from "../utils/logger.js";

export const cursorAdapter: Adapter = {
  name: "Cursor",
  target: "cursor",

  detect(cwd: string): boolean {
    return existsSync(join(cwd, ".cursorrules")) || existsSync(join(cwd, ".cursor"));
  },

  read(cwd: string): UniversalSchema {
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };

    const rulesPath = join(cwd, ".cursorrules");
    if (existsSync(rulesPath)) {
      const content = readFileSync(rulesPath, "utf-8");
      schema.agents.push({
        name: "cursor-default",
        version: "1.0.0",
        description: "Imported from .cursorrules",
        system_prompt: content,
        skills: [],
        prompts: [],
        tools: [],
        expose: ["cursor"],
      });
    }

    const rulesDir = join(cwd, ".cursor", "rules");
    if (existsSync(rulesDir)) {
      const entries = readdirSync(rulesDir);
      for (const entry of entries) {
        if (entry.endsWith(".md") || entry.endsWith(".mdc")) {
          const filePath = join(rulesDir, entry);
          const content = readFileSync(filePath, "utf-8");
          const name = entry.replace(/\.(md|mdc)$/, "");
          schema.skills.push({
            name,
            version: "1.0.0",
            description: `Imported Cursor rule: ${name}`,
            body: content,
          });
        }
      }
    }

    return schema;
  },

  write(schema: UniversalSchema, cwd: string): void {
    // Write agent system prompt to .cursorrules
    if (schema.agents.length > 0) {
      const primaryAgent = schema.agents[0];
      writeFileSync(join(cwd, ".cursorrules"), primaryAgent.system_prompt, "utf-8");
      consola.success("Wrote .cursorrules");
    }

    // Write skills as .cursor/rules/*.md
    const rulesDir = join(cwd, ".cursor", "rules");
    if (schema.skills.length > 0) {
      mkdirSync(rulesDir, { recursive: true });
      for (const skill of schema.skills) {
        writeFileSync(join(rulesDir, `${skill.name}.md`), skill.body, "utf-8");
        consola.success(`Wrote .cursor/rules/${skill.name}.md`);
      }
    }

    // Clean stale rule files
    if (existsSync(rulesDir)) {
      const skillNames = new Set(schema.skills.map(s => s.name));
      for (const file of readdirSync(rulesDir)) {
        if (!file.endsWith(".md") && !file.endsWith(".mdc")) continue;
        const name = file.replace(/\.(md|mdc)$/, "");
        if (!skillNames.has(name)) {
          rmSync(join(rulesDir, file));
          consola.info(`Removed stale .cursor/rules/${file}`);
        }
      }
    }

    // Collect and write MCP servers
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const agent of schema.agents) {
      for (const tool of agent.tools) {
        if (typeof tool !== "string" && tool.type === "mcp") {
          const mcp = tool as Record<string, unknown>;
          const mcpName = mcp.name as string;
          if (!mcpServers[mcpName]) {
            const { name: _n, type: _t, ...fields } = mcp;
            mcpServers[mcpName] = { ...fields } as Record<string, unknown>;
          }
        }
      }
    }

    if (Object.keys(mcpServers).length > 0) {
      const mcpDir = join(cwd, ".cursor");
      mkdirSync(mcpDir, { recursive: true });
      writeFileSync(join(mcpDir, "mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf-8");
      consola.success("Wrote .cursor/mcp.json");
    }
  },
};
