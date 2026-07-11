import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
import { Client, GatewayIntentBits, Events, ActivityType, EmbedBuilder, ContainerBuilder, MessageFlags } from 'discord.js';
import { connectDB } from './db';
import { encrypt } from './services/Encryption';
import { Provider } from './models/Provider';
import { MCPServer } from './models/MCPServer';
import { Channel } from './models/Channel';
import { getServersToLeave, clearLeaveTimer } from './models/Broadcast';
import { EMOJI } from './constants/emoji';
import { handlePanel, handlePanelComponent } from './commands/panel';
import { handleMe, handleMeComponent, handleMeModal } from './commands/me';
import { handleHelp, handleHelpComponent } from './commands/help';
import { handleMessage } from './events/messageCreate';
import { handleGuildCreate, handleGuildDelete } from './events/guildEvents';
import { createApiServer } from './api/server';
import { startConversationCleanup } from './services/ConversationCleanup';
import { disconnectAll as disconnectMCP } from './services/MCPClient';
import { scanMCPDirectory } from './services/MCPScanner';

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ ANTI-CRASH: Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error, origin) => {
  console.error('❌ ANTI-CRASH: Uncaught Exception:', error, origin);
});

async function seedProviders() {
  const existingCount = await Provider.countDocuments();
  if (existingCount > 0) return;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    await Provider.create({
      name: 'openai',
      displayName: 'OpenAI',
      isEnabled: true,
      priority: 0,
      createdBy: 'system',
      models: [
        { id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', maxContextTokens: 128000, maxOutputTokens: 16384, supportsVision: true, supportsFunctions: true, supportsJsonMode: true, inputCostPer1k: 2.5, outputCostPer1k: 10, isEnabled: true },
        { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai', maxContextTokens: 128000, maxOutputTokens: 16384, supportsFunctions: true, supportsJsonMode: true, inputCostPer1k: 0.15, outputCostPer1k: 0.6, isEnabled: true },
      ],
      apiKeys: [{
        keyEncrypted: encrypt(openaiKey),
        label: 'Default',
        isActive: true,
        dailyUsage: { date: '', requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, isRateLimited: false },
        consecutiveErrors: 0,
      }],
    });
    console.log('✔ Seeded OpenAI provider from OPENAI_API_KEY');
  }

  const customExists = await Provider.findOne({ name: 'custom' });
  if (!customExists) {
    await Provider.create({
      name: 'custom',
      displayName: 'Custom (Ollama)',
      baseUrl: 'http://localhost:11434/v1',
      isEnabled: true,
      priority: 10,
      createdBy: 'system',
      models: [
        { id: 'llama3', displayName: 'Llama 3', provider: 'custom', maxContextTokens: 8192, maxOutputTokens: 4096, supportsVision: false, supportsFunctions: false, supportsJsonMode: false, inputCostPer1k: 0, outputCostPer1k: 0, isEnabled: true },
        { id: 'mistral', displayName: 'Mistral', provider: 'custom', maxContextTokens: 8192, maxOutputTokens: 4096, supportsVision: false, supportsFunctions: false, supportsJsonMode: false, inputCostPer1k: 0, outputCostPer1k: 0, isEnabled: true },
      ],
      apiKeys: [{
        keyEncrypted: encrypt('ollama'),
        label: 'Default',
        isActive: true,
        dailyUsage: { date: '', requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, isRateLimited: false },
        consecutiveErrors: 0,
      }],
    });
    console.log('✔ Seeded default Custom (Ollama) provider');
  }
}

async function seedMCPServers() {
  const correctPath = require('path').resolve(__dirname, '..', 'mcp-servers', 'ddg-search', 'ddg_search.py');
  const ddgExists = await MCPServer.findOne({ name: 'ddg-search' });
  if (!ddgExists) {
    await MCPServer.create({
      name: 'ddg-search',
      displayName: 'DuckDuckGo Search',
      command: 'python3',
      args: [correctPath],
      isEnabled: true,
      isDefault: true,
      description: 'DuckDuckGo web search — built-in MCP server for searching the web without an API key.',
      tools: ['web_search', 'web_fetch'],
      transportType: 'stdio',
      personalFields: [],
    });
    console.log('✔ Seeded default MCP server: ddg-search');
  } else if (ddgExists.args?.[0] !== correctPath) {
    // Fix stale path
    ddgExists.args = [correctPath];
    await ddgExists.save();
    console.log('✔ Fixed ddg-search path to: ' + correctPath);
  }
}

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('DISCORD_TOKEN missing'); process.exit(1); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err.message, err.stack);
});

client.on('error', (err) => {
  console.error('⚠️ Client error:', err.message);
});

