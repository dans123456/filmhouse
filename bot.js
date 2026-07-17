const { Telegraf } = require("telegraf");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const http = require("http");

// Server PORT will be initialized dynamically in the init() function based on Webhook/Polling mode.

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

    // In-memory rate limiting map (cooldown) to prevent command spamming
    const commandCooldowns = new Map();
    bot.use(async (ctx, next) => {
        if (!ctx.from || !ctx.message) return next();
        const userId = String(ctx.from.id);
        const now = Date.now();
        const lastTime = commandCooldowns.get(userId) || 0;
        
        if (now - lastTime < 1000) { // 1 second cooldown per message/command
            console.log(`Rate limiting user ${userId} to prevent spam.`);
            return; // silently discard the update to prevent spamming
        }
        
        commandCooldowns.set(userId, now);
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
            const masterList = doc.exists ? doc.data().masters || [] : [];
            const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));
            return allAdmins.includes(String(userId));
        } catch (err) {
            console.warn("Failed to read admin list from Firestore, falling back to default admins:", err);
            return defaultAdmins.includes(String(userId));
        }
    }

    // Helper: Check if user is an authorized master admin
    async function isMasterAdmin(userId) {
        const defaultAdmins = ["1329840839", "1175336733"];
        try {
            const doc = await db.collection("settings").doc("admins").get();
            const masters = doc.exists ? doc.data().masters || [] : [];
            const allMasters = [...defaultAdmins, ...masters];
            return allMasters.includes(String(userId));
        } catch (err) {
            console.warn("Failed to read master admin list from Firestore, falling back to default admins:", err);
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
        let isNewUser = false;
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
                isNewUser = true;
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

        // Process referral points if user joined via shared link
        if (payload && payload.startsWith("ref_")) {
            const referrerId = payload.substring(4);
            if (referrerId === userId) {
                // Self-referral check
                await ctx.reply("⚠️ *You cannot refer yourself!* Share your link with friends to earn points. 🎁", { parse_mode: "Markdown" }).catch(err => console.warn(err));
            } else if (isNewUser) {
                try {
                    const referrerRef = db.collection("users").doc(referrerId);
                    const referrerDoc = await referrerRef.get();
                    if (referrerDoc.exists) {
                        const referrerData = referrerDoc.data();
                        const currentPoints = referrerData.points || 0;
                        const newPoints = currentPoints + 5;
                        const breakdown = referrerData.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 };
                        breakdown.shares = (breakdown.shares || 0) + 1;

                        await referrerRef.update({
                            points: newPoints,
                            pointsBreakdown: breakdown
                        });

                        // Notify the referrer privately in their bot DM
                        await ctx.telegram.sendMessage(
                            referrerId,
                            `🔔 *New Referral!* 🔔\n\n` +
                            `Your friend *${fullName}* has joined Film House using your invite link! 🎉\n\n` +
                            `You have been awarded *+5 Loyalty Points*! 🏆`,
                            { parse_mode: "Markdown" }
                        ).catch(err => console.warn(`Failed to send referral message to ${referrerId}:`, err));
                    }
                } catch (err) {
                    console.error("Error processing referral points:", err);
                }
            } else {
                // User already exists in database
                await ctx.reply("ℹ️ *You are already a member of Film House!* Invite links only award points for new users who join for the first time. 🍿", { parse_mode: "Markdown" }).catch(err => console.warn(err));
            }
        }
        if (payload && payload.startsWith("claim_")) {
            const docId = payload.substring(6);
            try {
                const docRef = db.collection("requests").doc(docId);
                const doc = await docRef.get();
                if (doc.exists) {
                    const reqData = doc.data();

                    // If already claimed, don't send the duplicate message
                    if (reqData.claimed === true || reqData.status === "claimed") {
                        console.log(`Request ${docId} is already claimed. Skipping duplicate bot message.`);
                        return;
                    }

                    // Mark as claimed in Firestore
                    await docRef.update({
                        claimed: true,
                        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
                        status: "claimed"
                    });

                    // Send the download link directly to the user
                    const dlLink = reqData.downloadLink;
                    if (dlLink) {
                        const yearSuffix = reqData.year ? ` (${reqData.year})` : "";
                        return await ctx.reply(
                            `🍿 *Your Requested Movie is Ready!* 🍿\n\n` +
                            `Here is your direct download link for *${reqData.title}*${yearSuffix}:\n` +
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

        // Load custom welcome config from Firestore settings/welcome
        let welcomeText = null;
        let welcomePhotoFileId = null;
        let welcomePhotoUrl = null;
        try {
            const welcomeDoc = await db.collection("settings").doc("welcome").get();
            if (welcomeDoc.exists) {
                const welcomeData = welcomeDoc.data();
                welcomeText = welcomeData.text || null;
                welcomePhotoFileId = welcomeData.fileId || null;
                welcomePhotoUrl = welcomeData.photoUrl || null;
            }
        } catch (err) {
            console.warn("Failed to load custom welcome settings:", err);
        }

        let caption = "";
        if (welcomeText) {
            caption = welcomeText
                .replace(/{name}/g, escapedFullName)
                .replace(/{fullname}/g, escapedFullName)
                .replace(/{username}/g, username);
        } else {
            caption = `🍿 <b>Welcome to Film House, ${escapedFullName}!</b> 🍿\n\nTo start downloading movies & series:\n1. Click the <b>Launch Film House 🚀</b> button below to open the movie library.\n2. Tap any movie or season to unlock download links.\n3. Can't find a title? Request it inside the app and we will notify you here directly!\n\n<i>Make sure you join our channel @filmhouse_main to stay updated! 🤟</i>`;
        }

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

        if (welcomePhotoFileId) {
            try {
                return await ctx.replyWithPhoto(
                    welcomePhotoFileId,
                    {
                        caption: caption,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    }
                );
            } catch (err) {
                console.error("Failed to send welcome photo file ID, falling back to text:", err);
            }
        } else if (welcomePhotoUrl) {
            try {
                return await ctx.replyWithPhoto(
                    welcomePhotoUrl,
                    {
                        caption: caption,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    }
                );
            } catch (err) {
                console.error("Failed to send welcome photo URL, falling back to text:", err);
            }
        } else {
            const imagePath = path.join(__dirname, "MOVIE", "img", "FilmHouse.png");
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
                }
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
        if (!(await isMasterAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to Master Administrators.");
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
        if (!(await isMasterAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to Master Administrators.");
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
        if (!(await isMasterAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to Master Administrators.");
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

    // Command: /setwelcomecaption <text> (Admin Only)
    bot.command('setwelcomecaption', async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isMasterAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to Master Administrators.");
        }

        const newCaption = ctx.message.text.substring(18).trim(); // remove "/setwelcomecaption" prefix
        if (!newCaption) {
            return ctx.reply(
                "📝 *How to use /setwelcomecaption*:\n\n" +
                "Type: `/setwelcomecaption <welcome text>`\n\n" +
                "You can use placeholders like `{name}` or `{username}` which will be automatically replaced with the visitor's name/username.\n" +
                "For example:\n`/setwelcomecaption Welcome {name} to Film House! 🍿`",
                { parse_mode: 'Markdown' }
            );
        }

        try {
            await db.collection("settings").doc("welcome").set({
                text: newCaption
            }, { merge: true });

            return ctx.reply("✅ *Welcome text caption has been successfully updated!*", { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Error setting welcome caption:", err);
            return ctx.reply("❌ Failed to update welcome caption in Firestore.");
        }
    });

    // Command: /setwelcomephoto (Admin Only)
    bot.command('setwelcomephoto', async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isMasterAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to Master Administrators.");
        }

        let photoMsg = null;
        if (ctx.message.reply_to_message && ctx.message.reply_to_message.photo) {
            photoMsg = ctx.message.reply_to_message;
        } else if (ctx.message.photo) {
            photoMsg = ctx.message;
        }

        if (!photoMsg) {
            return ctx.reply(
                "🖼️ *How to use /setwelcomephoto*:\n\n" +
                "• *Method 1*: Send a photo directly to this chat, then *Reply* to it with the command `/setwelcomephoto`.\n" +
                "• *Method 2*: Upload a photo and set its *Caption* directly to `/setwelcomephoto`.",
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const photoArray = photoMsg.photo;
            const highestResPhoto = photoArray[photoArray.length - 1];
            const fileId = highestResPhoto.file_id;

            await db.collection("settings").doc("welcome").set({
                fileId: fileId,
                photoUrl: null // clear URL to prioritize fileId
            }, { merge: true });

            return ctx.reply("✅ *Welcome photo has been successfully updated!*", { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Error setting welcome photo:", err);
            return ctx.reply("❌ Failed to update welcome photo in Firestore.");
        }
    });

    // Command: /resetwelcome (Admin Only)
    bot.command('resetwelcome', async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isMasterAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to Master Administrators.");
        }

        try {
            await db.collection("settings").doc("welcome").delete();
            return ctx.reply("🔄 *Welcome settings have been reset to app default values.*", { parse_mode: 'Markdown' });
        } catch (err) {
            console.error("Error deleting welcome doc:", err);
            return ctx.reply("❌ Failed to delete welcome document in Firestore.");
        }
    });

    // Default reply for regular text messages (Automation)
    bot.on('text', async (ctx) => {
        // Forward group messages to admins or notify them
        if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
            const userId = String(ctx.from.id);
            const userTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
            const text = ctx.message.text;
            
            const defaultAdmins = ["1329840839", "1175336733"];
            const notifyText = `💬 *New Message in Group!*\n\n*From:* ${userTag} (ID: \`${userId}\`)\n*Message:* ${text}`;
            
            for (const adminId of defaultAdmins) {
                try {
                    await ctx.telegram.sendMessage(adminId, notifyText, { parse_mode: "Markdown" });
                } catch (e) {
                    console.warn(`Could not notify admin ${adminId} of group message:`, e.message);
                }
            }
            return;
        }

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

// Automatic Weekly Firestore Database Backup to CSV
async function checkAndRunWeeklyBackup(bot) {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];
        
        const backupDoc = await db.collection("settings").doc("backup").get();
        let lastBackupDateStr = "";
        if (backupDoc.exists) {
            lastBackupDateStr = backupDoc.data().lastBackupDate || "";
        }
        
        let shouldBackup = false;
        if (!lastBackupDateStr) {
            shouldBackup = true;
        } else {
            const lastDate = new Date(lastBackupDateStr);
            const diffTime = Math.abs(today - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays >= 7) {
                shouldBackup = true;
            }
        }
        
        if (shouldBackup) {
            console.log("Running weekly database backup...");
            const snapshot = await db.collection("movies").get();
            if (snapshot.empty) {
                console.log("Movies collection is empty. Skipping CSV backup.");
                return;
            }
            
            const fields = [
                "csv_id", "tmdb_id", "imdb_id", "title", "type", 
                "categories", "genres", "overview", "poster", 
                "backdrop", "rating", "release_date", "language", 
                "cast", "director", "trailer", "runtime", "links"
            ];
            
            let csvRows = [];
            csvRows.push(fields.join(",")); // CSV Header
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const row = fields.map(field => {
                    let val = data[field];
                    if (val === undefined || val === null) return "";
                    let str = "";
                    if (Array.isArray(val)) {
                        str = val.join(", ");
                    } else {
                        str = String(val);
                    }
                    str = str.replace(/"/g, '""');
                    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
                        str = `"${str}"`;
                    }
                    return str;
                });
                csvRows.push(row.join(","));
            });
            
            const csvContent = csvRows.join("\n");
            
            // Get Master Admin IDs
            const adminDoc = await db.collection("settings").doc("admins").get();
            const defaultAdmins = ["1329840839", "1175336733"];
            let masters = [...defaultAdmins];
            if (adminDoc.exists) {
                const data = adminDoc.data();
                if (data.masters) {
                    masters = Array.from(new Set([...masters, ...data.masters.map(String)]));
                }
            }
            
            // Send CSV to all Master Admins
            const csvBuffer = Buffer.from(csvContent, "utf-8");
            for (const adminId of masters) {
                try {
                    await bot.telegram.sendDocument(adminId, {
                        source: csvBuffer,
                        filename: `filmhouse_catalog_backup_${todayStr}.csv`
                    }, {
                        caption: `📅 *Weekly Film House Catalog Backup*\n\nContains *${snapshot.size}* items. Keep this safe! 🍿`,
                        parse_mode: "Markdown"
                    });
                } catch (e) {
                    console.warn(`Failed to send weekly backup file to admin ${adminId}:`, e.message);
                }
            }
            
            // Save state in Firestore settings/backup
            await db.collection("settings").doc("backup").set({
                lastBackupDate: todayStr,
                itemCount: snapshot.size,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log("Weekly database backup complete.");
        }
    } catch (err) {
        console.error("Weekly backup error:", err);
    }
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

        let webhookUrl = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;
        if (!webhookUrl) {
            try {
                const doc = await db.collection("settings").doc("telegram").get();
                if (doc.exists) {
                    webhookUrl = doc.data().webhookUrl;
                }
            } catch (err) {
                console.error("Failed to fetch webhook URL from Firestore:", err);
            }
        }

        const PORT = process.env.PORT || 3000;
        let server;

        if (webhookUrl) {
            console.log(`Configuring Webhook mode with base URL: ${webhookUrl}`);
            const secretPath = `/telegraf/${bot.secretPathComponent()}`;
            const webhookCallback = bot.webhookCallback(secretPath);
            
            server = http.createServer((req, res) => {
                if (req.url === secretPath) {
                    webhookCallback(req, res);
                } else if (req.url === '/debug-info') {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        tokenPrefix: botToken ? botToken.substring(0, 12) : "missing",
                        secretPath: secretPath,
                        webhookUrl: webhookUrl
                    }));
                } else if (req.url === '/' || req.url === '/healthz') {
                    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
                    res.end("Film House Bot is active and running! 🍿");
                } else {
                    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                    res.end("Not Found");
                }
            });
            
            server.listen(PORT, () => {
                console.log(`Bot HTTP server listening on port ${PORT} in Webhook mode.`);
            });
            
            const webhookTargetUrl = webhookUrl.endsWith('/') ? `${webhookUrl}${secretPath.substring(1)}` : `${webhookUrl}${secretPath}`;
            bot.telegram.setWebhook(webhookTargetUrl)
                .then(() => {
                    console.log(`Telegram Webhook set successfully to: ${webhookTargetUrl}`);
                })
                .catch(err => {
                    console.error("Failed to set Telegram Webhook:", err);
                });

            // Start self-ping keep-alive loop (every 10 minutes)
            setInterval(() => {
                const pingUrl = webhookUrl.endsWith('/') ? `${webhookUrl}healthz` : `${webhookUrl}/healthz`;
                const protocol = pingUrl.startsWith('https') ? require('https') : require('http');
                protocol.get(pingUrl, (res) => {
                    console.log(`Keep-alive self-ping sent to ${pingUrl}. Status: ${res.statusCode}`);
                }).on('error', (err) => {
                    console.warn(`Keep-alive self-ping failed: ${err.message}`);
                });
            }, 10 * 60 * 1000);
        } else {
            console.log("No Webhook URL configured. Defaulting to Polling mode.");
            server = http.createServer((req, res) => {
                if (req.url === '/debug-info') {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        tokenPrefix: botToken ? botToken.substring(0, 12) : "missing",
                        mode: "polling"
                    }));
                } else if (req.url === '/' || req.url === '/healthz') {
                    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
                    res.end("Film House Bot is active and running (Polling)! 🍿");
                } else {
                    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                    res.end("Not Found");
                }
            });
            
            server.listen(PORT, () => {
                console.log(`Dummy health check HTTP server listening on port ${PORT} (Polling mode).`);
            });
            
            bot.launch();
            console.log("Film House Bot successfully started! 🚀 Running command listener (Polling)...");
        }

        // Real-time status synchronization to Firestore settings/bot_status
        const updateBotStatus = async (statusStr = "online") => {
            try {
                await db.collection("settings").doc("bot_status").set({
                    lastPing: admin.firestore.FieldValue.serverTimestamp(),
                    mode: webhookUrl ? "webhook" : "polling",
                    port: PORT,
                    webhookUrl: webhookUrl || null,
                    status: statusStr
                });

                // Self-healing webhook check if in webhook mode
                if (webhookUrl && statusStr === "online") {
                    const secretPath = `/telegraf/${bot.secretPathComponent()}`;
                    const webhookTargetUrl = webhookUrl.endsWith('/') ? `${webhookUrl}${secretPath.substring(1)}` : `${webhookUrl}${secretPath}`;
                    
                    try {
                        const info = await bot.telegram.getWebhookInfo();
                        if (info.url !== webhookTargetUrl) {
                            console.log(`Webhook mismatch detected. Current: "${info.url}", Expected: "${webhookTargetUrl}". Re-registering...`);
                            await bot.telegram.setWebhook(webhookTargetUrl);
                            console.log(`Telegram Webhook self-healed and set successfully to: ${webhookTargetUrl}`);
                        }
                    } catch (err) {
                        console.warn("Failed to check/set webhook during status update:", err.message);
                    }
                }
            } catch (e) {
                console.error("Failed to update bot status in Firestore:", e);
            }
        };

        // Initial sync and periodic sync (every 60 seconds)
        updateBotStatus("online");
        const statusInterval = setInterval(() => updateBotStatus("online"), 60 * 1000);

        // Start weekly movie catalog backup checker
        setInterval(async () => {
            await checkAndRunWeeklyBackup(bot);
        }, 12 * 60 * 60 * 1000); // Check every 12 hours
        // Check once immediately on startup
        checkAndRunWeeklyBackup(bot);

        // Real-time listener for admin triggered manual reminders
        db.collection("admin_reminders").onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    if (data.timestamp) {
                        const docMs = data.timestamp.toMillis ? data.timestamp.toMillis() : new Date(data.timestamp).getTime();
                        if (Date.now() - docMs > 15000) return; // Skip historical records on startup
                    }
                    
                    const userId = data.userId;
                    const type = data.type;
                    
                    if (type === "mine" && userId) {
                        const text = `👋 *Hey there!*\n\nOur team noticed your mining rig is idle! 🪙 Don't forget to launch the app, start your mining session, and complete your daily missions to earn *Loyalty Points*! \n\nYou can use your points to request new movies/series and unlock downloads! 🚀`;
                        
                        if (userId === "all_idle") {
                            console.log("Triggering bulk mine reminder to all idle users...");
                            try {
                                const usersSnapshot = await db.collection("users").get();
                                let count = 0;
                                for (const userDoc of usersSnapshot.docs) {
                                    const userData = userDoc.data();
                                    const farmingStartedAt = userData.farmingStartedAt || 0;
                                    const uid = userDoc.id;
                                    
                                    if (farmingStartedAt === 0) {
                                        try {
                                            await bot.telegram.sendMessage(uid, text, {
                                                parse_mode: "Markdown",
                                                reply_markup: {
                                                    inline_keyboard: [
                                                        [
                                                            {
                                                                text: "Launch App & Start Mining 🪙",
                                                                url: "https://t.me/Filmhouseappbot/filmhouseapp?startapp=mining"
                                                            }
                                                        ]
                                                    ]
                                                }
                                            });
                                            count++;
                                            // Sleep 50ms to respect Telegram limits
                                            await new Promise(resolve => setTimeout(resolve, 50));
                                        } catch (e) {
                                            console.warn(`Failed to send bulk reminder to user ${uid}:`, e.message);
                                        }
                                    }
                                }
                                console.log(`Bulk mine reminder completed. Reminded ${count} idle users.`);
                            } catch (err) {
                                console.error("Error executing bulk reminder database query:", err);
                            }
                        } else {
                            try {
                                await bot.telegram.sendMessage(userId, text, {
                                    parse_mode: "Markdown",
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                {
                                                    text: "Launch App & Start Mining 🪙",
                                                    url: "https://t.me/Filmhouseappbot/filmhouseapp?startapp=mining"
                                                }
                                            ]
                                        ]
                                    }
                                });
                                console.log(`Manual mine reminder successfully sent to user ${userId}`);
                            } catch (e) {
                                console.warn(`Failed to send manual mine reminder to ${userId}:`, e.message);
                            }
                        }
                    }
                }
            });
        }, (err) => console.error("Admin reminders listener error:", err));

        // Real-time listener for feedbacks additions (sends direct Telegram message to admins)
        db.collection("feedbacks").onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    // Avoid sending notifications for historical documents on initial connection
                    if (data.timestamp) {
                        const docMs = data.timestamp.toMillis ? data.timestamp.toMillis() : new Date(data.timestamp).getTime();
                        if (Date.now() - docMs > 15000) return;
                    }
                    const user = data.user || "guest";
                    const userId = data.userId || "unknown";
                    const category = data.category || "General";
                    const subject = data.subject || "No Subject";
                    const msg = data.message || "No Message";

                    const adminText = `📝 *New Feedback Submitted!*\n\n*User:* @${user} (ID: \`${userId}\`)\n*Type:* ${category}\n*Subject:* ${subject}\n\n*Message:* ${msg}`;
                    
                    const defaultAdmins = ["1329840839", "1175336733"];
                    try {
                        const adminDoc = await db.collection("settings").doc("admins").get();
                        const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                        const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                        const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));
                        for (const adminId of allAdmins) {
                            try {
                                await bot.telegram.sendMessage(adminId, adminText, { parse_mode: "Markdown" });
                                console.log(`Feedback DM notification successfully sent to admin ${adminId}`);
                            } catch (e) {
                                console.warn(`Failed to notify admin ${adminId} of feedback:`, e.message);
                            }
                        }
                    } catch (err) {
                        console.error("Error fetching admin list for feedback notify:", err);
                    }
                }
            });
        }, (err) => console.error("Feedbacks listener error:", err));

        // Real-time listener for requests additions and status changes (boosted, claimed, fulfilled)
        db.collection("requests").onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                const data = change.doc.data();
                const docId = change.doc.id;
                
                let userId = data.userId || data.requestedById;
                if (userId === "undefined" || !userId) {
                    userId = data.requestedById;
                }
                
                const title = data.title;
                const type = data.type;
                const year = data.year || "";
                const username = data.user || data.requestedBy || "guest";
                const downloadLink = data.downloadLink;
                const timestamp = data.timestamp || data.requestedAt;

                if (userId === "undefined" || !userId) return;

                const yearSuffix = year ? ` (${year})` : "";

                if (change.type === "added") {
                    if (timestamp) {
                        const docMs = timestamp.toMillis ? timestamp.toMillis() : new Date(timestamp).getTime();
                        if (Date.now() - docMs > 15000) return; // skip historical
                    }

                    // 1. Send confirmation to requesting user
                    const canBoost = !data.boosted;
                    const text = `🍿 *Request Received!*\n\nYour request for *${title}*${yearSuffix} (${type}) has been logged in our queue.\n\n` +
                        (canBoost 
                            ? `💡 *Boost Available!* You can boost this request to *High Priority* for 1,000 points to get it faster! 🚀`
                            : `We will notify you here as soon as it is fulfilled! 🚀`);

                    const replyMarkup = canBoost ? {
                        inline_keyboard: [
                            [
                                {
                                    text: "Boost Request 🚀 (1,000 pts)",
                                    url: `https://t.me/Filmhouseappbot/filmhouseapp?startapp=boost_${docId}`
                                }
                            ]
                        ]
                    } : undefined;

                    try {
                        await bot.telegram.sendMessage(userId, text, {
                            parse_mode: "Markdown",
                            reply_markup: replyMarkup
                        });
                    } catch (e) {
                        console.warn(`Failed to send request confirmation to ${userId}:`, e.message);
                    }

                    // 2. Notify admins
                    const adminText = `🍿 *New Movie Request!*\n\n*User:* @${username} (ID: \`${userId}\`)\n*Title:* ${title}${yearSuffix} (${type})`;
                    const defaultAdmins = ["1329840839", "1175336733"];
                    try {
                        const adminDoc = await db.collection("settings").doc("admins").get();
                        const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                        const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                        const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));
                        for (const adminId of allAdmins) {
                            try {
                                await bot.telegram.sendMessage(adminId, adminText, { parse_mode: "Markdown" });
                            } catch (e) {
                                console.warn(`Failed to notify admin ${adminId} of request:`, e.message);
                            }
                        }
                    } catch (err) {
                        console.error("Error fetching admin list for request notify:", err);
                    }

                } else if (change.type === "modified") {
                    if (data.status === "priority" && data.notifiedPriority !== true) {
                        // Mark as notified in Firestore
                        await db.collection("requests").doc(docId).update({ notifiedPriority: true }).catch(() => {});

                        const text = `🚀 *Request Boosted!*\n\nYour request for *${title}*${yearSuffix} has been successfully boosted to *High Priority*! Our team is on it! 🍿`;
                        try {
                            await bot.telegram.sendMessage(userId, text, { parse_mode: "Markdown" });
                        } catch (e) {
                            console.warn(`Failed to send boost confirmation to ${userId}:`, e.message);
                        }

                        // Notify admins of the boost
                        const adminText = `⚡ *Movie Request Boosted to Priority!*\n\n*User:* @${username} (ID: \`${userId}\`)\n*Title:* ${title}${yearSuffix} (${type})`;
                        const defaultAdmins = ["1329840839", "1175336733"];
                        try {
                            const adminDoc = await db.collection("settings").doc("admins").get();
                            const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                            const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                            const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));
                            for (const adminId of allAdmins) {
                                try {
                                    await bot.telegram.sendMessage(adminId, adminText, { parse_mode: "Markdown" });
                                } catch (e) {
                                    console.warn(`Failed to notify admin ${adminId} of boost:`, e.message);
                                }
                            }
                        } catch (err) {}
                    }

                    if (data.status === "fulfilled" && data.notifiedFulfilled !== true && downloadLink) {
                        await db.collection("requests").doc(docId).update({ notifiedFulfilled: true }).catch(() => {});

                        const isSeries = (data.type || "").toLowerCase() === "series" || (data.type || "").toLowerCase() === "tv";
                        let detailText = "";
                        let buttonText = "Download/Watch Now 🎬";
                        if (isSeries) {
                            detailText = "💡 *Note:* This is a Series request. The button below contains *Season 1 only*. To download or watch the remaining seasons, please open the Film House App! 📺";
                            buttonText = "Get Season 1 🍿";
                        } else {
                            detailText = "💡 *Note:* This is a single movie request, so this contains the full film. Enjoy! 🍿";
                            buttonText = "Get Movie 🎬";
                        }

                        const text = `🎉 *Good news!*\n\n` +
                                     `Your request for *${title}*${yearSuffix} has been fulfilled! 🍿\n\n` +
                                     `${detailText}\n\n` +
                                     `Thank you for using Film House!`;
                        try {
                            await bot.telegram.sendMessage(userId, text, {
                                parse_mode: "Markdown",
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            {
                                                text: buttonText,
                                                url: downloadLink
                                            }
                                        ]
                                    ]
                                }
                            });
                        } catch (e) {
                            console.warn(`Failed to send fulfillment notification to ${userId}:`, e.message);
                        }
                    }


                }
            });
        }, (err) => console.error("Requests listener error:", err));

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
                                                url: "https://t.me/Filmhouseappbot/filmhouseapp?startapp=mining"
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

        // Graceful shutdown hooks
        const handleShutdown = async (signal) => {
            console.log(`Received ${signal}. Shutting down gracefully...`);
            clearInterval(statusInterval);
            try {
                await db.collection("settings").doc("bot_status").set({
                    lastPing: admin.firestore.FieldValue.serverTimestamp(),
                    mode: webhookUrl ? "webhook" : "polling",
                    status: "offline"
                });
            } catch (e) {}
            bot.stop(signal);
            process.exit(0);
        };
        
        process.once('SIGINT', () => handleShutdown('SIGINT'));
        process.once('SIGTERM', () => handleShutdown('SIGTERM'));
    } catch (err) {
        console.error("Failed to launch Telegraf client:", err);
    }
}

// Global process-level error handling to prevent the bot from crashing
process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception thrown:", error);
});

init();
