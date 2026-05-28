#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { consola } from "../utils/logger.js";

import initCmd from "./commands/init.js";
import addCmd from "./commands/add.js";
import listCmd from "./commands/list.js";
import showCmd from "./commands/show.js";
import removeCmd from "./commands/remove.js";
import exportCmd from "./commands/export.js";
import importCmd from "./commands/import.js";
import syncCmd from "./commands/sync.js";
import diffCmd from "./commands/diff.js";
import validateCmd from "./commands/validate.js";
import versionCmd from "./commands/version.js";
import authCmd from "./commands/auth.js";
import useCmd from "./commands/use.js";
import shareCmd from "./commands/share.js";
import pullCmd from "./commands/pull.js";
import testCmd from "./commands/test.js";
import whyCmd from "./commands/why.js";
import snapshotCmd from "./commands/snapshot.js";
import forkCmd from "./commands/fork.js";
import rollbackCmd from "./commands/rollback.js";
import upgradeCmd from "./commands/upgrade.js";
import benchCmd from "./commands/bench.js";
import lspCmd from "./commands/lsp.js";
import searchCmd from "./commands/search.js";
import previewCmd from "./commands/preview.js";
import graphCmd from "./commands/graph.js";
import lintCmd from "./commands/lint.js";
import bulkCmd from "./commands/bulk.js";

const subCommands = {
  init: initCmd,
  add: addCmd,
  list: listCmd,
  show: showCmd,
  remove: removeCmd,
  export: exportCmd,
  import: importCmd,
  sync: syncCmd,
  diff: diffCmd,
  validate: validateCmd,
  version: versionCmd,
  auth: authCmd,
  use: useCmd,
  share: shareCmd,
  pull: pullCmd,
  test: testCmd,
  why: whyCmd,
  snapshot: snapshotCmd,
  fork: forkCmd,
  rollback: rollbackCmd,
  upgrade: upgradeCmd,
  bench: benchCmd,
  lsp: lspCmd,
  search: searchCmd,
  preview: previewCmd,
  graph: graphCmd,
  lint: lintCmd,
  bulk: bulkCmd,
};

const main = defineCommand({
  meta: {
    name: "af",
    description: "AgentForge - Universal agent, prompt, and skill management",
    version: "0.1.0",
  },
  subCommands,
});

async function bootstrap() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length > 0) {
    runMain(main).catch((err) => {
      consola.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
  } else {
    const { runTui } = await import("./tui.js");
    await runTui();
  }
}

bootstrap();
