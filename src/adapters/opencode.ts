import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dump } from "js-yaml";
import matter from "gray-matter";
import type { Adapter } from "./base.js";
import type { UniversalSchema } from "../core/schema.js";
import { consola } from "../utils/logger.js";

function agentsDir(cwd: string): string {
  return join(cwd, ".opencode", "agents");
}

function findOpencodeJson(cwd: string): string | null {
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const p = join(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Convert our internal MCP server format to opencode's mcp config format. */
function toOpenCodeMCP(srv: Record<string, unknown>): Record<string, unknown> {
  if (srv.url) {
    return { type: "remote", url: srv.url };
  }
  const cmd = srv.command as string | undefined;
  const args = srv.args as string[] | undefined;
  const env = srv.env as Record<string, string> | undefined;
  const entry: Record<string, unknown> = { type: "local", command: cmd ? [cmd, ...(args || [])] : [] };
  if (env && Object.keys(env).length > 0) entry.environment = env;
  return entry;
}

/** Convert opencode's mcp config format back to our internal MCP server format. */
function fromOpenCodeMCP(srv: Record<string, unknown>): Record<string, unknown> {
  const type = srv.type as string | undefined;
  if (type === "remote") {
    return { url: srv.url as string };
  }
  const cmdArr = srv.command as string[] | undefined;
  const env = srv.environment as Record<string, string> | undefined;
  const entry: Record<string, unknown> = {};
  if (cmdArr && cmdArr.length > 0) {
    entry.command = cmdArr[0];
    if (cmdArr.length > 1) entry.args = cmdArr.slice(1);
  }
  if (env && Object.keys(env).length > 0) entry.env = env;
  return entry;
}

export const opencodeAdapter: Adapter = {
  name: "OpenCode",
  target: "opencode",

  detect(cwd: string): boolean {
    return existsSync(join(cwd, ".opencode")) ||
      existsSync(join(cwd, "opencode.json")) ||
      existsSync(join(cwd, "opencode.jsonc"));
  },

  read(cwd: string): UniversalSchema {
    const jsonPath = findOpencodeJson(cwd);
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };

    if (jsonPath) {
      const raw = readFileSync(jsonPath, "utf-8");
      const config = JSON.parse(raw);

      // Read MCP servers from `mcp` key (and legacy `mcpServers` for backward compat)
      const globalMCP: Record<string, Record<string, unknown>> = {};
      if (config.mcp && typeof config.mcp === "object") {
        for (const [name, srv] of Object.entries(config.mcp as Record<string, unknown>)) {
          globalMCP[name] = fromOpenCodeMCP(srv as Record<string, unknown>);
        }
      }
      if (config.mcpServers && typeof config.mcpServers === "object") {
        for (const [name, srv] of Object.entries(config.mcpServers as Record<string, unknown>)) {
          if (!globalMCP[name]) {
            globalMCP[name] = srv as Record<string, unknown>;
          }
        }
      }

      // Read agent configs
      if (config.agent && typeof config.agent === "object") {
        for (const [name, entry] of Object.entries(config.agent)) {
          const e = entry as Record<string, unknown>;
          schema.agents.push({
            name,
            version: "1.0.0",
            description: (e.description as string) || `${name} agent`,
            system_prompt: (e.prompt as string) || "",
            skills: [],
            prompts: [],
            tools: [],
            expose: ["opencode"],
          });
        }
      }
    }

    // Read skills from .md files
    const dir = agentsDir(cwd);
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const raw = readFileSync(join(dir, file), "utf-8");
        const parsed = matter(raw);
        const { description, mode } = parsed.data;
        const name = parsed.data.name || file.replace(/\.md$/, "");
        if (mode === "subagent") {
          schema.skills.push({
            name,
            version: "1.0.0",
            description: description || `${name} skill`,
            body: parsed.content.trim(),
          });
        }
      }
    }

    return schema;
  },

  write(schema: UniversalSchema, cwd: string): void {
    const dir = agentsDir(cwd);
    mkdirSync(dir, { recursive: true });

    const skillNames = new Set<string>();

    // Write skill .md files — opencode loads subagents from .opencode/agents/*.md
    for (const skill of schema.skills) {
      skillNames.add(skill.name);
      const fm: Record<string, unknown> = {
        name: skill.name,
        description: skill.description || `${skill.name} skill`,
        mode: "subagent",
      };
      const body = skill.body || "";
      const yaml = dump(fm).trim();
      writeFileSync(join(dir, `${skill.name}.md`), `---\n${yaml}\n---\n\n${body}`, "utf-8");
      consola.success(`Wrote ${skill.name}.md`);
    }

    // Clean up stale .md files (only skills in this dir)
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const name = file.replace(/\.md$/, "");
        if (!skillNames.has(name)) {
          rmSync(join(dir, file));
          consola.info(`Removed ${file}`);
        }
      }
    }

    // Build agent configs and collect MCP servers
    const agentConfigs: Record<string, Record<string, unknown>> = {};
    const mcpConfig: Record<string, Record<string, unknown>> = {};

    for (const agent of schema.agents) {
      const entry: Record<string, unknown> = {
        description: agent.description || `${agent.name} agent`,
        mode: "primary",
      };
      if (agent.system_prompt) {
        entry.prompt = agent.system_prompt;
      }
      agentConfigs[agent.name] = entry;

      // Collect MCP tools attached to this agent
      for (const tool of agent.tools) {
        if (typeof tool !== "string" && tool.type === "mcp") {
          const mcp = tool as Record<string, unknown>;
          const mcpName = mcp.name as string;
          if (!mcpConfig[mcpName]) {
            mcpConfig[mcpName] = toOpenCodeMCP(mcp);
          }
        }
      }
    }

    // Write opencode.json
    const jsonPath = findOpencodeJson(cwd) || join(cwd, "opencode.json");
    let config: Record<string, unknown> = {};
    if (existsSync(jsonPath)) {
      try {
        config = JSON.parse(readFileSync(jsonPath, "utf-8"));
      } catch { /* will overwrite */ }
    }

    config.agent = agentConfigs;
    if (Object.keys(mcpConfig).length > 0) {
      config.mcp = mcpConfig;
    } else {
      delete config.mcp;
    }

    writeFileSync(jsonPath, JSON.stringify(config, null, 2), "utf-8");
    consola.success(`Wrote ${jsonPath}`);
  },
};
