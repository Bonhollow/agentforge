import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  initRegistry,
  addElement,
  listElements,
  readElement,
  removeElement,
  getRegistryDir,
  readRegistry,
  writeRegistry,
} from "../src/core/registry.js";

import { validateElement } from "../src/core/validate.js";
import { diffSchemas } from "../src/core/diff.js";
import type { UniversalSchema } from "../src/core/schema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `af-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("registry", () => {
  it("should init a registry directory", () => {
    const path = initRegistry(tmpDir);
    expect(existsSync(join(path, "agents"))).toBe(true);
    expect(existsSync(join(path, "skills"))).toBe(true);
    expect(existsSync(join(path, "prompts"))).toBe(true);
  });

  it("should add an agent YAML template", () => {
    initRegistry(tmpDir);
    const filePath = addElement(tmpDir, "agent", "test-agent");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("name: test-agent");
    expect(content).toContain("version: 1.0.0");
  });

  it("should add a skill markdown template", () => {
    initRegistry(tmpDir);
    const filePath = addElement(tmpDir, "skill", "test-skill");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("name: test-skill");
    expect(content).toContain("---");
  });

  it("should list elements", () => {
    initRegistry(tmpDir);
    addElement(tmpDir, "agent", "agent-a");
    addElement(tmpDir, "agent", "agent-b");
    addElement(tmpDir, "skill", "skill-a");

    const elements = listElements(tmpDir);
    expect(elements).toHaveLength(3);
  });

  it("should list elements filtered by type", () => {
    initRegistry(tmpDir);
    addElement(tmpDir, "agent", "agent-a");
    addElement(tmpDir, "skill", "skill-a");

    const agents = listElements(tmpDir, "agent");
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("agent-a");
  });

  it("should read a single element", () => {
    initRegistry(tmpDir);
    addElement(tmpDir, "agent", "my-agent");
    const el = readElement(tmpDir, "my-agent");
    expect(el).not.toBeNull();
    expect(el!.type).toBe("agent");
    expect(el!.data.name).toBe("my-agent");
  });

  it("should return null for missing element", () => {
    initRegistry(tmpDir);
    const el = readElement(tmpDir, "nonexistent");
    expect(el).toBeNull();
  });

  it("should remove an element", () => {
    initRegistry(tmpDir);
    addElement(tmpDir, "agent", "to-remove");
    expect(readElement(tmpDir, "to-remove")).not.toBeNull();
    const removed = removeElement(tmpDir, "to-remove");
    expect(removed).toBe(true);
    expect(readElement(tmpDir, "to-remove")).toBeNull();
  });
});

describe("schema validation", () => {
  it("should validate a correctly formatted agent YAML", () => {
    initRegistry(tmpDir);
    const filePath = addElement(tmpDir, "agent", "valid-agent");
    const errors = validateElement(filePath);
    expect(errors).toHaveLength(0);
  });

  it("should report errors for invalid YAML", () => {
    const badFile = join(tmpDir, "bad.yaml");
    writeFileSync(badFile, "{ invalid yaml: unclosed", "utf-8");
    const errors = validateElement(badFile);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("diff engine", () => {
  it("should detect no differences when schemas are identical", () => {
    const schema: UniversalSchema = { agents: [], skills: [], prompts: [] };
    const result = diffSchemas(schema, schema);
    expect(result.hasChanges).toBe(false);
  });

  it("should detect added agents", () => {
    const local: UniversalSchema = { agents: [], skills: [], prompts: [] };
    const remote: UniversalSchema = {
      agents: [{ name: "a", version: "1.0.0", description: "", system_prompt: "", skills: [], tools: [], expose: [] }],
      skills: [],
      prompts: [],
    };
    const result = diffSchemas(local, remote);
    expect(result.hasChanges).toBe(true);
  });
});

describe("read/write registry", () => {
  it("should round-trip schemas through write and read", () => {
    initRegistry(tmpDir);

    const schema: UniversalSchema = {
      agents: [
        { name: "alice", version: "1.0.0", description: "Alice agent", system_prompt: "You are Alice", skills: [], tools: [], expose: ["claude_code"] },
      ],
      skills: [
        { name: "greet", version: "1.0.0", description: "Greeting skill", body: "Say hello" },
      ],
      prompts: [
        { name: "qa", version: "1.0.0", description: "Q&A prompt", tags: ["qa"], body: "Answer questions" },
      ],
    };

    writeRegistry(tmpDir, schema);
    const readBack = readRegistry(tmpDir);

    expect(readBack.agents).toHaveLength(1);
    expect(readBack.agents[0].name).toBe("alice");
    expect(readBack.skills).toHaveLength(1);
    expect(readBack.skills[0].name).toBe("greet");
    expect(readBack.prompts).toHaveLength(1);
    expect(readBack.prompts[0].name).toBe("qa");
  });
});
