import https from 'https';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
// @ts-ignore
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Provider, IAPIKey, IModelConfig } from '../models/Provider';
import { decrypt, tryDecrypt } from './Encryption';
import { getTodayDate } from '../db';
import { aiLimiter } from './ConcurrencyLimiter';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

function isAllowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_IMAGE_HOSTS.has(u.hostname);
  } catch { return false; }
}

async function urlToDataUri(url: string): Promise<string> {
  if (!isAllowedImageUrl(url)) throw new Error('Image URL not from trusted source');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_IMAGE_SIZE) throw new Error(`Image too large: ${contentLength} bytes`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_SIZE) throw new Error(`Image too large: ${buf.length} bytes`);
    const mime = res.headers.get('content-type') || 'image/png';
    if (!mime.startsWith('image/')) throw new Error(`Invalid image MIME: ${mime}`);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e: any) {
    clearTimeout(timeout);
    throw new Error(`Failed to process image: ${e.message}`);
  }
}

type AIProviderName = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'custom';

// ─── Key Selection ───────────────────────────────────────────────

// ─── Key Selection (optimized for high concurrency) ─────────────

// In-memory round-robin index per provider (avoids DB sort on every call)
const keyRoundRobin = new Map<string, number>();
// Cache provider data for 60 seconds (reduces DB reads under load)
const providerCache = new Map<string, { provider: any; expiry: number }>();
const PROVIDER_CACHE_TTL = 60_000;

async function getCachedProvider(providerName: AIProviderName): Promise<any> {
  const cached = providerCache.get(providerName);
  if (cached && Date.now() < cached.expiry) return cached.provider;
  const provider = await Provider.findOne({ name: providerName, isEnabled: true });
  if (provider) providerCache.set(providerName, { provider, expiry: Date.now() + PROVIDER_CACHE_TTL });
  return provider;
}

async function selectBestKey(providerName: AIProviderName): Promise<{ key: IAPIKey; decrypted: string } | null> {
  const provider = await getCachedProvider(providerName);
  if (!provider || !provider.apiKeys.length) return null;

  const today = getTodayDate();

  // Reset daily usage for keys whose date doesn't match today (once per day)
  const needsReset = provider.apiKeys.some((k: any) => k.isActive && k.dailyUsage?.date !== today);
  if (needsReset) {
    await Provider.updateMany(
      { name: providerName, 'apiKeys.isActive': true, 'apiKeys.dailyUsage.date': { $ne: today } },
      { $set: { 'apiKeys.$.dailyUsage': { date: today, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, isRateLimited: false } } },
    );
    // Invalidate cache after reset
    providerCache.delete(providerName);
    return selectBestKey(providerName);
  }

  const activeKeys = provider.apiKeys.filter((k: any) => {
    if (!k.isActive) return false;
    return !k.dailyUsage?.isRateLimited;
  });

  if (!activeKeys.length) return null;

  // Round-robin selection (avoids DB sort on every call)
  const rrIndex = keyRoundRobin.get(providerName) || 0;
  const candidate = activeKeys[rrIndex % activeKeys.length];
  keyRoundRobin.set(providerName, rrIndex + 1);

  const decrypted = tryDecrypt(candidate.keyEncrypted);
  if (!decrypted) {
    console.error(`[ENCRYPTION] Key ${candidate._id} in "${providerName}" cannot be decrypted — skipping.`);
    await Provider.updateOne(
      { name: providerName, 'apiKeys._id': candidate._id },
      { $inc: { 'apiKeys.$.consecutiveErrors': 1 }, $set: { 'apiKeys.$.lastErrorMessage': 'Decryption failed — wrong ENCRYPTION_KEY', 'apiKeys.$.lastErrorAt': new Date() } },
    );
    // Try next key
    return selectBestKey(providerName);
  }

  // Async update lastUsedAt (don't block the response)
  Provider.updateOne(
    { name: providerName, 'apiKeys._id': candidate._id },
    { $set: { 'apiKeys.$.dailyUsage.lastUsedAt': new Date() } },
  ).catch(() => {});

  return { key: candidate, decrypted };
}

// ─── Fallback Chain ──────────────────────────────────────────────

async function getProviderChain(): Promise<{ name: AIProviderName; priority: number }[]> {
  const providers = await Provider.find({ isEnabled: true }).sort({ priority: 1 });
  return providers.map(p => ({ name: p.name as AIProviderName, priority: p.priority }));
}

// ─── Find Best Model ─────────────────────────────────────────────

async function findBestModel(preferredModel?: string): Promise<{ model: IModelConfig; providerName: AIProviderName } | null> {
  const providers = await Provider.find({ isEnabled: true }).sort({ priority: 1 });

  for (const p of providers) {
    const model = p.models.find(m => m.isEnabled && (!preferredModel || m.id === preferredModel));
    if (model) return { model, providerName: p.name as AIProviderName };
  }

  for (const p of providers) {
    const model = p.models.find(m => m.isEnabled);
    if (model) return { model, providerName: p.name as AIProviderName };
  }

  return null;
}

