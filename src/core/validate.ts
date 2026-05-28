import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";
import { ZodError } from "zod";
import { AgentSchema, SkillSchema, PromptSchema } from "./schema.js";
import type { RegistryElement } from "./schema.js";
import { estimateTokens } from "./tokens.js";
import type { LintConfig } from "./config.js";

export interface ValidationError {
  file: string;
  message: string;
}

export interface FixResult {
  file: string;
  fixes: string[];
}

const VALID_TYPES = ["agent", "skill", "prompt"];

export function lintElement(filePath: string, lintCfg: LintConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!existsSync(filePath)) return errors;

  const ext = extname(filePath);
  const raw = readFileSync(filePath, "utf-8");

  let parsed: Record<string, unknown>;
  let body = "";
  const fileName = basename(filePath);

  try {
    if (ext === ".md") {
      const fm = matter(raw);
      parsed = fm.data as Record<string, unknown>;
      body = fm.content.trim();
    } else {
      parsed = yaml.load(raw) as Record<string, unknown>;
    }
  } catch {
    return errors;
  }

  const type = inferType(filePath, parsed.name as string);

  if (type !== "agent") return errors;

  const systemPrompt = (parsed.system_prompt as string) || "";

  if (lintCfg.max_tokens) {
    const toks = estimateTokens(type === "agent" ? systemPrompt : body);
    if (toks > lintCfg.max_tokens) {
      errors.push({ file: fileName, message: `Token estimate ${toks} exceeds max ${lintCfg.max_tokens}` });
    }
  }

  if (lintCfg.banned_phrases) {
    for (const phrase of lintCfg.banned_phrases) {
      const lower = systemPrompt.toLowerCase();
      if (lower.includes(phrase.toLowerCase())) {
        errors.push({ file: fileName, message: `Banned phrase: "${phrase}"` });
      }
    }
  }

  if (lintCfg.required_sections && type === "agent") {
    for (const section of lintCfg.required_sections) {
      if (!systemPrompt.toLowerCase().includes(section.toLowerCase())) {
        errors.push({ file: fileName, message: `Missing required section: "${section}"` });
      }
    }
  }

  return errors;
}

function inferType(filePath: string, name?: string): RegistryElement["type"] {
  if (filePath.includes("/agents/")) return "agent";
  if (filePath.includes("/skills/")) return "skill";
  if (filePath.includes("/prompts/")) return "prompt";
  return "agent";
}

export function validateElement(filePath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!existsSync(filePath)) {
    errors.push({ file: filePath, message: "File does not exist" });
    return errors;
  }

  const ext = extname(filePath);
  const raw = readFileSync(filePath, "utf-8");

  try {
    let parsed: Record<string, unknown>;
    let body = "";

    if (ext === ".md") {
      const frontmatter = matter(raw);
      parsed = frontmatter.data as Record<string, unknown>;
      body = frontmatter.content.trim();
    } else if (ext === ".yaml" || ext === ".yml") {
      parsed = yaml.load(raw) as Record<string, unknown>;
    } else {
      errors.push({ file: filePath, message: `Unsupported file extension: ${ext}` });
      return errors;
    }

    const name = parsed.name as string;
    const type = inferType(filePath, name);

    switch (type) {
      case "agent": {
        AgentSchema.parse(parsed);
        break;
      }
      case "skill": {
        SkillSchema.parse({ ...parsed, body });
        break;
      }
      case "prompt": {
        PromptSchema.parse({ ...parsed, body });
        break;
      }
    }
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        let hint = "";
        const path = issue.path.join(".");
        if (path === "name" && issue.message.includes("Required")) hint = "Add 'name' field to the file";
        else if (path === "version" && issue.message.includes("Required")) hint = "Add 'version' field (e.g. \"1.0.0\")";
        else if (path === "description" && issue.message.includes("Required")) hint = "Add a 'description' field";
        else if (path === "system_prompt" && issue.message.includes("Required")) hint = "Add 'system_prompt' field with your agent instructions";
        else if (path.includes("body") && issue.message.includes("Required")) hint = "Add body content after the frontmatter";
        else if (path.includes("skills")) hint = "Set 'skills' to an array (e.g. [])";
        else if (path.includes("tools")) hint = "Set 'tools' to an array (e.g. [])";
        else if (issue.message.includes("Invalid")) hint = `Check the format of '${path}'`;
        errors.push({
          file: filePath,
          message: `${path}: ${issue.message}${hint ? ` — ${hint}` : ""}`,
        });
      }
    } else if (err instanceof yaml.YAMLException) {
      errors.push({ file: filePath, message: `YAML parsing error: ${err.message}. Check for missing quotes or invalid indentation.` });
    } else {
      errors.push({ file: filePath, message: String(err) });
    }
  }

  return errors;
}

export function fixElement(filePath: string): FixResult {
  const fixes: string[] = [];

  if (!existsSync(filePath)) {
    return { file: filePath, fixes };
  }

  const ext = extname(filePath);
  const raw = readFileSync(filePath, "utf-8");
  const fileName = basename(filePath);
  const type = inferType(filePath);
  let changed = false;

  try {
    if (ext === ".md") {
      const frontmatter = matter(raw);
      const data = frontmatter.data as Record<string, unknown>;
      const body = frontmatter.content.trim();

      if (!data.name) {
        data.name = basename(filePath, ext);
        fixes.push(`Added missing name: ${data.name}`);
        changed = true;
      }

      if (!data.version) {
        data.version = "1.0.0";
        fixes.push(`Added missing version: 1.0.0`);
        changed = true;
      }

      if (!data.description) {
        data.description = `${data.name} ${type}`;
        fixes.push(`Added missing description`);
        changed = true;
      }

      if (type === "prompt" && !data.tags) {
        data.tags = [];
        fixes.push(`Added missing tags`);
        changed = true;
      }

      if (changed) {
        const newContent = `---\n${yaml.dump(data, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${body}\n`;
        writeFileSync(filePath, newContent, "utf-8");
      }
    } else if (ext === ".yaml" || ext === ".yml") {
      const data = yaml.load(raw) as Record<string, unknown>;

      if (!data?.name) {
        fixes.push(`Cannot fix: missing name in ${fileName}`);
        return { file: filePath, fixes };
      }

      if (!data.version) {
        data.version = "1.0.0";
        fixes.push(`Added missing version: 1.0.0`);
        changed = true;
      }

      if (!data.description) {
        data.description = `${data.name} agent`;
        fixes.push(`Added missing description`);
        changed = true;
      }

      if (!data.system_prompt) {
        data.system_prompt = "You are a helpful AI assistant.";
        fixes.push(`Added missing system_prompt`);
        changed = true;
      }

      if (!data.skills) {
        data.skills = [];
        fixes.push(`Added missing skills`);
        changed = true;
      }

      if (!data.tools) {
        data.tools = [];
        fixes.push(`Added missing tools`);
        changed = true;
      }

      if (changed) {
        writeFileSync(filePath, yaml.dump(data, { indent: 2, lineWidth: 120 }), "utf-8");
      }
    }
  } catch {
    fixes.push(`Failed to parse: ${fileName}`);
  }

  return { file: filePath, fixes };
}
