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

const channelId = process.env.UPDATES_CHANNEL_ID || "-1004272961286";

async function run() {
    console.log(`Connecting to Telegram Updates Channel (${channelId})...`);

    // 1. Attempt to delete the erroneous message 131 from the updates channel if it still exists
    try {
        console.log("Attempting to delete erroneous message 131...");
        const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: channelId,
                message_id: 131
            })
        });
        const delData = await delRes.json();
        console.log("Delete message 131 response:", delData);
    } catch (delErr) {
        console.warn("Could not delete message 131 (may already be deleted):", delErr.message);
    }

    // 2. Build the correct King of Thieves announcement
    const title = "King of Thieves";
    const year = "2022";
    const headerBadge = "✨ <b>HIGH DEFINITION UPDATE!</b> 🍿";
    const updateCallout = "📌 <b>Update:</b> <b>720p & 1080p HD Quality Now Available!</b> ⚡\n";
    const metaLine = "🎭 African, Action, Drama | ⭐️ 7.5/10\n";
    const overviewLine = "💬 <i>King of thieves is an epic tale of Agesinkole, an all-powerful Bandit and his reign of terror in the prosperous Kingdom of Ajeromi...</i>\n\n";
    const deepLinkUrl = "https://t.me/Filmhouseappbot?start=dl_1008308-king-of-thieves";

    const caption = 
        `${headerBadge}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎬 <b>${title}</b> (${year})\n` +
        `${updateCallout}\n` +
        metaLine +
        overviewLine +
        `👉 <a href="${deepLinkUrl}">CLICK HERE TO DOWNLOAD</a> ✔️`;

    const bannerUrl = "https://image.tmdb.org/t/p/w1280/jjUJ0e3Myn3vPP5VfpcGJ4ENGud.jpg";

    console.log("Publishing King of Thieves announcement to channel...");
    const postRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: channelId,
            photo: bannerUrl,
            caption: caption,
            parse_mode: 'HTML'
        })
    });

    const postData = await postRes.json();
    console.log("Publish response:", postData);

    if (postData.ok) {
        console.log(`\n🎉 SUCCESS! King of Thieves posted to Updates Channel with message ID: ${postData.result.message_id}`);
    } else {
        console.error("Failed to post announcement:", postData);
    }
}

run();
