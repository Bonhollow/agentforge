import { createClient } from "@supabase/supabase-js";
import type { UniversalSchema } from "../core/schema.js";

const SUPABASE_URL = process.env.AF_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.AF_SUPABASE_ANON_KEY || "";

export function getShareClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase credentials not configured. Set AF_SUPABASE_URL and AF_SUPABASE_ANON_KEY environment variables.");
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export async function pushSharedElement(
  owner: string,
  type: "agent" | "skill" | "prompt",
  name: string,
  version: string,
  content: Record<string, unknown>,
): Promise<void> {
  const supabase = getShareClient();

  const raw = JSON.stringify(content);

  const { error } = await (supabase.from("shared_elements") as any).upsert(
    { owner, type, name, version, content, raw },
    { onConflict: "owner,type,name" },
  );

  if (error) throw new Error(`Failed to share element: ${error.message}`);
}

export async function pullSharedElements(owner: string): Promise<UniversalSchema> {
  const supabase = getShareClient();

  const { data: elements, error } = await (supabase.from("shared_elements") as any)
    .select("*")
    .eq("owner", owner);

  if (error) throw new Error(`Failed to pull shared elements: ${error.message}`);

  const agents: UniversalSchema["agents"] = [];
  const skills: UniversalSchema["skills"] = [];
  const prompts: UniversalSchema["prompts"] = [];

  for (const el of elements || []) {
    const item = el.content || JSON.parse(el.raw || "{}");
    if (el.type === "agent") agents.push(item);
    else if (el.type === "skill") skills.push(item);
    else if (el.type === "prompt") prompts.push(item);
  }

  return { agents, skills, prompts };
}

export function detectOwner(): string | null {
  if (process.env.AF_SHARE_OWNER) return process.env.AF_SHARE_OWNER;

  try {
    const { execSync } = require("node:child_process");
    return execSync("git config user.name", { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}
