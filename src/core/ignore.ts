import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface IgnoreRules {
  includes: string[];
  excludes: string[];
}

function parsePattern(pattern: string): string {
  let p = pattern.trim();
  if (p.startsWith("#") || !p) return "";
  return p;
}

export function loadIgnore(cwd: string): IgnoreRules {
  const rules: IgnoreRules = { includes: [], excludes: [] };

  const paths = [
    join(cwd, ".agentforgeignore"),
    join(cwd, ".agentforge", ".agentforgeignore"),
  ];

  for (const path of paths) {
    if (!existsSync(path)) continue;

    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (trimmed.startsWith("!")) {
        const p = parsePattern(trimmed.slice(1));
        if (p) rules.includes.push(p);
      } else {
        const p = parsePattern(trimmed);
        if (p) rules.excludes.push(p);
      }
    }
  }

  return rules;
}

function matchPattern(name: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".") + "$",
  );
  return regex.test(name);
}

export function isIgnored(name: string, rules: IgnoreRules): boolean {
  for (const pattern of rules.includes) {
    if (matchPattern(name, pattern)) return false;
  }
  for (const pattern of rules.excludes) {
    if (matchPattern(name, pattern)) return true;
  }
  return false;
}

export function filterIgnored<T extends { name: string }>(items: T[], rules: IgnoreRules): T[] {
  return items.filter((item) => !isIgnored(item.name, rules));
}
