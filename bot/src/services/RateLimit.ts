import { Guild } from '../models/Guild';
import { UserLimit } from '../models/UserLimit';
import { ServerLimit } from '../models/ServerLimit';
import { getTodayDate } from '../db';
import { getGlobalSettings } from '../models/GlobalSettings';

async function getEffectiveLimits(guild: any): Promise<{ dailyTokenLimit: number; dailyRequestLimit: number; perResponseTokenLimit: number }> {
  if (guild.useGlobalDefaults) {
    const global = await getGlobalSettings();
    return {
      dailyTokenLimit: global.dailyTokenLimit,
      dailyRequestLimit: global.dailyRequestLimit,
      perResponseTokenLimit: global.perResponseTokenLimit,
    };
  }
  return {
    dailyTokenLimit: guild.dailyTokenLimit,
    dailyRequestLimit: guild.dailyRequestLimit,
    perResponseTokenLimit: guild.perResponseTokenLimit,
  };
}

export async function checkAndIncrement(
  guildId: string,
  userId: string,
  tokens: number,
  checkOnly = false,
): Promise<{ ok: boolean; reason?: string; limits?: { dailyTokenLimit: number; dailyRequestLimit: number } }> {
  const date = getTodayDate();
  const guild = await Guild.findOne({ guildId });
  if (!guild || guild.isBanned) return { ok: false, reason: 'Server not active or banned.' };

  const { dailyTokenLimit, dailyRequestLimit } = await getEffectiveLimits(guild);

  // Atomic upsert + read for user limit (race-condition safe)
  const userLimit = await UserLimit.findOneAndUpdate(
    { guildId, userId, date },
    { $setOnInsert: { guildId, userId, date, tokensUsed: 0, requestsUsed: 0 } },
    { upsert: true, new: true },
  );

  // Per-user overrides take precedence over guild/global limits
  const effectiveTokenLimit = userLimit.tokenLimitOverride ?? dailyTokenLimit;
  const effectiveRequestLimit = userLimit.requestLimitOverride ?? dailyRequestLimit;

  if (userLimit.tokensUsed + tokens > effectiveTokenLimit) {
    return { ok: false, reason: `Daily token limit (${effectiveTokenLimit.toLocaleString()}) reached. Resets at 00:00 UTC.` };
  }
  if (userLimit.requestsUsed >= effectiveRequestLimit) {
    return { ok: false, reason: `Daily request limit (${effectiveRequestLimit}) reached. Resets at 00:00 UTC.` };
  }

  // Server-wide daily limit check
  const serverLimit = await ServerLimit.findOne({ guildId, date });
  if (serverLimit && serverLimit.totalTokensUsed + tokens > 1_000_000) {
    return { ok: false, reason: '⚠️ **Server-wide token limit reached.** (1,000,000 tokens/day).' };
  }

  if (checkOnly) return { ok: true, limits: { dailyTokenLimit, dailyRequestLimit } };

  // Use $inc (not find-then-create) to avoid race on ServerLimit
  await UserLimit.updateOne(
    { guildId, userId, date },
    { $inc: { tokensUsed: tokens, requestsUsed: 1 }, $set: { lastRequestAt: new Date() } },
    { upsert: true },
  );

  await ServerLimit.updateOne(
    { guildId, date },
    {
      $inc: { totalTokensUsed: tokens, totalRequests: 1 },
      $addToSet: { uniqueUsers: userId },
    },
    { upsert: true },
  );

  return { ok: true, limits: { dailyTokenLimit, dailyRequestLimit } };
}

export async function getUserUsage(guildId: string, userId: string) {
  const date = getTodayDate();
  const guild = await Guild.findOne({ guildId });
  const { dailyTokenLimit, dailyRequestLimit } = guild
    ? await getEffectiveLimits(guild)
    : { dailyTokenLimit: 50000, dailyRequestLimit: 100 };
  const limit = await UserLimit.findOne({ guildId, userId, date });
  return {
    tokensUsed: limit?.tokensUsed || 0,
    requestsUsed: limit?.requestsUsed || 0,
    dailyTokenLimit: limit?.tokenLimitOverride ?? dailyTokenLimit,
    dailyRequestLimit: limit?.requestLimitOverride ?? dailyRequestLimit,
    hasOverride: !!(limit?.tokenLimitOverride || limit?.requestLimitOverride),
    date,
  };
}

export async function getServerUsage(guildId: string) {
  const date = getTodayDate();
  const guild = await Guild.findOne({ guildId });
  const { dailyTokenLimit, dailyRequestLimit } = guild
    ? await getEffectiveLimits(guild)
    : { dailyTokenLimit: 50000, dailyRequestLimit: 100 };
  const limit = await ServerLimit.findOne({ guildId, date });
  return {
    totalTokensUsed: limit?.totalTokensUsed || 0,
    totalRequests: limit?.totalRequests || 0,
    uniqueUsers: limit?.uniqueUsers.length || 0,
    dailyTokenLimit,
    dailyRequestLimit,
    date,
  };
}
