import { Guild } from '../models/Guild';
import { Conversation } from '../models/Conversation';
import { getGlobalSettings } from '../models/GlobalSettings';

function ms(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

export function startConversationCleanup(intervalMs: number = 60 * 60 * 1000) {
  runCleanup();
  setInterval(runCleanup, intervalMs);
}

async function runCleanup() {
  try {
    const now = Date.now();
    const guilds = await Guild.find({ isActive: true });
    const global = await getGlobalSettings();
    let totalDeleted = 0;

    for (const guild of guilds) {
      const retentionDays = guild.useGlobalDefaults
        ? global.memoryRetentionDays
        : guild.memoryRetentionDays;

      if (!retentionDays || retentionDays < 1) continue;

      const cutoff = new Date(now - ms(retentionDays));
      const result = await Conversation.deleteMany({
        guildId: guild.guildId,
        createdAt: { $lt: cutoff },
      });
      totalDeleted += result.deletedCount;
    }

    if (totalDeleted > 0) {
      console.log(`🧹 Cleanup: deleted ${totalDeleted} old conversations`);
    }
  } catch (err) {
    console.error('🧹 Cleanup error:', err);
  }
}
