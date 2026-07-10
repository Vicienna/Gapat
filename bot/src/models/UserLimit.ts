import { Schema, model, Document } from 'mongoose';

export interface IUserLimit extends Document {
  guildId: string;
  userId: string;
  date: string;
  tokensUsed: number;
  requestsUsed: number;
  tokenLimitOverride?: number;
  requestLimitOverride?: number;
  lastRequestAt?: Date;
  createdAt: Date;
}

const userLimitSchema = new Schema<IUserLimit>({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  date: { type: String, required: true },
  tokensUsed: { type: Number, default: 0 },
  requestsUsed: { type: Number, default: 0 },
  tokenLimitOverride: { type: Number },
  requestLimitOverride: { type: Number },
  lastRequestAt: Date,
  createdAt: { type: Date, default: Date.now },
});

userLimitSchema.index({ guildId: 1, userId: 1, date: 1 }, { unique: true });
userLimitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172800 });

export const UserLimit = model<IUserLimit>('UserLimit', userLimitSchema);
