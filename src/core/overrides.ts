import type { AgentSchema, OverrideFields, UniversalSchema } from "./schema.js";

export function resolveAgentForPlatform(
  agent: AgentSchema,
  platform: string,
): AgentSchema {
  const override = agent.overrides?.[platform as keyof typeof agent.overrides] as OverrideFields | undefined;
  if (!override) return agent;

  return {
    ...agent,
    system_prompt: override.system_prompt ?? agent.system_prompt,
    skills: override.skills ?? agent.skills,
    tools: override.tools ?? agent.tools,
    expose: override.expose ?? agent.expose,
  };
}

export function resolveSchemaForPlatform(
  schema: UniversalSchema,
  platform: string,
): UniversalSchema {
  return {
    ...schema,
    agents: schema.agents.map((a) => resolveAgentForPlatform(a, platform)),
  };
}
