import { readRegistry, getRegistryDir, listElements, readElement, getElementPreview, listElementNames, listElementsWithExpose, readRecentActivity, platformBadgeShort } from "../core/registry.js";
import { readModels } from "../core/models.js";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { colors as C, colorCount, colorName, colorType } from "../utils/colors.js";

interface MenuItem {
  value: string;
  label: string;
  shortcut: string;
  help: string;
  group?: string;
}

interface Category {
  label: string;
  shortcut: string;
  description: string;
  items: MenuItem[];
}

interface SyncState {
  local: { agents: number; skills: number; prompts: number; mcp: number; models: number };
  remote: string;
  user: string;
  version: string;
}

interface BrowserState {
  typeFilter: string | null;
  elementIdx: number;
}

interface Popup {
  type: "help" | "search";
  text: string;
  results?: string[];
  query?: string;
  selected?: number;
}

type View = "dashboard" | "category" | "browse";

const CATEGORIES: Record<string, Category> = {
  agents: {
    label: "Agents", shortcut: "e",
    description: "Create, edit, and manage AI agents with system prompts, linked skills, MCP tools, and per-platform overrides.",
    items: [
      { value: "list", label: "List", shortcut: "l", help: "List all agents in the local registry." },
      { value: "add", label: "Add", shortcut: "a", help: "Create a new agent (YAML) from a template." },
      { value: "fork", label: "Fork", shortcut: "f", help: "Copy an agent with a new name." },
      { value: "show", label: "Show", shortcut: "s", help: "Display the full YAML content of an agent." },
      { value: "edit", label: "Edit", shortcut: "e", help: "Modify an agent's fields: description, version, system_prompt, tools, skills, and expose platforms." },
      { value: "remove", label: "Remove", shortcut: "r", help: "Delete an agent from the local registry." },
      { value: "bulk", label: "Bulk: Rename / Retag / Expose", shortcut: "u", help: "Modify multiple elements at once." },
    ],
  },
  mcp: {
    label: "MCP", shortcut: "m",
    description: "Register global MCP servers and link them to agents. MCP servers provide external tools and APIs.",
    items: [
      { value: "mcp_list", label: "List servers", shortcut: "l", help: "Show all registered MCP servers with their URLs and descriptions." },
      { value: "mcp_add", label: "Add server", shortcut: "a", help: "Register a new MCP server (name + URL) in the global MCP registry." },
      { value: "mcp_edit", label: "Edit server", shortcut: "e", help: "Change an existing MCP server's URL or description." },
      { value: "mcp_remove", label: "Remove server", shortcut: "r", help: "Delete an MCP server from the global registry." },
      { value: "mcp_link", label: "Link to Agent", shortcut: "k", help: "Select an agent and choose which MCP servers to attach." },
    ],
  },
  skills: {
    label: "Skills", shortcut: "s",
    description: "Create reusable skill definitions and link them to agents. Skills are markdown files with reusable instructions.",
    items: [
      { value: "list", label: "List skills", shortcut: "l", help: "Show all skills in the registry." },
      { value: "add_skill", label: "Add skill", shortcut: "a", help: "Create a new skill (markdown file with frontmatter)." },
      { value: "edit", label: "Edit skill", shortcut: "e", help: "Modify a skill's body content or metadata." },
      { value: "remove", label: "Remove skill", shortcut: "r", help: "Delete a skill from the registry." },
      { value: "skill_link", label: "Link to Agent", shortcut: "k", help: "Select an agent and choose which skills to attach." },
    ],
  },
  prompts: {
    label: "Prompts", shortcut: "p",
    description: "Create prompt templates with {variable} placeholders, link them to agents, and manage shared variables.",
    items: [
      { value: "list", label: "List prompts", shortcut: "l", help: "Show all prompts in the registry." },
      { value: "add_prompt", label: "Add prompt", shortcut: "a", help: "Create a new prompt (markdown file with frontmatter)." },
      { value: "edit", label: "Edit prompt", shortcut: "e", help: "Modify a prompt's body content or metadata." },
      { value: "remove", label: "Remove prompt", shortcut: "r", help: "Delete a prompt from the registry." },
      { value: "prompt_link", label: "Link to Agent", shortcut: "k", help: "Select an agent and choose which prompts to attach." },
      { value: "variables", label: "Variables", shortcut: "v", help: "Manage variables (key=value) used in prompt templates." },
    ],
  },
  platform: {
    label: "Platform", shortcut: "l",
    description: "Export agents, skills, and prompts to supported coding platforms, or import existing configurations.",
    items: [
      { value: "export", label: "Export", shortcut: "e", help: "Resolve variables and overrides, then write platform-native configs." },
      { value: "import", label: "Import", shortcut: "i", help: "Detect and read platform configs from the current directory, merge into the local registry." },
    ],
  },
  models: {
    label: "Models", shortcut: "o",
    description: "Register local model providers, auto-detect Ollama/LM Studio, test models, and manage centralized storage.",
    items: [
      { value: "models_list", label: "List / Refresh", shortcut: "l", help: "Ping all providers, fetch model lists, scan storage." },
      { value: "models_detect", label: "Auto-detect", shortcut: "d", help: "Probe localhost for Ollama and LM Studio instances and add them." },
      { value: "models_add", label: "Add provider", shortcut: "a", help: "Add a model provider (Ollama, LM Studio, HuggingFace, or OpenAI-compatible)." },
      { value: "models_edit", label: "Edit provider", shortcut: "e", help: "Change a provider's name, URL, or API key." },
      { value: "models_remove", label: "Remove provider", shortcut: "r", help: "Remove a provider from the registry (keeps model files)." },
      { value: "models_test", label: "Test model", shortcut: "t", help: "Pick a provider and model, enter a prompt, stream the response." },
      { value: "models_storage", label: "Storage config", shortcut: "c", help: "Show centralized model paths and regenerate .agentforge/models.env." },
    ],
  },
  inspect: {
    label: "Inspect", shortcut: "i",
    description: "Analyze and debug agents: preview resolved output, run tests, search content, and visualize dependencies.",
    items: [
      { value: "validate", label: "Validate", shortcut: "v", help: "Run Zod schema validation plus configurable lint rules on all elements." },
      { value: "preview", label: "Preview", shortcut: "p", help: "Show resolved agent with variables, skills, and overrides applied." },
      { value: "why", label: "Why", shortcut: "w", help: "LLM-generated explanation of an element." },
      { value: "test", label: "Test", shortcut: "t", help: "Run an agent's system prompt + a fixture or inline prompt against a real model." },
      { value: "bench", label: "Bench", shortcut: "b", help: "Run all fixtures in .agentforge/fixtures/<agent>/ through a model." },
      { value: "search", label: "Search bodies", shortcut: "f", help: "Search inside system prompts, skill bodies, and prompt bodies." },
      { value: "graph", label: "Dependency graph", shortcut: "g", help: "Show which agents link to which skills." },
      { value: "lint", label: "Config lint", shortcut: "l", help: "Validate agentforge.json fields and catch misconfigurations." },
    ],
  },
  history: {
    label: "History", shortcut: "h",
    description: "Snapshot, restore, diff registry states, and browse the audit log.",
    items: [
      { value: "snapshot", label: "Snapshot", shortcut: "s", help: "Create, list, and manage named snapshots of the registry." },
      { value: "diff", label: "Diff", shortcut: "d", help: "Show a line-by-line diff between two snapshots or current vs a snapshot." },
      { value: "rollback", label: "Rollback", shortcut: "r", help: "Restore registry to a previous snapshot." },
      { value: "audit", label: "Audit log", shortcut: "a", help: "Browse the audit log." },
    ],
  },
  account: {
    label: "Account", shortcut: "u",
    description: "Authenticate, sync your registry to the cloud, and share or pull elements with other users.",
    items: [
      { value: "auth", label: "Authentication", shortcut: "u", help: "Login, logout, or check auth status with Supabase." },
      { value: "sync", label: "Sync", shortcut: "s", help: "Push local registry to Supabase or pull remote registry into local." },
      { value: "share", label: "Share", shortcut: "h", help: "Push elements to remote for other users." },
      { value: "pull", label: "Pull", shortcut: "p", help: "Fetch shared elements from remote." },
    ],
  },
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);
const CATEGORY_ORDER = ["dashboard", ...CATEGORY_KEYS];

