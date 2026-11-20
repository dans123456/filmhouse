/**
 * seriesTracker.js - Background Polling, Auto-Tagging, Admin Alerts & Database Cleanup
 * Part of Film House Ongoing Series Tracker
 */

const fs = require("fs");
const path = require("path");
const { SeriesStatus, sanitizeSeriesTrackerData } = require("./seriesSchema.js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "d638f7775bfa1b8d456dfd028ccbef19";
const DEFAULT_ADMIN_IDS = ["1175336733", "1329840839"];

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function resolveBots(botInstance) {
    if (!botInstance) return { adminBot: null, userBot: null };
    if (botInstance.adminBot || botInstance.userBot) {
        return {
            adminBot: botInstance.adminBot || botInstance.userBot || null,
            userBot: botInstance.userBot || botInstance.adminBot || null
        };
    }
    return { adminBot: botInstance, userBot: botInstance };
}

/**
 * Resolves list of admin IDs to alert (including dynamic admins stored in Firestore settings).
 */
async function getAdminRecipientIds(db = null) {
    const envIds = (process.env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    const ids = new Set([...DEFAULT_ADMIN_IDS, ...envIds]);

    if (db) {
        try {
            const adminDoc = await db.collection("settings").doc("admins").get();
            if (adminDoc.exists) {
                const data = adminDoc.data() || {};
                const list = [
                    ...(Array.isArray(data.ids) ? data.ids : []),
                    ...(Array.isArray(data.masters) ? data.masters : []),
                    ...(Array.isArray(data.admin_ids) ? data.admin_ids : []),
                    ...(Array.isArray(data.list) ? data.list : [])
                ];
                list.forEach(id => { if (id) ids.add(String(id)); });
                if (data.master_id) ids.add(String(data.master_id));
            }
        } catch (e) {
            console.warn("[SeriesTracker] Note reading settings/admins:", e.message);
        }
    }
    return Array.from(ids);
}

/**
 * Sends a Telegram alert to all admins.
 */
async function sendAdminSeriesAlert(botInstance, message, inlineKeyboard = null, db = null) {
    const { adminBot } = resolveBots(botInstance);
    if (!adminBot) {
        console.log("[SeriesTracker] (Dry-Run Alert):", message);
        return false;
    }

    const adminIds = await getAdminRecipientIds(db);
    const extra = inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {};
    let anySent = false;

    for (const adminId of adminIds) {
        try {
            if (typeof adminBot.telegram?.sendMessage === "function") {
                await adminBot.telegram.sendMessage(adminId, message, { parse_mode: "HTML", ...extra });
                anySent = true;
            } else if (typeof adminBot.sendMessage === "function") {
                await adminBot.sendMessage(adminId, message, { parse_mode: "HTML", ...extra });
                anySent = true;
            }
        } catch (err) {
            console.warn(`[SeriesTracker] Could not alert admin ${adminId}:`, err.message);
        }
    }
    return anySent;
}

/**
 * Core Polling & Cleanup Job
 * - Smart query: fetch series with status 'Ongoing' or 'On Break' AND next_air_date <= now
 * - Polls TMDB for air date and upcoming episodes
 * - Hiatus auto-tagging
 * - Admin alerts for newly aired episodes
 * - Purges 'Completed' tag after 14 days
 */
async function runSeriesTrackerCycle(db, botInstance = null) {
    if (!db) {
        console.warn("[SeriesTracker] No Firestore db instance provided.");
        return { success: false, error: "No DB" };
    }

    const now = new Date();
    const todayIso = now.toISOString().split("T")[0]; // YYYY-MM-DD
    console.log(`\n[SeriesTracker] Starting Tracker Cycle at ${now.toISOString()}...`);

    const stats = {
        polled: 0,
        alertsSent: 0,
        hiatusMarked: 0,
        completedCleaned: 0,
        errors: 0
    };

    // =========================================================================
    // 1. SMART QUERY: Active Ongoing / On Break Series
    // =========================================================================
    try {
        const activeSnap = await db.collection("movies")
            .where("status", "in", [SeriesStatus.ONGOING, SeriesStatus.ON_BREAK])
            .limit(50)
            .get();

        for (const doc of activeSnap.docs) {
            const data = doc.data();
            const seriesId = doc.id;
            const seriesTitle = data.title || seriesId;
            const tmdbId = data.tmdb_id || (parseInt(seriesId.split("-")[0], 10) || null);

            if (!tmdbId) {
                continue;
            }

            const nextPollSource = data.next_poll_date || data.next_air_date;
            const nextAirDate = nextPollSource ? String(nextPollSource).split("T")[0] : null;

            // Only poll if next_air_date / next_poll_date is due (today or earlier) or missing
            if (nextAirDate && nextAirDate > todayIso) {
                // Not due yet; protect TMDB rate limits
                continue;
            }

            stats.polled++;
            console.log(`[SeriesTracker] Polling TMDB for "${seriesTitle}" (TMDB ID: ${tmdbId})...`);

            try {
                // 1. Fetch main TV Series data from TMDB
                const tvRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
                if (!tvRes.ok) {
                    console.warn(`[SeriesTracker] TMDB returned ${tvRes.status} for "${seriesTitle}"`);
                    stats.errors++;
                    continue;
                }
                const tvData = await tvRes.json();

                const currentSeasonNum = data.current_season || (tvData.number_of_seasons || 1);
                const lastUploaded = typeof data.last_uploaded_episode === "number" ? data.last_uploaded_episode : 0;
                const nextEpisodeToAir = tvData.next_episode_to_air;
                const lastEpisodeToAir = tvData.last_episode_to_air;

                let updatedStatus = data.status;
                let updatedNextAirDate = data.next_air_date;
                let updatedNextPollDate = null;
                let updatedTotalEpisodes = data.total_episodes || 0;

                // 2. Fetch Season specific details to know total episodes for this season
                try {
                    const seasonRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${currentSeasonNum}?api_key=${TMDB_API_KEY}`);
                    if (seasonRes.ok) {
                        const seasonData = await seasonRes.json();
                        if (Array.isArray(seasonData.episodes)) {
                            updatedTotalEpisodes = seasonData.episodes.length;
                        }
                    }
                } catch (sErr) {
                    console.warn(`[SeriesTracker] Season fetch notice for "${seriesTitle}":`, sErr.message);
                }

                // 3. HIATUS HANDLING
                if (!nextEpisodeToAir) {
                    // No upcoming episode scheduled
                    updatedStatus = SeriesStatus.ON_BREAK;
                    updatedNextAirDate = null;
                    // Push next check by 7 days in next_poll_date to poll only once a week without faking next_air_date
                    const futureDate = new Date();
                    futureDate.setDate(futureDate.getDate() + 7);
                    updatedNextPollDate = futureDate.toISOString().split("T")[0];
                    stats.hiatusMarked++;
                    console.log(`[SeriesTracker] "${seriesTitle}" set to 'On Break'. Next check: ${updatedNextPollDate}`);
                } else {
                    updatedStatus = SeriesStatus.ONGOING;
                    updatedNextAirDate = nextEpisodeToAir.air_date || null;
                    updatedNextPollDate = null;
                }

                // 4. ADMIN NOTIFICATIONS
                // Check if last_episode_to_air has aired (air_date <= today) and is not yet uploaded
                if (lastEpisodeToAir && lastEpisodeToAir.air_date && lastEpisodeToAir.air_date <= todayIso) {
                    const airedEpNumber = lastEpisodeToAir.episode_number;
                    const airedSeason = lastEpisodeToAir.season_number;

                    // Only alert if this aired episode belongs to the current tracked season and hasn't been uploaded
                    if (airedSeason === currentSeasonNum && airedEpNumber > lastUploaded) {
                        const lastAlertedSeason = data.last_admin_alert_season || 0;
                        const lastAlertedEp = (lastAlertedSeason === airedSeason) ? (data.last_admin_alert_episode || 0) : 0;

                        // Check we haven't already alerted admins for this exact season & episode
                        if (airedEpNumber > lastAlertedEp) {
                            const alertMsg = 
                                `🚨 <b>New Episode Aired!</b>\n\n` +
                                `📺 <b>${escapeHtml(seriesTitle)}</b>\n` +
                                `🎬 <b>Season ${airedSeason}, Episode ${airedEpNumber}</b>\n` +
                                `📅 Air Date: <code>${escapeHtml(lastEpisodeToAir.air_date)}</code>\n` +
                                `📦 Upload Status: Episode ${lastUploaded} of ${updatedTotalEpisodes || "?"}\n\n` +
                                `👉 <i>Please upload the streaming token and download link in Admin Panel.</i>`;

                            const sentOk = await sendAdminSeriesAlert(botInstance, alertMsg, null, db);
                            if (sentOk) {
                                stats.alertsSent++;
                                console.log(`[SeriesTracker] Alerted admins for ${seriesTitle} S${airedSeason}E${airedEpNumber}`);

                                // Record that we alerted for this episode
                                await doc.ref.set({
                                    last_admin_alert_season: airedSeason,
                                    last_admin_alert_episode: airedEpNumber
                                }, { merge: true });
                            }
                        }
                    }
                }

                // Save updated tracking state
                await doc.ref.set({
                    status: updatedStatus,
                    next_air_date: updatedNextAirDate,
                    next_poll_date: updatedNextPollDate,
                    total_episodes: updatedTotalEpisodes,
                    last_tracker_sync: new Date().toISOString()
                }, { merge: true });

            } catch (pollErr) {
                console.error(`[SeriesTracker] Error checking ${seriesTitle}:`, pollErr);
                stats.errors++;
            }
        }
    } catch (queryErr) {
        console.error("[SeriesTracker] Active series query error:", queryErr.message);
        stats.errors++;
    }

    // =========================================================================
    // 2. CLEANUP: 'Completed' Tag Expiry after 14 Days
    // =========================================================================
    try {
        const completedSnap = await db.collection("movies")
            .where("status", "==", SeriesStatus.COMPLETED)
            .limit(50)
            .get();

        const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

        for (const doc of completedSnap.docs) {
            const data = doc.data();
            const rawTs = data.last_updated_timestamp;
            let lastUpdated = 0;
            if (rawTs) {
                if (typeof rawTs.toMillis === "function") lastUpdated = rawTs.toMillis();
                else if (typeof rawTs.toDate === "function") lastUpdated = rawTs.toDate().getTime();
                else if (typeof rawTs._seconds === "number") lastUpdated = rawTs._seconds * 1000;
                else if (typeof rawTs.seconds === "number") lastUpdated = rawTs.seconds * 1000;
                else lastUpdated = new Date(rawTs).getTime() || 0;
            }

            if (lastUpdated > 0 && (now.getTime() - lastUpdated) > FOURTEEN_DAYS_MS) {
                // Older than 14 days - reset status to null
                await doc.ref.set({ status: null }, { merge: true });
                stats.completedCleaned++;
                console.log(`[SeriesTracker] Reset expired 'Completed' status to null for "${data.title || doc.id}"`);
            }
        }
    } catch (cleanErr) {
        console.warn("[SeriesTracker] Completed tag cleanup note:", cleanErr.message);
    }

    // =========================================================================
    // 3. MOVIE RELEASE REMINDERS DISPATCHER
    // =========================================================================
    try {
        const { userBot } = resolveBots(botInstance);
        const remindersSnap = await db.collection("release_reminders")
            .where("status", "==", "pending")
            .get();

        let processedDueCount = 0;
        for (const rDoc of remindersSnap.docs) {
            if (processedDueCount >= 50) break;
            const rData = rDoc.data();
            const relDate = rData.release_date ? String(rData.release_date).split("T")[0] : null;
            
            // Check if release date has arrived (<= today)
            if (relDate && relDate <= todayIso) {
                processedDueCount++;
                const userTelegramId = rData.user_id;
                const movieTitle = rData.movie_title || "Your requested movie";
                
                if (!userTelegramId) {
                    await rDoc.ref.set({
                        status: "failed_invalid_user",
                        notified_at: new Date().toISOString()
                    }, { merge: true });
                    continue;
                }

                if (!userBot) {
                    continue;
                }

                try {
                    const alertMsg = 
                        `🍿 <b>"${escapeHtml(movieTitle)}" is Officially Released!</b>\n\n` +
                        `Great news! The movie you asked to be alerted about has officially premiered (${escapeHtml(relDate)}).\n\n` +
                        `👉 Open Film House now to stream or download:`;
                    
                    const miniAppUrl = "https://t.me/Filmhouseappbot/filmhouseapp";
                    const keyboard = [[{ text: "🎬 Open Film House", url: miniAppUrl }]];
                    
                    if (typeof userBot.telegram?.sendMessage === "function") {
                        await userBot.telegram.sendMessage(userTelegramId, alertMsg, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
                    } else if (typeof userBot.sendMessage === "function") {
                        await userBot.sendMessage(userTelegramId, alertMsg, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
                    }

                    // Mark as notified only after successful delivery
                    await rDoc.ref.set({
                        status: "notified",
                        notified_at: new Date().toISOString()
                    }, { merge: true });
                    stats.alertsSent++;
                    console.log(`[ReleaseReminder] Sent release alert for "${movieTitle}" to user ${userTelegramId}`);
                } catch (sendErr) {
                    console.warn(`[ReleaseReminder] Could not send reminder to user ${userTelegramId}:`, sendErr.message);
                    const errMsg = String(sendErr.message || "");
                    if (errMsg.includes("403") || errMsg.includes("blocked") || errMsg.includes("chat not found") || errMsg.includes("deactivated")) {
                        await rDoc.ref.set({
                            status: "failed_blocked",
                            error: errMsg,
                            notified_at: new Date().toISOString()
                        }, { merge: true });
                    }
                }
            }
        }
    } catch (reminderErr) {
        console.warn("[ReleaseReminder] Error dispatching reminders:", reminderErr.message);
    }

    console.log(`[SeriesTracker] Cycle Complete. Stats: Polled=${stats.polled}, Alerts=${stats.alertsSent}, Hiatus=${stats.hiatusMarked}, Cleaned=${stats.completedCleaned}, Errors=${stats.errors}\n`);
    return { success: true, stats };
}

/**
 * Initializes continuous background timer inside the bot process.
 */
function startSeriesTrackerService(db, botInstance, intervalMs = 2 * 60 * 60 * 1000) {
    console.log(`[SeriesTracker] Initializing Series Tracker background worker (Interval: ${Math.round(intervalMs / 60000)}m)...`);
    
    // Initial run delayed by 20s to allow server to boot smoothly
    setTimeout(() => {
        runSeriesTrackerCycle(db, botInstance).catch(err => {
            console.error("[SeriesTracker] Error in initial cycle:", err);
        });
    }, 20000);

    // Periodic scheduled timer
    const timer = setInterval(() => {
        runSeriesTrackerCycle(db, botInstance).catch(err => {
            console.error("[SeriesTracker] Error in scheduled cycle:", err);
        });
    }, intervalMs);

    return timer;
}

// Standalone execution support: `node seriesTracker.js`
if (require.main === module) {
    try {
        const admin = require("firebase-admin");
        const serviceAccount = require("./firebase-key.json");
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        console.log("[SeriesTracker] Executing standalone cycle...");
        runSeriesTrackerCycle(db).then((res) => {
            console.log("[SeriesTracker] Standalone execution finished:", res);
            process.exit(0);
        }).catch(err => {
            console.error("[SeriesTracker] Standalone execution failed:", err);
            process.exit(1);
        });
    } catch (e) {
        console.error("[SeriesTracker] Standalone initialization error:", e.message);
        process.exit(1);
    }
}

module.exports = {
    runSeriesTrackerCycle,
    startSeriesTrackerService,
    sendAdminSeriesAlert
};
