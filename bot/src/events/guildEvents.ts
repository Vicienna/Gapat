import { Guild } from 'discord.js';
import { Guild as GuildModel } from '../models/Guild';

export async function handleGuildCreate(guild: Guild) {
  await GuildModel.updateOne(
    { guildId: guild.id },
    { $set: { name: guild.name, ownerId: guild.ownerId, isActive: true, joinedAt: new Date() } },
    { upsert: true },
  );
  console.log(`Joined guild: ${guild.name} (${guild.id})`);
}

export async function handleGuildDelete(guild: Guild) {
  await GuildModel.updateOne({ guildId: guild.id }, { $set: { isActive: false, leftAt: new Date() } });
  console.log(`Left guild: ${guild.id}`);
}
