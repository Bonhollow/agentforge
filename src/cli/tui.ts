import * as p from "@clack/prompts";
import { consola } from "../utils/logger.js";
import { existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { initRegistry, listElements, readElement, removeElement, addElement, readRegistry, writeRegistry, findReferences } from "../core/registry.js";
import { getRegistryDir } from "../core/registry.js";
import { validateElement } from "../core/validate.js";
import { diffSchemas, formatDiff } from "../core/diff.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { claudeCodeAdapter } from "../adapters/claude-code.js";
import { codexAdapter } from "../adapters/codex.js";
import { opencodeAdapter } from "../adapters/opencode.js";
import { cursorAdapter } from "../adapters/cursor.js";
import { windsurfAdapter } from "../adapters/windsurf.js";
import type { Adapter } from "../adapters/base.js";
import type { SupportedTarget, UniversalSchema } from "../core/schema.js";
import { loadVars, resolveSchemaVars } from "../core/vars.js";
import { readLock, writeLock, getChangedElements, updateLock } from "../core/lock.js";
import { runHook } from "../core/hooks.js";
import { loadConfig, saveConfig, resolvePlatforms } from "../core/config.js";
import { resolveSchemaForPlatform } from "../core/overrides.js";
import { runTwoColumnTui } from "./tui-layout.js";
import type { TuiResult } from "./tui-layout.js";
import { colorType, colorName, colors as C } from "../utils/colors.js";
import { syncExposed, isSyncing } from "../core/sync.js";
import { readMCPServers, writeMCPServers, addMCPServer, removeMCPServer, renameMCPServer, mcpServersPath } from "../core/mcp.js";
import { readModels, writeModels, addProvider, removeProvider, editProvider, pingProvider, fetchModelList, testModelStream, detectLocal, scanStorage, generateEnvFile } from "../core/models.js";
import type { ModelProvider, ProviderType } from "../core/models.js";
import { watch } from "node:fs";

const adapters: Record<string, Adapter> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  windsurf: windsurfAdapter,
};

function hasRegistry(): boolean {
  return existsSync(getRegistryDir(process.cwd()));
}

async function pickElement(cwd: string, type?: string): Promise<string | null> {
  const elements = listElements(cwd, type);
  if (elements.length === 0) {
    consola.error("No elements found.");
    return null;
  }
  const choices = elements.map((e) => ({
    value: e.name,
    label: `${colorName(e.name, e.type).padEnd(28)} ${colorType(e.type).padEnd(12)} v${e.version}`,
  }));
  const name = await p.select({
    message: "Pick an element:",
    options: choices,
  });
  if (p.isCancel(name)) return null;
  return name as string;
}

async function tuiInit() {
  const global = await p.confirm({
    message: "Init global registry at ~/.agentforge/?",
    initialValue: false,
  });
  if (p.isCancel(global)) return;
  const path = initRegistry(process.cwd(), global as boolean);
  consola.success(`Registry initialised at ${path}`);
}

async function tuiInfo() {
  const cwd = process.cwd();
  const regDir = getRegistryDir(cwd);
  if (!existsSync(regDir)) { consola.error("No registry."); return; }

  const cfg = loadConfig(cwd);
  const elements = listElements(cwd);

  consola.log(` ${C.bold}Registry${C.reset}`);
  consola.log(`  Path: ${regDir}`);
  consola.log(`  Agents: ${elements.filter(e => e.type === "agent").length}`);
  consola.log(`  Skills: ${elements.filter(e => e.type === "skill").length}`);
  consola.log(`  Prompts: ${elements.filter(e => e.type === "prompt").length}`);

  consola.log(`\n ${C.bold}Platforms${C.reset}`);
  const platforms = cfg.platforms ?? ["claude_code", "codex", "opencode", "cursor", "windsurf"];
  for (const p of platforms) consola.log(`  ${C.green}\u2713${C.reset} ${p}`);

  consola.log(`\n ${C.bold}Active agent${C.reset}`);
  const activePath = join(regDir, ".active-agent");
  if (existsSync(activePath)) {
    const active = readFileSync(activePath, "utf-8").trim();
    consola.log(`  ${active}`);
  } else {
    consola.log(`  (none)`);
  }

  const hookCount = Object.keys(cfg.hooks?.pre_export || {}).length + Object.keys(cfg.hooks?.post_export || {}).length;
  const varCount = Object.keys(cfg.vars || {}).length;
  consola.log(`\n ${C.bold}Config${C.reset}`);
  consola.log(`  Variables defined: ${varCount}`);
  consola.log(`  Export hooks: ${hookCount}`);
}

async function tuiConfig() {
  const cwd = process.cwd();
  const cfg = loadConfig(cwd);

  while (true) {
    const field = await p.select({
      message: "Project config",
      options: [
        { value: "platforms", label: "Export targets", hint: (cfg.platforms || ["all"]).join(", ") },
        { value: "vars", label: "Variables", hint: `${Object.keys(cfg.vars || {}).length} defined` },
        { value: "__done", label: "Done" },
      ],
    });
    if (p.isCancel(field) || field === "__done") break;

    if (field === "platforms") {
      const picked = await p.multiselect({
        message: "Export to which platforms?",
        options: [
          { value: "claude_code", label: "Claude Code" },
          { value: "codex", label: "Codex" },
          { value: "opencode", label: "OpenCode" },
          { value: "cursor", label: "Cursor" },
          { value: "windsurf", label: "Windsurf" },
        ],
        required: false,
      });
      if (p.isCancel(picked)) continue;
      cfg.platforms = picked as string[];
    } else if (field === "vars") {
      while (true) {
        const current = Object.entries(cfg.vars || {}).map(([k, v]) => `${k}=${v}`);
        const varAction = await p.select({
          message: `Variables (${current.length})`,
          options: [
            ...current.map((v) => ({ value: `remove:${v.split("=")[0]}`, label: `Remove: ${v}` })),
            { value: "add", label: "Add variable" },
            { value: "__done", label: "Done" },
          ],
        });
        if (p.isCancel(varAction) || varAction === "__done") break;

        if (varAction === "add") {
          const key = await p.text({ message: "Variable name:", placeholder: "MY_VAR" });
          if (p.isCancel(key)) continue;
          const val = await p.text({ message: "Value:", placeholder: "my-value" });
          if (p.isCancel(val)) continue;
          if (!cfg.vars) cfg.vars = {};
          cfg.vars[key as string] = val as string;
        } else if (varAction.startsWith("remove:")) {
          const k = varAction.slice(7);
          if (cfg.vars) delete cfg.vars[k];
        }
      }
    }

    const configPath = join(cwd, ".agentforge", "config.yaml");
    writeFileSync(configPath, yaml.dump(cfg, { indent: 2 }), "utf-8");
    consola.success("Config updated");
  }
}

