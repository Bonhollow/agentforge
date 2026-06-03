import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Adapter } from "./base.js";
import type { UniversalSchema } from "../core/schema.js";
import { consola } from "../utils/logger.js";

function piDir(cwd: string): string {
  return join(cwd, ".pi");
}

function globalPiDir(): string {
  return join(homedir(), ".pi", "agent");
}

export const piMonoAdapter: Adapter = {
  name: "Pi Mono",
  target: "pi_mono",

  detect(cwd: string): boolean {
    return existsSync(join(cwd, ".pi")) || existsSync(join(cwd, "SYSTEM.md"));
  },

  read(cwd: string): UniversalSchema {
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };

    // Read AGENTS.md as system prompt
    const agentsMdPath = join(cwd, "AGENTS.md");
    if (existsSync(agentsMdPath)) {
      schema.agents.push({
        name: "pi-default",
        version: "1.0.0",
        description: "Imported from AGENTS.md",
        system_prompt: readFileSync(agentsMdPath, "utf-8"),
        skills: [],
        prompts: [],
        tools: [],
        expose: ["pi_mono"],
      });
    }

    // Read SYSTEM.md if it exists (supplemental system prompt)
    const systemMdPath = join(cwd, "SYSTEM.md");
    if (existsSync(systemMdPath)) {
      const sysContent = readFileSync(systemMdPath, "utf-8");
      if (schema.agents.length > 0) {
        schema.agents[0].system_prompt += "\n" + sysContent;
      } else {
        schema.agents.push({
          name: "pi-default",
          version: "1.0.0",
          description: "Imported from SYSTEM.md",
          system_prompt: sysContent,
          skills: [],
          prompts: [],
          tools: [],
          expose: ["pi_mono"],
        });
      }
    }

    // Read CLAUDE.md as fallback
    const claudeMdPath = join(cwd, "CLAUDE.md");
    if (schema.agents.length === 0 && existsSync(claudeMdPath)) {
      schema.agents.push({
        name: "pi-default",
        version: "1.0.0",
        description: "Imported from CLAUDE.md",
        system_prompt: readFileSync(claudeMdPath, "utf-8"),
        skills: [],
        prompts: [],
        tools: [],
        expose: ["pi_mono"],
      });
    }

    // Read skills from .pi/skills/
    const projectSkillsDir = join(piDir(cwd), "skills");
    const globalSkillsDir = join(globalPiDir(), "skills");
    for (const dir of [projectSkillsDir, globalSkillsDir]) {
      if (existsSync(dir)) {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry.endsWith(".md")) {
            const filePath = join(dir, entry);
            const name = entry.replace(/\.md$/, "");
            if (!schema.skills.find(s => s.name === name)) {
              schema.skills.push({
                name,
                version: "1.0.0",
                description: `Imported Pi skill: ${name}`,
                body: readFileSync(filePath, "utf-8"),
              });
            }
          }
        }
      }
    }

    // Read prompts from .pi/prompts/
    const promptsDir = join(piDir(cwd), "prompts");
    if (existsSync(promptsDir)) {
      const entries = readdirSync(promptsDir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          const filePath = join(promptsDir, entry);
          const name = entry.replace(/\.md$/, "");
          schema.prompts.push({
            name,
            version: "1.0.0",
            description: `Imported Pi prompt template: ${name}`,
            tags: [],
            body: readFileSync(filePath, "utf-8"),
          });
        }
      }
    }

    return schema;
  },

  write(schema: UniversalSchema, cwd: string): void {
    const projectDir = piDir(cwd);

    // Write primary agent as AGENTS.md
    if (schema.agents.length > 0) {
      const primaryAgent = schema.agents[0];
      writeFileSync(join(cwd, "AGENTS.md"), primaryAgent.system_prompt, "utf-8");
      consola.success("Wrote AGENTS.md");
      if (schema.agents.length > 1) {
        consola.warn(`Pi Mono only supports a single agent. Dropped ${schema.agents.length - 1} additional agent(s).`);
      }
    } else {
      const agentsMdPath = join(cwd, "AGENTS.md");
      if (existsSync(agentsMdPath)) {
        rmSync(agentsMdPath);
        consola.info("Removed AGENTS.md (no agents)");
      }
      if (existsSync(projectDir)) {
        rmSync(projectDir, { recursive: true });
        consola.info("Removed .pi/ (no agents)");
      }
    }

    // Write skills to .pi/skills/
    const skillsDir = join(projectDir, "skills");
    if (schema.skills.length > 0) {
      mkdirSync(skillsDir, { recursive: true });
      for (const skill of schema.skills) {
        writeFileSync(join(skillsDir, `${skill.name}.md`), skill.body, "utf-8");
        consola.success(`Wrote .pi/skills/${skill.name}.md`);
      }
    }

    // Clean stale skill files
    if (existsSync(skillsDir)) {
      const skillNames = new Set(schema.skills.map(s => s.name));
      for (const file of readdirSync(skillsDir)) {
        if (!file.endsWith(".md")) continue;
        const name = file.replace(/\.md$/, "");
        if (!skillNames.has(name)) {
          rmSync(join(skillsDir, file));
          consola.info(`Removed stale .pi/skills/${file}`);
        }
      }
    }

    // Write prompts to .pi/prompts/
    const promptsDir = join(projectDir, "prompts");
    if (schema.prompts.length > 0) {
      mkdirSync(promptsDir, { recursive: true });
      for (const prompt of schema.prompts) {
        writeFileSync(join(promptsDir, `${prompt.name}.md`), prompt.body, "utf-8");
        consola.success(`Wrote .pi/prompts/${prompt.name}.md`);
      }
    }

    // Write MCP servers to .pi/mcp.json
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
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, "mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf-8");
      consola.success("Wrote .pi/mcp.json");
    }
  },
};
