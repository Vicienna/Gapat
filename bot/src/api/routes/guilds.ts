import { Router } from 'express';
import { Guild } from '../../models/Guild';
import { Channel } from '../../models/Channel';
import { Conversation } from '../../models/Conversation';
import { UserLimit } from '../../models/UserLimit';
import { ServerLimit } from '../../models/ServerLimit';
import { getGlobalSettings } from '../../models/GlobalSettings';
import { authMiddleware } from '../middleware';

const router = Router();
router.use(authMiddleware);

async function enrichGuilds(guilds: any[]) {
  const guildIds = guilds.map(g => g.guildId || g.id).filter(Boolean);
  const counts = await Channel.aggregate([
    { $match: { guildId: { $in: guildIds } } },
    { $group: { _id: '$guildId', count: { $sum: 1 } } },
  ]);
  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c._id] = c.count;

  return guilds.map(g => {
    const obj = g.toObject ? g.toObject() : { ...g };
    const gid = obj.guildId || obj.id;
    obj.channelCount = countMap[gid] || 0;
    obj.status = obj.isBanned ? 'banned' : obj.isActive ? 'active' : 'inactive';
    obj.setupDone = obj.channelCount > 0;
    return obj;
  });
}

router.get('/', async (req, res) => {
  const guilds = await Guild.find({ isActive: true }).sort({ joinedAt: -1 });
  res.json(await enrichGuilds(guilds));
});

router.get('/all', async (req, res) => {
  const guilds = await Guild.find().sort({ joinedAt: -1 });
  res.json(await enrichGuilds(guilds));
});

router.get('/:guildId', async (req, res) => {
  const guild = await Guild.findOne({ guildId: req.params.guildId });
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const enriched = await enrichGuilds([guild]);
  res.json(enriched[0] || guild);
});

router.patch('/:guildId', async (req, res) => {
  const updates: any = req.body;
  delete updates._id;
  delete updates.guildId;

  if (updates.useGlobalDefaults === true) {
    const global = await getGlobalSettings();
    updates.dailyTokenLimit = global.dailyTokenLimit;
    updates.dailyRequestLimit = global.dailyRequestLimit;
    updates.perResponseTokenLimit = global.perResponseTokenLimit;
    updates.maxChannels = global.maxChannelsPerServer;
    updates.memoryRetentionDays = global.memoryRetentionDays;
    updates.temperature = global.temperature;
    updates.responseLanguage = global.responseLanguage;
    updates.showUsageFooter = global.showUsageFooter;
  }

  const guild = await Guild.findOneAndUpdate(
    { guildId: req.params.guildId },
    { $set: updates },
    { new: true },
  );
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const enriched = await enrichGuilds([guild]);
  res.json(enriched[0] || guild);
});

router.get('/:guildId/channels', async (req, res) => {
  const channels = await Channel.find({ guildId: req.params.guildId }).sort({ createdAt: -1 });
  res.json(channels);
});

router.post('/:guildId/channels', async (req, res) => {
  const data = req.body;
  const existing = await Channel.findOne({ guildId: req.params.guildId, channelId: data.channelId });
  if (existing) return res.status(400).json({ error: 'Channel already exists' });
  const channel = await Channel.create({ ...data, guildId: req.params.guildId });
  res.status(201).json(channel);
});

router.patch('/:guildId/channels/:channelId', async (req, res) => {
  const updates = req.body;
  delete updates._id;
  const channel = await Channel.findOneAndUpdate(
    { guildId: req.params.guildId, channelId: req.params.channelId },
    { $set: updates },
    { new: true },
  );
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  res.json(channel);
});

router.delete('/:guildId/channels/:channelId', async (req, res) => {
   await Channel.deleteOne({ guildId: req.params.guildId, channelId: req.params.channelId });
   if (req.query.purge === 'true') {
     await Conversation.deleteMany({ guildId: req.params.guildId, channelId: req.params.channelId });
   }
   res.json({ success: true });
 });

router.delete('/:guildId/channels/:channelId/memory', async (req, res) => {
   await Conversation.deleteMany({ guildId: req.params.guildId, channelId: req.params.channelId });
   await Channel.updateOne(
     { guildId: req.params.guildId, channelId: req.params.channelId },
     { $set: { totalMessages: 0, totalTokens: 0, lastUsedAt: null } }
   );
   res.json({ success: true });
 });

router.get('/:guildId/usage', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [userLimits, conversationAgg] = await Promise.all([
    UserLimit.find({ guildId: req.params.guildId, date: today }),
    Conversation.aggregate([
      { $match: { guildId: req.params.guildId } },
      { $group: { _id: null, totalTokens: { $sum: '$tokens' }, totalMessages: { $sum: 1 }, uniqueUsers: { $addToSet: '$userId' } } },
    ]),
  ]);
  res.json({
    today: { userLimits },
    allTime: (conversationAgg as any[])[0] || { totalTokens: 0, totalMessages: 0, uniqueUsers: [] },
  });
});

router.get('/:guildId/users', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const userLimits = await UserLimit.find({ guildId: req.params.guildId, date: today });
  res.json(userLimits);
});

router.patch('/:guildId/users/:userId/limits', async (req, res) => {
  const { tokensUsed, requestsUsed } = req.body;
  const today = new Date().toISOString().slice(0, 10);
  let ul = await UserLimit.findOne({ guildId: req.params.guildId, userId: req.params.userId, date: today });
  if (!ul) ul = await UserLimit.create({ guildId: req.params.guildId, userId: req.params.userId, date: today });
  if (tokensUsed !== undefined) ul.tokensUsed = Math.max(0, tokensUsed);
  if (requestsUsed !== undefined) ul.requestsUsed = Math.max(0, requestsUsed);
  await ul.save();
  res.json(ul);
});

router.post('/:guildId/users/:userId/reset', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  await UserLimit.deleteOne({ guildId: req.params.guildId, userId: req.params.userId, date: today });
  res.json({ success: true });
});

router.post('/:guildId/users/:userId/clear', async (req, res) => {
  const { channelId } = req.body;
  const query: any = { guildId: req.params.guildId, userId: req.params.userId };
  if (channelId) query.channelId = channelId;
  const result = await Conversation.deleteMany(query);
  res.json({ deleted: result.deletedCount });
});

router.post('/:guildId/reset', async (req, res) => {
  const gid = req.params.guildId;
  const [delConversations, delChannels, delUserLimits, delServerLimits] = await Promise.all([
    Conversation.deleteMany({ guildId: gid }),
    Channel.deleteMany({ guildId: gid }),
    UserLimit.deleteMany({ guildId: gid }),
    ServerLimit.deleteMany({ guildId: gid }),
  ]);
  res.json({
    deleted: {
      conversations: delConversations.deletedCount,
      channels: delChannels.deletedCount,
      userLimits: delUserLimits.deletedCount,
      serverLimits: delServerLimits.deletedCount,
    },
  });
});

router.post('/:guildId/users/:userId/reset-all', async (req, res) => {
  const [delConversations, delUL] = await Promise.all([
    Conversation.deleteMany({ guildId: req.params.guildId, userId: req.params.userId }),
    UserLimit.deleteMany({ guildId: req.params.guildId, userId: req.params.userId }),
  ]);
  res.json({
    deleted: {
      conversations: delConversations.deletedCount,
      userLimits: delUL.deletedCount,
    },
  });
});

export default router;
