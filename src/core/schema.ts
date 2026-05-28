import { z } from "zod";

export const AgentType = z.enum(["agent", "skill", "prompt"]);
export type AgentType = z.infer<typeof AgentType>;

export const ExposeTarget = z.enum(["claude_code", "codex", "opencode", "cursor", "windsurf"]);
export type ExposeTarget = z.infer<typeof ExposeTarget>;

export const SkillRef = z.object({
  ref: z.string(),
});
export type SkillRef = z.infer<typeof SkillRef>;

export const MCPServerSchema = z.object({
  type: z.literal("mcp"),
  name: z.string().min(1),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});
export type MCPServerTool = z.infer<typeof MCPServerSchema>;

export const ToolItem = z.union([z.string(), MCPServerSchema]);

export const OverrideFields = z.object({
  system_prompt: z.string().optional(),
  skills: z.array(SkillRef).optional(),
  prompts: z.array(z.string()).optional(),
  tools: z.array(ToolItem).optional(),
  expose: z.array(ExposeTarget).optional(),
});
export type OverrideFields = z.infer<typeof OverrideFields>;

export const AgentSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  extends: z.string().optional(),
  system_prompt: z.string().min(1),
  skills: z.array(SkillRef).default([]),
  prompts: z.array(z.string()).default([]),
  tools: z.array(ToolItem).default([]),
  expose: z.array(ExposeTarget).default(["claude_code", "codex", "opencode", "cursor", "windsurf"]),
  overrides: z.record(ExposeTarget, OverrideFields).optional(),
});
export type AgentSchema = z.infer<typeof AgentSchema>;

export const SkillSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  body: z.string(),
});
export type SkillSchema = z.infer<typeof SkillSchema>;

export const PromptSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  body: z.string(),
});
export type PromptSchema = z.infer<typeof PromptSchema>;

export const RegistryElement = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent"), data: AgentSchema }),
  z.object({ type: z.literal("skill"), data: SkillSchema }),
  z.object({ type: z.literal("prompt"), data: PromptSchema }),
]);
export type RegistryElement = z.infer<typeof RegistryElement>;

export const UniversalSchema = z.object({
  $schema: z.string().optional(),
  agents: z.array(AgentSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  prompts: z.array(PromptSchema).default([]),
});
export type UniversalSchema = z.infer<typeof UniversalSchema>;

export const SupportedTargets = ["claude_code", "codex", "opencode", "cursor", "windsurf"] as const;
export type SupportedTarget = (typeof SupportedTargets)[number];
