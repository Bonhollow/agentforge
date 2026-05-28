import type { UniversalSchema } from "./schema.js";

const PLATFORM_LIMITS: Record<string, number> = {
  claude_code: 200_000,
  codex: 128_000,
  opencode: 128_000,
  cursor: 128_000,
  windsurf: 128_000,
};

const WARN_THRESHOLDS = [
  { level: "warn", pct: 0.5, label: "50%" },
  { level: "warn", pct: 0.75, label: "75%" },
  { level: "error", pct: 0.9, label: "90%" },
] as const;

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function compiledPrompt(
  schema: UniversalSchema,
  agentName: string,
): string {
  const agent = schema.agents.find((a) => a.name === agentName);
  if (!agent) return "";

  const parts: string[] = [agent.system_prompt];

  for (const sr of agent.skills) {
    const skill = schema.skills.find((s) => s.name === sr.ref);
    if (skill?.body) {
      parts.push(`\n--- ${skill.name} ---\n${skill.body}`);
    }
  }

  return parts.join("\n");
}

export interface TokenWarning {
  agent: string;
  platform: string;
  tokens: number;
  limit: number;
  level: "warn" | "error";
  label: string;
}

export function checkTokenBudget(
  schema: UniversalSchema,
  platform: string,
): TokenWarning[] {
  const limit = PLATFORM_LIMITS[platform];
  if (!limit) return [];

  const warnings: TokenWarning[] = [];

  for (const agent of schema.agents) {
    const prompt = compiledPrompt(schema, agent.name);
    const tokens = estimateTokens(prompt);

    for (const t of WARN_THRESHOLDS) {
      if (tokens >= limit * t.pct && tokens < limit) {
        warnings.push({
          agent: agent.name,
          platform,
          tokens,
          limit,
          level: t.level,
          label: t.label,
        });
        break;
      }
    }

    if (tokens >= limit) {
      warnings.push({
        agent: agent.name,
        platform,
        tokens,
        limit,
        level: "error",
        label: "EXCEEDED",
      });
    }
  }

  return warnings;
}