async function tuiAdd() {
  const type = await p.select({
    message: "Element type:",
    options: [
      { value: "agent", label: "Agent" },
      { value: "skill", label: "Skill" },
      { value: "prompt", label: "Prompt" },
    ],
  });
  if (p.isCancel(type)) return;

  const name = await p.text({
    message: "Element name:",
    validate: (v) => (v && v.trim().length === 0 ? "Name cannot be empty" : undefined),
  });
  if (p.isCancel(name)) return;

  const data: Record<string, unknown> = { name };

  if (type === "agent") {
    const description = await p.text({
      message: "Description:",
      initialValue: `${name} agent`,
    });
    if (p.isCancel(description)) return;
    data.description = description;

    const version = await p.text({
      message: "Version:",
      initialValue: "1.0.0",
      validate: (v) => (v && /^\d+\.\d+\.\d+$/.test(v) ? undefined : "Must be semver (e.g. 1.0.0)"),
    });
    if (p.isCancel(version)) return;
    data.version = version;

    const systemPrompt = await p.text({
      message: "System prompt:",
      placeholder: "You are a helpful AI assistant that...",
      validate: (v) => (v && v.trim().length === 0 ? "Prompt cannot be empty" : undefined),
    });
    if (p.isCancel(systemPrompt)) return;
    data.system_prompt = systemPrompt;

    data.tools = await toolEditor([]);

    const expose = await p.multiselect({
      message: "Export to which platforms?",
      options: [
        { value: "claude_code", label: "Claude Code" },
        { value: "codex", label: "Codex" },
        { value: "opencode", label: "OpenCode" },
        { value: "cursor", label: "Cursor" },
        { value: "windsurf", label: "Windsurf" },
      ],
      required: false,
      initialValues: ["claude_code", "codex", "opencode", "cursor"],
    });
    if (p.isCancel(expose)) return;
    data.expose = expose;

    data.skills = [];

    const cwd = process.cwd();
    const allElements = listElements(cwd);
    const availableSkills = allElements.filter((e) => e.type === "skill");
    if (availableSkills.length > 0) {
      const picked = await p.multiselect({
        message: `Link skills (${availableSkills.length} available):`,
        options: availableSkills.map((s) => ({
          value: s.name,
          label: s.name,
          hint: s.description,
        })),
        required: false,
      });
      if (p.isCancel(picked)) return;
      data.skills = (picked as string[]).map((ref) => ({ ref }));
    }
  } else {
    const description = await p.text({
      message: "Description:",
      initialValue: `${name} ${type}`,
    });
    if (p.isCancel(description)) return;
    data.description = description;

    const version = await p.text({
      message: "Version:",
      initialValue: "1.0.0",
      validate: (v) => (v && /^\d+\.\d+\.\d+$/.test(v) ? undefined : "Must be semver (e.g. 1.0.0)"),
    });
    if (p.isCancel(version)) return;
    data.version = version;

    if (type === "prompt") {
      const tags = await p.text({
        message: "Tags (comma-separated, optional):",
        placeholder: "code-review, typescript, ...",
      });
      if (p.isCancel(tags)) return;
      data.tags = (tags as string).split(",").map((t: string) => t.trim()).filter(Boolean);
    }

    const body = await p.text({
      message: "Content:",
      placeholder: `Describe your ${type} here...`,
      validate: (v) => (v && v.trim().length === 0 ? "Content cannot be empty" : undefined),
    });
    if (p.isCancel(body)) return;
    data.body = body;
  }

  const filePath = addElement(process.cwd(), type as string, name as string);

  if (type === "agent") {
    writeFileSync(filePath, yaml.dump(data, { indent: 2, lineWidth: 120 }), "utf-8");
  } else {
    const { body, ...frontmatter } = data;
    const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${body}\n`;
    writeFileSync(filePath, content, "utf-8");
  }

  consola.success(`Created ${type} "${name}"`);
  syncExposed(process.cwd(), true);
}

async function tuiAddSkill() {
  const name = await p.text({
    message: "Skill name:",
    validate: (v) => (v && v.trim().length === 0 ? "Name cannot be empty" : undefined),
  });
  if (p.isCancel(name)) return;

  const description = await p.text({
    message: "Description:",
    initialValue: `${name} skill`,
  });
  if (p.isCancel(description)) return;

  const version = await p.text({
    message: "Version:",
    initialValue: "1.0.0",
    validate: (v) => (v && /^\d+\.\d+\.\d+$/.test(v) ? undefined : "Must be semver (e.g. 1.0.0)"),
  });
  if (p.isCancel(version)) return;

  const body = await p.text({
    message: "Content:",
    placeholder: "Describe the skill here...",
    validate: (v) => (v && v.trim().length === 0 ? "Content cannot be empty" : undefined),
  });
  if (p.isCancel(body)) return;

  const data = { name: name as string, description: description as string, version: version as string, body: body as string };
  const filePath = addElement(process.cwd(), "skill", name as string);
  const { body: bodyContent, ...frontmatter } = data;
  const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${bodyContent}\n`;
  writeFileSync(filePath, content, "utf-8");
  consola.success(`Created skill "${name}"`);
  syncExposed(process.cwd(), true);
}

async function tuiAddPrompt() {
  const name = await p.text({ message: "Prompt name:", validate: (v) => (v && v.trim().length === 0 ? "Name cannot be empty" : undefined) });
  if (p.isCancel(name)) return;
  const description = await p.text({ message: "Description:", initialValue: `${name} prompt` });
  if (p.isCancel(description)) return;
  const version = await p.text({ message: "Version:", initialValue: "1.0.0", validate: (v) => (v && /^\d+\.\d+\.\d+$/.test(v) ? undefined : "Must be semver") });
  if (p.isCancel(version)) return;
  const tags = await p.text({ message: "Tags (comma-separated, optional):", placeholder: "code-review, typescript, ..." });
  if (p.isCancel(tags)) return;
  const body = await p.text({ message: "Content:", placeholder: "Write your prompt here. Use {variable} for dynamic values...", validate: (v) => (v && v.trim().length === 0 ? "Content cannot be empty" : undefined) });
  if (p.isCancel(body)) return;

  const data: Record<string, unknown> = {
    name: name as string,
    description: description as string,
    version: version as string,
    tags: (tags as string).split(",").map((t: string) => t.trim()).filter(Boolean),
    body: body as string,
  };
  const filePath = addElement(process.cwd(), "prompt", name as string);
  const { body: bodyContent, ...frontmatter } = data;
  const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${bodyContent}\n`;
  writeFileSync(filePath, content, "utf-8");
  consola.success(`Created prompt "${name}"`);
  syncExposed(process.cwd(), true);
}

async function tuiPromptLink() {
  const cwd = process.cwd();
  const schema = readRegistry(cwd);
  const agents = schema.agents.map((a: { name: string }) => a.name);
  if (agents.length === 0) { consola.info("No agents found."); return; }
  const agentName = await p.select({ message: "Link prompts to which agent?", options: agents.map((n: string) => ({ value: n, label: n })) });
  if (p.isCancel(agentName)) return;
  const el = readElement(cwd, agentName as string);
  if (!el) { consola.error("Agent not found."); return; }

  const allPrompts = schema.prompts.map((pr: { name: string }) => pr.name);
  if (allPrompts.length === 0) { consola.info("No prompts available. Create some first."); return; }

  const current = (el.data.prompts as string[]) || [];
  const linked = new Set(current);

  const picked = await p.multiselect({
    message: `Select prompts for "${agentName}":`,
    options: allPrompts.map((n: string) => ({ value: n, label: n, hint: linked.has(n) ? "linked" : "" })),
    required: false,
  });
  if (p.isCancel(picked)) return;

  el.data.prompts = picked as string[];
  writeFileSync(el.filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
  consola.success(`Prompts linked to "${agentName}".`);
}

async function tuiVariables() {
  const cwd = process.cwd();
  const cfg = loadConfig(cwd);
  const vars = cfg.vars || {};

  while (true) {
    const entries = Object.entries(vars);
    const options = [
      ...entries.map(([k, v], i) => ({ value: `edit:${k}`, label: `${k} = ${v}` })),
      { value: "add", label: "[A]dd variable" },
      ...(entries.length > 0 ? [{ value: "remove", label: "[R]emove variable" }] : []),
      { value: "__done", label: "Done" },
    ];

    const action = await p.select({
      message: `Variables (${entries.length}):`,
      options,
    });
    if (p.isCancel(action) || action === "__done") break;

    if (action === "add") {
      const key = await p.text({ message: "Variable name:", placeholder: "model, language, ...", validate: (v) => (v ? undefined : "Required") });
      if (p.isCancel(key)) continue;
      const val = await p.text({ message: `Value for "${key}":`, placeholder: "gpt-4, typescript, ..." });
      if (p.isCancel(val)) continue;
      vars[key as string] = val as string;
    } else if (action === "remove") {
      const toRemove = await p.select({
        message: "Remove variable:",
        options: entries.map(([k]) => ({ value: k, label: k })),
      });
      if (p.isCancel(toRemove)) continue;
      delete vars[toRemove as string];
    } else if (action.startsWith("edit:")) {
      const k = action.slice(5);
      const val = await p.text({ message: `Value for "${k}":`, initialValue: vars[k] });
      if (p.isCancel(val)) continue;
      vars[k] = val as string;
    }

    cfg.vars = vars;
    saveConfig(cwd, cfg);
  }
}

async function tuiModelsList() {
  const cwd = process.cwd();
  const reg = readModels(cwd);
  if (reg.providers.length === 0) {
    consola.info("No model providers registered.");
    consola.log("Use Auto-detect or Add provider to register one.");
    return;
  }
  // Ping all and update status
  const updated = await Promise.all(
    reg.providers.map(async (p) => {
      const ok = await pingProvider(p.baseUrl);
      p.status = ok ? "online" : "offline";
      p.lastChecked = new Date().toISOString();
      return p;
    }),
  );
  // Fetch model lists
  for (const p of updated) {
    if (p.status === "online") {
      const models = await fetchModelList(p.baseUrl, p.type);
      p.models = models.map(m => ({ name: m }));
    }
  }
  writeModels(cwd, { providers: updated });
  // Storage scan
  const files = scanStorage(cwd);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  consola.success(`${reg.providers.length} provider(s):`);
  for (const p of updated) {
    const badge = p.status === "online" ? C.green + "online" + C.reset : C.red + "offline" + C.reset;
    const count = p.models ? p.models.length : 0;
    consola.log(`  ${p.name} (${p.type})  ${badge}  ${count} model${count !== 1 ? "s" : ""}  ${C.dim}${p.baseUrl}${C.reset}`);
  }
  if (files.length > 0) {
    consola.log(`Storage: ${files.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  }
}

async function tuiModelsDetect() {
  const cwd = process.cwd();
  consola.info("Probing localhost for Ollama and LM Studio...");
  const found = await detectLocal(cwd);
  if (found.length === 0) {
    consola.warn("No local providers detected.");
    return;
  }
  for (const p of found) {
    addProvider(cwd, p);
    consola.success(`Added ${p.name} (${p.baseUrl})`);
  }
}

async function tuiModelsAdd() {
  const cwd = process.cwd();
  const type = await p.select({
    message: "Provider type:",
    options: [
      { value: "ollama", label: "Ollama" },
      { value: "lmstudio", label: "LM Studio" },
      { value: "huggingface", label: "HuggingFace" },
      { value: "openai", label: "OpenAI-compatible" },
    ],
  });
  if (p.isCancel(type)) return;
  const name = await p.text({ message: "Display name:", placeholder: type === "ollama" ? "Ollama" : "My Provider", validate: (v) => (v ? undefined : "Required") });
  if (p.isCancel(name)) return;
  const baseUrl = await p.text({ message: "Base URL:", placeholder: type === "ollama" ? "http://localhost:11434" : type === "lmstudio" ? "http://localhost:1234" : "https://api.openai.com/v1", validate: (v) => (v ? undefined : "Required") });
  if (p.isCancel(baseUrl)) return;
  let apiKey: string | undefined;
  if (type === "openai" || type === "huggingface") {
    const key = await p.password({ message: "API key (optional):" });
    if (!p.isCancel(key) && key) apiKey = key as string;
  }
  const provider: ModelProvider = { name: name as string, type: type as ProviderType, baseUrl: baseUrl as string, apiKey, status: "unknown" };
  addProvider(cwd, provider);
  consola.success(`Added provider "${name}"`);
}

async function tuiModelsEdit() {
  const cwd = process.cwd();
  const reg = readModels(cwd);
  if (reg.providers.length === 0) { consola.info("No providers to edit."); return; }
  const choice = await p.select({
    message: "Select provider to edit:",
    options: reg.providers.map(p => ({ value: p.name, label: `${p.name} (${p.type})` })),
  });
  if (p.isCancel(choice)) return;
  const prov = reg.providers.find(p => p.name === choice);
  if (!prov) return;
  const name = await p.text({ message: "Name:", initialValue: prov.name, placeholder: prov.name });
  if (p.isCancel(name)) return;
  const baseUrl = await p.text({ message: "Base URL:", initialValue: prov.baseUrl });
  if (p.isCancel(baseUrl)) return;
  let apiKey = prov.apiKey;
  if (prov.type === "openai" || prov.type === "huggingface") {
    const key = await p.password({ message: `API key (current: ${prov.apiKey ? "set" : "empty"}):` });
    if (!p.isCancel(key)) apiKey = (key as string) || undefined;
  }
  editProvider(cwd, prov.name, { name: name as string, baseUrl: baseUrl as string, apiKey, status: "unknown" });
  consola.success(`Updated provider "${name}"`);
}

async function tuiModelsRemove() {
  const cwd = process.cwd();
  const reg = readModels(cwd);
  if (reg.providers.length === 0) { consola.info("No providers to remove."); return; }
  const choice = await p.select({
    message: "Select provider to remove:",
    options: reg.providers.map(p => ({ value: p.name, label: `${p.name} (${p.type})` })),
  });
  if (p.isCancel(choice)) return;
  const confirmed = await p.confirm({ message: `Remove "${choice}"? (model files kept)` });
  if (p.isCancel(confirmed) || !confirmed) return;
  removeProvider(cwd, choice as string);
  consola.success(`Removed provider "${choice}"`);
}

async function tuiModelsTest() {
  const cwd = process.cwd();
  const reg = readModels(cwd);
  if (reg.providers.length === 0) { consola.info("No providers. Add one first."); return; }
  const pChoice = await p.select({
    message: "Select provider:",
    options: reg.providers.map(p => ({ value: p.name, label: `${p.name}  ${p.status === "online" ? C.green + "\u25cf" + C.reset : C.red + "\u25cf" + C.reset}` })),
  });
  if (p.isCancel(pChoice)) return;
  const prov = reg.providers.find(p => p.name === pChoice);
  if (!prov) return;
  // Refresh model list if none cached
  if (!prov.models || prov.models.length === 0) {
    consola.info("Fetching model list...");
    const models = await fetchModelList(prov.baseUrl, prov.type);
    prov.models = models.map(m => ({ name: m }));
  }
  if (!prov.models || prov.models.length === 0) { consola.error("No models available."); return; }
  const modelChoice = await p.select({
    message: "Select model:",
    options: prov.models.map(m => ({ value: m.name, label: m.name })),
  });
  if (p.isCancel(modelChoice)) return;
  const prompt = await p.text({ message: "Enter prompt:", placeholder: "Hello, who are you?" });
  if (p.isCancel(prompt)) return;
  consola.info(`Streaming response from ${modelChoice}...\n`);
  const reader = await testModelStream(prov.baseUrl, modelChoice as string, prompt as string, prov.apiKey);
  if (!reader) { consola.error("Failed to connect."); return; }
  process.stdout.write(C.cyan);
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const json = trimmed.slice(6);
      if (json === "[DONE]") continue;
      try {
        const chunk = JSON.parse(json) as { choices?: { delta?: { content?: string } }[] };
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) process.stdout.write(content);
      } catch { /* skip malformed */ }
    }
  }
  process.stdout.write(C.reset + "\n\n");
  consola.success("Done.");
}

