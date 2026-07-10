import { Router } from 'express';
import { authMiddleware } from '../middleware';
import { setLogin, setLogout, checkLogin } from '../../services/UserService';

const router = Router();
router.use(authMiddleware);

router.post('/login', async (req, res) => {
  const { userId, username, avatar } = req.body;
  if (!userId || !username) return res.status(400).json({ error: 'userId and username required' });
  await setLogin(userId, { username, avatar });
  res.json({ success: true });
});

router.post('/logout', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  await setLogout(userId);
  res.json({ success: true });
});

router.get('/:userId/check', async (req, res) => {
  const loggedIn = await checkLogin(req.params.userId);
  res.json({ isLogin: loggedIn });
});

export default router;
