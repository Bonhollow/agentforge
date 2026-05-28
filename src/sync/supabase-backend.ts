import { createClient } from "@supabase/supabase-js";
import { consola } from "../utils/logger.js";
import type { UniversalSchema } from "../core/schema.js";
import type { SyncBackend } from "./backend.js";

const SUPABASE_URL = process.env.AF_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.AF_SUPABASE_ANON_KEY || "";

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase credentials not configured. Set AF_SUPABASE_URL and AF_SUPABASE_ANON_KEY environment variables.");
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function getSession() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export class SupabaseBackend implements SyncBackend {
  readonly name = "Supabase";

  async push(schema: UniversalSchema): Promise<void> {
    const session = await getSession();
    if (!session) {
      consola.error("Not authenticated. Run `af auth login` first.");
      return;
    }

    const supabase = getSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: registry, error: regError } = await (supabase.from("registries") as any)
      .select("id")
      .eq("user_id", session.user.id)
      .single();
    if (regError && regError.code !== "PGRST116") {
      consola.error(`Registry lookup failed: ${regError.message}`);
      return;
    }

    let registryId: string;
    if (registry) {
      registryId = registry.id;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newReg, error: createError } = await (supabase.from("registries") as any)
        .insert({ user_id: session.user.id, name: "default", description: "Default registry" })
        .select("id")
        .single();
      if (createError) {
        consola.error(`Failed to create registry: ${createError.message}`);
        return;
      }
      registryId = newReg.id;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("elements") as any).delete().eq("registry_id", registryId);

    const elements: Array<{ registry_id: string; type: string; name: string; version: string; content: unknown; raw: string }> = [];
    for (const agent of schema.agents) {
      elements.push({ registry_id: registryId, type: "agent", name: agent.name, version: agent.version, content: agent, raw: JSON.stringify(agent) });
    }
    for (const skill of schema.skills) {
      elements.push({ registry_id: registryId, type: "skill", name: skill.name, version: skill.version, content: skill, raw: JSON.stringify(skill) });
    }
    for (const prompt of schema.prompts) {
      elements.push({ registry_id: registryId, type: "prompt", name: prompt.name, version: prompt.version, content: prompt, raw: JSON.stringify(prompt) });
    }

    if (elements.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await (supabase.from("elements") as any).insert(elements);
      if (insertError) {
        consola.error(`Failed to push elements: ${insertError.message}`);
        return;
      }
    }

    consola.success(`Pushed ${elements.length} elements to ${this.name}.`);
  }

  async pull(): Promise<UniversalSchema> {
    const session = await getSession();
    if (!session) {
      consola.error("Not authenticated. Run `af auth login` first.");
      return { agents: [], skills: [], prompts: [] };
    }

    const supabase = getSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: registry, error: regError } = await (supabase.from("registries") as any)
      .select("id")
      .eq("user_id", session.user.id)
      .single();
    if (regError) {
      consola.error(`Registry lookup failed: ${regError.message}`);
      return { agents: [], skills: [], prompts: [] };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: elements, error: elError } = await (supabase.from("elements") as any)
      .select("*")
      .eq("registry_id", registry.id);
    if (elError) {
      consola.error(`Failed to pull elements: ${elError.message}`);
      return { agents: [], skills: [], prompts: [] };
    }

    return {
      agents: elements.filter((e: { type: string }) => e.type === "agent").map((e: { content: UniversalSchema["agents"][number] }) => e.content),
      skills: elements.filter((e: { type: string }) => e.type === "skill").map((e: { content: UniversalSchema["skills"][number] }) => e.content),
      prompts: elements.filter((e: { type: string }) => e.type === "prompt").map((e: { content: UniversalSchema["prompts"][number] }) => e.content),
    };
  }
}
