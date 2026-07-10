# Gapat Bot

A self-hosted Discord AI chatbot with a web dashboard. Supports multiple AI providers (OpenAI, Anthropic, Google, OpenRouter, custom), per-guild settings, MCP tool calling, and more.

## Features

- Multi-provider AI support (OpenAI, Anthropic, Google, OpenRouter, custom endpoints)
- Per-guild configuration (language, model, temperature, rate limits)
- Web dashboard with Discord OAuth login
- MCP (Model Context Protocol) tool integration
- Web search, image understanding, conversation memory
- Rate limiting and abuse protection
- Multi-language support (50+ languages)

## Prerequisites

- Node.js 18+
- Python 3.11+ (for MCP servers)
- MongoDB (local or Atlas)
- Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

## Quick Start

1. Clone the repo:
```bash
git clone https://github.com/your-username/gapat-full.git
cd gapat-full
```

2. Install dependencies:
```bash
npm install
pip install ddgs
```

3. Set up environment:
```bash
cp .env.example .env
```
Edit `.env` with your values. See `.env.example` for all required variables.

4. Build:
```bash
npm run build
```

5. Deploy Discord slash commands:
```bash
npm run deploy
```

6. Start:
```bash
npm start
```

The bot runs on port 3001 (Bot API) and the dashboard on port 4567.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | Discord app client ID |
| `DISCORD_CLIENT_SECRET` | Yes | Discord app client secret |
| `DISCORD_OWNER_ID` | Yes | Your Discord user ID (owner role) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `DASHBOARD_SECRET` | Yes | Secret for session signing (min 32 chars) |
| `INTERNAL_API_SECRET` | Yes | Secret for bot-dashboard API (min 16 chars) |
| `ENCRYPTION_KEY` | Yes | AES-256 encryption key (64 hex chars) |
| `DASHBOARD_PORT` | No | Dashboard port (default: 4567) |
| `BOT_API_PORT` | No | Bot API port (default: 3001) |
| `DASHBOARD_URL` | No | Public dashboard URL |
| `BRAND_NAME` | No | Custom brand name |
| `LOGO_URL` | No | Custom logo URL |

## Deployment

### Bot (Wispbyte)

1. Sign up at [wispbyte.com](https://wispbyte.com) and create a Node.js server

2. Configure startup command in Wispbyte panel:
   ```
   bash start.wispbyte.sh
   ```
   Or manually:
   ```
   npm install && npm run build -w bot && npm run start -w bot
   ```

3. Set environment variables in Wispbyte panel:
   - Copy from `env.wispbyte.txt`
   - Fill in your Discord token, client secret, and DASHBOARD_URL

4. Upload the project files via SFTP or panel file manager

5. Install Python MCP deps (SSH/console):
   ```bash
   pip install ddgs
   ```

6. Start the server

### Dashboard (Vercel)
- Framework: Other
- Build command: `npm run build -w dashboard`
- Output directory: `dashboard`

## Project Structure

```
gapat-full/
├── bot/                    # Discord bot (TypeScript)
│   ├── src/
│   │   ├── api/           # Bot API routes
│   │   ├── commands/      # Slash commands
│   │   ├── events/        # Discord event handlers
│   │   ├── models/        # Mongoose models
│   │   ├── services/      # Business logic
│   │   └── constants/     # Constants and prompts
│   └── mcp-servers/       # MCP server configs
├── dashboard/              # Web dashboard (Express + EJS)
│   ├── views/             # EJS templates
│   ├── public/            # Static assets
│   └── server.js          # Dashboard server
└── .env.example           # Environment template
```

## Security

- HMAC-signed session cookies with timing-safe comparison
- CORS protection for dashboard API
- Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- Rate limiting per user and per server
- API key encryption at rest (AES-256)
- Owner-only access for sensitive operations

## Creator

**Vicienna**
- Instagram: [@ceena.dev](https://instagram.com/ceena.dev)
- Discord: [hallo.dev](https://discord.gg/hallogabut)
- Indonesia

## License

MIT License. See [LICENSE](LICENSE) for details.
