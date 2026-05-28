import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";

export default defineCommand({
  meta: {
    name: "lsp",
    description: "Start the Language Server Protocol server for .agentforge/ files",
  },
  async run() {
    consola.info("Starting AgentForge LSP server...");
    await import("../../lsp/server.js");
  },
});
