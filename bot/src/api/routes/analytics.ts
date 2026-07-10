import { Router } from 'express';
import { Guild } from '../../models/Guild';
import { Channel } from '../../models/Channel';
import { Conversation } from '../../models/Conversation';
import { UserLimit } from '../../models/UserLimit';
import { Provider } from '../../models/Provider';
import { authMiddleware } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/overview', async (req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const [guildCount, channelCount, messageAgg, userAgg, providerCount, messagesByDay, tokensByDay, topGuilds, hourlyDistribution, providerUsage] = await Promise.all([
    Guild.countDocuments({ isActive: true }),
    Channel.countDocuments({ isEnabled: true }),
    Conversation.aggregate([
      { $group: { _id: null, totalTokens: { $sum: '$tokens' }, totalMessages: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $group: { _id: '$guildId', users: { $addToSet: '$userId' } } },
      { $project: { userCount: { $size: '$users' } } },
      { $group: { _id: null, total: { $sum: '$userCount' } } },
    ]),
    Provider.countDocuments({ isEnabled: true }),
    Conversation.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Conversation.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: '$tokens' } } },
      { $sort: { _id: 1 } },
    ]),
    Conversation.aggregate([
      { $group: { _id: '$guildId', messageCount: { $sum: 1 } } },
      { $sort: { messageCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'guilds',
          localField: '_id',
          foreignField: 'guildId',
          as: 'guild',
        },
      },
      { $unwind: { path: '$guild', preserveNullAndEmptyArrays: true } },
      { $project: { _id: '$_id', name: '$guild.name', messageCount: 1 } },
    ]),
    Conversation.aggregate([
      { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Conversation.aggregate([
      { $group: { _id: '$provider', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.json({
    guilds: guildCount,
    channels: channelCount,
    totalTokens: messageAgg[0]?.totalTokens || 0,
    totalMessages: messageAgg[0]?.totalMessages || 0,
    totalUsers: userAgg[0]?.total || 0,
    providers: providerCount,
    messagesByDay: messagesByDay.map((d: any) => ({ date: d._id, count: d.count })),
    tokensByDay: tokensByDay.map((d: any) => ({ date: d._id, count: d.count })),
    topGuilds: topGuilds.map((g: any) => ({ _id: g._id, name: g.name, count: g.messageCount })),
    hourlyDistribution: hourlyDistribution.map((h: any) => ({ _id: h._id, count: h.count })),
    providerUsage: providerUsage.map((p: any) => ({ _id: p._id || 'unknown', count: p.count })),
  });
});

router.get('/guild/:guildId', async (req, res) => {
  const gid = req.params.guildId;
  const [guild, channelCount, messageAgg, userAgg, recentActivity] = await Promise.all([
    Guild.findOne({ guildId: gid }),
    Channel.countDocuments({ guildId: gid }),
    Conversation.aggregate([
      { $match: { guildId: gid } },
      { $group: { _id: null, totalTokens: { $sum: '$tokens' }, totalMessages: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { guildId: gid } },
      { $group: { _id: null, users: { $addToSet: '$userId' } } },
    ]),
    Conversation.aggregate([
      { $match: { guildId: gid, createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, tokens: { $sum: '$tokens' }, messages: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    guild,
    channels: channelCount,
    totalTokens: messageAgg[0]?.totalTokens || 0,
    totalMessages: messageAgg[0]?.totalMessages || 0,
    uniqueUsers: userAgg[0]?.users?.length || 0,
    dailyActivity: recentActivity,
  });
});

export default router;
