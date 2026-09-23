try { require("dotenv").config(); } catch (e) {}
const { Telegraf } = require("telegraf");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const LocalUserStore = require("./localStore");
const localStore = new LocalUserStore();

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
        console.error("Failed to load ./firebase-key.json:", err.message);
        admin.initializeApp({
            projectId: "film-house-2"
        });
    }
}

const db = admin.firestore();

// HTML escaping helper for clean Telegram formatting
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Global Telegram helpers and pending requests store (module-scoped for access across setupBot and init)
let callTelegramWithRetry = async () => {};
let callAdminTelegramWithRetry = async () => {};
const PENDING_FILE = path.join(__dirname, "data", "pending_requests.json");
let cachedPendingRequests = [];

// Load persisted pending requests from disk (immune to Firestore quota)
try {
    if (fs.existsSync(PENDING_FILE)) {
        const raw = fs.readFileSync(PENDING_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) cachedPendingRequests = parsed;
        console.log(`[PendingStore] Loaded ${cachedPendingRequests.length} pending requests from disk.`);
    }
} catch (e) {}

const savePendingRequestsToDisk = (requests) => {
    try {
        const dir = path.dirname(PENDING_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PENDING_FILE, JSON.stringify(requests, null, 2), "utf8");
    } catch (e) {
        console.error("Failed to save pending requests to disk:", e.message);
    }
};

