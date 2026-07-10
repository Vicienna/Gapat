import { Schema, model, Document } from 'mongoose';

export interface ICooldown extends Document {
  userId: string;
  cooldownUntil: Date;
  cooldownSeconds: number;
  setBy: string;
  createdAt: Date;
}

const cooldownSchema = new Schema<ICooldown>({
  userId: { type: String, required: true, unique: true },
  cooldownUntil: { type: Date, required: true },
  cooldownSeconds: { type: Number, required: true },
  setBy: { type: String, default: 'system' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

cooldownSchema.index({ cooldownUntil: 1 }, { expireAfterSeconds: 0 });

export const Cooldown = model<ICooldown>('Cooldown', cooldownSchema);

// Check if user is on cooldown
export async function checkCooldown(userId: string): Promise<{ onCooldown: boolean; remainingSeconds: number }> {
  const record = await Cooldown.findOne({ userId });
  if (!record) return { onCooldown: false, remainingSeconds: 0 };

  const now = new Date();
  if (now >= record.cooldownUntil) {
    await Cooldown.deleteOne({ userId });
    return { onCooldown: false, remainingSeconds: 0 };
  }

  const remainingSeconds = Math.ceil((record.cooldownUntil.getTime() - now.getTime()) / 1000);
  return { onCooldown: true, remainingSeconds };
}

// Set cooldown for a user
export async function setCooldown(userId: string, seconds: number, setBy: string = 'system'): Promise<void> {
  if (seconds <= 0) {
    await Cooldown.deleteOne({ userId });
    return;
  }
  const cooldownUntil = new Date(Date.now() + seconds * 1000);
  await Cooldown.findOneAndUpdate(
    { userId },
    { cooldownUntil, cooldownSeconds: seconds, setBy },
    { upsert: true },
  );
}

// Set cooldown for all users
export async function setCooldownAll(seconds: number, setBy: string = 'system'): Promise<number> {
  if (seconds <= 0) {
    const result = await Cooldown.deleteMany({});
    return result.deletedCount;
  }
  const cooldownUntil = new Date(Date.now() + seconds * 1000);
  const result = await Cooldown.updateMany(
    {},
    { cooldownUntil, cooldownSeconds: seconds, setBy },
    { upsert: true },
  );
  return result.modifiedCount;
}