// ─── Token Estimation ────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ─── Tool Types ──────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ToolExecutor {
  name: string;
  execute: (args: Record<string, any>) => Promise<string>;
}

// ─── Send to Provider ────────────────────────────────────────────

async function sendToProvider(
  providerName: AIProviderName,
  model: string,
  systemPrompt: string | undefined,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number,
  imageUrls?: string[],
  tools?: ToolDefinition[],
  toolExecutors?: ToolExecutor[],
): Promise<{ content: string; totalTokens: number; promptTokens: number; completionTokens: number }> {
  const keyResult = await selectBestKey(providerName);
  if (!keyResult) throw new Error(`No available API key for ${providerName}`);
  const { decrypted: apiKey, key: keyDoc } = keyResult;

  const startTime = Date.now();
  let result: { content: string; totalTokens: number; promptTokens: number; completionTokens: number };

  try {
    switch (providerName) {
      case 'openai':
      case 'openrouter':
      case 'custom': {
        const baseURL = providerName === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : providerName === 'custom'
            ? (await Provider.findOne({ name: 'custom' }))?.baseUrl
            : undefined;

        const clientOpts: any = { apiKey, baseURL };
        if (providerName === 'custom' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
          clientOpts.httpAgent = new https.Agent({ rejectUnauthorized: false });
        }
        const client = new OpenAI(clientOpts);
        const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          const isLast = i === messages.length - 1;
          if (isLast && imageUrls?.length && m.role === 'user') {
            chatMessages.push({
              role: 'user',
              content: [
                { type: 'text', text: m.content },
                ...(await Promise.all(imageUrls.map(async url => ({ type: 'image_url' as const, image_url: { url: await urlToDataUri(url) } })))),
              ],
            });
          } else {
            chatMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
          }
        }

        const createParams: any = {
          model,
          messages: chatMessages,
          max_tokens: maxTokens,
          temperature,
        };
        if (tools?.length) {
          createParams.tools = tools;
          createParams.tool_choice = 'auto';
        }

        let response = await client.chat.completions.create(createParams);
        let choice = response.choices[0];

        while (choice.finish_reason === 'tool_calls' && toolExecutors?.length) {
          chatMessages.push(choice.message as any);
          for (const tc of choice.message.tool_calls || []) {
            const exe = toolExecutors.find(e => e.name === tc.function.name);
            if (exe) {
              try {
                const args = JSON.parse(tc.function.arguments);
                const output = await exe.execute(args);
                chatMessages.push({ role: 'tool', tool_call_id: tc.id, content: output });
              } catch (toolErr: any) {
                chatMessages.push({ role: 'tool', tool_call_id: tc.id, content: `Tool ${tc.function.name} error: ${toolErr.message}` });
              }
            }
          }
          response = await client.chat.completions.create({ ...createParams, messages: chatMessages });
          choice = response.choices[0];
        }

        const rawContent = response.choices[0]?.message?.content || '';
        const finishReason = response.choices[0]?.finish_reason;
        if (!rawContent) {
          console.error(`[AI] Empty content from ${providerName}/${model}, finish_reason=${finishReason}`, JSON.stringify(response.choices[0]?.message).substring(0, 300));
        }
        result = {
          content: rawContent,
          totalTokens: response.usage?.total_tokens || 0,
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
        };
        break;
      }

      case 'anthropic': {
        const client = new Anthropic({ apiKey });
        const anthropicMessages: Anthropic.Messages.MessageParam[] = messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemPrompt || undefined,
          messages: anthropicMessages,
          temperature,
        });

        const content = response.content.map(b => 'text' in b ? b.text : '').join('');
        result = {
          content,
          totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
          promptTokens: response.usage?.input_tokens || 0,
          completionTokens: response.usage?.output_tokens || 0,
        };
        break;
      }

      case 'google': {
        const genAI = new GoogleGenerativeAI(apiKey);
        const geminiModel = genAI.getGenerativeModel({ model });

        const history: { role: string; parts: { text: string }[] }[] = [];
        for (const m of messages) {
          const role = m.role === 'assistant' ? 'model' : 'user';
          history.push({ role, parts: [{ text: m.content }] });
        }

        const chat = geminiModel.startChat({
          history: history.slice(0, -1),
          systemInstruction: systemPrompt ? { role: 'user', parts: [{ text: systemPrompt }] } : undefined,
        });

        const lastMsg = messages[messages.length - 1];
        const response = await chat.sendMessage(lastMsg.content);
        const candidate = response.response;

        result = {
          content: candidate.text(),
          totalTokens: candidate.usageMetadata?.totalTokenCount || 0,
          promptTokens: candidate.usageMetadata?.promptTokenCount || 0,
          completionTokens: candidate.usageMetadata?.candidatesTokenCount || 0,
        };
        break;
      }

      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }

    await Provider.updateOne(
      { name: providerName, 'apiKeys._id': keyDoc._id },
      {
        $inc: {
          'apiKeys.$.dailyUsage.requests': 1,
          'apiKeys.$.dailyUsage.inputTokens': result.promptTokens,
          'apiKeys.$.dailyUsage.outputTokens': result.completionTokens,
          'apiKeys.$.dailyUsage.totalTokens': result.totalTokens,
        },
        $set: {
          'apiKeys.$.dailyUsage.lastUsedAt': new Date(),
          'apiKeys.$.dailyUsage.isRateLimited': false,
          'apiKeys.$.consecutiveErrors': 0,
          'apiKeys.$.lastSuccessAt': new Date(),
        },
      },
    );

    return result;
  } catch (error: any) {
    const isRateLimit = error?.status === 429;
    await Provider.updateOne(
      { name: providerName, 'apiKeys._id': keyDoc._id },
      {
        $inc: { 'apiKeys.$.consecutiveErrors': 1 },
        $set: {
          'apiKeys.$.lastErrorAt': new Date(),
          'apiKeys.$.lastErrorMessage': error?.message || 'Unknown error',
          ...(isRateLimit ? {
            'apiKeys.$.dailyUsage.isRateLimited': true,
            'apiKeys.$.dailyUsage.rateLimitResetAt': new Date(Date.now() + 60000),
          } : {}),
        },
      },
    );
    throw error;
  }
}

