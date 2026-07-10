import { BotUser } from '../models/BotUser';

export async function checkLogin(userId: string): Promise<boolean> {
  const user = await BotUser.findOne({ userId }).lean();
  return user?.isLogin ?? false;
}

export async function setLogin(userId: string, data: { username: string; avatar?: string }): Promise<void> {
  await BotUser.findOneAndUpdate(
    { userId },
    {
      $set: {
        username: data.username,
        avatar: data.avatar,
        isLogin: true,
        lastLoginAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function setLogout(userId: string): Promise<void> {
  await BotUser.findOneAndUpdate(
    { userId },
    { $set: { isLogin: false } },
  );
}
