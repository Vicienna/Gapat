import { Schema, model, Document } from 'mongoose';

export interface IGuild extends Document {
  guildId: string;
  name: string;
  icon?: string;
  ownerId: string;
  dailyTokenLimit: number;
  dailyRequestLimit: number;
  perResponseTokenLimit: number;
  maxChannels: number;
  memoryRetentionDays: number;
  temperature: number;
  showUsageFooter: boolean;
  responseLanguage: string;
  useGlobalDefaults: boolean;
  isActive: boolean;
  isBanned: boolean;
  bannedAt?: Date;
  bannedReason?: string;
  joinedAt: Date;
  leftAt?: Date;
}

const guildSchema = new Schema<IGuild>({
  guildId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  icon: String,
  ownerId: { type: String, required: true },
  dailyTokenLimit: { type: Number, default: 50000 },
  dailyRequestLimit: { type: Number, default: 100 },
  perResponseTokenLimit: { type: Number, default: 4096 },
  maxChannels: { type: Number, default: 10 },
  memoryRetentionDays: { type: Number, default: 30 },
  temperature: { type: Number, default: 0.7 },
  showUsageFooter: { type: Boolean, default: true },
  responseLanguage: { type: String, default: 'id' },
  useGlobalDefaults: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  isBanned: { type: Boolean, default: false },
  bannedAt: Date,
  bannedReason: String,
  joinedAt: { type: Date, default: Date.now },
  leftAt: Date,
}, { timestamps: true });

export const Guild = model<IGuild>('Guild', guildSchema);
