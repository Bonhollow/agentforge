---
name: AgentForge
version: 1.0.0
description: Complete reference for how to use AgentForge itself — CLI commands, TUI navigation, registry structure, and workflows
---

# AgentForge Reference

AgentForge is a universal CLI and TUI for managing, syncing, and exporting AI agents, prompts, and skills across coding platforms (Claude Code, Cursor, Windsurf, OpenCode, Codex).

## Directory Structure

All data lives under `.agentforge/` in the project root:

```
.agentforge/
  agents/            # Agent YAML files (*.yaml)
  skills/            # Skill Markdown files (*.md) with frontmatter
  prompts/           # Prompt Markdown files (*.md) with frontmatter
  mcp.json           # Global MCP server registry
  models.json        # Model provider registry
  config.yaml        # Project config (platforms, vars, hooks, lint)
  agentforge.lock    # Export state (content hashes per platform)
  audit.log          # All operations with timestamps
  models.env         # Generated model storage environment variables
  models/            # Downloaded model files
    ollama/
    lm-studio/
    hf/
  .snapshots/        # Registry snapshots for rollback
  fixtures/          # Test fixtures per agent
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `af` | Launch the interactive TUI |
| `af init` | Scaffold .agentforge/ directory |
| `af add <type> <name>` | Create agent, skill, or prompt |
| `af list [type]` | List all elements |
| `af show <name>` | Inspect an element |
| `af edit <name>` | Edit an element |
| `af remove <name>` | Delete an element |
| `af fork <name>` | Duplicate an element |
| `af export [target]` | Export to platform (claude_code, codex, opencode, cursor, windsurf, or all) |
| `af import` | Import from platform configs |
| `af validate` | Validate and lint all schemas |
| `af test <name>` | Run an agent against a model |
| `af bench <name>` | Benchmark an agent against fixtures |
| `af preview <name>` | Preview resolved agent output |
| `af search <query>` | Full-text search across elements |
| `af graph` | Show dependency graph |
| `af lint` | Validate config |
| `af use <name>` | Set active agent |
| `af snapshot <sub>` | Save/list/restore/diff snapshots |
| `af rollback` | Restore a snapshot |
| `af diff` | Show local vs remote diff |
| `af sync <sub>` | Push/pull/status with Supabase |
| `af auth <sub>` | Login/logout/status |
| `af share <name>` | Publish an element |
| `af pull <from>` | Fetch shared elements |
| `af version` | Show version |
| `af upgrade` | Check for updates |
| `af bulk <op>` | Bulk rename/retag/expose/version |
| `af lsp` | Start LSP server |

## TUI Keyboard Navigation

| Key | Category |
|-----|----------|
| `E` | Agents — create, edit, list, fork, remove, bulk |
| `M` | MCP — register servers, link to agents |
| `S` | Skills — create, edit, link |
| `P` | Prompts — create, edit, link, variables |
| `L` | Platform — export, import |
| `O` | Models — register providers, detect, test |
| `I` | Inspect — validate, preview, test, bench, search, graph, lint |
| `H` | History — snapshot, diff, rollback, audit |
| `U` | Account — auth, sync, share, pull |
| `/` | Search |
| `?` | Help |
| `C` | Config |
| `R` | Refresh |
| Arrows | Navigate items |
| Enter | Execute selected action |
| `q` / Esc | Quit |

## Element Schemas

### Agent (YAML)

```yaml
name: my-agent
description: What this agent does
version: 1.0.0
system_prompt: |
  You are an AI agent that...
skills:
  - ref: skill-name
tools:
  - type: mcp
    name: server-name
expose:
  - claude_code
extends: parent-agent   # optional inheritance
overrides:              # per-platform overrides
  cursor:
    system_prompt: |
      Overridden prompt for Cursor
```

### Skill (Markdown with frontmatter)

```markdown
---
name: skill-name
version: 1.0.0
description: What this skill teaches
---

Skill body content in Markdown...
```

### Prompt (Markdown with frontmatter)

```markdown
---
name: prompt-name
version: 1.0.0
description: What this prompt does
tags: [code-review, typescript]
---

Template with {{variable}} placeholders...
```

## MCP Servers

Registered globally in `.agentforge/mcp.json`:

```json
{
  "servers": {
    "server-name": {
      "url": "http://localhost:3000/mcp",
      "description": "REST-based MCP server"
    },
    "local-tool": {
      "command": "npx",
      "args": ["-y", "some-mcp-package"],
      "description": "Command-based MCP server"
    }
  }
}
```

Each agent references MCP servers under `tools` with `type: mcp` and the server `name`.

## Platform Export

When exporting (`af export`), AgentForge:
1. Resolves variables in all elements
2. Applies per-platform overrides
3. Filters ignored elements (`.agentforgeignore`)
4. Checks token budgets against platform limits
5. Resolves MCP server URLs from the global registry
6. Writes platform-native config files
7. Updates `.agentforge.lock` with content hashes
8. Records model version drift
9. Runs pre/post export hooks
10. Audits the operation

Supported platforms and their config files:

| Platform | Config File | Skill/Rules Dir |
|----------|-------------|-----------------|
| Claude Code | CLAUDE.md | .claude/commands/*.md |
| Cursor | .cursorrules | .cursor/rules/*.md |
| Windsurf | .windsurfrules | .windsurf/rules/*.md |
| OpenCode | opencode.json | .opencode/agents/*.md |
| Codex | AGENTS.md | (none) |

## Model Providers

Registered in `.agentforge/models.json`:

```json
{
  "providers": [
    {
      "name": "Ollama",
      "type": "ollama",
      "baseUrl": "http://localhost:11434",
      "status": "online",
      "models": [{ "name": "llama3.2" }]
    },
    {
      "name": "LM Studio",
      "type": "lmstudio",
      "baseUrl": "http://localhost:1234",
      "status": "unknown"
    },
    {
      "name": "OpenAI",
      "type": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "status": "online",
      "models": [{ "name": "gpt-4o" }]
    }
  ]
}
```

Auto-detect probes `localhost:11434` (Ollama) and `localhost:1234` (LM Studio).

## Common Workflows

**Create a new agent:**
```
af add agent my-agent --template senior-dev
```

**Add a skill and link it:**
```
af add skill my-skill
# Write the skill body
af edit my-agent
# Under "skills", add "ref: my-skill"
```

**Register an MCP server:**
```
# In TUI: M > Add server > URL or command
# Or edit .agentforge/mcp.json directly
```

**Export to Claude Code:**
```
af export claude_code
```

**Test an agent:**
```
af test my-agent --model gpt-4o
```

**Snapshot before changes:**
```
af snapshot save before-changes
# ... make changes ...
af snapshot diff before-changes
af rollback before-changes  # if needed
```
