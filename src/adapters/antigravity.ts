import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./base.js";
import type { UniversalSchema } from "../core/schema.js";
import { consola } from "../utils/logger.js";

export const antigravityAdapter: Adapter = {
  name: "Antigravity",
  target: "antigravity",

  detect(cwd: string): boolean {
    return existsSync(join(cwd, ".agent")) || existsSync(join(cwd, "AGENT.md")) || existsSync(join(cwd, "GEMINI.md"));
  },

  read(cwd: string): UniversalSchema {
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };

    // Read AGENT.md or GEMINI.md as system prompt
    const agentMd = join(cwd, "AGENT.md");
    const geminiMd = join(cwd, "GEMINI.md");
    const promptPath = existsSync(agentMd) ? agentMd : existsSync(geminiMd) ? geminiMd : null;
    if (promptPath) {
      const content = readFileSync(promptPath, "utf-8");
      schema.agents.push({
        name: "antigravity-default",
        version: "1.0.0",
        description: "Imported from Antigravity config",
        system_prompt: content,
        skills: [],
        prompts: [],
        tools: [],
        expose: ["antigravity"],
      });
    }

    // Read skills from .agent/rules/*.md
    const rulesDir = join(cwd, ".agent", "rules");
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
            description: `Imported Antigravity rule: ${name}`,
            body: content,
          });
        }
      }
    }

    // Read prompts from .agent/prompts/*.md
    const promptsDir = join(cwd, ".agent", "prompts");
    if (existsSync(promptsDir)) {
      const entries = readdirSync(promptsDir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          const filePath = join(promptsDir, entry);
          const name = entry.replace(/\.md$/, "");
          schema.prompts.push({
            name,
            version: "1.0.0",
            description: `Imported Antigravity prompt: ${name}`,
            tags: [],
            body: readFileSync(filePath, "utf-8"),
          });
        }
      }
    }

    return schema;
  },

  write(schema: UniversalSchema, cwd: string): void {
    // Write agent system prompt to AGENT.md
    if (schema.agents.length > 0) {
      const primaryAgent = schema.agents[0];
      writeFileSync(join(cwd, "AGENT.md"), primaryAgent.system_prompt, "utf-8");
      consola.success("Wrote AGENT.md");
    } else {
      const agentMd = join(cwd, "AGENT.md");
      if (existsSync(agentMd)) {
        rmSync(agentMd);
        consola.info("Removed AGENT.md (no agents)");
      }
    }

    // Write skills as .agent/rules/*.md
    const rulesDir = join(cwd, ".agent", "rules");
    if (schema.skills.length > 0) {
      mkdirSync(rulesDir, { recursive: true });
      for (const skill of schema.skills) {
        writeFileSync(join(rulesDir, `${skill.name}.md`), skill.body, "utf-8");
        consola.success(`Wrote .agent/rules/${skill.name}.md`);
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
          consola.info(`Removed stale .agent/rules/${file}`);
        }
      }
    }

    // Clean stale prompt files
    const promptsDir = join(cwd, ".agent", "prompts");
    if (schema.prompts.length > 0) {
      mkdirSync(promptsDir, { recursive: true });
      for (const prompt of schema.prompts) {
        writeFileSync(join(promptsDir, `${prompt.name}.md`), prompt.body, "utf-8");
        consola.success(`Wrote .agent/prompts/${prompt.name}.md`);
      }
    }
    if (existsSync(promptsDir)) {
      const promptNames = new Set(schema.prompts.map(p => p.name));
      for (const file of readdirSync(promptsDir)) {
        if (!file.endsWith(".md")) continue;
        const name = file.replace(/\.md$/, "");
        if (!promptNames.has(name)) {
          rmSync(join(promptsDir, file));
          consola.info(`Removed stale .agent/prompts/${file}`);
        }
      }
    }

    // Collect and write MCP servers to .agent/mcp.json
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
      const agentDir = join(cwd, ".agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf-8");
      consola.success("Wrote .agent/mcp.json");
    } else {
      const mcpPath = join(cwd, ".agent", "mcp.json");
      if (existsSync(mcpPath)) {
        rmSync(mcpPath);
        consola.info("Removed .agent/mcp.json (no MCP servers)");
      }
    }

    // Clean up .agent/ if no agents left and directory is empty
    if (schema.agents.length === 0) {
      const agentDir = join(cwd, ".agent");
      if (existsSync(agentDir)) {
        try {
          rmSync(agentDir, { recursive: true });
          consola.info("Removed .agent/ (no agents)");
        } catch { /* not empty, leave it */ }
      }
    }
  },
};
