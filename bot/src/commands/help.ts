import {
  SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction,
  ContainerBuilder, TextDisplayBuilder, MessageFlags,
} from 'discord.js';
import { EMOJI, btnEmoji } from '../constants/emoji';
import { checkLogin } from '../services/UserService';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:4567';

const V2 = MessageFlags.IsComponentsV2;
const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const ACCENT = 0x5865F2;

const LOGIN_ROW = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setLabel('Dashboard Login').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK)),
);

export const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show help and information');

function helpContainer() {
  return [
    new ContainerBuilder()
      .setAccentColor(ACCENT)
      .addTextDisplayComponents(td => td.setContent([
        `## ${EMOJI.RAW.AI} Gapat Bot`,
        '-# Multi-provider AI chatbot with conversation memory, rate limiting & web dashboard.',
        '',
        '━━━ **Commands** ━━━',
        '',
        `**${EMOJI.RAW.CROWN} /panel** — *ManageGuild required*`,
        '> Channel setup, edit, remove, list',
        '> Server & user limits, stats, reset',
        '',
        `**${EMOJI.RAW.USER} /me**`,
        '> Daily usage (tokens / requests)',
        '> Memory stats & clear',
        '',
        `**${EMOJI.RAW.HELP} /help**`,
        '> This message',
        '',
        '━━━ **Quick Start** ━━━',
        '',
        '1️⃣ Admin runs `/panel` → **Setup Channel**',
        '2️⃣ Type in that channel to chat with AI',
        '3️⃣ Check usage with `/me`',
        '4️⃣ Full control via Dashboard',
        '',
        `━━━ **Links** ━━━`,
        '',
        `${EMOJI.RAW.LINK} **Dashboard:** ${DASHBOARD_URL}`,
        `-# ${EMOJI.RAW.HELP} Need help? Contact the server owner.`,
      ].join('\n')))
      .addActionRowComponents(ar => ar.setComponents(
        new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK)),
        new ButtonBuilder().setCustomId('help_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji(btnEmoji(EMOJI.RAW.CLOSE)),
      )),
  ];
}

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  await interaction.reply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(td => td.setContent(`${EMOJI.RAW.AI} Loading...`))], flags: V2_EPH });
  const isLogin = await checkLogin(interaction.user.id);
  if (!isLogin) {
    await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(td => td.setContent(`## ${EMOJI.RAW.CLOSE} Not Logged In\nYou must log in via the dashboard first.`)).addActionRowComponents(ar => ar.setComponents(new ButtonBuilder().setLabel('Dashboard Login').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK))))], flags: V2 });
    return;
  }
  await interaction.editReply({ components: helpContainer(), flags: V2 });
}

export async function handleHelpComponent(interaction: ButtonInteraction | ModalSubmitInteraction) {
  if (!interaction.guild) return;

  if (interaction.isButton()) {
    try {
      if (interaction.customId === 'help_close') {
        try { await interaction.deferUpdate(); await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.RAW.CLOSE} Closed`))], flags: V2 }); } catch { }
      }
    } catch (e: any) {
      console.error('help button error:', e);
    }
  }
}