const BG_BLUE = "\x1b[44m";
const BG_GRAY = "\x1b[100m";
const REVERSE = "\x1b[7m";

function pos(row: number, col: number): string { return `\x1b[${row};${col}H`; }

function termWidth(): number { return process.stdout.columns || 80; }
function termHeight(): number { return process.stdout.rows || 24; }

function readPackageVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function getSyncState(cwd: string): SyncState {
  const hasReg = existsSync(getRegistryDir(cwd));
  const elements = hasReg ? listElements(cwd) : [];
  let mcpCount = 0;
  try {
    const mcpPath = join(getRegistryDir(cwd), "mcp.json");
    if (existsSync(mcpPath)) {
      const raw = JSON.parse(readFileSync(mcpPath, "utf-8"));
      mcpCount = Object.keys(raw.servers || {}).length;
    }
  } catch {}
  const modelCount = readModels(cwd).providers.length;
  return {
    local: {
      agents: elements.filter((e) => e.type === "agent").length,
      skills: elements.filter((e) => e.type === "skill").length,
      prompts: elements.filter((e) => e.type === "prompt").length,
      mcp: mcpCount,
      models: modelCount,
    },
    remote: process.env.AF_SUPABASE_URL ? "connected" : "offline",
    user: process.env.USER || process.env.USERNAME || "local",
    version: readPackageVersion(),
  };
}

