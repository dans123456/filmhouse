require('dotenv').config();
const fs = require('fs');
const path = require('path');

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
    // 1. Send probe message to get latest message_id
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

    // Sweep backwards 35 messages
    let deletedCount = 0;
    for (let msgId = latestId - 1; msgId >= Math.max(1, latestId - 35); msgId--) {
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
    console.log("\nSweep complete!");
}

run();
