const { Telegraf } = require("telegraf");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Initialize Firebase Admin
if (process.env.FIREBASE_CONFIG) {
    admin.initializeApp();
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

        const imagePath = path.join(__dirname, "MOVIE", "img", "FilmHouse.png");
        const caption = `Hey There 🗣️ *${fullName}* 😎 😊, I'm 🍿 *Film House* 🍿's cloud bot. You can access all Series 🙈 and Movies 😌 through me. Just Make sure you are a member of our Channel @FilmHouseBUP 🤟`;

        const replyMarkup = {
            inline_keyboard: [
                [
                    {
                        text: "Launch Film House 🚀",
                        web_app: { url: "https://t.me/Filmhouseappbot/filmhouseapp" }
                    }
                ],
                [
                    { text: "Help 📖", callback_data: "bot_help" },
                    { text: "About ℹ️", callback_data: "bot_about" }
                ],
                [
                    { text: "Join Channel 📢", url: "https://t.me/FilmHouseBUP" }
                ]
            ]
        };

        if (fs.existsSync(imagePath)) {
            try {
                return await ctx.replyWithPhoto(
                    { source: imagePath },
                    {
                        caption: caption,
                        parse_mode: 'Markdown',
                        reply_markup: replyMarkup
                    }
                );
            } catch (err) {
                console.error("Failed to send welcome photo:", err);
            }
        }
        
        return ctx.reply(caption, {
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
        });
    });

    // Command: /help
    bot.command('help', (ctx) => {
        return ctx.reply(
            `📖 *Film House Help & Guide*\n\n` +
            `• Click the *Launch Film House* button to open the movie library.\n` +
            `• Request films or series directly inside the app if they aren't available.\n` +
            `• You will receive a direct notification message when your requests are fulfilled!\n\n` +
            `*Commands List:*\n` +
            `/start - Open the welcome screen and launch app\n` +
            `/settings - View your profile info and points status\n` +
            `/help - Display this help guide\n\n` +
            `_Admins Only:_\n` +
            `/broadcast <msg> - Broadcast a message to all users\n` +
            `/ban <user_id> - Ban a user from the bot and app\n` +
            `/unban <user_id> - Unban a restricted user`,
            { parse_mode: 'Markdown' }
        );
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
            
            return ctx.reply(
                `👤 *Your Profile Status*\n\n` +
                `• *Telegram ID:* \`${userId}\`\n` +
                `• *Username:* @${u.username || "None"}\n` +
                `• *Loyalty Points:* 🪙 \`${points.toLocaleString()}\` pts\n` +
                `• *VIP Badge:* 🏆 \`${badge}\``,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            console.error("Error loading settings:", err);
            return ctx.reply("❌ Error loading your profile settings.");
        }
    });

    // Command: /broadcast (Admin Only)
    bot.command('broadcast', async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to administrators.");
        }

        const messageText = ctx.message.text.substring(10).trim(); // remove "/broadcast" prefix
        if (!messageText) {
            return ctx.reply("Please specify a message to broadcast. Format: `/broadcast <message>`", { parse_mode: 'Markdown' });
        }

        ctx.reply("✈️ *Starting broadcast...*", { parse_mode: 'Markdown' });

        try {
            const snapshot = await db.collection("users").get();
            let successCount = 0;
            let failedCount = 0;

            for (const doc of snapshot.docs) {
                const u = doc.data();
                if (u.id) {
                    try {
                        await ctx.telegram.sendMessage(u.id, messageText, { parse_mode: "Markdown" });
                        successCount++;
                    } catch (err) {
                        failedCount++;
                    }
                    // Rate limiting delay
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            return ctx.reply(`📢 *Broadcast Finished*\n\n🟢 Success: \`${successCount}\`\n🔴 Failed: \`${failedCount}\``, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Broadcast failed:", err);
            return ctx.reply(`❌ Broadcast failed: ${err.message}`);
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
            `🤖 *Hello!* I am the Film House Bot.\n\nTo search, request, or watch movies/series, please tap the button below to launch the Film House Web App! 🍿`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Launch Film House 🚀",
                                web_app: { url: "https://t.me/Filmhouseappbot/filmhouseapp" }
                            }
                        ]
                    ]
                }
            }
    });

    // Callback Query Handler for Inline Buttons
    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery.data;
        
        try {
            if (data === "bot_help") {
                await ctx.answerCbQuery();
                return ctx.reply(
                    `📖 *Film House Help & Guide*\n\n` +
                    `• Tap the *Launch Film House* button to open the movie catalog.\n` +
                    `• Select any movie or series to watch/download.\n` +
                    `• If a title is missing, tap *Request* to submit it to our admins.\n` +
                    `• You will receive a direct notification message in this chat as soon as it is ready!`,
                    { parse_mode: 'Markdown' }
                );
            }
            
            if (data === "bot_about") {
                await ctx.answerCbQuery();
                return ctx.reply(
                    `ℹ️ *About Film House*\n\n` +
                    `Film House is your ultimate Telegram movie library.\n` +
                    `• Fast streaming & direct high-speed downloads.\n` +
                    `• Custom request queue with instant automated DM notifications.\n` +
                    `• Built-in loyalty rewards system.`,
                    { parse_mode: 'Markdown' }
                );
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
            { command: 'help', description: 'Get details on how to use Film House 📖' }
        ]).then(() => {
            console.log("Bot commands menu registered successfully!");
        }).catch(err => {
            console.error("Failed to register bot commands menu:", err);
        });

        bot.launch();
        console.log("Film House Bot successfully started! 🚀 Running command listener...");

        // Graceful stop hooks
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
    } catch (err) {
        console.error("Failed to launch Telegraf client:", err);
    }
}

init();
