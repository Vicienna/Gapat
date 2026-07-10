import { Document, Schema, model } from 'mongoose';

export interface IUserMCP extends Document {
  userId: string;
  systemMcpId: string;
  isEnabled: boolean;
  personalValues: Map<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

const userMCPSchema = new Schema<IUserMCP>({
  userId: { type: String, required: true, index: true },
  systemMcpId: { type: String, required: true },
  isEnabled: { type: Boolean, default: false },
  personalValues: { type: Map, of: String, default: {} },
}, { timestamps: true });

// Compound index for fast lookups
userMCPSchema.index({ userId: 1, systemMcpId: 1 }, { unique: true });

export const UserMCP = model<IUserMCP>('UserMCP', userMCPSchema);
