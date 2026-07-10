require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');

// ─── MongoDB (shared with bot) ────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gapat';
let BotUser;
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Dashboard: MongoDB connected');
    const schema = new mongoose.Schema({
      userId: { type: String, required: true, unique: true, index: true },
      username: { type: String, required: true },
      avatar: String,
      isLogin: { type: Boolean, default: false },
      lastLoginAt: { type: Date, default: Date.now },
    }, { timestamps: true, collection: 'botusers' });
    BotUser = mongoose.model('BotUser', schema);
  } catch (e) {
    console.error('Dashboard: MongoDB connection failed:', e.message);
  }
}
connectDB();

const app = express();
const PORT = process.env.DASHBOARD_PORT || 4567;
if (!process.env.DASHBOARD_SECRET || process.env.DASHBOARD_SECRET.length < 32) {
  console.error('[FATAL] DASHBOARD_SECRET must be set and at least 32 characters long. Refusing to start.');
  process.exit(1);
}
const SECRET = process.env.DASHBOARD_SECRET;
const BOT_API = process.env.BOT_API_URL || `http://localhost:${process.env.BOT_API_PORT || 3001}`;
if (!process.env.INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET.length < 16) {
  console.error('[FATAL] INTERNAL_API_SECRET must be set and at least 16 characters long. Refusing to start.');
  process.exit(1);
}
const API_SECRET = process.env.INTERNAL_API_SECRET;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_OWNER_ID = process.env.DISCORD_OWNER_ID || '';
const DASHBOARD_URL = (process.env.DASHBOARD_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

const DISCORD_REDIRECT_URI = `${DASHBOARD_URL}/api/auth/discord/callback`;

app.use(express.json());
app.use(cookieParser(SECRET));

// ─── View Engine ──────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Auth Helpers ────────────────────────────────────────────────

function signToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.createHmac('sha256', SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(b64).digest('hex');
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  } catch { return null; }
  try { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }
  catch { return null; }
}

function auth(req, res, next) {
  const payload = verifyToken(req.signedCookies?.session || '');
  if (!payload || payload.exp < Date.now()) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login');
  }
  req.user = {
    userId: payload.userId,
    username: payload.username,
    avatar: payload.avatar,
    role: payload.role,
    adminGuilds: payload.adminGuilds || [],
    accessToken: payload.accessToken || null,
  };
  next();
}

// ─── Role-based Access ───────────────────────────────────────────

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return res.redirect('/');
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.redirect('/');
  next();
}

// ─── Static Files ────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// ─── Discord OAuth Routes ────────────────────────────────────────

app.get('/login', (req, res) => {
  const payload = verifyToken(req.signedCookies?.session || '');
  if (payload && payload.exp >= Date.now()) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/api/auth/discord', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
  res.redirect(url);
});

