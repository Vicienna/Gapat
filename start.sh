#!/bin/bash
# Start bot and dashboard with auto-restart
echo "Starting Gapat Bot (auto-restart) + Dashboard (auto-restart)..."
echo ""
echo "Bot:   http://localhost:${BOT_API_PORT:-3001}/health"
echo "Dashboard: http://localhost:${DASHBOARD_PORT:-4567}"
echo ""

# Run both in background, kill all on exit
trap 'kill 0' EXIT

# Start bot with auto-restart (tsx watch)
npm run dev:bot &

# Start dashboard with auto-restart (node --watch)
npm run dev:dashboard &

# Wait for either to exit
wait
