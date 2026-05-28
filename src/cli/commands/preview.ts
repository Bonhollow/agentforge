import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readElement, readRegistry, getRegistryDir } from "../../core/registry.js";
import { loadVars, resolveSchemaVars } from "../../core/vars.js";
import { resolveSchemaForPlatform } from "../../core/overrides.js";
import { existsSync } from "node:fs";

export default defineCommand({
  meta: {
    name: "preview",
    description: "Show resolved agent with variables, skills, and overrides applied",
  },
  args: {
    name: {
      type: "positional",
      description: "Agent name",
      required: true,
    },
    platform: {
      type: "string",
      description: "Platform to resolve for (optional)",
      default: "",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found.");
      return;
    }

    const name = args.name as string;
    const rawSchema = readRegistry(cwd);
    const vars = loadVars(cwd);
    const resolved = resolveSchemaVars(rawSchema, vars);

    const agent = resolved.agents.find((a) => a.name === name);
    if (!agent) {
      consola.error(`Agent "${name}" not found.`);
      return;
    }

    const platform = args.platform as string;

    const target = platform ? resolveSchemaForPlatform({ agents: [agent], skills: resolved.skills, prompts: [] }, platform) : null;
    const display = target ? target.agents[0] : agent;

    consola.log(JSON.stringify({
      name: display.name,
      description: display.description,
      version: display.version,
      system_prompt: display.system_prompt,
      skills: display.skills.map((s) => {
        const skill = resolved.skills.find((sk) => sk.name === s.ref);
        return { ref: s.ref, description: skill?.description, body: skill?.body };
      }),
      tools: display.tools,
      expose: display.expose,
      platform: platform || "base",
    }, null, 2));
  },
});