app.get('/api/auth/discord/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');

    // Exchange code for token
    const tokenBody = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: DISCORD_REDIRECT_URI,
    });

    const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('Discord token exchange failed:', errText);
      return res.status(502).send('Failed to exchange code');
    }

    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;

    // Fetch user info
    const userResp = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResp.ok) return res.status(502).send('Failed to fetch user');
    const discordUser = await userResp.json();

    // Fetch user guilds
    const guildsResp = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!guildsResp.ok) return res.status(502).send('Failed to fetch guilds');
    const guilds = await guildsResp.json();

    // Calculate admin guilds
    const MANAGE_GUILD = 0x20;
    const ADMINISTRATOR = 0x8;
    const adminGuilds = (Array.isArray(guilds) ? guilds : [])
      .filter(g => (Number(g.permissions) & (MANAGE_GUILD | ADMINISTRATOR)) !== 0)
      .map(g => g.id);

    // Calculate role (DISCORD_OWNER_ID from ENV, read fresh)
    const userId = discordUser.id;
    const currentOwnerId = process.env.DISCORD_OWNER_ID || '';
    const role = userId === currentOwnerId ? 'owner' : (adminGuilds.length > 0 ? 'admin' : 'user');
    const username = discordUser.username;
    const avatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${discordUser.avatar}.${discordUser.avatar.startsWith('a_') ? 'gif' : 'png'}`
      : null;

    // Set login in MongoDB directly (no Bot API dependency)
    try {
      if (BotUser) {
        await BotUser.findOneAndUpdate(
          { userId },
          { $set: { username, avatar, isLogin: true, lastLoginAt: new Date() } },
          { upsert: true },
        );
      }
    } catch (e) {
      console.error('Dashboard: failed to save BotUser login:', e.message);
    }

    // Create session
    const sessionPayload = {
      userId,
      username,
      avatar,
      role,
      adminGuilds,
      accessToken,
      exp: Date.now() + 86400000,
    };
    const token = signToken(sessionPayload);
    res.cookie('session', token, { signed: true, httpOnly: true, maxAge: 86400000, sameSite: 'lax' });
    res.redirect('/dashboard?login=success');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('OAuth failed');
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const OWNER_ID = process.env.DISCORD_OWNER_ID || '';
  const role = req.user.userId === OWNER_ID ? 'owner' : req.user.role;

  res.json({
    authenticated: true,
    user: {
      userId: req.user.userId,
      username: req.user.username,
      avatar: req.user.avatar,
      role,
      adminGuilds: req.user.adminGuilds,
    },
  });
});

app.post('/api/auth/logout', auth, async (req, res) => {
  try {
    if (BotUser) {
      await BotUser.findOneAndUpdate(
        { userId: req.user.userId },
        { $set: { isLogin: false } },
      );
    }
  } catch (e) {
    console.error('Dashboard: failed to clear BotUser login:', e.message);
  }
  res.clearCookie('session');
  res.json({ success: true });
});

// ─── Guild Cache (avoid Discord rate limits) ──────────────────────
const guildCache = new Map();

function getCachedGuilds(userId, accessToken) {
  const cached = guildCache.get(userId);
  if (cached && Date.now() - cached.ts < 60000) return cached.data;
  return null;
}

function setCachedGuilds(userId, data) {
  guildCache.set(userId, { data, ts: Date.now() });
  if (guildCache.size > 100) {
    const oldest = [...guildCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) guildCache.delete(oldest[0]);
  }
}

// ─── Merged Guild List (Discord + MongoDB) ───────────────────────

app.get('/api/servers', auth, async (req, res) => {
  try {
    const MANAGE_GUILD = 0x20;
    const ADMINISTRATOR = 0x8;
    let discordGuilds = null;
    let discordError = null;

    // 1. Try fetching user's Discord guilds (token might be expired)
    //    Uses in-memory cache to stay within Discord rate limits
    discordGuilds = getCachedGuilds(req.user.userId, req.user.accessToken);
    if (!discordGuilds) {
      try {
        const gResp = await fetch('https://discord.com/api/users/@me/guilds', {
          headers: { Authorization: `Bearer ${req.user.accessToken}` },
        });
        if (gResp.ok) {
          discordGuilds = await gResp.json();
          setCachedGuilds(req.user.userId, discordGuilds);
        } else {
          discordError = gResp.status === 401 ? 'token_expired' : `discord_${gResp.status}`;
        }
      } catch (e) {
        discordError = e.message;
      }
    }

    // 2. Fetch MongoDB guild data from Bot API
    let botGuilds = {};
    try {
      const mResp = await fetch(`${BOT_API}/api/v1/guilds/all`, {
        headers: { 'x-api-secret': API_SECRET },
      });
      if (mResp.ok) {
        const list = await mResp.json();
        for (const g of (Array.isArray(list) ? list : [])) {
          botGuilds[g.guildId || g.id] = g;
        }
      }
    } catch (e) {
      console.error('Failed to fetch bot guilds:', e.message);
    }

    // 3. Fetch bot's current Discord guild IDs
    let botGuildIds = new Set();
    try {
      const bResp = await fetch(`${BOT_API}/api/v1/me/guilds`, {
        headers: { 'x-api-secret': API_SECRET },
      });
      if (bResp.ok) {
        const data = await bResp.json();
        if (data.guildIds && Array.isArray(data.guildIds)) {
          botGuildIds = new Set(data.guildIds);
        }
      }
    } catch (e) {
      console.error('Failed to fetch bot guild IDs:', e.message);
    }

    let guilds = [];

    if (discordGuilds) {
      // Have fresh Discord data — cross-reference with MongoDB
      guilds = discordGuilds
        .filter(g => (Number(g.permissions) & (MANAGE_GUILD | ADMINISTRATOR)) !== 0)
        .map(g => {
          const bg = botGuilds[g.id];
          const botInGuild = bg || botGuildIds.has(g.id);
          const botStatus = bg ? (bg.isBanned ? 'banned' : bg.isActive ? 'active' : 'inactive') : (botInGuild ? 'active' : 'not_joined');
          const setupDone = bg?.setupDone === true || bg?.channelCount > 0;
          return {
            id: g.id,
            guildId: g.id,
            name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
            owner: g.owner,
            ownerId: bg?.ownerId || '',
            permissions: g.permissions,
            botStatus,
            setupDone: botStatus === 'active' && setupDone,
            isActive: bg?.isActive || false,
            isBanned: bg?.isBanned || false,
            joinedAt: bg?.joinedAt || null,
            totalMessages: bg?.totalMessages || 0,
            totalTokens: bg?.totalTokens || 0,
            channelCount: bg?.channelCount || 0,
            dailyRequestLimit: bg?.dailyRequestLimit || 0,
            dailyTokenLimit: bg?.dailyTokenLimit || 0,
          };
        });
    } else if (Object.keys(botGuilds).length > 0) {
      // Discord API failed — show whatever we have from MongoDB
      guilds = Object.values(botGuilds).map(bg => {
        const botStatus = bg.isBanned ? 'banned' : bg.isActive ? 'active' : 'inactive';
        const setupDone = bg?.setupDone === true || bg?.channelCount > 0;
        return {
          id: bg.guildId || bg.id,
          guildId: bg.guildId || bg.id,
          name: bg.name || 'Unknown Server',
          icon: bg.icon || null,
          ownerId: bg.ownerId || '',
          botStatus,
          setupDone: botStatus === 'active' && setupDone,
          isActive: bg.isActive || false,
          isBanned: bg.isBanned || false,
          joinedAt: bg.joinedAt || null,
          totalMessages: bg.totalMessages || 0,
          totalTokens: bg.totalTokens || 0,
          channelCount: bg.channelCount || 0,
          dailyRequestLimit: bg.dailyRequestLimit || 0,
          dailyTokenLimit: bg.dailyTokenLimit || 0,
        };
      });
    }

    res.json({ guilds, discordError, partial: !!discordError });
  } catch (err) {
    console.error('Server list error:', err);
    res.status(500).json({ error: 'Failed to load servers', detail: err.message });
  }
});

// ─── API Proxy ───────────────────────────────────────────────────

app.all('/api/proxy/*', auth, async (req, res) => {
  try {
    const targetPath = req.path.replace('/api/proxy', '');
    const url = `${BOT_API}${targetPath}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    const options = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': API_SECRET,
      },
    };
    if (req.user) {
      options.headers['x-user-id'] = req.user.userId;
      options.headers['x-user-role'] = req.user.role;
    }
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      options.body = JSON.stringify(req.body);
    }
    const response = await fetch(url, options);
    const text = await response.text();
    res.status(response.status).type('json').send(text);
  } catch (err) {
    res.status(502).json({ error: 'Bot API unreachable', detail: err.message });
  }
});

