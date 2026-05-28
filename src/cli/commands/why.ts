import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";
import { readElement, readRegistry, getRegistryDir } from "../../core/registry.js";
import { existsSync } from "node:fs";

export default defineCommand({
  meta: {
    name: "why",
    description: "Explain what an element does using an AI model",
  },
  args: {
    name: {
      type: "positional",
      description: "Element name to explain",
      required: true,
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
    if (!el) {
      consola.error(`Element "${name}" not found in local registry.`);
      return;
    }

    const schema = readRegistry(cwd);
    const serialized = JSON.stringify(el.data, null, 2);
    const bodySnippet = el.body ? el.body.slice(0, 2000) : "";

    let typeLabel = el.type;
    if (el.type === "agent") {
      const agent = schema.agents.find((a) => a.name === name);
      if (agent?.skills?.length) {
        const skillNames = agent.skills.map((s) => s.ref).join(", ");
        typeLabel += ` (skills: ${skillNames})`;
      }
    }

    consola.info(`Requesting explanation for "${name}" (${typeLabel})...`);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      consola.error("Set OPENAI_API_KEY environment variable.");
      return;
    }

    const prompt = `You are auditing an agent forge registry. Explain in one plain-English paragraph what this element does and how it might be used. Be concise, focus on purpose and behavior.\n\nName: ${name}\nType: ${el.type}\n\nData:\n${serialized}\n${bodySnippet ? `\nBody:\n${bodySnippet}` : ""}`;

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300,
        }),
      });

      if (!res.ok) {
        consola.error(`API error: ${res.status} ${res.statusText}`);
        const text = await res.text();
        consola.log(text);
        return;
      }

      const data = await res.json() as any;
      const explanation = data?.choices?.[0]?.message?.content || "No explanation returned.";

      consola.log(`\n--- ${name} ---`);
      consola.log(explanation.trim());
      consola.log("---------------");
    } catch (err) {
      consola.error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
