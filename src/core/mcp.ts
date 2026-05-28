import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getRegistryDir } from "./registry.js";

export interface MCPUrlServer {
  url: string;
  description?: string;
}

export interface MCPCommandServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

export type MCPServer = MCPUrlServer | MCPCommandServer;

export interface MCPServersConfig {
  servers: Record<string, MCPServer>;
}

export function mcpServersPath(cwd: string): string {
  return join(getRegistryDir(cwd), "mcp.json");
}

export function readMCPServers(cwd: string): MCPServersConfig {
  const path = mcpServersPath(cwd);
  if (!existsSync(path)) return { servers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as MCPServersConfig;
  } catch {
    return { servers: {} };
  }
}

export function writeMCPServers(cwd: string, config: MCPServersConfig): void {
  writeFileSync(mcpServersPath(cwd), JSON.stringify(config, null, 2), "utf-8");
}

export function addMCPServer(cwd: string, name: string, server: MCPServer): void {
  const config = readMCPServers(cwd);
  config.servers[name] = server;
  writeMCPServers(cwd, config);
}

export function removeMCPServer(cwd: string, name: string): void {
  const config = readMCPServers(cwd);
  delete config.servers[name];
  writeMCPServers(cwd, config);
}

export function renameMCPServer(cwd: string, oldName: string, newName: string): void {
  const config = readMCPServers(cwd);
  if (!config.servers[oldName]) return;
  config.servers[newName] = config.servers[oldName];
  delete config.servers[oldName];
  writeMCPServers(cwd, config);
}

export function resolveMCPServer(cwd: string, name: string): MCPServer | undefined {
  const config = readMCPServers(cwd);
  return config.servers[name];
}
