import type { SupportedTarget } from "./schema.js";
import { SupportedTargets } from "./schema.js";

export { SupportedTargets, type SupportedTarget } from "./schema.js";

export const DEFAULT_EXPOSE: string[] = [...SupportedTargets];

export const PLATFORM_LIMITS: Record<string, number> = {
  claude_code: 200_000,
  codex: 128_000,
  opencode: 128_000,
  cursor: 128_000,
  windsurf: 128_000,
  continue_dev: 128_000,
  pi_mono: 128_000,
};

export const PLATFORM_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  windsurf: "Windsurf",
  continue_dev: "Continue.dev",
  pi_mono: "Pi Mono",
};

export const PLATFORM_BADGE: Record<string, string> = {
  claude_code: "cc",
  codex: "cx",
  cursor: "cu",
  opencode: "oc",
  windsurf: "ws",
  continue_dev: "cd",
  pi_mono: "pm",
};

export function platformLabel(target: string): string {
  return PLATFORM_LABELS[target] || target;
}

export function platformBadge(target: string): string {
  return PLATFORM_BADGE[target] || target.slice(0, 2);
}

export function isValidTarget(target: string): target is SupportedTarget {
  return (SupportedTargets as readonly string[]).includes(target);
}

export function filterAgentsByExpose<T extends { expose?: string[] }>(
  agents: T[],
  target: string,
): T[] {
  return agents.filter((a) => a.expose && a.expose.length > 0 && (a.expose as string[]).includes(target));
}
