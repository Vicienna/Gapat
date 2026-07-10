import { Schema, model, Document } from 'mongoose';

export interface IBotUser extends Document {
  userId: string;
  username: string;
  avatar?: string;
  isLogin: boolean;
  lastLoginAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const botUserSchema = new Schema<IBotUser>({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  avatar: String,
  isLogin: { type: Boolean, default: false },
  lastLoginAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const BotUser = model<IBotUser>('BotUser', botUserSchema);
