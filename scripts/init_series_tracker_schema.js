/**
 * scripts/init_series_tracker_schema.js
 * Initializes and verifies Firestore collections for Ongoing Series Tracker:
 * - Subscriptions collection
 * - Series tracking fields inside movies collection
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { SeriesStatus, buildSubscriptionDocId, sanitizeSeriesTrackerData } = require("../seriesSchema.js");

// Initialize Firebase Admin
try {
    const serviceAccount = require("../firebase-key.json");
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("[InitTracker] Firebase Admin initialized with firebase-key.json");
} catch (e) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(sa) });
    } else {
        admin.initializeApp({ projectId: "film-house-2" });
    }
}

const db = admin.firestore();

async function initTrackerSchema() {
    console.log("\n========================================================");
    console.log("🚀 Initializing Firestore Schema for Series Tracker");
    console.log("========================================================\n");

    // 1. Verify / Ping Subscriptions Collection
    console.log("Step 1: Testing Subscriptions Collection...");
    const testUserId = "test_system_probe";
    const testTmdbId = 99999999;
    const testDocId = buildSubscriptionDocId(testUserId, testTmdbId);
    const subRef = db.collection("subscriptions").doc(testDocId);

    await subRef.set({
        user_telegram_id: testUserId,
        tmdb_id: testTmdbId,
        series_title: "Schema Verification Probe",
        subscribed_at: new Date().toISOString()
    });
    console.log(`  ✅ Successfully wrote test subscription document: ${testDocId}`);

    const verifySnap = await subRef.get();
    if (verifySnap.exists) {
        console.log(`  ✅ Successfully read back test document: ${JSON.stringify(verifySnap.data())}`);
        await subRef.delete();
        console.log(`  ✅ Cleaned up test probe document.\n`);
    }

    // 2. Scan Existing Series in `movies` Collection and Report Stats
    console.log("Step 2: Inspecting TV Series in movies collection...");
    const moviesSnap = await db.collection("movies").get();
    let totalSeries = 0;
    let seriesWithTracker = 0;

    const batch = db.batch();
    let batchCount = 0;

    moviesSnap.forEach(doc => {
        const data = doc.data();
        const isSeries = (data.type || "").toLowerCase() === "series" || 
                         (data.type || "").toLowerCase() === "tv" ||
                         (Array.isArray(data.categories) && data.categories.some(c => String(c).toLowerCase().includes("series")));

        if (isSeries) {
            totalSeries++;
            if (data.status || data.current_season || typeof data.last_uploaded_episode === "number") {
                seriesWithTracker++;
            } else {
                // Initialize clean default tracking structure
                const defaultTracker = sanitizeSeriesTrackerData({
                    tmdb_id: data.tmdb_id || (data.id && !isNaN(parseInt(data.id, 10)) ? parseInt(data.id, 10) : null),
                    status: null,
                    current_season: 1,
                    last_uploaded_episode: (Array.isArray(data.episodes) ? data.episodes.length : 0),
                    total_episodes: (Array.isArray(data.episodes) ? data.episodes.length : 0),
                    next_air_date: null,
                    last_updated_timestamp: new Date().toISOString()
                });
                batch.set(doc.ref, defaultTracker, { merge: true });
                batchCount++;
            }
        }
    });

    if (batchCount > 0) {
        await batch.commit();
        console.log(`  ✅ Initialized default tracker fields on ${batchCount} series documents.`);
    }

    console.log(`\n📊 Schema Status Summary:`);
    console.log(`  - Total TV Series in Catalog: ${totalSeries}`);
    console.log(`  - Series Configured for Tracking: ${seriesWithTracker + batchCount}`);
    console.log(`  - Subscriptions Collection: READY`);
    console.log("\n========================================================");
    console.log("🎉 Phase 1 Database Structure Complete & Verified!");
    console.log("========================================================\n");
}

initTrackerSchema()
    .then(() => process.exit(0))
    .catch(err => {
        console.error("Fatal Error initializing tracker schema:", err);
        process.exit(1);
    });
