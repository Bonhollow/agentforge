import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readElement, readRegistry, getRegistryDir } from "../../core/registry.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readModels, providerConfigFromModel } from "../../core/models.js";

export default defineCommand({
  meta: {
    name: "bench",
    description: "Run agent against fixture prompts and print outputs",
  },
  args: {
    name: {
      type: "positional",
      description: "Agent name",
      required: true,
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
      consola.error("No registry found.");
      return;
    }

    const name = args.name as string;
    const el = readElement(cwd, name);
    if (!el || el.type !== "agent") {
      consola.error(`Agent "${name}" not found.`);
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

    const providerName = (args.provider as string) || reg.providers[0].name;
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
      consola.error("No model specified and provider has no cached models. Pass --model.");
      return;
    }

    const provider = providerConfigFromModel(providerReg);

    const fixturesDir = join(cwd, ".agentforge", "fixtures", name);
    if (!existsSync(fixturesDir)) {
      consola.error(`No fixtures found at .agentforge/fixtures/${name}/`);
      consola.log("Create .md or .txt files in that directory with fixture prompts.");
      return;
    }

    const files = readdirSync(fixturesDir)
      .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
      .sort();

    if (files.length === 0) {
      consola.error(`No .md or .txt fixtures found in .agentforge/fixtures/${name}/`);
      return;
    }

    consola.info(`Benchmarking "${name}" with ${files.length} fixture(s) via ${providerReg.name} (${model})...`);

    for (const file of files) {
      const content = readFileSync(join(fixturesDir, file), "utf-8").trim();
      if (!content) continue;

      consola.log(`\n--- Fixture: ${file} ---`);

      try {
        const body = provider.body(systemPrompt, content, model);
        const res = await fetch(provider.url, {
          method: "POST",
          headers: provider.headers,
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          consola.warn(`  API error: ${res.status}`);
          continue;
        }

        const data = await res.json();
        const output = provider.extract(data);
        consola.log(output.slice(0, 1000));
      } catch (err) {
        consola.warn(`  Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    consola.log("--- Benchmark complete ---");
  },
});
