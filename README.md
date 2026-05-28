<p align="center">
  <img src="https://raw.githubusercontent.com/Bonhollow/agentforge/main/static/logo.jpg" alt="AgentForge" width="640">
</p>

# AgentForge

> Manage, sync, and export AI agents, prompts, and skills across every coding platform.

AgentForge is an **all-in-one CLI and TUI** for building, organizing, and deploying AI agents. Whether you use Claude Code, Cursor, Windsurf, OpenCode, or Codex — define your agents once in a universal format and export to any platform.

```bash
af          # Launch the interactive TUI
af <cmd>    # Use CLI subcommands directly
```

---

## Features

### Universal Agent Registry

Define agents, skills, and prompts in a single `.agentforge/` directory using a universal schema. Each element is a file on disk — YAML for agents, Markdown with frontmatter for skills and prompts.

- **Agents** — system prompt, linked skills, MCP tools, per-platform overrides, `extends` inheritance
- **Skills** — reusable Markdown instructions linkable to any agent
- **Prompts** — template-based prompts with `{{variable}}` placeholders
- **Variables** — project-level key-value substitution across all elements
- **Platform overrides** — per-platform system prompt, skills, and tool overrides
- **Active agent** — set a project-level or global default agent

### Interactive TUI

Press `af` with no arguments to launch the full-screen terminal UI with keyboard navigation:

| Key | Category |
|-----|----------|
| `E` | Agents — create, edit, list, fork, remove, bulk operations |
| `M` | MCP — register servers, attach tools to agents |
| `S` | Skills — create, edit, link to agents |
| `P` | Prompts — create, edit, link, manage variables |
| `L` | Platform — export to any coding platform |
| `O` | Models — register providers, auto-detect, test with streaming |
| `I` | Inspect — validate, preview, test, bench, search, graph, lint |
| `H` | History — snapshots, diff, rollback, audit log |
| `U` | Account — auth, sync, share, pull |
| `/` | Search all elements by keyword |
| `?` | Contextual help for each action |

### CLI Commands

All TUI actions are also available as CLI subcommands:

```
  af init       Scaffold .agentforge/ directory
  af add        Create a new agent, skill, or prompt
  af list       List all elements
  af show       Inspect an element
  af edit       Edit an element
  af remove     Remove an element
  af fork       Duplicate an element
  af export     Export to platform-native formats
  af import     Import from platform configs
  af validate   Validate and lint all schemas
  af test       Run an agent against a model
  af bench      Benchmark an agent against fixtures
  af preview    Preview resolved agent output
  af search     Full-text search across all elements
  af graph      Show agent-to-skill dependency graph
  af lint       Validate agentforge.json config
  af use        Set the active agent
  af snapshot   Create, list, restore snapshots
  af rollback   Restore a previous snapshot
  af diff       Diff local vs remote registry
  af audit      Browse the audit log
  af sync       Push/pull registry to Supabase
  af auth       Login, logout, status
  af share      Publish an element to the registry
  af pull       Fetch shared elements
  af version    Show version
  af upgrade    Check for updates
  af bulk       Bulk rename, retag, expose, version
  af lsp        Start Language Server Protocol server
```

### Multi-Platform Export

Export agents, skills, and MCP tools to any supported platform with a single command:

| Platform | Config Files | Format |
|----------|-------------|--------|
| **Claude Code** | `CLAUDE.md`, `.claude/commands/*.md`, `.mcp.json` | System prompt + skill commands |
| **Cursor** | `.cursorrules`, `.cursor/rules/*.md`, `.cursor/mcp.json` | Rules files |
| **Windsurf** | `.windsurfrules`, `.windsurf/rules/*.md`, `.windsurf/mcp_config.json` | Rules + MCP config |
| **OpenCode** | `opencode.json`, `.opencode/agents/*.md` | Agent configs + skill subagents |
| **Codex** | `AGENTS.md`, `.codex/mcp.json`, `.codex/config.toml` | Agent document + TOML MCP |

Each export run:
- Applies variable substitution and platform overrides
- Filters elements via `.agentforgeignore`
- Checks token budgets against platform limits
- Runs pre/post export hooks
- Creates a diff-able snapshot before writing
- Tracks changed elements via content hashing
- Audits every operation

### MCP Server Registry

Register Model Context Protocol servers globally and link them to agents as tools:

- URL-based servers (REST endpoints)
- Command-based servers (local processes)
- Auto-resolve server URLs during export for each platform
- Link/unlink servers to any agent

### Model Provider Registry

Register and manage local and cloud model providers:

- **Ollama** — auto-detect on `localhost:11434`
- **LM Studio** — auto-detect on `localhost:1234`
- **HuggingFace** — API-based with `HF_HOME` storage
- **OpenAI-compatible** — any provider with a `/v1/chat/completions` endpoint
- **Centralized storage** — models downloaded to `.agentforge/models/` with env file generation
- **Streaming test** — interactive streaming response from any registered model
- **Storage scan** — view downloaded model file sizes

### Validation & Linting

- Zod-based schema validation for all elements
- Auto-fix common issues (missing name, version, description)
- Configurable lint rules: max token estimates, banned phrases, required sections
- Token budget estimation with platform-specific warnings

### Snapshots & Rollback

- Named snapshots of the entire registry
- One-click rollback to any previous state
- Side-by-side diff between snapshots
- Full audit log of all operations

### Cloud Sync (Supabase)

- Push/pull registry to Supabase
- Share individual elements with other users
- Pull shared elements from community members

---

## Quick Start

### Install via Homebrew

```bash
brew tap Bonhollow/agentforge https://github.com/Bonhollow/agentforge
brew install agentforge
```

### Install via npm

```bash
npm install -g agentforge
```

### Get started

```bash
af init       # Initialize a new project
af            # Launch the TUI
af list       # Or use CLI directly
af add agent my-agent --template senior-dev
af export claude_code
```

## Configuration

The `.agentforge/` directory structure:

```
.agentforge/
  agents/            # Agent YAML files
  skills/            # Skill Markdown files
  prompts/           # Prompt Markdown files
  mcp.json           # Global MCP server registry
  models.json        # Model provider registry
  config.yaml        # Project configuration
  agentforge.lock    # Export state tracking
  audit.log          # Operation audit trail
  models.env         # Generated model storage env vars
  models/            # Centralized model storage
    ollama/
    lm-studio/
    hf/
  .snapshots/        # Registry snapshots
  fixtures/          # Test fixtures per agent
```

## Requirements

- Node.js >= 20
- npm or yarn

## License

MIT
