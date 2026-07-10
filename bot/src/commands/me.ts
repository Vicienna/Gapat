import {
  SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction,
  TextInputStyle, TextInputBuilder, ModalBuilder,
  LabelBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags,
} from 'discord.js';
import { EMOJI, btnEmoji } from '../constants/emoji';
import { Conversation } from '../models/Conversation';
import { UserLimit } from '../models/UserLimit';
import { getUserUsage } from '../services/RateLimit';
import { getTodayDate } from '../db';
import { checkLogin } from '../services/UserService';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:4567';

const V2 = MessageFlags.IsComponentsV2;
const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const ACCENT = 0x5865F2;

function profileContent(username: string, userId: string, tokensUsed: number, dailyTokenLimit: number, requestsUsed: number, dailyRequestLimit: number, memoryCount: number) {
  const tRatio = dailyTokenLimit > 0 ? Math.min(tokensUsed / dailyTokenLimit, 1) : 0;
  const rRatio = dailyRequestLimit > 0 ? Math.min(requestsUsed / dailyRequestLimit, 1) : 0;
  return [
    `## ${EMOJI.RAW.AI} Your Profile — **${username}**`,
    `-# User ID: \`${userId}\``,
    '',
    `━━ **${EMOJI.RAW.CHART} Usage** ━━`,
    `**Tokens:** ${tokensUsed.toLocaleString()} / ${dailyTokenLimit.toLocaleString()}`,
    `${'█'.repeat(Math.round(tRatio * 10)).padEnd(10, '░')}`,
    `**Requests:** ${requestsUsed} / ${dailyRequestLimit}`,
    `${'█'.repeat(Math.round(rRatio * 10)).padEnd(10, '░')}`,
    `━━ **${EMOJI.RAW.MESSAGE} Memory** ━━`,
    `${memoryCount} message(s) stored`,
  ].join('\n');
}

export const meCommand = new SlashCommandBuilder()
  .setName('me')
  .setDescription('View your profile and usage');

export async function handleMe(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  const gid = interaction.guild.id;

  await interaction.reply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(td => td.setContent(`${EMOJI.RAW.AI} Loading...`))], flags: V2_EPH });

  const isLogin = await checkLogin(interaction.user.id);
  if (!isLogin) {
    await interaction.editReply({
      components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(td => td.setContent(`## ${EMOJI.RAW.CLOSE} Not Logged In\nYou must log in via the dashboard first.`)).addActionRowComponents(ar => ar.setComponents(new ButtonBuilder().setLabel('Dashboard Login').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK))))],
      flags: V2,
    });
    return;
  }

  const uid = interaction.user.id;
  const usage = await getUserUsage(gid, uid);
  const memoryCount = await Conversation.countDocuments({ guildId: gid, userId: uid });

  const { username } = interaction.user;
  const buttons = [
    new ButtonBuilder().setCustomId('me_clear').setLabel('Clear Memory').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.TRASH)),
    new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK)),
    new ButtonBuilder().setCustomId('me_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji(btnEmoji(EMOJI.RAW.CLOSE)),
  ];
  await interaction.editReply({
    components: [new ContainerBuilder()
      .setAccentColor(ACCENT)
      .addTextDisplayComponents(td => td.setContent(profileContent(username, uid, usage.tokensUsed, usage.dailyTokenLimit, usage.requestsUsed, usage.dailyRequestLimit, memoryCount)))
      .addActionRowComponents(ar => ar.setComponents(...buttons))],
    flags: V2,
  });
}

export async function handleMeComponent(interaction: ButtonInteraction | ModalSubmitInteraction) {
  if (!interaction.guild) return;

  if (interaction.isButton()) {
    await handleMeButton(interaction);
  }
}

