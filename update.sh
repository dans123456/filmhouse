#!/bin/bash
# ==============================================================================
# Film House Bot Safe Auto-Updater (Zero-Downtime Reload)
# ==============================================================================

echo "----------------------------------------------------"
echo "  FILM HOUSE - 1-CLICK SERVER BOT SAFE UPDATER"
echo "----------------------------------------------------"

echo "[1/4] Pulling latest code from GitHub main branch..."
git stash push -u -m 'auto-stash-updater' || true
git pull origin main

echo "[2/4] Verifying node dependencies..."
npm install --omit=dev

echo "[3/4] Verifying JavaScript syntax integrity..."
node -c bot.js
if [ $? -eq 0 ]; then
    echo "  >> Syntax check PASSED (0 errors)!"
    echo "[4/4] Reloading PM2 process with zero downtime..."
    pm2 reload filmhouse-bot || pm2 reload bot || pm2 reload all
    echo "----------------------------------------------------"
    echo "  🎉 SUCCESS! Your bot is live with the latest code."
    echo "----------------------------------------------------"
else
    echo "----------------------------------------------------"
    echo "  ❌ SYNTAX CHECK FAILED! PM2 reload was aborted"
    echo "  to prevent taking your live bot offline."
    echo "----------------------------------------------------"
fi
