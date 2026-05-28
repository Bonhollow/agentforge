import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { addElement, initRegistry, getRegistryDir } from "../../core/registry.js";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { auditLog } from "../../core/audit.js";
import { syncExposed } from "../../core/sync.js";

const TEMPLATES: Record<string, Record<string, unknown>> = {
  "senior-dev": {
    description: "Senior software engineer reviewing code and architecture",
    system_prompt: "You are a senior software engineer with 15+ years of experience.\n\nGuidelines:\n- Review code for correctness, performance, and maintainability\n- Suggest specific improvements with examples\n- Consider edge cases and error handling\n- Follow the project's existing conventions",
    skills: [],
    prompts: [],
    tools: ["Read", "Edit", "Search", "Run"],
    expose: ["claude_code", "opencode", "cursor"],
  },
  "docs-writer": {
    description: "Technical documentation specialist",
    system_prompt: "You are a technical writer specializing in clear, comprehensive documentation.\n\nGuidelines:\n- Write in active voice with concrete examples\n- Include setup steps, API references, and troubleshooting sections\n- Use markdown formatting consistently\n- Adapt tone to audience (beginner vs expert)",
    skills: [],
    prompts: [],
    tools: ["Read", "Edit", "Search"],
    expose: ["claude_code", "opencode", "cursor"],
  },
  "debugger": {
    description: "Debugging and troubleshooting specialist",
    system_prompt: "You are a debugging specialist. Analyze errors step by step.\n\nGuidelines:\n- Reproduce the issue mentally before suggesting fixes\n- Check logs, stack traces, and error messages first\n- Suggest the simplest fix that addresses the root cause\n- Add logging/test suggestions to prevent regression",
    skills: [],
    prompts: [],
    tools: ["Read", "Edit", "Run", "Search"],
    expose: ["claude_code", "opencode", "cursor"],
  },
  "code-reviewer": {
    description: "Pull request reviewer focusing on code quality",
    system_prompt: "You are a thorough code reviewer.\n\nGuidelines:\n- Check for security vulnerabilities, performance issues, and code smells\n- Verify test coverage and edge cases\n- Ensure code follows the project style guide\n- Provide constructive, actionable feedback",
    skills: [],
    prompts: [],
    tools: ["Read", "Search"],
    expose: ["claude_code", "opencode", "cursor"],
  },
};

export default defineCommand({
  meta: {
    name: "add",
    description: "Create a new element from template",
  },
  args: {
    type: {
      type: "positional",
      description: "Element type: agent, skill, or prompt",
      required: true,
    },
    name: {
      type: "positional",
      description: "Element name",
      required: true,
    },
    template: {
      type: "string",
      description: "Template: senior-dev, docs-writer, debugger, code-reviewer",
      alias: "t",
      default: "",
    },
  },
  async run({ args }) {
    const type = args.type as string;
    const name = args.name as string;
    const template = args.template as string;

    if (!["agent", "skill", "prompt"].includes(type)) {
      consola.error("Type must be one of: agent, skill, prompt");
      return;
    }

    if (template && type !== "agent") {
      consola.warn("Templates are only available for agents. Creating a blank skill/prompt.");
    }

    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      initRegistry(cwd);
    }

    const filePath = addElement(cwd, type, name);

    // Apply template if specified (only for agents)
    if (template && type === "agent") {
      const tmpl = TEMPLATES[template];
      if (!tmpl) {
        const available = Object.keys(TEMPLATES).join(", ");
        consola.warn(`Unknown template "${template}". Available: ${available}. Created with defaults.`);
      } else {
        const data = { name, version: "1.0.0", ...tmpl };
        writeFileSync(filePath, yaml.dump(data, { indent: 2, lineWidth: 120 }), "utf-8");
        consola.success(`Applied template "${template}" to ${name}`);
      }
    }

    auditLog(cwd, "add", name, type);
    consola.success(`Created ${type} "${name}" at ${filePath}`);
    syncExposed(cwd);
  },
});
