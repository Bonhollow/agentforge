import type { UniversalSchema } from "../core/schema.js";

export interface SyncBackend {
  readonly name: string;
  push(schema: UniversalSchema): Promise<void>;
  pull(): Promise<UniversalSchema>;
}

export async function getSyncBackend(): Promise<SyncBackend> {
  const backend = process.env.AF_SYNC_BACKEND || "supabase";
  switch (backend) {
    case "local": {
      const { LocalBackend } = await import("./local-backend.js");
      return new LocalBackend();
    }
    case "supabase": {
      const { SupabaseBackend } = await import("./supabase-backend.js");
      return new SupabaseBackend();
    }
    default:
      throw new Error(`Unknown sync backend: "${backend}". Use "supabase" or "local".`);
  }
}
