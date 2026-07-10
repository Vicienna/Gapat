import { Schema, model, Document } from 'mongoose';

export interface IConversation {
  guildId: string;
  channelId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens: number;
  modelUsed: string;
  provider: string;
  metadata?: {
    temperature?: number;
    finishReason?: string;
    responseTimeMs?: number;
  };
  createdAt: Date;
}

const conversationSchema = new Schema<IConversation>({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  userId: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  tokens: { type: Number, default: 0 },
  modelUsed: { type: String, required: true },
  provider: { type: String, required: true },
  metadata: {
    temperature: Number,
    finishReason: String,
    responseTimeMs: Number,
  },
  createdAt: { type: Date, default: Date.now },
});

conversationSchema.index({ guildId: 1, channelId: 1, createdAt: -1 });
conversationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

export const Conversation = model<IConversation>('Conversation', conversationSchema);
