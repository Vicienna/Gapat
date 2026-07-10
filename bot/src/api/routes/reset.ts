import { Router } from 'express';
import { Conversation } from '../../models/Conversation';
import { Channel } from '../../models/Channel';
import { UserLimit } from '../../models/UserLimit';
import { ServerLimit } from '../../models/ServerLimit';
import { Broadcast } from '../../models/Broadcast';
import { authMiddleware } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.post('/broadcast/:userId', async (req, res) => {
  const r = await Broadcast.deleteOne({ userId: req.params.userId });
  res.json({ deleted: r.deletedCount });
});

router.post('/all', async (_req, res) => {
  const [delConversations, delChannels, delUserLimits, delServerLimits] = await Promise.all([
    Conversation.deleteMany({}),
    Channel.deleteMany({}),
    UserLimit.deleteMany({}),
    ServerLimit.deleteMany({}),
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

export default router;
