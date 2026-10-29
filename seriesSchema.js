/**
 * seriesSchema.js - Unified Schema Definitions & Helpers for Ongoing Series Tracker
 * Used across Film House Backend (bot.js), Admin Panel, and Mini App (app.js).
 */

const SeriesStatus = {
    ONGOING: "Ongoing",
    ON_BREAK: "On Break",
    COMPLETED: "Completed"
};

/**
 * Generates a deterministic document ID for subscriptions: {user_telegram_id}_{tmdb_id}
 * Automatically prevents duplicate subscriptions in Firestore.
 */
function buildSubscriptionDocId(userTelegramId, tmdbId) {
    if (!userTelegramId || !tmdbId) return "";
    return `${String(userTelegramId).trim()}_${String(tmdbId).trim()}`;
}

/**
 * Validates and normalizes series tracker fields before writing to Firestore.
 */
function sanitizeSeriesTrackerData(data = {}) {
    return {
        tmdb_id: data.tmdb_id ? parseInt(data.tmdb_id, 10) : null,
        status: [SeriesStatus.ONGOING, SeriesStatus.ON_BREAK, SeriesStatus.COMPLETED].includes(data.status) 
            ? data.status 
            : null,
        current_season: data.current_season ? parseInt(data.current_season, 10) : 1,
        last_uploaded_episode: typeof data.last_uploaded_episode === "number" 
            ? data.last_uploaded_episode 
            : parseInt(data.last_uploaded_episode, 10) || 0,
        total_episodes: typeof data.total_episodes === "number" 
            ? data.total_episodes 
            : parseInt(data.total_episodes, 10) || 0,
        next_air_date: data.next_air_date ? String(data.next_air_date).trim() : null,
        last_updated_timestamp: data.last_updated_timestamp || new Date().toISOString()
    };
}

/**
 * Calculates human-friendly countdown badge copy based on next_air_date and status.
 * Returns { label: string, variant: string }
 */
function getSeriesCountdownBadge(series = {}) {
    const status = series.status || null;
    const nextAirDate = series.next_air_date || null;
    const lastUploaded = series.last_uploaded_episode || 0;
    const totalEpisodes = series.total_episodes || 0;

    if (status === SeriesStatus.COMPLETED || (totalEpisodes > 0 && lastUploaded >= totalEpisodes)) {
        return { label: "Season Complete", variant: "completed" };
    }

    if (status === SeriesStatus.ON_BREAK && !nextAirDate) {
        return { label: "On Break", variant: "break" };
    }

    if (!nextAirDate) {
        return status ? { label: status, variant: "status" } : null;
    }

    const airDate = new Date(nextAirDate);
    if (isNaN(airDate.getTime())) {
        return status ? { label: status, variant: "status" } : null;
    }

    const now = new Date();
    // Normalize both to UTC midnight for precise day calculation
    const utcAir = Date.UTC(airDate.getFullYear(), airDate.getMonth(), airDate.getDate());
    const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.ceil((utcAir - utcNow) / (1000 * 60 * 60 * 24));

    if (diffDays > 1) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formattedDate = `${monthNames[airDate.getMonth()]} ${airDate.getDate()}`;
        return { label: `Next Episode: ${formattedDate}`, variant: "upcoming" };
    }

    if (diffDays === 1) {
        return { label: "Airs Tomorrow", variant: "tomorrow" };
    }

    if (diffDays <= 0) {
        return { label: "New Episode Today (Awaiting Upload)", variant: "today" };
    }

    return null;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        SeriesStatus,
        buildSubscriptionDocId,
        sanitizeSeriesTrackerData,
        getSeriesCountdownBadge
    };
}