async function tuiModelsStorage() {
  const cwd = process.cwd();
  const reg = readModels(cwd);
  const files = scanStorage(cwd);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  consola.log(`${C.bold}Model Registry:${C.reset} ${reg.providers.length} provider(s)`);
  for (const p of reg.providers) {
    consola.log(`  ${p.name} (${p.type})  ${C.dim}${p.baseUrl}${C.reset}`);
  }
  if (files.length > 0) {
    consola.log(`\n${C.bold}Storage:${C.reset}  ${files.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  } else {
    consola.log(`\n${C.bold}Storage:${C.reset}  No downloaded files yet.`);
  }
  generateEnvFile(cwd);
  consola.success(`Regenerated .agentforge/models.env`);
}

async function tuiList() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const type = await p.select({
    message: "Filter by type:",
    options: [
      { value: undefined, label: "All" },
      { value: "agent", label: "Agents" },
      { value: "skill", label: "Skills" },
      { value: "prompt", label: "Prompts" },
    ],
  });
  if (p.isCancel(type)) return;

  const elements = listElements(process.cwd(), type as string | undefined);
  if (elements.length === 0) {
    consola.info("No elements found.");
    return;
  }
  for (const el of elements) {
    const colored = `${colorType(el.type).padEnd(14)} ${colorName(el.name, el.type).padEnd(28)} v${el.version.padEnd(8)} ${el.description}`;
    consola.log(colored);
  }
}

async function tuiShow() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const name = await pickElement(process.cwd());
  if (!name) return;

  const el = readElement(process.cwd(), name);
  if (!el) {
    consola.error(`Element "${name}" not found.`);
    return;
  }
  consola.log(`Type: ${colorType(el.type)}`);
  consola.log(yaml.dump(el.data, { indent: 2, lineWidth: 120 }));
  if (el.body) {
    consola.log("--- Body ---");
    consola.log(el.body);
  }
}

async function tuiEdit() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const cwd = process.cwd();
  const name = await pickElement(cwd);
  if (!name) return;

  const el = readElement(cwd, name);
  if (!el) { consola.error(`Element "${name}" not found.`); return; }

  const editing = true;
  while (editing) {
    const field = await p.select({
      message: `Editing ${colorName(el.data.name as string, el.type)} (${colorType(el.type)}) — choose a field:`,
      options: [
        { value: "description", label: "Description", hint: (el.data.description as string)?.slice(0, 40) || "empty" },
        { value: "version", label: "Version", hint: (el.data.version as string) || "1.0.0" },
        ...(el.type === "agent"
          ? [
              { value: "system_prompt", label: "System prompt", hint: "" },
              { value: "skills", label: "Skills", hint: `${((el.data.skills as unknown[]) || []).length} linked` },
              { value: "tools", label: "Tools", hint: `${((el.data.tools as unknown[]) || []).length}` },
              { value: "expose", label: "Expose", hint: ((el.data.expose as string[]) || []).join(", ") || "" },
            ] as const
          : [
              { value: "body", label: "Body content", hint: "" },
              ...(el.type === "prompt" ? [{ value: "tags", label: "Tags", hint: ((el.data.tags as string[]) || []).join(", ") || "none" }] : []),
            ] as const),
        { value: "__done", label: "Done editing" },
      ],
    });
    if (p.isCancel(field)) return;

    if (field === "__done") break;

    if (field === "version") {
      const val = await p.text({
        message: "Version:",
        initialValue: el.data.version as string,
        validate: (v) => (v ? (/^\d+\.\d+\.\d+$/.test(v) ? undefined : "Must be semver (e.g. 1.0.0)") : "Required"),
      });
      if (p.isCancel(val)) continue;
      el.data.version = val;
    } else if (field === "description") {
      const val = await p.text({
        message: "Description:",
        initialValue: el.data.description as string,
        validate: (v) => (v ? undefined : "Required"),
      });
      if (p.isCancel(val)) continue;
      el.data.description = val;
    } else if (field === "system_prompt") {
      const val = await p.text({
        message: "System prompt:",
        initialValue: el.data.system_prompt as string,
      });
      if (p.isCancel(val)) continue;
      el.data.system_prompt = val;
    } else if (field === "skills") {
      await editSkills(cwd, el);
    } else if (field === "body") {
      const val = await p.text({
        message: "Body content:",
        initialValue: el.body,
      });
      if (p.isCancel(val)) continue;
      el.body = val;
    } else if (field === "tools") {
      await editTools(cwd, el);
    } else if (field === "expose") {
      const current = (el.data.expose as string[]) || [];
      const picked = await p.multiselect({
        message: "Export to which platforms?",
        options: [
          { value: "claude_code", label: "Claude Code", hint: current.includes("claude_code") ? "active" : "" },
          { value: "codex", label: "Codex", hint: current.includes("codex") ? "active" : "" },
          { value: "opencode", label: "OpenCode", hint: current.includes("opencode") ? "active" : "" },
          { value: "cursor", label: "Cursor", hint: current.includes("cursor") ? "active" : "" },
          { value: "windsurf", label: "Windsurf", hint: current.includes("windsurf") ? "active" : "" },
        ],
        required: false,
      });
      if (p.isCancel(picked)) continue;
      el.data.expose = picked as string[];
    } else if (field === "tags") {
      const val = await p.text({
        message: "Tags (comma-separated):",
        initialValue: ((el.data.tags as string[]) || []).join(", "),
      });
      if (p.isCancel(val)) continue;
      el.data.tags = (val as string).split(",").map((t: string) => t.trim()).filter(Boolean);
    }

    // Write back
    if (el.type === "agent") {
      writeFileSync(el.filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
    } else {
      const frontmatter: Record<string, unknown> = {
        name: el.data.name,
        version: el.data.version,
        description: el.data.description,
        ...(el.type === "prompt" ? { tags: el.data.tags } : {}),
      };
      const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${el.body || ""}\n`;
      writeFileSync(el.filePath, content, "utf-8");
    }
    consola.success(`Updated ${field}`);
    syncExposed(process.cwd(), true);
  }
}