async function handleMeButton(interaction: ButtonInteraction) {
  const gid = interaction.guild!.id;
  const uid = interaction.user.id;

  try {
    switch (interaction.customId) {
      case 'me_back': {
        const usage = await getUserUsage(gid, uid);
        const memoryCount = await Conversation.countDocuments({ guildId: gid, userId: uid });
        const { username } = interaction.user;
        const buttons = [
          new ButtonBuilder().setCustomId('me_clear').setLabel('Clear Memory').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.TRASH)),
          new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK)),
          new ButtonBuilder().setCustomId('me_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji(btnEmoji(EMOJI.RAW.CLOSE)),
        ];
        await interaction.update({
          components: [new ContainerBuilder()
            .setAccentColor(ACCENT)
            .addTextDisplayComponents(td => td.setContent(profileContent(username, uid, usage.tokensUsed, usage.dailyTokenLimit, usage.requestsUsed, usage.dailyRequestLimit, memoryCount)))
            .addActionRowComponents(ar => ar.setComponents(...buttons))],
          flags: V2,
        });
        break;
      }

      case 'me_clear': {
        const modal = new ModalBuilder()
          .setCustomId('me_clear_modal')
          .setTitle('🧹 Clear Memory')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Confirm')
              .setDescription('Type "yes" to delete all your conversation memory')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId('confirm')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setPlaceholder('yes'),
              ),
          );
        await interaction.showModal(modal);
        break;
      }

      case 'me_close': {
        try { await interaction.deferUpdate(); await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.RAW.CLOSE} Closed`))], flags: V2 }); } catch { }
        break;
      }
    }
  } catch (e: any) {
    console.error('me button error:', e);
    try { await interaction.reply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(td => td.setContent(`## ${EMOJI.RAW.CLOSE} Error\nAn error occurred.`)).addActionRowComponents(ar => ar.setComponents(new ButtonBuilder().setCustomId('me_close').setLabel('Close').setEmoji(btnEmoji(EMOJI.RAW.CLOSE)).setStyle(ButtonStyle.Danger)))], flags: V2_EPH }); } catch { }
  }
}

export async function handleMeModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild) return;
  const gid = interaction.guild.id;
  const uid = interaction.user.id;

  try {
    if (interaction.customId === 'me_clear_modal') {
      const confirm = interaction.fields.getTextInputValue('confirm');
      if (confirm !== 'yes') {
        await interaction.reply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(td => td.setContent(`## ${EMOJI.RAW.CLOSE} Error\nConfirmation failed.`)).addActionRowComponents(ar => ar.setComponents(new ButtonBuilder().setCustomId('me_close').setLabel('Close').setEmoji(btnEmoji(EMOJI.RAW.CLOSE)).setStyle(ButtonStyle.Danger)))], flags: V2_EPH });
        return;
      }

      const result = await Conversation.deleteMany({ guildId: gid, userId: uid });
      await UserLimit.deleteOne({ guildId: gid, userId: uid, date: getTodayDate() });

      await interaction.reply({
        components: [new ContainerBuilder()
          .setAccentColor(ACCENT)
          .addTextDisplayComponents(td => td.setContent(`## ${EMOJI.RAW.CHECK} Success\nCleared ${result.deletedCount} messages.`))
          .addActionRowComponents(ar => ar.setComponents(
            new ButtonBuilder().setCustomId('me_back').setLabel('Back to Profile').setEmoji(btnEmoji(EMOJI.RAW.BACK)).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('me_close').setLabel('Close').setEmoji(btnEmoji(EMOJI.RAW.CLOSE)).setStyle(ButtonStyle.Danger),
          ))],
        flags: V2_EPH,
      });
    }
  } catch (e: any) {
    console.error('me modal error:', e);
    try { await interaction.reply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(td => td.setContent(`## ${EMOJI.RAW.CLOSE} Error\nAn error occurred.`)).addActionRowComponents(ar => ar.setComponents(new ButtonBuilder().setCustomId('me_close').setLabel('Close').setEmoji(btnEmoji(EMOJI.RAW.CLOSE)).setStyle(ButtonStyle.Danger)))], flags: V2_EPH }); } catch { }
  }
}
