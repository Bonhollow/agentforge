import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readElement, getRegistryDir } from "../../core/registry.js";
import { existsSync, readFileSync } from "node:fs";
import { text } from "@clack/prompts";
import { readModels, providerConfigFromModel } from "../../core/models.js";

export default defineCommand({
  meta: {
    name: "test",
    description: "Run agent system prompt + query against a model from the registry",
  },
  args: {
    name: {
      type: "positional",
      description: "Agent name to test",
      required: true,
    },
    prompt: {
      type: "string",
      description: "Inline user message to send",
      alias: "p",
    },
    "prompt-file": {
      type: "string",
      description: "File containing user message",
    },
    provider: {
      type: "string",
      description: "Provider name from the model registry (e.g. Ollama, LM Studio)",
    },
    model: {
      type: "string",
      description: "Model name override",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    if (!existsSync(getRegistryDir(cwd))) {
      consola.error("No registry found. Run `af init` first.");
      return;
    }

    const name = args.name as string;
    const el = readElement(cwd, name);
    if (!el || el.type !== "agent") {
      consola.error(`Agent "${name}" not found in local registry.`);
      return;
    }

    const systemPrompt = (el.data.system_prompt as string) || "";
    if (!systemPrompt) {
      consola.error(`Agent "${name}" has no system_prompt.`);
      return;
    }

    const reg = readModels(cwd);
    if (reg.providers.length === 0) {
      consola.error("No model providers registered. Use `af models add` or auto-detect.");
      return;
    }

    let providerName = args.provider as string | undefined;
    if (!providerName) {
      const choice = (await text({
        message: "Provider name (from model registry):",
        placeholder: reg.providers[0].name,
      })) as string;
      if (!choice) providerName = reg.providers[0].name;
      else providerName = choice;
    }

    const providerReg = reg.providers.find(p => p.name === providerName);
    if (!providerReg) {
      consola.error(`Provider "${providerName}" not found in registry. Available: ${reg.providers.map(p => p.name).join(", ")}`);
      return;
    }

    let model = args.model as string | undefined;
    if (!model && providerReg.models && providerReg.models.length > 0) {
      model = providerReg.models[0].name;
    }
    if (!model) {
      const input = await text({
        message: "Model name:",
        placeholder: "gpt-4o-mini",
      });
      if (typeof input !== "string") return;
      model = input;
    }

    let userMessage = args.prompt as string | undefined;
    if (!userMessage && args["prompt-file"]) {
      try {
        userMessage = readFileSync(args["prompt-file"] as string, "utf-8").trim();
      } catch {
        consola.error(`Could not read prompt file: ${args["prompt-file"]}`);
        return;
      }
    }
    if (!userMessage) {
      const input = await text({
        message: "User message:",
        placeholder: "What should I do?",
      });
      if (typeof input !== "string") return;
      userMessage = input;
    }

    const provider = providerConfigFromModel(providerReg);

    consola.info(`Testing "${name}" via ${providerReg.name} (${model})...\n`);

    try {
      const body = provider.body(systemPrompt, userMessage, model);
      const res = await fetch(provider.url, {
        method: "POST",
        headers: provider.headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        consola.error(`API error: ${res.status} ${res.statusText}`);
        const text = await res.text();
        consola.log(text);
        return;
      }

      const data = await res.json();
      const output = provider.extract(data);

      consola.log(`--- ${name} response ---`);
      consola.log(output);
      consola.log("------------------------");
    } catch (err) {
      consola.error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
