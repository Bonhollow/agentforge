import { defineCommand } from "citty";
import { consola } from "../../utils/logger.js";

export default defineCommand({
  meta: {
    name: "auth",
    description: "Supabase authentication",
  },
  subCommands: {
    login: defineCommand({
      meta: { name: "login", description: "Open browser OAuth flow" },
      async run() {
        consola.info("Auth login - placeholder");
        consola.log("Run: af auth login");
      },
    }),
    logout: defineCommand({
      meta: { name: "logout", description: "Clear session" },
      async run() {
        consola.info("Auth logout - placeholder");
      },
    }),
    status: defineCommand({
      meta: { name: "status", description: "Show auth status" },
      async run() {
        consola.info("Auth status - placeholder");
        consola.log("Not authenticated");
      },
    }),
  },
});
