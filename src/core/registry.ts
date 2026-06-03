import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync, renameSync } from "node:fs";
import { join, extname, basename } from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";
import { UniversalSchema, type ExposeTarget } from "./schema.js";
import { consola } from "../utils/logger.js";
import { DEFAULT_EXPOSE, PLATFORM_BADGE } from "./platforms.js";

const REGISTRY_DIR = ".agentforge";

export function getRegistryDir(cwd: string): string {
  return join(cwd, REGISTRY_DIR);
}

export function initRegistry(cwd: string, global?: boolean): string {
  const target = global
    ? join(process.env.HOME || "~", ".agentforge")
    : getRegistryDir(cwd);

  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  const subdirs = ["agents", "skills", "prompts"];
  for (const dir of subdirs) {
    const dirPath = join(target, dir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  return target;
}

export function listElements(cwd: string, type?: string) {
  const regDir = getRegistryDir(cwd);
  const dirs = type ? [`${type.replace(/s$/, "")}s`] : ["agents", "skills", "prompts"];
  const elements: Array<{ name: string; type: string; description: string; version: string }> = [];

  for (const dir of dirs) {
    const dirPath = join(regDir, dir);
    if (!existsSync(dirPath)) continue;

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const filePath = join(dirPath, entry);
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;

      try {
        const raw = readFileSync(filePath, "utf-8");
        const ext = extname(entry);

        let data: Record<string, unknown>;
        if (ext === ".md") {
          data = matter(raw).data as Record<string, unknown>;
        } else {
          data = yaml.load(raw) as Record<string, unknown>;
        }

        elements.push({
          name: (data.name as string) || basename(entry, ext),
          type: dir.slice(0, -1),
          description: (data.description as string) || "",
          version: (data.version as string) || "0.0.0",
        });
      } catch {
        consola.warn(`Could not parse: ${entry}`);
      }
    }
  }

  return elements;
}

export function readElement(cwd: string, name: string) {
  const regDir = getRegistryDir(cwd);
  const dirs = ["agents", "skills", "prompts"];

  for (const dir of dirs) {
    const dirPath = join(regDir, dir);
    if (!existsSync(dirPath)) continue;

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (basename(entry, extname(entry)) === name) {
        const filePath = join(dirPath, entry);
        try {
          const raw = readFileSync(filePath, "utf-8");
          const ext = extname(entry);

          let data: Record<string, unknown>;
          let body = "";

          if (ext === ".md") {
            const fm = matter(raw);
            data = fm.data as Record<string, unknown>;
            body = fm.content.trim();
          } else {
            data = yaml.load(raw) as Record<string, unknown>;
          }

          return { type: dir.slice(0, -1), data, body, filePath };
        } catch {
          return { type: dir.slice(0, -1), data: { name }, body: "", filePath };
        }
      }
    }
  }

  return null;
}

export function removeElement(cwd: string, name: string): boolean {
  const el = readElement(cwd, name);
  if (!el) return false;
  rmSync(el.filePath);
  return true;
}

export function addElement(cwd: string, type: string, name: string): string {
  const regDir = getRegistryDir(cwd);
  const typeDir = `${type}s`;
  const dirPath = join(regDir, typeDir);
  const ext = type === "agent" ? "yaml" : "md";
  const filePath = join(dirPath, `${name}.${ext}`);

  if (existsSync(filePath)) {
    consola.warn(`Element "${name}" already exists at ${filePath}`);
    return filePath;
  }

  mkdirSync(dirPath, { recursive: true });

  if (type === "agent") {
    const template: Record<string, unknown> = {
      name,
      version: "1.0.0",
      description: `${name} agent`,
      system_prompt: "You are a helpful AI assistant.",
      skills: [],
      prompts: [],
      tools: [],
      expose: DEFAULT_EXPOSE.slice(0, 4),
    };
    writeFileSync(filePath, yaml.dump(template, { indent: 2, lineWidth: 120 }), "utf-8");
  } else {
    const frontmatter: Record<string, unknown> = {
      name,
      version: "1.0.0",
      description: `${name} ${type}`,
      ...(type === "prompt" ? { tags: [] } : {}),
    };
    const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n## ${name}\n\nDescribe your ${type} here.\n`;
    writeFileSync(filePath, content, "utf-8");
  }

  return filePath;
}

