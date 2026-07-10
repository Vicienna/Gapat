import { Schema, model, Document } from 'mongoose';

export interface IAuditLog extends Document {
  guildId?: string;
  userId: string;
  action: string;
  targetType: 'channel' | 'user' | 'guild' | 'global' | 'provider';
  targetId?: string;
  oldValue?: any;
  newValue?: any;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  guildId: String,
  userId: { type: String, required: true },
  action: { type: String, required: true },
  targetType: { type: String, enum: ['channel', 'user', 'guild', 'global', 'provider'], required: true },
  targetId: String,
  oldValue: Schema.Types.Mixed,
  newValue: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ guildId: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
