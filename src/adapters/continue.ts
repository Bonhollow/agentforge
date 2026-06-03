import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./base.js";
import type { UniversalSchema } from "../core/schema.js";
import { consola } from "../utils/logger.js";

export const continueAdapter: Adapter = {
  name: "Continue.dev",
  target: "continue_dev",

  detect(cwd: string): boolean {
    return existsSync(join(cwd, ".continuerc.json")) || existsSync(join(cwd, ".continue"));
  },

  read(cwd: string): UniversalSchema {
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };

    const rcPath = join(cwd, ".continuerc.json");
    if (existsSync(rcPath)) {
      try {
        const content = JSON.parse(readFileSync(rcPath, "utf-8"));
        if (content.rules) {
          schema.agents.push({
            name: "continue-default",
            version: "1.0.0",
            description: "Imported from .continuerc.json",
            system_prompt: Array.isArray(content.rules) ? content.rules.join("\n") : content.rules,
            skills: [],
            prompts: [],
            tools: [],
            expose: ["continue_dev"],
          });
        }
      } catch { /* invalid JSON */ }
    }

    const rulesDir = join(cwd, ".continue", "rules");
    if (existsSync(rulesDir)) {
      const entries = readdirSync(rulesDir);
      for (const entry of entries) {
        if (entry.endsWith(".md") || entry.endsWith(".mdc")) {
          const filePath = join(rulesDir, entry);
          const name = entry.replace(/\.(md|mdc)$/, "");
          schema.skills.push({
            name,
            version: "1.0.0",
            description: `Imported Continue.dev rule: ${name}`,
            body: readFileSync(filePath, "utf-8"),
          });
        }
      }
    }

    return schema;
  },

  write(schema: UniversalSchema, cwd: string): void {
    const projectRulesDir = join(cwd, ".continue", "rules");

    // Write agent system prompt as .continue/rules/rules.md
    if (schema.agents.length > 0) {
      const primaryAgent = schema.agents[0];
      mkdirSync(projectRulesDir, { recursive: true });
      writeFileSync(join(projectRulesDir, "rules.md"), primaryAgent.system_prompt, "utf-8");
      consola.success("Wrote .continue/rules/rules.md");

      // Also write a .continuerc.json reference for project-level config
      const rcContent = JSON.stringify({
        mergeBehavior: "merge",
        rules: [".continue/rules/rules.md"],
      }, null, 2);
      writeFileSync(join(cwd, ".continuerc.json"), rcContent, "utf-8");
      consola.success("Wrote .continuerc.json");
    } else {
      const rcPath = join(cwd, ".continuerc.json");
      if (existsSync(rcPath)) {
        rmSync(rcPath);
        consola.info("Removed .continuerc.json (no agents)");
      }
      if (existsSync(projectRulesDir)) {
        rmSync(projectRulesDir, { recursive: true });
        consola.info("Removed .continue/rules/ (no agents)");
      }
    }

    // Write skills as .continue/rules/*.md
    if (schema.skills.length > 0) {
      mkdirSync(projectRulesDir, { recursive: true });
      for (const skill of schema.skills) {
        writeFileSync(join(projectRulesDir, `${skill.name}.md`), skill.body, "utf-8");
        consola.success(`Wrote .continue/rules/${skill.name}.md`);
      }
    }

    // Clean stale rule files
    if (existsSync(projectRulesDir)) {
      const skillNames = new Set([...schema.skills.map(s => s.name), "rules"]);
      for (const file of readdirSync(projectRulesDir)) {
        if (!file.endsWith(".md") && !file.endsWith(".mdc")) continue;
        const name = file.replace(/\.(md|mdc)$/, "");
        if (!skillNames.has(name)) {
          rmSync(join(projectRulesDir, file));
          consola.info(`Removed stale .continue/rules/${file}`);
        }
      }
    }

    // Prompt templates as .continue/prompts/*.md
    const promptsDir = join(cwd, ".continue", "prompts");
    if (schema.prompts.length > 0) {
      mkdirSync(promptsDir, { recursive: true });
      for (const prompt of schema.prompts) {
        writeFileSync(join(promptsDir, `${prompt.name}.md`), prompt.body, "utf-8");
        consola.success(`Wrote .continue/prompts/${prompt.name}.md`);
      }
    }

    // MCP servers
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
      const configPath = join(cwd, ".continue", "config.json");
      let config: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch { /* ignore invalid JSON */ }
      }
      config.mcpServers = { ...(config.mcpServers as Record<string, unknown> || {}), ...mcpServers };
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      consola.success("Merged MCP servers into .continue/config.json");
    }
  },
};