export function saveElement(cwd: string, type: "agent" | "skill" | "prompt", name: string, data: any): string {
  const regDir = getRegistryDir(cwd);
  const typeDir = `${type}s`;
  const ext = type === "agent" ? "yaml" : "md";
  const filePath = join(regDir, typeDir, `${name}.${ext}`);

  // Ensure directories exist
  mkdirSync(join(regDir, typeDir), { recursive: true });

  if (type === "agent") {
    writeFileSync(filePath, yaml.dump(data, { indent: 2, lineWidth: 120 }), "utf-8");
  } else {
    const { body, ...fm } = data;
    const content = `---\n${yaml.dump(fm, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${body || ""}\n`;
    writeFileSync(filePath, content, "utf-8");
  }
  return filePath;
}

function resolveParentRefs(input: string, parent: { system_prompt: string; description: string }): string {
  return input.replace(/\{\{parent\.(\w+)\}\}/g, (_, field) => {
    if (field === "system_prompt") return parent.system_prompt;
    if (field === "description") return parent.description;
    return `{{parent.${field}}}`;
  });
}

function readDirToSchema(regDir: string): UniversalSchema {
  const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };

  if (!existsSync(regDir)) return schema;

  interface RawAgent {
    name: string;
    version: string;
    description: string;
    extends?: string;
    system_prompt: string;
    skills: Array<{ ref: string }>;
    prompts: string[];
    tools: Array<string | { type: string; name: string; url: string }>;
    expose: ExposeTarget[];
    overrides?: Record<string, { system_prompt?: string; skills?: Array<{ ref: string }>; tools?: Array<string | { type: string; name: string; url: string }>; expose?: ExposeTarget[] }>;
  }

  const rawAgents: RawAgent[] = [];

  const dirs: Array<{ name: string; dir: string; type: "agent" | "skill" | "prompt" }> = [
    { name: "agents", dir: join(regDir, "agents"), type: "agent" },
    { name: "skills", dir: join(regDir, "skills"), type: "skill" },
    { name: "prompts", dir: join(regDir, "prompts"), type: "prompt" },
  ];

  for (const { dir, type } of dirs) {
    if (!existsSync(dir)) continue;

    const entries = readdirSync(dir);
    for (const entry of entries) {
      const filePath = join(dir, entry);
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;

      try {
        const raw = readFileSync(filePath, "utf-8");
        const ext = extname(entry);

        if (ext === ".md") {
          const fm = matter(raw);
          const data = fm.data as Record<string, unknown>;
          const body = fm.content.trim();
          if (type === "skill") {
            schema.skills.push({ name: data.name as string, version: data.version as string, description: data.description as string, body });
          } else if (type === "prompt") {
            schema.prompts.push({ name: data.name as string, version: data.version as string, description: data.description as string, tags: (data.tags as string[]) || [], body });
          }
        } else {
          const data = yaml.load(raw) as Record<string, unknown>;
          if (type === "agent") {
            rawAgents.push({
              name: data.name as string,
              version: data.version as string,
              description: data.description as string,
              extends: data.extends as string | undefined,
              system_prompt: data.system_prompt as string,
              skills: (data.skills as Array<{ ref: string }>) || [],
              prompts: (data.prompts as string[]) || [],
              tools: (data.tools as Array<string | { type: string; name: string; url: string }>) || [],
              expose: (data.expose as ExposeTarget[]) || DEFAULT_EXPOSE,
              overrides: data.overrides as Record<string, { system_prompt?: string; skills?: Array<{ ref: string }>; tools?: Array<string | { type: string; name: string; url: string }>; expose?: ExposeTarget[] }> | undefined,
            });
          }
        }
      } catch {
        consola.warn(`Skipping unparseable file: ${entry}`);
      }
    }
  }

  const agentMap = new Map(rawAgents.map((a) => [a.name, a]));

  // Multi-pass extends resolution to handle multi-level inheritance
  let changed = true;
  while (changed) {
    changed = false;
    for (const agent of rawAgents) {
      if (!agent.extends) continue;
      const parent = agentMap.get(agent.extends);
      if (!parent) continue;
      if (agent.description !== parent.description && !agent.description) {
        agent.description = parent.description;
        changed = true;
      }
      if (agent.system_prompt !== parent.system_prompt) {
        agent.system_prompt = resolveParentRefs(agent.system_prompt, parent);
        changed = true;
      }
      if (agent.skills.length === 0 && parent.skills.length > 0) {
        agent.skills = parent.skills;
        changed = true;
      }
      if (agent.prompts.length === 0 && parent.prompts.length > 0) {
        agent.prompts = parent.prompts;
        changed = true;
      }
      if (agent.tools.length === 0 && parent.tools.length > 0) {
        agent.tools = parent.tools;
        changed = true;
      }
      if (agent.expose.length === 0 && parent.expose.length > 0) {
        agent.expose = parent.expose;
        changed = true;
      }
    }
  }

  // Detect circular extends
  for (const agent of rawAgents) {
    if (agent.extends) {
      const visited = new Set<string>([agent.name]);
      let current: RawAgent | undefined = agent;
      while (current?.extends) {
        if (visited.has(current.extends)) {
          consola.warn(`Circular extends detected: ${agent.name} -> ... -> ${current.extends}`);
          break;
        }
        visited.add(current.extends);
        current = agentMap.get(current.extends);
        if (!current) break;
      }
    }
  }

  for (const agent of rawAgents) {
    schema.agents.push({
      name: agent.name,
      version: agent.version,
      description: agent.description,
      system_prompt: agent.system_prompt,
      skills: agent.skills,
      prompts: agent.prompts,
      tools: agent.tools as UniversalSchema["agents"][number]["tools"],
      expose: agent.expose,
      overrides: agent.overrides as UniversalSchema["agents"][number]["overrides"],
    });
  }

  return schema;
}

