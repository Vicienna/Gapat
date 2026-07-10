import { Schema, model, Document } from 'mongoose';

export interface IGlobalSettings extends Document {
  dailyTokenLimit: number;
  dailyRequestLimit: number;
  perResponseTokenLimit: number;
  maxChannelsPerServer: number;
  maxContextTokensPercent: number;
  memoryRetentionDays: number;
  temperature: number;
  responseLanguage: string;
  showUsageFooter: boolean;
  globalCooldownSeconds: number;
  updatedBy: string;
  updatedAt: Date;
}

const globalSettingsSchema = new Schema<IGlobalSettings>({
  dailyTokenLimit: { type: Number, default: 50000 },
  dailyRequestLimit: { type: Number, default: 100 },
  perResponseTokenLimit: { type: Number, default: 4096 },
  maxChannelsPerServer: { type: Number, default: 10 },
  maxContextTokensPercent: { type: Number, default: 80 },
  memoryRetentionDays: { type: Number, default: 30 },
  temperature: { type: Number, default: 0.7 },
  responseLanguage: { type: String, default: 'id' },
  showUsageFooter: { type: Boolean, default: true },
  globalCooldownSeconds: { type: Number, default: 30 },
  updatedBy: { type: String, default: 'system' },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const GlobalSettings = model<IGlobalSettings>('GlobalSettings', globalSettingsSchema);

export async function getGlobalSettings(): Promise<IGlobalSettings> {
  let settings = await GlobalSettings.findOne();
  if (!settings) {
    settings = await GlobalSettings.create({});
  }
  return settings;
}
