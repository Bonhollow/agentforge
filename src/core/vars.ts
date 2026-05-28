import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { loadConfig } from "./config.js";
import type { UniversalSchema } from "./schema.js";

export function loadVars(cwd: string): Record<string, string> {
  const vars: Record<string, string> = {};

  const cfg = loadConfig(cwd);
  if (cfg.vars) {
    for (const [key, val] of Object.entries(cfg.vars)) {
      if (typeof val === "string") {
        vars[key] = val;
      }
    }
  }

  const legacyPath = join(cwd, ".agentforge", "vars.yaml");
  if (existsSync(legacyPath)) {
    try {
      const raw = readFileSync(legacyPath, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === "string" && !(key in vars)) {
            vars[key] = val;
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith("AF_") && val) {
      vars[key] = val;
    }
  }

  return vars;
}

export function resolveVars(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in vars) return vars[key];
    return `{{${key}}}`;
  });
}

export function resolveSchemaVars(schema: UniversalSchema, vars: Record<string, string>): UniversalSchema {
  return {
    agents: schema.agents.map((a) => ({
      ...a,
      description: resolveVars(a.description, vars),
      system_prompt: resolveVars(a.system_prompt, vars),
    })),
    skills: schema.skills.map((s) => ({
      ...s,
      description: resolveVars(s.description, vars),
      body: resolveVars(s.body, vars),
    })),
    prompts: schema.prompts.map((p) => ({
      ...p,
      description: resolveVars(p.description, vars),
      body: resolveVars(p.body, vars),
    })),
  };
}
