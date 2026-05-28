import { createClient } from "@supabase/supabase-js";
import { consola } from "../utils/logger.js";

const SUPABASE_URL = process.env.AF_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.AF_SUPABASE_ANON_KEY || "";

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        "Supabase credentials not configured. Set AF_SUPABASE_URL and AF_SUPABASE_ANON_KEY environment variables."
      );
    }
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export async function getSession() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  consola.success("Signed out.");
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    const session = await getSession();
    return session !== null;
  } catch {
    return false;
  }
}
