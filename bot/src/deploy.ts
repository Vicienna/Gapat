import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
import { REST, Routes } from 'discord.js';
import { commands } from './commands/registry';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function deploy() {
  try {
    const allCommands = commands.map(c => c.toJSON());
    console.log(`Registering ${allCommands.length} global commands...`);
    await rest.put(Routes.applicationCommands(clientId!), { body: allCommands });
    console.log('Done!');
  } catch (e) {
    console.error('Deploy failed:', e);
    process.exit(1);
  }
}
deploy();
