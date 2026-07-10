import { spawn, ChildProcess } from 'child_process';
import { MCPServer, IMCPServer } from '../models/MCPServer';
import { UserMCP } from '../models/UserMCP';
import { searchCache } from './SearchCache';
import { mcpLimiter } from './ConcurrencyLimiter';

// ─── Connection cache ───────────────────────────────────────────

interface MCPConnection {
  proc?: ChildProcess;
  id: number;
  ready: boolean;
  tools: string[];
  toolDescriptions: Record<string, string>;
  transportType: 'stdio' | 'streamable-http' | 'sse';
  remoteUrl?: string;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  abortController?: AbortController;
  stdoutBuf: string;
}

const connections = new Map<string, MCPConnection>();

function makeKey(type: 'system' | 'user', id: string) {
  return `${type}:${id}`;
}

// ─── Process buffered stdout ────────────────────────────────────

function processBuffer(conn: MCPConnection) {
  const buf = conn.stdoutBuf;
  conn.stdoutBuf = '';
  // Split by newlines — each line is a JSON-RPC message
  const lines = buf.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id != null && conn.pending.has(msg.id)) {
        const p = conn.pending.get(msg.id)!;
        conn.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    } catch {
      // Not JSON or incomplete — put back
      conn.stdoutBuf = trimmed + conn.stdoutBuf;
    }
  }
}

// ─── Send JSON-RPC request ─────────────────────────────────────

function sendStdioRequest(conn: MCPConnection, method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++conn.id;
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      reject(new Error(`MCP timeout: ${method}`));
    }, 15000);
    conn.pending.set(id, { resolve, reject, timer });
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    conn.proc!.stdin!.write(msg);
  });
}

async function sendHttpRequest(conn: MCPConnection, method: string, params: any = {}): Promise<any> {
  const id = ++conn.id;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const resp = await fetch(conn.remoteUrl!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body,
    signal: conn.abortController?.signal,
  });
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const text = await resp.text();
    for (const event of text.split('\n\n').filter(Boolean)) {
      const dataLine = event.split('\n').find(l => l.startsWith('data:'));
      if (dataLine) {
        const data = JSON.parse(dataLine.substring(5).trim());
        if (data.id === id) return data.result || data;
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      }
    }
    throw new Error('No matching response in SSE stream');
  } else {
    const data: any = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.result;
  }
}

function sendRequest(conn: MCPConnection, method: string, params: any = {}): Promise<any> {
  if (conn.transportType === 'stdio') return sendStdioRequest(conn, method, params);
  return sendHttpRequest(conn, method, params);
}

// ─── Connect to stdio MCP ──────────────────────────────────────

