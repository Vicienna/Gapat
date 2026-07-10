import {
  SlashCommandBuilder, PermissionFlagsBits,
  ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, AnySelectMenuInteraction,
  TextInputStyle, TextInputBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextChannel, ChannelType,
  ChannelSelectMenuBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  LabelBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
} from 'discord.js';
import { EMOJI, btnEmoji } from '../constants/emoji';
import { Channel } from '../models/Channel';
import { Guild } from '../models/Guild';
import { Conversation } from '../models/Conversation';
import { UserLimit } from '../models/UserLimit';
import { getTodayDate } from '../db';
import { checkLogin } from '../services/UserService';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:4567';
const V2 = MessageFlags.IsComponentsV2;
const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const ACCENT = 0x5865F2;

const BACK_BTN = new ButtonBuilder().setCustomId('panel_back').setLabel('Back to Panel').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.BACK));
const CLOSE_BTN = new ButtonBuilder().setCustomId('panel_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji(btnEmoji(EMOJI.RAW.CLOSE));
const BC_ROW = new ActionRowBuilder<ButtonBuilder>().addComponents(BACK_BTN, CLOSE_BTN);

export const panelCommand = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Server admin panel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function td(text: string) { return new TextDisplayBuilder().setContent(text); }

function errorContainer(text: string) {
  return { components: [new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(t => t.setContent(`## ${EMOJI.RAW.WARNING} Error\n${text}`))
    .addActionRowComponents(ar => ar.setComponents(BACK_BTN, CLOSE_BTN))] };
}

function successContainer(text: string) {
  return { components: [new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(t => t.setContent(`## ${EMOJI.RAW.CHECK} Success\n${text}`))
    .addActionRowComponents(ar => ar.setComponents(BACK_BTN, CLOSE_BTN))] };
}

function mainPanelObj(guildName: string, guildId: string) {
  return [new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(t => t.setContent([
      `## ${EMOJI.RAW.AI} Server Panel`,
      `**${guildName}**`,
      `-# Guild ID: \`${guildId}\``,
    ].join('\n')))
    .addTextDisplayComponents(t => t.setContent(`**${EMOJI.RAW.CHANNEL} Channels**`))
    .addActionRowComponents(ar => ar.setComponents(
      new ButtonBuilder().setCustomId('panel_setup').setLabel('Setup').setStyle(ButtonStyle.Success).setEmoji(btnEmoji(EMOJI.RAW.CHANNEL)),
      new ButtonBuilder().setCustomId('panel_edit').setLabel('Edit').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.EDIT)),
      new ButtonBuilder().setCustomId('panel_list').setLabel('List').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.LIST)),
      new ButtonBuilder().setCustomId('panel_remove').setLabel('Remove').setStyle(ButtonStyle.Danger).setEmoji(btnEmoji(EMOJI.RAW.TRASH)),
    ))
    .addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(t => t.setContent(`**${EMOJI.RAW.SETTINGS} Server**`))
    .addActionRowComponents(ar => ar.setComponents(
      new ButtonBuilder().setCustomId('panel_limits').setLabel('Limits').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.SLIDERS)),
      new ButtonBuilder().setCustomId('panel_user_limits').setLabel('User Limits').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.USERCOG)),
      new ButtonBuilder().setCustomId('panel_stats').setLabel('Stats').setStyle(ButtonStyle.Secondary).setEmoji(btnEmoji(EMOJI.RAW.CHART)),
      new ButtonBuilder().setCustomId('panel_reset_user').setLabel('Reset User').setStyle(ButtonStyle.Danger).setEmoji(btnEmoji(EMOJI.RAW.UNDO)),
    ))
    .addSeparatorComponents(s => s.setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(t => t.setContent(`**${EMOJI.RAW.HOME} Links**`))
    .addActionRowComponents(ar => ar.setComponents(
      new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK)),
      CLOSE_BTN,
    ))];
}