async function toolEditor(initial: unknown[]): Promise<unknown[]> {
  const tools = [...initial];
  while (true) {
    const toolStrs = tools.map((t: unknown) => {
      if (typeof t === "string") return t;
      const mcp = t as { type: string; name: string; url?: string; command?: string; args?: string[] };
      if (mcp.url) return `mcp:${mcp.name} (${mcp.url})`;
      if (mcp.command) return `mcp:${mcp.name} (${mcp.command} ${(mcp.args || []).join(" ")})`;
      return `mcp:${mcp.name}`;
    });

    const action = await p.select({
      message: `Tools (${tools.length}):`,
      options: [
        ...toolStrs.map((t: string, i: number) => ({ value: `remove:${i}`, label: `[R]emove: ${t}` })),
        { value: "add_mcp", label: "[A]dd MCP tool" },
        { value: "__done", label: "Done" },
      ],
    });
    if (p.isCancel(action) || action === "__done") break;

    if (action === "add_mcp") {
      const name = await p.text({ message: "MCP tool name:", placeholder: "my-tool" });
      if (p.isCancel(name)) continue;
      const url = await p.text({ message: "MCP server URL:", placeholder: "http://localhost:3000/mcp" });
      if (p.isCancel(url)) continue;
      tools.push({ type: "mcp", name, url });
    } else if (action.startsWith("remove:")) {
      const idx = parseInt(action.slice(7), 10);
      tools.splice(idx, 1);
    }
  }
  return tools;
}

