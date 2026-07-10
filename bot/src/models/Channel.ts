import { Schema, model, Document } from 'mongoose';

export interface IChannel extends Document {
  guildId: string;
  channelId: string;
  channelName: string;
  isEnabled: boolean;
  systemPrompt?: string;
  totalMessages: number;
  totalTokens: number;
  lastUsedAt?: Date;
  createdBy: string;
}

const channelSchema = new Schema<IChannel>({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  channelName: { type: String, required: true },
  isEnabled: { type: Boolean, default: true },
  systemPrompt: String,
  totalMessages: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  lastUsedAt: Date,
  createdBy: { type: String, required: true },
}, { timestamps: true });

channelSchema.index({ guildId: 1, channelId: 1 }, { unique: true });
channelSchema.index({ guildId: 1, isEnabled: 1 });

export const Channel = model<IChannel>('Channel', channelSchema);
