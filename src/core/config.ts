import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export interface LintConfig {
  max_tokens?: number;
  banned_phrases?: string[];
  required_sections?: string[];
}

export interface AgentForgeConfig {
  version?: string;
  platforms?: string[];
  vars?: Record<string, string>;
  hooks?: {
    pre_export?: Record<string, string>;
    post_export?: Record<string, string>;
  };
  lint?: LintConfig;
  model_versions?: Record<string, string>;
}

const defaultPlatforms = ["claude_code", "codex", "opencode", "cursor", "windsurf"];

export function saveConfig(cwd: string, cfg: AgentForgeConfig): void {
  const configPath = join(cwd, ".agentforge", "config.yaml");
  writeFileSync(configPath, yaml.dump(cfg, { indent: 2 }), "utf-8");
}

export function loadConfig(cwd: string): AgentForgeConfig {
  const configPath = join(cwd, ".agentforge", "config.yaml");
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = yaml.load(raw) as AgentForgeConfig;
    return parsed || {};
  } catch {
    return {};
  }
}

export function resolvePlatforms(cfg: AgentForgeConfig, requested: string): string[] {
  const configured = cfg.platforms && cfg.platforms.length > 0 ? cfg.platforms : defaultPlatforms;

  if (requested === "all") return configured;

  if (configured.includes(requested)) return [requested];

  return [requested];
}
