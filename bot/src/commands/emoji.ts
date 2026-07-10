import {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction,
  ContainerBuilder, TextDisplayBuilder, MessageFlags,
} from 'discord.js';
import { EMOJI } from '../constants/emoji';
import fs from 'fs';
import path from 'path';

const EMOJI_DIR = path.resolve(__dirname, '..', '..', 'src', 'assets', 'emoji');
const V2 = MessageFlags.IsComponentsV2;
const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const ACCENT = 0x5865F2;
const GAPAT_PREFIX = 'gapat_';

export const emojiCommand = new SlashCommandBuilder()
  .setName('deploy-emoji')
  .setDescription('Upload emoji images to this server as custom emoji')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions);

export async function handleEmoji(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;

  const dir = EMOJI_DIR;
  if (!fs.existsSync(dir)) {
    await interaction.reply({ flags: V2_EPH, components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.CLOSE} Folder \`assets/emoji/\` not found. Run \`npm run generate-emoji\` first.`))] });
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  if (!files.length) {
    await interaction.reply({ flags: V2_EPH, components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.CLOSE} No PNG files found in \`assets/emoji/\`. Run \`npm run generate-emoji\` first.`))] });
    return;
  }

  console.log(`[deploy-emoji] Starting: ${files.length} emoji for guild ${interaction.guild.name}`);

  await interaction.reply({ flags: V2_EPH, components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.AI} Deploy Emoji — ${files.length} emoji...`))] });

  await interaction.guild.emojis.fetch();

  const existingGapat = interaction.guild.emojis.cache.filter(e => e.name && e.name.startsWith(GAPAT_PREFIX));
  let deleted = 0;
  if (existingGapat.size > 0) {
    for (const e of existingGapat.values()) {
      try { await e.delete(`Redeploy by ${interaction.user.tag}`); deleted++; } catch {}
    }
    console.log(`[deploy-emoji] Deleted ${deleted} existing gapat_ emojis`);
  }

  const BATCH = 5;
  const DELAY_MS = 1500;
  let created = 0, failed = 0;
  const errors: string[] = [];
  const createdRefs = new Map<string, any>();

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);

    for (const file of batch) {
      const name = path.basename(file, '.png').replace(/[^a-zA-Z0-9_]/g, '_');

      try {
        const buffer = fs.readFileSync(path.join(dir, file));
        const newEmoji = await interaction.guild.emojis.create({
          attachment: buffer,
          name,
          reason: `Deployed by ${interaction.user.tag}`,
        });
        createdRefs.set(name, newEmoji);
        created++;
        console.log(`[deploy-emoji] ✓ ${name} (${newEmoji.id})`);
      } catch (e: any) {
        failed++;
        errors.push(`${name}: ${e.message}`);
        console.error(`[deploy-emoji] ✗ ${name}: ${e.message}`);
      }
    }

    const done = Math.min(i + BATCH, files.length);
    const remaining = files.length - done;
    if (remaining > 0) {
      await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.AI} ${done}/${files.length} — ${EMOJI.CHECK} ${created}  ${EMOJI.CLOSE} ${failed}  (${remaining} remaining...)`))], flags: V2 }).catch(() => {});
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  let summary = `## ${EMOJI.CHECK} Deploy Emoji Complete\n\n`;
  summary += `**📁 File:** ${files.length}  ·  **${EMOJI.CHECK} New:** ${created}  ·  **${EMOJI.TRASH} Deleted:** ${deleted}  ·  **${EMOJI.CLOSE} Failed:** ${failed}\n`;
  const deployedNames = files.map(f => path.basename(f, '.png').replace(/[^a-zA-Z0-9_]/g, '_'));
  const deployedEmojis = deployedNames.map(n => createdRefs.get(n)).filter((e): e is NonNullable<typeof e> => !!e);

  if (deployedEmojis.length) {
    summary += `\n━━━ **💯 Reference — Copy paste this** ━━━\n\n`;
    for (const e of deployedEmojis) {
      summary += `<:${e.name}:${e.id}>  →  \`${e.name}\`  \`${e.id}\`\n`;
    }
    summary += `\n-# Format: <:name:ID>  |  Name only: \`:name:\``;
  }

  if (errors.length) {
    summary += `\n\n**Error:**\n`;
    for (const err of errors.slice(0, 5)) summary += `- ${err}\n`;
    if (errors.length > 5) summary += `- ...and ${errors.length - 5} more\n`;
  }

  console.log(`[deploy-emoji] Done: ${created} created, ${deleted} deleted, ${failed} failed`);

  const closeBtn = new ButtonBuilder().setCustomId('emoji_close').setLabel(`${EMOJI.CLOSE} Close`).setStyle(ButtonStyle.Danger);

  await interaction.editReply({
    components: [new ContainerBuilder()
      .setAccentColor(ACCENT)
      .addTextDisplayComponents(t => t.setContent(summary))
      .addActionRowComponents(ar => ar.setComponents(closeBtn))],
    flags: V2,
  });
}
