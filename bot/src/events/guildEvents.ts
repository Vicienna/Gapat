import { EmbedBuilder, Guild } from 'discord.js';
import { Guild as GuildModel } from '../models/Guild';

const MIN_MEMBERS = 25;

async function leaveSmallServer(guild: Guild) {
  if (guild.memberCount >= MIN_MEMBERS) return false;
  try {
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner) {
      await owner.send({
        embeds: [new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('Gapat Bot — Leaving Server')
          .setDescription(
            `I'm sorry, but your server **${guild.name}** has **${guild.memberCount} members**, which is below the minimum requirement of **${MIN_MEMBERS} members**.\n\n` +
            'Gapat Bot is designed for communities with at least 25 members to ensure an active and engaging experience for everyone.\n\n' +
            'Feel free to invite me back once your community grows! 🤍'
          )
          .setTimestamp()
        ],
      }).catch(() => {});
    }
    await guild.leave();
    console.log(`Auto-left small server: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);
  } catch {}
  return true;
}

export async function handleGuildCreate(guild: Guild) {
  await GuildModel.updateOne(
    { guildId: guild.id },
    { $set: { name: guild.name, ownerId: guild.ownerId, isActive: true, joinedAt: new Date() } },
    { upsert: true },
  );
  console.log(`Joined guild: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);
  await leaveSmallServer(guild);
}

export async function handleGuildDelete(guild: Guild) {
  await GuildModel.updateOne({ guildId: guild.id }, { $set: { isActive: false, leftAt: new Date() } });
  console.log(`Left guild: ${guild.id}`);
}