export interface TuiResult {
  action: string | null;
  view: View;
  catIdx: number;
}

export async function runTwoColumnTui(cwd: string, initialView?: View, initialCatIdx = 0): Promise<TuiResult> {
  const tw = Math.max(termWidth(), 40);
  const th = Math.max(termHeight(), 12);
  const width = Math.min(tw, 110);
  const height = Math.min(th, 34);
  const sidebarW = 20;
  const mainW = width - sidebarW - 2;
  const headerH = 1;
  const bodyH = height - headerH - 2;
  const statusRow = height;

  let view: View = initialView || "dashboard";
  let catIdx = initialCatIdx;
  let actIdx = 0;
  let popup: Popup | null = null;
  let searchBuf = "";

  let browseState: BrowserState = { typeFilter: null, elementIdx: 0 };
  let browseElementsList: { name: string; type: string; description: string }[] = [];
  let browsePreviewLines: string[] = [];

  const typeFilters = [
    { label: "All", value: null } as { label: string; value: string | null },
    { label: "Agents", value: "agent" },
    { label: "Skills", value: "skill" },
    { label: "Prompts", value: "prompt" },
  ];
  let typeFilterIdx = 0;

  const categoryShortcuts: Record<string, number> = { e: 0, m: 1, s: 2, p: 3, l: 4, o: 5, i: 6, h: 7, u: 8 };

  let activity: { time: string; text: string }[] = [];
  let agentsWithExpose: { name: string; expose: string[]; skills: string[] }[] = [];
  let skillNames: { name: string; type: string; description: string }[] = [];
  let promptNames: { name: string; type: string; description: string }[] = [];

  function loadDashboardData(): void {
    activity = readRecentActivity(cwd, 3);
    agentsWithExpose = listElementsWithExpose(cwd);
    skillNames = listElementNames(cwd, "skill");
    promptNames = listElementNames(cwd, "prompt");
  }

  function loadBrowseElements(): void {
    const tf = typeFilters[typeFilterIdx].value;
    browseElementsList = listElementNames(cwd, tf || undefined);
    if (browseState.elementIdx >= browseElementsList.length) browseState.elementIdx = 0;
    updateBrowsePreview();
  }

  function updateBrowsePreview(): void {
    if (browseElementsList.length === 0) { browsePreviewLines = ["(no elements)"]; return; }
    const el = browseElementsList[browseState.elementIdx];
    const preview = getElementPreview(cwd, el.name);
    browsePreviewLines = preview ? preview.split("\n") : ["(empty)"];
  }

  loadDashboardData();

  function hl(text: string): string {
    return `${REVERSE}${text}${C.reset}`;
  }

  const draw = () => {
    const sync = getSyncState(cwd);

    // Blank entire screen
    const realH = Math.max(termHeight(), 12);
    const realW = Math.max(termWidth(), 40);
    for (let r = 1; r <= realH; r++) {
      process.stdout.write(`${pos(r, 1)}${" ".repeat(realW)}`);
    }
    process.stdout.write(pos(1, 1));

    // --- Header ---
    const headerText = `${C.bold}${C.cyan}\u25a1${C.reset} ${C.bold}AgentForge${C.reset} ${C.dim}v${sync.version}${C.reset}  ${sync.remote === "connected" ? C.green + "sync" + C.reset : C.dim + "offline" + C.reset}`;
    process.stdout.write(`${pos(1, 1)}${BG_BLUE}${" ".repeat(width - 1)}${C.reset}`);
    process.stdout.write(`${pos(1, 1)}${headerText.padEnd(width - 1)}`);

    // --- Sidebar labels ---
    const sidebarLabels = [
      { key: "D", label: "Dashboard" },
      { key: "E", label: "Agents" },
      { key: "M", label: "MCP" },
      { key: "S", label: "Skills" },
      { key: "P", label: "Prompts" },
      { key: "L", label: "Platform" },
      { key: "O", label: "Models" },
      { key: "I", label: "Inspect" },
      { key: "H", label: "History" },
      { key: "U", label: "Account" },
    ];

    for (let i = 0; i < sidebarLabels.length; i++) {
      const row = 2 + i;
      const it = sidebarLabels[i];
      const isActive = i === 0
        ? view === "dashboard" || view === "browse"
        : view === "category" && i - 1 === catIdx;

      const label = ` ${it.key} ${it.label}`;
      const padded = label.padEnd(sidebarW - 1);
      if (isActive) {
        process.stdout.write(`${pos(row, 1)}${hl(padded)}`);
      } else {
        process.stdout.write(`${pos(row, 1)}${C.dim}${padded}${C.reset}`);
      }
    }

    // Sidebar footer
    process.stdout.write(`${pos(height - 1, 1)}${C.dim}${"\u2500".repeat(sidebarW)}${C.reset}`);

    // --- Main area ---
    const mainCol = sidebarW + 2;

    // Vertical separator
    for (let r = 2; r <= height; r++) {
      process.stdout.write(`${pos(r, sidebarW + 1)}${C.dim}\u2502${C.reset}`);
    }

    if (view === "dashboard") {
      drawDashboard(sync, mainCol);
    } else if (view === "category") {
      drawCategoryView(mainCol);
    } else if (view === "browse") {
      drawBrowseView(mainCol);
    }

    // --- Status bar ---
    const catLabel = view === "dashboard" ? "Dashboard" : view === "category" ? CATEGORIES[CATEGORY_KEYS[catIdx]]?.label || "" : "Browse";
    const statusText = `  ${C.dim}${catLabel}${C.reset}  ${C.dim}\u2502${C.reset}  ${sync.local.agents}a ${sync.local.skills}s ${sync.local.prompts}p ${sync.local.mcp}m ${sync.local.models}mod  ${C.dim}\u2502${C.reset}  ${sync.remote === "connected" ? C.green + "sync" + C.reset : C.dim + "off" + C.reset}  ${C.dim}\u2502${C.reset}  ${sync.user}`;
    process.stdout.write(`${pos(statusRow, 1)}${BG_GRAY}${" ".repeat(width - 1)}${C.reset}`);
    process.stdout.write(`${pos(statusRow, 1)}${statusText.padEnd(width - 1)}`);
  };

  function drawDashboard(sync: SyncState, col: number): void {
    // Breadcrumb
    process.stdout.write(`${pos(2, col)}${C.dim}agentforge \u203a dashboard${C.reset}`);

    // Stat cards — simple colored blocks, no borders
    const cardW = Math.floor((mainW - 6) / 5);
    const cardRow = 3;
    const cards = [
      { title: "Agents", value: String(sync.local.agents), color: C.blue },
      { title: "Skills", value: String(sync.local.skills), color: C.green },
      { title: "Prompts", value: String(sync.local.prompts), color: C.yellow },
      { title: "MCP", value: String(sync.local.mcp), color: C.magenta },
      { title: "Models", value: String(sync.local.models), color: C.cyan },
    ];

    for (let ci = 0; ci < cards.length; ci++) {
      const card = cards[ci];
      const cx = col + ci * (cardW + 1);
      const padded = card.title.padEnd(cardW - 2);
      process.stdout.write(`${pos(cardRow, cx)} ${C.dim}${padded}${C.reset}`);
      process.stdout.write(`${pos(cardRow + 1, cx)} ${C.bold}${card.color}${card.value.padEnd(cardW - 2)}${C.reset}`);
    }

    // Two columns: agents list | activity
    const listCol = col;
    const activityCol = col + Math.floor(mainW / 2) + 1;
    const listW = Math.floor(mainW / 2) - 1;
    const actW = mainW - listW - 2;
    const listTop = cardRow + 3;
    const maxRow = height - 4;

    // --- Left column: Agents, Skills, Prompts ---
    let lr = listTop;

    // Agent section
    process.stdout.write(`${pos(lr, listCol)}${C.bold}${C.blue}Agents${C.reset}`);
    lr++;
    process.stdout.write(`${pos(lr, listCol)}${C.dim}${"\u2500".repeat(listW)}${C.reset}`);
    lr++;

    if (agentsWithExpose.length === 0) {
      process.stdout.write(`${pos(lr, listCol)} ${C.dim}(none)${C.reset}`);
      lr++;
    } else {
      for (const ag of agentsWithExpose) {
        if (lr >= maxRow) break;
        const badges = ag.expose.map((p) => platformBadgeShort(p)).join(" ");
        process.stdout.write(`${pos(lr, listCol)} ${C.blue}\u25b6${C.reset} ${C.bold}${ag.name}${C.reset}  ${C.dim}${badges}${C.reset}`.padEnd(listW + col + listW));
        lr++;
        for (const sk of ag.skills) {
          if (lr >= maxRow) break;
          process.stdout.write(`${pos(lr, listCol + 2)} ${C.green}\u25b6${C.reset} ${colorName(sk, "skill")}`.padEnd(listW));
          lr++;
        }
      }
    }

    // Skills section
    if (lr < maxRow - 1) {
      lr++;
      process.stdout.write(`${pos(lr, listCol)}${C.bold}${C.green}Skills${C.reset}`);
      lr++;
      process.stdout.write(`${pos(lr, listCol)}${C.dim}${"\u2500".repeat(listW)}${C.reset}`);
      lr++;
      if (skillNames.length === 0) {
        process.stdout.write(`${pos(lr, listCol)} ${C.dim}(none)${C.reset}`);
      } else {
        for (const sk of skillNames) {
          if (lr >= maxRow) break;
          process.stdout.write(`${pos(lr, listCol)} ${C.dim}\u25cb${C.reset} ${colorName(sk.name, "skill")}`.padEnd(listW));
          lr++;
        }
      }
    }

    // Prompts section
    if (lr < maxRow - 1) {
      lr++;
      process.stdout.write(`${pos(lr, listCol)}${C.bold}${C.yellow}Prompts${C.reset}`);
      lr++;
      process.stdout.write(`${pos(lr, listCol)}${C.dim}${"\u2500".repeat(listW)}${C.reset}`);
      lr++;
      if (promptNames.length === 0) {
        process.stdout.write(`${pos(lr, listCol)} ${C.dim}(none)${C.reset}`);
      } else {
        for (const pr of promptNames) {
          if (lr >= maxRow) break;
          process.stdout.write(`${pos(lr, listCol)} ${C.dim}\u25cb${C.reset} ${colorName(pr.name, "prompt")}`.padEnd(listW));
          lr++;
        }
      }
    }

    // --- Right column: Activity + Quick actions ---
    let ar = listTop;
    process.stdout.write(`${pos(ar, activityCol)}${C.bold}${C.magenta}Recent activity${C.reset}`);
    ar++;
    process.stdout.write(`${pos(ar, activityCol)}${C.dim}${"\u2500".repeat(actW)}${C.reset}`);
    ar++;

    if (activity.length === 0) {
      process.stdout.write(`${pos(ar, activityCol)} ${C.dim}(no activity yet)${C.reset}`);
      ar++;
    } else {
      for (const a of activity) {
        if (ar >= maxRow) break;
        process.stdout.write(`${pos(ar, activityCol)} ${C.dim}${a.time.padEnd(8)}${C.reset} ${a.text}`.padEnd(actW));
        ar++;
      }
    }

    // Quick actions
    if (ar < maxRow - 1) {
      ar++;
      process.stdout.write(`${pos(ar, activityCol)}${C.bold}Quick${C.reset}`);
      ar++;
      process.stdout.write(`${pos(ar, activityCol)}${C.dim}${"\u2500".repeat(actW)}${C.reset}`);
      ar++;
    }

    const quickActions = [
      { key: "A", label: "Add new agent" },
      { key: "V", label: "Validate all" },
    ];

    for (const qa of quickActions) {
      if (ar >= height - 2) break;
      process.stdout.write(`${pos(ar, activityCol)} ${C.cyan}${qa.key}${C.reset}  ${qa.label}`.padEnd(actW));
      ar++;
    }
  }

  function drawCategoryView(col: number): void {
    const currentCat = CATEGORIES[CATEGORY_KEYS[catIdx]];
    process.stdout.write(`${pos(2, col)}${C.dim}agentforge \u203a ${currentCat.label}${C.reset}  ${C.reset}${C.dim}\u2014 ${currentCat.description}${C.reset}`);

    const listTop = 4;
    const maxItems = bodyH - 6;

    let displayRow = 0;
    for (let i = 0; i < currentCat.items.length && displayRow < maxItems; i++) {
      const it = currentCat.items[i];
      const r = listTop + 1 + displayRow;
      const isSel = i === actIdx;
      const prefix = isSel ? `${C.cyan}\u25b6${C.reset}` : " ";
      const short = it.shortcut ? ` ${C.dim}[${it.shortcut.toUpperCase()}]${C.reset}` : "";

      if (it.group && (i === 0 || currentCat.items[i - 1]?.group !== it.group)) {
        if (displayRow >= maxItems) break;
        const hdr = `${C.dim}\u2500 ${it.group}${C.reset}`;
        process.stdout.write(`${pos(r, col)} ${hdr.padEnd(mainW - 2)}`);
        displayRow++;
        if (displayRow >= maxItems) break;
        const r2 = listTop + 1 + displayRow;
        const line = `${prefix}${short}  ${it.label}`;
        if (isSel) {
          process.stdout.write(`${pos(r2, col)}${hl(` ${line.padEnd(mainW - 4)} `)}`);
        } else {
          process.stdout.write(`${pos(r2, col)} ${line.padEnd(mainW - 2)}`);
        }
      } else {
        const line = `${prefix}${short}  ${it.label}`;
        if (isSel) {
          process.stdout.write(`${pos(r, col)}${hl(` ${line.padEnd(mainW - 4)} `)}`);
        } else {
          process.stdout.write(`${pos(r, col)} ${line.padEnd(mainW - 2)}`);
        }
      }
      displayRow++;
    }
  }

  function drawBrowseView(col: number): void {
    process.stdout.write(`${pos(2, col)}${C.dim}agentforge \u203a Browse elements${C.reset}`);

    const listW = Math.min(24, mainW - 2);
    const previewW = mainW - listW - 3;
    const listTop = 4;

    // Type filter
    process.stdout.write(`${pos(listTop, col)}${C.bold}Filter${C.reset}`);
    for (let i = 0; i < typeFilters.length; i++) {
      const r = listTop + 1 + i;
      const tf = typeFilters[i];
      const isSel = i === typeFilterIdx;
      const line = ` ${isSel ? C.cyan + "\u25b6" + C.reset : " "} ${tf.label}`;
      if (isSel) {
        process.stdout.write(`${pos(r, col)}${hl(` ${line.padEnd(listW - 4)} `)}`);
      } else {
        process.stdout.write(`${pos(r, col)} ${C.dim}${line.padEnd(listW - 2)}${C.reset}`);
      }
    }

    // Element names with scrolling
    const elTop = listTop + typeFilters.length + 2;
    process.stdout.write(`${pos(elTop, col)}${C.bold}Elements${C.reset}`);
    const maxEl = bodyH - elTop + 1 - listTop;
    const scrollOffset = Math.max(0, Math.min(browseState.elementIdx - Math.floor(maxEl / 2), browseElementsList.length - maxEl));
    const visibleEls = browseElementsList.slice(scrollOffset, scrollOffset + maxEl);
    for (let i = 0; i < visibleEls.length; i++) {
      const r = elTop + 1 + i;
      const el = visibleEls[i];
      const absIdx = scrollOffset + i;
      const isSel = absIdx === browseState.elementIdx;
      const line = ` ${isSel ? C.cyan + "\u25b6" + C.reset : " "} ${colorName(el.name, el.type)}`;
      if (isSel) {
        process.stdout.write(`${pos(r, col)}${hl(` ${line.padEnd(listW - 4)} `)}`);
      } else {
        process.stdout.write(`${pos(r, col)} ${C.dim}${line.padEnd(listW - 3)}${C.reset}`);
      }
    }
    if (browseElementsList.length > maxEl) {
      const scrollInfo = `${C.dim}${scrollOffset + 1}-${Math.min(scrollOffset + maxEl, browseElementsList.length)} of ${browseElementsList.length}${C.reset}`;
      process.stdout.write(`${pos(elTop + 1 + maxEl, col)} ${scrollInfo}`);
    }

    // Preview pane
    const previewCol = col + listW + 2;
    const previewTop = 4;
    process.stdout.write(`${pos(previewTop, previewCol)}${C.bold}Preview${C.reset}  ${C.dim}(first 5 lines)${C.reset}`);
    const maxLines = bodyH - 2;
    for (let i = 0; i < Math.min(browsePreviewLines.length, maxLines); i++) {
      const r = previewTop + 1 + i;
      const line = browsePreviewLines[i];
      const truncated = line.length > previewW - 3 ? line.slice(0, previewW - 6) + "..." : line;
      process.stdout.write(`${pos(r, previewCol)}  ${C.dim}${truncated.padEnd(previewW - 3)}${C.reset}`);
    }
  }

  // --- Popup overlays ---
  if (popup && (popup as Popup).type === "help") {
    const p = popup as Popup;
    const lines = p.text.split("\n");
    const boxW = Math.min(60, width - 8);
    const boxX = Math.floor((width - boxW) / 2);
    const boxY = Math.floor((height - lines.length - 6) / 2);
    process.stdout.write(`${pos(boxY, boxX)}${C.cyan}${"\u250c" + "\u2500".repeat(boxW - 2) + "\u2510"}${C.reset}`);
    for (let i = 0; i < lines.length; i++) {
      const padded = lines[i].padEnd(boxW - 4);
      process.stdout.write(`${pos(boxY + 1 + i, boxX)} ${C.cyan}\u2502${C.reset} ${padded} ${C.cyan}\u2502${C.reset}`);
    }
    process.stdout.write(`${pos(boxY + lines.length + 1, boxX)} ${C.cyan}\u2502${C.reset}${" ".repeat(boxW - 2)}${C.cyan}\u2502${C.reset}`);
    process.stdout.write(`${pos(boxY + lines.length + 2, boxX)}${C.cyan}${"\u2514" + "\u2500".repeat(boxW - 2) + "\u2518"}${C.reset}`);
    process.stdout.write(`${pos(boxY + lines.length + 3, boxX)} ${C.dim}Press any key to close${C.reset}`);
  }

  if (popup && (popup as Popup).type === "search") {
    const p = popup as Popup;
    const boxW = Math.min(50, width - 8);
    const boxX = Math.floor((width - boxW) / 2);
    const boxY = Math.floor(height / 3);
    process.stdout.write(`${pos(boxY, boxX)}${C.cyan}${"\u250c" + "\u2500".repeat(boxW - 2) + "\u2510"}${C.reset}`);
    process.stdout.write(`${pos(boxY + 1, boxX)} ${C.cyan}\u2502${C.reset} ${C.bold}Search${C.reset}${" ".repeat(boxW - 10)}${C.cyan}\u2502${C.reset}`);
    process.stdout.write(`${pos(boxY + 2, boxX)} ${C.cyan}\u2502${C.reset} ${(p.query || "") + "\u2588"}${" ".repeat(Math.max(0, boxW - 7 - (p.query || "").length))}${C.cyan}\u2502${C.reset}`);
    process.stdout.write(`${pos(boxY + 3, boxX)}${C.cyan}${"\u251c" + "\u2500".repeat(boxW - 2) + "\u2524"}${C.reset}`);
    const results = p.results || [];
    const maxShow = Math.min(results.length, 5);
    for (let i = 0; i < maxShow; i++) {
      const isSel = i === (p.selected || 0);
      const label = results[i].length > boxW - 8 ? results[i].slice(0, boxW - 11) + "..." : results[i];
      if (isSel) {
        process.stdout.write(`${pos(boxY + 4 + i, boxX)} ${C.cyan}\u2502${C.reset}${hl(` ${label.padEnd(boxW - 6)} `)}${C.cyan}\u2502${C.reset}`);
      } else {
        process.stdout.write(`${pos(boxY + 4 + i, boxX)} ${C.cyan}\u2502${C.reset} ${label.padEnd(boxW - 6)} ${C.cyan}\u2502${C.reset}`);
      }
    }
    for (let i = maxShow; i < 5; i++) {
      process.stdout.write(`${pos(boxY + 4 + i, boxX)} ${C.cyan}\u2502${C.reset}${" ".repeat(boxW - 2)}${C.cyan}\u2502${C.reset}`);
    }
    process.stdout.write(`${pos(boxY + 9, boxX)} ${C.cyan}${"\u2514" + "\u2500".repeat(boxW - 2) + "\u2518"}${C.reset}`);
    process.stdout.write(`${pos(boxY + 10, boxX)} ${C.dim}Type, arrows, Enter, Esc${C.reset}`);
  }

  draw();

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const origMode = stdin.isTTY ? stdin.isRaw : false;

    const onKey = (buf: Buffer) => {
      try {
        const key = buf.toString();
        const first = key.charCodeAt(0);

      // --- Search popup ---
      if (popup?.type === "search") {
        if (key === "\r" || key === "\n") {
          const all = allActions();
          const q = searchBuf.toLowerCase();
          const filtered = all.filter((a) => a.label.toLowerCase().includes(q) || a.value.toLowerCase().includes(q));
          const sel = filtered[(popup as Popup).selected || 0];
          if (sel) commitAction(sel.value);
          return;
        }
        if (key === "\u001b") { popup = null; searchBuf = ""; draw(); return; }
        if (key === "\u001b[A") { popup = { ...popup, selected: Math.max(0, ((popup as Popup).selected || 0) - 1) } as Popup; draw(); return; }
        if (key === "\u001b[B") {
          const all = allActions();
          const q = searchBuf.toLowerCase();
          const count = all.filter((a) => a.label.toLowerCase().includes(q) || a.value.toLowerCase().includes(q)).length;
          popup = { ...popup, selected: Math.min(count - 1, ((popup as Popup).selected || 0) + 1) } as Popup; draw(); return;
        }
        if (key === "\u007f") { searchBuf = searchBuf.slice(0, -1); runSearch(searchBuf); return; }
        if (first >= 32 && first <= 126) { searchBuf += key; runSearch(searchBuf); return; }
        return;
      }

      // --- Help popup ---
      if (popup?.type === "help") {
        if (key === "?" || key === "\u001b" || key === "\r" || key === "\n") { popup = null; draw(); return; }
        return;
      }

      // --- Browse mode ---
      if (view === "browse") {
        if (key === "q" || key === "\u001b") { view = "dashboard"; loadDashboardData(); draw(); return; }
        if (key === "\u001b[A") { browseState.elementIdx = Math.max(0, browseState.elementIdx - 1); updateBrowsePreview(); draw(); return; }
        if (key === "\u001b[B") { browseState.elementIdx = Math.min(browseElementsList.length - 1, browseState.elementIdx + 1); updateBrowsePreview(); draw(); return; }
        if (key === "\u001b[D") { typeFilterIdx = Math.max(0, typeFilterIdx - 1); loadBrowseElements(); draw(); return; }
        if (key === "\u001b[C") { typeFilterIdx = Math.min(typeFilters.length - 1, typeFilterIdx + 1); loadBrowseElements(); draw(); return; }
        if (key === "\r" || key === "\n") {
          const sel = browseElementsList[browseState.elementIdx];
          if (sel) commitAction(`show:${sel.name}`);
          return;
        }
        return;
      }

      // --- Global keys ---
      if ((key === "A" || key === "a") && view === "dashboard") {
        commitAction("add"); return;
      }
      if (key === "v" || key === "V") {
        if (view === "dashboard") { commitAction("validate"); return; }
      }
      if (key === "c" || key === "C") {
        commitAction("config");
        return;
      }
      if (key === "R") {
        view = "dashboard";
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
        loadDashboardData();
        draw();
        return;
      }

      const lower = key.toLowerCase();
      if (lower === "d") {
        view = "dashboard";
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
        loadDashboardData();
        draw();
        return;
      }
      if (lower in categoryShortcuts) {
        view = "category";
        catIdx = categoryShortcuts[lower];
        actIdx = 0;
        popup = null;
        draw();
        return;
      }

      if (key === "q" || key === "\u001b") {
        cleanup();
        resolve({ action: null, view, catIdx } as any);
        return;
      }

      if (key === "/") { openSearch(); return; }

      if (key === "?") {
        if (view === "category") {
          const cat = CATEGORIES[CATEGORY_KEYS[catIdx]];
          const item = cat?.items?.[actIdx];
          if (item?.help) { popup = { type: "help", text: item.help }; draw(); }
        } else {
          popup = { type: "help", text: "Dashboard shows your local registry stats.\n[D] Dashboard  [E] Agents  [M] MCP  [S] Skills\n[P] Prompts  [L] Platform  [O] Models  [I] Inspect\n[H] History  [U] Account\n[C] Config  [R] Refresh  [/] Search  [?] Help" };
          draw();
        }
        return;
      }

      if (key === "\u001b[D") { catIdx = Math.max(0, catIdx - 1); actIdx = 0; popup = null; draw(); return; }
      if (key === "\u001b[C") { catIdx = Math.min(CATEGORY_KEYS.length - 1, catIdx + 1); actIdx = 0; popup = null; draw(); return; }
      if (key === "\u001b[A") { actIdx = Math.max(0, actIdx - 1); popup = null; draw(); return; }
      if (key === "\u001b[B") {
        const currentCat = CATEGORIES[CATEGORY_KEYS[catIdx]];
        actIdx = Math.min(currentCat.items.length - 1, actIdx + 1);
        popup = null;
        draw();
        return;
      }

      if (key === "\r" || key === "\n") {
        if (view === "category") {
          const currentCat = CATEGORIES[CATEGORY_KEYS[catIdx]];
          const action = currentCat.items[actIdx]?.value;
          if (action) commitAction(action);
        }
        return;
      }

      if (first >= 49 && first <= 57) {
        const num = first - 49;
        if (view === "category") {
          const currentCat = CATEGORIES[CATEGORY_KEYS[catIdx]];
          if (num < currentCat.items.length) { actIdx = num; popup = null; draw(); }
        }
        return;
      }

      if (view === "category") {
        const currentCat = CATEGORIES[CATEGORY_KEYS[catIdx]];
        for (let i = 0; i < currentCat.items.length; i++) {
          if (currentCat.items[i].shortcut === lower) {
            actIdx = i;
            popup = null;
            draw();
            return;
          }
        }
      }
      } catch (e) {
        // ignore key handling errors
      }
    };

    const cleanup = () => {
      clearInterval(healthTimer);
      if (escTimer) clearTimeout(escTimer);
      stdin.removeListener("data", onData);
      stdin.setRawMode(origMode || false);
      stdin.pause();
    };

    const commitAction = (action: string) => {
      cleanup();
      resolve({ action, view, catIdx });
    };

    const openSearch = () => {
      const all = allActions();
      popup = { type: "search", text: "", query: "", results: all.map((a) => a.label), selected: 0 };
      searchBuf = "";
      draw();
    };

    const runSearch = (query: string) => {
      const q = query.toLowerCase();
      const all = allActions();
      const filtered = all.filter((a) => a.label.toLowerCase().includes(q) || a.value.toLowerCase().includes(q));
      popup = { type: "search", text: "", query, results: filtered.map((a) => a.label), selected: 0 };
      draw();
    };

    function allActions(): { value: string; label: string; category: string; help: string }[] {
      const result: { value: string; label: string; category: string; help: string }[] = [];
      for (const [, cv] of Object.entries(CATEGORIES)) {
        for (const item of cv.items) {
          result.push({ value: item.value, label: `${cv.label} > ${item.label}`, category: cv.label, help: item.help });
        }
      }
      return result;
    }

    // Custom lightweight escape sequence handler
    let escBuf = "";
    let escTimer: ReturnType<typeof setTimeout> | null = null;

    const onData = (buf: Buffer) => {
      const s = buf.toString();
      const len = buf.length;

      if (escTimer !== null) {
        // Accumulating escape sequence
        escBuf += s;
        const last = s.charCodeAt(s.length - 1);
        if (last >= 0x40 && last <= 0x7E) {
          clearTimeout(escTimer);
          onKey(Buffer.from(escBuf));
          escBuf = "";
          escTimer = null;
        }
        return;
      }

      if (s === "\u001b" && len === 1) {
        escBuf = s;
        escTimer = setTimeout(() => {
          onKey(Buffer.from(escBuf));
          escBuf = "";
          escTimer = null;
        }, 50);
        return;
      }

      onKey(buf);
    };

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.on("data", onData);
    if (stdin.isTTY) {
      stdin.resume();
    }

    // Safety: re-check stdin health every 2s
    const healthTimer = setInterval(() => {
      if (stdin.readableFlowing !== true && stdin.isTTY) {
        try { stdin.resume(); } catch {}
      }
    }, 2000);
  });
}
