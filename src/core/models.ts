import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getRegistryDir } from "./registry.js";

export interface ModelEntry {
  name: string;
}

export type ProviderType = "ollama" | "lmstudio" | "huggingface" | "openai";

export const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "huggingface", label: "HuggingFace" },
  { value: "openai", label: "OpenAI-compatible" },
];

export interface ModelProvider {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  models?: ModelEntry[];
  status: "online" | "offline" | "unknown";
  lastChecked?: string;
}

export interface ModelRegistry {
  providers: ModelProvider[];
}

function modelsPath(cwd: string): string {
  return join(getRegistryDir(cwd), "models.json");
}

function modelsDir(cwd: string): string {
  return join(getRegistryDir(cwd), "models");
}

function storagePath(cwd: string, type: ProviderType): string {
  const dir = modelsDir(cwd);
  const map: Record<string, string> = {
    ollama: "ollama",
    lmstudio: "lm-studio",
    huggingface: "hf",
  };
  return join(dir, map[type] || type);
}

export function readModels(cwd: string): ModelRegistry {
  const path = modelsPath(cwd);
  if (!existsSync(path)) return { providers: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ModelRegistry;
  } catch {
    return { providers: [] };
  }
}

export function writeModels(cwd: string, reg: ModelRegistry): void {
  writeFileSync(modelsPath(cwd), JSON.stringify(reg, null, 2), "utf-8");
  generateEnvFile(cwd);
}

export function addProvider(cwd: string, provider: ModelProvider): void {
  const reg = readModels(cwd);
  reg.providers = reg.providers.filter(p => p.name !== provider.name);
  reg.providers.push(provider);
  writeModels(cwd, reg);
}

export function removeProvider(cwd: string, name: string): void {
  const reg = readModels(cwd);
  reg.providers = reg.providers.filter(p => p.name !== name);
  writeModels(cwd, reg);
}

export function editProvider(cwd: string, name: string, updates: Partial<ModelProvider>): void {
  const reg = readModels(cwd);
  const idx = reg.providers.findIndex(p => p.name === name);
  if (idx === -1) return;
  reg.providers[idx] = { ...reg.providers[idx], ...updates };
  writeModels(cwd, reg);
}

export async function pingProvider(baseUrl: string): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(baseUrl, { method: "HEAD", signal: ac.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchModelList(baseUrl: string, type: ProviderType): Promise<string[]> {
  try {
    if (type === "ollama") {
      const url = baseUrl.replace(/\/$/, "") + "/api/tags";
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (!res.ok) return [];
      const data = await res.json() as { models?: { name: string }[] };
      return (data.models || []).map(m => m.name);
    }
    const url = baseUrl.replace(/\/$/, "") + "/v1/models";
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json() as { data?: { id: string }[] };
    return (data.data || []).map(m => m.id);
  } catch {
    return [];
  }
}

export async function testModelStream(
  baseUrl: string,
  model: string,
  prompt: string,
  apiKey?: string,
): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  try {
    const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });
    if (!res.ok || !res.body) return null;
    return res.body.getReader();
  } catch {
    return null;
  }
}

export async function detectLocal(cwd: string): Promise<ModelProvider[]> {
  const found: ModelProvider[] = [];
  const checks: { type: ProviderType; url: string; name: string }[] = [
    { type: "ollama", url: "http://localhost:11434", name: "Ollama" },
    { type: "ollama", url: "http://127.0.0.1:11434", name: "Ollama" },
    { type: "lmstudio", url: "http://localhost:1234", name: "LM Studio" },
    { type: "lmstudio", url: "http://127.0.0.1:1234", name: "LM Studio" },
  ];
  const results = await Promise.allSettled(
    checks.map(async (c) => {
      const online = await pingProvider(c.url);
      if (!online) return null;
      return { name: c.name, type: c.type, baseUrl: c.url, status: "online" as const, lastChecked: new Date().toISOString() };
    }),
  );
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      const key = `${r.value.type}:${r.value.baseUrl}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push(r.value);
      }
    }
  }
  return found;
}

export function generateEnvFile(cwd: string): void {
  const p = join(getRegistryDir(cwd), "models.env");
  const reg = readModels(cwd);
  const lines: string[] = [
    "# AgentForge Centralized Model Storage",
    "# Source this file:  source .agentforge/models.env",
    "",
  ];
  for (const prov of reg.providers) {
    if (prov.type === "ollama") {
      lines.push(`export OLLAMA_MODELS=${storagePath(cwd, "ollama")}`);
    } else if (prov.type === "huggingface") {
      lines.push(`export HF_HOME=${storagePath(cwd, "huggingface")}`);
    }
  }
  writeFileSync(p, lines.join("\n") + "\n", "utf-8");

  // Ensure storage directories exist
  for (const prov of reg.providers) {
    if (prov.type === "ollama" || prov.type === "huggingface" || prov.type === "lmstudio") {
      mkdirSync(storagePath(cwd, prov.type), { recursive: true });
    }
  }
}

export function scanStorage(cwd: string): { path: string; size: number }[] {
  const dir = modelsDir(cwd);
  if (!existsSync(dir)) return [];
  const results: { path: string; size: number }[] = [];
  function walk(d: string, prefix: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, prefix + entry + "/");
      else results.push({ path: prefix + entry, size: st.size });
    }
  }
  walk(dir, "");
  return results;
}

export interface ProviderConfig {
  url: string;
  headers: Record<string, string>;
  body: (system: string, user: string, model: string) => unknown;
  extract: (data: unknown) => string;
}

export function providerConfigFromModel(provider: ModelProvider): ProviderConfig {
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;
  return {
    url: baseUrl + "/v1/chat/completions",
    headers,
    body(system: string, user: string, model: string) {
      return { model, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    },
    extract(data: any) {
      return data?.choices?.[0]?.message?.content || JSON.stringify(data);
    },
  };
}
