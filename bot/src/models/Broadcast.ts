import { Schema, model, Document } from 'mongoose';

export interface IBroadcast extends Document {
  // Track users who received the broadcast message (global, once per user)
  userId: string;
  receivedAt: Date;

  // Track servers that received the broadcast
  guildId: string;
  broadcastSentAt: Date;

  // Track 24-hour auto-leave timer per server
  leaveTimerStartedAt?: Date;
  leaveScheduledFor?: Date;
}

const broadcastSchema = new Schema<IBroadcast>({
  userId: { type: String, required: true },
  receivedAt: { type: Date, default: Date.now },
  guildId: { type: String, required: true },
  broadcastSentAt: { type: Date, default: Date.now },
  leaveTimerStartedAt: Date,
  leaveScheduledFor: Date,
}, { timestamps: true });

// One broadcast record per user per server
broadcastSchema.index({ userId: 1, guildId: 1 }, { unique: true });
// Index for finding servers that need to leave
broadcastSchema.index({ leaveScheduledFor: 1 });

export const Broadcast = model<IBroadcast>('Broadcast', broadcastSchema);

// Check if user has received broadcast in a specific server
export async function hasReceivedBroadcast(userId: string, guildId: string): Promise<boolean> {
  const record = await Broadcast.findOne({ userId, guildId });
  return !!record;
}

// Mark user as having received broadcast
export async function markBroadcastReceived(userId: string, guildId: string): Promise<void> {
  await Broadcast.findOneAndUpdate(
    { userId, guildId },
    { receivedAt: new Date(), broadcastSentAt: new Date() },
    { upsert: true },
  );
}

// Start 24-hour auto-leave timer for a server (if not already started)
export async function startLeaveTimer(guildId: string): Promise<{ started: boolean; remainingMs: number }> {
  const existing = await Broadcast.findOne({ guildId, leaveTimerStartedAt: { $exists: true } });
  if (existing) {
    const remaining = existing.leaveScheduledFor!.getTime() - Date.now();
    return { started: false, remainingMs: Math.max(0, remaining) };
  }

  const now = new Date();
  const leaveAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  await Broadcast.updateOne(
    { guildId },
    { $set: { leaveTimerStartedAt: now, leaveScheduledFor: leaveAt } },
    { upsert: true },
  );
  return { started: true, remainingMs: 24 * 60 * 60 * 1000 };
}

// Get servers that need to leave (24 hours passed, no channels setup)
export async function getServersToLeave(): Promise<{ guildId: string; leaveScheduledFor: Date }[]> {
  const now = new Date();
  const records = await Broadcast.find({
    leaveScheduledFor: { $exists: true, $lte: now },
  }).distinct('guildId');

  const result: { guildId: string; leaveScheduledFor: Date }[] = [];
  for (const guildId of records) {
    const record = await Broadcast.findOne({ guildId, leaveScheduledFor: { $exists: true } });
    if (record) {
      result.push({ guildId, leaveScheduledFor: record.leaveScheduledFor! });
    }
  }
  return result;
}

// Clear leave timer (when server gets setup)
export async function clearLeaveTimer(guildId: string): Promise<void> {
  await Broadcast.updateMany(
    { guildId },
    { $unset: { leaveTimerStartedAt: '', leaveScheduledFor: '' } },
  );
}
