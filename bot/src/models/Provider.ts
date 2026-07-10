import { Schema, model, Document } from 'mongoose';

export interface IProvider extends Document {
  name: string;
  displayName: string;
  baseUrl?: string;
  isEnabled: boolean;
  priority: number;
  rateLimits?: { requestsPerMinute: number; tokensPerMinute: number };
  models: IModelConfig[];
  apiKeys: IAPIKey[];
  createdBy: string;
}

export interface IModelConfig {
  _id?: string;
  id: string;
  displayName: string;
  provider: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsFunctions: boolean;
  supportsJsonMode: boolean;
  inputCostPer1k: number;
  outputCostPer1k: number;
  isEnabled: boolean;
  allowedKeyIds?: string[];
}

export interface IAPIKey {
  _id?: string;
  keyEncrypted: string;
  label: string;
  isActive: boolean;
  dailyUsage: {
    date: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    lastUsedAt?: Date;
    isRateLimited: boolean;
    rateLimitResetAt?: Date;
  };
  providerLimits?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    requestsPerDay: number;
    tokensPerDay: number;
  };
  consecutiveErrors: number;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
  lastSuccessAt?: Date;
}

const apiKeySubSchema = new Schema<IAPIKey>({
  keyEncrypted: { type: String, required: true },
  label: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  dailyUsage: {
    date: { type: String, default: '' },
    requests: { type: Number, default: 0 },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    lastUsedAt: Date,
    isRateLimited: { type: Boolean, default: false },
    rateLimitResetAt: Date,
  },
  providerLimits: {
    requestsPerMinute: Number,
    tokensPerMinute: Number,
    requestsPerDay: Number,
    tokensPerDay: Number,
  },
  consecutiveErrors: { type: Number, default: 0 },
  lastErrorAt: Date,
  lastErrorMessage: String,
  lastSuccessAt: Date,
}, { timestamps: true });

const modelSubSchema = new Schema<IModelConfig>({
  id: { type: String, required: true },
  displayName: { type: String, required: true },
  provider: { type: String, required: true },
  maxContextTokens: { type: Number, default: 128000 },
  maxOutputTokens: { type: Number, default: 4096 },
  supportsVision: { type: Boolean, default: false },
  supportsFunctions: { type: Boolean, default: false },
  supportsJsonMode: { type: Boolean, default: false },
  inputCostPer1k: { type: Number, default: 0 },
  outputCostPer1k: { type: Number, default: 0 },
  isEnabled: { type: Boolean, default: true },
  allowedKeyIds: [{ type: String }],
}, { timestamps: true });

const providerSchema = new Schema<IProvider>({
  name: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  baseUrl: String,
  isEnabled: { type: Boolean, default: true },
  priority: { type: Number, default: 0 },
  rateLimits: {
    requestsPerMinute: Number,
    tokensPerMinute: Number,
  },
  models: [modelSubSchema],
  apiKeys: [apiKeySubSchema],
  createdBy: { type: String, required: true },
}, { timestamps: true });

export const Provider = model<IProvider>('Provider', providerSchema);
