const { Telegraf } = require("telegraf");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const http = require("http");

// Start a dummy HTTP server to bind to Render's PORT to pass healthchecks and prevent sleeping
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Film House Bot is active and running! 🍿");
}).listen(PORT, () => {
    console.log(`Dummy health check HTTP server listening on port ${PORT}`);
});

// Initialize Firebase Admin
if (process.env.FIREBASE_CONFIG) {
    admin.initializeApp();
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin initialized using FIREBASE_SERVICE_ACCOUNT environment variable.");
    } catch (err) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env variable:", err);
        admin.initializeApp({
            projectId: "film-house-2"
        });
    }
} else {
    try {
        const serviceAccount = require("./firebase-key.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin initialized using firebase-key.json file.");
    } catch (err) {
        console.warn("Could not load firebase-key.json. Initializing using default credentials / Project ID...");
        admin.initializeApp({
            projectId: "film-house-2"
        });
    }
}
const db = admin.firestore();

// Bot setup helper
function setupBot(bot) {
    // Middleware to automatically make all context replies direct thread replies to the triggering message
    bot.use(async (ctx, next) => {
        const messageId = ctx.message ? ctx.message.message_id : (ctx.callbackQuery && ctx.callbackQuery.message ? ctx.callbackQuery.message.message_id : undefined);
        if (messageId) {
            const originalReply = ctx.reply;
            ctx.reply = function (text, extra) {
                return originalReply.call(ctx, text, Object.assign({ reply_to_message_id: messageId }, extra || {}));
            };

            const originalReplyWithPhoto = ctx.replyWithPhoto;
            ctx.replyWithPhoto = function (photo, extra) {
                return originalReplyWithPhoto.call(ctx, photo, Object.assign({ reply_to_message_id: messageId }, extra || {}));
            };
        }
        return next();
    });

    // Middleware to check if user is banned
    bot.use(async (ctx, next) => {
        if (!ctx.from) return next();
        const userId = String(ctx.from.id);
        
        try {
            const userDoc = await db.collection("users").doc(userId).get();
            if (userDoc.exists && userDoc.data().banned === true) {
                return ctx.reply("❌ Your access to Film House has been restricted.");
            }
        } catch (err) {
            console.error("Error checking ban status:", err);
        }
        return next();
    });

    // Helper: Check if user is an authorized admin
    async function isAdmin(userId) {
        const defaultAdmins = ["1329840839", "1175336733"];
        try {
            const doc = await db.collection("settings").doc("admins").get();
            const adminList = doc.exists ? doc.data().ids || [] : [];
            const allAdmins = [...defaultAdmins, ...adminList];
            return allAdmins.includes(String(userId));
        } catch (err) {
            console.warn("Failed to read admin list from Firestore, falling back to default admins:", err);
            return defaultAdmins.includes(String(userId));
        }
    }

    // Command: /start
    bot.command('start', async (ctx) => {
        const userId = String(ctx.from.id);
        const username = ctx.from.username || "guest";
        const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Guest User";
        
        console.log(`User /start: ${fullName} (@${username}, ID: ${userId})`);

        // Register user in Firestore
        try {
            const userRef = db.collection("users").doc(userId);
            const userDoc = await userRef.get();
            
            const data = {
                id: userId,
                username: username,
                fullName: fullName,
                lastSeen: admin.firestore.FieldValue.serverTimestamp()
            };
            
            if (!userDoc.exists) {
                data.points = 0;
                data.badge = "";
                data.badgeExpiresAt = 0;
                data.pointsBreakdown = { downloads: 0, visits: 0, shares: 0, watched: 0 };
                data.dailyStats = {};
                data.joinedDate = admin.firestore.FieldValue.serverTimestamp();
                await userRef.set(data);
            } else {
                await userRef.set(data, { merge: true });
            }
        } catch (err) {
            console.error("Error registering user on /start:", err);
        }

        // Check for deep-link claim payload (start=claim_docId)
        const payload = ctx.startPayload || (ctx.message && ctx.message.text ? ctx.message.text.split(" ")[1] : "");
        if (payload && payload.startsWith("claim_")) {
            const docId = payload.substring(6);
            try {
                const docRef = db.collection("requests").doc(docId);
                const doc = await docRef.get();
                if (doc.exists) {
                    const reqData = doc.data();
                    // Mark as claimed in Firestore
                    await docRef.update({
                        claimed: true,
                        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
                        status: "claimed"
                    });

                    // Send the download link directly to the user
                    const dlLink = reqData.downloadLink;
                    if (dlLink) {
                        return await ctx.reply(
                            `🍿 *Your Requested Movie is Ready!* 🍿\n\n` +
                            `Here is your direct download link for *${reqData.title}*:\n` +
                            `🔗 ${dlLink}\n\n` +
                            `This request has been marked as claimed on your account. Enjoy your download! 🎬`,
                            { parse_mode: "Markdown" }
                        );
                    }
                }
            } catch (err) {
                console.error("Error processing claim start payload:", err);
            }
        }

        const escapedFullName = fullName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const imagePath = path.join(__dirname, "MOVIE", "img", "FilmHouse.png");
        const caption = `🍿 <b>Welcome to Film House, ${escapedFullName}!</b> 🍿\n\nTo start downloading movies & series:\n1. Click the <b>Launch Film House 🚀</b> button below to open the movie library.\n2. Tap any movie or season to unlock download links.\n3. Can't find a title? Request it inside the app and we will notify you here directly!\n\n<i>Make sure you join our channel @filmhouse_main to stay updated! 🤟</i>`;

        const replyMarkup = {
            inline_keyboard: [
                [
                    {
                        text: "Launch Film House 🚀",
                        url: "https://t.me/Filmhouseappbot/filmhouseapp"
                    }
                ],
                [
                    { text: "Help 📖", callback_data: "bot_help" },
                    { text: "About ℹ️", callback_data: "bot_about" }
                ],
                [
                    { text: "Join Channel 📢", url: "https://t.me/filmhouse_main" }
                ]
            ]
        };

        if (fs.existsSync(imagePath)) {
            try {
                return await ctx.replyWithPhoto(
                    { source: imagePath },
                    {
                        caption: caption,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    }
                );
            } catch (err) {
                console.error("Failed to send welcome photo, falling back to text:", err);
                return ctx.reply(caption, {
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                });
            }
        }
        
        return ctx.reply(caption, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        });
    });

    // Command: /help
    bot.command('help', async (ctx) => {
        const userId = String(ctx.from.id);
        const userIsAdmin = await isAdmin(userId);

        let helpMsg = 
            `📖 *Film House Help & Guide*\n\n` +
            `• Click the *Launch Film House* button to open the movie library.\n` +
            `• Request films or series directly inside the app if they aren't available.\n` +
            `• You will receive a direct notification message when your requests are fulfilled!\n\n` +
            `*Commands List:*\n` +
            `/start - Open the welcome screen and launch app\n` +
            `/settings - View your profile info and points status\n` +
            `/help - Display this help guide`;

        if (userIsAdmin) {
            helpMsg += 
                `\n\n_Admins Only:_\n` +
                `/broadcast <msg> - Broadcast a message to all users\n` +
                `/ban <user_id> - Ban a user from the bot and app\n` +
                `/unban <user_id> - Unban a restricted user`;
        }

        return ctx.reply(helpMsg, { 
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
    });

    // Command: /settings
    bot.command('settings', async (ctx) => {
        const userId = String(ctx.from.id);
        try {
            const userDoc = await db.collection("users").doc(userId).get();
            if (!userDoc.exists) {
                return ctx.reply("❌ User profile not found. Please type /start to initialize your account.");
            }
            const u = userDoc.data();
            const points = u.points || 0;
            const badge = u.badge || "No Active Badge";
            
            const replyMarkup = {
                inline_keyboard: [
                    [
                        {
                            text: "Open Web App 🚀",
                            url: "https://t.me/Filmhouseappbot/filmhouseapp"
                        }
                    ],
                    [
                        { text: "Help 📖", callback_data: "settings_help" },
                        { text: "About ℹ️", callback_data: "settings_about" }
                    ]
                ]
            };
            
            return ctx.reply(
                `👤 *Your Profile Status*\n\n` +
                `• *Telegram ID:* \`${userId}\`\n` +
                `• *Username:* @${u.username || "None"}\n` +
                `• *Loyalty Points:* 🪙 \`${points.toLocaleString()}\` pts\n` +
                `• *VIP Badge:* 🏆 \`${badge}\``,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup,
                    reply_to_message_id: ctx.message.message_id
                }
            );
        } catch (err) {
            console.error("Error loading settings:", err);
            return ctx.reply("❌ Error loading your profile settings.", {
                reply_to_message_id: ctx.message.message_id
            });
        }
    });

    // Command: /ping
    bot.command('ping', (ctx) => {
        return ctx.reply("🏓 Pong! I am online and running.", {
            reply_to_message_id: ctx.message.message_id
        });
    });

    // Command: /broadcast (Admin Only)
    bot.command('broadcast', async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to administrators.");
        }

        const replyTo = ctx.message.reply_to_message;
        const messageText = ctx.message.text.substring(10).trim(); // remove "/broadcast" prefix
        
        if (!replyTo && !messageText) {
            return ctx.reply(
                "📢 *How to use /broadcast*:\n\n" +
                "• *To broadcast a post (with image/video/caption)*:\n" +
                "  Send the post to this chat, then *Reply* directly to that post with `/broadcast`.\n\n" +
                "• *To broadcast a simple text message*:\n" +
                "  Type: `/broadcast <your message>`",
                { 
                    parse_mode: 'Markdown',
                    reply_to_message_id: ctx.message.message_id
                }
            );
        }

        ctx.reply("✈️ *Starting broadcast...*", { 
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });

        try {
            const snapshot = await db.collection("users").get();
            let successCount = 0;
            let failedCount = 0;

            for (const doc of snapshot.docs) {
                const u = doc.data();
                if (u.id) {
                    try {
                        if (replyTo) {
                            // Copy the replied-to message (copies photos, videos, files, captions, and inline buttons)
                            await ctx.telegram.copyMessage(u.id, ctx.chat.id, replyTo.message_id);
                        } else {
                            // Fallback to text message broadcast
                            await ctx.telegram.sendMessage(u.id, messageText, { parse_mode: "Markdown" });
                        }
                        successCount++;
                    } catch (err) {
                        failedCount++;
                    }
                    // Rate limiting delay
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            return ctx.reply(`📢 *Broadcast Finished*\n\n🟢 Success: \`${successCount}\`\n🔴 Failed: \`${failedCount}\``, { 
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
            });
        } catch (err) {
            console.error("Broadcast failed:", err);
            return ctx.reply(`❌ Broadcast failed: ${err.message}`, {
                reply_to_message_id: ctx.message.message_id
            });
        }
    });

    // Command: /ban <user_id> (Admin Only)
    bot.command('ban', async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isAdmin(userId))) {
            return ctx.reply("❌ Unauthorized.");
        }

        const targetId = ctx.message.text.substring(4).trim(); // remove "/ban" prefix
        if (!targetId || isNaN(targetId)) {
            return ctx.reply("Please specify a valid Telegram User ID to ban. Format: `/ban <user_id>`");
        }

        try {
            await db.collection("users").doc(targetId).set({ banned: true }, { merge: true });
            
            // Notify banned user (if possible)
            try {
                await ctx.telegram.sendMessage(targetId, "❌ Your access to Film House has been restricted.");
            } catch (notifyErr) {}

            return ctx.reply(`✅ Successfully banned User ID \`${targetId}\`. They are blocked from using the app.`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Error banning user:", err);
            return ctx.reply(`❌ Error banning user: ${err.message}`);
        }
    });

    // Command: /unban <user_id> (Admin Only)
    bot.command('unban', async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isAdmin(userId))) {
            return ctx.reply("❌ Unauthorized.");
        }

        const targetId = ctx.message.text.substring(6).trim(); // remove "/unban" prefix
        if (!targetId || isNaN(targetId)) {
            return ctx.reply("Please specify a valid Telegram User ID to unban. Format: `/unban <user_id>`");
        }

        try {
            await db.collection("users").doc(targetId).set({ banned: false }, { merge: true });
            
            // Notify user
            try {
                await ctx.telegram.sendMessage(targetId, "🟢 Your access to Film House has been restored! Type /start to open the app.");
            } catch (notifyErr) {}

            return ctx.reply(`✅ Successfully unbanned User ID \`${targetId}\`. Access has been restored.`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Error unbanning user:", err);
            return ctx.reply(`❌ Error unbanning user: ${err.message}`);
        }
    });

    // Default reply for regular text messages (Automation)
    bot.on('text', (ctx) => {
        return ctx.reply(
            `🤖 *Hello!* I am the Film House Bot.\n\nTo search, request, or download movies/series, please tap the button below to launch the Film House Web App! 🍿`,
            {
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Launch Film House 🚀",
                                url: "https://t.me/Filmhouseappbot/filmhouseapp"
                            }
                        ]
                    ]
                }
            }
        );
    });

    // Callback Query Handler for Inline Buttons
    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const userId = String(ctx.from.id);
        const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
        const escapedFullName = fullName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Helper to edit the message caption (for photo messages) or text (for fallback text messages) in-place
        const editMessageInPlace = async (text, extra) => {
            try {
                // Try editing caption first (works if the original message has a photo)
                await ctx.editMessageCaption(text, extra);
            } catch (err) {
                // Fallback: Try editing text (works if the original message is plain text)
                try {
                    await ctx.editMessageText(text, extra);
                } catch (textErr) {
                    console.error("Failed to edit message in-place:", textErr);
                }
            }
        };
        
        try {
            // --- Welcome Card Navigation ---
            if (data === "bot_help") {
                await ctx.answerCbQuery();
                const helpMarkup = {
                    inline_keyboard: [
                        [
                            {
                                text: "Launch Film House 🚀",
                                url: "https://t.me/Filmhouseappbot/filmhouseapp"
                            }
                        ],
                        [
                            { text: "« Back to Menu 🔙", callback_data: "bot_menu" }
                        ]
                    ]
                };
                
                return await editMessageInPlace(
                    `📖 *Film House Help & Guide*\n\n` +
                    `• Tap the *Launch Film House* button to open the movie catalog.\n` +
                    `• Select any movie or series to download.\n` +
                    `• If a title is missing, tap *Request* to submit it to our admins.\n` +
                    `• You will receive a direct notification message in this chat as soon as it is ready!`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: helpMarkup
                    }
                );
            }
            
            if (data === "bot_about") {
                await ctx.answerCbQuery();
                const aboutMarkup = {
                    inline_keyboard: [
                        [
                            {
                                text: "Launch Film House 🚀",
                                url: "https://t.me/Filmhouseappbot/filmhouseapp"
                            }
                        ],
                        [
                            { text: "« Back to Menu 🔙", callback_data: "bot_menu" }
                        ]
                    ]
                };

                return await editMessageInPlace(
                    `ℹ️ *About Film House*\n\n` +
                    `Film House is your ultimate Telegram movie library.\n` +
                    `• Direct high-speed downloads.\n` +
                    `• Custom request queue with instant automated DM notifications.\n` +
                    `• Built-in loyalty rewards system.`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: aboutMarkup
                    }
                );
            }

            if (data === "bot_menu") {
                await ctx.answerCbQuery();
                const menuMarkup = {
                    inline_keyboard: [
                        [
                            {
                                text: "Launch Film House 🚀",
                                url: "https://t.me/Filmhouseappbot/filmhouseapp"
                            }
                        ],
                        [
                            { text: "Help 📖", callback_data: "bot_help" },
                            { text: "About ℹ️", callback_data: "bot_about" }
                        ],
                        [
                            { text: "Join Channel 📢", url: "https://t.me/filmhouse_main" }
                        ]
                    ]
                };

                const welcomeCaption = `🍿 <b>Welcome to Film House, ${escapedFullName}!</b> 🍿\n\nTo start downloading movies & series:\n1. Click the <b>Launch Film House 🚀</b> button below to open the movie library.\n2. Tap any movie or season to unlock download links.\n3. Can't find a title? Request it inside the app and we will notify you here directly!\n\n<i>Make sure you join our channel @filmhouse_main to stay updated! 🤟</i>`;

                return await editMessageInPlace(welcomeCaption, {
                    parse_mode: 'HTML',
                    reply_markup: menuMarkup
                });
            }

            // --- Settings Card Navigation ---
            if (data === "settings_help") {
                await ctx.answerCbQuery();
                const helpMarkup = {
                    inline_keyboard: [
                        [
                            {
                                text: "Open Web App 🚀",
                                url: "https://t.me/Filmhouseappbot/filmhouseapp"
                            }
                        ],
                        [
                            { text: "« Back to Settings 🔙", callback_data: "settings_menu" }
                        ]
                    ]
                };

                return await editMessageInPlace(
                    `📖 *Film House Help & Guide*\n\n` +
                    `• Tap the *Launch Film House* button to open the movie catalog.\n` +
                    `• Select any movie or series to download.\n` +
                    `• If a title is missing, tap *Request* to submit it to our admins.\n` +
                    `• You will receive a direct notification message in this chat as soon as it is ready!`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: helpMarkup
                    }
                );
            }

            if (data === "settings_about") {
                await ctx.answerCbQuery();
                const aboutMarkup = {
                    inline_keyboard: [
                        [
                            {
                                text: "Open Web App 🚀",
                                url: "https://t.me/Filmhouseappbot/filmhouseapp"
                            }
                        ],
                        [
                            { text: "« Back to Settings 🔙", callback_data: "settings_menu" }
                        ]
                    ]
                };

                return await editMessageInPlace(
                    `ℹ️ *About Film House*\n\n` +
                    `Film House is your ultimate Telegram movie library.\n` +
                    `• Direct high-speed downloads.\n` +
                    `• Custom request queue with instant automated DM notifications.\n` +
                    `• Built-in loyalty rewards system.`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: aboutMarkup
                    }
                );
            }

            if (data === "settings_menu") {
                await ctx.answerCbQuery();
                try {
                    const userDoc = await db.collection("users").doc(userId).get();
                    if (userDoc.exists) {
                        const u = userDoc.data();
                        const points = u.points || 0;
                        const badge = u.badge || "No Active Badge";
                        
                        const settingsMarkup = {
                            inline_keyboard: [
                                [
                                    {
                                        text: "Open Web App 🚀",
                                        url: "https://t.me/Filmhouseappbot/filmhouseapp"
                                    }
                                ],
                                [
                                    { text: "Help 📖", callback_data: "settings_help" },
                                    { text: "About ℹ️", callback_data: "settings_about" }
                                ]
                            ]
                        };

                        await editMessageInPlace(
                            `👤 *Your Profile Status*\n\n` +
                            `• *Telegram ID:* \`${userId}\`\n` +
                            `• *Username:* @${u.username || "None"}\n` +
                            `• *Loyalty Points:* 🪙 \`${points.toLocaleString()}\` pts\n` +
                            `• *VIP Badge:* 🏆 \`${badge}\``,
                            { 
                                parse_mode: 'Markdown',
                                reply_markup: settingsMarkup
                            }
                        );
                    }
                } catch (dbErr) {
                    console.error("Error reloading settings in callback query:", dbErr);
                }
            }
        } catch (err) {
            console.error("Error in callback_query handler:", err);
        }
    });
}

