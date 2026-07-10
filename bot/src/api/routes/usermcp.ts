import { Router } from 'express';
import { UserMCP } from '../../models/UserMCP';
import { MCPServer } from '../../models/MCPServer';
import { authMiddleware } from '../middleware';

const router = Router();
router.use(authMiddleware);

// ─── Get system MCPs with user config ────────────────────────────
router.get('/system', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const systemMCPS = await MCPServer.find({ isEnabled: true });
    const userConfigs = await UserMCP.find({ userId, systemMcpId: { $in: systemMCPS.map(s => s._id.toString()) } });
    const configMap = new Map(userConfigs.map(c => [c.systemMcpId, c]));

    const result = systemMCPS.map(s => {
      const userConfig = configMap.get(s._id.toString());
      return {
        ...s.toObject(),
        userEnabled: userConfig?.isEnabled || false,
        personalValues: userConfig?.personalValues instanceof Map
          ? Object.fromEntries(userConfig.personalValues)
          : (userConfig?.personalValues || {}),
        userMcpId: userConfig?._id || null,
      };
    });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Toggle system MCP for user ─────────────────────────────────
router.post('/system/:mcpId/toggle', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const systemMCP = await MCPServer.findById(req.params.mcpId);
    if (!systemMCP) return res.status(404).json({ error: 'System MCP not found' });

    let userMCP = await UserMCP.findOne({ userId, systemMcpId: systemMCP._id.toString() });

    if (userMCP) {
      userMCP.isEnabled = !userMCP.isEnabled;
      await userMCP.save();
    } else {
      userMCP = await UserMCP.create({
        userId,
        systemMcpId: systemMCP._id.toString(),
        isEnabled: true,
        personalValues: {},
      });
    }

    res.json(userMCP);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Save personal values for system MCP ────────────────────────
router.patch('/system/:mcpId/values', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const systemMCP = await MCPServer.findById(req.params.mcpId);
    if (!systemMCP) return res.status(404).json({ error: 'System MCP not found' });

    let userMCP = await UserMCP.findOne({ userId, systemMcpId: systemMCP._id.toString() });
    if (!userMCP) {
      userMCP = await UserMCP.create({
        userId,
        systemMcpId: systemMCP._id.toString(),
        isEnabled: true,
        personalValues: req.body.personalValues || {},
      });
    } else {
      userMCP.personalValues = req.body.personalValues || {};
      await userMCP.save();
    }

    res.json(userMCP);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
