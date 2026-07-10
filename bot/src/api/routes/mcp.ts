import { Router } from 'express';
import { MCPServer } from '../../models/MCPServer';
import { authMiddleware, ownerOnly } from '../middleware';
import { scanMCPDirectory, listMCPSuggestions } from '../../services/MCPScanner';
import { connectSystemMCP, callTool } from '../../services/MCPClient';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  try {
    const servers = await MCPServer.find().sort({ createdAt: -1 });
    res.json(servers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Get MCP directory suggestions (must be before /:id) ────────
router.get('/scan/suggestions', async (_req, res) => {
  try {
    const suggestions = listMCPSuggestions();
    res.json(suggestions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const server = await MCPServer.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    res.json(server);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Scan filesystem for MCPs ───────────────────────────────────
router.post('/scan', ownerOnly, async (_req, res) => {
  try {
    const result = await scanMCPDirectory();
    const suggestions = listMCPSuggestions();
    res.json({ ...result, suggestions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Add MCP manually (for registry/remote MCPs) ────────────────
router.post('/', ownerOnly, async (req, res) => {
  try {
    const { name, displayName, command, args, env, tools, transportType, remoteUrl, remoteHeaders, description, personalFields } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const exists = await MCPServer.findOne({ name });
    if (exists) return res.status(409).json({ error: 'MCP server name already exists' });
    const server = await MCPServer.create({
      name, displayName: displayName || name, command: command || '', args: args || [],
      env: env || {}, isEnabled: true, tools: tools || [],
      transportType: transportType || 'stdio', remoteUrl: remoteUrl || '',
      remoteHeaders: remoteHeaders || {}, description: description || '',
      personalFields: personalFields || [],
    });
    res.status(201).json(server);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Discover tools from any MCP server ────────────────────────
// POST /api/v1/mcp/discover — test-connect to an MCP server, list its tools
router.post('/discover', ownerOnly, async (req, res) => {
  try {
    const { command, args, env, remoteUrl, transportType } = req.body;
    if (!command && !remoteUrl) {
      return res.status(400).json({ error: 'Provide command (stdio) or remoteUrl (HTTP/SSE)' });
    }

    // Create a temporary MCPServer doc to use connectSystemMCP
    const tempServer = {
      _id: 'temp',
      command: command || '',
      args: args || [],
      env: env || {},
      transportType: transportType || (remoteUrl ? 'streamable-http' : 'stdio'),
      remoteUrl: remoteUrl || '',
      remoteHeaders: {},
      tools: [],
      toolDescriptions: {},
    } as any;

    const conn = await connectSystemMCP(tempServer);
    if (!conn || !conn.ready) {
      return res.status(500).json({ error: 'Failed to connect to MCP server', tools: [] });
    }

    // Build tool info from connection
    const tools = conn.tools.map(name => ({
      name,
      description: conn.toolDescriptions[name] || '',
    }));

    res.json({ ok: true, tools, toolCount: tools.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Quick setup: discover + save in one step ──────────────────
// POST /api/v1/mcp/setup — discover tools and create server record
router.post('/setup', ownerOnly, async (req, res) => {
  try {
    const { name, displayName, description, command, args, env, remoteUrl, transportType } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const exists = await MCPServer.findOne({ name });
    if (exists) return res.status(409).json({ error: 'MCP server name already exists' });

    // Discover tools first
    const tempServer = {
      _id: 'temp',
      command: command || '',
      args: args || [],
      env: env || {},
      transportType: transportType || (remoteUrl ? 'streamable-http' : 'stdio'),
      remoteUrl: remoteUrl || '',
      remoteHeaders: {},
      tools: [],
      toolDescriptions: {},
    } as any;

    let discoveredTools: string[] = [];
    let discoveredDescriptions: Record<string, string> = {};

    try {
      const conn = await connectSystemMCP(tempServer);
      if (conn && conn.ready) {
        discoveredTools = conn.tools;
        discoveredDescriptions = conn.toolDescriptions;
      }
    } catch {}

    // Save to DB
    const server = await MCPServer.create({
      name,
      displayName: displayName || name,
      description: description || '',
      command: command || '',
      args: args || [],
      env: env || {},
      isEnabled: true,
      isDefault: false,
      tools: discoveredTools,
      toolDescriptions: discoveredDescriptions,
      transportType: transportType || (remoteUrl ? 'streamable-http' : 'stdio'),
      remoteUrl: remoteUrl || '',
      remoteHeaders: {},
      personalFields: [],
      sourcePath: '',
    });

    res.status(201).json({
      server,
      discovered: discoveredTools.length,
      tools: discoveredTools.map(name => ({
        name,
        description: discoveredDescriptions[name] || '',
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Toggle global enable/disable ───────────────────────────────
router.patch('/:id/toggle', ownerOnly, async (req, res) => {
  try {
    const server = await MCPServer.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    server.isEnabled = !server.isEnabled;
    await server.save();
    res.json(server);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Update global env vars (owner only) ────────────────────────
router.patch('/:id', ownerOnly, async (req, res) => {
  try {
    const server = await MCPServer.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    if (server.isDefault && req.body.command !== undefined) {
      return res.status(403).json({ error: 'Cannot edit command of a system MCP' });
    }
    const allowed = ['displayName', 'command', 'args', 'env', 'description', 'transportType', 'remoteUrl', 'remoteHeaders', 'personalFields'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) (server as any)[key] = req.body[key];
    }
    await server.save();
    res.json(server);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id/env', ownerOnly, async (req, res) => {
  try {
    const server = await MCPServer.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    if (req.body.env !== undefined) server.env = req.body.env;
    if (req.body.description !== undefined) server.description = req.body.description;
    await server.save();
    res.json(server);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Delete (only non-default) ──────────────────────────────────
router.delete('/:id', ownerOnly, async (req, res) => {
  try {
    const server = await MCPServer.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    if (server.isDefault) return res.status(403).json({ error: 'Cannot delete a system MCP server' });
    await MCPServer.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Test connection ────────────────────────────────────────────
router.post('/:id/test', ownerOnly, async (req, res) => {
  try {
    const server = await MCPServer.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });

    if (server.transportType === 'streamable-http' || server.transportType === 'sse') {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
        const serverHeaders = server.remoteHeaders instanceof Map ? Object.fromEntries(server.remoteHeaders) : (server.remoteHeaders || {});
        Object.assign(headers, serverHeaders);
        const initMsg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gapat-bot-test', version: '1.0.0' } } });
        const resp = await fetch(server.remoteUrl, { method: 'POST', headers, body: initMsg, signal: AbortSignal.timeout(10000) });
        const data: any = await resp.json();
        await MCPServer.findByIdAndUpdate(server._id, { lastConnectedAt: new Date(), lastError: undefined });
        res.json({ ok: true, result: data.result ? 'Connected' : 'No result' });
      } catch (e: any) {
        await MCPServer.findByIdAndUpdate(server._id, { lastError: e.message?.substring(0, 200) });
        res.json({ ok: false, error: e.message });
      }
      return;
    }

    // stdio — use connectSystemMCP for reliable path resolution
    const conn = await connectSystemMCP(server);
    if (!conn || !conn.ready) {
      await MCPServer.findByIdAndUpdate(server._id, { lastError: 'Failed to connect' });
      return res.json({ ok: false, error: 'Failed to connect to MCP server' });
    }

    await MCPServer.findByIdAndUpdate(server._id, { lastConnectedAt: new Date(), lastError: undefined });
    res.json({ ok: true, tools: conn.tools, toolDescriptions: conn.toolDescriptions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Debug: full MCP test (connect + tools/list + tool call) ──
router.post('/:id/debug', ownerOnly, async (req, res) => {
  try {
    const server = await MCPServer.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });

    const conn = await connectSystemMCP(server);
    if (!conn || !conn.ready) {
      return res.json({ ok: false, error: 'Failed to connect', messages: [], logs: ['Connection failed'] });
    }

    const logs: string[] = [];
    logs.push(`[info] Connected. Tools: ${conn.tools.join(', ')}`);

    // Try calling the first available tool
    let toolResult: string | null = null;
    const firstTool = conn.tools[0];
    if (firstTool) {
      logs.push(`[info] Calling tool: ${firstTool}`);
      try {
        // Build a test call based on tool name
        const testArgs: Record<string, any> = {};
        if (firstTool === 'web_search') { testArgs.query = 'hello world'; testArgs.max_results = 2; }
        else if (firstTool === 'web_fetch') { testArgs.url = 'https://example.com'; }
        toolResult = await callTool(conn, firstTool, testArgs);
        logs.push(`[result] ${toolResult?.substring(0, 500) || 'null'}`);
      } catch (e: any) {
        logs.push(`[error] Tool call failed: ${e.message}`);
      }
    }

    await MCPServer.findByIdAndUpdate(server._id, { lastConnectedAt: new Date(), lastError: undefined });
    res.json({
      ok: true,
      tools: conn.tools,
      toolDescriptions: conn.toolDescriptions,
      toolResult: toolResult?.substring(0, 1000),
      logs,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
