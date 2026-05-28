import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { UniversalSchema } from "./schema.js";

export interface LockEntry {
  hash: string;
}

export interface LockData {
  version: string;
  targets: Record<string, Record<string, LockEntry>>;
}

function lockPath(cwd: string): string {
  return join(cwd, "agentforge.lock");
}

const CURRENT_VERSION = "1";

export function readLock(cwd: string): LockData {
  const path = lockPath(cwd);
  if (!existsSync(path)) {
    return { version: CURRENT_VERSION, targets: {} };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as LockData;
  } catch {
    return { version: CURRENT_VERSION, targets: {} };
  }
}

export function writeLock(cwd: string, data: LockData): void {
  const path = lockPath(cwd);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

export function computeHash(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

export function getChangedElements(
  schema: UniversalSchema,
  target: string,
  lock: LockData,
): { changed: UniversalSchema; unchanged: number } {
  const targetLock = lock.targets[target] || {};
  const changedAgents: UniversalSchema["agents"] = [];
  const changedSkills: UniversalSchema["skills"] = [];
  const changedPrompts: UniversalSchema["prompts"] = [];
  let unchanged = 0;

  for (const agent of schema.agents) {
    const key = `agent:${agent.name}`;
    const hash = computeHash(agent);
    if (targetLock[key]?.hash === hash) {
      unchanged++;
    } else {
      changedAgents.push(agent);
    }
  }

  for (const skill of schema.skills) {
    const key = `skill:${skill.name}`;
    const hash = computeHash(skill);
    if (targetLock[key]?.hash === hash) {
      unchanged++;
    } else {
      changedSkills.push(skill);
    }
  }

  for (const prompt of schema.prompts) {
    const key = `prompt:${prompt.name}`;
    const hash = computeHash(prompt);
    if (targetLock[key]?.hash === hash) {
      unchanged++;
    } else {
      changedPrompts.push(prompt);
    }
  }

  return {
    changed: { agents: changedAgents, skills: changedSkills, prompts: changedPrompts },
    unchanged,
  };
}

export function updateLock(
  lock: LockData,
  target: string,
  schema: UniversalSchema,
): void {
  if (!lock.targets[target]) {
    lock.targets[target] = {};
  }

  const entries = lock.targets[target];

  for (const agent of schema.agents) {
    entries[`agent:${agent.name}`] = { hash: computeHash(agent) };
  }
  for (const skill of schema.skills) {
    entries[`skill:${skill.name}`] = { hash: computeHash(skill) };
  }
  for (const prompt of schema.prompts) {
    entries[`prompt:${prompt.name}`] = { hash: computeHash(prompt) };
  }
}