client.once(Events.ClientReady, async (c) => {
  try {
  console.log(`✅ Gapat Bot online as ${c.user.username}`);
  console.log(`Logged in as ${c.user.tag}`);
  await seedProviders();
  await seedMCPServers();

  // Check if Python is available for MCP servers
  try {
    const { execSync } = require('child_process');
    const pythonVersion = execSync('python3 --version', { timeout: 5000 }).toString().trim();
    console.log(`✔ Python available: ${pythonVersion}`);
  } catch {
    console.warn('⚠️  Python3 not found — MCP servers requiring Python will not work.');
    console.warn('   Install Python3 or add to render.yaml: PYTHON_VERSION=3.11');
  }

  // Auto-scan mcp-servers directory for new MCPs
  try {
    const scanResult = await scanMCPDirectory();
    if (scanResult.added.length || scanResult.errors.length) {
      console.log(`✔ MCP scan: ${scanResult.added.length} added, ${scanResult.updated.length} updated`);
      if (scanResult.errors.length) console.log(`  Errors: ${scanResult.errors.join('; ')}`);
    }
  } catch (e: any) {
    console.error('MCP scan failed:', e.message);
  }
  startConversationCleanup();
  await c.user.setPresence({
    activities: [{ name: '/help', type: ActivityType.Listening }],
    status: 'online',
  });

  // Startup log: send server stats to configured channel
  const logChannelId = process.env.STARTUP_LOG_CHANNEL;
  if (logChannelId) {
    try {
      const channel = await client.channels.fetch(logChannelId).catch(() => null);
      if (channel?.isTextBased() && 'send' in channel) {
        const guilds = client.guilds.cache;
        let totalMembers = 0;
        const topGuilds: { name: string; members: number; owner: string }[] = [];
        for (const g of guilds.values()) {
          totalMembers += g.memberCount;
          if (topGuilds.length < 20) {
            const owner = await g.fetchOwner().catch(() => null);
            topGuilds.push({ name: g.name, members: g.memberCount, owner: owner?.user.username || '?' });
          }
        }
        topGuilds.sort((a, b) => b.members - a.members);
        const list = topGuilds.map(g => `**${g.name}** — ${g.members} members (owner: ${g.owner})`).join('\n');
        await channel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle('🟢 Gapat Bot Online')
            .setDescription(`**${guilds.size}** servers · **${totalMembers}** total members\n\n${list}${guilds.size > 20 ? `\n\n*...and ${guilds.size - 20} more*` : ''}`)
            .setTimestamp()
          ],
        });
      }
    } catch {}
  }

  // Check existing servers — leave small ones (<25 members)
  const MIN_MEMBERS = 25;
  const smallServers = [...client.guilds.cache.values()].filter(g => g.memberCount < MIN_MEMBERS);
  for (const g of smallServers) {
    try {
      const guild = client.guilds.cache.get(g.id);
      if (!guild) continue;
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
      console.log(`[Startup] Auto-left small server: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));
    } catch {}
  }

  // Auto-leave: check every hour for servers that haven't been set up within 24 hours
  setInterval(async () => {
    try {
      const servers = await getServersToLeave();
      for (const { guildId } of servers) {
        const channelCount = await Channel.countDocuments({ guildId, isEnabled: true });
        if (channelCount === 0) {
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            console.log(`[AutoLeave] Leaving guild ${guildId} (${guild.name}) — not set up within 24h`);
            try { await guild.leave(); } catch (e: any) { console.error(`[AutoLeave] Failed to leave ${guildId}:`, e.message); }
          }
        } else {
          // Server got configured, clear the leave timer
          await clearLeaveTimer(guildId);
        }
      }
    } catch (e: any) {
      console.error('[AutoLeave] Check failed:', e.message);
    }
  }, 60 * 60 * 1000); // every hour
  } catch (e) {
    console.error('⚠️ ClientReady handler crashed:', e instanceof Error ? e.message : e);
  }
});

client.on(Events.GuildCreate, handleGuildCreate);
client.on(Events.GuildDelete, handleGuildDelete);

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'panel': await handlePanel(interaction); break;
        case 'me': await handleMe(interaction); break;
        case 'help': await handleHelp(interaction); break;
      }
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('panel_')) await handlePanelComponent(interaction);
      else if (interaction.customId.startsWith('me_')) await handleMeComponent(interaction);
      else if (interaction.customId.startsWith('help_')) await handleHelpComponent(interaction);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('panel_')) await handlePanelComponent(interaction);
      else if (interaction.customId.startsWith('me_')) await handleMeModal(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (!interaction.isAutocomplete()) {
      const errMsg = `${EMOJI.CLOSE} An internal error occurred.`;
      const errCmp = [new ContainerBuilder().setAccentColor(0x5865F2).addTextDisplayComponents(t => t.setContent(errMsg))];
      const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
      try {
        if (interaction.deferred) await interaction.editReply({ components: errCmp, flags: MessageFlags.IsComponentsV2 });
        else if (interaction.replied) await interaction.followUp({ components: errCmp, flags: V2_EPH });
        else await interaction.reply({ components: errCmp, flags: V2_EPH });
      } catch { }
    }
  }
});

client.on(Events.MessageCreate, handleMessage);

const { app, port } = createApiServer(client);

app.get('/api/v1/me/guilds', (req: any, res: any) => {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || req.headers['x-api-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ guildIds: [...client.guilds.cache.keys()] });
});

async function start() {
  await connectDB().catch(err => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`API server running on port ${port}`);
  });

  client.login(token).catch(err => {
    console.error('Login failed:', err);
    process.exit(1);
  });
}

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully...`);
  try { disconnectMCP(); } catch {}
  try { client.destroy(); } catch { }
  try { const mongoose = await import('mongoose'); await mongoose.default.disconnect(); } catch { }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
