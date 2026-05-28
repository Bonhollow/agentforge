import {
  createConnection,
  TextDocuments,
  TextDocumentSyncKind,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Location,
  Range,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot: string = "";

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri
    ? decodeURI(params.rootUri.replace(/^file:\/\//, ""))
    : params.rootPath || process.cwd();
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ["\n", " ", ":"] },
      definitionProvider: true,
    },
  };
});

function findRegistryDir(root: string): string | null {
  for (const dir of [join(root, ".agentforge"), join(root, ".agentforge")]) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function listSkills(regDir: string): string[] {
  const skillsDir = join(regDir, "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => basename(f, ".md"));
}

function listPrompts(regDir: string): string[] {
  const promptsDir = join(regDir, "prompts");
  if (!existsSync(promptsDir)) return [];
  return readdirSync(promptsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => basename(f, ".md"));
}

function listAgents(regDir: string): string[] {
  const agentsDir = join(regDir, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => basename(f, extname(f)));
}

function validateYaml(uri: string, text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const regDir = findRegistryDir(workspaceRoot);
  if (!regDir) return diagnostics;

  const ext = extname(uri);

  try {
    if (ext === ".md") {
      const fm = matter(text);
      const data = fm.data || {};

      if (!data.name) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "Missing name field",
          source: "agentforge",
        });
      }
      if (!data.version) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "Missing version field",
          source: "agentforge",
        });
      }
    }

    if (ext === ".yaml" || ext === ".yml") {
      const data = yaml.load(text) as Record<string, unknown>;

      if (data?.name && !data?.version) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "Agent missing version field",
          source: "agentforge",
        });
      }

      const skills = data?.skills as Array<{ ref: string }> | undefined;
      if (skills) {
        const skillNames = listSkills(regDir);
        for (let i = 0; i < skills.length; i++) {
          const ref = skills[i]?.ref;
          if (ref && !skillNames.includes(ref)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              message: `Skill "${ref}" not found in registry`,
              source: "agentforge",
            });
          }
        }
      }

      const expose = data?.expose as string[] | undefined;
      const validTargets = ["claude_code", "codex", "opencode", "cursor", "windsurf"];
      if (expose) {
        for (let i = 0; i < expose.length; i++) {
          if (!validTargets.includes(expose[i])) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              message: `Unknown target "${expose[i]}". Valid: ${validTargets.join(", ")}`,
              source: "agentforge",
            });
          }
        }
      }
    }
  } catch {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: "YAML parse error",
      source: "agentforge",
    });
  }

  return diagnostics;
}

documents.onDidChangeContent((change) => {
  const diagnostics = validateYaml(change.document.uri, change.document.getText());
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

documents.onDidOpen((event) => {
  const diagnostics = validateYaml(event.document.uri, event.document.getText());
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics });
});

connection.onCompletion(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const regDir = findRegistryDir(workspaceRoot);
  if (!regDir) return null;

  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineBefore = text.slice(lineStart, offset);

  const refMatch = lineBefore.match(/ref:\s*(\S*)$/);
  if (refMatch) {
    const prefix = refMatch[1].toLowerCase();
    const items = listSkills(regDir)
      .filter((s) => s.toLowerCase().includes(prefix))
      .map((s) => ({
        label: s,
        kind: CompletionItemKind.Reference,
        detail: "skill",
        insertText: s,
      }));
    const prompts = listPrompts(regDir)
      .filter((s) => s.toLowerCase().includes(prefix))
      .map((s) => ({
        label: s,
        kind: CompletionItemKind.Reference,
        detail: "prompt",
        insertText: s,
      }));
    return { isIncomplete: false, items: [...items, ...prompts] };
  }

  const exposeMatch = lineBefore.match(/^\s*-\s*(\S*)$/);
  const prevLine = text.slice(Math.max(0, text.lastIndexOf("\n", lineStart - 2)), lineStart).trim();
  if (exposeMatch && prevLine === "expose:") {
    const validTargets = ["claude_code", "codex", "opencode", "cursor", "windsurf"];
    const prefix = exposeMatch[1].toLowerCase();
    return {
      isIncomplete: false,
      items: validTargets
        .filter((t) => t.toLowerCase().includes(prefix))
        .map((t) => ({
          label: t,
          kind: CompletionItemKind.EnumMember,
          detail: "platform target",
          insertText: t,
        })),
    };
  }

  return null;
});

connection.onDefinition(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const regDir = findRegistryDir(workspaceRoot);
  if (!regDir) return null;

  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

  const refMatch = line.match(/ref:\s*(\S+)/);
  if (refMatch) {
    const skillName = refMatch[1];
    const skillPath = join(regDir, "skills", `${skillName}.md`);
    if (existsSync(skillPath)) {
      return {
        uri: `file://${skillPath}`,
        range: Range.create(Position.create(0, 0), Position.create(0, 0)),
      };
    }
    return null;
  }

  return null;
});

documents.listen(connection);
connection.listen();
