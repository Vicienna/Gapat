import { Schema, model, Document } from 'mongoose';

export interface IServerLimit extends Document {
  guildId: string;
  date: string;
  totalTokensUsed: number;
  totalRequests: number;
  uniqueUsers: string[];
  createdAt: Date;
}

const serverLimitSchema = new Schema<IServerLimit>({
  guildId: { type: String, required: true },
  date: { type: String, required: true },
  totalTokensUsed: { type: Number, default: 0 },
  totalRequests: { type: Number, default: 0 },
  uniqueUsers: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

serverLimitSchema.index({ guildId: 1, date: 1 }, { unique: true });
serverLimitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

export const ServerLimit = model<IServerLimit>('ServerLimit', serverLimitSchema);