// Bot Initializer
async function init() {
    let botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
        console.log("No TELEGRAM_BOT_TOKEN env variable found. Fetching from Firestore 'settings/telegram'...");
        try {
            const doc = await db.collection("settings").doc("telegram").get();
            if (doc.exists) {
                botToken = doc.data().botToken;
            }
        } catch (err) {
            console.error("Failed to fetch bot token from Firestore:", err);
        }
    }

    if (!botToken) {
        console.error("CRITICAL ERROR: No bot token found! Please save the Telegram Bot Token in the Admin Command Center settings, or set the TELEGRAM_BOT_TOKEN environment variable, then restart the bot.");
        process.exit(1);
    }

    try {
        const bot = new Telegraf(botToken);
        setupBot(bot);
        
        // Register Commands Menu in Telegram dynamically
        bot.telegram.setMyCommands([
            { command: 'start', description: 'Launch the Film House Web App 🚀' },
            { command: 'settings', description: 'View your profile & points status 🪙' },
            { command: 'help', description: 'Get details on how to use Film House 📖' },
            { command: 'broadcast', description: 'Broadcast Message to Users (Admins Only) 📢' },
            { command: 'ping', description: 'Check if the bot is alive 🏓' }
        ]).then(() => {
            console.log("Bot commands menu registered successfully!");
        }).catch(err => {
            console.error("Failed to register bot commands menu:", err);
        });

        bot.launch();
        console.log("Film House Bot successfully started! 🚀 Running command listener...");

        // Background loop for farming completion reminders
        setInterval(async () => {
            try {
                const now = Date.now();
                const duration = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
                const cutoff = now - duration;

                const snapshot = await db.collection("users")
                    .where("farmingStartedAt", ">", 0)
                    .where("farmingStartedAt", "<=", cutoff)
                    .get();

                snapshot.forEach(async (doc) => {
                    const userData = doc.data();
                    if (userData.farmingReminded === true) return;

                    const userId = doc.id;
                    try {
                        await bot.telegram.sendMessage(
                            userId,
                            `⚡ *Mining Session Complete!* ⚡\n\nYour 8-hour session has finished. Launch the app now to claim your *80 Loyalty Points* and start your next session! 🍿`,
                            {
                                parse_mode: "Markdown",
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            {
                                                text: "Claim Points 🪙",
                                                url: "https://t.me/Filmhouseappbot/filmhouseapp"
                                            }
                                        ]
                                    ]
                                }
                            }
                        );
                        await db.collection("users").doc(userId).update({
                            farmingReminded: true
                        });
                        console.log(`Farming completion notification sent to user ${userId}`);
                    } catch (notifyErr) {
                        // Mark as reminded anyway to prevent duplicate loop attempts
                        await db.collection("users").doc(userId).update({
                            farmingReminded: true
                        });
                        console.warn(`Could not send farming reminder to ${userId}:`, notifyErr.message);
                    }
                });
            } catch (err) {
                console.error("Error in farming reminder cron loop:", err);
            }
        }, 60 * 1000); // check every 60 seconds

        // Graceful stop hooks
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
    } catch (err) {
        console.error("Failed to launch Telegraf client:", err);
    }
}

init();
