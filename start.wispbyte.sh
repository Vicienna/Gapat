#!/bin/bash
# Gapat Bot — Wispbyte (Pterodactyl) startup script
set -e

echo "=== Gapat Bot — Wispbyte Startup ==="

# 1. Install Python deps
echo "[1/4] Installing Python dependencies..."
pip install ddgs 2>/dev/null || pip3 install ddgs 2>/dev/null || echo "Warning: ddgs install failed (MCP search may not work)"

# 2. Install Node deps
echo "[2/4] Installing Node dependencies..."
npm install

# 3. Build TypeScript
echo "[3/4] Building bot..."
npm run build -w bot

# 4. Start bot
echo "[4/4] Starting bot..."
exec npm run start -w bot
