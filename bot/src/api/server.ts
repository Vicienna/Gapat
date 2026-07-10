import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { Client } from 'discord.js';
import guildRoutes from './routes/guilds';
import providerRoutes from './routes/providers';
import analyticsRoutes from './routes/analytics';
import globalSettingsRoutes from './routes/globalsettings';
import resetRoutes from './routes/reset';
import authRoutes from './routes/auth';
import mcpRoutes from './routes/mcp';
import userMcpRoutes from './routes/usermcp';

export function createApiServer(client?: Client) {
  const app = express();
  const port = parseInt(process.env.BOT_API_PORT || '3001');

  app.use(helmet());
  const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:4567';
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || origin === dashboardUrl) callback(null, true);
      else callback(null, false);
    },
    credentials: true,
  }));
  app.use(express.json());

  const healthHandler = (req: any, res: any) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      discord: client ? (client.ws.status === 0 ? 'connected' : 'disconnected') : 'unknown',
    });
  };
  app.get('/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  app.use('/api/v1/guilds', guildRoutes);
  app.use('/api/v1/providers', providerRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/globalsettings', globalSettingsRoutes);
  app.use('/api/v1/reset', resetRoutes);
  app.use('/api/v1/users', authRoutes);
  app.use('/api/v1/mcp', mcpRoutes);
  app.use('/api/v1/usermcp', userMcpRoutes);

  return { app, port };
}