async function connectStdioMCP(
  command: string,
  args: string[],
  env: Record<string, string>,
  tools: string[],
  key: string,
): Promise<MCPConnection | null> {
  if (connections.has(key)) {
    const existing = connections.get(key)!;
    if (existing.ready) return existing;
    try { existing.proc?.kill(); } catch {}
    connections.delete(key);
  }

  return new Promise((resolve) => {
    const safeEnv: Record<string, string> = {};
    for (const key of ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'NODE_ENV']) {
      if (process.env[key]) safeEnv[key] = process.env[key]!;
    }
    const proc = spawn(command, args, {
      env: { ...safeEnv, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const conn: MCPConnection = {
      proc,
      id: 0,
      ready: false,
      tools: tools.map(t => t.toLowerCase()),
      toolDescriptions: {},
      transportType: 'stdio',
      pending: new Map(),
      stdoutBuf: '',
    };

    let initDone = false;
    let resolveConn: ((conn: MCPConnection) => void) | null = null;
    const waitForInit = new Promise<MCPConnection>((r) => { resolveConn = r; });

    proc.stdout!.on('data', (data: Buffer) => {
      conn.stdoutBuf += data.toString();

      if (!initDone) {
        // Try to find the init response
        const lines = conn.stdoutBuf.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.result?.capabilities) {
              initDone = true;
              conn.ready = true;
              // Remove processed lines
              conn.stdoutBuf = lines.slice(i + 1).join('\n');
              connections.set(key, conn);
              // Send notifications/initialized (required by MCP protocol)
              const notifMsg = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n';
              proc.stdin!.write(notifMsg);
              // Now list tools — wait for completion before resolving
              sendRequest(conn, 'tools/list').then((result: any) => {
                const toolList = result?.tools || [];
                const toolNames = toolList.map((t: any) => (t.name || '').toLowerCase());
                if (toolNames.length) conn.tools = toolNames;
                for (const t of toolList) {
                  if (t.name && t.description) conn.toolDescriptions[t.name.toLowerCase()] = t.description;
                }
                console.log(`[MCP:${key}] tools/list: ${conn.tools.join(', ')}`);
                resolveConn!(conn);
              }).catch((e) => {
                console.error(`[MCP:${key}] tools/list failed:`, e.message);
                resolveConn!(conn);
              });
              return;
            }
          } catch {}
        }
      }

      if (initDone) processBuffer(conn);
    });

    proc.stderr!.on('data', (data: Buffer) => {
      // Log MCP server errors for debugging
      const msg = data.toString().trim();
      if (msg) console.error(`[MCP:${key}] ${msg}`);
    });

    proc.on('error', (err) => {
      console.error(`[MCP:${key}] spawn error:`, err.message);
      if (!initDone) resolve(null);
    });

    proc.on('close', (code) => {
      console.error(`[MCP:${key}] process exited with code ${code}`);
      conn.ready = false;
      connections.delete(key);
      for (const [, p] of conn.pending) { clearTimeout(p.timer); p.reject(new Error('MCP server closed')); }
    });

    // Send initialize
    const initMsg = JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gapat-bot', version: '1.0.0' } },
    }) + '\n';
    proc.stdin!.write(initMsg);

    // Timeout
    setTimeout(() => {
      if (!initDone) {
        console.error(`[MCP:${key}] init timeout`);
        try { proc.kill(); } catch {}
        resolve(null);
      }
    }, 8000);

    // Wait for init + tools/list to complete
    waitForInit.then(resolve).catch(() => resolve(null));
  });
}

// ─── Connect to system MCP ─────────────────────────────────────

export async function connectSystemMCP(server: IMCPServer, personalValues?: Record<string, string>): Promise<MCPConnection | null> {
  const key = makeKey('system', server._id.toString());

  if (server.transportType === 'streamable-http' || server.transportType === 'sse') {
    const remoteUrl = server.remoteUrl;
    const remoteHeaders = server.remoteHeaders instanceof Map ? Object.fromEntries(server.remoteHeaders) : (server.remoteHeaders || {});
    if (!remoteUrl) return null;
    const conn: MCPConnection = {
      id: 0, ready: false, tools: (server.tools || []).map(t => t.toLowerCase()),
      toolDescriptions: (server.toolDescriptions instanceof Map ? Object.fromEntries(server.toolDescriptions) : server.toolDescriptions) || {},
      transportType: server.transportType as any, remoteUrl, pending: new Map(), stdoutBuf: '',
    };
    try {
      const result = await sendRequest(conn, 'initialize', {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gapat-bot', version: '1.0.0' },
      });
      if (result?.capabilities) {
        conn.ready = true;
        try {
          const r = await sendRequest(conn, 'tools/list');
          const toolList = r?.tools || [];
          conn.tools = toolList.map((t: any) => (t.name || '').toLowerCase());
          for (const t of toolList) {
            if (t.name && t.description) conn.toolDescriptions[t.name.toLowerCase()] = t.description;
          }
        } catch {}
        connections.set(key, conn);
        return conn;
      }
    } catch {}
    return null;
  }

  // stdio
  const env: Record<string, string> = {};
  const serverEnv = server.env instanceof Map ? Object.fromEntries(server.env) : (server.env || {});
  Object.assign(env, serverEnv);
  if (personalValues) Object.assign(env, personalValues);

  return connectStdioMCP(server.command, server.args, env, server.tools || [], key);
}

// ─── Call tool on a connection ──────────────────────────────────

export async function callTool(conn: MCPConnection, toolName: string, args: any): Promise<string | null> {
  try {
    const result = await sendRequest(conn, 'tools/call', { name: toolName, arguments: args });
    const content = result?.content;
    if (!Array.isArray(content)) return null;
    const textBlock = content.find((c: any) => c.type === 'text');
    if (!textBlock?.text) return null;
    // Try to parse as search results
    try {
      const parsed = JSON.parse(textBlock.text);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((r: any, i: number) =>
          `${i + 1}. **${r.title || ''}**\n${r.snippet || ''}\n${r.url || ''}`
        ).join('\n\n');
      }
    } catch {}
    return textBlock.text;
  } catch {
    return null;
  }
}