export function readRegistry(cwd: string): UniversalSchema {
  return readDirToSchema(getRegistryDir(cwd));
}

export function readRegistryFromDir(dir: string): UniversalSchema {
  return readDirToSchema(dir);
}

export function writeRegistry(cwd: string, schema: UniversalSchema): void {
  const parsed = UniversalSchema.safeParse(schema);
  if (!parsed.success) {
    consola.error(`Registry schema validation failed: ${parsed.error.message}`);
    return;
  }
  const valid = parsed.data;
  const regDir = getRegistryDir(cwd);
  const subs = ["agents", "skills", "prompts"] as const;

  // Backup existing subdirs for rollback
  const backupDir = join(regDir, `.backup_${Date.now()}`);
  mkdirSync(backupDir, { recursive: true });
  try {
    for (const sub of subs) {
      const subDir = join(regDir, sub);
      if (existsSync(subDir)) {
        cpSync(subDir, join(backupDir, sub), { recursive: true });
        rmSync(subDir, { recursive: true });
      }
      mkdirSync(subDir, { recursive: true });
    }

    for (const agent of valid.agents) {
      writeFileSync(join(regDir, "agents", `${agent.name}.yaml`), yaml.dump(agent, { indent: 2, lineWidth: 120 }), "utf-8");
    }

    for (const skill of valid.skills) {
      const frontmatter = { name: skill.name, version: skill.version, description: skill.description };
      const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${skill.body}\n`;
      writeFileSync(join(regDir, "skills", `${skill.name}.md`), content, "utf-8");
    }

    for (const prompt of valid.prompts) {
      const frontmatter = { name: prompt.name, version: prompt.version, description: prompt.description, tags: prompt.tags };
      const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${prompt.body}\n`;
      writeFileSync(join(regDir, "prompts", `${prompt.name}.md`), content, "utf-8");
    }

    rmSync(backupDir, { recursive: true });
  } catch (err) {
    consola.error(`writeRegistry failed: restoring from backup...`);
    // Restore from backup
    for (const sub of subs) {
      const subDir = join(regDir, sub);
      if (existsSync(subDir)) rmSync(subDir, { recursive: true });
      const bakSub = join(backupDir, sub);
      if (existsSync(bakSub)) renameSync(bakSub, subDir);
    }
    if (existsSync(backupDir)) rmSync(backupDir, { recursive: true });
    throw err;
  }
}

