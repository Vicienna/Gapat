import { Router } from 'express';
import { Provider } from '../../models/Provider';
import { encrypt, decrypt } from '../../services/Encryption';
import { authMiddleware } from '../middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const providers = await Provider.find().sort({ priority: 1 });
  res.json(providers);
});

router.get('/:id', async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  res.json(provider);
});

router.post('/', async (req, res) => {
  const data = req.body;
  const existing = await Provider.findOne({ name: data.name });
  if (existing) return res.status(400).json({ error: 'Provider already exists' });
  const provider = await Provider.create({ ...data, createdBy: 'dashboard' });
  res.status(201).json(provider);
});

router.patch('/:id', async (req, res) => {
  const updates = req.body;
  delete updates._id;
  const provider = await Provider.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  res.json(provider);
});

router.delete('/:id', async (req, res) => {
  await Provider.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ─── API Keys ────────────────────────────────────────────────────

router.get('/:id/keys', async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const safeKeys = provider.apiKeys.map(k => ({
    _id: k._id,
    label: k.label,
    isActive: k.isActive,
    dailyUsage: k.dailyUsage,
    providerLimits: k.providerLimits,
    consecutiveErrors: k.consecutiveErrors,
    lastErrorAt: k.lastErrorAt,
    lastErrorMessage: k.lastErrorMessage,
    lastSuccessAt: k.lastSuccessAt,
    keyEncrypted: '***encrypted***',
  }));
  res.json(safeKeys);
});

router.post('/:id/keys', async (req, res) => {
  const { label, apiKey, providerLimits } = req.body;
  if (!label || !apiKey) return res.status(400).json({ error: 'label and apiKey required' });
  const encrypted = encrypt(apiKey);
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  provider.apiKeys.push({
    keyEncrypted: encrypted,
    label,
    isActive: true,
    dailyUsage: { date: '', requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, isRateLimited: false },
    providerLimits,
    consecutiveErrors: 0,
  } as any);
  await provider.save();
  const newKey = provider.apiKeys[provider.apiKeys.length - 1];
  res.status(201).json({ _id: newKey._id, label, isActive: true });
});

router.patch('/:id/keys/:keyId', async (req, res) => {
  const updates = req.body;
  const setFields: any = {};
  if (updates.label !== undefined) setFields['apiKeys.$.label'] = updates.label;
  if (updates.isActive !== undefined) setFields['apiKeys.$.isActive'] = updates.isActive;
  if (updates.providerLimits !== undefined) setFields['apiKeys.$.providerLimits'] = updates.providerLimits;
  const provider = await Provider.findOneAndUpdate(
    { _id: req.params.id, 'apiKeys._id': req.params.keyId },
    { $set: setFields },
    { new: true },
  );
  if (!provider) return res.status(404).json({ error: 'Key not found' });
  res.json({ success: true });
});

router.delete('/:id/keys/:keyId', async (req, res) => {
  const provider = await Provider.findByIdAndUpdate(
    req.params.id,
    { $pull: { apiKeys: { _id: req.params.keyId } } },
    { new: true },
  );
  if (!provider) return res.status(404).json({ error: 'Key not found' });
  res.json({ success: true });
});

// ─── Models ──────────────────────────────────────────────────────

router.get('/:id/models', async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  res.json(provider.models);
});

router.post('/:id/models', async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const model = req.body;
  const existing = provider.models.find((m: any) => m.id === model.id);
  if (existing) return res.status(400).json({ error: 'Model already exists' });
  provider.models.push(model);
  await provider.save();
  res.status(201).json(provider.models[provider.models.length - 1]);
});

router.patch('/:id/models/:modelId', async (req, res) => {
  const updates = req.body;
  delete updates._id;
  const setFields: any = {};
  for (const [key, val] of Object.entries(updates)) {
    setFields[`models.$.${key}`] = val;
  }
  const provider = await Provider.findOneAndUpdate(
    { _id: req.params.id, 'models._id': req.params.modelId },
    { $set: setFields },
    { new: true },
  );
  if (!provider) return res.status(404).json({ error: 'Model not found' });
  res.json({ success: true });
});

router.delete('/:id/models/:modelId', async (req, res) => {
  const provider = await Provider.findByIdAndUpdate(
    req.params.id,
    { $pull: { models: { _id: req.params.modelId } } },
    { new: true },
  );
  if (!provider) return res.status(404).json({ error: 'Model not found' });
  res.json({ success: true });
});

export default router;