async function editTools(cwd: string, el: { type: string; data: Record<string, unknown>; filePath: string }): Promise<void> {
  const tools = await toolEditor((el.data.tools as unknown[]) || []);
  el.data.tools = tools;
  writeFileSync(el.filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
}

async function editSkills(cwd: string, el: { type: string; data: Record<string, unknown>; filePath: string }): Promise<void> {
  const schema = readRegistry(cwd);
  const availableSkills = schema.skills.map((s: { name: string }) => s.name);
  const current = (el.data.skills as { ref: string }[]) || [];

  while (true) {
    const skillNames = current.map((s) => s.ref);
    const actions = [
      ...skillNames.map((n: string, i: number) => ({ value: `remove:${i}`, label: `[R]emove: ${n}` })),
      ...(availableSkills.length > 0 ? [{ value: "add", label: "[A]dd skill" }] : []),
      { value: "__done", label: "Done" },
    ];

    const action = await p.select({
      message: `Skills (${current.length} linked):`,
      options: actions,
    });
    if (p.isCancel(action) || action === "__done") break;

    if (action === "add") {
      const alreadyLinked = new Set(skillNames);
      const unlinked = availableSkills.filter((n: string) => !alreadyLinked.has(n));
      if (unlinked.length === 0) {
        consola.info("All available skills are already linked.");
        continue;
      }
      const picked = await p.select({
        message: "Add skill:",
        options: unlinked.map((n: string) => ({ value: n, label: n })),
      });
      if (p.isCancel(picked)) continue;
      current.push({ ref: picked as string });
    } else if (action.startsWith("remove:")) {
      const idx = parseInt(action.slice(7), 10);
      current.splice(idx, 1);
    }
  }

  el.data.skills = current;
  writeFileSync(el.filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
}

// --- MCP TUI functions ---

async function tuiMCPList() {
  const cwd = process.cwd();
  const config = readMCPServers(cwd);
  const entries = Object.entries(config.servers);
  if (entries.length === 0) {
    consola.info("No MCP servers registered. Use the MCP menu to add one.");
    return;
  }
  consola.info(`${C.bold}Registered MCP Servers${C.reset}`);
  for (const [name, server] of entries) {
    const desc = server.description ? `  ${C.dim}(${server.description})${C.reset}` : "";
    const conn = "url" in server ? server.url : `${server.command} ${(server.args || []).join(" ")}`;
    consola.log(`  ${C.cyan}\u25cf${C.reset} ${C.bold}${name}${C.reset}  ${C.dim}${conn}${C.reset}${desc}`);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const chunks: Buffer[] = [];
    let lastTime = Date.now();
    const PAUSE_MS = 500;
    const ABSOLUTE_TIMEOUT_MS = 30_000;

    const handler = (chunk: Buffer) => {
      chunks.push(chunk);
      lastTime = Date.now();
    };

    process.stdin.on("data", handler);

    const interval = setInterval(() => {
      if (chunks.length > 0 && Date.now() - lastTime > PAUSE_MS) {
        cleanup();
        resolve(Buffer.concat(chunks).toString());
      }
    }, 100);

    const absoluteTimer = setTimeout(() => {
      cleanup();
      resolve("");
    }, ABSOLUTE_TIMEOUT_MS);

    function cleanup() {
      clearInterval(interval);
      clearTimeout(absoluteTimer);
      process.stdin.removeListener("data", handler);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
    }
  });
}

async function tuiMCPAdd() {
  const cwd = process.cwd();
  const mode = await p.select({
    message: "How do you want to add an MCP server?",
    options: [
      { value: "paste", label: "Paste JSON — paste the whole mcpServers block" },
      { value: "guided", label: "Guided — step-by-step setup" },
    ],
  });
  if (p.isCancel(mode)) return;

  if (mode === "paste") {
    consola.info("Paste MCP server JSON below (any format). The input is captured automatically after a short pause.");
    const raw = await readStdin();
    if (!raw) return;
    try {
      const cleaned = raw.replace(/\r?\n/g, "").replace(/\s+/g, " ").trim();
      const parsed = JSON.parse(cleaned);
      const servers = parsed.mcpServers || parsed.servers || parsed;
      if (typeof servers !== "object" || Object.keys(servers).length === 0) {
        consola.error("No servers found in the pasted JSON. Expected { mcpServers: { name: { ... } } }.");
        return;
      }
      const config = readMCPServers(cwd);
      for (const [name, srv] of Object.entries(servers)) {
        const server = srv as Record<string, unknown>;
        if (typeof server !== "object") continue;
        const { description: _d, ...fields } = server;
        config.servers[name] = fields as unknown as import("../core/mcp.js").MCPServer;
      }
      writeMCPServers(cwd, config);
      consola.success(`Imported ${Object.keys(servers).length} MCP server(s).`);
    } catch {
      consola.error("Invalid JSON. Please paste a valid JSON object.");
    }
    return;
  }

  // Guided setup
  const name = await p.text({ message: "MCP server name:", placeholder: "my-tool", validate: (v) => (v ? undefined : "Required") });
  if (p.isCancel(name)) return;

  const srvType = await p.select({
    message: "Server type:",
    options: [
      { value: "url", label: "URL-based (e.g. http://localhost:3000/mcp)" },
      { value: "command", label: "Command-based (e.g. npx -y package)" },
    ],
  });
  if (p.isCancel(srvType)) return;

  const desc = await p.text({ message: "Description (optional):", placeholder: "My custom tool" });
  if (p.isCancel(desc)) return;

  if (srvType === "url") {
    const url = await p.text({ message: "Server URL:", placeholder: "http://localhost:3000/mcp", validate: (v) => (v ? undefined : "Required") });
    if (p.isCancel(url)) return;
    addMCPServer(cwd, name as string, { url: url as string, description: (desc as string) || undefined });
  } else {
    const command = await p.text({ message: "Command:", placeholder: "npx, node, python, ...", validate: (v) => (v ? undefined : "Required") });
    if (p.isCancel(command)) return;
    const argsStr = await p.text({ message: "Arguments (space-separated):", placeholder: "-y my-mcp-package@latest" });
    if (p.isCancel(argsStr)) return;
    const args = (argsStr as string).split(" ").filter(Boolean);
    addMCPServer(cwd, name as string, { command: command as string, args: args.length > 0 ? args : undefined, description: (desc as string) || undefined });
  }
  consola.success(`MCP server "${name}" registered.`);
}

async function tuiMCPEdit() {
  const cwd = process.cwd();
  const config = readMCPServers(cwd);
  const names = Object.keys(config.servers);
  if (names.length === 0) { consola.info("No MCP servers to edit."); return; }
  const selected = await p.select({
    message: "Edit MCP server:",
    options: names.map((n) => ({ value: n, label: n })),
  });
  if (p.isCancel(selected)) return;

  const existing = config.servers[selected as string];
  const desc = await p.text({ message: "Description:", initialValue: existing.description || "" });
  if (p.isCancel(desc)) return;

  if ("url" in existing) {
    const url = await p.text({ message: "Server URL:", initialValue: existing.url });
    if (p.isCancel(url)) return;
    config.servers[selected as string] = { url: url as string, description: (desc as string) || undefined };
  } else {
    const command = await p.text({ message: "Command:", initialValue: existing.command });
    if (p.isCancel(command)) return;
    const argsStr = await p.text({ message: "Arguments:", initialValue: (existing.args || []).join(" ") });
    if (p.isCancel(argsStr)) return;
    const args = (argsStr as string).split(" ").filter(Boolean);
    config.servers[selected as string] = { command: command as string, args: args.length > 0 ? args : undefined, description: (desc as string) || undefined };
  }
  writeMCPServers(cwd, config);
  consola.success(`MCP server "${selected}" updated.`);
}

async function tuiMCPRemove() {
  const cwd = process.cwd();
  const config = readMCPServers(cwd);
  const names = Object.keys(config.servers);
  if (names.length === 0) { consola.info("No MCP servers to remove."); return; }
  const selected = await p.select({
    message: "Remove MCP server:",
    options: names.map((n) => ({ value: n, label: n })),
  });
  if (p.isCancel(selected)) return;
  removeMCPServer(cwd, selected as string);
  consola.success(`MCP server "${selected}" removed.`);
}

async function tuiMCPLink() {
  const cwd = process.cwd();
  const schema = readRegistry(cwd);
  const agents = schema.agents.map((a: { name: string }) => a.name);
  if (agents.length === 0) { consola.info("No agents found. Create one first."); return; }
  const agentName = await p.select({
    message: "Link MCP servers to which agent?",
    options: agents.map((n: string) => ({ value: n, label: n })),
  });
  if (p.isCancel(agentName)) return;

  const el = readElement(cwd, agentName as string);
  if (!el) { consola.error("Agent not found."); return; }

  const mcpConfig = readMCPServers(cwd);
  const serverNames = Object.keys(mcpConfig.servers);
  if (serverNames.length === 0) { consola.info("No MCP servers registered. Add some first."); return; }

  const currentTools = (el.data.tools as unknown[]) || [];
  const linkedNames = new Set(currentTools
    .filter((t) => typeof t !== "string" && (t as { type: string }).type === "mcp")
    .map((t) => (t as { name: string }).name));

  const picked = await p.multiselect({
    message: `Select MCP servers for "${agentName}":`,
    options: serverNames.map((n) => ({
      value: n,
      label: n,
      hint: linkedNames.has(n) ? "linked" : "",
    })),
    required: false,
  });
  if (p.isCancel(picked)) return;

  const selectedServers = new Set(picked as string[]);
  const newTools = [
    ...currentTools.filter((t) => !(typeof t !== "string" && (t as { type: string }).type === "mcp")),
    ...serverNames.filter((n) => selectedServers.has(n)).map((n) => {
      const srv = mcpConfig.servers[n];
      const { description: _desc, ...fields } = srv;
      return { type: "mcp" as const, name: n, ...fields };
    }),
  ];

  el.data.tools = newTools;
  writeFileSync(el.filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
  consola.success(`MCP servers linked to "${agentName}".`);
}

async function tuiSkillLink() {
  const cwd = process.cwd();
  const schema = readRegistry(cwd);
  const agents = schema.agents.map((a: { name: string }) => a.name);
  if (agents.length === 0) { consola.info("No agents found. Create one first."); return; }
  const agentName = await p.select({
    message: "Link skills to which agent?",
    options: agents.map((n: string) => ({ value: n, label: n })),
  });
  if (p.isCancel(agentName)) return;

  const el = readElement(cwd, agentName as string);
  if (!el) { consola.error("Agent not found."); return; }

  await editSkills(cwd, el);
}

async function tuiRollback() {
  const cwd = process.cwd();
  const { listSnapshots, restoreSnapshot } = await import("../core/snapshot.js");
  const snapshots = listSnapshots(cwd);
  if (snapshots.length === 0) { consola.info("No snapshots available."); return; }
  const selected = await p.select({
    message: "Rollback to which snapshot?",
    options: snapshots.map((s: { name: string; label?: string }) => ({
      value: s.name,
      label: s.label ? `${s.name} (${s.label})` : s.name,
    })),
  });
  if (p.isCancel(selected)) return;
  const ok = restoreSnapshot(cwd, selected as string);
  if (ok) consola.success(`Restored snapshot "${selected}".`);
  else consola.error(`Failed to restore snapshot "${selected}".`);
}

async function tuiRemove() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const cwd = process.cwd();
  const name = await pickElement(cwd);
  if (!name) return;

  const el = readElement(cwd, name);
  if (!el) { consola.error(`Element "${name}" not found.`); return; }

  const refs = findReferences(cwd, name);
  const lock = (await import("../core/lock.js")).readLock(cwd);
  const exportHistory: string[] = [];
  for (const [target, entries] of Object.entries(lock.targets)) {
    if ((entries as Record<string, unknown>)[`${el.type}:${name}`]) {
      exportHistory.push(target);
    }
  }

  const choice = await p.select({
    message: `${C.red}\u26a0 Remove "${name}" ${el.type}?${C.reset}`,
    options: [
      { value: "yes", label: `Remove anyway — delete ${el.filePath}` },
      ...(refs.length > 0 ? [{ value: "refs", label: `Show references (${refs.length} depend${refs.length === 1 ? "s" : ""})` }] : []),
      { value: "no", label: "Cancel" },
    ],
  });
  if (p.isCancel(choice) || choice === "no") return;

  if (choice === "refs") {
    consola.info(`"${name}" is referenced by:`);
    for (const r of refs) consola.log(`  ${colorName(r, "agent")}`);
    const confirm = await p.confirm({ message: `Remove anyway?`, initialValue: false });
    if (p.isCancel(confirm) || !confirm) return;
  }

  const ok = removeElement(cwd, name);
  if (!ok) {
    consola.error(`Element "${name}" not found.`);
    return;
  }
  if (exportHistory.length > 0) {
    consola.info(`Was exported to: ${exportHistory.join(", ")}`);
  }
  consola.success(`Removed "${name}".`);
  syncExposed(process.cwd(), true);
}

async function tuiExport() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }

  const cwd = process.cwd();
  const vars = loadVars(cwd);
  const rawSchema = readRegistry(cwd);
  const schema = resolveSchemaVars(rawSchema, vars);

  const hasItems = schema.agents.length > 0 || schema.skills.length > 0 || schema.prompts.length > 0;
  if (!hasItems) {
    consola.error("No agents, skills, or prompts to export. Add some first.");
    return;
  }

  const targets = await p.multiselect({
    message: "Export to which platforms? (Space to toggle, Enter to confirm)",
    options: [
      { value: "all", label: "All platforms", hint: "opencode, codex, claude-code, cursor, windsurf" },
      { value: "opencode", label: "OpenCode" },
      { value: "codex", label: "Codex" },
      { value: "claude_code", label: "Claude Code" },
      { value: "cursor", label: "Cursor" },
      { value: "windsurf", label: "Windsurf" },
    ],
    required: true,
  });
  if (p.isCancel(targets)) return;

  const exportAll = await p.confirm({
    message: "Export everything in the registry?",
    initialValue: true,
  });
  if (p.isCancel(exportAll)) return;

  let finalSchema: UniversalSchema;

  if (exportAll) {
    finalSchema = schema;
  } else {
    const sel: { agents: string[]; skills: string[]; prompts: string[] } = {
      agents: [],
      skills: [],
      prompts: [],
    };

    if (schema.agents.length > 0) {
      const picked = await p.multiselect({
        message: `Select agents (${schema.agents.length} available) (Space to toggle, Enter to confirm):`,
        options: schema.agents.map((a) => ({
          value: a.name,
          label: a.name,
          hint: a.description,
        })),
      });
      if (p.isCancel(picked)) return;
      sel.agents = picked as string[];

      if (sel.agents.length > 0) {
        const includeSkills = await p.confirm({
          message: `Include each agent's linked skills?`,
          initialValue: true,
        });
        if (p.isCancel(includeSkills)) return;

        const includeTools = await p.confirm({
          message: `Include each agent's tool lists?`,
          initialValue: true,
        });
        if (p.isCancel(includeTools)) return;

        const agentObjs = schema.agents.filter((a) => sel.agents.includes(a.name));
        const linkedSkillRefs = new Set<string>();
        if (includeSkills) {
          for (const a of agentObjs) {
            for (const sr of a.skills) {
              linkedSkillRefs.add(sr.ref);
            }
          }
        }

        finalSchema = {
          agents: agentObjs.map((a) => ({
            ...a,
            skills: includeSkills ? a.skills : [],
            tools: includeTools ? a.tools : [],
          })),
          skills: schema.skills.filter((s) => linkedSkillRefs.has(s.name)),
          prompts: [],
        };

        if (linkedSkillRefs.size > 0) {
          consola.info(`Auto-included ${linkedSkillRefs.size} linked skill(s) with selected agents.`);
        }
      } else {
        finalSchema = { agents: [], skills: [], prompts: [] };
      }
    } else {
      finalSchema = { agents: [], skills: [], prompts: [] };
    }

    if (schema.skills.length > 0) {
      const alreadyIncluded = new Set(finalSchema.skills.map((s: { name: string }) => s.name));
      const remaining = schema.skills.filter((s) => !alreadyIncluded.has(s.name));
      if (remaining.length > 0) {
        const picked = await p.multiselect({
          message: `Select additional skills (${remaining.length} available) (Space to toggle, Enter to confirm):`,
          options: remaining.map((s) => ({
            value: s.name,
            label: s.name,
            hint: s.description,
          })),
        });
        if (p.isCancel(picked)) return;
        const extra = remaining.filter((s) => (picked as string[]).includes(s.name));
        finalSchema.skills = [...(finalSchema.skills || []), ...extra];
      }
    }

    if (schema.prompts.length > 0) {
      const picked = await p.multiselect({
        message: `Select prompts (${schema.prompts.length} available) (Space to toggle, Enter to confirm):`,
        options: schema.prompts.map((p) => ({
          value: p.name,
          label: p.name,
          hint: p.description,
        })),
      });
      if (p.isCancel(picked)) return;
      finalSchema.prompts = schema.prompts.filter((pr) => (picked as string[]).includes(pr.name));
    }
  }

  const totalAgents = finalSchema.agents.length;
  const totalSkills = finalSchema.skills.length;
  const totalPrompts = finalSchema.prompts.length;

  if (totalAgents === 0 && totalSkills === 0 && totalPrompts === 0) {
    consola.warn("Nothing selected to export.");
    return;
  }

  consola.info(`Export summary:  ${colorName(`${totalAgents} agent(s)`, "agent")}  ${colorName(`${totalSkills} skill(s)`, "skill")}  ${colorName(`${totalPrompts} prompt(s)`, "prompt")}`);

  const dryRun = await p.confirm({
    message: "Dry run (preview without writing)?",
    initialValue: false,
  });
  if (p.isCancel(dryRun)) return;

  const cfg = loadConfig(cwd);
  const resolvedTargets = (targets as string[]).includes("all")
    ? resolvePlatforms(cfg, "all")
    : (targets as string[]);

  const lock = readLock(cwd);

  for (const t of resolvedTargets) {
    const adapter = adapters[t];
    if (!adapter) {
      consola.warn(`Unknown platform "${t}" — skipping.`);
      continue;
    }

    const { changed, unchanged } = getChangedElements(finalSchema, t, lock);
    if (changed.agents.length === 0 && changed.skills.length === 0 && changed.prompts.length === 0) {
      consola.info(`${adapter.name}:  ${C.dim}no changes${C.reset}  (${unchanged} skipped)`);
      continue;
    }

    const platformSchema = resolveSchemaForPlatform(changed, t);

    // Resolve MCP server URLs from global registry for tools without inline URL
    const mcpConfig = readMCPServers(cwd);
    for (const agent of platformSchema.agents) {
      agent.tools = agent.tools.map((tool) => {
        if (typeof tool !== "string" && tool.type === "mcp") {
          const registered = mcpConfig.servers[tool.name];
          if (registered) {
            const { description: _d, ...fields } = registered;
            return { ...tool, ...fields };
          }
        }
        return tool;
      });
    }

    const changes: string[] = [];
    const addItem = (name: string, type: string, added: number, removed: number) => {
      const line = added > 0 && removed === 0
        ? `${C.green}+${added} lines${C.reset}  (${colorName(name, type)} new)`
        : added > 0
        ? `${C.green}+${added}${C.reset}  ${C.red}-${removed}${C.reset}  (${colorName(name, type)} updated)`
        : `${C.dim}no changes${C.reset}  (${colorName(name, type)})`;
      changes.push(`  ${line}`);
    };

    const createLines = (s: string): number => s.split("\n").length;

    for (const a of changed.agents) {
      const prevLock = lock.targets[t]?.[`agent:${a.name}`];
      const prevLines = prevLock ? 0 : 0;
      addItem(a.name, "agent", createLines(a.system_prompt || ""), prevLines);
    }
    for (const s of changed.skills) {
      addItem(s.name, "skill", createLines(s.body || ""), 0);
    }
    for (const p of changed.prompts) {
      addItem(p.name, "prompt", createLines(p.body || ""), 0);
    }

    if (dryRun) {
      consola.info(`${adapter.name}  ${C.dim}(dry-run)${C.reset}`);
      for (const c of changes) consola.log(c);
    } else {
      runHook("pre_export", t, cwd);
      adapter.write(platformSchema, cwd);
      runHook("post_export", t, cwd);
      updateLock(lock, t, changed);
      consola.info(`${adapter.name}:`);
      for (const c of changes) consola.log(c);
      if (unchanged > 0) consola.log(`  ${C.dim}${unchanged} unchanged (skipped)${C.reset}`);
    }
  }

  if (!dryRun) {
    writeLock(cwd, lock);
  }
}

