import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

let builtinsDir: string | null = null;

function getBuiltinsDir(): string | null {
  if (builtinsDir) return builtinsDir;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const root = join(__dirname, "..", "..");
    const dir = join(root, "static", "builtins");
    if (existsSync(dir)) {
      builtinsDir = dir;
      return dir;
    }
  } catch {}
  return null;
}

export interface BuiltinSkill {
  name: string;
  description: string;
  path: string;
}

export function listBuiltinSkills(): BuiltinSkill[] {
  const dir = getBuiltinsDir();
  if (!dir) return [];
  const skillsDir = join(dir, "skills");
  if (!existsSync(skillsDir)) return [];
  const entries = readdirSync(skillsDir);
  const skills: BuiltinSkill[] = [];
  for (const entry of entries) {
    const filePath = join(skillsDir, entry);
    const st = statSync(filePath);
    if (!st.isFile()) continue;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = matter(raw).data as Record<string, unknown>;
      skills.push({
        name: (data.name as string) || basename(entry, extname(entry)),
        description: (data.description as string) || "",
        path: filePath,
      });
    } catch {}
  }
  return skills;
}

export function getBuiltinSkill(name: string): { name: string; description: string; path: string; body: string } | null {
  const dir = getBuiltinsDir();
  if (!dir) return null;
  const skillsDir = join(dir, "skills");
  if (!existsSync(skillsDir)) return null;
  const entries = readdirSync(skillsDir);
  for (const entry of entries) {
    const filePath = join(skillsDir, entry);
    const st = statSync(filePath);
    if (!st.isFile()) continue;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      const skillName = (data.name as string) || basename(entry, extname(entry));
      if (skillName.toLowerCase() === name.toLowerCase()) {
        return {
          name: skillName,
          description: (data.description as string) || "",
          path: filePath,
          body: parsed.content,
        };
      }
    } catch {}
  }
  return null;
}