// ─── Pages ───────────────────────────────────────────────────────

const views = path.join(__dirname, 'views');

// ─── Public HTML Pages ───────────────────────────────────────────
app.get('/', (req, res) => res.render('home', { path: '/' }));
app.get('/privacy', (req, res) => res.render('privacy', { path: '/privacy' }));

app.get('/terms', (req, res) => res.render('terms', { path: '/terms' }));
// ─── Public EJS Pages ────────────────────────────────────────────
app.get('/commands', (req, res) => res.render('commands', { path: req.path }));
app.get('/status', (req, res) => res.render('status', { path: req.path }));

// ─── Invite Redirect ─────────────────────────────────────────────
const DISCORD_BOT_INVITE = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&permissions=8796093148208&scope=bot%20applications.commands`;
app.get('/invite', (req, res) => res.redirect(DISCORD_BOT_INVITE));

// ─── Authenticated Pages (EJS) ───────────────────────────────────
app.get('/dashboard', auth, (req, res) => res.render('dashboard', { path: req.path }));
app.get('/servers', auth, (req, res) => res.render('servers', { path: req.path }));
app.get('/servers/:guildId', auth, (req, res) => res.render('server', { path: req.path }));
app.get('/servers/:guildId/channels', auth, (req, res) => res.render('channels', { path: req.path }));
app.get('/servers/:guildId/users', auth, (req, res) => res.render('users', { path: req.path }));
app.get('/servers/:guildId/settings', auth, (req, res) => res.render('server-settings', { path: req.path }));
app.get('/servers/:guildId/analytics', auth, (req, res) => res.render('server-analytics', { path: req.path, sidebarTitle: 'Overview' }));
app.get('/settings/providers', auth, requireOwner, (req, res) => res.render('providers', { path: req.path }));
app.get('/settings/providers/:providerId', auth, requireOwner, (req, res) => res.render('provider', { path: req.path, sidebarTitle: 'Overview' }));
app.get('/settings/models', auth, requireOwner, (req, res) => res.render('models', { path: req.path }));
app.get('/settings/defaults', auth, requireOwner, (req, res) => res.render('defaults', { path: req.path }));
app.get('/settings/analytics', auth, requireOwner, (req, res) => res.render('analytics', { path: req.path }));
app.get('/settings/mcps', auth, requireOwner, (req, res) => res.render('mcps', { path: req.path }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Public Bot Health (no auth) ──────────────────────────────────
app.get('/api/public/health', async (req, res) => {
  try {
    const resp = await fetch(`${BOT_API}/health`, {
      headers: { 'x-api-secret': API_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return res.json({ status: 'error', database: 'disconnected', discord: 'disconnected' });
    const data = await resp.json();
    res.json({
      status: data.status || 'error',
      database: data.database || 'disconnected',
      discord: data.discord || 'disconnected',
    });
  } catch {
    res.json({ status: 'error', database: 'disconnected', discord: 'disconnected' });
  }
});

// ─── Public Stats (no auth) ───────────────────────────────────────
app.get('/api/public/stats', async (req, res) => {
  try {
    const resp = await fetch(`${BOT_API}/api/v1/analytics/overview`, {
      headers: { 'x-api-secret': API_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return res.json({ guilds: 0, channels: 0, totalUsers: 0, totalMessages: 0 });
    const data = await resp.json();
    res.json({
      guilds: data.guilds || 0,
      channels: data.channels || 0,
      totalUsers: data.totalUsers || 0,
      totalMessages: data.totalMessages || 0,
    });
  } catch {
    res.json({ guilds: 0, channels: 0, totalUsers: 0, totalMessages: 0 });
  }
});

// ─── Public Config (logo, brand name) ─────────────────────
app.get('/api/public/config', (req, res) => {
  res.json({
    brandName: process.env.BRAND_NAME || 'Gapat Bot',
    logoUrl: process.env.LOGO_URL || '/img/logo.png',
  });
});

// ─── 404 Handler ────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.status(404).render('404', { path: req.path });
});

// ─── Anti-Crash ──────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  console.error('❌ DASHBOARD ANTI-CRASH: Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ DASHBOARD ANTI-CRASH: Uncaught Exception:', err.message);
});

// ─── Start (skip in Vercel — it handles listening) ──────────────

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`⚠️ Port ${PORT} is already in use. Stop the old process first: fuser -k ${PORT}/tcp`);
    } else {
      console.error('⚠️ Server error:', err.message);
    }
  });
}

module.exports = app;