function mergeSchema(target: UniversalSchema, source: UniversalSchema): void {
  for (const agent of source.agents) {
    if (!target.agents.some((a) => a.name === agent.name)) {
      target.agents.push(agent);
    }
  }
  for (const skill of source.skills) {
    if (!target.skills.some((s) => s.name === skill.name)) {
      target.skills.push(skill);
    }
  }
  for (const prompt of source.prompts) {
    if (!target.prompts.some((p) => p.name === prompt.name)) {
      target.prompts.push(prompt);
    }
  }
}

async function tuiImport() {
  const detected = Object.entries(adapters).filter(([, a]) => a.detect(process.cwd()));

  if (detected.length === 0) {
    consola.error("No supported platform config files detected in this directory.");
    consola.log("Place one of these in the project root: opencode.json, AGENTS.md, CLAUDE.md, .cursorrules");
    return;
  }

  const choices = detected.map(([key, a]) => ({
    value: key,
    label: a.name,
    hint: "detected",
  }));

  const picked = await p.multiselect({
    message: "Import from which platforms?",
    options: choices,
    required: true,
  });
  if (p.isCancel(picked)) return;

  if (!hasRegistry()) {
    initRegistry(process.cwd(), false);
  }

  const merged = readRegistry(process.cwd());

  for (const key of picked as string[]) {
    const adapter = adapters[key];
    if (!adapter) continue;
    consola.info(`Reading from ${adapter.name}...`);
    try {
      const schema = adapter.read(process.cwd());
      mergeSchema(merged, schema);
      consola.success(`Imported ${schema.agents.length} agent(s), ${schema.skills.length} skill(s) from ${adapter.name}`);
    } catch (err) {
      consola.error(`Failed to import from ${adapter.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  writeRegistry(process.cwd(), merged);

  const total = merged.agents.length + merged.skills.length + merged.prompts.length;
  consola.success(`Registry now has ${merged.agents.length} agent(s), ${merged.skills.length} skill(s), ${merged.prompts.length} prompt(s)`);
}

async function tuiSync() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const action = await p.select({
    message: "Sync action:",
    options: [
      { value: "push", label: "Push local to Supabase" },
      { value: "pull", label: "Pull remote from Supabase" },
      { value: "status", label: "Show sync status" },
    ],
  });
  if (p.isCancel(action)) return;

  switch (action) {
    case "push": {
      const { pushRegistry } = await import("../sync/push.js");
      await pushRegistry(process.cwd());
      break;
    }
    case "pull": {
      const { pullRegistry } = await import("../sync/pull.js");
      await pullRegistry(process.cwd());
      break;
    }
    case "status": {
      const local = readRegistry(process.cwd());
      consola.log("Local registry (no remote comparison yet):");
      consola.log(formatDiff(diffSchemas(local, null)));
      break;
    }
  }
}

async function tuiDiff() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const local = readRegistry(process.cwd());
  const result = diffSchemas(local, null);
  consola.log(formatDiff(result));
}

async function tuiValidate() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const regDir = getRegistryDir(process.cwd());
  const dirs = ["agents", "skills", "prompts"];
  let totalErrors = 0;

  for (const dir of dirs) {
    const dirPath = join(regDir, dir);
    if (!existsSync(dirPath)) continue;

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const filePath = join(dirPath, entry);
      const errors = validateElement(filePath);
      for (const err of errors) {
        consola.error(`${entry}: ${err.message}`);
        totalErrors++;
      }
      if (errors.length === 0) {
        consola.success(`${entry} ok`);
      }
    }
  }

  if (totalErrors === 0) {
    consola.success("All elements valid.");
  } else {
    consola.error(`${totalErrors} error(s) found.`);
  }
}

async function tuiUse() {
  if (!hasRegistry()) {
    consola.error("No registry found. Run `af init` first.");
    return;
  }
  const name = await pickElement(process.cwd(), "agent");
  if (!name) return;

  const global = await p.confirm({
    message: "Set as default across all projects?",
    initialValue: false,
  });
  if (p.isCancel(global)) return;

  const target = global
    ? join(process.env.HOME || "~", ".agentforge", ".active-agent")
    : join(getRegistryDir(process.cwd()), ".active-agent");

  const fs = await import("node:fs");
  fs.writeFileSync(target, (name as string) + "\n", "utf-8");
  consola.success(`Agent "${name}" is now active.`);
}

async function tuiSnapshot() {
  const action = await p.select({
    message: "Snapshot action:",
    options: [
      { value: "save", label: "Create a named snapshot" },
      { value: "list", label: "List snapshots" },
      { value: "restore", label: "Restore a snapshot" },
    ],
  });
  if (p.isCancel(action)) return;

  const cwd = process.cwd();
  const { createSnapshot, listSnapshots, restoreSnapshot } = await import("../core/snapshot.js");

  switch (action) {
    case "save": {
      const name = await p.text({ message: "Snapshot name:" });
      if (p.isCancel(name)) return;
      createSnapshot(cwd, name as string);
      break;
    }
    case "list": {
      const snaps = listSnapshots(cwd);
      if (snaps.length === 0) { consola.warn("No snapshots."); return; }
      for (const s of snaps) consola.log(`  ${s.name}  (${s.stamp})`);
      break;
    }
    case "restore": {
      const snaps = listSnapshots(cwd);
      if (snaps.length === 0) { consola.warn("No snapshots."); return; }
      const picked = await p.select({
        message: "Pick a snapshot:",
        options: snaps.map((s) => ({ value: s.name, label: s.name })),
      });
      if (p.isCancel(picked)) return;
      restoreSnapshot(cwd, picked as string);
      break;
    }
  }
}

async function tuiTest() {
  const cwd = process.cwd();
  if (!hasRegistry()) { consola.error("No registry."); return; }
  const name = await pickElement(cwd, "agent");
  if (!name) return;
  const prompt = await p.text({ message: "User message:", placeholder: "What should I do?" });
  if (p.isCancel(prompt)) return;

  const { default: testCmd } = await import("./commands/test.js");
  (testCmd as any)?.run?.({ args: { name, prompt: prompt as string, provider: "openai", model: undefined, "prompt-file": undefined } });
}

async function tuiAudit() {
  const cwd = process.cwd();
  const auditPath = join(getRegistryDir(cwd), "audit.log");
  if (!existsSync(auditPath)) { consola.info("No audit log yet."); return; }
  const lines = readFileSync(auditPath, "utf-8").trim().split("\n").slice(-30);
  consola.log(`${C.dim}${"\u2500".repeat(50)}${C.reset}`);
  for (const line of lines) {
    consola.log(line);
  }
  consola.log(`${C.dim}${"\u2500".repeat(50)}${C.reset}`);
}

async function tuiBench() {
  const cwd = process.cwd();
  if (!hasRegistry()) { consola.error("No registry."); return; }
  const name = await pickElement(cwd, "agent");
  if (!name) return;

  const { default: benchCmd } = await import("./commands/bench.js");
  (benchCmd as any)?.run?.({ args: { name, provider: "openai", model: undefined } });
}

async function tuiFork() {
  const cwd = process.cwd();
  const name = await pickElement(cwd);
  if (!name) return;
  const newName = await p.text({ message: "New element name:", placeholder: `${name}-copy` });
  if (p.isCancel(newName)) return;
  const el = readElement(cwd, name);
  if (!el) { consola.error(`Element "${name}" not found.`); return; }
  const { addElement } = await import("../core/registry.js");
  const filePath = addElement(cwd, el.type, newName as string);
  if (el.type === "agent") {
    writeFileSync(filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
  } else {
    const frontmatter: Record<string, unknown> = {
      name: el.data.name,
      version: el.data.version,
      description: el.data.description,
      ...(el.type === "prompt" ? { tags: el.data.tags } : {}),
    };
    const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${el.body || ""}\n`;
    writeFileSync(filePath, content, "utf-8");
  }
  consola.success(`Forked "${name}" as "${newName}".`);
  syncExposed(cwd, true);
}

async function tuiWhy() {
  const cwd = process.cwd();
  const { default: whyCmd } = await import("./commands/why.js");
  const name = await pickElement(cwd);
  if (!name) return;
  (whyCmd as any)?.run?.({ args: { name } });
}

async function tuiShare() {
  const cwd = process.cwd();
  const name = await pickElement(cwd);
  if (!name) return;
  const el = readElement(cwd, name);
  if (!el) { consola.error(`Element "${name}" not found.`); return; }
  const { pushSharedElement, detectOwner } = await import("../sync/share.js");
  const owner = detectOwner();
  if (!owner) { consola.error("No owner configured for sharing."); return; }
  try {
    const data = { ...el.data, body: el.body || "" };
    await pushSharedElement(owner, el.type as "agent" | "skill" | "prompt", name, (el.data.version as string) || "1.0.0", data as Record<string, unknown>);
    consola.success(`Shared "${name}".`);
  } catch (err) {
    consola.error(`Share failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function tuiPull() {
  const cwd = process.cwd();
  const { pullRegistry } = await import("../sync/pull.js");
  try {
    await pullRegistry(cwd);
    consola.success("Pull complete.");
    syncExposed(cwd, true);
  } catch (err) {
    consola.error(`Pull failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function tuiAuth() {
  const action = await p.select({
    message: "Auth action:",
    options: [
      { value: "login", label: "Login (OAuth)" },
      { value: "logout", label: "Logout" },
      { value: "status", label: "Check status" },
    ],
  });
  if (p.isCancel(action)) return;

  switch (action) {
    case "login":
      consola.info("Auth login - placeholder");
      break;
    case "logout":
      consola.info("Auth logout - placeholder");
      break;
    case "status":
      consola.info("Auth status - placeholder");
      consola.log("Not authenticated");
      break;
  }
}

async function tuiSearch() {
  const cwd = process.cwd();
  const query = await p.text({
    message: "Search term:",
    placeholder: "search inside system prompts, skill bodies...",
    validate: (v) => (v && v.trim().length === 0 ? "Enter a search term" : undefined),
  });
  if (p.isCancel(query)) return;

  const q = (query as string).toLowerCase();
  const elements = listElements(cwd);
  const results: Array<{ name: string; type: string; match: string }> = [];

  for (const el of elements) {
    const full = readElement(cwd, el.name);
    if (!full) continue;
    const text = full.body || "";
    const dataStr = JSON.stringify(full.data).toLowerCase();
    const bodyLower = text.toLowerCase();
    if (dataStr.includes(q) || bodyLower.includes(q)) {
      const idx = bodyLower.indexOf(q);
      const snippet = idx >= 0
        ? text.slice(Math.max(0, idx - 40), idx + q.length + 40).replace(/\n/g, " ")
        : "(match in metadata)";
      results.push({ name: el.name, type: el.type, match: snippet.length > 80 ? snippet.slice(0, 80) + "..." : snippet });
    }
  }

  if (results.length === 0) {
    consola.info(`No matches for "${query}"`);
    return;
  }

  consola.success(`Found ${results.length} match${results.length === 1 ? "" : "es"} for "${query}":\n`);
  for (const r of results) {
    consola.log(`  ${colorType(r.type).padEnd(12)} ${colorName(r.name, r.type).padEnd(28)} ${C.dim}${r.match}${C.reset}`);
  }
}

async function tuiPreview() {
  const cwd = process.cwd();
  const name = await pickElement(cwd, "agent");
  if (!name) return;

  const el = readElement(cwd, name);
  if (!el) { consola.error(`Element "${name}" not found.`); return; }

  const { loadVars, resolveSchemaVars } = await import("../core/vars.js");
  const { readRegistry } = await import("../core/registry.js");
  const { resolveSchemaForPlatform } = await import("../core/overrides.js");

  const rawSchema = readRegistry(cwd);
  const vars = loadVars(cwd);
  const resolved = resolveSchemaVars(rawSchema, vars);

  const agent = resolved.agents.find((a) => a.name === name);
  if (!agent) { consola.error(`Agent "${name}" not found in resolved schema.`); return; }

  consola.log(`${C.bold}\n  ${agent.name}${C.reset}`);
  consola.log(`  ${C.dim}${agent.description}${C.reset}`);
  consola.log(`  ${C.dim}version ${agent.version}${C.reset}`);
  consola.log(`\n  ${C.bold}System prompt:${C.reset}`);
  consola.log(`  ${agent.system_prompt.split("\n").join("\n  ")}`);

  if (agent.skills.length > 0) {
    consola.log(`\n  ${C.bold}Linked skills:${C.reset}`);
    for (const sr of agent.skills) {
      const skillEl = resolved.skills.find((s) => s.name === sr.ref);
      if (skillEl) {
        consola.log(`    ${C.cyan}${skillEl.name}${C.reset}${C.dim} — ${skillEl.description}${C.reset}`);
        consola.log(`    ${skillEl.body.split("\n").slice(0, 3).join("\n    ")}`);
      } else {
        consola.log(`    ${C.yellow}${sr.ref}${C.reset}${C.dim} (not found)${C.reset}`);
      }
    }
  }

  if (agent.tools.length > 0) {
    consola.log(`\n  ${C.bold}Tools:${C.reset}`);
    for (const t of agent.tools) {
      if (typeof t === "string") {
        consola.log(`    ${C.green}${t}${C.reset}`);
      } else {
        const mcp = t as { name: string; url: string };
        consola.log(`    ${C.green}mcp:${mcp.name}${C.reset} ${C.dim}(${mcp.url})${C.reset}`);
      }
    }
  }

  consola.log(`\n  ${C.bold}Expose:${C.reset} ${(agent.expose || []).join(", ")}`);
  consola.log(`\n  ${C.bold}Platform overrides:${C.reset}`);
  const platform = await p.select({
    message: "Pick a platform to see resolved output:",
    options: [
      ...(agent.expose || []).map((t: string) => ({ value: t, label: t })),
      { value: "__skip", label: "Skip" },
    ],
  });
  if (p.isCancel(platform) || platform === "__skip") return;

  const platformSchema = resolveSchemaForPlatform({ agents: [agent], skills: resolved.skills, prompts: [] }, platform as string);
  const resolvedAgent = platformSchema.agents[0];
  consola.log(`\n  ${C.bold}Resolved for ${platform}:${C.reset}`);
  consola.log(`  ${C.dim}System prompt:${C.reset}`);
  consola.log(`  ${resolvedAgent.system_prompt.split("\n").join("\n  ")}`);
  if (resolvedAgent.tools.length > 0) {
    consola.log(`\n  ${C.dim}Tools:${C.reset}`);
    for (const t of resolvedAgent.tools) {
      consola.log(`    ${typeof t === "string" ? t : "mcp:" + (t as { name: string }).name}`);
    }
  }
}

async function tuiGraph() {
  const cwd = process.cwd();
  const elements = listElements(cwd);
  const agents = elements.filter((e) => e.type === "agent");

  if (agents.length === 0) {
    consola.info("No agents found.");
    return;
  }

  let hasEdges = false;
  for (const agent of agents) {
    const refs = findReferences(cwd, agent.name);
    const el = readElement(cwd, agent.name);
    const skills = (el?.data?.skills as Array<{ ref: string }> | undefined) || [];
    if (skills.length === 0 && refs.length === 0) continue;
    hasEdges = true;

    consola.log(`\n  ${colorName(agent.name, "agent")}`);
    if (skills.length > 0) {
      consola.log(`    ${C.dim}uses skills:${C.reset}`);
      for (const s of skills) {
        consola.log(`      ${C.cyan}${s.ref}${C.reset}`);
      }
    }
    if (refs.length > 0) {
      consola.log(`    ${C.dim}referenced by:${C.reset}`);
      for (const r of refs) {
        consola.log(`      ${colorName(r, "agent")}`);
      }
    }
  }

  if (!hasEdges) {
    consola.info("No agent-to-skill dependencies found.");
  }
}

async function tuiLint() {
  const cwd = process.cwd();
  const configPath = join(cwd, "agentforge.json");
  if (!existsSync(configPath)) {
    consola.info("No agentforge.json found — nothing to lint.");
    return;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const issues: string[] = [];

    if (!config.version) issues.push("Missing 'version' field");
    if (config.platforms && !Array.isArray(config.platforms)) issues.push("'platforms' must be an array");
    if (config.vars && typeof config.vars !== "object") issues.push("'vars' must be an object");
    if (config.hooks && typeof config.hooks !== "object") issues.push("'hooks' must be an object");
    if (config.ignore && !Array.isArray(config.ignore)) issues.push("'ignore' must be an array");

    if (issues.length === 0) {
      consola.success("agentforge.json looks good.");
    } else {
      consola.warn(`Found ${issues.length} issue(s):`);
      for (const issue of issues) consola.log(`  ${C.red}\u2716${C.reset} ${issue}`);
    }
  } catch (err) {
    consola.error(`Failed to parse agentforge.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function tuiBulk() {
  const cwd = process.cwd();
  const elements = listElements(cwd);
  if (elements.length === 0) {
    consola.info("No elements found.");
    return;
  }

  const picked = await p.multiselect({
    message: "Select elements to modify:",
    options: elements.map((e) => ({
      value: `${e.type}:${e.name}`,
      label: `${e.name}`,
      hint: e.type,
    })),
    required: true,
  });
  if (p.isCancel(picked)) return;

  const operation = await p.select({
    message: `Operation on ${(picked as string[]).length} element(s):`,
    options: [
      { value: "rename", label: "Rename prefix" },
      { value: "expose", label: "Set expose platforms" },
      { value: "retag", label: "Re-tag (prompts only)" },
      { value: "version", label: "Set version" },
    ],
  });
  if (p.isCancel(operation)) return;

  if (operation === "rename") {
    const prefix = await p.text({ message: "New name prefix:", placeholder: "my-team-" });
    if (p.isCancel(prefix)) return;
    for (const key of picked as string[]) {
      const [type, name] = key.split(":");
      const el = readElement(cwd, name);
      if (!el) continue;
      const newName = `${prefix}${name}`;
      const filePath = join(getRegistryDir(cwd), `${type}s`, type === "agent" ? `${newName}.yaml` : `${newName}.md`);
      if (!existsSync(el.filePath)) continue;
      writeFileSync(filePath, readFileSync(el.filePath, "utf-8"), "utf-8");
    }
    consola.success(`Renamed ${(picked as string[]).length} element(s) with prefix "${prefix}".`);
  } else if (operation === "expose") {
    const platforms = await p.multiselect({
      message: "Set expose platforms for all selected:",
      options: [
        { value: "claude_code", label: "Claude Code" },
        { value: "codex", label: "Codex" },
        { value: "opencode", label: "OpenCode" },
        { value: "cursor", label: "Cursor" },
        { value: "windsurf", label: "Windsurf" },
      ],
      required: true,
    });
    if (p.isCancel(platforms)) return;
    for (const key of picked as string[]) {
      const [type, name] = key.split(":");
      if (type !== "agent") continue;
      const el = readElement(cwd, name);
      if (!el) continue;
      el.data.expose = platforms;
      writeFileSync(el.filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
    }
    consola.success(`Updated expose for ${(picked as string[]).filter((k) => k.startsWith("agent:")).length} agent(s).`);
  } else if (operation === "retag") {
    const tags = await p.text({ message: "New tags (comma-separated):", placeholder: "code-review, typescript" });
    if (p.isCancel(tags)) return;
    const tagList = (tags as string).split(",").map((t: string) => t.trim()).filter(Boolean);
    for (const key of picked as string[]) {
      const [type, name] = key.split(":");
      if (type !== "prompt") continue;
      const el = readElement(cwd, name);
      if (!el) continue;
      el.data.tags = tagList;
      const frontmatter = { name: el.data.name, version: el.data.version, description: el.data.description, tags: tagList };
      const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${el.body || ""}\n`;
      writeFileSync(el.filePath, content, "utf-8");
    }
    consola.success(`Retagged ${(picked as string[]).filter((k) => k.startsWith("prompt:")).length} prompt(s).`);
  } else if (operation === "version") {
    const ver = await p.text({
      message: "New version:",
      initialValue: "1.0.0",
      validate: (v) => (v && /^\d+\.\d+\.\d+$/.test(v) ? undefined : "Must be semver"),
    });
    if (p.isCancel(ver)) return;
    for (const key of picked as string[]) {
      const [type, name] = key.split(":");
      const el = readElement(cwd, name);
      if (!el) continue;
      el.data.version = ver;
      const filePath = el.filePath;
      if (type === "agent") {
        writeFileSync(filePath, yaml.dump(el.data, { indent: 2, lineWidth: 120 }), "utf-8");
      } else {
        const body = el.body || "";
        const { body: _, ...frontmatter } = { ...el.data, body: undefined };
        const content = `---\n${yaml.dump(frontmatter, { indent: 2, lineWidth: 120 }).trim()}\n---\n\n${body}\n`;
        writeFileSync(filePath, content, "utf-8");
      }
    }
    consola.success(`Updated version for ${(picked as string[]).length} element(s).`);
  }

  syncExposed(cwd, true);
}

async function handleAction(action: string): Promise<void> {
  if (action.startsWith("show:")) {
    const name = action.slice(5);
    const el = readElement(process.cwd(), name);
    if (!el) { consola.error(`Element "${name}" not found.`); return; }
    consola.log(`Type: ${colorType(el.type)}`);
    consola.log(yaml.dump(el.data, { indent: 2, lineWidth: 120 }));
    if (el.body) { consola.log("--- Body ---"); consola.log(el.body); }
    return;
  }
  switch (action) {
    case "info": await tuiInfo(); break;
    case "config": await tuiConfig(); break;
    case "add": await tuiAdd(); break;
    case "add_skill": await tuiAddSkill(); break;
    case "add_prompt": await tuiAddPrompt(); break;
    case "list": await tuiList(); break;
    case "show": await tuiShow(); break;
    case "edit": await tuiEdit(); break;
    case "remove": await tuiRemove(); break;
    case "fork": await tuiFork(); break;
    case "why": await tuiWhy(); break;
    case "test": await tuiTest(); break;
    case "bench": await tuiBench(); break;
    case "export": await tuiExport(); break;
    case "import": await tuiImport(); break;
    case "sync": await tuiSync(); break;
    case "diff": await tuiDiff(); break;
    case "validate": await tuiValidate(); break;
    case "use": await tuiUse(); break;
    case "auth": await tuiAuth(); break;
    case "share": await tuiShare(); break;
    case "pull": await tuiPull(); break;
    case "snapshot": await tuiSnapshot(); break;
    case "audit": await tuiAudit(); break;
    case "rollback": await tuiRollback(); break;
    case "search": await tuiSearch(); break;
    case "preview": await tuiPreview(); break;
    case "graph": await tuiGraph(); break;
    case "lint": await tuiLint(); break;
    case "bulk": await tuiBulk(); break;
    case "mcp_list": await tuiMCPList(); break;
    case "mcp_add": await tuiMCPAdd(); break;
    case "mcp_edit": await tuiMCPEdit(); break;
    case "mcp_remove": await tuiMCPRemove(); break;
    case "mcp_link": await tuiMCPLink(); break;
    case "skill_link": await tuiSkillLink(); break;
    case "prompt_link": await tuiPromptLink(); break;
    case "variables": await tuiVariables(); break;
    case "models_list": await tuiModelsList(); break;
    case "models_detect": await tuiModelsDetect(); break;
    case "models_add": await tuiModelsAdd(); break;
    case "models_edit": await tuiModelsEdit(); break;
    case "models_remove": await tuiModelsRemove(); break;
    case "models_test": await tuiModelsTest(); break;
    case "models_storage": await tuiModelsStorage(); break;
    default: consola.warn(`Unknown action: ${action}`);
  }
}

export async function runTui() {
  const cwd = process.cwd();

  // Splash
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const logoPath = join(__dirname, "..", "..", "static", "logo.png");
  const termProg = process.env.TERM_PROGRAM || "";
  const supportsImg = termProg === "iTerm.app" || termProg === "kitty" || termProg === "WezTerm";
  try {
    if (supportsImg) {
      const data = readFileSync(logoPath);
      const b64 = data.toString("base64");
      process.stdout.write(`\x1b]1337;File=inline=1;width=50%:${b64}\x07`);
    }
    process.stdout.write(`${C.cyan}\u25a1${C.reset} ${C.bold}AgentForge${C.reset}${C.dim}  v0.1.0${C.reset}`);
  } catch {}
  process.stdout.write(`\n${C.dim}Press any key to enter TUI...${C.reset}`);
  const stdin = process.stdin;
  const origMode = stdin.isTTY ? stdin.isRaw : false;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  await new Promise<void>((resolve) => {
    const handler = (buf: Buffer) => {
      stdin.removeListener("data", handler);
      if (stdin.isTTY) stdin.setRawMode(origMode || false);
      stdin.pause();
      resolve();
    };
    stdin.on("data", handler);
  });

  // Auto-init registry on first use
  const isNew = !existsSync(getRegistryDir(cwd));
  if (isNew) {
    initRegistry(cwd);
  }

  // Onboarding wizard for first-time users
  if (isNew) {
    consola.log(`${C.bold}Welcome to AgentForge!${C.reset}`);
    consola.log(`This tool helps you create and manage AI agents, skills, and prompts.`);
    consola.log(`\nQuick start:`);
    consola.log(`  ${C.cyan}[E]${C.reset} Create and manage agents`);
    consola.log(`  ${C.cyan}[S]${C.reset} Create and manage skills`);
    consola.log(`  ${C.cyan}[R]${C.reset} Create and manage prompts with variables`);
    consola.log(`  ${C.cyan}[M]${C.reset} Register MCP servers and link to agents`);
    consola.log(`  ${C.cyan}[L]${C.reset} Export to platforms (Claude Code, OpenCode, Cursor, etc.)`);
    consola.log(`  ${C.cyan}[?]${C.reset} Help\n`);
    const { confirm } = await import("@clack/prompts");
    const createStarter = await confirm({
      message: "Create a starter agent to get going?",
      initialValue: true,
    });
    if (!p.isCancel(createStarter) && createStarter) {
      const agentName = await p.text({
        message: "Name your first agent:",
        placeholder: "MyAgent",
        validate: (v) => (v && v.trim().length === 0 ? "Name cannot be empty" : undefined),
      });
      if (p.isCancel(agentName)) return;
      const name = (agentName as string).trim() || "MyAgent";
      const filePath = addElement(cwd, "agent", name);
      consola.success(`Created agent "${name}" at ${filePath}`);
      consola.log(` Edit it with Elements > Edit, or add skills with Elements > Add.`);
    }
  }

  // Auto-sync watcher for external file edits
  const regDir = getRegistryDir(cwd);
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  watch(regDir, { recursive: true }, () => {
    if (isSyncing()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (!isSyncing()) syncExposed(cwd, true);
    }, 500);
  });

  let lastView: "dashboard" | "category" | "browse" | undefined;
  let catIdx = 0;

  while (true) {
    process.stdout.write("\x1b[2J\x1b[H");
    const result = await runTwoColumnTui(cwd, lastView, lastView === "category" ? catIdx : 0);
    if (result.action === null) break;
    lastView = result.view;
    catIdx = result.catIdx;

    await handleAction(result.action);

    const { text } = await import("@clack/prompts");
    const cont = await text({
      message: "Press ENTER to return to menu, or type 'q' to quit",
      placeholder: "",
    });
    if (cont === "q" || cont === "quit") break;
  }

  process.stdout.write("\x1b[2J\x1b[H");
  consola.info("Goodbye!");
}
