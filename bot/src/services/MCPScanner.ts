import * as fs from 'fs';
import * as path from 'path';
import { MCPServer, IMCPServer, IPersonalField } from '../models/MCPServer';

const MCP_DIR = path.resolve(__dirname, '..', '..', 'mcp-servers');

interface MCPConfig {
  name: string;
  displayName?: string;
  description?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
  toolDescriptions?: Record<string, string>;
  personalFields?: IPersonalField[];
}

// ─── Scan mcp-servers directory ─────────────────────────────────

export async function scanMCPDirectory(): Promise<{ added: string[]; updated: string[]; errors: string[] }> {
  const result = { added: [] as string[], updated: [] as string[], errors: [] as string[] };

  if (!fs.existsSync(MCP_DIR)) {
    result.errors.push(`MCP directory not found: ${MCP_DIR}`);
    return result;
  }

  const entries = fs.readdirSync(MCP_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const configPath = path.join(MCP_DIR, entry.name, 'mcp.json');
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const config: MCPConfig = JSON.parse(raw);

      if (!config.name || !config.command) {
        result.errors.push(`${entry.name}/mcp.json: missing name or command`);
        continue;
      }

      const existing = await MCPServer.findOne({ name: config.name });
      // Resolve relative args to absolute paths based on mcp.json location
      const resolvedArgs = (config.args || []).map((arg: string) => {
        if (arg.startsWith('-') || arg.startsWith('http')) return arg;
        return path.resolve(MCP_DIR, entry.name, arg);
      });

      if (existing) {
        // Update existing (keep owner's toggle/env, update other fields)
        existing.displayName = config.displayName || config.name;
        existing.description = config.description || '';
        existing.command = config.command;
        existing.args = resolvedArgs;
        existing.tools = config.tools || [];
        existing.toolDescriptions = config.toolDescriptions || {};
        existing.personalFields = config.personalFields || [];
        existing.sourcePath = path.join(MCP_DIR, entry.name);
        await existing.save();
        result.updated.push(config.name);
      } else {
        // Create new
        await MCPServer.create({
          name: config.name,
          displayName: config.displayName || config.name,
          command: config.command,
          args: resolvedArgs,
          env: config.env || {},
          isEnabled: true,
          isDefault: true,
          description: config.description || '',
          tools: config.tools || [],
          toolDescriptions: config.toolDescriptions || {},
          transportType: 'stdio',
          personalFields: config.personalFields || [],
          sourcePath: path.join(MCP_DIR, entry.name),
        });
        result.added.push(config.name);
      }
    } catch (e: any) {
      result.errors.push(`${entry.name}: ${e.message}`);
    }
  }

  return result;
}

// ─── List all MCP directories without mcp.json (suggestions) ────

export function listMCPSuggestions(): { dir: string; hasConfig: boolean; files: string[] }[] {
  if (!fs.existsSync(MCP_DIR)) return [];

  const entries = fs.readdirSync(MCP_DIR, { withFileTypes: true });
  const results: { dir: string; hasConfig: boolean; files: string[] }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(MCP_DIR, entry.name);
    const files = fs.readdirSync(dirPath);
    results.push({
      dir: entry.name,
      hasConfig: files.includes('mcp.json'),
      files,
    });
  }

  return results;
}

// ─── Get MCP directory path ─────────────────────────────────────

export function getMCPDir(): string {
  return MCP_DIR;
}
