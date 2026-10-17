const fs = require('fs');
const path = require('path');

// Zero-dependency .env parser
try {
    const envPath = path.join(__dirname, "..", ".env");
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf8");
        envContent.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx).trim();
                const val = trimmed.substring(eqIdx + 1).trim();
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        });
    }
} catch (e) {
    console.warn("Could not load .env:", e.message);
}

const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("FATAL: No BOT_TOKEN found in .env");
    process.exit(1);
}

const LocalUserStore = require('../localStore.js');
const storePath = path.join(__dirname, "..", "data", "bot_users.json");
const localStore = new LocalUserStore(storePath);

const ADVISORY_TEXT = `🛡️ <b>Film House Community Advisory</b>

Dear Film House members,

If you ever see third-party promotional ads or foreign language suggestions at the bottom of this chat, please note that these are automated Telegram platform sponsored messages.

✅ <b>Film House never endorses external ads.</b>
✅ <b>Your account, points, and mining progress remain 100% secure.</b>

Always launch the app using the official <b>Launch App & Start Mining 🌕</b> button above.

Thank you for your continued support! 🍿🎬`;

const INLINE_KEYBOARD = {
    inline_keyboard: [
        [
            { text: "🍿 Launch Film House App", url: "https://t.me/Filmhouseappbot" }
        ]
    ]
};

async function sendTelegramMessage(chatId, text, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: text,
                    parse_mode: 'HTML',
                    reply_markup: INLINE_KEYBOARD
                })
            });

            const data = await res.json();
            if (data.ok) return { ok: true };

            if (data.error_code === 429) {
                const waitSec = (data.parameters && data.parameters.retry_after) ? data.parameters.retry_after : 2;
                console.warn(`[RateLimit] Chat ${chatId} hit 429, waiting ${waitSec}s...`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }

            // User blocked bot or deleted account
            if (data.error_code === 403 || (data.description && data.description.includes("blocked"))) {
                return { ok: false, blocked: true, description: data.description };
            }

            return { ok: false, description: data.description };
        } catch (err) {
            if (attempt === retries) return { ok: false, error: err.message };
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return { ok: false, error: "Max retries reached" };
}

async function runBroadcast() {
    const allUsers = localStore.getAllUsers();
    console.log(`Loaded ${allUsers.length} total users from local store.`);

    const activeUsers = allUsers.filter(u => u && u.id && !u.banned && !u.blockedBot);
    console.log(`Found ${activeUsers.length} active (non-banned, non-blocked) users to broadcast to.`);

    if (activeUsers.length === 0) {
        console.error("No active users found to broadcast to.");
        return;
    }

    let successCount = 0;
    let failedCount = 0;
    let blockedCount = 0;
    const startTime = Date.now();

    console.log("Beginning broadcast to all members...\n");

    for (let i = 0; i < activeUsers.length; i++) {
        const user = activeUsers[i];
        const res = await sendTelegramMessage(user.id, ADVISORY_TEXT);

        if (res.ok) {
            successCount++;
        } else {
            failedCount++;
            if (res.blocked) {
                blockedCount++;
                localStore.setBlocked(user.id, true);
            }
        }

        if ((i + 1) % 50 === 0 || i === activeUsers.length - 1) {
            const percent = Math.round(((i + 1) / activeUsers.length) * 100);
            const elapsedSec = Math.round((Date.now() - startTime) / 1000);
            console.log(`[${percent}%] (${i + 1}/${activeUsers.length}) | Delivered: ${successCount} | Failed: ${failedCount} (Blocked: ${blockedCount}) | Time: ${elapsedSec}s`);
        }

        // 40ms safe delay between sends (safe under Telegram limits)
        await new Promise(r => setTimeout(r, 40));
    }

    const totalSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n🎉 Broadcast Finished in ${totalSec}s!`);
    console.log(`✅ Total Delivered: ${successCount}`);
    console.log(`❌ Total Failed: ${failedCount} (${blockedCount} users flagged as blocked)`);
}

runBroadcast().catch(err => {
    console.error("Fatal error during broadcast:", err);
    process.exit(1);
});
