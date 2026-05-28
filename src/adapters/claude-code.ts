import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./base.js";
import type { UniversalSchema } from "../core/schema.js";
import { consola } from "../utils/logger.js";

export const claudeCodeAdapter: Adapter = {
  name: "Claude Code",
  target: "claude_code",

  detect(cwd: string): boolean {
    return existsSync(join(cwd, "CLAUDE.md")) || existsSync(join(cwd, ".claude"));
  },

  read(cwd: string): UniversalSchema {
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };

    const claudePath = join(cwd, "CLAUDE.md");
    if (existsSync(claudePath)) {
      const content = readFileSync(claudePath, "utf-8");
      schema.agents.push({
        name: "claude-default",
        version: "1.0.0",
        description: "Imported from CLAUDE.md",
        system_prompt: content,
        skills: [],
        prompts: [],
        tools: [],
        expose: ["claude_code"],
      });
    }

    const commandsDir = join(cwd, ".claude", "commands");
    if (existsSync(commandsDir)) {
      const entries = readdirSync(commandsDir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          const filePath = join(commandsDir, entry);
          const content = readFileSync(filePath, "utf-8");
          const name = entry.replace(/\.md$/, "");
          schema.skills.push({
            name,
            version: "1.0.0",
            description: `Imported Claude Code command: ${name}`,
            body: content,
          });
        }
      }
    }

    return schema;
  },

  write(schema: UniversalSchema, cwd: string): void {
    // Write agent system prompt to CLAUDE.md
    if (schema.agents.length > 0) {
      const primaryAgent = schema.agents[0];
      writeFileSync(join(cwd, "CLAUDE.md"), primaryAgent.system_prompt, "utf-8");
      consola.success("Wrote CLAUDE.md");
    }

    // Write skills as .claude/commands/*.md
    const commandsDir = join(cwd, ".claude", "commands");
    if (schema.skills.length > 0) {
      mkdirSync(commandsDir, { recursive: true });
      for (const skill of schema.skills) {
        writeFileSync(join(commandsDir, `${skill.name}.md`), skill.body, "utf-8");
        consola.success(`Wrote .claude/commands/${skill.name}.md`);
      }
    }

    // Clean stale command files
    if (existsSync(commandsDir)) {
      const skillNames = new Set(schema.skills.map(s => s.name));
      for (const file of readdirSync(commandsDir)) {
        if (!file.endsWith(".md")) continue;
        if (!skillNames.has(file.replace(/\.md$/, ""))) {
          rmSync(join(commandsDir, file));
          consola.info(`Removed stale .claude/commands/${file}`);
        }
      }
    }

    // Collect MCP servers from all agents
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
      // Write project-scoped .mcp.json (Claude Code standard)
      writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf-8");
      consola.success("Wrote .mcp.json");

      // Also write .claude/mcp.json for backward compat
      const claudeDir = join(cwd, ".claude");
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, "mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf-8");
      consola.success("Wrote .claude/mcp.json");
    }
  },
};
