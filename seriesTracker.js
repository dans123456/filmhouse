/**
 * seriesTracker.js - Background Polling, Auto-Tagging, Admin Alerts & Database Cleanup
 * Part of Film House Ongoing Series Tracker
 */

const fs = require("fs");
const path = require("path");
const { SeriesStatus, sanitizeSeriesTrackerData } = require("./seriesSchema.js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "d638f7775bfa1b8d456dfd028ccbef19";
const DEFAULT_ADMIN_IDS = ["1175336733", "1329840839"];

/**
 * Resolves list of admin IDs to alert.
 */
function getAdminRecipientIds() {
    const envIds = (process.env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    return Array.from(new Set([...DEFAULT_ADMIN_IDS, ...envIds]));
}

/**
 * Sends a Telegram alert to all admins.
 */
async function sendAdminSeriesAlert(botInstance, message, inlineKeyboard = null) {
    if (!botInstance) {
        console.log("[SeriesTracker] (Dry-Run Alert):", message);
        return;
    }

    const adminIds = getAdminRecipientIds();
    const extra = inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {};

    for (const adminId of adminIds) {
        try {
            if (typeof botInstance.telegram?.sendMessage === "function") {
                await botInstance.telegram.sendMessage(adminId, message, { parse_mode: "HTML", ...extra });
            } else if (typeof botInstance.sendMessage === "function") {
                await botInstance.sendMessage(adminId, message, { parse_mode: "HTML", ...extra });
            }
        } catch (err) {
            console.warn(`[SeriesTracker] Could not alert admin ${adminId}:`, err.message);
        }
    }
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

            const nextAirDate = data.next_air_date ? String(data.next_air_date).split("T")[0] : null;

            // Only poll if next_air_date is due (today or earlier) or missing
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
                    // Push next check by 7 days to poll only once a week
                    const futureDate = new Date();
                    futureDate.setDate(futureDate.getDate() + 7);
                    updatedNextAirDate = futureDate.toISOString().split("T")[0];
                    stats.hiatusMarked++;
                    console.log(`[SeriesTracker] "${seriesTitle}" set to 'On Break'. Next check: ${updatedNextAirDate}`);
                } else {
                    updatedStatus = SeriesStatus.ONGOING;
                    updatedNextAirDate = nextEpisodeToAir.air_date || null;
                }

                // 4. ADMIN NOTIFICATIONS
                // Check if last_episode_to_air has aired (air_date <= today) and is not yet uploaded
                if (lastEpisodeToAir && lastEpisodeToAir.air_date && lastEpisodeToAir.air_date <= todayIso) {
                    const airedEpNumber = lastEpisodeToAir.episode_number;
                    const airedSeason = lastEpisodeToAir.season_number;

                    // Only alert if this aired episode belongs to the current tracked season and hasn't been uploaded
                    if (airedSeason === currentSeasonNum && airedEpNumber > lastUploaded) {
                        const lastAlerted = data.last_admin_alert_episode || 0;

                        // Check we haven't already alerted admins for this exact episode
                        if (airedEpNumber > lastAlerted) {
                            const alertMsg = 
                                `🚨 <b>New Episode Aired!</b>\n\n` +
                                `📺 <b>${seriesTitle}</b>\n` +
                                `🎬 <b>Season ${airedSeason}, Episode ${airedEpNumber}</b>\n` +
                                `📅 Air Date: <code>${lastEpisodeToAir.air_date}</code>\n` +
                                `📦 Upload Status: Episode ${lastUploaded} of ${updatedTotalEpisodes || "?"}\n\n` +
                                `👉 <i>Please upload the streaming token and download link in Admin Panel.</i>`;

                            await sendAdminSeriesAlert(botInstance, alertMsg);
                            stats.alertsSent++;
                            console.log(`[SeriesTracker] Alerted admins for ${seriesTitle} S${airedSeason}E${airedEpNumber}`);

                            // Record that we alerted for this episode
                            await doc.ref.set({
                                last_admin_alert_episode: airedEpNumber
                            }, { merge: true });
                        }
                    }
                }

                // Save updated tracking state
                await doc.ref.set({
                    status: updatedStatus,
                    next_air_date: updatedNextAirDate,
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
            const lastUpdated = data.last_updated_timestamp ? new Date(data.last_updated_timestamp).getTime() : 0;

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