// ─── Public: Search with MCP ───────────────────────────────────

export async function mcpSearch(query: string, maxResults = 5, userId?: string): Promise<string | null> {
  // Check cache first — same query within TTL returns cached result
  const cached = searchCache.get(query);
  if (cached) {
    console.log(`[MCP] Cache hit for: "${query.substring(0, 50)}"`);
    return cached;
  }

  // System MCPs — user-enabled first, then all enabled as fallback
  if (userId) {
    try {
      const systemMCPs = await MCPServer.find({ isEnabled: true, isDefault: true });
      const userConfigs = await UserMCP.find({ userId, systemMcpId: { $in: systemMCPs.map(s => s._id.toString()) } });
      const configMap = new Map(userConfigs.map(c => [c.systemMcpId, c]));

      const sorted = [...systemMCPs].sort((a, b) => {
        const aEnabled = configMap.get(a._id.toString())?.isEnabled ? 1 : 0;
        const bEnabled = configMap.get(b._id.toString())?.isEnabled ? 1 : 0;
        return bEnabled - aEnabled;
      });

      for (const server of sorted) {
        if (!server.command && !server.remoteUrl) continue;
        const userConfig = configMap.get(server._id.toString());
        if (userConfig && !userConfig.isEnabled) continue;
        const personalValues = userConfig?.personalValues instanceof Map
          ? Object.fromEntries(userConfig.personalValues)
          : (userConfig?.personalValues || {});
        console.log(`[MCP] mcpSearch connecting to ${server.name}...`);
        const conn = await connectSystemMCP(server, personalValues);
        if (!conn || !conn.ready) {
          console.log(`[MCP] mcpSearch ${server.name} not ready`);
          continue;
        }
        console.log(`[MCP] mcpSearch ${server.name} tools: ${conn.tools.join(', ')}`);
        if (!conn.tools.some(t => t === 'web_search' || t.includes('search'))) continue;
        console.log(`[MCP] mcpSearch calling web_search("${query.substring(0, 50)}")`);
        await mcpLimiter.acquire();
        let result: string | null = null;
        try {
          result = await callTool(conn, 'web_search', { query, max_results: maxResults });
        } finally {
          mcpLimiter.release();
        }
        console.log(`[MCP] mcpSearch result: ${result?.substring(0, 100) || 'null'}`);
        if (result) {
          // Check if result is actually useful — MCP may return "[]" or empty
          const trimmed = result.trim();
          if (trimmed !== '[]' && trimmed !== '""' && trimmed !== '' && trimmed !== 'null' && trimmed !== '{}') {
            searchCache.set(query, result);
            return result;
          }
          console.log(`[MCP] mcpSearch returned empty result, skipping`);
        }
      }
    } catch (e: any) {
      console.error('[MCP] mcpSearch error:', e.message);
    }
  }

  return null;
}

export async function mcpFetch(url: string, userId?: string): Promise<string | null> {
  // System MCPs
  if (userId) {
    try {
      const systemMCPs = await MCPServer.find({ isEnabled: true, isDefault: true });
      const userConfigs = await UserMCP.find({ userId, systemMcpId: { $in: systemMCPs.map(s => s._id.toString()) } });
      const configMap = new Map(userConfigs.map(c => [c.systemMcpId, c]));

      for (const server of systemMCPs) {
        if (!server.command && !server.remoteUrl) continue;
        const userConfig = configMap.get(server._id.toString());
        if (userConfig && !userConfig.isEnabled) continue;
        const personalValues = userConfig?.personalValues instanceof Map
          ? Object.fromEntries(userConfig.personalValues)
          : (userConfig?.personalValues || {});
        const conn = await connectSystemMCP(server, personalValues);
        if (!conn || !conn.ready) continue;
        if (!conn.tools.some(t => t === 'web_fetch' || t.includes('fetch'))) continue;
        const result = await callTool(conn, 'web_fetch', { url });
        if (result) return result;
      }
    } catch {}
  }

  return null;
}

export function disconnectAll() {
  for (const [key, conn] of connections) {
    try { conn.proc?.kill(); } catch {}
    try { conn.abortController?.abort(); } catch {}
    for (const [, p] of conn.pending) { clearTimeout(p.timer); p.reject(new Error('Shutting down')); }
  }
  connections.clear();
}
