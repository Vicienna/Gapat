import { Router } from 'express';
import { GlobalSettings, getGlobalSettings } from '../../models/GlobalSettings';
import { Guild } from '../../models/Guild';
import { Cooldown, setCooldown, setCooldownAll } from '../../models/Cooldown';
import { authMiddleware, ownerOnly } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const settings = await getGlobalSettings();
  res.json(settings);
});

router.patch('/', async (req, res) => {
  const updates = req.body;
  delete updates._id;
  delete updates.updatedAt;

  const old = await getGlobalSettings();
  const oldValues: Record<string, any> = {};
  const changedKeys: string[] = [];

  for (const key of Object.keys(updates)) {
    if ((old as any)[key] !== undefined && (old as any)[key] !== updates[key]) {
      oldValues[key] = (old as any)[key];
      changedKeys.push(key);
    }
  }

  updates.updatedAt = new Date();

  const settings = await GlobalSettings.findOneAndUpdate(
    {},
    { $set: updates },
    { new: true, upsert: true },
  );
  if (!settings) return res.status(500).json({ error: 'Failed to update' });

  const limitKeys = ['dailyTokenLimit', 'dailyRequestLimit', 'perResponseTokenLimit', 'maxChannelsPerServer', 'maxContextTokensPercent', 'memoryRetentionDays', 'temperature', 'responseLanguage', 'showUsageFooter'];
  const shouldPropagate = changedKeys.some(k => limitKeys.includes(k));

  res.json({ settings, changedKeys, oldValues, propagated: shouldPropagate });
});

router.post('/propagate', async (req, res) => {
  const settings = await getGlobalSettings();
  const result = await Guild.updateMany(
    { isActive: true },
    {
      $set: {
        dailyTokenLimit: settings.dailyTokenLimit,
        dailyRequestLimit: settings.dailyRequestLimit,
        perResponseTokenLimit: settings.perResponseTokenLimit,
        maxChannels: settings.maxChannelsPerServer,
        memoryRetentionDays: settings.memoryRetentionDays,
        temperature: settings.temperature,
        responseLanguage: settings.responseLanguage,
        showUsageFooter: settings.showUsageFooter,
      },
    },
  );
  res.json({
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });
});

// ─── Cooldown endpoints ────────────────────────────────────────

// Get all active cooldowns
router.get('/cooldowns', ownerOnly, async (req, res) => {
  const cooldowns = await Cooldown.find({ cooldownUntil: { $gt: new Date() } }).sort({ cooldownUntil: -1 });
  res.json(cooldowns);
});

// Set cooldown for a specific user or all users
router.post('/cooldowns', ownerOnly, async (req, res) => {
  const { userId, seconds } = req.body;
  if (!userId || seconds === undefined) {
    return res.status(400).json({ error: 'userId and seconds are required' });
  }
  if (typeof seconds !== 'number' || seconds < 0) {
    return res.status(400).json({ error: 'seconds must be a non-negative number' });
  }

  const setBy = (req as any).userId || 'dashboard';

  if (userId === 'all') {
    const count = await setCooldownAll(seconds, setBy);
    return res.json({ success: true, message: `Cooldown set to ${seconds}s for all users`, affected: count });
  }

  await setCooldown(userId, seconds, setBy);
  res.json({ success: true, message: `Cooldown set to ${seconds}s for user ${userId}` });
});

// Remove cooldown for a specific user
router.delete('/cooldowns/:userId', ownerOnly, async (req, res) => {
  const { userId } = req.params;
  await Cooldown.deleteOne({ userId });
  res.json({ success: true, message: `Cooldown removed for user ${userId}` });
});

// Get default cooldown setting
router.get('/cooldown-default', async (req, res) => {
  const settings = await getGlobalSettings();
  res.json({ globalCooldownSeconds: settings.globalCooldownSeconds });
});

// Update default cooldown setting
router.patch('/cooldown-default', ownerOnly, async (req, res) => {
  const { globalCooldownSeconds } = req.body;
  if (typeof globalCooldownSeconds !== 'number' || globalCooldownSeconds < 0) {
    return res.status(400).json({ error: 'globalCooldownSeconds must be a non-negative number' });
  }
  const settings = await GlobalSettings.findOneAndUpdate(
    {},
    { $set: { globalCooldownSeconds, updatedAt: new Date() } },
    { new: true, upsert: true },
  );
  res.json({ success: true, globalCooldownSeconds: settings.globalCooldownSeconds });
});

export default router;