export async function handlePanel(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  const gid = interaction.guild.id;
  await interaction.reply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.RAW.AI} Loading...`))], flags: V2_EPH });
  const isLogin = await checkLogin(interaction.user.id);
  if (!isLogin) {
        await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`## ${EMOJI.RAW.CLOSE} Not Logged In\nYou must log in via the dashboard first.`)).addActionRowComponents(ar => ar.setComponents(new ButtonBuilder().setLabel('Dashboard Login').setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL).setEmoji(btnEmoji(EMOJI.RAW.LINK))))], flags: V2 });
    return;
  }
  const guildConfig = await Guild.findOne({ guildId: gid });
  const name = guildConfig?.name || interaction.guild.name;
  await interaction.editReply({ components: mainPanelObj(name, gid), flags: V2 });
}

export async function handlePanelComponent(interaction: ButtonInteraction | ModalSubmitInteraction | AnySelectMenuInteraction) {
  if (!interaction.guild) return;
  if (interaction.isButton()) {
    await handlePanelButton(interaction);
  } else if (interaction.isModalSubmit()) {
    await handlePanelModal(interaction);
  }
}

async function handlePanelButton(interaction: ButtonInteraction) {
  const gid = interaction.guild!.id;

  try {
    switch (interaction.customId) {
      case 'panel_back': {
        const guild = await Guild.findOne({ guildId: gid });
        const name = guild?.name || interaction.guild!.name;
        await interaction.update({ components: mainPanelObj(name, gid), flags: V2 });
        break;
      }

      case 'panel_setup': {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('panel_setup_modal')
            .setTitle('📢 Setup AI Channel')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('Select channel to activate')
                .setDescription('Only text channels are shown')
                .setChannelSelectMenuComponent(
                  new ChannelSelectMenuBuilder()
                    .setCustomId('channel_id')
                    .setPlaceholder('Select channel...')
                    .setChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
                    .setMinValues(1)
                    .setMaxValues(1),
                ),
              new LabelBuilder()
                .setLabel('Custom Prompt (optional)')
                .setDescription('Leave empty to use the default prompt')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('system_prompt')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setPlaceholder('Leave empty for default')
                    .setMaxLength(2000),
                ),
            ),
        );
        break;
      }

      case 'panel_edit': {
        const channels = await Channel.find({ guildId: gid }).sort({ createdAt: -1 });
        if (!channels.length) {
          await interaction.update(errorContainer('No channels registered yet.'));
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId('channel_id')
          .setPlaceholder('Select channel...')
          .setRequired(true)
          .setMinValues(1)
          .setMaxValues(1)
          .setOptions(
            channels.map(c => new StringSelectMenuOptionBuilder()
              .setLabel(c.channelName || c.channelId)
              .setDescription('true = active, false = inactive')
              .setValue(c.channelId)),
          );

        const modal = new ModalBuilder()
          .setCustomId('panel_edit_modal')
          .setTitle('✏️ Edit AI Channel')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Select channel to edit')
              .setStringSelectMenuComponent(select),
          );

        const first = channels[0];
        if (first) {
          modal.addLabelComponents(
            new LabelBuilder()
              .setLabel('Custom Prompt (opsional)')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId('system_prompt')
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                    .setPlaceholder('Leave empty to keep current')
                  .setMaxLength(2000),
              ),
            new LabelBuilder()
              .setLabel('Enabled?')
              .setDescription('true = active, false = inactive')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId('enabled')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                    .setPlaceholder('Leave empty to keep current')
                  .setMaxLength(5),
              ),
          );
        }

        await interaction.showModal(modal);
        break;
      }

      case 'panel_list': {
        const channels = await Channel.find({ guildId: gid }).sort({ createdAt: -1 });
        if (!channels.length) {
          await interaction.update(errorContainer('No channels registered yet.'));
          return;
        }
        let chContent = `## ${EMOJI.RAW.CHANNEL} AI Channels — ${interaction.guild!.name}\n`;
        for (const ch of channels) {
          const status = ch.isEnabled ? `${EMOJI.RAW.CHECK} Active` : '⛔ Inactive';
          chContent += `\n### <#${ch.channelId}>\n${ch.channelName}  ·  ${status}  ·  ${ch.totalMessages} msgs  ·  ${(ch.totalTokens || 0).toLocaleString()} tokens`;
        }
        chContent += `\n-# Total: ${channels.length} channel(s) registered`;
        await interaction.update({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(chContent)).addActionRowComponents(ar => ar.setComponents(BACK_BTN, CLOSE_BTN))], flags: V2 });
        break;
      }

      case 'panel_remove': {
        const channels = await Channel.find({ guildId: gid }).sort({ createdAt: -1 });
        if (!channels.length) {
          await interaction.update(errorContainer('No channels registered yet.'));
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId('channel_id')
          .setPlaceholder('Select channel...')
          .setRequired(true)
          .setMinValues(1)
          .setMaxValues(1)
          .setOptions(
            channels.map(c => new StringSelectMenuOptionBuilder()
              .setLabel(c.channelName || c.channelId)
              .setDescription('true = active, false = inactive')
              .setValue(c.channelId)),
          );

        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('panel_remove_modal')
            .setTitle('🗑 Hapus AI Channel')
            .addLabelComponents(
              new LabelBuilder()
                .setDescription('Select channel to remove')
                .setStringSelectMenuComponent(select),
              new LabelBuilder()
                .setLabel('Confirm')
                .setDescription('Type "yes" to confirm')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('confirm')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('yes'),
                ),
            ),
        );
        break;
      }

      case 'panel_limits': {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('panel_limits_modal')
            .setTitle('🎯 Server Limits')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('Daily Token Limit (per user)')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('token_limit')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('50000')
                    .setMaxLength(6),
                ),
              new LabelBuilder()
                .setLabel('Daily Request Limit (per user)')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('request_limit')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('100')
                    .setMaxLength(3),
                ),
            ),
        );
        break;
      }

      case 'panel_user_limits': {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('panel_user_limits_modal')
            .setTitle('👤 User Limits')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('User ID')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('user_id')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Discord User ID'),
                ),
              new LabelBuilder()
                .setLabel('Token Limit Override')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('token_limit')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('50000'),
                ),
              new LabelBuilder()
                .setLabel('Request Limit Override')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('request_limit')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('100'),
                ),
            ),
        );
        break;
      }

      case 'panel_stats': {
        const channelCount = await Channel.countDocuments({ guildId: gid });
        const totalMessages = await Conversation.countDocuments({ guildId: gid });
        const tokenAgg = await Conversation.aggregate([
          { $match: { guildId: gid } },
          { $group: { _id: null, total: { $sum: '$tokens' } } },
        ]);
        const totalTokens = tokenAgg[0]?.total || 0;
        const uniqueUsers = await Conversation.distinct('userId', { guildId: gid });
        const guildConfig = await Guild.findOne({ guildId: gid });
        const dailyTokenLimit = guildConfig?.dailyTokenLimit || 50000;
        const dailyRequestLimit = guildConfig?.dailyRequestLimit || 100;
        const tokenRatio = dailyTokenLimit > 0 ? Math.min(totalTokens / dailyTokenLimit, 1) : 0;
        const msgRatio = dailyRequestLimit > 0 ? Math.min(totalMessages / dailyRequestLimit, 1) : 0;
        const tokenBar = '█'.repeat(Math.round(tokenRatio * 10)).padEnd(10, '░');
        const msgBar = '█'.repeat(Math.round(msgRatio * 10)).padEnd(10, '░');

        const statsContent = [
          `## ${EMOJI.RAW.AI} Server Stats — ${interaction.guild!.name}`,
          '',
          `**💬 Active Channels:** ${channelCount}`,
          `**📝 Total Messages:** ${totalMessages.toLocaleString()}`,
          `**🔤 Total Tokens:** ${totalTokens.toLocaleString()}`,
          `**👥 Unique Users:** ${uniqueUsers.length}`,
          '',
          `**📊 Token Usage:** ${tokenBar} ${totalTokens.toLocaleString()}/${dailyTokenLimit.toLocaleString()}`,
          `**📊 Message Usage:** ${msgBar} ${totalMessages}/${dailyRequestLimit}`,
          `-# Daily limit: ${dailyTokenLimit.toLocaleString()} tokens / ${dailyRequestLimit} requests per user`,
        ].join('\n');

        await interaction.update({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(statsContent)).addActionRowComponents(ar => ar.setComponents(BACK_BTN, CLOSE_BTN))], flags: V2 });
        break;
      }

      case 'panel_reset_user': {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('panel_reset_modal')
            .setTitle('🔄 Reset User')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('User ID')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('user_id')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Discord User ID'),
                ),
              new LabelBuilder()
                .setLabel('Confirm')
                .setDescription('Type "yes" to confirm')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('confirm')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('yes'),
                ),
            ),
        );
        break;
      }

      case 'panel_close': {
        try { await interaction.deferUpdate(); await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(t => t.setContent(`${EMOJI.RAW.CLOSE} Closed`))], flags: V2 }); } catch { }
        break;
      }
    }
  } catch (e: any) {
    console.error('panel button error:', e);
    try { await interaction.reply({ flags: V2_EPH, ...errorContainer('An error occurred.') }); } catch { }
  }
}