// Bot setup helper
function setupBot(bot, adminBot) {
    let disableImmediateBlockedBotWrite = false;

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
        if (ctx.from) {
            localStore.upsertUser({
                id: userId,
                username: ctx.from.username || "",
                fullName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Telegram User"
            });
        }
        return next();
    });

    // In-memory cache for banned users and admin lists to eliminate per-update Firestore latency
    const bannedUsersCache = new Set();
    let cachedAdmins = ["1329840839", "1175336733"];
    let cachedMasters = ["1329840839", "1175336733"];
    let lastAdminFetchTime = 0;

    async function refreshAdminCache() {
        const now = Date.now();
        if (now - lastAdminFetchTime < 15 * 60 * 1000) return;
        lastAdminFetchTime = now;
        try {
            const adminPromise = db.collection("settings").doc("admins").get();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500));
            const doc = await Promise.race([adminPromise, timeoutPromise]);
            if (doc.exists) {
                const adminList = doc.data().ids || [];
                const masterList = doc.data().masters || [];
                cachedAdmins = Array.from(new Set(["1329840839", "1175336733", ...adminList, ...masterList]));
                cachedMasters = Array.from(new Set(["1329840839", "1175336733", ...masterList]));
            }
        } catch (e) {}
    }

    // Middleware to check if user is banned (Instant in-memory lookup - zero Firestore reads)
    bot.use(async (ctx, next) => {
        if (!ctx.from) return next();
        const userId = String(ctx.from.id);
        if (bannedUsersCache.has(userId)) {
            return ctx.reply("❌ Your access to Film House has been restricted.");
        }
        return next();
    });

    // Helper: Check if user is an authorized admin (Instant in-memory check)
    async function isAdmin(userId) {
        refreshAdminCache().catch(() => {});
        return cachedAdmins.includes(String(userId));
    }

    // Helper: Check if user is an authorized master admin (Instant in-memory check)
    async function isMasterAdmin(userId) {
        refreshAdminCache().catch(() => {});
        return cachedMasters.includes(String(userId));
    }

    // Helper: Call Telegram API with 429 rate limit retries and markdown error fallbacks
    callTelegramWithRetry = async function(methodName, ...args) {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await bot.telegram[methodName](...args);
            } catch (err) {
                // Check if rate limited (429)
                const isRateLimited = err.code === 429 || (err.parameters && err.parameters.retry_after);
                if (isRateLimited && attempt < maxAttempts) {
                    const waitTime = (err.parameters && err.parameters.retry_after) ? (err.parameters.retry_after * 1000) : 5000;
                    console.log(`Telegram API call ${methodName} rate limited. Waiting ${waitTime}ms before retry (attempt ${attempt}/${maxAttempts})...`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }
                
                // Check if markdown entities parsing failed
                if (methodName === 'sendMessage' && err.message && err.message.includes("can't parse entities")) {
                    console.warn(`Markdown parse failed. Retrying plain text for sendMessage: ${err.message}`);
                    try {
                        const plainOptions = { ...(args[2] || {}) };
                        delete plainOptions.parse_mode;
                        return await bot.telegram.sendMessage(args[0], args[1], plainOptions);
                    } catch (fallbackErr) {
                        throw fallbackErr;
                    }
                }
                
                // Check if the bot was blocked or chat wasn't found
                const isUserError = err.message && (err.message.includes("blocked") || err.message.includes("chat not found") || err.message.includes("deactivated"));
                const targetUserId = String(args[0]);
                if (isUserError && targetUserId && targetUserId !== "undefined" && !targetUserId.startsWith("-") && !disableImmediateBlockedBotWrite) {
                    console.log(`User ${targetUserId} has blocked the bot or chat was not found. Flagging in database.`);
                    await db.collection("users").doc(targetUserId).set({ blockedBot: true }, { merge: true }).catch(dbErr => {
                        console.error(`Error updating blockedBot status for ${targetUserId}:`, dbErr);
                    });
                }
                
                throw err;
            }
        }
    }

    // Helper: Call Admin Telegram Bot with fallback to public bot
    callAdminTelegramWithRetry = async function(methodName, ...args) {
        if (!adminBot) return callTelegramWithRetry(methodName, ...args);
        try {
            return await adminBot.telegram[methodName](...args);
        } catch (err) {
            console.warn(`Admin Bot call ${methodName} fallback to Public Bot:`, err.message);
            try {
                return await bot.telegram[methodName](...args);
            } catch (fbErr) {
                console.warn(`Public Bot fallback also failed:`, fbErr.message);
            }
        }
    };

    // ==========================================
    // DEDICATED ADMIN BOT SUITE (@Fiimhouse_adminBot)
    // ==========================================
    if (adminBot) {
        // Register Admin Bot commands with Telegram for native command menu
        adminBot.telegram.setMyCommands([
            { command: 'start', description: '👑 Admin Command Center' },
            { command: 'menu', description: '👑 Show Admin Menu' },
            { command: 'logs', description: '📜 View live server logs' },
            { command: 'pending', description: '📋 View pending movie requests' },
            { command: 'backup', description: '💾 Download weekly CSV backup' },
            { command: 'stats', description: '📊 Detailed server metrics' }
        ]).catch(err => console.warn('Could not set admin bot commands:', err.message));

        // Instant answer for all admin callbacks to eliminate UI lag/spinner
        adminBot.use(async (ctx, next) => {
            if (ctx.callbackQuery) {
                ctx.answerCbQuery().catch(() => {});
            }
            return next();
        });

        // Direct reply middleware for admin bot messages
        adminBot.use(async (ctx, next) => {
            const messageId = ctx.message ? ctx.message.message_id : undefined;
            if (messageId) {
                const originalReply = ctx.reply;
                ctx.reply = function (text, extra) {
                    return originalReply.call(ctx, text, Object.assign({ reply_to_message_id: messageId }, extra || {}));
                };
            }
            return next();
        });

        // Admin authorization gatekeeper
        adminBot.use(async (ctx, next) => {
            const userId = String(ctx.from ? ctx.from.id : "");
            if (!userId) return;
            const authorized = await isAdmin(userId);
            if (!authorized) {
                return ctx.reply("⛔ *Unauthorized Access*\n\nThis bot is strictly reserved for Film House Administrators.", { parse_mode: "Markdown" });
            }
            return next();
        });

        // Helper to read PM2 logs safely from disk
        const getRecentLogs = (type = "out") => {
            const isError = type.toLowerCase() === "error";
            const filePath = isError
                ? "/home/ubuntu/.pm2/logs/filmhouse-bot-error.log"
                : "/home/ubuntu/.pm2/logs/filmhouse-bot-out.log";

            if (!fs.existsSync(filePath)) {
                return `⚠️ Log file not found at: ${filePath}`;
            }

            try {
                const raw = fs.readFileSync(filePath, "utf8");
                const lines = raw.trim().split("\n").filter(l => l.trim().length > 0);
                const recent = lines.slice(-25).join("\n");
                return recent.length > 3500 ? recent.slice(-3500) : recent;
            } catch (err) {
                return `❌ Error reading log file: ${err.message}`;
            }
        };

        // Helper: Fetch pending requests fast with in-memory fallback
        const getPendingRequestsList = async () => {
            if (cachedPendingRequests.length > 0) return cachedPendingRequests;
            try {
                const fetchPromise = db.collection("requests").get();
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2500));
                const snap = await Promise.race([fetchPromise, timeoutPromise]);
                if (snap && snap.docs) {
                    cachedPendingRequests = snap.docs
                        .map(doc => ({ id: doc.id, ...doc.data() }))
                        .filter(r => r.status !== "fulfilled" && r.status !== "claimed" && !r.fulfilled && !r.claimed);
                    savePendingRequestsToDisk(cachedPendingRequests);
                }
            } catch (e) {
                console.error("Error fetching pending requests:", e.message);
            }
            return cachedPendingRequests;
        };

        // Render helper: edits existing message if callback query, otherwise replies with new message
        const renderOrEdit = async (ctx, payload) => {
            const options = {
                parse_mode: payload.parse_mode || "Markdown",
                reply_markup: {
                    inline_keyboard: payload.keyboard
                }
            };

            if (ctx.callbackQuery && ctx.callbackQuery.message) {
                try {
                    return await ctx.editMessageText(payload.text, options);
                } catch (err) {
                    if (err.message && err.message.includes("message is not modified")) {
                        return;
                    }
                    return await ctx.reply(payload.text, options);
                }
            } else {
                return await ctx.reply(payload.text, options);
            }
        };

        // View 1: Main Admin Menu / Command Center
        const getAdminMenuPayload = (adminName = 'Admin') => {
            const subCount = localStore.getCount();
            const mem = process.memoryUsage();
            const memoryMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
            const uptimeHours = (process.uptime() / 3600).toFixed(1);
            const pendingCount = cachedPendingRequests.length;

            const text = 
                `👑 *Film House Admin Command Center*\n\n` +
                `👋 Welcome, *${adminName}*!\n\n` +
                `📊 *Live System Overview:*\n` +
                `• 👥 *Subscribers (Ubuntu DB):* \`${subCount}\`\n` +
                `• ⏳ *Pending Requests:* \`${pendingCount}\`\n` +
                `• ⚡ *Server Uptime:* \`${uptimeHours} hrs\` (RAM: \`${memoryMB} MB\`)\n` +
                `• 🛡 *Public Bot:* Online & Polling\n` +
                `• 👑 *Admin Bot:* Active & Listening\n\n` +
                `🛠 *Available Commands:*\n` +
                `• /logs — View live server & bot logs\n` +
                `• /pending — View pending movie requests\n` +
                `• /backup — Download weekly CSV catalog backup\n` +
                `• /stats — Detailed server & subscriber metrics`;

            const keyboard = [
                [
                    { text: "📋 Pending Requests", callback_data: "admin_pending" },
                    { text: "📜 Server Logs", callback_data: "admin_logs" }
                ],
                [
                    { text: "💾 Download Backup", callback_data: "admin_backup" },
                    { text: "📊 System Stats", callback_data: "admin_stats" }
                ],
                [
                    { text: "🔄 Refresh Overview", callback_data: "admin_menu" }
                ]
            ];

            return { text, keyboard };
        };

        // View 2: Pending Requests
        const getPendingRequestsPayload = (requests = []) => {
            const list = requests.slice(0, 15);
            let msg = `📋 <b>Pending Movie Requests (${requests.length}):</b>\n\n`;
            if (requests.length === 0) {
                msg += `🎉 <b>All caught up!</b> There are no pending requests right now.\n\n`;
            } else {
                list.forEach((r, idx) => {
                    const isPrio = (r.status === "priority" || r.boosted);
                    const prioBadge = isPrio ? " 🔥 <b>[HIGH PRIORITY]</b>" : "";
                    const year = r.year ? ` (${escapeHtml(r.year)})` : "";
                    const cleanTitle = escapeHtml(r.title || "Movie");
                    const cleanType = escapeHtml(r.type || "Movie");
                    const user = escapeHtml(r.requestedBy || r.userId || 'guest');
                    msg += `${idx + 1}. <b>${cleanTitle}</b>${year}${prioBadge}\n   • 📁 <i>${cleanType}</i> | 👤 @${user}\n\n`;
                });
                if (requests.length > list.length) {
                    msg += `➕ <i>...and ${requests.length - list.length} more pending in queue.</i>\n\n`;
                }
                msg += `💡 Open the Admin Web App to fulfill these requests with download links!\n`;
            }

            const keyboard = [
                [
                    { text: "🔄 Refresh Requests", callback_data: "admin_pending" },
                    { text: "« Back to Menu", callback_data: "admin_menu" }
                ]
            ];

            return { text: msg, keyboard, parse_mode: "HTML" };
        };

        // View 3: Server Logs
        const getLogsPayload = (type = "out") => {
            const logs = getRecentLogs(type);
            const msg = `📜 *Live Film House Logs (${type.toUpperCase()} - Last 25 lines)*:\n\n` +
                        `\`\`\`\n${logs || 'No log entries found.'}\n\`\`\``;

            const keyboard = [
                type === "out"
                    ? [
                        { text: "🔄 Refresh Out", callback_data: "admin_logs_out" },
                        { text: "⚠️ Error Logs", callback_data: "admin_logs_error" }
                      ]
                    : [
                        { text: "📜 Out Logs", callback_data: "admin_logs_out" },
                        { text: "🔄 Refresh Errors", callback_data: "admin_logs_error" }
                      ],
                [
                    { text: "« Back to Menu", callback_data: "admin_menu" }
                ]
            ];

            return { text: msg, keyboard };
        };

        // View 4: System Stats
        const getStatsPayload = () => {
            const mem = process.memoryUsage();
            const heapUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
            const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
            const uptime = (process.uptime() / 3600).toFixed(2);
            const subscribers = localStore.getCount();

            const msg = 
                `📊 *Film House Server & Bot Statistics*\n\n` +
                `🖥 *Server Environment:* Oracle Cloud Always Free (Ubuntu 24.04 LTS)\n` +
                `⏱ *Process Uptime:* \`${uptime} hours\`\n` +
                `💾 *Memory:* \`${heapUsedMB} MB\` (Heap) / \`${rssMB} MB\` (RSS)\n` +
                `👥 *Local Subscribers:* \`${subscribers}\` users on disk\n` +
                `📁 *Local Database:* \`./data/bot_users.json\`\n` +
                `🛡 *Public Bot:* Polling mode active\n` +
                `👑 *Admin Bot:* Polling mode active`;

            const keyboard = [
                [
                    { text: "🔄 Refresh Stats", callback_data: "admin_stats" },
                    { text: "« Back to Menu", callback_data: "admin_menu" }
                ]
            ];

            return { text: msg, keyboard };
        };

        // Command: /start and /menu
        adminBot.command(['start', 'menu'], async (ctx) => {
            const adminName = ctx.from && ctx.from.first_name ? ctx.from.first_name : 'Admin';
            await getPendingRequestsList();
            return renderOrEdit(ctx, getAdminMenuPayload(adminName));
        });

        // Command: /logs [out|error]
        adminBot.command('logs', async (ctx) => {
            const text = (ctx.message && ctx.message.text ? ctx.message.text : "").toLowerCase();
            const type = text.includes("error") ? "error" : "out";
            return renderOrEdit(ctx, getLogsPayload(type));
        });

        // Command: /pending
        adminBot.command('pending', async (ctx) => {
            const list = await getPendingRequestsList();
            return renderOrEdit(ctx, getPendingRequestsPayload(list));
        });

        // Command: /stats
        adminBot.command('stats', async (ctx) => {
            return renderOrEdit(ctx, getStatsPayload());
        });

        // Command: /backup
        adminBot.command('backup', async (ctx) => {
            const generatingMsg = await ctx.reply("⏳ *Generating catalog backup CSV and sending document...*", {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                }
            });
            try {
                await checkAndRunWeeklyBackup(adminBot, true, ctx.chat.id);
                return ctx.telegram.editMessageText(
                    ctx.chat.id,
                    generatingMsg.message_id,
                    undefined,
                    "✅ *Backup generation complete and sent to Master Admins above!*",
                    {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                        }
                    }
                ).catch(() => {});
            } catch (err) {
                return ctx.reply(`❌ Backup failed: ${err.message}`, {
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            }
        });

        // Action Handlers for Inline Navigation Buttons (All edit seamlessly in-place)
        adminBot.action('admin_menu', async (ctx) => {
            const adminName = ctx.from && ctx.from.first_name ? ctx.from.first_name : 'Admin';
            return renderOrEdit(ctx, getAdminMenuPayload(adminName));
        });

        adminBot.action('admin_logs', async (ctx) => {
            return renderOrEdit(ctx, getLogsPayload("out"));
        });

        adminBot.action('admin_logs_out', async (ctx) => {
            return renderOrEdit(ctx, getLogsPayload("out"));
        });

        adminBot.action('admin_logs_error', async (ctx) => {
            return renderOrEdit(ctx, getLogsPayload("error"));
        });

        adminBot.action('admin_pending', async (ctx) => {
            const list = await getPendingRequestsList();
            return renderOrEdit(ctx, getPendingRequestsPayload(list));
        });

        adminBot.action('admin_stats', async (ctx) => {
            return renderOrEdit(ctx, getStatsPayload());
        });

        adminBot.action('admin_backup', async (ctx) => {
            try {
                await ctx.editMessageText("⏳ *Generating catalog backup CSV and sending document...*", {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            } catch (e) {}

            try {
                await checkAndRunWeeklyBackup(adminBot, true, ctx.chat.id);
                return await ctx.editMessageText("✅ *Catalog backup generated and sent below!*", {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            } catch (err) {
                return await ctx.editMessageText(`❌ Backup failed: ${err.message}`, {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            }
        });
    }

    // In-memory cache for welcome settings and photo to eliminate delay and unnecessary Firestore reads
    let cachedWelcomeSettings = {};
    let lastWelcomeFetchTime = 0;
    let cachedWelcomePhotoFileId = null;

    async function getCachedWelcomeSettings() {
        const now = Date.now();
        if (now - lastWelcomeFetchTime < 15 * 60 * 1000) {
            return cachedWelcomeSettings;
        }
        lastWelcomeFetchTime = now; // Update timestamp immediately so failures do not trigger repetitive blocking attempts
        try {
            const welcomePromise = db.collection("settings").doc("welcome").get();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500));
            const welcomeDoc = await Promise.race([welcomePromise, timeoutPromise]);
            if (welcomeDoc.exists) {
                cachedWelcomeSettings = welcomeDoc.data() || {};
            }
        } catch (e) {
            // Keep default / existing cache on error or timeout with zero delay
        }
        return cachedWelcomeSettings;
    }

    // Command: /start
    bot.command('start', async (ctx) => {
        const userId = String(ctx.from.id);
        const username = ctx.from.username || "";
        const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Guest User";
        
        console.log(`User /start: ${fullName} (${username ? '@' + username : 'No handle'}, ID: ${userId})`);

        // Update local user store immediately on Ubuntu
        localStore.upsertUser({
            id: userId,
            username: username,
            fullName: fullName,
            lastSeen: Date.now(),
            blockedBot: false
        });

        // Check for deep-link payload (start=claim_docId, start=boost_docId, start=ref_userId)
        const payload = ctx.startPayload || (ctx.message && ctx.message.text ? ctx.message.text.split(" ")[1] : "");

        // Asynchronously register / update user in background (non-blocking for instant /start response)
        (async () => {
            try {
                const userRef = db.collection("users").doc(userId);
                const existingLocal = localStore.getUser(userId);
                let isNewUser = !existingLocal;
                if (isNewUser) {
                    try {
                        const userDoc = await userRef.get();
                        if (userDoc.exists) isNewUser = false;
                    } catch (e) {
                        // If quota is exhausted, assume existing to prevent duplicate initializations
                        isNewUser = false;
                    }
                }

                const data = {
                    id: userId,
                    username: username,
                    fullName: fullName,
                    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
                    blockedBot: false
                };
                if (isNewUser) {
                    data.points = 0;
                    data.badge = "";
                    data.badgeExpiresAt = 0;
                    data.pointsBreakdown = { downloads: 0, visits: 0, shares: 0, watched: 0 };
                    data.dailyStats = {};
                    data.joinedDate = admin.firestore.FieldValue.serverTimestamp();
                    data.notificationsEnabled = true;
                    data.subAnime = true;
                    data.subHollywood = true;
                    data.subRecs = true;
                    data.contactPreference = "telegram";
                    await userRef.set(data);
                } else {
                    await userRef.set(data, { merge: true });
                }

                // Process referral points in background
                if (payload && payload.startsWith("ref_")) {
                    const referrerId = payload.substring(4);
                    if (referrerId !== userId && isNewUser) {
                        const referrerRef = db.collection("users").doc(referrerId);
                        const referrerDoc = await referrerRef.get();
                        if (referrerDoc.exists) {
                            const referrerData = referrerDoc.data();
                            const currentPoints = referrerData.points || 0;
                            const newPoints = currentPoints + 5;
                            const breakdown = referrerData.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 };
                            breakdown.shares = (breakdown.shares || 0) + 1;
                            await referrerRef.update({ points: newPoints, pointsBreakdown: breakdown });
                            await ctx.telegram.sendMessage(
                                referrerId,
                                `🔔 *New Referral!* 🔔\n\nYour friend *${fullName}* has joined Film House using your invite link! 🎉\n\nYou have been awarded *+5 Loyalty Points*! 🏆`,
                                { parse_mode: "Markdown" }
                            ).catch(() => {});
                        }
                    }
                }
            } catch (err) {
                console.warn("Background user registration warning on /start:", err.message);
            }
        })();


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
                        const yearSuffix = reqData.year ? ` (${escapeHtml(reqData.year)})` : "";
                        return await ctx.reply(
                            `🍿 <b>Your Requested Movie is Ready!</b> 🍿\n\n` +
                            `Your request for <b>${escapeHtml(reqData.title || "Movie")}</b>${yearSuffix} has been claimed on your account.\n\n` +
                            `Tap the button below to download or watch now! 🎬`,
                            {
                                parse_mode: "HTML",
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: "Download / Watch Now 🎬", url: dlLink }
                                        ]
                                    ]
                                }
                            }
                        );
                    }
                }
            } catch (err) {
                console.error("Error processing claim start payload:", err);
            }
        }

        // Check for deep-link boost payload (start=boost_docId)
        if (payload && payload.startsWith("boost_")) {
            const docId = payload.substring(6);
            try {
                const docRef = db.collection("requests").doc(docId);
                const doc = await docRef.get();
                if (doc.exists) {
                    const reqData = doc.data();
                    if (reqData.status === "priority" || reqData.boosted === true) {
                        await ctx.reply(`ℹ️ *Your request for "${reqData.title}" is already boosted to High Priority!* 🚀`, { parse_mode: "Markdown" }).catch(() => {});
                    } else {
                        // Check user points balance in Firestore
                        const userRef = db.collection("users").doc(userId);
                        const userDoc = await userRef.get();
                        const userPoints = userDoc.exists ? (userDoc.data().points || 0) : 0;
                        if (userPoints < 1000) {
                            await ctx.reply(
                                `⚠️ *Not enough Loyalty Points!*\n\n` +
                                `You currently have *${userPoints.toLocaleString()}* points. Boosting your request for *${reqData.title}* to High Priority requires *1,000* points.\n\n` +
                                `Launch the app to mine points and complete daily tasks! 🪙`,
                                {
                                    parse_mode: "Markdown",
                                    reply_markup: {
                                        inline_keyboard: [
                                            [{ text: "Mine Points 🪙", url: "https://t.me/Filmhouseappbot/filmhouseapp?startapp=mining" }],
                                            [{ text: "Open App 🍿", url: "https://t.me/Filmhouseappbot/filmhouseapp" }]
                                        ]
                                    }
                                }
                            ).catch(() => {});
                        } else {
                            // Deduct 1,000 points
                            await userRef.update({
                                points: userPoints - 1000
                            });
                            // Mark as priority in requests collection - will trigger admin DMs via real-time listener
                            await docRef.update({
                                status: "priority",
                                boosted: true,
                                boostedAt: admin.firestore.FieldValue.serverTimestamp(),
                                boostedBy: username ? `@${username}` : fullName,
                                boostedById: userId,
                                notifiedPriority: false
                            });
                            await ctx.reply(
                                `🚀 *Request Successfully Boosted to High Priority!* 🚀\n\n` +
                                `*Title:* ${reqData.title}\n` +
                                `*Points Deducted:* 1,000 pts (Remaining: ${(userPoints - 1000).toLocaleString()})\n\n` +
                                `⚡ Our admin team has received an urgent notification in their DMs and will fulfill your request promptly! 🍿`,
                                { parse_mode: "Markdown" }
                            ).catch(() => {});
                        }
                    }
                }
            } catch (err) {
                console.error("Error processing boost start payload:", err);
            }
        }

        const escapedFullName = fullName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Load custom welcome config from in-memory cache (instant response, zero delay)
        const welcomeData = await getCachedWelcomeSettings();
        const welcomeText = welcomeData.text || null;
        const welcomePhotoFileId = welcomeData.fileId || null;
        const welcomePhotoUrl = welcomeData.photoUrl || null;
        
        let appButtonText = welcomeData.appButtonText || "Launch Film House 🚀";
        let appButtonUrl = welcomeData.appButtonUrl || "https://t.me/Filmhouseappbot/filmhouseapp";
        let channelButtonText = welcomeData.channelButtonText || "Join Channel 📢";
        let channelButtonUrl = welcomeData.channelButtonUrl || "https://t.me/filmhouse_main";

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
                        text: appButtonText,
                        url: appButtonUrl
                    }
                ],
                [
                    { text: "Help 📖", callback_data: "bot_help" },
                    { text: "About ℹ️", callback_data: "bot_about" }
                ],
                [
                    { text: channelButtonText, url: channelButtonUrl }
                ]
            ]
        };

        // Determine best photo source: Custom fileId > Custom URL > Cached Telegram fileId > Local File > GitHub Raw CDN
        const localImagePath = path.join(__dirname, "MOVIE", "img", "FilmHouse.png");
        const defaultCdnUrl = "https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png";

        let photoSource = welcomePhotoFileId || welcomePhotoUrl || cachedWelcomePhotoFileId;
        if (!photoSource) {
            if (fs.existsSync(localImagePath)) {
                photoSource = { source: localImagePath };
            } else {
                photoSource = defaultCdnUrl;
            }
        }

        try {
            const sentMsg = await ctx.replyWithPhoto(photoSource, {
                caption: caption,
                parse_mode: 'HTML',
                reply_markup: replyMarkup
            });
            if (sentMsg && sentMsg.photo && sentMsg.photo.length > 0) {
                cachedWelcomePhotoFileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
            }
            return sentMsg;
        } catch (photoErr) {
            console.warn("Failed to send welcome photo with primary source, attempting CDN fallback:", photoErr.message);
            if (photoSource !== defaultCdnUrl) {
                try {
                    const fallbackMsg = await ctx.replyWithPhoto(defaultCdnUrl, {
                        caption: caption,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    });
                    if (fallbackMsg && fallbackMsg.photo && fallbackMsg.photo.length > 0) {
                        cachedWelcomePhotoFileId = fallbackMsg.photo[fallbackMsg.photo.length - 1].file_id;
                    }
                    return fallbackMsg;
                } catch (cdnErr) {
                    console.error("Failed to send fallback CDN photo:", cdnErr.message);
                }
            }
            return ctx.reply(caption, {
                parse_mode: 'HTML',
                reply_markup: replyMarkup
            });
        }
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

    // Command: /settings (Powered by Ubuntu Local Store with optional Firestore sync)
    bot.command('settings', async (ctx) => {
        const userId = String(ctx.from.id);
        const localUser = localStore.getUser(userId);

        let points = localUser ? (localUser.points || 0) : 0;
        let badge = localUser ? (localUser.badge || "No Active Badge") : "No Active Badge";
        let username = (localUser && localUser.username) ? localUser.username : (ctx.from.username || "");

        // Try getting fresh points from Firestore if online (with 1.5s timeout)
        try {
            const userPromise = db.collection("users").doc(userId).get();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500));
            const userDoc = await Promise.race([userPromise, timeoutPromise]);
            if (userDoc.exists) {
                const u = userDoc.data();
                points = u.points || points;
                badge = u.badge || badge;
                username = u.username || username;
                localStore.upsertUser({ id: userId, points, badge, username });
            }
        } catch (e) {
            // Uses local storage seamlessly without error!
        }

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

        const usernameDisplay = username && username !== "guest" && username !== "None" ? '@' + username.replace(/^@/, '') : "None";

        return ctx.reply(
            `👤 *Your Profile Status*\n\n` +
            `• *Telegram ID:* \`${userId}\`\n` +
            `• *Username:* ${usernameDisplay}\n` +
            `• *Loyalty Points:* 🪙 \`${points.toLocaleString()}\` pts\n` +
            `• *VIP Badge:* 🏆 \`${badge}\``,
            { 
                parse_mode: 'Markdown',
                reply_markup: replyMarkup,
                reply_to_message_id: ctx.message.message_id
            }
        );
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

        // Retrieve subscribers from Ubuntu local store (ZERO Firestore reads, immune to quotas!)
        let subscribers = localStore.getActiveSubscribers();
        
        // If local store is empty, attempt a Firestore fallback
        if (subscribers.length === 0) {
            try {
                const snapshot = await db.collection("users").get();
                snapshot.forEach(doc => {
                    const u = doc.data();
                    if (u.id) localStore.upsertUser({ id: String(u.id), ...u });
                });
                subscribers = localStore.getActiveSubscribers();
            } catch (fsErr) {
                console.warn("[Broadcast] Firestore fallback failed:", fsErr.message);
            }
        }

        if (subscribers.length === 0) {
            return ctx.reply("⚠️ No bot subscribers found in local database yet. Users who message or /start the bot will appear here automatically.");
        }

        ctx.reply(`✈️ *Starting broadcast to ${subscribers.length} subscriber(s)...*`, { 
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });

        let successCount = 0;
        let failedCount = 0;

        for (const u of subscribers) {
            try {
                if (replyTo) {
                    await callTelegramWithRetry('copyMessage', u.id, ctx.chat.id, replyTo.message_id);
                } else {
                    await callTelegramWithRetry('sendMessage', u.id, messageText, { parse_mode: "Markdown" });
                }
                successCount++;
            } catch (err) {
                failedCount++;
                const isUserError = err.message && (err.message.includes("blocked") || err.message.includes("chat not found") || err.message.includes("deactivated"));
                if (isUserError) {
                    localStore.setBlocked(u.id, true);
                    db.collection("users").doc(String(u.id)).set({ blockedBot: true }, { merge: true }).catch(() => {});
                }
            }
            // Rate limiting delay (35ms between Telegram sends = ~30 msgs/sec safely under Telegram limit)
            await new Promise(r => setTimeout(r, 35));
        }

        return ctx.reply(`📢 *Broadcast Finished*\n\n🟢 Success: \`${successCount}\`\n🔴 Failed: \`${failedCount}\`\n👥 Total Subscribers in Ubuntu DB: \`${subscribers.length}\``, { 
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        });
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
            bannedUsersCache.add(targetId);
            localStore.setBanned(targetId, true);
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
            bannedUsersCache.delete(targetId);
            localStore.setBanned(targetId, false);
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
            cachedWelcomeSettings = { ...(cachedWelcomeSettings || {}), text: newCaption };

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
            cachedWelcomeSettings = { ...(cachedWelcomeSettings || {}), fileId: fileId, photoUrl: null };
            cachedWelcomePhotoFileId = fileId;

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
            cachedWelcomeSettings = {};
            cachedWelcomePhotoFileId = null;
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
            // --- Admin Delete Request Callbacks (Disabled to prevent accidental deletion) ---
            if (data && (data.startsWith("delreq_ask_") || data.startsWith("delreq_confirm_") || data.startsWith("delreq_cancel_"))) {
                return ctx.answerCbQuery("ℹ️ Deleting requests directly from Telegram is disabled to prevent accidental deletions. Please manage requests via the Admin Dashboard.", { show_alert: true });
            }

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
                            `• *Username:* ${u.username && u.username !== "guest" && u.username !== "None" ? '@' + u.username.replace(/^@/, '') : "None"}\n` +
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
async function checkAndRunWeeklyBackup(botToUse, force = false, targetChatId = null) {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];
        
        let shouldBackup = force;
        if (!shouldBackup) {
            try {
                const backupDoc = await db.collection("settings").doc("backup").get();
                let lastBackupDateStr = backupDoc.exists ? (backupDoc.data().lastBackupDate || "") : "";
                if (!lastBackupDateStr) {
                    shouldBackup = true;
                } else {
                    const lastDate = new Date(lastBackupDateStr);
                    const diffDays = Math.ceil(Math.abs(today - lastDate) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 7) shouldBackup = true;
                }
            } catch (e) {
                // Keep operating without failing on quota
            }
        }
        
        if (shouldBackup) {
            console.log("Running weekly database backup...");
            let moviesList = [];
            const localMetaPath = path.resolve(__dirname, "./MOVIE/Data/movies_metadata.json");
            const localCsvPath = path.resolve(__dirname, "./MOVIE/Data/datafile.csv");

            if (fs.existsSync(localMetaPath)) {
                try {
                    moviesList = JSON.parse(fs.readFileSync(localMetaPath, "utf8"));
                } catch (e) {}
            }
            if (moviesList.length === 0) {
                try {
                    const snapshot = await db.collection("movies").get();
                    snapshot.forEach(doc => moviesList.push(doc.data()));
                } catch (e) {}
            }
            
            let csvBuffer;
            if (moviesList.length > 0) {
                const fields = [
                    "csv_id", "tmdb_id", "imdb_id", "title", "type", 
                    "categories", "genres", "overview", "poster", 
                    "backdrop", "rating", "release_date", "language", 
                    "cast", "director", "trailer", "runtime", "links"
                ];
                
                let csvRows = [fields.join(",")];
                moviesList.forEach(data => {
                    const row = fields.map(field => {
                        let val = data[field];
                        if (val === undefined || val === null) return "";
                        let str = Array.isArray(val) ? val.join(", ") : String(val);
                        str = str.replace(/"/g, '""');
                        if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
                            str = `"${str}"`;
                        }
                        return str;
                    });
                    csvRows.push(row.join(","));
                });
                
                const csvContent = csvRows.join("\n");
                csvBuffer = Buffer.from(csvContent, "utf-8");
            } else if (fs.existsSync(localCsvPath)) {
                csvBuffer = fs.readFileSync(localCsvPath);
            }

            if (!csvBuffer) {
                console.log("Movies collection and local files are empty. Skipping CSV backup.");
                return;
            }

            // Get Master Admin IDs
            const defaultAdmins = ["1329840839", "1175336733"];
            let masters = [...defaultAdmins];
            if (targetChatId) {
                masters.push(String(targetChatId));
            }
            try {
                const adminDoc = await db.collection("settings").doc("admins").get();
                if (adminDoc.exists && adminDoc.data().masters) {
                    masters = Array.from(new Set([...masters, ...adminDoc.data().masters.map(String)]));
                }
            } catch (e) {}
            
            masters = Array.from(new Set(masters));
            
            // Send CSV to all Master Admins
            for (const adminId of masters) {
                try {
                    await botToUse.telegram.sendDocument(adminId, {
                        source: csvBuffer,
                        filename: `filmhouse_catalog_backup_${todayStr}.csv`
                    }, {
                        caption: `📅 *Weekly Film House Catalog Backup*\n\nContains *${moviesList.length || 'Full'}* catalog titles. Keep this safe! 🍿`,
                        parse_mode: "Markdown"
                    });
                    console.log(`Weekly backup CSV sent to admin ${adminId}`);
                } catch (e) {
                    console.warn(`Failed to send weekly backup file to admin ${adminId}:`, e.message);
                }
            }
            
            // Save state in Firestore settings/backup
            try {
                await db.collection("settings").doc("backup").set({
                    lastBackupDate: todayStr,
                    itemCount: moviesList.length,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (e) {}
            console.log("Weekly database backup complete.");
        }
    } catch (err) {
        console.error("Weekly backup error:", err);
    }
}

// Bot Initializer
async function init() {
    let botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

    if (!botToken) {
        console.log("Fetching bot token from Firestore 'settings/telegram'...");
        try {
            const doc = await db.collection("settings").doc("telegram").get();
            if (doc.exists && doc.data().botToken) {
                botToken = doc.data().botToken;
                console.log("Telegram Bot Token successfully loaded from Firestore.");
            }
        } catch (err) {
            console.error("Failed to fetch bot token from Firestore:", err);
        }
    }

    if (!botToken) {
        botToken = "8777518927:AAGy34k3vhx2QtitGQh8n9B1RTt-1xOMuzQ";
    }

    const adminBotToken = process.env.ADMIN_BOT_TOKEN || "8669068531:AAEwUFMEWNWk8aXHvTuRQJpmfIAEGjVNe0o";

    try {
        const bot = new Telegraf(botToken);
        const adminBot = new Telegraf(adminBotToken);
        setupBot(bot, adminBot);
        
        // Register Commands Menu for Public Bot
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

        // Register Commands Menu for Admin Bot
        adminBot.telegram.setMyCommands([
            { command: 'start', description: 'Admin Command Center 👑' },
            { command: 'logs', description: 'View live server & bot logs 📜' },
            { command: 'pending', description: 'List pending movie requests 📋' },
            { command: 'backup', description: 'Trigger catalog CSV backup 💾' },
            { command: 'stats', description: 'Server metrics & subscriber counts 📊' }
        ]).then(() => {
            console.log("Admin Bot commands menu registered successfully!");
        }).catch(err => {
            console.warn("Failed to register admin bot commands menu:", err.message);
        });

        const isLocalEnvironment = !process.env.RENDER_EXTERNAL_URL && !process.env.RENDER;
        const forcePolling = process.env.POLLING === "true" || process.argv.includes("--polling") || isLocalEnvironment;
        
        let webhookUrl = null;
        if (!forcePolling) {
            webhookUrl = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;
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
        }

        const PORT = process.env.PORT || 3000;
        let server;

        const secretPath = `/telegraf/${crypto.createHash('sha256').update(botToken || "filmhouse_bot_token").digest('hex')}`;

        if (webhookUrl) {
            console.log(`Configuring Webhook mode with base URL: ${webhookUrl}`);
            const webhookCallback = bot.webhookCallback(secretPath);
            
            server = http.createServer((req, res) => {
                if (req.url === secretPath) {
                    webhookCallback(req, res);
                } else if (req.url === '/debug-info') {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        tokenPrefix: botToken ? botToken.substring(0, 12) : "missing",
                        secretPath: secretPath,
                        webhookUrl: webhookUrl,
                        firebaseProjectId: admin.app().options.projectId || "unknown",
                        firebaseCertProject: admin.app().options.credential && admin.app().options.credential.projectId ? admin.app().options.credential.projectId : "unknown"
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
            console.log("Polling mode enabled. Clearing existing Telegram Webhook...");
            try {
                await bot.telegram.deleteWebhook({ drop_pending_updates: false });
                console.log("Telegram Webhook cleared. Ready for polling updates.");
            } catch (e) {
                console.warn("Could not delete Telegram webhook:", e.message);
            }

            server = http.createServer((req, res) => {
                if (req.url === '/debug-info') {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        tokenPrefix: botToken ? botToken.substring(0, 12) : "missing",
                        mode: "polling",
                        firebaseProjectId: admin.app().options.projectId || "unknown"
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
            
            bot.launch({
                allowedUpdates: ['message', 'callback_query']
            }).catch(err => console.error("Public Bot launch error:", err.message));
            console.log("Film House Public Bot successfully started! 🚀 Running command listener (Polling)...");

            adminBot.launch({
                allowedUpdates: ['message', 'callback_query']
            }).then(() => {
                console.log("Film House Admin Bot successfully started! 👑 Running listener (@Fiimhouse_adminBot)...");
            }).catch(err => {
                console.error("Admin Bot launch error:", err.message);
            });
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

        // Start weekly movie catalog backup checker (runs every 12 hours, never on immediate reboot)
        setInterval(async () => {
            await checkAndRunWeeklyBackup(adminBot || bot);
        }, 12 * 60 * 60 * 1000); // Check every 12 hours

        // Start background synchronization from Firestore to Ubuntu local user store
        setTimeout(() => localStore.syncFromFirestore(db), 10 * 1000);
        setInterval(() => localStore.syncFromFirestore(db), 6 * 60 * 60 * 1000);

        // Start keep-alive ping loop for external File Bots
        let cachedPingUrls = [];
        let lastPingUrlsFetch = 0;

        const pingExternalFileBots = async () => {
            try {
                const now = Date.now();
                if (now - lastPingUrlsFetch > 60 * 60 * 1000 || cachedPingUrls.length === 0) {
                    try {
                        const doc = await db.collection("settings").doc("telegram").get();
                        if (doc.exists) {
                            const pingUrlsStr = doc.data().pingUrls || "";
                            cachedPingUrls = pingUrlsStr.split(",")
                                .map(u => u.trim())
                                .filter(u => u.length > 0 && (u.startsWith("http://") || u.startsWith("https://")));
                            lastPingUrlsFetch = now;
                        }
                    } catch (e) {
                        // Keep previous cached URLs if Firestore is temporarily unavailable
                    }
                }
                
                const urls = cachedPingUrls;
                if (urls.length === 0) return;
                
                console.log(`Pinging ${urls.length} external File Bot(s) to keep active...`);
                
                urls.forEach(url => {
                    const protocol = url.startsWith("https") ? require("https") : require("http");
                    protocol.get(url, (res) => {
                        console.log(`External keep-alive ping sent to ${url}. Status: ${res.statusCode}`);
                    }).on("error", (err) => {
                        console.warn(`External keep-alive ping to ${url} failed: ${err.message}`);
                    });
                });
            } catch (err) {
                console.error("Error running external File Bot keep-alive pinger:", err.message);
            }
        };

        // Run keep-alive pings immediately on start and then every 5 minutes
        pingExternalFileBots();
        setInterval(pingExternalFileBots, 5 * 60 * 1000);

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
                        const text = `👋 *Hey there!*\n\nOur team noticed your mining rig is idle! 🪙 Don't forget to launch the app, start your mining session, and complete your daily missions to earn *Loyalty Points*! \n\n🎁 *Did you know?* You can use your points to redeem a **24-Hour Ad-Free VIP Pass** in the rewards center, allowing you to bypass all ads and get instant direct downloads for a whole day! 🎫🚀`;
                        
                        if (userId === "all_idle") {
                            console.log("Triggering bulk mine reminder to all idle users...");
                            try {
                                const usersSnapshot = await db.collection("users").get();
                                let count = 0;
                                for (const userDoc of usersSnapshot.docs) {
                                    const userData = userDoc.data();
                                    if (userData.blockedBot === true) continue;
                                    
                                    const farmingStartedAt = userData.farmingStartedAt || 0;
                                    const uid = userDoc.id;
                                    
                                    const sessionDuration = 8 * 60 * 60 * 1000; // 8 hours
                                    const isIdle = (farmingStartedAt === 0) || (Date.now() - farmingStartedAt > sessionDuration);
                                    
                                    if (isIdle) {
                                        try {
                                            await callTelegramWithRetry('sendMessage', uid, text, {
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
                                            if (e.message && (e.message.includes("blocked") || e.message.includes("chat not found") || e.message.includes("deactivated"))) {
                                                await db.collection("users").doc(uid).update({ blockedBot: true });
                                            }
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
                                await callTelegramWithRetry('sendMessage', userId, text, {
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
                                if (e.message && (e.message.includes("blocked") || e.message.includes("chat not found") || e.message.includes("deactivated"))) {
                                    await db.collection("users").doc(userId).update({ blockedBot: true });
                                }
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
                    const cleanUser = escapeHtml(user);
                    const cleanUserId = escapeHtml(userId);
                    const cleanCategory = escapeHtml(category);
                    const cleanSubject = escapeHtml(subject);
                    const cleanMsg = escapeHtml(msg);

                    const adminText = `📝 <b>New Feedback Submitted!</b>\n\n` +
                                      `👤 <b>User:</b> @${cleanUser} (ID: <code>${cleanUserId}</code>)\n` +
                                      `📁 <b>Type:</b> ${cleanCategory}\n` +
                                      `📌 <b>Subject:</b> ${cleanSubject}\n\n` +
                                      `💬 <b>Message:</b>\n${cleanMsg}`;
                    
                    const defaultAdmins = ["1329840839", "1175336733"];
                    try {
                        const adminDoc = await db.collection("settings").doc("admins").get();
                        const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                        const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                        const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));
                        for (const adminId of allAdmins) {
                            try {
                                await callAdminTelegramWithRetry('sendMessage', adminId, adminText, { parse_mode: "HTML" });
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
            try {
                cachedPendingRequests = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(r => r.status !== "fulfilled" && r.status !== "claimed" && !r.fulfilled && !r.claimed);
                savePendingRequestsToDisk(cachedPendingRequests);
                console.log(`[PendingStore] Synchronized ${cachedPendingRequests.length} pending requests from Firestore.`);
            } catch (e) {
                console.error("Error updating cached pending requests:", e.message);
            }

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
                const rawUser = (data.requestedBy && data.requestedBy !== "guest") ? data.requestedBy : (data.fullName || data.user || `User ${userId}`);
                const username = (rawUser && rawUser !== "guest" && rawUser !== "None" && !rawUser.includes(" ") && !rawUser.startsWith("User ")) ? `@${rawUser.replace(/^@/, '')}` : rawUser;
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

                    const cleanTitle = escapeHtml(String(title || "Movie").replace(/[*_`~]/g, '').trim());
                    const cleanYear = year ? ` (${escapeHtml(String(year).replace(/[*_`~()]/g, '').trim())})` : "";
                    const cleanType = escapeHtml(String(type || "Movie").replace(/[*_`~]/g, '').trim());
                    const cleanSeason = data.seasonOrPart ? `\n📌 <b>Season/Part:</b> ${escapeHtml(String(data.seasonOrPart).replace(/[*_`~]/g, '').trim())}` : '';
                    const cleanUser = escapeHtml(String(username || `User ${userId}`).replace(/[*_`~]/g, '').trim());

                    const userReqText = `🍿 <b>Request Received!</b>\n\nYour request for <b>${cleanTitle}</b>${cleanYear} (${cleanType}) has been logged in our queue.\n\n` +
                        (canBoost 
                            ? `💡 <b>Boost Available!</b> You can boost this request to <b>High Priority</b> for 1,000 points to get it faster! 🚀`
                            : `We will notify you here as soon as it is fulfilled! 🚀`);

                    try {
                        await callTelegramWithRetry('sendMessage', userId, userReqText, {
                            parse_mode: "HTML",
                            reply_markup: replyMarkup
                        });
                    } catch (e) {
                        if (e.message && (e.message.includes("blocked") || e.message.includes("chat not found") || e.message.includes("deactivated"))) {
                            await db.collection("users").doc(userId).update({ blockedBot: true });
                        }
                        console.warn(`Failed to send request confirmation to ${userId}:`, e.message);
                    }

                    // 2. Notify admins
                    const isDirectPriority = (data.status === "priority" || data.boosted === true);
                    const adminText = isDirectPriority
                        ? `🚀🔥 <b>NEW MOVIE REQUEST (HIGH PRIORITY)!</b> 🔥🚀\n\n` +
                          `🎬 <b>Title:</b> <b>${cleanTitle}</b>${cleanYear}\n` +
                          `📁 <b>Type:</b> ${cleanType}${cleanSeason}\n` +
                          `👤 <b>Requested By:</b> ${cleanUser} (ID: <code>${userId}</code>)\n` +
                          `🔥 <b>Priority:</b> ⚡⚡ <b>HIGH PRIORITY</b> ⚡⚡\n\n` +
                          `💡 <i>Action Required: Please expedite this request in the Admin Panel or channel!</i>`
                        : `🍿 <b>New Movie Request!</b>\n\n` +
                          `🎬 <b>Title:</b> <b>${cleanTitle}</b>${cleanYear}\n` +
                          `📁 <b>Type:</b> ${cleanType}${cleanSeason}\n` +
                          `👤 <b>Requested By:</b> ${cleanUser} (ID: <code>${userId}</code>)`;

                    const defaultAdmins = ["1329840839", "1175336733"];
                    try {
                        const adminDoc = await db.collection("settings").doc("admins").get();
                        const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                        const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                        const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));
                        for (const adminId of allAdmins) {
                            try {
                                await callAdminTelegramWithRetry('sendMessage', adminId, adminText, {
                                    parse_mode: "HTML",
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                { text: "🍿 Open Film House to Fulfill 🚀", url: "https://t.me/Filmhouseappbot/filmhouseapp" }
                                            ]
                                        ]
                                    }
                                });
                            } catch (e) {
                                console.warn(`Failed to notify admin ${adminId} of request:`, e.message);
                            }
                        }
                    } catch (err) {
                        console.error("Error fetching admin list for request notify:", err);
                    }

                } else if (change.type === "modified") {
                    const isBoosted = (data.status === "priority" || data.boosted === true);
                    if (isBoosted && data.notifiedPriority !== true) {
                        // Mark as notified in Firestore immediately to prevent duplicate alerts
                        await db.collection("requests").doc(docId).update({ 
                            notifiedPriority: true,
                            boosted: true,
                            status: "priority"
                        }).catch(() => {});

                        const cleanTitle = escapeHtml(String(title || "Movie").replace(/[*_`~]/g, '').trim());
                        const cleanYear = year ? ` (${escapeHtml(String(year).replace(/[*_`~()]/g, '').trim())})` : "";
                        const cleanType = escapeHtml(String(type || "Movie").replace(/[*_`~]/g, '').trim());
                        const cleanSeason = data.seasonOrPart ? `\n📌 <b>Season/Part:</b> ${escapeHtml(String(data.seasonOrPart).replace(/[*_`~]/g, '').trim())}` : '';
                        const cleanUser = escapeHtml(String(username || `User ${userId}`).replace(/[*_`~]/g, '').trim());
                        const boosterName = data.boostedBy || username;
                        const cleanBooster = escapeHtml(String(boosterName).replace(/[*_`~]/g, '').trim());

                        // 1. Send confirmation to requesting user
                        const text = `🚀 <b>Request Boosted!</b>\n\n` +
                                     `Your request for <b>${cleanTitle}</b>${cleanYear} has been successfully boosted to <b>High Priority</b>! Our admin team has received an emergency alert in their private DMs and is working on fulfilling it! 🍿`;
                        try {
                            await callTelegramWithRetry('sendMessage', userId, text, { parse_mode: "HTML" });
                        } catch (e) {
                            if (e.message && (e.message.includes("blocked") || e.message.includes("chat not found") || e.message.includes("deactivated"))) {
                                await db.collection("users").doc(userId).update({ blockedBot: true });
                            }
                            console.warn(`Failed to send boost confirmation to ${userId}:`, e.message);
                        }

                        // 2. Notify admins in their DMs with high-visibility HTML alert and Delete Request button
                        const adminBoostText = `🚀🔥 <b>REQUEST BOOSTED TO HIGH PRIORITY!</b> 🔥🚀\n\n` +
                                              `🎬 <b>Title:</b> <b>${cleanTitle}</b>${cleanYear}\n` +
                                              `📁 <b>Type:</b> ${cleanType}${cleanSeason}\n` +
                                              `👤 <b>Requested By:</b> ${cleanUser} (ID: <code>${userId}</code>)\n` +
                                              `⚡ <b>Boosted By:</b> ${cleanBooster}\n` +
                                              `🪙 <b>Points Spent:</b> <code>1,000 Loyalty Points</code> ⚡\n` +
                                              `🔥 <b>Priority Level:</b> ⚡⚡ <b>HIGH PRIORITY</b> ⚡⚡\n\n` +
                                              `💡 <i>Action Required: Please expedite this request in the Admin Panel or upload to @filmhouse_main!</i>`;

                        const defaultAdmins = ["1329840839", "1175336733"];
                        try {
                            const adminDoc = await db.collection("settings").doc("admins").get();
                            const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                            const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                            const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));

                            console.log(`[BOOST ALERT] Sending HTML notification for "${title}" to ${allAdmins.length} admin(s)...`);

                            for (const adminId of allAdmins) {
                                try {
                                    await callAdminTelegramWithRetry('sendMessage', adminId, adminBoostText, {
                                        parse_mode: "HTML",
                                        reply_markup: {
                                            inline_keyboard: [
                                                [
                                                    { text: "⚡🔥 Fulfill High Priority Request 🚀", url: "https://t.me/Filmhouseappbot/filmhouseapp" }
                                                ]
                                            ]
                                        }
                                    });
                                    console.log(`[BOOST ALERT] HTML DM successfully sent to admin ${adminId}`);
                                } catch (e) {
                                    console.warn(`Failed to notify admin ${adminId} of boost:`, e.message);
                                }
                            }
                        } catch (err) {
                            console.error("Error sending admin boost DM notification:", err);
                        }
                    }

                    if (data.status === "fulfilled" && data.notifiedFulfilled !== true && downloadLink) {
                        const cleanUserTitle = escapeHtml(title || "Movie");
                        const cleanYearSuffix = year ? ` (${escapeHtml(year)})` : "";
                        const isSeries = (data.type || "").toLowerCase() === "series" || (data.type || "").toLowerCase() === "tv";
                        let detailText = "";
                        let buttonText = "Download/Watch Now 🎬";
                            if (isSeries) {
                                let requestedSeason = data.seasonOrPart || "";
                                if (!requestedSeason && title) {
                                    const sMatch = title.match(/Season\s*\d+/i) || title.match(/\(Season\s*\d+\)/i) || title.match(/S\d+/i);
                                    if (sMatch) {
                                        requestedSeason = sMatch[0].replace(/[()]/g, '').trim();
                                    }
                                }
                                const sLabel = requestedSeason ? requestedSeason : "Series";
                                const isComplete = data.isSeriesComplete === true || data.status === "completed" || sLabel.toLowerCase() === "all seasons";

                                if (isComplete) {
                                    detailText = `🎉 <b>All Seasons Completed!</b>\n\nAll seasons of <b>${cleanUserTitle}</b> have been fully uploaded to Film House! Enjoy the full series! 📺`;
                                    buttonText = "Open Film House App 🍿";
                                } else if (sLabel.toLowerCase().includes("season 1") || sLabel.toLowerCase() === "s1") {
                                    detailText = `🍿 <b>Good news!</b>\n\n<b>Season 1</b> of <b>${cleanUserTitle}</b> is now ready! We are currently uploading the remaining seasons... 🚀`;
                                    buttonText = "Get Season 1 🍿";
                                } else {
                                    detailText = `🚀 <b>Season Update!</b>\n\n<b>${escapeHtml(sLabel)}</b> of <b>${cleanUserTitle}</b> has just been added! To download or watch remaining seasons, open Film House App! 🍿`;
                                    buttonText = `Get ${sLabel} 🍿`;
                                }
                            } else {
                                detailText = "💡 <b>Note:</b> This is a single movie request, so this contains the full film. Enjoy! 🍿";
                                buttonText = "Get Movie 🎬";
                            }

                            const text = `🎉 <b>Good news!</b>\n\n` +
                                         `Your request for <b>${cleanUserTitle}</b>${cleanYearSuffix} has been fulfilled! 🍿\n\n` +
                                         `${detailText}\n\n` +
                                         `Thank you for using Film House!`;
                            try {
                                await callTelegramWithRetry('sendMessage', userId, text, {
                                    parse_mode: "HTML",
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
                                await db.collection("requests").doc(docId).update({ 
                                    notifiedFulfilled: true,
                                    notificationStatus: "delivered",
                                    notificationError: null,
                                    notifiedAt: admin.firestore.FieldValue.serverTimestamp()
                                }).catch(() => {});
                            } catch (e) {
                                console.warn(`Failed to send request fulfillment to ${userId}:`, e.message);
                                const isBlocked = e.message && (e.message.includes("blocked") || e.message.includes("chat not found") || e.message.includes("deactivated"));
                                if (isBlocked) await db.collection("users").doc(userId).update({ blockedBot: true });
                                await db.collection("requests").doc(docId).update({ 
                                    notifiedFulfilled: true,
                                    notificationStatus: "failed",
                                    notificationError: e.message,
                                    isBlockedUser: isBlocked,
                                    notifiedAt: admin.firestore.FieldValue.serverTimestamp()
                                }).catch(() => {});
                            }

                            // Notify admins of the fulfillment
                            try {
                                const defaultAdmins = ["1329840839", "1175336733"];
                                const adminDoc = await db.collection("settings").doc("admins").get();
                                const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                                const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                                const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));

                                const pendingCount = cachedPendingRequests.length;
                                const fulfilledBy = data.fulfilledBy || data.adminClaimName || "An Admin";
                                const cleanAdminTitle = escapeHtml(title || "Movie");
                                const cleanAdminYear = year ? ` (${escapeHtml(year)})` : "";
                                const cleanFulfilledBy = escapeHtml(fulfilledBy);
                                const cleanReqUser = escapeHtml(username || `User ${userId}`);
                                const displayUser = cleanReqUser.startsWith('@') ? cleanReqUser : `@${cleanReqUser}`;

                                const adminNotifyText = `✅ <b>Request Fulfilled!</b>\n\n` +
                                                     `🎬 <b>Title:</b> <b>${cleanAdminTitle}</b>${cleanAdminYear}\n` +
                                                     `👤 <b>Fulfilled by:</b> ${cleanFulfilledBy}\n` +
                                                     `🍿 <b>Requested for:</b> ${displayUser} (ID: <code>${escapeHtml(userId)}</code>)\n\n` +
                                                     `⚡ <b>Remaining Queue:</b> <code>${pendingCount}</code> pending request(s) left.`;

                                const adminReplyMarkup = downloadLink ? {
                                    inline_keyboard: [
                                        [
                                            { text: "🎬 Watch / Download Movie 🍿", url: downloadLink }
                                        ],
                                        [
                                            { text: "🚀 Open Film House App 🍿", url: "https://t.me/Filmhouseappbot/filmhouseapp" }
                                        ]
                                    ]
                                } : undefined;

                                for (const adminId of allAdmins) {
                                    try {
                                        await callAdminTelegramWithRetry('sendMessage', adminId, adminNotifyText, {
                                            parse_mode: "HTML",
                                            reply_markup: adminReplyMarkup
                                        });
                                    } catch (err) {
                                        console.warn(`Failed to notify admin ${adminId} of fulfillment:`, err.message);
                                    }
                                }
                            } catch (adminErr) {
                                console.error("Error in admin notification:", adminErr);
                            }
                        }
                    }
            });
        }, (err) => console.error("Requests listener error:", err));

        // Background loop for farming completion reminders (Runs every 15 minutes with limit to conserve Firestore quota)
        setInterval(async () => {
            try {
                const now = Date.now();
                const duration = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
                const cutoff = now - duration;

                const snapshot = await db.collection("users")
                    .where("farmingStartedAt", ">", 0)
                    .where("farmingStartedAt", "<=", cutoff)
                    .limit(20)
                    .get();

                for (const doc of snapshot.docs) {
                    const userData = doc.data();
                    if (userData.farmingReminded === true || userData.blockedBot === true) continue;

                    const userId = doc.id;
                    try {
                        await callTelegramWithRetry(
                            'sendMessage',
                            userId,
                            `⚡ <b>Mining Session Complete!</b> ⚡\n\nYour 8-hour session has finished. Launch the app now to claim your <b>80 Loyalty Points</b> and start your next session! 🍿\n\n🎁 <b>Tip:</b> Save up 1,500 points to unlock a <b>24-Hour Ad-Free Day Pass</b> in the rewards center! 🎫`,
                            {
                                parse_mode: "HTML",
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
                        await db.collection("users").doc(userId).update({
                            farmingReminded: true
                        });
                        console.warn(`Could not send farming reminder to ${userId}:`, notifyErr.message);
                    }
                }
            } catch (err) {
                console.error("Error in farming reminder cron loop:", err.message);
            }
        }, 15 * 60 * 1000); // check every 15 minutes instead of every 60 seconds

        // Automated TMDB New Episode Release Alerts for Admins (Runs every 30 minutes)
        const checkNewEpisodeReleasesForAdmins = async () => {
            try {
                const defaultAdmins = ["1329840839", "1175336733"];
                const adminDoc = await db.collection("settings").doc("admins").get();
                const adminList = adminDoc.exists ? adminDoc.data().ids || [] : [];
                const masterList = adminDoc.exists ? adminDoc.data().masters || [] : [];
                const allAdmins = Array.from(new Set([...defaultAdmins, ...adminList, ...masterList]));

                const notifiedDoc = await db.collection("settings").doc("new_episodes_notified").get();
                const notifiedMap = notifiedDoc.exists ? (notifiedDoc.data().episodes || {}) : {};

                let tvSeriesList = [];
                const localMetaPath = path.resolve(__dirname, "./MOVIE/Data/movies_metadata.json");
                if (fs.existsSync(localMetaPath)) {
                    try {
                        const localMeta = JSON.parse(fs.readFileSync(localMetaPath, "utf8"));
                        tvSeriesList = localMeta.filter(m => (m.type || "").toLowerCase() === "series" || (m.type || "").toLowerCase() === "tv");
                    } catch (e) {
                        console.warn("Could not parse local movies_metadata.json:", e.message);
                    }
                }

                for (const show of tvSeriesList) {
                    const tmdbId = show.tmdb_id;
                    if (!tmdbId) continue;

                    const fetchModule = await import('node-fetch').catch(() => null);
                    const fetch = fetchModule ? fetchModule.default : require('http');
                    if (typeof fetch !== 'function') continue;

                    const tmdbRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${botToken || "d638f7775bfa1b8d456dfd028ccbef19"}`);
                    if (!tmdbRes.ok) continue;

                    const tmdbData = await tmdbRes.json();
                    const lastEp = tmdbData.last_episode_to_air;
                    if (!lastEp) continue;

                    const epKey = `${tmdbId}_S${lastEp.season_number}E${lastEp.episode_number}`;
                    if (notifiedMap[epKey] === true) continue;

                    const showTitle = show.title || tmdbData.name || "Published Series";
                    const epName = lastEp.name ? `("${lastEp.name}")` : "";
                    const airDate = lastEp.air_date || "Recently";

                    const adminMsg = `📡 *NEW EPISODE RELEASED ALERT!* 🎬\n\n` +
                                     `*Show:* ${showTitle}\n` +
                                     `*New Episode:* Season ${lastEp.season_number}, Episode ${lastEp.episode_number} ${epName}\n` +
                                     `*Air Date:* ${airDate}\n\n` +
                                     `💡 *Action Required:* Open Film House Admin App to upload/update the link for this show!`;

                    for (const adminId of allAdmins) {
                        try {
                            await (adminBot || bot).telegram.sendMessage(adminId, adminMsg, { parse_mode: "Markdown" });
                        } catch (err) {
                            console.warn(`Failed to send new episode alert to admin ${adminId}:`, err.message);
                        }
                    }

                    notifiedMap[epKey] = true;
                    await db.collection("settings").doc("new_episodes_notified").set({
                        episodes: notifiedMap,
                        lastCheckedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
            } catch (err) {
                console.error("Error in checkNewEpisodeReleasesForAdmins:", err);
            }
        };

        setTimeout(checkNewEpisodeReleasesForAdmins, 30 * 1000);
        setInterval(checkNewEpisodeReleasesForAdmins, 30 * 60 * 1000);

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
            if (adminBot) adminBot.stop(signal);
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
