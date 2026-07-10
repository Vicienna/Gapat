import { Router } from 'express';
import { Conversation } from '../../models/Conversation';
import { Channel } from '../../models/Channel';
import { UserLimit } from '../../models/UserLimit';
import { ServerLimit } from '../../models/ServerLimit';
import { authMiddleware } from '../middleware';

const router = Router();
router.use(authMiddleware);

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
