const fs = require('fs');
const path = require('path');

// Native zero-dependency .env loader
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
    console.error("No BOT_TOKEN found in .env");
    process.exit(1);
}

const adminIds = (process.env.ADMIN_IDS || "1175336733,1329840839").split(',').map(s => s.trim());

async function postTelegram(method, body) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json();
}

async function sweepChat(chatId) {
    console.log(`\n--- Sweeping chat ${chatId} ---`);
    const probe = await postTelegram('sendMessage', {
        chat_id: chatId,
        text: '🛡️ Scanning for unauthorized spam messages...'
    });

    if (!probe.ok) {
        console.warn(`Could not probe chat ${chatId}:`, probe.description);
        return;
    }

    const latestId = probe.result.message_id;
    console.log(`Latest message_id for ${chatId} is ${latestId}`);

    // Delete probe message
    await postTelegram('deleteMessage', { chat_id: chatId, message_id: latestId });

    // Sweep backwards 60 messages
    let deletedCount = 0;
    for (let msgId = latestId - 1; msgId >= Math.max(1, latestId - 60); msgId--) {
        const delRes = await postTelegram('deleteMessage', {
            chat_id: chatId,
            message_id: msgId
        });
        if (delRes.ok) {
            console.log(`✅ Deleted message ${msgId} in chat ${chatId}`);
            deletedCount++;
        }
    }
    console.log(`Finished sweeping chat ${chatId}: ${deletedCount} message(s) deleted.`);
}

async function run() {
    console.log("Starting spam deletion sweep for admins...");
    for (const adminId of adminIds) {
        await sweepChat(adminId);
    }
    console.log("\nAdmin sweep complete!");
}

run();