async function handlePanelModal(interaction: ModalSubmitInteraction) {
  const gid = interaction.guild!.id;
  await interaction.deferReply();

  const er = (t: string) => ({ ...errorContainer(t), flags: V2 }) as const;
  const sr = (t: string) => ({ ...successContainer(t), flags: V2 }) as const;

  try {
    if (interaction.customId === 'panel_setup_modal') {
      const channels = interaction.fields.getSelectedChannels('channel_id', true);
      if (!channels || !channels.size) {
        await interaction.editReply(er('Select a channel first.'));
        return;
      }
      const channelId = channels.first()!.id;
      const systemPrompt = interaction.fields.getTextInputValue('system_prompt').trim() || undefined;

      const channel = await interaction.guild!.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply(er('Invalid channel.'));
        return;
      }

      const existing = await Channel.findOne({ guildId: gid, channelId });
      if (existing) {
        await interaction.editReply(er(`<#${channelId}> is already registered.`));
        return;
      }

      const guildConfig = await Guild.findOne({ guildId: gid }) || await Guild.create({ guildId: gid, name: interaction.guild!.name, ownerId: interaction.guild!.ownerId });
      const enabledCount = await Channel.countDocuments({ guildId: gid, isEnabled: true });
      if (enabledCount >= (guildConfig.maxChannels || 10)) {
        await interaction.editReply(er(`Maximum ${guildConfig.maxChannels} channels.`));
        return;
      }

      const textChannel = channel as TextChannel;
      const me = interaction.guild!.members.me;
      const perms = textChannel.permissionsFor(me!);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks])) {
        await interaction.editReply(er('Bot does not have the required permissions.'));
        return;
      }

      await Channel.create({ guildId: gid, channelId, channelName: textChannel.name, systemPrompt, createdBy: interaction.user.id });
      await interaction.editReply(sr(`<#${channelId}> successfully registered!`));
    } else if (interaction.customId === 'panel_edit_modal') {
      const channelId = interaction.fields.getStringSelectValues('channel_id')[0];
      if (!channelId) {
        await interaction.editReply(er('Select a channel first.'));
        return;
      }
      const systemPrompt = interaction.fields.getTextInputValue('system_prompt');
      const enabledRaw = interaction.fields.getTextInputValue('enabled');

      const existing = await Channel.findOne({ guildId: gid, channelId });
      if (!existing) {
        await interaction.editReply(er('Channel not registered.'));
        return;
      }

      const updates: Record<string, any> = {};
      if (systemPrompt && systemPrompt !== existing.systemPrompt) updates.systemPrompt = systemPrompt;
      if (enabledRaw) updates.isEnabled = enabledRaw === 'true';

      if (!Object.keys(updates).length) {
        await interaction.editReply(er('No changes.'));
        return;
      }

      await Channel.updateOne({ guildId: gid, channelId }, updates);
      await interaction.editReply(sr(`<#${channelId}> successfully updated.`));
    } else if (interaction.customId === 'panel_remove_modal') {
      const channelId = interaction.fields.getStringSelectValues('channel_id')[0];
      if (!channelId) {
        await interaction.editReply(er('Select a channel first.'));
        return;
      }
      const confirm = interaction.fields.getTextInputValue('confirm');

      if (confirm !== 'yes') {
        await interaction.editReply(er('Confirmation failed. Type "yes" to confirm.'));
        return;
      }

      const existing = await Channel.findOne({ guildId: gid, channelId });
      if (!existing) {
        await interaction.editReply(er('Channel not registered.'));
        return;
      }

      await Channel.deleteOne({ guildId: gid, channelId });
      await interaction.editReply(sr(`<#${channelId}> successfully deleted.`));
    } else {
      switch (interaction.customId) {
        case 'panel_limits_modal': {
          const tokenLimit = parseInt(interaction.fields.getTextInputValue('token_limit'));
          const requestLimit = parseInt(interaction.fields.getTextInputValue('request_limit'));

          if (isNaN(tokenLimit) || isNaN(requestLimit) || tokenLimit < 0 || requestLimit < 0) {
            await interaction.editReply(er('Invalid value.'));
            return;
          }

          await Guild.updateOne(
            { guildId: gid },
            { $set: { dailyTokenLimit: Math.min(tokenLimit, 100000), dailyRequestLimit: Math.min(requestLimit, 100) } },
            { upsert: true },
          );
          await interaction.editReply(sr(`Limit updated: ${Math.min(tokenLimit, 100000).toLocaleString()} tokens, ${Math.min(requestLimit, 100)} requests/day.`));
          break;
        }

        case 'panel_user_limits_modal': {
          const userId = interaction.fields.getTextInputValue('user_id');
          const tokenLimit = parseInt(interaction.fields.getTextInputValue('token_limit'));
          const requestLimit = parseInt(interaction.fields.getTextInputValue('request_limit'));

          if (isNaN(tokenLimit) || isNaN(requestLimit)) {
            await interaction.editReply(er('Invalid value.'));
            return;
          }

          const date = getTodayDate();
          const ul = await UserLimit.findOneAndUpdate(
            { guildId: gid, userId, date },
            { $setOnInsert: { guildId: gid, userId, date, tokensUsed: 0, requestsUsed: 0 } },
            { upsert: true, new: true },
          );

          ul.tokenLimitOverride = Math.max(0, tokenLimit);
          ul.requestLimitOverride = Math.max(0, requestLimit);
          await ul.save();

          await interaction.editReply(sr(`User <@${userId}> limit set: ${tokenLimit} tokens, ${requestLimit} requests.`));
          break;
        }

        case 'panel_reset_modal': {
          const userId = interaction.fields.getTextInputValue('user_id');
          const confirm = interaction.fields.getTextInputValue('confirm');

          if (confirm !== 'yes') {
            await interaction.editReply(er('Confirmation failed.'));
            return;
          }

          const date = getTodayDate();
          await UserLimit.deleteOne({ guildId: gid, userId, date });
          await Conversation.deleteMany({ guildId: gid, userId });

          await interaction.editReply(sr(`User <@${userId}> has been reset.`));
          break;
        }
      }
    }
  } catch (e: any) {
    console.error('panel modal error:', e);
    try { await interaction.editReply(er('An error occurred.')); } catch { }
  }
}