export function findReferences(cwd: string, targetName: string): string[] {
  const refs: string[] = [];
  const regDir = getRegistryDir(cwd);
  const agentDir = join(regDir, "agents");
  if (!existsSync(agentDir)) return refs;

  const entries = readdirSync(agentDir);
  for (const entry of entries) {
    if (!entry.endsWith(".yaml")) continue;
    try {
      const raw = readFileSync(join(agentDir, entry), "utf-8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const name = (data.name as string) || basename(entry, ".yaml");
      if (name === targetName) continue;

      if (data.extends === targetName) {
        refs.push(name);
        continue;
      }

      const skills = data.skills as { ref?: string }[] | undefined;
      if (skills?.some((s) => s.ref === targetName)) {
        refs.push(name);
        continue;
      }
    } catch {
      // skip unparseable
    }
  }
  return refs;
}

export function getElementPreview(cwd: string, name: string, lines = 5): string {
  const el = readElement(cwd, name);
  if (!el) return "(not found)";

  const content = el.type === "agent"
    ? (el.data.system_prompt as string) || ""
    : el.body;

  if (!content) return "(empty)";
  return content.split("\n").slice(0, lines).join("\n");
}

export function listElementNames(cwd: string, type?: string): { name: string; type: string; description: string }[] {
  return listElements(cwd, type).map((e) => ({ name: e.name, type: e.type, description: e.description }));
}

export function listElementsWithExpose(cwd: string): { name: string; expose: string[]; skills: string[] }[] {
  const regDir = getRegistryDir(cwd);
  const agentDir = join(regDir, "agents");
  const result: { name: string; expose: string[]; skills: string[] }[] = [];
  if (!existsSync(agentDir)) return result;

  const entries = readdirSync(agentDir);
  for (const entry of entries) {
    if (!entry.endsWith(".yaml")) continue;
    try {
      const raw = readFileSync(join(agentDir, entry), "utf-8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const name = (data.name as string) || basename(entry, ".yaml");
      const expose = (data.expose as string[]) || [];
      const skills = ((data.skills as { ref: string }[]) || []).map((s) => s.ref);
      result.push({ name, expose, skills });
    } catch {
      // skip
    }
  }
  return result;
}

export function readRecentActivity(cwd: string, max = 3): { time: string; text: string }[] {
  const logPath = join(getRegistryDir(cwd), "audit.log");
  if (!existsSync(logPath)) return [];

  try {
    const raw = readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-max);
    return recent.map((line) => {
      const m = line.match(/^\[([^\]]+)\]\s+\S+\s+(\S+)\s+(.+)$/);
      if (m) {
        const stamp = new Date(m[1]);
        const now = new Date();
        const diffMs = now.getTime() - stamp.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const time = diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago` : `${Math.floor(diffMin / 1440)}d ago`;
        const op = m[2];
        const detail = m[3];
        const opLabel = op === "export" ? "export" : op === "add" ? "added" : op === "remove" ? "removed" : op;
        return { time, text: `${opLabel} ${detail}` };
      }
      return { time: "", text: line };
    }).reverse();
  } catch {
    return [];
  }
}

const platformBadge = PLATFORM_BADGE;

export function platformBadgeShort(platform: string): string {
  return platformBadge[platform] || platform.slice(0, 2);
}
