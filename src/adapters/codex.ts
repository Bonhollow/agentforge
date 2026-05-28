import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./base.js";
import type { UniversalSchema } from "../core/schema.js";
import { consola } from "../utils/logger.js";

function escapeTomlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export const codexAdapter: Adapter = {
  name: "Codex",
  target: "codex",

  detect(cwd: string): boolean {
    return existsSync(join(cwd, "AGENTS.md"));
  },

  read(cwd: string): UniversalSchema {
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };
    const agentsPath = join(cwd, "AGENTS.md");

    if (!existsSync(agentsPath)) return schema;

    const content = readFileSync(agentsPath, "utf-8");

    const agentMatch = content.match(/^# (.+)$/m);
    const agentName = agentMatch ? agentMatch[1] : "codex-default";

    const descMatch = content.match(/> (.+)/);
    const description = descMatch ? descMatch[1] : "Imported from AGENTS.md";

    schema.agents.push({
      name: agentName,
      version: "1.0.0",
      description,
      system_prompt: content,
      skills: [],
      prompts: [],
      tools: [],
      expose: ["codex"],
    });

    return schema;
  },

  write(schema: UniversalSchema, cwd: string): void {
    if (schema.agents.length === 0) {
      consola.warn("No agents to export (Codex requires at least one agent)");
      return;
    }

    const agent = schema.agents[0];

    const lines: string[] = [
      `# ${agent.name}`,
      "",
      `> ${agent.description}`,
      "",
      agent.system_prompt,
      "",
    ];

    if (schema.skills.length > 0) {
      lines.push("## Skills", "");
      for (const skill of schema.skills) {
        lines.push(`### ${skill.name}`, "", skill.body, "");
      }
    }

    writeFileSync(join(cwd, "AGENTS.md"), lines.join("\n"), "utf-8");
    consola.success("Wrote AGENTS.md");

    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const a of schema.agents) {
      for (const tool of a.tools) {
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

    const codexDir = join(cwd, ".codex");
    if (Object.keys(mcpServers).length > 0) {
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf-8");
      consola.success("Wrote .codex/mcp.json");

      const tomlLines: string[] = [];
      for (const [name, srv] of Object.entries(mcpServers)) {
        tomlLines.push(`[mcp_servers.${name}]`);
        for (const [k, v] of Object.entries(srv)) {
          if (k === "env") continue;
          if (Array.isArray(v)) {
            const items = (v as string[]).map(i => `"${escapeTomlString(i)}"`).join(", ");
            tomlLines.push(`${k} = [${items}]`);
          } else {
            tomlLines.push(`${k} = "${escapeTomlString(String(v))}"`);
          }
        }
        if (srv.env && typeof srv.env === "object") {
          tomlLines.push(`[mcp_servers.${name}.env]`);
          for (const [ek, ev] of Object.entries(srv.env as Record<string, string>)) {
            tomlLines.push(`${ek} = "${escapeTomlString(ev)}"`);
          }
        }
        tomlLines.push("");
      }
      writeFileSync(join(codexDir, "config.toml"), tomlLines.join("\n"), "utf-8");
      consola.success("Wrote .codex/config.toml");
    }
  },
};