// ─── Check Model Vision Support ─────────────────────────────────

async function modelSupportsVision(providerName: string, modelId: string): Promise<boolean> {
  const provider = await Provider.findOne({ name: providerName });
  if (!provider) return false;
  const model = provider.models.find(m => m.id === modelId);
  return model?.supportsVision === true;
}

// ─── Public API ──────────────────────────────────────────────────

export async function generateAIResponse(
  systemPrompt: string | undefined,
  conversationHistory: { role: string; content: string }[],
  userMessage: string,
  imageUrls?: string[],
  preferredModel?: string,
  maxTokens: number = 4096,
  temperature: number = 0.7,
  tools?: ToolDefinition[],
  toolExecutors?: ToolExecutor[],
): Promise<{ content: string; totalTokens: number; model: string; provider: string; modelDisplayName: string; providerDisplayName: string }> {
  // Global concurrency limit — queue if too many concurrent AI calls
  await aiLimiter.acquire();
  try {
    return await _generateAIResponseInner(systemPrompt, conversationHistory, userMessage, imageUrls, preferredModel, maxTokens, temperature, tools, toolExecutors);
  } finally {
    aiLimiter.release();
  }
}

async function _generateAIResponseInner(
  systemPrompt: string | undefined,
  conversationHistory: { role: string; content: string }[],
  userMessage: string,
  imageUrls?: string[],
  preferredModel?: string,
  maxTokens: number = 4096,
  temperature: number = 0.7,
  tools?: ToolDefinition[],
  toolExecutors?: ToolExecutor[],
): Promise<{ content: string; totalTokens: number; model: string; provider: string; modelDisplayName: string; providerDisplayName: string }> {
  const messages = [...conversationHistory, { role: 'user', content: userMessage }];
  const errors: string[] = [];

  async function callProvider(name: AIProviderName, model: string, urls?: string[]) {
    const canVision = urls?.length ? await modelSupportsVision(name, model) : true;
    return sendToProvider(name, model, systemPrompt, messages, maxTokens, temperature, canVision ? urls : undefined, tools, toolExecutors);
  }

  if (preferredModel) {
    const providers = await Provider.find({ isEnabled: true, 'models.id': preferredModel }).sort({ priority: 1 });
    for (const p of providers) {
      try {
        const modelObj = p.models.find(m => m.id === preferredModel);
        return {
          ...(await callProvider(p.name as AIProviderName, preferredModel, imageUrls)),
          model: preferredModel,
          provider: p.name,
          providerDisplayName: p.displayName,
          modelDisplayName: modelObj?.displayName || preferredModel,
        };
      } catch (e: any) {
        errors.push(`${p.name}/${preferredModel}: ${e.message}`);
      }
    }
  }

  const chain = await getProviderChain();
  for (const { name } of chain) {
    const provider = await Provider.findOne({ name });
    if (!provider) continue;
    const enabledModels = provider.models.filter(m => m.isEnabled);
    if (!enabledModels.length) continue;
    const modelToUse = preferredModel && enabledModels.find(m => m.id === preferredModel)
      ? preferredModel
      : enabledModels[0].id;
    const modelObj = provider.models.find(m => m.id === modelToUse);

    try {
      return {
        ...(await callProvider(name, modelToUse, imageUrls)),
        model: modelToUse,
        provider: name,
        providerDisplayName: provider.displayName,
        modelDisplayName: modelObj?.displayName || modelToUse,
      };
    } catch (e: any) {
      errors.push(`${name}/${modelToUse}: ${e.message}`);
    }
  }

  throw new Error(`All providers failed:\n${errors.join('\n')}`);
}
