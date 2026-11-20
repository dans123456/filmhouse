#!/bin/bash
# ==============================================================================
# Film House Bot Safe Auto-Updater (Zero-Downtime Reload)
# ==============================================================================

cd "$(dirname "$0")" || exit 1

echo "----------------------------------------------------"
echo "  FILM HOUSE - 1-CLICK SERVER BOT SAFE UPDATER"
echo "----------------------------------------------------"

echo "[1/4] Backing up runtime data and pulling latest code from GitHub main branch..."
BAK_DIR="/tmp/fh_update_bak_$$"
mkdir -p "$BAK_DIR"
if [ -d "data" ]; then
    cp -a data "$BAK_DIR/" 2>/dev/null || true
fi
if [ -f "custom_aliases.json" ]; then
    cp -a custom_aliases.json "$BAK_DIR/" 2>/dev/null || true
fi

git stash push -u -m 'auto-stash-updater' >/dev/null 2>&1 || true
git config pull.rebase false 2>/dev/null || true
if ! git pull --no-rebase origin main; then
    echo "  >> Standard pull had conflicts; syncing cleanly to origin/main..."
    git fetch origin main && git reset --hard origin/main
    PULL_STATUS=$?
else
    PULL_STATUS=0
fi

# Restore runtime data and custom aliases
if [ -d "$BAK_DIR/data" ]; then
    mkdir -p data
    cp -a "$BAK_DIR/data/." data/ 2>/dev/null || true
fi
if [ -f "$BAK_DIR/custom_aliases.json" ]; then
    cp -a "$BAK_DIR/custom_aliases.json" ./custom_aliases.json 2>/dev/null || true
fi
rm -rf "$BAK_DIR" 2>/dev/null || true

if [ $PULL_STATUS -ne 0 ]; then
    echo "  ❌ Git update failed!"
    exit 1
fi

echo "[2/4] Verifying node dependencies..."
if ! npm install --omit=dev; then
    echo "  ❌ npm install failed!"
    exit 1
fi

echo "[3/4] Verifying JavaScript syntax integrity..."
node -c bot.js && node -c localStore.js && node -c seriesTracker.js && node -c seriesSchema.js
if [ $? -eq 0 ]; then
    echo "  >> Syntax check PASSED (0 errors)!"
    echo "[4/4] Reloading PM2 process with zero downtime..."
    if pm2 reload filmhouse-bot || pm2 reload bot || pm2 reload all; then
        echo "----------------------------------------------------"
        echo "  🎉 SUCCESS! Your bot is live with the latest code."
        echo "----------------------------------------------------"
        exit 0
    else
        echo "  ❌ PM2 reload failed!"
        exit 1
    fi
else
    echo "----------------------------------------------------"
    echo "  ❌ SYNTAX CHECK FAILED! PM2 reload was aborted"
    echo "  to prevent taking your live bot offline."
    echo "----------------------------------------------------"
    exit 1
fi
