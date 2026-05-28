import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { consola } from "../../utils/logger.js";
import { initRegistry, addElement } from "../../core/registry.js";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export default defineCommand({
  meta: {
    name: "init",
    description: "Scaffold .agentforge/ in current project",
  },
  args: {
    global: {
      type: "boolean",
      description: "Init global registry at ~/.agentforge/",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const path = initRegistry(cwd, args.global);
    consola.success(`Scaffolded ${path}`);

    const hasClaude = existsSync(join(cwd, "CLAUDE.md"));

    p.intro("Onboarding");

    const addAgent = await p.confirm({
      message: "Add your first agent now?",
      initialValue: false,
    });
    if (p.isCancel(addAgent)) return;
    if (addAgent) {
      const name = await p.text({
        message: "Agent name:",
        placeholder: "my-agent",
        validate: (v) => (v ? undefined : "Name is required"),
      });
      if (p.isCancel(name)) return;
      addElement(cwd, "agent", name);
      consola.success(`Agent "${name}" created`);

      const addSkill = await p.confirm({
        message: `Add a skill for "${name}"?`,
        initialValue: false,
      });
      if (p.isCancel(addSkill)) return;
      if (addSkill) {
        const skillName = await p.text({
          message: "Skill name:",
          placeholder: "code-review",
          validate: (v) => (v ? undefined : "Name is required"),
        });
        if (p.isCancel(skillName)) return;
        addElement(cwd, "skill", skillName);
        consola.success(`Skill "${skillName}" created`);
      }

      const addPrompt = await p.confirm({
        message: `Add a prompt template?`,
        initialValue: false,
      });
      if (p.isCancel(addPrompt)) return;
      if (addPrompt) {
        const promptName = await p.text({
          message: "Prompt name:",
          placeholder: "summarize-changes",
          validate: (v) => (v ? undefined : "Name is required"),
        });
        if (p.isCancel(promptName)) return;
        addElement(cwd, "prompt", promptName);
        consola.success(`Prompt "${promptName}" created`);
      }
    }

    if (hasClaude) {
      const exportOnSave = await p.confirm({
        message: "Detected CLAUDE.md. Export to Claude Code on save?",
        initialValue: true,
      });
      if (p.isCancel(exportOnSave)) return;
      if (exportOnSave) {
        const configPath = join(cwd, ".agentforge", "config.yaml");
        const cfg = {
          version: "1",
          platforms: ["claude_code"],
          hooks: { post_export: { claude_code: "echo 'CLAUDE.md updated'" } },
        };
        writeFileSync(configPath, yaml.dump(cfg, { indent: 2, lineWidth: 120 }), "utf-8");
        consola.success(`Configured auto-export to Claude Code in ${configPath}`);
        consola.info("Run `af export --target claude_code --watch` to start watching");
      }
    }

    p.outro("Ready. Run `af` to open the TUI or `af --help` for commands.");
  },
});
