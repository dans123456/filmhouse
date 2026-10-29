// Safe localStorage wrapper to prevent crashes when third-party cookies/storage are blocked inside webview sandboxes
const safeStorage = (() => {
    let available = false;
    try {
        const test = "__store_test__";
        window.localStorage.setItem(test, test);
        window.localStorage.removeItem(test);
        available = true;
    } catch (e) {
        available = false;
        console.warn("localStorage is blocked or unavailable. Falling back to temporary in-memory storage.");
    }
    const inMemoryStorage = {};
    return {
        getItem(key) {
            if (available) {
                try { return window.localStorage.getItem(key); } catch (e) {}
            }
            return inMemoryStorage.hasOwnProperty(key) ? inMemoryStorage[key] : null;
        },
        setItem(key, value) {
            if (available) {
                try { window.localStorage.setItem(key, value); return; } catch (e) {}
            }
            inMemoryStorage[key] = String(value);
        },
        removeItem(key) {
            if (available) {
                try { window.localStorage.removeItem(key); return; } catch (e) {}
            }
            delete inMemoryStorage[key];
        }
    };
})();
const localStorage = safeStorage;

// Normalize titles for comparison, matching and search: strips symbols, leading articles, handles plurals
function normalizeTitleForComparison(title) {
    if (!title) return "";
    let s = String(title).toLowerCase();
    // 1. Strip trailing parentheses (e.g. "(Season 1)", "(2024)", "(1080p Quality)")
    s = s.replace(/\s*\([^)]+\)\s*$/g, "").trim();
    // 2. Replace & with and
    s = s.replace(/&/g, " and ");
    // 3. Remove leading articles: "the ", "a ", "an "
    s = s.replace(/^(the|a|an)\s+/i, "");
    // 4. Remove internal " the " (e.g. "House of the Dragon" vs "House of Dragon")
    s = s.replace(/\bthe\b/gi, " ");
    // 5. Replace all symbols and punctuation with spaces
    s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
    // 6. Handle common plurals at word boundaries: "dragons" -> "dragon"
    s = s.replace(/\b([a-z]{3,})s\b/gi, "$1");
    // 7. Collapse spaces
    s = s.replace(/\s+/g, " ").trim();
    return s;
}

// Alphanumeric collapsed representation with zero spaces/punctuation (e.g. "S.W.A.T." -> "swat")
function getCollapsedTitle(title) {
    if (!title) return "";
    const clean = normalizeTitleForComparison(title);
    return clean.replace(/[^a-z0-9]/gi, "");
}

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'of', 'in', 'to', 'for', 'on', 'at', 'by', 'with', 'from',
    'part', 'chapter', 'vol', 'volume', 'pt'
]);

// Robust fuzzy & punctuation-insensitive title matcher
function titlesMatch(titleA, titleB) {
    if (!titleA || !titleB) return false;
    const normA = normalizeTitleForComparison(titleA);
    const normB = normalizeTitleForComparison(titleB);
    if (!normA || !normB) return false;

    // 1. Exact normalized match
    if (normA === normB) return true;

    // 2. Collapsed alphanumeric match (e.g. "S.W.A.T." and "SWAT" -> "swat" === "swat")
    const colA = getCollapsedTitle(titleA);
    const colB = getCollapsedTitle(titleB);
    if (colA && colB && colA === colB) return true;

    // 3. Keyword-level comparison with stop-word filtering
    const toksA = normA.split(/\s+/).filter(Boolean);
    const toksB = normB.split(/\s+/).filter(Boolean);

    const kwA = toksA.filter(t => !STOP_WORDS.has(t));
    const kwB = toksB.filter(t => !STOP_WORDS.has(t));

    const effA = kwA.length > 0 ? kwA : toksA;
    const effB = kwB.length > 0 ? kwB : toksB;

    const setA = new Set(effA);
    const setB = new Set(effB);

    const intersection = [...setA].filter(t => setB.has(t));
    const union = new Set([...setA, ...setB]);

    // Identical distinct content words (e.g. "The King of Kings" and "King of Kings")
    if (setA.size === setB.size && intersection.length === setA.size) {
        return true;
    }

    // High Jaccard similarity (>= 85%) on content keywords with at least 2 shared keywords
    const jaccard = intersection.length / union.size;
    if (jaccard >= 0.85 && intersection.length >= 2) {
        return true;
    }

    return false;
}

function getCleanRequestTitle(title) {
    if (!title) return "";
    return normalizeTitleForComparison(title);
}

let isCurrentUserSlaveAdmin = false;

// Premium Floating Toast Notification Helper
function showToast(message, type = "success") {
    console.log(`[Toast] [${type}] ${message}`);
    let toastContainer = document.getElementById("admin-toast-container");
    if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.id = "admin-toast-container";
        toastContainer.style.cssText = `
            position: fixed;
            top: 24px;
            right: 24px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 1000000;
            pointer-events: none;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement("div");
    toast.style.cssText = `
        background: rgba(18, 20, 29, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-20px);
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 250px;
    `;

    if (type === "success") {
        toast.style.borderLeft = "4px solid #4caf50";
        toast.innerHTML = `<span>✅</span> <span>${message}</span>`;
    } else if (type === "error" || type === "danger") {
        toast.style.borderLeft = "4px solid #f44336";
        toast.innerHTML = `<span>❌</span> <span>${message}</span>`;
    } else if (type === "warning") {
        toast.style.borderLeft = "4px solid #ff9800";
        toast.innerHTML = `<span>⚠️</span> <span>${message}</span>`;
    } else if (type === "info") {
        toast.style.borderLeft = "4px solid #2196f3";
        toast.innerHTML = `<span>ℹ️</span> <span>${message}</span>`;
    } else {
        toast.style.borderLeft = "4px solid #ffd700";
        toast.innerHTML = `<span>🔔</span> <span>${message}</span>`;
    }

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    }, 10);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-20px)";
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Collapsible Panel Toggle Helper
function togglePanel(contentId, chevronId) {
    const content = document.getElementById(contentId);
    const chevron = document.getElementById(chevronId);
    if (!content) return;
    
    if (content.style.display === "none") {
        content.style.display = "block";
        if (chevron) chevron.style.transform = "rotate(180deg)";
    } else {
        content.style.display = "none";
        if (chevron) {
            chevron.style.transform = "rotate(0deg)";
        }
    }
}

// Film House - Standalone Admin Command Center Logic
const firebaseConfig = {
    apiKey: "AIzaSyCXs2tNgG07tAlsCkR96PNNIVIDyDkJD78",
    authDomain: "film-house-2.firebaseapp.com",
    projectId: "film-house-2",
    storageBucket: "film-house-2.firebasestorage.app",
    messagingSenderId: "698060918982",
    appId: "1:698060918982:web:cf5fd73cc71aef002907c7"
};

// HTML Escaper helper to prevent XSS injection in dynamic HTML content
function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    if (typeof str !== "string") str = String(str);
    return str.replace(/[&<>"']/g, function(match) {
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;'
        };
        return escapeMap[match];
    });
}

function extractYoutubeId(urlOrId) {
    if (!urlOrId) return "";
    const cleanStr = urlOrId.trim();
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = cleanStr.match(regExp);
    if (match && match[2].length === 11) {
        return match[2];
    }
    return cleanStr;
}

// Clean and extract stream token or URL from TGStream, Blogspot, or raw tokens
function cleanStreamInput(input) {
    if (!input) return "";
    let s = String(input).trim();
    if (!s) return "";
    // If it's a URL, extract query parameters or path segments
    if (s.includes("://") || s.includes("blogspot.com") || s.includes("watch") || s.includes("dl")) {
        try {
            // Check query parameters: ?watch=... or ?id=... or ?stream=... or ?dl=...
            const qMatch = s.match(/[?&](?:watch|stream|id|dl)=([^&#]+)/i);
            if (qMatch && qMatch[1]) {
                return decodeURIComponent(qMatch[1]).trim();
            }
            // Check path segments: /watch/TOKEN or /dl/TOKEN or /stream/TOKEN
            const pathMatch = s.match(/(?:\/watch\/|\/dl\/|\/stream\/|\/v\/)([a-zA-Z0-9_\-]+)/i);
            if (pathMatch && pathMatch[1]) {
                return pathMatch[1].trim();
            }
        } catch (e) {}
    }
    // Check for 24-character hex ID (standard in TGStream / MongoDB)
    const hexMatch = s.match(/\b([a-f0-9]{24})\b/i);
    if (hexMatch) {
        return hexMatch[1];
    }
    return s;
}

function extractTmdbIdAndType(inputVal) {
    if (!inputVal || typeof inputVal !== "string") return null;
    if (!inputVal.toLowerCase().includes("themoviedb.org")) return null;
    try {
        let cleanVal = inputVal.trim();
        if (!/^https?:\/\//i.test(cleanVal)) {
            cleanVal = "https://" + cleanVal;
        }
        const url = new URL(cleanVal);
        const pathSegments = url.pathname.split("/").filter(Boolean);
        const typeIndex = pathSegments.findIndex(segment => segment.toLowerCase() === "movie" || segment.toLowerCase() === "tv");
        if (typeIndex !== -1 && typeIndex < pathSegments.length - 1) {
            const mediaType = pathSegments[typeIndex].toLowerCase();
            const idAndSlug = pathSegments[typeIndex + 1];
            const numericId = idAndSlug.split("-")[0];
            if (/^\d+$/.test(numericId)) {
                return {
                    id: idAndSlug,
                    type: mediaType === "tv" ? "tv" : "movie"
                };
            }
        }
    } catch (e) {
        console.error("Error parsing TMDB URL:", e);
    }
    return null;
}

function normalizeQualityName(str) {
    if (!str) return "720p";
    const s = String(str).toLowerCase().trim();
    if (s.includes("2160") || s.includes("4k") || s.includes("uhd")) return "2160p (4K)";
    if (s.includes("1080")) return "1080p";
    if (s.includes("720")) return "720p";
    if (s.includes("480")) return "480p";
    if (s.includes("cam") || s.includes("cinema") || s.includes("cut")) return "Cinema Cut / HDCam";
    return "720p";
}

function parseBulkLinks(rawText, isSeries) {
    if (!rawText || typeof rawText !== "string") return [];
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const parsed = [];

    function detectQuality(str, fallbackIdx) {
        const lower = str.toLowerCase();
        if (lower.includes("4k") || lower.includes("2160") || lower.includes("uhd")) return "2160p (4K)";
        if (lower.includes("1080") || lower.includes("fhd")) return "1080p";
        if (lower.includes("720") || lower.includes("hd")) return "720p";
        if (lower.includes("480") || lower.includes("sd")) return "480p";
        if (lower.includes("cinema") || lower.includes("cam") || lower.includes("hdcam")) return "Cinema Cut / HDCam";
        const standardOrder = ["720p", "1080p", "2160p (4K)", "480p"];
        return standardOrder[fallbackIdx % standardOrder.length] || "720p";
    }

    function detectSeason(str, fallbackIdx) {
        const sMatch = str.match(/season\s*(\d+)/i) || str.match(/s(\d+)/i);
        if (sMatch) {
            return `Season ${parseInt(sMatch[1], 10)}`;
        }
        return `Season ${fallbackIdx + 1}`;
    }

    lines.forEach((line, idx) => {
        const urlMatch = line.match(/(https?:\/\/[^\s]+|t\.me\/[^\s]+)/i);
        let url = urlMatch ? urlMatch[0] : line;
        if (url.startsWith("t.me")) {
            url = "https://" + url;
        }
        if (isSeries) {
            const season = detectSeason(line, idx);
            parsed.push({ url, season });
        } else {
            const quality = detectQuality(line, idx);
            parsed.push({ url, quality });
        }
    });

    return parsed;
}

function parseBulkStreams(rawText, isSeries) {
    if (!rawText || typeof rawText !== "string") return [];
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const parsed = [];

    function detectQuality(str, fallbackIdx) {
        const lower = str.toLowerCase();
        if (lower.includes("4k") || lower.includes("2160") || lower.includes("uhd")) return "2160p (4K)";
        if (lower.includes("1080") || lower.includes("fhd")) return "1080p";
        if (lower.includes("720") || lower.includes("hd")) return "720p";
        if (lower.includes("480") || lower.includes("sd")) return "480p";
        if (lower.includes("cinema") || lower.includes("cam") || lower.includes("hdcam")) return "Cinema Cut / HDCam";
        const standardOrder = ["720p", "1080p", "2160p (4K)", "480p"];
        return standardOrder[fallbackIdx % standardOrder.length] || "720p";
    }

    function detectEpisode(str, fallbackIdx) {
        const epMatch = str.match(/(?:ep(?:isode)?|e)\s*(\d+)/i) || str.match(/\b(\d+)\b/);
        if (epMatch) {
            return parseInt(epMatch[1], 10);
        }
        return fallbackIdx + 1;
    }

    lines.forEach((line, idx) => {
        let tokenOrUrl = line;
        let specifiedQuality = "";
        let specifiedEpisode = 0;

        if (line.includes("|")) {
            const parts = line.split("|");
            const prefix = parts[0].trim();
            tokenOrUrl = parts.slice(1).join("|").trim();
            if (isSeries) {
                specifiedEpisode = detectEpisode(prefix, idx);
            } else {
                specifiedQuality = detectQuality(prefix, idx);
            }
        }

        const cleaned = cleanStreamInput(tokenOrUrl);
        if (!cleaned) return;

        if (isSeries) {
            const epNum = specifiedEpisode || (idx + 1);
            parsed.push({ url: cleaned, episode: epNum });
        } else {
            const quality = specifiedQuality || detectQuality(line, idx);
            parsed.push({ url: cleaned, quality });
        }
    });

    return parsed;
}

function extractMovieStreams(targetMovie) {
    if (!targetMovie) return [];
    
    if (Array.isArray(targetMovie.stream_links) && targetMovie.stream_links.length > 0) {
        return targetMovie.stream_links.map((s, idx) => {
            const token = cleanStreamInput(typeof s === 'object' && s !== null ? (s.stream_url || s.url || '') : s);
            return {
                episode: (typeof s === 'object' && s !== null && s.episode) ? parseInt(s.episode, 10) : (idx + 1),
                season: (typeof s === 'object' && s !== null && s.season) ? parseInt(s.season, 10) : 1,
                quality: (typeof s === 'object' && s !== null && s.quality) ? s.quality : '720p',
                stream_url: token,
                url: token
            };
        }).filter(s => !!s.stream_url);
    }
    
    // Check links array for stream_urls
    const extracted = [];
    if (Array.isArray(targetMovie.links)) {
        targetMovie.links.forEach((l, idx) => {
            if (typeof l === 'object' && l !== null && l.stream_url) {
                const token = cleanStreamInput(l.stream_url);
                if (token) {
                    extracted.push({
                        episode: l.episode || (idx + 1),
                        season: l.season || 1,
                        quality: l.quality || '720p',
                        stream_url: token,
                        url: token
                    });
                }
            }
        });
    }
    if (extracted.length > 0) return extracted;
    
    // Fallback to targetMovie.stream_url
    const single = cleanStreamInput(targetMovie.stream_url || '');
    if (single) {
        return [{
            episode: 1,
            season: 1,
            quality: '720p',
            stream_url: single,
            url: single
        }];
    }
    return [];
}

// Global Datasets for local search filter matching (saves Firestore quota reads)
let allUsers = [];
let adminIdsList = ["1329840839", "1175336733"];
let allRequests = [];
let requestFilterTab = "actionable"; // actionable | priority | pending | fulfilled | all

function getPosterUrl(posterPath) {
    if (!posterPath) return "MOVIE/img/FilmHouse3_nobg.png";
    if (posterPath.startsWith("img/")) {
        return "MOVIE/" + posterPath;
    }
    return posterPath;
}

// Initialize Firebase & Firestore
let db = null;
const statusTextEl = document.getElementById("status-text");

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    if (statusTextEl) {
        statusTextEl.textContent = "LIVE SYNC ACTIVE";
    }
} catch (e) {
    console.error("Firebase initialization failed:", e);
    if (statusTextEl) {
        statusTextEl.textContent = "CONNECTION OFFLINE";
        statusTextEl.parentElement.style.background = "rgba(255, 59, 48, 0.1)";
        statusTextEl.parentElement.style.borderColor = "rgba(255, 59, 48, 0.3)";
        statusTextEl.style.color = "#ff3b30";
    }
}

// Safe Timestamp & Date Helpers for App User Profiles
function getSafeTimestamp(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val.toDate === 'function') return val.toDate().getTime();
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? 0 : parsed;
}

function formatJoinedDate(val) {
    if (!val) return "Unknown";
    if (typeof val.toDate === 'function') return val.toDate().toLocaleDateString();
    if (typeof val.toMillis === 'function') return new Date(val.toMillis()).toLocaleDateString();
    if (typeof val.seconds === 'number') return new Date(val.seconds * 1000).toLocaleDateString();
    if (typeof val === 'number') return new Date(val).toLocaleDateString();
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleDateString();
}

// Smart Caching for Users to save Firestore daily read quota
const USERS_CACHE_KEY = "filmhouse_admin_users_cache";
const USERS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

function loadUsersFromCache() {
    try {
        const raw = sessionStorage.getItem(USERS_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < USERS_CACHE_TTL) && Array.isArray(parsed.users)) {
                return parsed.users;
            }
        }
    } catch (e) {}
    return null;
}

function saveUsersToCache(users) {
    try {
        sessionStorage.setItem(USERS_CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            users: users
        }));
    } catch (e) {}
}

window.forceRefreshUsers = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const refreshBtn = document.getElementById("btn-refresh-users");
    if (refreshBtn) {
        refreshBtn.style.transform = "rotate(360deg)";
        refreshBtn.style.transition = "transform 0.5s ease";
        setTimeout(() => { refreshBtn.style.transform = "none"; }, 500);
    }
    sessionStorage.removeItem(USERS_CACHE_KEY);
    initUsersSync(true);
};

function initUsersSync(force = false) {
    const cached = !force ? loadUsersFromCache() : null;
    if (cached && cached.length > 0) {
        console.log(`[Cache] Loaded ${cached.length} users from sessionStorage (0 Firestore reads consumed).`);
        allUsers = cached;
        db.collection("settings").doc("admins").get().then(adminDoc => {
            const adminIds = adminDoc.exists ? adminDoc.data().ids || [] : [];
            const defaultAdmins = ["1329840839", "1175336733"];
            adminIdsList = Array.from(new Set([...defaultAdmins, ...adminIds]));
            updateStatsCounters();
            renderUsersList();
            populateAllocatorDropdowns();
        }).catch(() => {
            updateStatsCounters();
            renderUsersList();
            populateAllocatorDropdowns();
        });
        return;
    }

    if (!db) return;
    db.collection("users").get().then(snapshot => {
        allUsers = [];
        snapshot.forEach(doc => {
            const u = doc.data();
            u.id = u.id || doc.id;
            allUsers.push(u);
        });
        allUsers.sort((a, b) => {
            const timeA = getSafeTimestamp(a.lastSeen);
            const timeB = getSafeTimestamp(b.lastSeen);
            return timeB - timeA;
        });
        saveUsersToCache(allUsers);
        db.collection("settings").doc("admins").get().then(adminDoc => {
            const adminIds = adminDoc.exists ? adminDoc.data().ids || [] : [];
            const defaultAdmins = ["1329840839", "1175336733"];
            adminIdsList = Array.from(new Set([...defaultAdmins, ...adminIds]));
            updateStatsCounters();
            renderUsersList();
            populateAllocatorDropdowns();
        }).catch(() => {
            updateStatsCounters();
            renderUsersList();
            populateAllocatorDropdowns();
        });
    }).catch(err => {
        console.warn("Users fetch issue (quota or offline):", err.message);
        try {
            const fallbackRaw = sessionStorage.getItem(USERS_CACHE_KEY);
            if (fallbackRaw) {
                const parsed = JSON.parse(fallbackRaw);
                if (parsed && Array.isArray(parsed.users)) {
                    allUsers = parsed.users;
                    updateStatsCounters();
                    renderUsersList();
                }
            }
        } catch (e) {}
    });
}

// Bind Live Snapshot Listeners
if (db) {
    // 1. Synchronize Users using intelligent cache
    initUsersSync();

    // 2. Real-time Movie Requests Listener
    db.collection("requests").onSnapshot(snapshot => {
        allRequests = [];
        snapshot.forEach(doc => {
            const req = doc.data();
            req.docId = doc.id;
            allRequests.push(req);
        });
        allRequests.sort((a, b) => {
            const dateA = parseRequestDate(a.requestedAt || a.timestamp || a.fulfilledAt || a._localTime);
            const dateB = parseRequestDate(b.requestedAt || b.timestamp || b.fulfilledAt || b._localTime);
            const tA = dateA ? dateA.getTime() : 0;
            const tB = dateB ? dateB.getTime() : 0;
            return tB - tA;
        });
        updateStatsCounters();
        renderRequestsList();
        renderAdminLeaderboard();
    }, err => {
        console.error("Requests sync issue:", err);
    });
}

// Helper: Check if a request doc is fulfilled by explicit status or download link
function isRequestFulfilled(r) {
    if (!r) return false;
    // An active priority or boosted request is ALWAYS pending unless it has an explicit download link!
    if (r.status === "priority" || r.boosted === true || r.isPriority === true) {
        return !!(r.downloadLink && String(r.downloadLink).trim() !== "");
    }
    // Only fulfilled if status is "fulfilled", or if it was claimed WITH a valid download link
    if (r.status === "fulfilled") return true;
    if (r.downloadLink && String(r.downloadLink).trim() !== "") return true;
    if ((r.status === "claimed" || r.claimed === true) && r.downloadLink && String(r.downloadLink).trim() !== "") return true;
    return false;
}

// Helper: Check if a pending request already has matching content with active links in the catalog (for UI badge and one-click fulfillment)
function hasCatalogMatch(r) {
    if (!r || !allCatalogMovies || allCatalogMovies.length === 0) return false;

    const reqSpecClean = (r.seasonOrPart || "").toLowerCase().trim();
    const isQualityReq = reqSpecClean.includes("quality") || reqSpecClean.includes("1080") || reqSpecClean.includes("720") || reqSpecClean.includes("2160") || reqSpecClean.includes("4k") || reqSpecClean.includes("480");
    const isSeasonReq = reqSpecClean.includes("season") || !!reqSpecClean.match(/\bs\d+\b/i);
    const isReqSeries = (r.type || "").toLowerCase() === 'series' || (r.type || "").toLowerCase() === 'tv';

    return allCatalogMovies.some(m => {
        const hasLinks = Array.isArray(m.links) && m.links.length > 0 && m.links.some(l => {
            const url = typeof l === 'object' && l !== null ? (l.url || l.link) : l;
            return url && String(url).trim() !== "";
        });
        if (!hasLinks) return false;

        const rId = String(r.tmdb_id || r.csv_id || '').split('-')[0].trim();
        const mId = String(m.tmdb_id || m.csv_id || '').split('-')[0].trim();
        const isSeriesMedia = isReqSeries || (m.type || "").toLowerCase() === 'series' || (m.type || "").toLowerCase() === 'tv';

        const hasValidRId = rId && !isNaN(rId);
        const hasValidMId = mId && !isNaN(mId);
        const isIdMatch = hasValidRId && hasValidMId && rId === mId;
        const isTitleMatch = (!hasValidRId || !hasValidMId) && titlesMatch(m.title, r.title);
        if (!isIdMatch && !isTitleMatch) return false;

        // 1. If user requested a specific season for a series, verify the catalog actually has that season
        if (isSeriesMedia && isSeasonReq) {
            const sMatch = reqSpecClean.match(/season\s*(\d+)/i) || reqSpecClean.match(/\bs(\d+)\b/i);
            const sNum = sMatch ? sMatch[1] : null;
            return m.links.some(link => {
                const sLabel = (typeof link === 'object' && link !== null ? (link.season || link.quality || "") : "").toLowerCase();
                const lUrl = typeof link === 'object' && link !== null ? (link.url || link.link) : link;
                const hasValidUrl = lUrl && String(lUrl).trim() !== "";
                if (!hasValidUrl) return false;
                if (sNum) {
                    return sLabel.includes(`season ${sNum}`) || sLabel.includes(`s${sNum}`);
                }
                return sLabel.includes(reqSpecClean);
            });
        }

        // 2. If user requested a specific quality for a movie, verify the catalog actually has that quality
        if (!isSeriesMedia && isQualityReq) {
            const qMatch = reqSpecClean.match(/(2160p|4k|1080p|720p|480p)/i);
            const targetQ = qMatch ? qMatch[1].toLowerCase() : reqSpecClean;
            return m.links.some(link => {
                const lQuality = (typeof link === 'object' && link !== null ? (link.quality || link.season || "") : "").toLowerCase();
                const lUrl = typeof link === 'object' && link !== null ? (link.url || link.link) : link;
                return lQuality.includes(targetQ) && lUrl && String(lUrl).trim() !== "";
            });
        }

        // 3. For general requests without specific season/quality, catalog having active links fulfills it
        return true;
    });
}

// Calculate Stats and Update Counters
function updateStatsCounters() {
    // Total registered users
    const totalUsersEl = document.getElementById("stat-users");
    if (totalUsersEl) totalUsersEl.textContent = allUsers.length;
    
    const usersBadgeEl = document.getElementById("users-count-badge");
    if (usersBadgeEl) usersBadgeEl.textContent = `${allUsers.length} Registered`;

    const statTotalUsers = document.getElementById("stat-total-users");
    if (statTotalUsers) statTotalUsers.textContent = allUsers.length;

    // Total points economy circulation
    let totalPoints = 0;
    allUsers.forEach(u => {
        totalPoints += parseInt(u.points || 0);
    });
    const statTotalPoints = document.getElementById("stat-total-points");
    if (statTotalPoints) statTotalPoints.textContent = totalPoints.toLocaleString();

    // Completed requests fulfillment rate
    const totalReqCount = allRequests.length;
    const fulfilledReqCount = allRequests.filter(r => isRequestFulfilled(r)).length;
    const fulfillmentRate = totalReqCount > 0 ? Math.round((fulfilledReqCount / totalReqCount) * 100) : 100;
    const statFulfillmentRate = document.getElementById("stat-fulfillment-rate");
    if (statFulfillmentRate) {
        statFulfillmentRate.textContent = `${fulfillmentRate}% (${fulfilledReqCount}/${totalReqCount})`;
    }

    // Catalog Size
    const statCatalogSize = document.getElementById("stat-catalog-size");
    if (statCatalogSize) statCatalogSize.textContent = allCatalogMovies.length;

    // Categories breakdown calculator
    const breakdownContainer = document.getElementById("catalog-breakdown-container");
    const categoriesList = document.getElementById("analytics-categories-list");
    if (breakdownContainer && categoriesList) {
        if (allCatalogMovies.length > 0) {
            breakdownContainer.style.display = "block";
            const categoryCounts = {};
            allCatalogMovies.forEach(m => {
                const cats = m.categories || ["Main"];
                cats.forEach(cat => {
                    const cleanCat = String(cat).trim() || "Main";
                    categoryCounts[cleanCat] = (categoryCounts[cleanCat] || 0) + 1;
                });
            });
            
            categoriesList.innerHTML = "";
            const labelMap = {
                "Main": "Main Featured Library 🌟",
                "Hollywood/British Series": "Hollywood TV Series 📺",
                "Hollywood/British Movies": "Hollywood Movies (Stand-alone) 🎬",
                "Kids Shows and Movies (Nickelodeon and Disney)": "Kids / Disney / Family 🧒",
                "Classic Movies": "Classic Movies 🎞️",
                "Animated Movies": "Animated Movies 🎨",
                "Comic": "Comic & Superhero 🦸",
                "Erotic Movies": "Erotic Movies 🔞",
                "Asian Drama": "Asian Drama (K/C/J-Drama) 🫰",
                "Asian Movies": "Asian Movies (Asian Cinema) 🎬",
                "Korean Drama": "Asian Drama (K-Drama) 🫰",
                "Korean Movies": "Asian Movies 🎬",
                "African": "African Cinema 🌍",
                "Anime": "Anime Series & Movies 🎌",
                "Bollywood": "Bollywood Cinema 🇮🇳",
                "Teen/High-School": "Teen / High-School 🏫",
                "Christian Movies": "Christian Movies ⛪"
            };

            Object.entries(categoryCounts).forEach(([cat, count]) => {
                const displayName = labelMap[cat] || `${cat} 📁`;
                const box = document.createElement("div");
                box.style.cssText = "background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; font-size: 11px; cursor: pointer; transition: all 0.2s ease;";
                box.innerHTML = `
                    <span style="color: var(--text-secondary); font-weight: 600;">${escapeHTML(displayName)}</span>
                    <span style="color: var(--primary-color); font-weight: 700;">${count}</span>
                `;
                box.addEventListener("mouseenter", () => {
                    box.style.background = "rgba(255, 188, 0, 0.05)";
                    box.style.borderColor = "rgba(255, 188, 0, 0.25)";
                });
                box.style.border = "1px solid rgba(255,255,255,0.04)";
                box.addEventListener("mouseleave", () => {
                    box.style.background = "rgba(255,255,255,0.015)";
                    box.style.borderColor = "rgba(255,255,255,0.04)";
                });
                box.addEventListener("click", () => {
                    openCategoryMoviesModal(cat, displayName);
                });
                categoriesList.appendChild(box);
            });
        } else {
            breakdownContainer.style.display = "none";
        }
    }

    // Feature usage stats calculator
    const featureContainer = document.getElementById("feature-usage-container");
    const featuresList = document.getElementById("analytics-features-list");
    if (featureContainer && featuresList) {
        if (allUsers.length > 0) {
            featureContainer.style.display = "block";
            
            let featureUsage = {
                "🚪 App Visits & Logins": 0,
                "🎬 Movie Plays & Streams": 0,
                "📥 Link Downloads": 0,
                "🔗 Referral Shares": 0
            };
            
            allUsers.forEach(u => {
                const bd = u.pointsBreakdown || {};
                featureUsage["🚪 App Visits & Logins"] += parseInt(bd.visits || 0);
                featureUsage["🎬 Movie Plays & Streams"] += parseInt(bd.watched || 0);
                featureUsage["📥 Link Downloads"] += parseInt(bd.downloads || 0);
                featureUsage["🔗 Referral Shares"] += parseInt(bd.shares || 0);
            });
            
            const sortedFeatures = Object.entries(featureUsage).sort((a, b) => b[1] - a[1]);
            
            featuresList.innerHTML = "";
            sortedFeatures.forEach(([featureName, count]) => {
                const box = document.createElement("div");
                box.style.cssText = "background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; font-size: 11px;";
                box.innerHTML = `
                    <span style="color: var(--text-secondary); font-weight: 600;">${escapeHTML(featureName)}</span>
                    <span style="color: var(--primary-color); font-weight: 700;">${count.toLocaleString()}</span>
                `;
                featuresList.appendChild(box);
            });
        } else {
            featureContainer.style.display = "none";
        }
    }

    // Total requests counter
    const totalRequestsEl = document.getElementById("stat-requests");
    if (totalRequestsEl) totalRequestsEl.textContent = allRequests.length;

    // Active in last 24h calculation
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const activeToday = allUsers.filter(u => {
        if (!u.lastSeen) return false;
        const lastSeenMs = u.lastSeen.seconds * 1000;
        return (now - lastSeenMs) <= oneDayMs;
    }).length;
    
    const activeTodayEl = document.getElementById("stat-active-today");
    if (activeTodayEl) activeTodayEl.textContent = activeToday;
}

// Render Users List with Filter Capability
function renderUsersList() {
    const listContainer = document.getElementById("users-list");
    if (!listContainer) return;

    listContainer.replaceChildren();

    const searchQuery = (document.getElementById("user-search-input")?.value || "").toLowerCase().trim();
    const filtered = allUsers.filter(u => {
        const name = (u.fullName || "").toLowerCase();
        const username = (u.username || "").toLowerCase();
        const id = (u.id || "").toLowerCase();
        return name.includes(searchQuery) || username.includes(searchQuery) || id.includes(searchQuery);
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">No matching users found.</div>`;
        return;
    }

    filtered.forEach(u => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";
        row.style.padding = "12px 16px";

        if (isCurrentUserSlaveAdmin) {
            row.innerHTML = `
                <div class="user-summary" style="display: flex; align-items: center; justify-content: space-between; width: 100%; user-select: none;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="${escapeHTML(u.avatar) || 'MOVIE/img/FilmHouse3_nobg.png'}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                        <h5 style="margin: 0; font-size: 14px; font-weight: 600; color: #fff;">${escapeHTML(u.fullName) || 'Guest User'}</h5>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="points-badge" style="margin: 0;">${u.points || 0} pts</div>
                    </div>
                </div>
            `;
            listContainer.appendChild(row);
            return;
        }

        const joinedDateStr = formatJoinedDate(u.joinedDate);
        const bd = u.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 };
        
        // Compute real-time mining status
        const farmingStartedAt = u.farmingStartedAt || 0;
        let miningStatusStr = "Idle 😴";
        let statusColor = "var(--text-secondary)";
        if (farmingStartedAt > 0) {
            const elapsedMs = Date.now() - farmingStartedAt;
            const hours = Math.floor(elapsedMs / (1000 * 60 * 60));
            const mins = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
            if (elapsedMs >= 8 * 60 * 60 * 1000) {
                miningStatusStr = "Completed ⏰ (Ready to claim)";
                statusColor = "#4caf50"; // Green
            } else {
                miningStatusStr = `Mining Now ⛏️ (${hours}h ${mins}m elapsed)`;
                statusColor = "#ffbc00"; // Gold
            }
        }
        
        row.innerHTML = `
            <div class="user-summary" style="display: flex; align-items: center; justify-content: space-between; width: 100%; cursor: pointer; user-select: none;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="${escapeHTML(u.avatar) || 'MOVIE/img/FilmHouse3_nobg.png'}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                    <h5 style="margin: 0; font-size: 14px; font-weight: 600; color: #fff;">${escapeHTML(u.fullName) || 'Guest User'}</h5>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="points-badge" style="margin: 0;">${u.points || 0} pts</div>
                    <svg class="chevron-icon" style="width: 14px; height: 14px; transition: transform 0.25s ease; fill: var(--text-secondary);" viewBox="0 0 24 24">
                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                    </svg>
                </div>
            </div>
            <div class="user-expanded-details" style="display: none; padding-top: 12px; margin-top: 10px; border-top: 1px dashed var(--border-color); width: 100%;">
                <p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>Telegram Username:</strong> @${escapeHTML(u.username) || 'guest'}</p>
                <p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>User ID:</strong> ${escapeHTML(u.id)}</p>
                <p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>Joined Date:</strong> ${joinedDateStr}</p>
                <p style="margin: 0 0 12px 0; font-size: 13px; color: var(--text-secondary);"><strong>Mining Status:</strong> <span style="color: ${statusColor}; font-weight: 700;">${miningStatusStr}</span></p>
                
                <h6 style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600;">Points Breakdown</h6>
                <div class="breakdown-group" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px;">
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">📥 Downloads: ${bd.downloads || 0}</span>
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">🚪 Visits: ${bd.visits || 0}</span>
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">🔗 Shares: ${bd.shares || 0}</span>
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">🎬 Watched: ${bd.watched || 0}</span>
                </div>
                
                <button class="btn btn-primary btn-sm remind-user-btn" style="color: #ffbc00; border-color: rgba(255, 188, 0, 0.25); background: rgba(255, 188, 0, 0.05); padding: 6px 12px; font-size: 12px; border-radius: 6px; width: 100%; cursor: pointer; margin-bottom: 8px; font-weight: 700;">Remind to Mine 🪙</button>
                <button class="btn btn-secondary btn-sm delete-user-btn" style="color: #ff3b30; border-color: rgba(255, 59, 48, 0.25); background: rgba(255, 59, 48, 0.05); padding: 6px 12px; font-size: 12px; border-radius: 6px; width: 100%; cursor: pointer;">Delete User Profile</button>
            </div>
        `;

        const summary = row.querySelector(".user-summary");
        const details = row.querySelector(".user-expanded-details");
        const chevron = row.querySelector(".chevron-icon");
        const deleteBtn = row.querySelector(".delete-user-btn");
        const remindBtn = row.querySelector(".remind-user-btn");

        summary.addEventListener("click", () => {
            const isVisible = details.style.display === "block";
            details.style.display = isVisible ? "none" : "block";
            chevron.style.transform = isVisible ? "rotate(0deg)" : "rotate(90deg)";
        });

        if (remindBtn) {
            remindBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                triggerMineReminder(u.id, u.fullName);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete user "${u.fullName || 'Guest User'}" (ID: ${u.id})?\nThis action cannot be undone.`)) {
                    deleteUserFromFirestore(u.id);
                }
            });
        }

        listContainer.appendChild(row);
    });
}

// Trigger Manual Mine Reminder via Firestore -> Bot Event
function triggerMineReminder(userId, fullName) {
    if (typeof firebase === "undefined" || !db) {
        alert("Firebase is not loaded!");
        return;
    }
    
    db.collection("admin_reminders").add({
        userId: String(userId),
        type: "mine",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        alert(`Reminder notification queued for user "${fullName || 'Guest'}" (ID: ${userId})! The Telegram bot will deliver it instantly.`);
    })
    .catch(err => {
        console.error("Error creating mine reminder doc:", err);
        alert("Error queuing reminder: " + err.message);
    });
}

// Delete User from Firestore Database
function deleteUserFromFirestore(userId) {
    if (typeof firebase === "undefined" || !db) {
        alert("Firebase is not loaded!");
        return;
    }
    db.collection("users").doc(userId).delete()
        .then(() => {
            alert("User deleted successfully!");
        })
        .catch(err => {
            console.error("Firestore user delete error:", err);
            alert("Error deleting user: " + err.message);
        });
}

// Robust Firestore/Timestamp/ISO/Date parser
function parseRequestDate(val) {
    if (!val) return null;
    if (typeof val.toDate === 'function') {
        try { return val.toDate(); } catch(e) {}
    }
    if (val && typeof val.seconds === 'number') {
        return new Date(val.seconds * 1000);
    }
    if (val && typeof val._seconds === 'number') {
        return new Date(val._seconds * 1000);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

// Formats full date, day of week, and time: e.g. "Saturday, Oct 10, 2026 • 04:15 AM"
function formatRequestDateTime(date, includeYear = true) {
    if (!date) return "";
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[date.getDay()];
    const monthName = months[date.getMonth()];
    const dayNum = date.getDate();
    const year = date.getFullYear();
    
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');
    
    const timeStr = `${hoursStr}:${minutes} ${ampm}`;
    const yearStr = includeYear ? `, ${year}` : '';
    return `${dayName}, ${monthName} ${dayNum}${yearStr} • ${timeStr}`;
}

// Compact friendly relative time: e.g. "Just now", "5m ago", "2h ago", "Yesterday", "3d ago"
function getRelativeTimeAgo(date) {
    if (!date) return "";
    const now = Date.now();
    const diffMs = now - date.getTime();
    if (diffMs < 0) return "Just now";
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSecs < 60) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
}

// Render Requests List with Aggregation, Tab Filtering, and Sorting
function renderRequestsList() {
    const listContainer = document.getElementById("requests-list");
    if (!listContainer) return;

    listContainer.replaceChildren();

    const counts = {};
    const reqSearchEl = document.getElementById("request-search-input") || document.getElementById("requests-search");
    const searchQuery = reqSearchEl ? reqSearchEl.value.toLowerCase().trim() : "";
    allRequests.forEach(r => {
        const rawTitle = r.title || "Untitled";
        const cleanTitle = rawTitle.toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "");
        const yearPart = r.year ? String(r.year).trim() : (rawTitle.match(/\((\d{4})\)/) ? rawTitle.match(/\((\d{4})\)/)[1] : "");
        const tmdbPart = r.tmdb_id ? String(r.tmdb_id).trim() : (r.csv_id ? String(r.csv_id).trim() : "");
        const specPart = (r.seasonOrPart || "").toLowerCase().trim();

        // Key distinguishes distinct media releases, remakes, seasons, and quality variants
        const key = tmdbPart 
            ? `${cleanTitle}_tmdb_${tmdbPart}_${specPart}` 
            : (yearPart ? `${cleanTitle}_year_${yearPart}_${specPart}` : `${cleanTitle}_${specPart}`);

        const reqDate = parseRequestDate(r.requestedAt || r._localTime || r.createdAt || r.timestamp);
        const reqTime = reqDate ? reqDate.getTime() : 0;

        if (!counts[key]) {
            counts[key] = { 
                title: rawTitle, 
                type: r.type || "Movie", 
                year: yearPart,
                tmdb_id: r.tmdb_id || null,
                csv_id: r.csv_id || null,
                seasonOrPart: r.seasonOrPart || "",
                count: 0, 
                isPriority: false, 
                isStreamRequest: (r.type === "stream" || r.requestType === "stream" || r.target === "stream_url"),
                isFulfilled: true,
                fulfilledBy: r.fulfilledBy || null,
                fulfilledById: r.fulfilledById || null,
                downloadLink: r.downloadLink || null,
                docIds: [],
                requesters: [],
                requesterDetails: [],
                adminClaimId: null,
                adminClaimName: null,
                earliestTimestamp: reqTime > 0 ? reqTime : Infinity,
                latestTimestamp: reqTime > 0 ? reqTime : 0,
                earliestDate: reqDate,
                latestDate: reqDate
            };
        } else {
            if (reqTime > 0) {
                if (reqTime < counts[key].earliestTimestamp) {
                    counts[key].earliestTimestamp = reqTime;
                    counts[key].earliestDate = reqDate;
                }
                if (reqTime > counts[key].latestTimestamp) {
                    counts[key].latestTimestamp = reqTime;
                    counts[key].latestDate = reqDate;
                }
            }
        }

        if (r.fulfilledBy && !counts[key].fulfilledBy) {
            counts[key].fulfilledBy = r.fulfilledBy;
            counts[key].fulfilledById = r.fulfilledById;
        }
        if (r.downloadLink && !counts[key].downloadLink) {
            counts[key].downloadLink = r.downloadLink;
        }
        counts[key].count++;
        counts[key].docIds.push(r.docId);
        
        const reqUser = r.requestedById || "unknown";
        if (!counts[key].requesters.includes(reqUser)) {
            counts[key].requesters.push(reqUser);
        }
        
        counts[key].requesterDetails.push({
            userId: r.requestedById || "unknown",
            username: r.requestedBy || r.user || "guest",
            docId: r.docId,
            status: r.status || "pending",
            fulfilledBy: r.fulfilledBy || null,
            notificationStatus: r.notificationStatus || null,
            notificationError: r.notificationError || null,
            isBlockedUser: r.isBlockedUser || false,
            requestedAtDate: reqDate,
            requestedAtFormatted: reqDate ? formatRequestDateTime(reqDate) : "Unknown date",
            relativeTime: reqDate ? getRelativeTimeAgo(reqDate) : ""
        });
        
        if (r.status === "priority" || r.boosted === true || r.isPriority === true) {
            counts[key].isPriority = true;
        }
        if (r.type === "stream" || r.requestType === "stream" || r.target === "stream_url") {
            counts[key].isStreamRequest = true;
        }
        
        // Track active claim lock
        if (r.adminClaimId) {
            const claimTime = r.adminClaimTime && typeof r.adminClaimTime.toDate === 'function' ? r.adminClaimTime.toDate() : null;
            const isExpired = claimTime ? (Date.now() - claimTime.getTime() > 15 * 60 * 1000) : false;
            if (!isExpired && r.status !== "fulfilled" && r.status !== "claimed") {
                counts[key].adminClaimId = r.adminClaimId;
                counts[key].adminClaimName = r.adminClaimName;
            }
        }
        
        // A request doc is fulfilled ONLY if it has an explicit fulfilled/claimed status, a download link, or verified exact match in catalog
        const isDocFulfilled = isRequestFulfilled(r);
        if (!isDocFulfilled) {
            counts[key].isFulfilled = false;
        }
    });

    const cleanReqQ = normalizeTitleForComparison(searchQuery);
    const colReqQ = getCollapsedTitle(searchQuery);
    let filteredRequests = Object.values(counts).filter(r => {
        if (!searchQuery) return true;
        const rawTitle = (r.title || "").toLowerCase();
        const yearPart = r.year ? String(r.year) : "";
        const fullDisplay = `${rawTitle} ${yearPart}`;
        if (fullDisplay.includes(searchQuery)) return true;
        const norm = normalizeTitleForComparison(fullDisplay);
        const col = getCollapsedTitle(fullDisplay);
        if (colReqQ && col && col.includes(colReqQ)) return true;
        if (cleanReqQ && norm && norm.includes(cleanReqQ)) return true;
        return false;
    });
    
    // Apply tab filter
    const fulfilledCount = filteredRequests.filter(r => r.isFulfilled).length;
    switch (requestFilterTab) {
        case "actionable":
            filteredRequests = filteredRequests.filter(r => !r.isFulfilled);
            break;
        case "priority":
            filteredRequests = filteredRequests.filter(r => r.isPriority && !r.isFulfilled);
            break;
        case "pending":
            filteredRequests = filteredRequests.filter(r => !r.isFulfilled);
            break;
        case "fulfilled":
            filteredRequests = filteredRequests.filter(r => r.isFulfilled);
            break;
        // "all" = no filter
    }
    
    // Sorting logic based on sort selector dropdown (Default: Newest First with High Priority pinned at top)
    const sortSelect = document.getElementById("requests-sort-select");
    const sortMode = sortSelect ? sortSelect.value : "newest";

    filteredRequests.sort((a, b) => {
        if (sortMode === "newest") {
            // High Priority always pinned at top, newest first within each tier
            if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
            const timeA = a.latestTimestamp === Infinity ? 0 : a.latestTimestamp;
            const timeB = b.latestTimestamp === Infinity ? 0 : b.latestTimestamp;
            return timeB - timeA;
        } else if (sortMode === "oldest") {
            if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
            const timeA = a.earliestTimestamp === Infinity ? 0 : a.earliestTimestamp;
            const timeB = b.earliestTimestamp === Infinity ? 0 : b.earliestTimestamp;
            if (timeA === 0 && timeB === 0) return 0;
            if (timeA === 0) return 1;
            if (timeB === 0) return -1;
            return timeA - timeB;
        } else if (sortMode === "priority") {
            if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
            const timeA = a.latestTimestamp === Infinity ? 0 : a.latestTimestamp;
            const timeB = b.latestTimestamp === Infinity ? 0 : b.latestTimestamp;
            return timeB - timeA;
        } else {
            // "count": Priority first, then by request count descending, then newest
            if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
            if (b.count !== a.count) return b.count - a.count;
            const timeA = a.latestTimestamp === Infinity ? 0 : a.latestTimestamp;
            const timeB = b.latestTimestamp === Infinity ? 0 : b.latestTimestamp;
            return timeB - timeA;
        }
    });

    const badgeEl = document.getElementById("requests-count-badge");
    if (badgeEl) badgeEl.textContent = `${filteredRequests.length} Titles`;
    
    // Show/hide clear fulfilled button
    const clearBtn = document.getElementById("btn-clear-fulfilled");
    if (clearBtn) {
        clearBtn.style.display = fulfilledCount > 0 ? "inline-block" : "none";
    }

    if (filteredRequests.length === 0) {
        const emptyMsg = requestFilterTab === "actionable" 
            ? "All requests are fulfilled! Switch to the \"Fulfilled\" or \"All\" tab to view them."
            : "No matching requests in this filter.";
        listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">${emptyMsg}</div>`;
        return;
    }

    filteredRequests.forEach(req => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.style.cssText = "display: flex; flex-direction: column; padding: 12px 16px; border-bottom: 1px solid var(--border-color); gap: 8px;";

        const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
        const currentAdminId = String(tgUser ? tgUser.id : (new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || "test-admin"));
        
        let badgeMarkup = "";
        let isLockedByOther = false;
        let claimBadgeMarkup = "";
        let catalogBadgeMarkup = "";

        if (req.isPriority) {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(255, 59, 48, 0.15); border: 1px solid rgba(255, 59, 48, 0.3); color: #ff3b30; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🔥 High Priority</span>`;
        } else if (req.isFulfilled) {
            const fulfillerText = req.fulfilledBy ? ` by ${escapeHTML(req.fulfilledBy)}` : "";
            badgeMarkup = `<span style="font-size: 10px; background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🟢 Fulfilled${fulfillerText}</span>`;
        } else {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(255, 188, 0, 0.15); border: 1px solid rgba(255, 188, 0, 0.3); color: #ffbc00; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🟠 Pending</span>`;
            if (hasCatalogMatch(req)) {
                catalogBadgeMarkup = `<span style="font-size: 10px; background: rgba(0, 200, 255, 0.15); border: 1px solid rgba(0, 200, 255, 0.3); color: #00c8ff; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;" title="This title exists in the catalog with active links">✨ In Catalog</span>`;
            }
        }

        if (req.isStreamRequest) {
            badgeMarkup += `<span style="font-size: 10px; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.4); color: #c084fc; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🟣 Stream Request</span>`;
        }

        if (req.adminClaimId && !req.isFulfilled) {
            if (String(req.adminClaimId) === currentAdminId) {
                claimBadgeMarkup = `<span style="font-size: 10px; background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🛠️ Claimed by You</span>`;
            } else {
                claimBadgeMarkup = `<span style="font-size: 10px; background: rgba(255, 152, 0, 0.15); border: 1px solid rgba(255, 152, 0, 0.3); color: #ff9800; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🛠️ Claimed by ${escapeHTML(req.adminClaimName)}</span>`;
                isLockedByOther = true;
            }
        }

        let fulfillBtnMarkup = "";
        if (!req.isFulfilled) {
            if (isLockedByOther) {
                fulfillBtnMarkup = isCurrentUserSlaveAdmin ? "" : `
                    <button class="btn-fulfill-request disabled" disabled style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 4px; padding: 6px 12px; color: var(--text-muted); font-weight: 700; font-size: 11px; cursor: not-allowed; opacity: 0.6;">
                        Locked 🔒
                    </button>
                `;
            } else {
                fulfillBtnMarkup = isCurrentUserSlaveAdmin ? "" : `
                    <button class="btn-fulfill-request" data-title="${escapeHTML(req.title)}" style="background: var(--primary-gradient); border: none; border-radius: 4px; padding: 6px 12px; color: #000; font-weight: 700; font-size: 11px; cursor: pointer; transition: opacity 0.2s;">
                        Fulfill 📥
                    </button>
                `;
            }
        } else {
            const fulfillerLabel = req.fulfilledBy ? `Fulfilled by ${escapeHTML(req.fulfilledBy)} ✅` : `Resolved ✅`;
            const linkBtn = req.downloadLink 
                ? `<a href="${escapeHTML(req.downloadLink)}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: var(--primary-color); text-decoration: none; border: 1px solid rgba(255,188,0,0.3); padding: 3px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; background: rgba(255,188,0,0.05);">📥 Link</a>` 
                : "";
            fulfillBtnMarkup = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 11px; color: #4caf50; font-weight: 600;">${fulfillerLabel}</span>
                    ${linkBtn}
                </div>
            `;
        }

        const deleteBtnMarkup = isCurrentUserSlaveAdmin ? "" : `
            <button class="btn-delete-requests" style="background: rgba(255, 59, 48, 0.1); border: 1px solid rgba(255, 59, 48, 0.3); border-radius: 4px; padding: 6px 12px; color: #ff3b30; font-weight: 700; font-size: 11px; cursor: pointer; transition: background 0.2s;">
                Delete 🗑️
            </button>
        `;

        let detailsHtml = "";
        if (req.requesterDetails && req.requesterDetails.length > 0) {
            // Sort individual requesters by newest request date first
            req.requesterDetails.sort((a, b) => {
                const tA = a.requestedAtDate ? a.requestedAtDate.getTime() : 0;
                const tB = b.requestedAtDate ? b.requestedAtDate.getTime() : 0;
                return tB - tA;
            });

            req.requesterDetails.forEach(detail => {
                let statusBadge = "";
                const detailFulfiller = detail.fulfilledBy || req.fulfilledBy;
                const fulfillerTag = detailFulfiller ? ` <span style="font-size: 10px; opacity: 0.85; color: var(--text-secondary);">(${escapeHTML(detailFulfiller)})</span>` : "";
                if (detail.status === "fulfilled" || detail.status === "claimed") {
                    if (detail.notificationStatus === "delivered") {
                        statusBadge = `<span style="color: #4caf50; font-weight: bold; background: rgba(76, 175, 80, 0.1); padding: 1px 6px; border-radius: 4px;">🟢 Delivered${fulfillerTag}</span>`;
                    } else if (detail.notificationStatus === "failed") {
                        const errMsg = detail.notificationError || "Unknown error";
                        statusBadge = `<span style="color: #ff3b30; font-weight: bold; background: rgba(255, 59, 48, 0.1); padding: 1px 6px; border-radius: 4px;" title="${escapeHTML(errMsg)}">🔴 Failed${fulfillerTag}</span>`;
                    } else {
                        statusBadge = `<span style="color: #4caf50; font-weight: bold; background: rgba(76, 175, 80, 0.1); padding: 1px 6px; border-radius: 4px;">🟢 Fulfilled${fulfillerTag}</span>`;
                    }
                } else if (detail.status === "priority") {
                    statusBadge = `<span style="color: #ff3b30; font-weight: bold; background: rgba(255, 59, 48, 0.1); padding: 1px 6px; border-radius: 4px;">🔥 Priority</span>`;
                } else {
                    statusBadge = `<span style="color: #ffbc00; font-weight: bold; background: rgba(255, 188, 0, 0.1); padding: 1px 6px; border-radius: 4px;">🟠 Pending</span>`;
                }
                
                const timeTag = detail.requestedAtFormatted ? `
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 4px;">
                        <span>📅</span>
                        <span>${escapeHTML(detail.requestedAtFormatted)}</span>
                        ${detail.relativeTime ? `<span style="color: var(--primary-color); font-weight: 600;">(${escapeHTML(detail.relativeTime)})</span>` : ''}
                    </div>
                ` : "";

                detailsHtml += `
                    <div style="display: flex; flex-direction: column; margin-bottom: 6px; font-size: 11px; padding: 6px 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>👤 <strong>@${escapeHTML(detail.username)}</strong> (ID: <code>${escapeHTML(detail.userId)}</code>)</span>
                            <span>${statusBadge}</span>
                        </div>
                        ${timeTag}
                    </div>
                `;
            });
        }

        let dateDisplayMarkup = "";
        if (req.latestDate) {
            const latestFormatted = formatRequestDateTime(req.latestDate, false);
            const relativeAgo = getRelativeTimeAgo(req.latestDate);
            if (req.count > 1 && req.earliestDate && req.earliestDate.getTime() !== req.latestDate.getTime()) {
                const earliestFormatted = formatRequestDateTime(req.earliestDate, false);
                dateDisplayMarkup = `
                    <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap;">
                        <span>📅</span>
                        <span>Latest: <strong style="color: var(--text-primary); font-weight: 600;">${escapeHTML(latestFormatted)}</strong> <span style="color: var(--primary-color); font-weight: 600;">(${escapeHTML(relativeAgo)})</span></span>
                        <span style="opacity: 0.5;">•</span>
                        <span>First: <strong style="color: var(--text-secondary);">${escapeHTML(earliestFormatted)}</strong></span>
                    </div>
                `;
            } else {
                dateDisplayMarkup = `
                    <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap;">
                        <span>📅</span>
                        <span><strong style="color: var(--text-primary); font-weight: 600;">${escapeHTML(latestFormatted)}</strong> <span style="color: var(--primary-color); font-weight: 600;">(${escapeHTML(relativeAgo)})</span></span>
                    </div>
                `;
            }
        }

        const toggleId = `toggle-${req.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${req.docIds[0]}`;

        row.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div class="user-details" style="flex: 1;">
                    <h5 style="margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                        ${escapeHTML(req.title)}${req.year && !req.title.includes(req.year) ? ` (${escapeHTML(req.year)})` : ""}${req.seasonOrPart ? ` [${escapeHTML(req.seasonOrPart)}]` : ""}
                        ${badgeMarkup}
                        ${catalogBadgeMarkup}
                        ${claimBadgeMarkup}
                    </h5>
                    ${dateDisplayMarkup}
                    <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
                        <span style="text-transform: uppercase; font-weight: bold;">${escapeHTML(req.type)}</span>
                        <span style="color: var(--text-muted);">•</span>
                        <span>
                            <a href="#" class="toggle-requesters-link" data-target="${toggleId}" style="color: var(--text-muted); text-decoration: underline; cursor: pointer; font-weight: 600;">
                                Show Requesters (${req.count}) 📁
                            </a>
                        </span>
                    </p>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="req-count" style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">
                        ${req.count} ${req.count === 1 ? 'req' : 'reqs'}
                    </div>
                    ${fulfillBtnMarkup}
                    ${deleteBtnMarkup}
                </div>
            </div>
            <div id="${toggleId}" class="requesters-details-pane" style="font-size: 11px; color: var(--text-secondary); background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 6px; display: none; width: 100%; box-sizing: border-box;">
                <div style="font-weight: bold; margin-bottom: 8px; color: var(--text-muted); text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px;">Requesters & Delivery Status:</div>
                ${detailsHtml}
            </div>
        `;

        const fulfillBtn = row.querySelector(".btn-fulfill-request");
        if (fulfillBtn) {
            fulfillBtn.addEventListener("click", () => {
                fulfillMovieTitleRequests(req.title, req.docIds, req);
            });
        }

        const deleteBtn = row.querySelector(".btn-delete-requests");
        if (deleteBtn) {
            deleteBtn.addEventListener("click", () => {
                deleteMovieTitleRequests(req.title, req.docIds);
            });
        }

        const toggleLink = row.querySelector(".toggle-requesters-link");
        if (toggleLink) {
            toggleLink.addEventListener("click", (e) => {
                e.preventDefault();
                const targetId = toggleLink.getAttribute("data-target");
                const targetPane = document.getElementById(targetId);
                if (targetPane) {
                    const isHidden = targetPane.style.display === "none";
                    targetPane.style.display = isHidden ? "block" : "none";
                    toggleLink.textContent = isHidden 
                        ? `Hide Requesters (${req.count}) 📂` 
                        : `Show Requesters (${req.count}) 📁`;
                }
            });
        }

        listContainer.appendChild(row);
    });
}

function deleteMovieTitleRequests(title, docIds) {
    if (typeof firebase === "undefined" || !db) return;
    if (!confirm(`Are you sure you want to delete all requests for "${title}"? This will permanently remove ${docIds.length} request document(s) from the database.`)) {
        return;
    }
    
    // Chunk document IDs in sizes of 500 to stay within Firestore limits
    const chunks = [];
    for (let i = 0; i < docIds.length; i += 500) {
        chunks.push(docIds.slice(i, i + 500));
    }
    
    const promises = chunks.map(chunk => {
        const batch = db.batch();
        chunk.forEach(id => {
            batch.delete(db.collection("requests").doc(id));
        });
        return batch.commit();
    });
    
    Promise.all(promises).then(() => {
        showToast(`Successfully deleted ${docIds.length} request(s) for "${title}"!`, "success");
        allRequests = allRequests.filter(r => !docIds.includes(r.docId));
        renderRequestsList();
    }).catch(err => {
        console.error("Error deleting requests:", err);
        showToast("Failed to delete requests: " + err.message, "error");
    });
}

function fulfillMovieTitleRequests(title, docIds, reqMeta = null) {
    if (typeof firebase === "undefined" || !db) return;
    
    const targetDocIds = Array.isArray(docIds) && docIds.length > 0 ? docIds : [];
    if (targetDocIds.length === 0) return;

    // Check if already claimed by another admin
    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    const currentAdminId = String(tgUser ? tgUser.id : (new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || "test-admin"));
    const currentAdminName = tgUser ? (tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name || 'Admin'}`) : "Admin";

    // Query Firestore ONLY for these exact request documents
    const docPromises = targetDocIds.map(id => db.collection("requests").doc(id).get());
    Promise.all(docPromises).then(snapshots => {
        let alreadyClaimed = false;
        let claimerName = "";

        snapshots.forEach(docSnap => {
            if (!docSnap.exists) return;
            const data = docSnap.data();
            const claimTime = data.adminClaimTime && typeof data.adminClaimTime.toDate === 'function' ? data.adminClaimTime.toDate() : null;
            const isExpired = claimTime ? (Date.now() - claimTime.getTime() > 15 * 60 * 1000) : false;
            // A claim is active if adminClaimId is present, not expired, status is not fulfilled, and it's not by current admin
            if (data.adminClaimId && String(data.adminClaimId) !== currentAdminId && data.status !== "fulfilled" && data.status !== "claimed" && !isExpired) {
                alreadyClaimed = true;
                claimerName = data.adminClaimName || "another admin";
            }
        });

        if (alreadyClaimed) {
            showToast(`⚠️ Already being processed by ${claimerName}!`, "warning");
            return;
        }

        // Set the lock claim for current admin in a batch update
        const batch = db.batch();
        let count = 0;
        snapshots.forEach(docSnap => {
            if (!docSnap.exists) return;
            const data = docSnap.data();
            if (data.status !== "fulfilled" && data.status !== "claimed") {
                batch.update(docSnap.ref, {
                    adminClaimId: currentAdminId,
                    adminClaimName: currentAdminName,
                    adminClaimTime: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;
            }
        });

        const proceedToModal = () => {
            const modal = document.getElementById("fulfill-request-modal");
            const titleEl = document.getElementById("fulfill-modal-title");
            
            if (!modal || !titleEl) return;
            
            const yearStr = reqMeta && reqMeta.year ? String(reqMeta.year).trim() : "";
            currentFulfillTitle = title;
            currentFulfillDocIds = targetDocIds;
            
            titleEl.textContent = `Fulfill Request: "${title}${yearStr && !title.includes(yearStr) ? ` (${yearStr})` : ''}"`;
            
            const reqTmdb = reqMeta && reqMeta.tmdb_id ? String(reqMeta.tmdb_id).trim() : "";
            const existingMovie = allCatalogMovies.find(m => {
                const mTmdb = m.tmdb_id ? String(m.tmdb_id).trim() : (m.csv_id && !isNaN(m.csv_id) ? String(m.csv_id).trim() : "");
                if (reqTmdb && mTmdb) {
                    return reqTmdb === mTmdb;
                }
                if (reqTmdb && !mTmdb) {
                    if (titlesMatch(m.title, title)) {
                        if (yearStr && m.year && String(m.year) === yearStr) return true;
                        if (!yearStr) return true;
                    }
                    return false;
                }
                if (!reqTmdb && !mTmdb) {
                    if (titlesMatch(m.title, title)) {
                        if (yearStr && m.year && String(m.year) === yearStr) return true;
                        if (!yearStr) return true;
                    }
                }
                return false;
            });

            const matchedReq = (reqMeta && reqMeta.title) ? reqMeta : (allRequests.find(r => targetDocIds.includes(r.docId)) || allRequests.find(r => r.title.toLowerCase().trim() === title.toLowerCase().trim()));
            currentFulfillReq = matchedReq;
            const isSeries = matchedReq ? ((matchedReq.type || "").toLowerCase() === 'series' || (matchedReq.type || "").toLowerCase() === 'tv') : (existingMovie ? (existingMovie.type || "").toLowerCase() === 'series' : false);
            
            let reqSpec = matchedReq ? (matchedReq.seasonOrPart || "") : "";
            if (!reqSpec && title) {
                const qMatch = title.match(/\(([^)]+)\)$/);
                if (qMatch) {
                    reqSpec = qMatch[1].trim();
                }
            }
            renderFulfillLinksInputs(existingMovie, isSeries, reqSpec);
            renderFulfillStreamLinksInputs(existingMovie, isSeries, reqSpec);
            modal.classList.add("active");
        };

        if (count > 0) {
            batch.commit().then(proceedToModal).catch(err => {
                console.error("Error setting claim lock batch:", err);
                proceedToModal();
            });
        } else {
            proceedToModal();
        }
    }).catch(err => {
        console.error("Error checking request status:", err);
        showToast("Error checking request status.", "error");
    });
}

function releaseClaimLock(title, docIds = []) {
    if (typeof firebase === "undefined" || !db) return;
    
    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    const currentAdminId = String(tgUser ? tgUser.id : (new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || "test-admin"));
    
    if (Array.isArray(docIds) && docIds.length > 0) {
        const batch = db.batch();
        let count = 0;
        docIds.forEach(id => {
            batch.update(db.collection("requests").doc(id), {
                adminClaimId: firebase.firestore.FieldValue.delete(),
                adminClaimName: firebase.firestore.FieldValue.delete(),
                adminClaimTime: firebase.firestore.FieldValue.delete()
            });
            count++;
        });
        if (count > 0) {
            batch.commit().catch(err => console.error("Error releasing claim lock:", err));
        }
        return;
    }

    if (!title) return;
    db.collection("requests").where("title", "==", title).get().then(snapshot => {
        const batch = db.batch();
        let count = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.adminClaimId === currentAdminId && data.status !== "fulfilled" && data.status !== "claimed") {
                batch.update(doc.ref, {
                    adminClaimId: firebase.firestore.FieldValue.delete(),
                    adminClaimName: firebase.firestore.FieldValue.delete(),
                    adminClaimTime: firebase.firestore.FieldValue.delete()
                });
                count++;
            }
        });
        if (count > 0) {
            batch.commit().catch(err => console.error("Error releasing claim lock:", err));
        }
    }).catch(err => console.error("Error querying requests for release lock:", err));
}

// Helper utility for debouncing search input events
function createAdminDebounce(fn, delay = 200) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Bind search input typing events
const userSearchInput = document.getElementById("user-search-input");
if (userSearchInput) {
    userSearchInput.addEventListener("input", createAdminDebounce(renderUsersList, 200));
}

const requestSearchInput = document.getElementById("request-search-input");
if (requestSearchInput) {
    requestSearchInput.addEventListener("input", createAdminDebounce(renderRequestsList, 200));
}

// Bind filter tab click listeners
const filterTabContainer = document.getElementById("request-filter-tabs");
if (filterTabContainer) {
    filterTabContainer.querySelectorAll(".req-filter-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            requestFilterTab = tab.getAttribute("data-filter");
            // Update active tab styling
            filterTabContainer.querySelectorAll(".req-filter-tab").forEach(t => {
                t.style.background = "rgba(255,255,255,0.03)";
                t.style.color = "var(--text-secondary)";
                t.classList.remove("active");
            });
            tab.style.background = "var(--primary-gradient)";
            tab.style.color = "#000";
            tab.classList.add("active");
            renderRequestsList();
        });
    });
}

// Bind sort selector dropdown change listener
const requestsSortSelect = document.getElementById("requests-sort-select");
if (requestsSortSelect) {
    requestsSortSelect.addEventListener("change", () => {
        renderRequestsList();
    });
}

// Batch-delete all fulfilled requests from Firestore
function clearFulfilledRequests() {
    if (typeof firebase === "undefined" || !db) return;
    
    const fulfilledDocs = allRequests.filter(r => r.status === "fulfilled" || r.status === "claimed" || r.claimed === true);
    if (fulfilledDocs.length === 0) {
        showToast("No fulfilled requests to clear.", "info");
        return;
    }
    
    if (!confirm(`Delete ${fulfilledDocs.length} fulfilled request document(s) from Firestore? This cannot be undone.`)) {
        return;
    }
    
    const batch = db.batch();
    fulfilledDocs.forEach(r => {
        batch.delete(db.collection("requests").doc(r.docId));
    });
    
    batch.commit().then(() => {
        showToast(`Cleared ${fulfilledDocs.length} fulfilled requests from the database. 🗑️`, "success");
    }).catch(err => {
        console.error("Error clearing fulfilled requests:", err);
        showToast("Failed to clear fulfilled requests.", "error");
    });
}

// --- CATALOG MANAGER LOGIC ---

// Catalog state
let allCatalogMovies = [];
let selectedEditorPicks = []; // Tracker for Editor's Choice spotlights (max 10)
let originalCatalogCount = 0;
let catalogChangesMade = false;
let githubToken = ""; // Global cache for token
let telegramBotToken = ""; // Global cache for Telegram Bot Token
let telegramWebhookUrl = ""; // Global cache for Telegram Bot Webhook URL
let TMDB_API_KEY = localStorage.getItem("filmhouse_tmdb_key") || "d638f7775bfa1b8d456dfd028ccbef19";
let pendingImportChanges = null;
let newlyAddedIds = [];
let newlyUpdatedIds = [];
let newlyDeletedIds = [];
let lastKnownJsonSha = null;

// Load GitHub token on startup from Firestore and localStorage
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Instant load from localStorage
    const localToken = localStorage.getItem("filmhouse_github_token");
    if (localToken) {
        githubToken = localToken;
        const tokenInput = document.getElementById("github-token");
        if (tokenInput) {
            tokenInput.value = githubToken;
        }
    }

    const localTgToken = localStorage.getItem("filmhouse_telegram_bot_token");
    if (localTgToken) {
        telegramBotToken = localTgToken;
        const tgTokenInput = document.getElementById("telegram-bot-token");
        if (tgTokenInput) {
            tgTokenInput.value = telegramBotToken;
        }
    }

    const localTgWebhook = localStorage.getItem("filmhouse_telegram_webhook_url");
    if (localTgWebhook) {
        telegramWebhookUrl = localTgWebhook;
        const tgWebhookInput = document.getElementById("telegram-webhook-url");
        if (tgWebhookInput) {
            tgWebhookInput.value = telegramWebhookUrl;
        }
    }

    const localTgPings = localStorage.getItem("filmhouse_telegram_ping_urls");
    if (localTgPings) {
        const tgPingsInput = document.getElementById("telegram-ping-urls");
        if (tgPingsInput) {
            tgPingsInput.value = localTgPings;
        }
    }

    const localTmdbKey = localStorage.getItem("filmhouse_tmdb_key");
    if (localTmdbKey) {
        TMDB_API_KEY = localTmdbKey;
        const tmdbKeyInput = document.getElementById("tmdb-api-key");
        if (tmdbKeyInput) {
            tmdbKeyInput.value = TMDB_API_KEY;
        }
    }

    loadCatalog();
    initAdminLeaderboardListener();
    listenToActiveStreamers();
    
    // 2. Fetch token from Firestore to sync/update
    if (db) {
        try {
            const doc = await db.collection("settings").doc("github").get();
            if (doc.exists) {
                const dbToken = doc.data().token || "";
                if (dbToken && dbToken !== githubToken) {
                    githubToken = dbToken;
                    localStorage.setItem("filmhouse_github_token", dbToken);
                    const tokenInput = document.getElementById("github-token");
                    if (tokenInput) {
                        tokenInput.value = githubToken;
                    }
                    // Reload catalog with the new synced token
                    loadCatalog();
                }
            }
        } catch (e) {
            console.error("Error loading GitHub token from Firestore:", e);
        }

        try {
            const tgDoc = await db.collection("settings").doc("telegram").get();
            if (tgDoc.exists) {
                const dbTgToken = tgDoc.data().botToken || "";
                if (dbTgToken && dbTgToken !== telegramBotToken) {
                    telegramBotToken = dbTgToken;
                    localStorage.setItem("filmhouse_telegram_bot_token", dbTgToken);
                    const tgTokenInput = document.getElementById("telegram-bot-token");
                    if (tgTokenInput) {
                        tgTokenInput.value = telegramBotToken;
                    }
                }
                const dbTgWebhook = tgDoc.data().webhookUrl || "";
                if (dbTgWebhook && dbTgWebhook !== telegramWebhookUrl) {
                    telegramWebhookUrl = dbTgWebhook;
                    localStorage.setItem("filmhouse_telegram_webhook_url", dbTgWebhook);
                    const tgWebhookInput = document.getElementById("telegram-webhook-url");
                    if (tgWebhookInput) {
                        tgWebhookInput.value = telegramWebhookUrl;
                    }
                }
                const dbTgPings = tgDoc.data().pingUrls || "";
                if (dbTgPings) {
                    localStorage.setItem("filmhouse_telegram_ping_urls", dbTgPings);
                    const tgPingsInput = document.getElementById("telegram-ping-urls");
                    if (tgPingsInput) {
                        tgPingsInput.value = dbTgPings;
                    }
                }
            }
        } catch (e) {
            console.error("Error loading Telegram settings from Firestore:", e);
        }

        try {
            const welcomeDoc = await db.collection("settings").doc("welcome").get();
            if (welcomeDoc.exists) {
                const welcomeData = welcomeDoc.data();
                const welcomeImgInput = document.getElementById("telegram-welcome-image");
                if (welcomeImgInput) welcomeImgInput.value = welcomeData.photoUrl || "";
                const welcomeTextInput = document.getElementById("telegram-welcome-text");
                if (welcomeTextInput) welcomeTextInput.value = welcomeData.text || "";
                
                const appTextInput = document.getElementById("telegram-welcome-app-text");
                if (appTextInput) appTextInput.value = welcomeData.appButtonText || "";
                const appUrlInput = document.getElementById("telegram-welcome-app-url");
                if (appUrlInput) appUrlInput.value = welcomeData.appButtonUrl || "";
                const chanTextInput = document.getElementById("telegram-welcome-channel-text");
                if (chanTextInput) chanTextInput.value = welcomeData.channelButtonText || "";
                const chanUrlInput = document.getElementById("telegram-welcome-channel-url");
                if (chanUrlInput) chanUrlInput.value = welcomeData.channelButtonUrl || "";
            }
        } catch (e) {
            console.error("Error loading welcome settings from Firestore:", e);
        }

        // Setup real-time listener for Telegram Bot Status
        db.collection("settings").doc("bot_status").onSnapshot((doc) => {
            const badge = document.getElementById("bot-status-badge");
            const details = document.getElementById("bot-status-details");
            if (!badge || !details) return;

            if (doc.exists) {
                const data = doc.data();
                const lastPing = data.lastPing;
                const status = data.status || "offline";
                const mode = data.mode || "polling";
                
                let lastPingMs = 0;
                if (lastPing) {
                    lastPingMs = lastPing.toMillis ? lastPing.toMillis() : new Date(lastPing).getTime();
                }

                const now = Date.now();
                const isRecent = lastPingMs && (now - lastPingMs < 3 * 60 * 1000); // 3 minutes threshold

                if (status === "online" && isRecent) {
                    badge.textContent = "ONLINE";
                    badge.style.background = "rgba(40, 167, 69, 0.15)";
                    badge.style.color = "#28a745";
                    badge.style.borderColor = "rgba(40, 167, 69, 0.3)";
                    
                    const timeStr = new Date(lastPingMs).toLocaleTimeString();
                    details.textContent = `Mode: ${mode.toUpperCase()} | Last Active: ${timeStr}`;
                } else {
                    badge.textContent = "OFFLINE";
                    badge.style.background = "rgba(220, 53, 69, 0.15)";
                    badge.style.color = "#dc3545";
                    badge.style.borderColor = "rgba(220, 53, 69, 0.3)";
                    
                    if (lastPingMs) {
                        const timeStr = new Date(lastPingMs).toLocaleTimeString();
                        details.textContent = `Offline since: ${timeStr}`;
                    } else {
                        details.textContent = "No status ping received yet.";
                    }
                }
            } else {
                badge.textContent = "OFFLINE";
                badge.style.background = "rgba(220, 53, 69, 0.15)";
                badge.style.color = "#dc3545";
                badge.style.borderColor = "rgba(220, 53, 69, 0.3)";
                details.textContent = "No bot status document found.";
            }
        }, (err) => {
            console.error("Error listening to bot status:", err);
        });

        try {
            const tmdbDoc = await db.collection("settings").doc("tmdb").get();
            if (tmdbDoc.exists) {
                const dbTmdbKey = tmdbDoc.data().apiKey || "";
                if (dbTmdbKey && dbTmdbKey !== TMDB_API_KEY) {
                    TMDB_API_KEY = dbTmdbKey;
                    localStorage.setItem("filmhouse_tmdb_key", dbTmdbKey);
                    const tmdbKeyInput = document.getElementById("tmdb-api-key");
                    if (tmdbKeyInput) {
                        tmdbKeyInput.value = TMDB_API_KEY;
                    }
                }
            }
        } catch (e) {
            console.error("Error loading TMDB key from Firestore:", e);
        }
    }

    // Tab Switching for Settings Panel
    const tabBtns = document.querySelectorAll(".settings-tab-btn");
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => {
                b.classList.remove("active");
                b.style.background = "transparent";
                b.style.color = "var(--text-secondary)";
            });
            btn.classList.add("active");
            btn.style.background = "var(--primary-gradient)";
            btn.style.color = "#000";

            const contents = document.querySelectorAll(".settings-tab-content");
            contents.forEach(c => c.style.display = "none");

            const targetId = btn.getAttribute("data-target");
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.style.display = "block";
            }
        });
    });

    // Initialize Editor's Choice Manager
    if (db) {
        db.collection("settings").doc("admin_picks").get().then(doc => {
            if (doc.exists) {
                selectedEditorPicks = doc.data().ids || [];
                const titleInput = document.getElementById("editors-choice-title-input");
                if (titleInput) {
                    titleInput.value = doc.data().title || "Editor's Choice 🎬";
                }
            }
            renderEditorsChoiceSelectionList();
        }).catch(err => {
            console.warn("Failed to load admin picks on load:", err);
            renderEditorsChoiceSelectionList();
        });
    }

    const edSearch = document.getElementById("editors-choice-search");
    if (edSearch) {
        edSearch.addEventListener("input", () => {
            renderEditorsChoiceSelectionList();
        });
    }

    const edSaveBtn = document.getElementById("btn-save-editors-choice");
    if (edSaveBtn) {
        edSaveBtn.addEventListener("click", () => {
            if (typeof firebase === "undefined" || !db) {
                alert("Database connection offline!");
                return;
            }
            edSaveBtn.disabled = true;
            edSaveBtn.textContent = "Saving Spotlight Picks... ⏳";
            
            const customTitle = document.getElementById("editors-choice-title-input")?.value.trim() || "Editor's Choice 🎬";
            db.collection("settings").doc("admin_picks").set({
                ids: selectedEditorPicks,
                title: customTitle
            }).then(() => {
                showToast("Editor's Choice spotlight updated successfully! 🎬", "success");
                edSaveBtn.disabled = false;
                edSaveBtn.textContent = "Save Spotlight Picks 💾";
            }).catch(err => {
                console.error("Error saving editor picks:", err);
                alert("Failed to save picks: " + err.message);
                edSaveBtn.disabled = false;
                edSaveBtn.textContent = "Save Spotlight Picks 💾";
            });
        });
    }

    // Verify Admin Access
    verifyAdminAccess();
});

// Admin Access Control Verification
async function verifyAdminAccess() {
    const defaultAdmins = ["1329840839", "1175336733"];
    let authorizedIds = [...defaultAdmins];
    let masters = [...defaultAdmins];
    let slaves = [];

    if (db) {
        try {
            const adminDoc = await db.collection("settings").doc("admins").get();
            if (adminDoc.exists) {
                const data = adminDoc.data();
                const storedIds = data.ids || [];
                authorizedIds = Array.from(new Set([...defaultAdmins, ...storedIds.map(id => String(id).trim())]));
                masters = Array.from(new Set([...defaultAdmins, ...(data.masters || []).map(id => String(id).trim())]));
                slaves = (data.slaves || []).map(id => String(id).trim());
            } else {
                // Seed initial admins doc in Firestore if missing
                await db.collection("settings").doc("admins").set({
                    ids: defaultAdmins,
                    masters: defaultAdmins,
                    slaves: [],
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (e) {
            console.error("Failed to fetch admin list from Firestore, falling back to defaults:", e);
        }
    }

    window.cachedMasterAdminIds = masters;
    window.cachedSlaveAdminIds = slaves;

    const masterInput = document.getElementById("admin-master-tg-ids");
    if (masterInput) {
        masterInput.value = masters.join(", ");
    }
    const slaveInput = document.getElementById("admin-slave-tg-ids");
    if (slaveInput) {
        slaveInput.value = slaves.join(", ");
    }

    if (typeof renderAdminLeaderboard === "function") {
        renderAdminLeaderboard();
    }

    // Context & Bypass checks
    const isLocal = window.location.hostname === "localhost" || 
                    window.location.hostname === "127.0.0.1" || 
                    window.location.protocol === "file:";

    const urlParams = new URLSearchParams(window.location.search);
    const queryTgId = urlParams.get("tg_id") || urlParams.get("admin_id");
    const queryTgName = urlParams.get("admin_name") || urlParams.get("username") || urlParams.get("name");
    const authToken = urlParams.get("auth_token");

    // Support 1-click magic token generated by /login command on Telegram
    if (authToken) {
        try {
            const decoded = atob(authToken);
            const [tokenAdminId, tokenExpiry] = decoded.split(":");
            if (tokenAdminId && tokenExpiry && Date.now() < parseInt(tokenExpiry, 10)) {
                if (["1329840839", "1175336733"].includes(tokenAdminId)) {
                    sessionStorage.setItem("admin_auth_id", tokenAdminId);
                    sessionStorage.setItem("admin_auth_name", `Master Admin (${tokenAdminId})`);
                    console.log(`[Security] Authenticated via 1-Click Magic Login Token for Admin ${tokenAdminId}`);
                }
            }
        } catch (e) {
            console.warn("[Security] Could not decode magic login token:", e.message);
        }
    }

    if (queryTgId) {
        sessionStorage.setItem("admin_auth_id", queryTgId.trim());
    }
    if (queryTgName) {
        sessionStorage.setItem("admin_auth_name", queryTgName.trim());
    }
    if (queryTgId || queryTgName || authToken) {
        // Sanitize browser address bar immediately so admin credentials are not exposed or shareable via URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    if (tgUser) {
        const uName = tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name || 'Admin'}`;
        sessionStorage.setItem("admin_auth_name", uName);
        sessionStorage.setItem("admin_auth_id", String(tgUser.id));
    }
    const currentTgId = tgUser ? String(tgUser.id) : (sessionStorage.getItem("admin_auth_id") || null);

    const idBox = document.getElementById("your-tg-id-box");
    if (idBox) {
        const currentName = sessionStorage.getItem("admin_auth_name");
        idBox.textContent = currentTgId 
            ? `Your Telegram ID: ${currentTgId}${currentName ? ` (${currentName})` : ''}` 
            : "Not running inside Telegram WebApp";
    }

    // Determine current user's role
    if (currentTgId && slaves.includes(currentTgId) && !masters.includes(currentTgId)) {
        isCurrentUserSlaveAdmin = true;
    }

    // Apply view restrictions if they are a slave admin
    if (isCurrentUserSlaveAdmin) {
        const panelsToHide = [
            "settings-panel",
            "stats-grid",
            "requests-panel",
            "editors-choice-panel",
            "broadcast-panel",
            "allocator-panel"
        ];
        panelsToHide.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });

        // Update header title to content curation center
        const adminTitle = document.querySelector(".admin-title span:last-child");
        if (adminTitle) {
            adminTitle.textContent = "CONTENT CURATION CENTER";
        }

        // Add a clean curating banner/indicator styles
        const header = document.querySelector(".admin-header");
        if (header) {
            header.style.border = "1px solid rgba(255, 188, 0, 0.4)";
            header.style.background = "linear-gradient(135deg, rgba(255, 188, 0, 0.08) 0%, rgba(22, 24, 35, 0.3) 100%)";
        }
        const statusText = document.getElementById("status-text");
        if (statusText) {
            statusText.textContent = "CONTENT CURATOR MODE";
            statusText.style.color = "#ffbc00";
            statusText.parentElement.style.color = "#ffbc00";
            statusText.parentElement.style.background = "rgba(255, 188, 0, 0.1)";
            statusText.parentElement.style.borderColor = "rgba(255, 188, 0, 0.3)";
        }
        const liveDot = document.querySelector(".live-dot");
        if (liveDot) {
            liveDot.style.backgroundColor = "#ffbc00";
        }
    }

    // In production, block access if not authorized
    if (!isLocal) {
        if (!currentTgId || !authorizedIds.includes(currentTgId)) {
            const overlay = document.getElementById("unauthorized-overlay");
            if (overlay) {
                overlay.style.display = "flex";
            }
        } else {
            // Hide unauthorized overlay if previously shown or bypassed via query parameter
            const overlay = document.getElementById("unauthorized-overlay");
            if (overlay) {
                overlay.style.display = "none";
            }
        }
    }
}

// Save Admin IDs to Firestore
const saveAdminsBtn = document.getElementById("btn-save-admins");
if (saveAdminsBtn) {
    saveAdminsBtn.addEventListener("click", async () => {
        const masterInput = document.getElementById("admin-master-tg-ids");
        const slaveInput = document.getElementById("admin-slave-tg-ids");
        if (db) {
            const defaultAdmins = ["1329840839", "1175336733"];
            
            let masterIds = [];
            if (masterInput) {
                masterIds = masterInput.value.trim().split(",")
                    .map(id => id.trim())
                    .filter(id => id && /^\d+$/.test(id));
            }
            const finalMasters = Array.from(new Set([...defaultAdmins, ...masterIds]));

            let slaveIds = [];
            if (slaveInput) {
                slaveIds = slaveInput.value.trim().split(",")
                    .map(id => id.trim())
                    .filter(id => id && /^\d+$/.test(id));
            }

            const finalAllIds = Array.from(new Set([...finalMasters, ...slaveIds]));

            try {
                await db.collection("settings").doc("admins").set({
                    ids: finalAllIds,
                    masters: finalMasters,
                    slaves: slaveIds,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                if (masterInput) masterInput.value = finalMasters.join(", ");
                if (slaveInput) slaveInput.value = slaveIds.join(", ");
                showToast("Authorized Admins and Roles updated successfully in Firestore! 🛡️", "success");
            } catch (e) {
                console.error("Error saving admin list to Firestore:", e);
                showToast("Failed to update Admin list. Check your database rules.", "error");
            }
        }
    });
}

// Save GitHub token to Firestore & localStorage
const saveTokenBtn = document.getElementById("btn-save-github-token");
if (saveTokenBtn) {
    saveTokenBtn.addEventListener("click", async () => {
        const tokenInput = document.getElementById("github-token");
        if (tokenInput) {
            const token = tokenInput.value.trim();
            // Save locally first for instant access
            localStorage.setItem("filmhouse_github_token", token);
            githubToken = token;
            
            if (db) {
                try {
                    await db.collection("settings").doc("github").set({
                        token: token,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    showToast("GitHub Personal Access Token saved securely in Firestore! 🚀", "success");
                } catch (e) {
                    console.error("Error saving token to Firestore:", e);
                    showToast("Token saved locally! (Note: Firestore database sync failed).", "warning");
                }
            } else {
                showToast("GitHub Personal Access Token saved locally!", "info");
            }
        }
    });
}

// Save Telegram Bot Token to Firestore & localStorage
const saveTelegramTokenBtn = document.getElementById("btn-save-telegram-token");
if (saveTelegramTokenBtn) {
    saveTelegramTokenBtn.addEventListener("click", async () => {
        const tokenInput = document.getElementById("telegram-bot-token");
        if (tokenInput) {
            const token = tokenInput.value.trim();
            // Save locally first for instant access
            localStorage.setItem("filmhouse_telegram_bot_token", token);
            telegramBotToken = token;
            
            if (db) {
                try {
                    await db.collection("settings").doc("telegram").set({
                        botToken: token,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    showToast("Telegram Bot Token saved securely in Firestore! 🤖", "success");
                } catch (e) {
                    console.error("Error saving Telegram token to Firestore:", e);
                    showToast("Token saved locally! (Note: Firestore database sync failed).", "warning");
                }
            } else {
                showToast("Telegram Bot Token saved locally!", "info");
            }
        }
    });
}

// Save Telegram Webhook URL to Firestore & localStorage
const saveTelegramWebhookBtn = document.getElementById("btn-save-telegram-webhook");
if (saveTelegramWebhookBtn) {
    saveTelegramWebhookBtn.addEventListener("click", async () => {
        const webhookInput = document.getElementById("telegram-webhook-url");
        if (webhookInput) {
            const url = webhookInput.value.trim();
            // Save locally first for instant access
            localStorage.setItem("filmhouse_telegram_webhook_url", url);
            telegramWebhookUrl = url;
            
            if (db) {
                try {
                    await db.collection("settings").doc("telegram").set({
                        webhookUrl: url,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    showToast("Telegram Webhook URL saved securely in Firestore! 🌐", "success");
                } catch (e) {
                    console.error("Error saving Telegram webhook to Firestore:", e);
                    showToast("Webhook URL saved locally! (Note: Firestore database sync failed).", "warning");
                }
            } else {
                showToast("Telegram Webhook URL saved locally!", "info");
            }
        }
    });
}

// Save Telegram Ping URLs to Firestore & localStorage
const saveTelegramPingsBtn = document.getElementById("btn-save-telegram-pings");
if (saveTelegramPingsBtn) {
    saveTelegramPingsBtn.addEventListener("click", async () => {
        const pingsInput = document.getElementById("telegram-ping-urls");
        if (pingsInput) {
            const urlsStr = pingsInput.value.trim();
            // Save locally first for instant access
            localStorage.setItem("filmhouse_telegram_ping_urls", urlsStr);
            
            if (db) {
                try {
                    await db.collection("settings").doc("telegram").set({
                        pingUrls: urlsStr,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    showToast("File Bot Keep-alive URLs saved successfully! 🤖📡", "success");
                } catch (e) {
                    console.error("Error saving Telegram ping URLs to Firestore:", e);
                    showToast("URLs saved locally! (Note: Firestore database sync failed).", "warning");
                }
            } else {
                showToast("Keep-alive URLs saved locally!", "info");
            }
        }
    });
}

// Save Welcome Message configuration to Firestore
const saveWelcomeMessageBtn = document.getElementById("btn-save-welcome-message");
if (saveWelcomeMessageBtn) {
    saveWelcomeMessageBtn.addEventListener("click", async () => {
        const welcomeImgInput = document.getElementById("telegram-welcome-image");
        const welcomeTextInput = document.getElementById("telegram-welcome-text");
        const appTextInput = document.getElementById("telegram-welcome-app-text");
        const appUrlInput = document.getElementById("telegram-welcome-app-url");
        const chanTextInput = document.getElementById("telegram-welcome-channel-text");
        const chanUrlInput = document.getElementById("telegram-welcome-channel-url");
        
        if (welcomeImgInput && welcomeTextInput && appTextInput && appUrlInput && chanTextInput && chanUrlInput) {
            const photoUrl = welcomeImgInput.value.trim();
            const text = welcomeTextInput.value.trim();
            const appButtonText = appTextInput.value.trim();
            const appButtonUrl = appUrlInput.value.trim();
            const channelButtonText = chanTextInput.value.trim();
            const channelButtonUrl = chanUrlInput.value.trim();
            
            if (db) {
                try {
                    saveWelcomeMessageBtn.disabled = true;
                    saveWelcomeMessageBtn.textContent = "Saving... ⏳";
                    
                    await db.collection("settings").doc("welcome").set({
                        photoUrl: photoUrl,
                        text: text,
                        appButtonText: appButtonText,
                        appButtonUrl: appButtonUrl,
                        channelButtonText: channelButtonText,
                        channelButtonUrl: channelButtonUrl,
                        fileId: null, // Clear cached fileId so bot fetches the new URL
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    
                    showToast("Welcome Message configuration saved successfully! 📢", "success");
                } catch (e) {
                    console.error("Error saving welcome config to Firestore:", e);
                    showToast("Failed to save welcome message to Firestore.", "error");
                } finally {
                    saveWelcomeMessageBtn.disabled = false;
                    saveWelcomeMessageBtn.textContent = "Save Welcome Message";
                }
            } else {
                showToast("Database connection not ready.", "error");
            }
        }
    });
}

// Test Connection for Telegram Bot Token
const testTelegramBtn = document.getElementById("btn-test-telegram-conn");
if (testTelegramBtn) {
    testTelegramBtn.addEventListener("click", async () => {
        const tokenInput = document.getElementById("telegram-bot-token");
        const token = tokenInput ? tokenInput.value.trim() : "";
        if (!token) {
            showToast("Please enter a Telegram Bot Token first!", "warning");
            return;
        }

        testTelegramBtn.disabled = true;
        testTelegramBtn.textContent = "Testing... ⏳";

        // Determine destination chat ID: try current admin ID, fallback to prompt
        const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
        let testChatId = tgUser ? String(tgUser.id) : null;
        
        if (!testChatId) {
            const urlParams = new URLSearchParams(window.location.search);
            testChatId = urlParams.get("tg_id") || urlParams.get("admin_id");
        }

        if (!testChatId) {
            testChatId = prompt("Enter your Telegram User ID to receive the test message:");
        }

        if (!testChatId) {
            testTelegramBtn.disabled = false;
            testTelegramBtn.textContent = "Test Bot";
            return;
        }

        const testMsg = `🤖 <b>Film House Bot Diagnostic</b>\n\nConnection successful! The secure server worker is fully operational and ready to broadcast. 🚀`;

        try {
            if (typeof firebase === 'undefined' || !db) {
                throw new Error("Firestore is not connected.");
            }
            const currentAdminId = sessionStorage.getItem("admin_auth_id") || "1175336733";
            await db.collection("admin_broadcast_queue").add({
                type: "user_broadcast",
                adminId: String(currentAdminId),
                message: testMsg,
                targetUserIds: [testChatId.trim()],
                status: "pending",
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast("Diagnostic test message queued on secure server! Check your bot chat. 💌", "success");
        } catch (err) {
            console.error("Telegram connection error:", err);
            showToast(`Error queuing diagnostic message: ${err.message}`, "error");
        } finally {
            testTelegramBtn.disabled = false;
            testTelegramBtn.textContent = "Test Bot";
        }
    });
}

// Test Connection to GitHub API and validate token permissions
const testConnBtn = document.getElementById("btn-test-github-conn");
if (testConnBtn) {
    testConnBtn.addEventListener("click", async () => {
        const tokenInput = document.getElementById("github-token");
        const token = tokenInput ? tokenInput.value.trim() : "";
        
        testConnBtn.disabled = true;
        testConnBtn.textContent = "Testing... ⏳";
        
        let logMsg = "--- GitHub API Diagnostics ---\n";
        
        try {
            // Stage 1: Public Connection & DNS test
            logMsg += "Stage 1: Testing public DNS & API routing... ";
            const start1 = Date.now();
            const publicRes = await fetch("https://api.github.com/zen?t=" + Date.now(), {
                headers: { "Accept": "application/vnd.github.v3+json" }
            });
            const latency1 = Date.now() - start1;
            
            if (publicRes.ok) {
                logMsg += `SUCCESS (Latency: ${latency1}ms)\n`;
            } else {
                logMsg += `FAILED (HTTP Status: ${publicRes.status} ${publicRes.statusText})\n`;
            }
            
            // Stage 2: Token verification & repository write permissions
            if (token) {
                logMsg += "Stage 2: Testing Token Authorization... ";
                const start2 = Date.now();
                const authRes = await fetch("https://api.github.com/repos/dans123456/filmhouse?t=" + Date.now(), {
                    headers: {
                        "Authorization": `token ${token}`,
                        "Accept": "application/vnd.github.v3+json"
                    }
                });
                const latency2 = Date.now() - start2;
                
                if (authRes.ok) {
                    const repoData = await authRes.json();
                    const pushAccess = repoData.permissions ? repoData.permissions.push : false;
                    logMsg += `SUCCESS (Latency: ${latency2}ms)\n`;
                    logMsg += `Push/Write Permission Status: ${pushAccess ? "✅ AUTHORIZED (You can write changes)" : "❌ DENIED (Read-only token!)"}\n`;
                } else {
                    logMsg += `FAILED (HTTP Status: ${authRes.status} ${authRes.statusText})\n`;
                    if (authRes.status === 401) {
                        logMsg += "Reason: Your token is invalid, expired, or has been revoked by GitHub.\n";
                    } else if (authRes.status === 404) {
                        logMsg += "Reason: Repository not found or token lacks scopes to view private repos.\n";
                    }
                }
            } else {
                logMsg += "Stage 2: SKIPPED (No token entered to test)\n";
            }
            
            alert(logMsg);
        } catch (e) {
            logMsg += `FAILED\nError Details: ${e.message}\n\n`;
            logMsg += "Troubleshooting tips:\n";
            logMsg += "- Verify your device has a stable internet connection.\n";
            logMsg += "- If you are on mobile data, try switching to Wi-Fi (or vice versa).\n";
            logMsg += "- Ensure that you do not have any parental controls or VPN/Firewall blocking api.github.com.";
            alert(logMsg);
        } finally {
            testConnBtn.disabled = false;
            testConnBtn.textContent = "Test Connection";
        }
    });
}

// Save TMDB API Key Event Listener
const saveTmdbKeyBtn = document.getElementById("btn-save-tmdb-key");
if (saveTmdbKeyBtn) {
    saveTmdbKeyBtn.addEventListener("click", async () => {
        const keyInput = document.getElementById("tmdb-api-key");
        if (keyInput) {
            const key = keyInput.value.trim();
            // Save locally first for instant access
            localStorage.setItem("filmhouse_tmdb_key", key);
            TMDB_API_KEY = key;
            
            if (db) {
                try {
                    await db.collection("settings").doc("tmdb").set({
                        apiKey: key,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    showToast("TMDB API Key saved securely in Firestore! 🍿", "success");
                } catch (e) {
                    console.error("Error saving TMDB key to Firestore:", e);
                    showToast("Key saved locally! (Note: Firestore database sync failed).", "warning");
                }
            } else {
                showToast("TMDB API Key saved locally!", "info");
            }
        }
    });
}

// Test Connection for TMDB API Key
const testTmdbBtn = document.getElementById("btn-test-tmdb-conn");
if (testTmdbBtn) {
    testTmdbBtn.addEventListener("click", async () => {
        const keyInput = document.getElementById("tmdb-api-key");
        const key = keyInput ? keyInput.value.trim() : "";
        if (!key) {
            showToast("Please enter a TMDB API Key first!", "warning");
            return;
        }

        testTmdbBtn.disabled = true;
        testTmdbBtn.textContent = "Testing... ⏳";

        try {
            const url = `https://api.themoviedb.org/3/movie/550?api_key=${key}`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                showToast(`Success! TMDB Connection OK. Test Title: "${data.title || data.name}" 🎬`, "success");
            } else {
                const errorData = await response.json().catch(() => ({}));
                showToast(`Failed: ${errorData.status_message || response.statusText} (Status: ${response.status})`, "error");
            }
        } catch (err) {
            console.error("TMDB connection test error:", err);
            showToast(`Network error testing TMDB API: ${err.message}`, "error");
        } finally {
            testTmdbBtn.disabled = false;
            testTmdbBtn.textContent = "Test Key";
        }
    });
}

// Load Catalog
async function loadCatalog() {
    const listContainer = document.getElementById("catalog-list");
    try {
        // CHECK FOR LOCAL UNPUBLISHED DRAFT FIRST!
        const draftStr = localStorage.getItem("filmhouse_unpublished_catalog");
        if (draftStr) {
            try {
                const draft = JSON.parse(draftStr);
                if (draft && draft.allCatalogMovies && draft.allCatalogMovies.length > 0) {
                    if (confirm("You have unpublished changes (added/edited/deleted movies) from your last session. Would you like to restore them? Click Cancel to start fresh with the live catalog.")) {
                        allCatalogMovies = draft.allCatalogMovies;
                        newlyAddedIds = draft.newlyAddedIds || [];
                        newlyUpdatedIds = draft.newlyUpdatedIds || [];
                        newlyDeletedIds = draft.newlyDeletedIds || [];
                        catalogChangesMade = true;
                        originalCatalogCount = allCatalogMovies.length;
                        updatePublishButtonState();
                        renderCatalogList();
                        renderEditorsChoiceSelectionList();
                        renderRequestsList();
                        if (typeof updateStatsCounters === 'function') updateStatsCounters();
                        return;
                    } else {
                        localStorage.removeItem("filmhouse_unpublished_catalog");
                    }
                }
            } catch (draftErr) {
                console.warn("Failed to parse local draft:", draftErr);
            }
        }

        const token = (document.getElementById("github-token")?.value.trim()) || githubToken;
        let responseData = null;
        
        if (token) {
            const owner = "dans123456";
            const repo = "filmhouse";
            const pathJSON = "MOVIE/Data/movies_metadata.json";
            const apiJSONUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathJSON}`;
            
            try {
                const response = await fetch(`${apiJSONUrl}?t=${Date.now()}`, {
                    headers: {
                        "Authorization": `token ${token}`,
                        "Accept": "application/vnd.github.v3+json",
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Pragma": "no-cache"
                    }
                });
                if (response.ok) {
                    const data = await response.json();
                    lastKnownJsonSha = data.sha; // Set the fresh SHA directly
                    const jsonText = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ""))));
                    responseData = JSON.parse(jsonText);
                }
            } catch (err) {
                console.warn("Failed to load catalog from GitHub API, falling back to local file:", err);
            }
        }
        
        if (!responseData) {
            const response = await fetch("./MOVIE/Data/movies_metadata.json?t=" + Date.now(), {
                headers: {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            });
            if (response.ok) {
                responseData = await response.json();
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }
        
        allCatalogMovies = responseData;
        originalCatalogCount = allCatalogMovies.length;
        renderCatalogList();
        renderEditorsChoiceSelectionList();
        renderRequestsList();
        if (typeof updateStatsCounters === 'function') updateStatsCounters();
    } catch (e) {
        console.error("Failed to load catalog:", e);
        if (listContainer) {
            listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: #ff3b30;">Failed to load catalog data.</div>`;
        }
    }
}

// Render Catalog List
// Details Modal references
const movieDetailsModal = document.getElementById("movie-details-modal");
const closeDetailsModalBtn = document.getElementById("btn-close-details-modal");

if (closeDetailsModalBtn && movieDetailsModal) {
    closeDetailsModalBtn.addEventListener("click", () => {
        movieDetailsModal.classList.remove("active");
    });
}

function renderDetailsStreamsReadOnlyHTML(streams, movie, isSeries) {
    if (!streams || streams.length === 0) {
        return `
            <div style="font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center; background: rgba(0,0,0,0.2); border-radius: 6px;">
                No online streaming links attached yet.<br>Click <strong style="color: #ffbc00;">⚡ Quick Add / Update Streams</strong> or <strong style="color: #fff;">Edit Details</strong> above to attach stream tokens.
            </div>
        `;
    }

    return streams.map((s, idx) => {
        const epNum = s.episode || (idx + 1);
        const label = isSeries ? `Episode ${epNum}` : (s.quality || `Link ${idx + 1}`);
        const tokenVal = s.stream_url || s.url || '';
        const playUrl = `https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(tokenVal)}&title=${encodeURIComponent(movie.title)}${isSeries ? `&ep=${epNum}` : ''}`;
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                    <span style="font-size: 11px; font-weight: 700; color: #ffbc00; background: rgba(255,188,0,0.1); border: 1px solid rgba(255,188,0,0.25); border-radius: 4px; padding: 2px 7px; white-space: nowrap;">
                        ${escapeHTML(label)}
                    </span>
                    <span style="font-size: 11px; color: var(--text-secondary); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(tokenVal)}">
                        ${escapeHTML(tokenVal)}
                    </span>
                </div>
                <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                    <button type="button" class="btn-copy-stream-token" data-token="${escapeHTML(tokenVal)}" style="font-size: 10px; padding: 2px 7px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: #fff; border-radius: 4px; cursor: pointer;" title="Copy Token">📋 Copy</button>
                    <a href="${playUrl}" target="_blank" style="font-size: 10px; color: #ffbc00; text-decoration: none; padding: 2px 8px; border: 1px solid rgba(255, 188, 0, 0.35); border-radius: 4px; font-weight: 600; background: rgba(255, 188, 0, 0.08); white-space: nowrap;" title="Test Stream in Monetag Player">Test ▶️</a>
                </div>
            </div>
        `;
    }).join('');
}

function showMovieDetails(movie) {
    const detailsBody = document.getElementById("details-modal-body");
    if (!detailsBody || !movieDetailsModal) return;
    
    const isSeries = (movie.type || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'tv';
    const badgeColor = isSeries ? 'var(--primary-color)' : '#00bcd4';
    const posterUrl = getPosterUrl(movie.poster);
    const linksList = movie.links || [];
    let currentStreams = extractMovieStreams(movie);

    const hasCinemaCut = linksList.some(l => {
        const q = (typeof l === 'object' && l !== null ? (l.quality || "") : "").toLowerCase();
        return q.includes("cinema cut") || q.includes("hdcam") || q.includes("cam");
    });
    const cinemaCutBadge = hasCinemaCut ? `<span style="font-size: 10px; background: linear-gradient(135deg, rgba(255, 152, 0, 0.2), rgba(255, 87, 34, 0.2)); border: 1px solid rgba(255, 152, 0, 0.4); color: #ff9800; padding: 2px 8px; border-radius: 4px; margin-left: 8px; font-weight: 800;">📽️ Cinema Cut</span>` : "";
    
    detailsBody.innerHTML = `
        <!-- Read-Only Title Info View -->
        <div id="details-title-info-view" style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px;">
            <img src="${posterUrl}" style="width: 130px; height: 180px; border-radius: 8px; border: 1px solid var(--border-color); object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
            <div style="flex: 1; min-width: 200px; display: flex; flex-direction: column; justify-content: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 18px; font-family: var(--font-heading); color: #fff; line-height: 1.3;">${movie.title} ${cinemaCutBadge}</h4>
                <p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>ID:</strong> ${movie.csv_id}</p>
                <p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>Type:</strong> <span style="text-transform: uppercase; font-weight: 600; color: ${badgeColor};">${movie.type}</span></p>
                ${movie.release_date ? `<p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>Release Date:</strong> ${movie.release_date}</p>` : ''}
                ${movie.rating ? `<p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>Rating:</strong> ⭐ ${movie.rating}/10</p>` : ''}
                ${movie.director ? `<p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary);"><strong>Director:</strong> ${movie.director}</p>` : ''}
                ${movie.cast && movie.cast.length ? `<p style="margin: 0 0 6px 0; font-size: 13px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;"><strong>Cast:</strong> ${movie.cast.join(', ')}</p>` : ''}
            </div>
        </div>

        <!-- Editable Title Info View (Hidden by default) -->
        <div id="details-title-info-edit" style="display: none; gap: 15px; flex-direction: column; margin-bottom: 20px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Title</label>
                <input type="text" id="edit-movie-title" value="${escapeHTML(movie.title)}" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 10px; width: 100%;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 120px;">
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">TMDB ID / Slug or Link</label>
                    <input type="text" id="edit-movie-id" value="${escapeHTML(movie.csv_id)}" placeholder="e.g. 27205-inception or paste TMDB URL" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 120px;">
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Type</label>
                    <select id="edit-movie-type" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
                        <option value="Movie" ${(movie.type || "").toLowerCase() === 'movie' ? 'selected' : ''}>Movie</option>
                        <option value="Series" ${(movie.type || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'tv' ? 'selected' : ''}>Series (TV)</option>
                    </select>
                </div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 10px; width: 100%;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 120px;">
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Poster Image URL</label>
                    <input type="text" id="edit-movie-poster" value="${escapeHTML(movie.poster || '')}" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 120px;">
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Backdrop Image URL</label>
                    <input type="text" id="edit-movie-backdrop" value="${escapeHTML(movie.backdrop || '')}" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
                </div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 10px; width: 100%;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 120px;">
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">YouTube Trailer (URL or ID)</label>
                    <input type="text" id="edit-movie-trailer" value="${escapeHTML(movie.trailer || '')}" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 120px;">
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Release Date / Year</label>
                    <input type="text" id="edit-movie-release-date" value="${escapeHTML(movie.release_date || '')}" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
                </div>
            </div>
            <!-- Dynamic Streaming & Episode Links Manager in Edit View -->
            <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; background: rgba(255, 188, 0, 0.03); border: 1px solid rgba(255, 188, 0, 0.2); border-radius: 6px; padding: 12px; box-sizing: border-box;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                    <label style="font-size: 11px; color: #ffbc00; text-transform: uppercase; font-weight: bold; display: flex; align-items: center; gap: 6px; margin: 0;">
                        <span>▶️ Online Streaming & Episode Manager</span>
                    </label>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-details-auto-slots" style="font-size: 10px; padding: 3px 8px; color: #00c8ff; border-color: rgba(0, 200, 255, 0.3); cursor: pointer;" title="Automatically generate episode slots">⚡ Auto-Slots</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-details-bulk-streams-toggle" style="font-size: 10px; padding: 3px 8px; color: #ffbc00; border-color: rgba(255, 188, 0, 0.3); cursor: pointer;">📋 Bulk Paste</button>
                    </div>
                </div>
                
                <div id="details-streams-inputs-wrapper" style="display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; padding-right: 4px;">
                    <!-- Editable stream rows dynamically rendered -->
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; flex-wrap: wrap; gap: 6px;">
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-add-details-stream-input" style="font-size: 11px; padding: 4px 10px; border-radius: 4px; cursor: pointer;">+ Add Stream Row</button>
                    <span style="font-size: 10px; color: var(--text-muted);" id="details-streams-counter">0 streams attached</span>
                </div>

                <div id="details-bulk-streams-wrapper" style="display: none; margin-top: 8px; border-top: 1px dashed rgba(255, 188, 0, 0.2); padding-top: 8px;">
                    <textarea id="details-bulk-streams-input" placeholder="Paste stream links or tokens (one per line)...&#10;Line 1 -> Episode 1 (or 720p)&#10;Line 2 -> Episode 2 (or 1080p)...&#10;Or: Ep 1 | token...&#10;Or File Stream Bot link..." style="width: 100%; min-height: 80px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; padding: 8px; color: #fff; font-size: 12px; font-family: monospace; resize: vertical; box-sizing: border-box;"></textarea>
                    <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
                        <button type="button" class="btn btn-primary btn-sm" id="btn-apply-details-bulk-streams" style="font-size: 11px; padding: 4px 10px; cursor: pointer;">Apply Streams</button>
                    </div>
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Categories</label>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-edit-auto-cats" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; color: #ffbc00; border-color: rgba(255, 188, 0, 0.3); cursor: pointer;">⚡ Auto-Detect</button>
                </div>
                <div id="edit-movie-categories-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; max-height: 110px; overflow-y: auto; box-sizing: border-box;">
                    ${[
                        { key: "Main", label: "Main (Home)" },
                        { key: "Hollywood/British Movies", label: "Hollywood Movies" },
                        { key: "Hollywood/British Series", label: "Hollywood Series" },
                        { key: "Bollywood", label: "Bollywood" },
                        { key: "Asian Drama", label: "Asian Drama" },
                        { key: "Asian Movies", label: "Asian Movies" },
                        { key: "African", label: "African" },
                        { key: "Anime Series", label: "Anime Series" },
                        { key: "Anime Movies", label: "Anime Movies" },
                        { key: "Comic", label: "Comic" },
                        { key: "Animated Movies", label: "Animated" },
                        { key: "Kids Shows and Movies (Nickelodeon and Disney)", label: "Kids" },
                        { key: "Classic Movies", label: "Classics" },
                        { key: "Erotic Movies", label: "Erotic" },
                        { key: "Teen/High-School", label: "Teen / High-School" },
                        { key: "Christian Movies", label: "Christian" }
                    ].map(cat => {
                        const isChecked = (movie.categories && (
                            movie.categories.includes(cat.key) ||
                            (cat.key === "Asian Drama" && movie.categories.includes("Korean Drama")) ||
                            (cat.key === "Asian Movies" && movie.categories.includes("Korean Movies")) ||
                            (cat.key === "Anime Series" && movie.categories.includes("Anime"))
                        )) ? 'checked' : '';
                        return `
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; color: #fff;">
                                <input type="checkbox" class="edit-cat-checkbox" value="${cat.key}" ${isChecked}> ${cat.label}
                            </label>
                        `;
                    }).join('')}
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Synopsis</label>
                <textarea id="edit-movie-overview" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%; min-height: 80px; resize: vertical; box-sizing: border-box; font-family: inherit;">${escapeHTML(movie.overview || '')}</textarea>
            </div>
        </div>

        ${movie.overview ? `
        <div style="margin-bottom: 20px;">
            <h5 style="margin: 0 0 6px 0; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Synopsis</h5>
            <p style="margin: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.6;">${movie.overview}</p>
        </div>
        ` : ''}

        <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h5 style="margin: 0; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Telegram Download Links</h5>
                <button class="btn btn-secondary btn-sm" id="btn-edit-links-toggle" style="font-size: 11px; padding: 4px 8px; border-radius: 4px; cursor: pointer;">Edit Details</button>
            </div>
            
            <!-- Read-Only View -->
            <div id="links-view-container" style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
                ${linksList.length ? linksList.map((link, idx) => {
                    const linkUrl = typeof link === 'object' && link !== null ? link.url : link;
                    const linkQuality = typeof link === 'object' && link !== null && link.quality ? link.quality : "720p";
                    return `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <span style="font-size: 12px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 82%;" title="${escapeHTML(linkUrl)}">Link ${idx + 1} (${escapeHTML(linkQuality)}): ${escapeHTML(linkUrl)}</span>
                            <a href="${escapeHTML(linkUrl)}" target="_blank" style="font-size: 12px; color: var(--primary-color); text-decoration: none; font-weight: 600; padding: 2px 8px; background: rgba(255, 188, 0, 0.05); border: 1px solid rgba(255, 188, 0, 0.2); border-radius: 4px;">Test 🔗</a>
                        </div>
                    `;
                }).join('') : '<p style="margin: 0; font-size: 12px; color: var(--text-muted); text-align: center; padding: 10px;">No links added</p>'}
            </div>

            <!-- Editor View (Hidden by default) -->
            <div id="links-edit-container" style="display: none; background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px;">
                <div id="links-inputs-wrapper" style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto; margin-bottom: 10px; padding-right: 4px;">
                    <!-- Editable inputs dynamically rendered -->
                </div>
                <div style="display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" id="btn-add-link-input" style="font-size: 11px; padding: 6px 10px; border-radius: 4px; cursor: pointer;">+ Add Link</button>
                        <button class="btn btn-secondary btn-sm" id="btn-details-bulk-links-toggle" style="font-size: 11px; padding: 6px 10px; border-radius: 4px; cursor: pointer; color: #ffbc00; border-color: rgba(255, 188, 0, 0.3);">📋 Bulk Paste</button>
                    </div>
                    <button class="btn btn-primary btn-sm" id="btn-save-links-changes" style="font-size: 11px; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Save Changes</button>
                </div>
                <div id="details-bulk-links-wrapper" style="display: none; margin-top: 10px;">
                    <textarea id="details-bulk-links-input" placeholder="Paste multiple links (one per line)...&#10;Line 1 -> Season 1 (or 720p)&#10;Line 2 -> Season 2 (or 1080p)..." style="width: 100%; min-height: 80px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; padding: 8px; color: #fff; font-size: 12px; font-family: monospace; resize: vertical; box-sizing: border-box;"></textarea>
                    <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
                        <button type="button" class="btn btn-primary btn-sm" id="btn-apply-details-bulk-links" style="font-size: 11px; padding: 4px 10px;">Apply Links</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Online Streaming Hub & Episode Manager (Read-Only + Quick Drawer) -->
        <div id="details-streaming-hub-container" style="margin-bottom: 24px; background: rgba(255, 188, 0, 0.03); border: 1px solid rgba(255, 188, 0, 0.2); border-radius: 6px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                <h5 style="margin: 0; color: #ffbc00; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
                    <span>▶️ Online Streaming (Monetag Player)</span>
                </h5>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="details-streaming-status-badge" style="font-size: 10px; ${currentStreams.length > 0 ? 'color: #4cd964; background: rgba(76, 217, 100, 0.15); border: 1px solid rgba(76, 217, 100, 0.3); font-weight: 700;' : 'color: var(--text-muted); background: rgba(255, 255, 255, 0.05);'} padding: 2px 8px; border-radius: 10px;">
                        ${currentStreams.length > 0 ? (isSeries ? `🟢 ${currentStreams.length} Episode Stream(s) Ready` : `🟢 Stream Active (${currentStreams.length} Qualities)`) : '⚪ No Streams Attached'}
                    </span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-quick-streams-toggle" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; color: #ffbc00; border-color: rgba(255, 188, 0, 0.35); cursor: pointer;">
                        ⚡ Quick Add / Update Streams
                    </button>
                </div>
            </div>

            <!-- List of streams in Read-Only View -->
            <div id="details-streams-view-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 190px; overflow-y: auto; margin-top: 8px;">
                ${renderDetailsStreamsReadOnlyHTML(currentStreams, movie, isSeries)}
            </div>

            <!-- Quick Inline Add / Paste Drawer -->
            <div id="details-quick-streams-drawer" style="display: none; margin-top: 10px; border-top: 1px dashed rgba(255, 188, 0, 0.25); padding-top: 10px;">
                <div style="font-size: 11px; color: #00c8ff; font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                    <span>⚡ Quick Batch Paste Streams (File Stream Bot tokens or links):</span>
                    <span style="font-size: 10px; color: var(--text-muted); font-weight: normal;">Format: 1 token per line or 'Ep 1 | token'</span>
                </div>
                <textarea id="details-quick-streams-input" placeholder="${isSeries ? 'Paste episode streams here (one per line)...&#10;Line 1 -> Episode 1&#10;Line 2 -> Episode 2&#10;Or: Ep 1 | token...' : 'Paste stream token or URL (or 720p | token)...'}" style="width: 100%; min-height: 85px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; padding: 8px; color: #fff; font-size: 12px; font-family: monospace; resize: vertical; box-sizing: border-box;"></textarea>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 8px;">
                    <span style="font-size: 10px; color: var(--text-muted);">Saves immediately to this title in your catalog</span>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-quick-streams-cancel" style="font-size: 11px; padding: 4px 10px; cursor: pointer;">Cancel</button>
                        <button type="button" class="btn btn-primary btn-sm" id="btn-save-quick-streams" style="font-size: 11px; padding: 4px 14px; cursor: pointer; font-weight: 700;">💾 Save Streams</button>
                    </div>
                </div>
            </div>
        </div>

        <div style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <label style="font-size: 11px; font-weight: 700; color: #00c8ff; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 5px;">
                    📢 Channel Announcement Edition:
                </label>
                <span style="font-size: 10px; color: var(--text-muted);">Highlighted in Film House Updates 🔥</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; width: 100%;">
                <select id="details-channel-edition-select" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; padding: 10px 12px; font-size: 13px;">
                    ${isSeries ? `
                        <option value="">Complete Series (All Seasons)</option>
                        <option value="Season 1">Season 1</option>
                        <option value="Season 2">Season 2</option>
                        <option value="Season 3">Season 3</option>
                        <option value="Season 4">Season 4</option>
                        <option value="Season 5">Season 5</option>
                        <option value="New Episodes">New Episodes Added</option>
                    ` : `
                        <option value="">Full Movie (Standard)</option>
                        <option value="Cinema Cut">Cinema Cut (Early Access)</option>
                        <option value="Director's Cut">Director's Cut</option>
                        <option value="Extended Edition">Extended Edition</option>
                        <option value="1080p Quality">1080p HD Quality</option>
                        <option value="4K UHD Quality">4K UHD Quality</option>
                        <option value="720p Quality">720p Standard Quality</option>
                    `}
                </select>
                <input type="text" id="details-channel-custom-edition" placeholder="Or custom: e.g. Season 2, Cinema Cut" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; padding: 10px 12px; font-size: 13px;" />
            </div>

            <div style="margin-bottom: 12px;">
                <label style="font-size: 11px; font-weight: 700; color: #ffbc00; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">
                    📢 Announcement Style:
                </label>
                <div style="display: flex; gap: 10px; background: rgba(0,0,0,0.25); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); flex-wrap: wrap;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--text-primary); font-weight: 600;">
                        <input type="radio" name="details-channel-mode" value="updated" ${isSeries ? "checked" : ""} style="accent-color: #ffbc00;" />
                        🔄 Updated Version <span style="font-size: 10px; color: var(--text-muted); font-weight: normal;">(🔥 NEW SEASON UPDATED!)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--text-primary); font-weight: 600;">
                        <input type="radio" name="details-channel-mode" value="released" ${!isSeries ? "checked" : ""} style="accent-color: #00c8ff;" />
                        🆕 Released Version <span style="font-size: 10px; color: var(--text-muted); font-weight: normal;">(🔥 NEW SEASON RELEASED!)</span>
                    </label>
                </div>
            </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
            <button type="button" class="btn btn-secondary" id="btn-details-post-channel" data-csv-id="${movie.csv_id}" style="width: 100%; min-height: 44px; border-color: rgba(0, 136, 204, 0.4); color: #0088cc; background: rgba(0, 136, 204, 0.08); cursor: pointer; padding: 12px; font-weight: 700; border-radius: 6px; transition: all 0.3s; display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;">
                📢 Post Announcement to Channel
            </button>
            <button type="button" class="btn btn-secondary" id="btn-details-delete-movie" data-csv-id="${movie.csv_id}" style="width: 100%; min-height: 44px; border-color: rgba(255, 59, 48, 0.4); color: #ff3b30; background: rgba(255, 59, 48, 0.05); cursor: pointer; padding: 12px; font-weight: 600; border-radius: 6px; transition: all 0.3s; display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;">
                Delete Title 🗑️
            </button>
        </div>
    `;
    
    // Links Editor logic binding
    const editToggle = document.getElementById("btn-edit-links-toggle");
    const viewContainer = document.getElementById("links-view-container");
    const editContainer = document.getElementById("links-edit-container");
    const inputsWrapper = document.getElementById("links-inputs-wrapper");
    
    let currentLinks = [...linksList];
    let currentEditStreams = currentStreams.length > 0 
        ? JSON.parse(JSON.stringify(currentStreams)) 
        : [isSeries ? { episode: 1, season: 1, stream_url: "" } : { quality: "720p", stream_url: "" }];

    // Auto-extract TMDB ID and Type on pasting in Edit modal
    const editMovieIdInput = document.getElementById("edit-movie-id");
    if (editMovieIdInput) {
        editMovieIdInput.addEventListener("input", () => {
            const parsed = extractTmdbIdAndType(editMovieIdInput.value);
            if (parsed) {
                editMovieIdInput.value = parsed.id;
                const typeSelect = document.getElementById("edit-movie-type");
                if (typeSelect) {
                    typeSelect.value = parsed.type;
                    renderLinkInputs();
                }
            }
        });
    }

    // Auto-detect categories inside Edit Details modal
    const btnEditAutoCats = document.getElementById("btn-edit-auto-cats");
    if (btnEditAutoCats) {
        btnEditAutoCats.addEventListener("click", async () => {
            btnEditAutoCats.disabled = true;
            btnEditAutoCats.textContent = "Detecting... ⏳";
            const currentTitle = (document.getElementById("edit-movie-title")?.value.trim()) || movie.title || "";
            const currentId = (document.getElementById("edit-movie-id")?.value.trim()) || movie.csv_id || movie.tmdb_id || "";
            const currentType = (document.getElementById("edit-movie-type")?.value) || movie.type || "Movie";
            const detected = await autoFetchAndCheckCategories(currentId, currentType, currentTitle, ".edit-cat-checkbox");
            btnEditAutoCats.disabled = false;
            btnEditAutoCats.textContent = "⚡ Auto-Detect";
            if (detected && detected.length > 0) {
                showToast(`Auto-detected: ${detected.join(', ')}`, "success");
            } else {
                showToast("Could not auto-detect additional categories for this title", "info");
            }
        });
    }

    function renderLinkInputs() {
        inputsWrapper.innerHTML = "";
        const isSeriesMovie = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';

        currentLinks.forEach((link, idx) => {
            const urlVal = typeof link === 'object' && link !== null ? link.url : link;
            const qualityVal = typeof link === 'object' && link !== null && link.quality ? link.quality : "720p";
            const seasonLabel = `Season ${idx + 1}`;
            
            const wrapper = document.createElement("div");
            wrapper.style.display = "flex";
            wrapper.style.gap = "8px";
            wrapper.style.alignItems = "center";
            wrapper.style.marginBottom = "8px";
            
            const labelSpan = document.createElement("span");
            labelSpan.style.cssText = isSeriesMovie ? "font-size: 11px; color: #ffbc00; font-weight: 700; width: 120px; flex-shrink: 0;" : "font-size: 11px; color: var(--text-secondary); font-weight: 700; width: 45px; flex-shrink: 0;";
            labelSpan.textContent = isSeriesMovie ? `Link ${idx + 1} (${seasonLabel}):` : `Link ${idx + 1}:`;
            wrapper.appendChild(labelSpan);

            const input = document.createElement("input");
            input.type = "text";
            input.className = "form-control";
            input.style.fontSize = "12px";
            input.style.padding = "6px 8px";
            input.style.flex = "1";
            input.style.background = "var(--input-bg)";
            input.style.border = "1px solid var(--border-color)";
            input.style.color = "#fff";
            input.style.borderRadius = "4px";
            input.value = urlVal || "";
            input.placeholder = isSeriesMovie ? `Telegram URL for ${seasonLabel}...` : `Telegram Link ${idx + 1}...`;
            input.addEventListener("input", (e) => {
                if (typeof currentLinks[idx] !== 'object' || currentLinks[idx] === null) {
                    currentLinks[idx] = isSeriesMovie ? { url: e.target.value.trim(), season: seasonLabel } : { url: e.target.value.trim(), quality: "720p" };
                } else {
                    currentLinks[idx].url = e.target.value.trim();
                    if (isSeriesMovie) currentLinks[idx].season = seasonLabel;
                }
            });
            wrapper.appendChild(input);

            if (!isSeriesMovie) {
                const select = document.createElement("select");
                select.style.padding = "6px";
                select.style.background = "var(--input-bg)";
                select.style.border = "1px solid var(--border-color)";
                select.style.color = "#fff";
                select.style.borderRadius = "4px";
                select.style.fontSize = "11px";
                select.style.width = "95px";
                select.style.cursor = "pointer";
                
                const options = ["480p", "720p", "1080p", "2160p (4K)", "Cinema Cut / HDCam"];
                options.forEach(opt => {
                    const o = document.createElement("option");
                    o.value = opt;
                    o.textContent = opt;
                    if (opt === qualityVal || (opt === "Cinema Cut / HDCam" && (qualityVal === "Cinema Cut" || qualityVal === "HDCam"))) o.selected = true;
                    select.appendChild(o);
                });
                
                select.addEventListener("change", (e) => {
                    if (typeof currentLinks[idx] !== 'object' || currentLinks[idx] === null) {
                        currentLinks[idx] = { url: "", quality: e.target.value };
                    } else {
                        currentLinks[idx].quality = e.target.value;
                    }
                });
                wrapper.appendChild(select);
            }
            
            const removeBtn = document.createElement("button");
            removeBtn.className = "btn btn-secondary";
            removeBtn.style.padding = "6px 10px";
            removeBtn.style.color = "#ff3b30";
            removeBtn.style.borderColor = "rgba(255, 59, 48, 0.25)";
            removeBtn.style.background = "rgba(255, 59, 48, 0.05)";
            removeBtn.style.cursor = "pointer";
            removeBtn.textContent = "✖";
            removeBtn.addEventListener("click", () => {
                currentLinks.splice(idx, 1);
                renderLinkInputs();
            });
            
            wrapper.appendChild(removeBtn);
            inputsWrapper.appendChild(wrapper);
        });
    }

    // Bind Copy Stream Token buttons in read-only view
    function bindCopyTokenButtons() {
        document.querySelectorAll(".btn-copy-stream-token").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const token = btn.getAttribute("data-token");
                if (token && navigator.clipboard) {
                    navigator.clipboard.writeText(token);
                    const orig = btn.textContent;
                    btn.textContent = "✓ Copied!";
                    setTimeout(() => { btn.textContent = orig; }, 1500);
                }
            };
        });
    }
    bindCopyTokenButtons();

    // Quick Streams Drawer in Read-Only View (Instant Save without Edit mode)
    const quickStreamsToggle = document.getElementById("btn-quick-streams-toggle");
    const quickStreamsDrawer = document.getElementById("details-quick-streams-drawer");
    const quickStreamsInput = document.getElementById("details-quick-streams-input");
    const quickStreamsCancel = document.getElementById("btn-quick-streams-cancel");
    const quickStreamsSave = document.getElementById("btn-save-quick-streams");

    if (quickStreamsToggle && quickStreamsDrawer) {
        quickStreamsToggle.addEventListener("click", () => {
            const isHidden = quickStreamsDrawer.style.display === "none";
            quickStreamsDrawer.style.display = isHidden ? "block" : "none";
            quickStreamsToggle.textContent = isHidden ? "✕ Close Quick Drawer" : "⚡ Quick Add / Update Streams";
            if (isHidden && quickStreamsInput) quickStreamsInput.focus();
        });
    }

    if (quickStreamsCancel && quickStreamsDrawer) {
        quickStreamsCancel.addEventListener("click", () => {
            quickStreamsDrawer.style.display = "none";
            if (quickStreamsToggle) quickStreamsToggle.textContent = "⚡ Quick Add / Update Streams";
        });
    }

    if (quickStreamsSave && quickStreamsInput) {
        quickStreamsSave.addEventListener("click", () => {
            const isCurrentSeries = (movie.type || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'tv';
            const parsed = parseBulkStreams(quickStreamsInput.value, isCurrentSeries);
            if (parsed.length === 0) {
                alert("Please paste at least one valid stream token or URL!");
                return;
            }

            const movieIndex = allCatalogMovies.findIndex(m => m.csv_id === movie.csv_id);
            if (movieIndex === -1) {
                alert("Error: Title not found in catalog.");
                return;
            }

            const formattedStreams = parsed.map((s, idx) => {
                const u = cleanStreamInput(s.url || s.stream_url);
                if (isCurrentSeries) {
                    return { episode: s.episode || (idx + 1), season: 1, stream_url: u, url: u };
                }
                return { quality: s.quality || '720p', stream_url: u, url: u };
            });

            allCatalogMovies[movieIndex].stream_links = formattedStreams;
            allCatalogMovies[movieIndex].stream_url = formattedStreams[0].stream_url;
            if (allCatalogMovies[movieIndex].links && allCatalogMovies[movieIndex].links.length > 0) {
                allCatalogMovies[movieIndex].links[0].stream_url = formattedStreams[0].stream_url;
            }

            const currentId = allCatalogMovies[movieIndex].csv_id;
            if (!newlyUpdatedIds.includes(currentId) && !newlyAddedIds.includes(currentId)) {
                newlyUpdatedIds.push(currentId);
            }

            currentStreams = [...formattedStreams];
            currentEditStreams = JSON.parse(JSON.stringify(formattedStreams));

            catalogChangesMade = true;
            renderCatalogList();
            updatePublishButtonState();

            // Refresh read-only list & badge
            const viewList = document.getElementById("details-streams-view-list");
            if (viewList) {
                viewList.innerHTML = renderDetailsStreamsReadOnlyHTML(currentStreams, allCatalogMovies[movieIndex], isCurrentSeries);
            }
            const statusBadge = document.getElementById("details-streaming-status-badge");
            if (statusBadge) {
                statusBadge.textContent = isCurrentSeries ? `🟢 ${currentStreams.length} Episode Stream(s) Ready` : `🟢 Stream Active (${currentStreams.length} Qualities)`;
                statusBadge.style.cssText = "font-size: 10px; color: #4cd964; background: rgba(76, 217, 100, 0.15); border: 1px solid rgba(76, 217, 100, 0.3); font-weight: 700; padding: 2px 8px; border-radius: 10px;";
            }

            bindCopyTokenButtons();
            quickStreamsDrawer.style.display = "none";
            if (quickStreamsToggle) quickStreamsToggle.textContent = "⚡ Quick Add / Update Streams";
            quickStreamsInput.value = "";

            if (typeof showToast === 'function') {
                showToast(`🎉 Attached ${formattedStreams.length} stream links to "${allCatalogMovies[movieIndex].title}"!`, "success");
            } else {
                alert(`🎉 Attached ${formattedStreams.length} stream links to "${allCatalogMovies[movieIndex].title}"! Click 'Publish Changes 🚀' to save to GitHub.`);
            }
        });
    }

    // Dynamic Stream inputs editor in Edit View
    function renderDetailsStreamInputs() {
        const wrapper = document.getElementById("details-streams-inputs-wrapper");
        const counter = document.getElementById("details-streams-counter");
        if (!wrapper) return;
        wrapper.innerHTML = "";

        const isCurrentSeries = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';

        if (counter) {
            const validCount = currentEditStreams.filter(s => (s.stream_url || s.url || '').trim().length > 0).length;
            counter.textContent = `${validCount} stream${validCount === 1 ? '' : 's'} attached`;
        }

        currentEditStreams.forEach((item, idx) => {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.gap = "8px";
            row.style.alignItems = "center";
            row.style.background = "rgba(0,0,0,0.2)";
            row.style.padding = "6px 8px";
            row.style.borderRadius = "4px";
            row.style.border = "1px solid rgba(255,255,255,0.05)";

            if (isCurrentSeries) {
                const epLabel = document.createElement("span");
                epLabel.style.cssText = "font-size: 11px; color: #ffbc00; font-weight: 700; width: 55px; flex-shrink: 0;";
                epLabel.textContent = `Ep ${item.episode || (idx + 1)}:`;
                row.appendChild(epLabel);
            } else {
                const select = document.createElement("select");
                select.style.padding = "5px 6px";
                select.style.background = "var(--input-bg)";
                select.style.border = "1px solid var(--border-color)";
                select.style.color = "#fff";
                select.style.borderRadius = "4px";
                select.style.fontSize = "11px";
                select.style.width = "95px";
                select.style.cursor = "pointer";

                const qualities = ["480p", "720p", "1080p", "2160p (4K)", "Cinema Cut / HDCam"];
                qualities.forEach(q => {
                    const opt = document.createElement("option");
                    opt.value = q;
                    opt.textContent = q;
                    if (q === item.quality) opt.selected = true;
                    select.appendChild(opt);
                });
                select.addEventListener("change", (e) => {
                    currentEditStreams[idx].quality = e.target.value;
                });
                row.appendChild(select);
            }

            const input = document.createElement("input");
            input.type = "text";
            input.style.flex = "1";
            input.style.padding = "6px 8px";
            input.style.background = "var(--input-bg)";
            input.style.border = "1px solid var(--border-color)";
            input.style.color = "#fff";
            input.style.borderRadius = "4px";
            input.style.fontSize = "12px";
            input.style.fontFamily = "monospace";
            input.value = item.stream_url || item.url || "";
            input.placeholder = isCurrentSeries ? `Paste token or FileStream link for Ep ${item.episode || (idx + 1)}...` : `Paste token or FileStream link (${item.quality || '720p'})...`;
            
            const currentTokenVal = cleanStreamInput(input.value.trim());

            // Test link
            const testLink = document.createElement("a");
            testLink.textContent = "▶️";
            testLink.title = "Test Stream Player";
            testLink.target = "_blank";
            testLink.style.cssText = "font-size: 11px; text-decoration: none; padding: 4px 8px; border: 1px solid rgba(255, 188, 0, 0.35); border-radius: 4px; color: #ffbc00; background: rgba(255, 188, 0, 0.08); cursor: pointer; flex-shrink: 0;";
            testLink.href = currentTokenVal ? `https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(currentTokenVal)}&title=${encodeURIComponent(movie.title)}${isCurrentSeries ? `&ep=${item.episode || (idx + 1)}` : ''}` : '#';
            if (!currentTokenVal) testLink.style.opacity = "0.4";

            input.addEventListener("input", (e) => {
                const cleaned = cleanStreamInput(e.target.value.trim());
                currentEditStreams[idx].stream_url = cleaned;
                currentEditStreams[idx].url = cleaned;
                if (cleaned) {
                    testLink.href = `https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(cleaned)}&title=${encodeURIComponent(movie.title)}${isCurrentSeries ? `&ep=${item.episode || (idx + 1)}` : ''}`;
                    testLink.style.opacity = "1";
                } else {
                    testLink.href = '#';
                    testLink.style.opacity = "0.4";
                }
                if (counter) {
                    const validCount = currentEditStreams.filter(s => (s.stream_url || s.url || '').trim().length > 0).length;
                    counter.textContent = `${validCount} stream${validCount === 1 ? '' : 's'} attached`;
                }
            });
            row.appendChild(input);
            row.appendChild(testLink);

            // Remove button
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.textContent = "✖";
            removeBtn.style.cssText = "padding: 4px 8px; font-size: 11px; color: #ff3b30; border: 1px solid rgba(255, 59, 48, 0.25); background: rgba(255, 59, 48, 0.05); border-radius: 4px; cursor: pointer; flex-shrink: 0;";
            removeBtn.addEventListener("click", () => {
                currentEditStreams.splice(idx, 1);
                if (currentEditStreams.length === 0) {
                    currentEditStreams.push(isCurrentSeries ? { episode: 1, season: 1, stream_url: "" } : { quality: "720p", stream_url: "" });
                }
                renderDetailsStreamInputs();
            });
            row.appendChild(removeBtn);

            wrapper.appendChild(row);
        });
    }

    // Add Stream row button in Edit mode
    const btnAddDetailsStream = document.getElementById("btn-add-details-stream-input");
    if (btnAddDetailsStream) {
        btnAddDetailsStream.addEventListener("click", () => {
            const isCurrentSeries = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';
            const nextEp = currentEditStreams.length + 1;
            currentEditStreams.push(isCurrentSeries ? { episode: nextEp, season: 1, stream_url: "" } : { quality: "720p", stream_url: "" });
            renderDetailsStreamInputs();
        });
    }

    // Bulk paste streams toggle and apply in Edit mode
    const detailsBulkStreamsToggle = document.getElementById("btn-details-bulk-streams-toggle");
    const detailsBulkStreamsWrapper = document.getElementById("details-bulk-streams-wrapper");
    const detailsBulkStreamsInput = document.getElementById("details-bulk-streams-input");
    const detailsBulkStreamsApply = document.getElementById("btn-apply-details-bulk-streams");

    if (detailsBulkStreamsToggle && detailsBulkStreamsWrapper) {
        detailsBulkStreamsToggle.addEventListener("click", () => {
            const isHidden = detailsBulkStreamsWrapper.style.display === "none";
            detailsBulkStreamsWrapper.style.display = isHidden ? "block" : "none";
            detailsBulkStreamsToggle.textContent = isHidden ? "✕ Close Bulk" : "📋 Bulk Paste";
            if (isHidden && detailsBulkStreamsInput) detailsBulkStreamsInput.focus();
        });
    }

    if (detailsBulkStreamsApply && detailsBulkStreamsInput) {
        detailsBulkStreamsApply.addEventListener("click", () => {
            const isCurrentSeries = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';
            const parsed = parseBulkStreams(detailsBulkStreamsInput.value, isCurrentSeries);
            if (parsed.length === 0) {
                alert("Please paste at least one valid stream token or URL!");
                return;
            }
            currentEditStreams = parsed.map((s, idx) => {
                const u = cleanStreamInput(s.url || s.stream_url);
                if (isCurrentSeries) {
                    return { episode: s.episode || (idx + 1), season: 1, stream_url: u, url: u };
                }
                return { quality: s.quality || '720p', stream_url: u, url: u };
            });
            renderDetailsStreamInputs();
            detailsBulkStreamsInput.value = "";
            if (detailsBulkStreamsWrapper) detailsBulkStreamsWrapper.style.display = "none";
            if (detailsBulkStreamsToggle) detailsBulkStreamsToggle.textContent = "📋 Bulk Paste";
        });
    }

    // Auto-slots button in Edit mode
    const btnDetailsAutoSlots = document.getElementById("btn-details-auto-slots");
    if (btnDetailsAutoSlots) {
        btnDetailsAutoSlots.addEventListener("click", () => {
            const isCurrentSeries = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';
            if (isCurrentSeries) {
                const suggestedCount = Math.max(currentLinks.length, currentEditStreams.length, 10);
                const countPrompt = prompt("How many episode slots would you like to generate?", suggestedCount);
                if (!countPrompt) return;
                const totalEps = parseInt(countPrompt, 10);
                if (isNaN(totalEps) || totalEps <= 0) {
                    alert("Please enter a valid positive number.");
                    return;
                }
                const newSlots = [];
                for (let ep = 1; ep <= totalEps; ep++) {
                    const existing = currentEditStreams.find(s => s.episode === ep);
                    newSlots.push({
                        episode: ep,
                        season: 1,
                        stream_url: existing ? existing.stream_url : "",
                        url: existing ? existing.stream_url : ""
                    });
                }
                currentEditStreams = newSlots;
                renderDetailsStreamInputs();
            } else {
                const defaultQualities = ["480p", "720p", "1080p", "2160p (4K)", "Cinema Cut / HDCam"];
                currentEditStreams = defaultQualities.map(q => {
                    const existing = currentEditStreams.find(s => s.quality === q);
                    return {
                        quality: q,
                        stream_url: existing ? existing.stream_url : "",
                        url: existing ? existing.stream_url : ""
                    };
                });
                renderDetailsStreamInputs();
            }
        });
    }

    if (editToggle && viewContainer && editContainer) {
        editToggle.addEventListener("click", () => {
            const editInfoContainer = document.getElementById("details-title-info-edit");
            const viewInfoContainer = document.getElementById("details-title-info-view");
            if (editContainer.style.display === "none") {
                editContainer.style.display = "block";
                viewContainer.style.display = "none";
                if (editInfoContainer) editInfoContainer.style.display = "flex";
                if (viewInfoContainer) viewInfoContainer.style.display = "none";
                editToggle.textContent = "Cancel";
                renderLinkInputs();
                renderDetailsStreamInputs();
            } else {
                editContainer.style.display = "none";
                viewContainer.style.display = "block";
                if (editInfoContainer) editInfoContainer.style.display = "none";
                if (viewInfoContainer) viewInfoContainer.style.display = "flex";
                editToggle.textContent = "Edit Details";
            }
        });
    }

    const btnAddLink = document.getElementById("btn-add-link-input");
    if (btnAddLink) {
        btnAddLink.addEventListener("click", () => {
            const isSeriesMovie = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';
            const nextSeason = `Season ${currentLinks.length + 1}`;
            currentLinks.push(isSeriesMovie ? { url: "", season: nextSeason } : { url: "", quality: "720p" });
            renderLinkInputs();
        });
    }

    const detailsBulkToggle = document.getElementById("btn-details-bulk-links-toggle");
    const detailsBulkWrapper = document.getElementById("details-bulk-links-wrapper");
    const detailsBulkInput = document.getElementById("details-bulk-links-input");
    const detailsBulkApply = document.getElementById("btn-apply-details-bulk-links");

    if (detailsBulkToggle && detailsBulkWrapper) {
        detailsBulkToggle.addEventListener("click", () => {
            const isHidden = detailsBulkWrapper.style.display === "none";
            detailsBulkWrapper.style.display = isHidden ? "block" : "none";
            detailsBulkToggle.textContent = isHidden ? "✕ Close Bulk" : "📋 Bulk Paste";
            if (isHidden && detailsBulkInput) detailsBulkInput.focus();
        });
    }

    if (detailsBulkApply && detailsBulkInput) {
        detailsBulkApply.addEventListener("click", () => {
            const isSeriesType = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';
            const parsed = parseBulkLinks(detailsBulkInput.value, isSeriesType);
            if (parsed.length === 0) {
                alert("Please paste at least one valid link!");
                return;
            }
            currentLinks = parsed;
            renderLinkInputs();
            detailsBulkInput.value = "";
            if (detailsBulkWrapper) detailsBulkWrapper.style.display = "none";
            if (detailsBulkToggle) detailsBulkToggle.textContent = "📋 Bulk Paste";
        });
    }

    const editTypeSelect = document.getElementById("edit-movie-type");
    if (editTypeSelect) {
        editTypeSelect.addEventListener("change", () => {
            renderLinkInputs();
            renderDetailsStreamInputs();
        });
    }

    const saveLinksBtn = document.getElementById("btn-save-links-changes");
    if (saveLinksBtn) {
        saveLinksBtn.addEventListener("click", () => {
            const isSeriesType = (document.getElementById("edit-movie-type")?.value || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'series';
            const finalLinks = currentLinks.filter(l => {
                const urlVal = typeof l === 'object' && l !== null ? l.url : l;
                return urlVal && urlVal.trim() !== "";
            }).map((l, idx) => {
                const urlVal = typeof l === 'object' && l !== null ? l.url : l;
                if (isSeriesType) {
                    return { url: urlVal, season: `Season ${idx + 1}` };
                }
                const qualityVal = typeof l === 'object' && l !== null && l.quality ? l.quality : "720p";
                return { url: urlVal, quality: qualityVal };
            });

            // Parse valid streams from currentEditStreams
            const finalStreams = currentEditStreams.filter(s => {
                const u = (s.stream_url || s.url || '').trim();
                return u.length > 0;
            }).map((s, idx) => {
                const u = cleanStreamInput(s.stream_url || s.url);
                if (isSeriesType) {
                    return { episode: s.episode || (idx + 1), season: 1, stream_url: u, url: u };
                }
                return { quality: s.quality || '720p', stream_url: u, url: u };
            });
            const cleanStreamVal = finalStreams.length > 0 ? finalStreams[0].stream_url : "";
            
            const newTitle = document.getElementById("edit-movie-title")?.value.trim();
            const newId = document.getElementById("edit-movie-id")?.value.trim();
            const newType = document.getElementById("edit-movie-type")?.value;
            const newPoster = document.getElementById("edit-movie-poster")?.value.trim();
            const newBackdrop = document.getElementById("edit-movie-backdrop")?.value.trim();
            const newOverview = document.getElementById("edit-movie-overview")?.value.trim() || "";
            const newTrailerVal = document.getElementById("edit-movie-trailer")?.value.trim() || "";
            const newTrailerId = extractYoutubeId(newTrailerVal);
            const newReleaseDate = document.getElementById("edit-movie-release-date")?.value.trim() || "";
            
            // Get selected categories
            const newCategories = Array.from(document.querySelectorAll(".edit-cat-checkbox:checked")).map(cb => cb.value);
            
            if (!newTitle || !newId) {
                alert("Error: Title and TMDB ID / Slug cannot be empty!");
                return;
            }
            
            const movieIndex = allCatalogMovies.findIndex(m => m.csv_id === movie.csv_id);
            if (movieIndex !== -1) {
                const prevId = allCatalogMovies[movieIndex].csv_id;
                
                allCatalogMovies[movieIndex].title = newTitle;
                allCatalogMovies[movieIndex].csv_id = newId;
                allCatalogMovies[movieIndex].type = newType === 'Series' ? 'Series' : 'Movie';
                allCatalogMovies[movieIndex].links = finalLinks;
                allCatalogMovies[movieIndex].stream_links = finalStreams;
                allCatalogMovies[movieIndex].stream_url = cleanStreamVal;
                if (cleanStreamVal && allCatalogMovies[movieIndex].links && allCatalogMovies[movieIndex].links.length > 0) {
                    allCatalogMovies[movieIndex].links[0].stream_url = cleanStreamVal;
                }
                allCatalogMovies[movieIndex].poster = newPoster || "img/FilmHouse3_nobg.png";
                allCatalogMovies[movieIndex].backdrop = newBackdrop || "img/FilmHouse.png";
                allCatalogMovies[movieIndex].overview = newOverview || "No synopsis available.";
                allCatalogMovies[movieIndex].trailer = newTrailerId;
                allCatalogMovies[movieIndex].release_date = newReleaseDate;
                allCatalogMovies[movieIndex].categories = newCategories.length > 0 ? newCategories : ["Main"];
                
                // Update dynamic TMDB numeric ID mapping if ID changed
                const numericId = newId.split("-")[0];
                if (numericId && /^\d+$/.test(numericId)) {
                    allCatalogMovies[movieIndex].tmdb_id = parseInt(numericId);
                }
                
                if (prevId !== newId) {
                    if (newlyAddedIds.includes(prevId)) {
                        newlyAddedIds = newlyAddedIds.filter(id => id !== prevId);
                        newlyAddedIds.push(newId);
                    }
                    if (newlyUpdatedIds.includes(prevId)) {
                        newlyUpdatedIds = newlyUpdatedIds.filter(id => id !== prevId);
                        newlyUpdatedIds.push(newId);
                    } else if (!newlyUpdatedIds.includes(newId)) {
                        newlyUpdatedIds.push(newId);
                    }
                } else {
                    if (!newlyUpdatedIds.includes(newId) && !newlyAddedIds.includes(newId)) {
                        newlyUpdatedIds.push(newId);
                    }
                }
                
                catalogChangesMade = true;
                renderCatalogList();
                updatePublishButtonState();
                
                alert("Title details updated locally! Click 'Publish Changes 🚀' in the header to save them to GitHub.");
                movieDetailsModal.classList.remove("active");
            } else {
                alert("Error: Title not found in catalog.");
            }
        });
    }

    // Bind Delete inside details modal (Confirm Delete state)
    const deleteBtn = document.getElementById("btn-details-delete-movie");
    if (deleteBtn) {
        let deleteTimeout = null;
        deleteBtn.addEventListener("click", () => {
            const csvId = deleteBtn.getAttribute("data-csv-id");
            if (deleteBtn.classList.contains("confirming")) {
                if (deleteTimeout) clearTimeout(deleteTimeout);
                movieDetailsModal.classList.remove("active");
                deleteMovie(csvId);
            } else {
                deleteBtn.classList.add("confirming");
                deleteBtn.textContent = "Confirm Delete? ⚠️";
                deleteBtn.style.backgroundColor = "#ff3b30";
                deleteBtn.style.color = "#ffffff";
                
                deleteTimeout = setTimeout(() => {
                    deleteBtn.classList.remove("confirming");
                    deleteBtn.textContent = "Delete Title 🗑️";
                    deleteBtn.style.backgroundColor = "rgba(255, 59, 48, 0.05)";
                    deleteBtn.style.color = "#ff3b30";
                }, 3000);
            }
        });
    }

    // Bind Post to Channel inside details modal
    const postChannelBtn = document.getElementById("btn-details-post-channel");
    if (postChannelBtn) {
        postChannelBtn.addEventListener("click", async () => {
            postChannelBtn.disabled = true;
            postChannelBtn.textContent = "Posting to Channel... ⏳";
            try {
                const isSeries = (movie.type || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'tv';
                const customEdition = document.getElementById("details-channel-custom-edition")?.value.trim();
                const selectEdition = document.getElementById("details-channel-edition-select")?.value;
                const chosenEdition = customEdition || selectEdition || (isSeries ? "Complete Series" : "");
                const chosenMode = document.querySelector('input[name="details-channel-mode"]:checked')?.value || (isSeries ? "updated" : "released");

                await window.broadcastMovieToMainChannel({
                    ...movie,
                    seasonOrPart: chosenEdition,
                    broadcastMode: chosenMode,
                    forceBroadcast: true
                });
            } catch (e) {
                showToast("Failed to post to channel: " + e.message, "error");
            } finally {
                postChannelBtn.disabled = false;
                postChannelBtn.textContent = "📢 Post Announcement to Channel";
            }
        });
    }
    
    movieDetailsModal.classList.add("active");
}

function renderCatalogList() {
    const listContainer = document.getElementById("catalog-list");
    if (!listContainer) return;

    listContainer.replaceChildren();

    const searchQuery = (document.getElementById("catalog-search-input")?.value || "").toLowerCase().trim();
    const cleanCatQ = normalizeTitleForComparison(searchQuery);
    const colCatQ = getCollapsedTitle(searchQuery);
    const filtered = allCatalogMovies.filter(m => {
        if (!searchQuery) return true;
        const title = (m.title || "").toLowerCase();
        const id = (m.csv_id || "").toLowerCase();
        const type = (m.type || "").toLowerCase();
        if (title.includes(searchQuery) || id.includes(searchQuery) || type.includes(searchQuery)) return true;
        const normTitle = normalizeTitleForComparison(title);
        const colTitle = getCollapsedTitle(title);
        if (colCatQ && colTitle && colTitle.includes(colCatQ)) return true;
        if (cleanCatQ && normTitle && normTitle.includes(cleanCatQ)) return true;
        return false;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">No matching movies in catalog.</div>`;
        return;
    }

    filtered.forEach(m => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.style.cursor = "pointer";
        
        const posterUrl = getPosterUrl(m.poster);
        const badgeColor = (m.type || "").toLowerCase() === 'series' || (m.type || "").toLowerCase() === 'tv' ? 'var(--primary-color)' : '#00bcd4';
        
        let diffBadge = "";
        if (newlyAddedIds.includes(m.csv_id)) {
            diffBadge = `<span style="font-size: 9px; background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 700;">NEW Addition</span>`;
        } else if (newlyUpdatedIds.includes(m.csv_id)) {
            diffBadge = `<span style="font-size: 9px; background: rgba(33, 150, 243, 0.15); border: 1px solid rgba(33, 150, 243, 0.3); color: #2196f3; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 700;">UPDATED Links</span>`;
        }

        const hasCinemaCut = m.links && Array.isArray(m.links) && m.links.some(l => {
            const q = (typeof l === 'object' && l !== null ? (l.quality || "") : "").toLowerCase();
            return q.includes("cinema cut") || q.includes("hdcam") || q.includes("cam");
        });
        const cinemaCutBadge = hasCinemaCut ? `<span style="font-size: 9px; background: linear-gradient(135deg, rgba(255, 152, 0, 0.2), rgba(255, 87, 34, 0.2)); border: 1px solid rgba(255, 152, 0, 0.4); color: #ff9800; padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: 800;">📽️ Cinema Cut</span>` : "";

        const streamsCount = (Array.isArray(m.stream_links) && m.stream_links.length > 0) 
            ? m.stream_links.length 
            : (m.stream_url || (m.links && m.links[0] && m.links[0].stream_url) ? 1 : 0);
        const streamBadge = streamsCount > 0 
            ? `<span class="breakdown-tag" style="color: #4cd964; border-color: rgba(76, 217, 100, 0.3); background: rgba(76, 217, 100, 0.1);">▶️ Stream: ${streamsCount}</span>` 
            : `<span class="breakdown-tag" style="color: var(--text-muted); opacity: 0.65;">▶️ No Stream</span>`;

        row.innerHTML = `
            <div class="user-info" style="pointer-events: none;">
                <img src="${escapeHTML(posterUrl)}" alt="Poster" class="user-avatar" style="border-radius: 4px; object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                <div class="user-details">
                    <h5>${escapeHTML(m.title)} ${diffBadge} ${cinemaCutBadge}</h5>
                    <p>ID: ${escapeHTML(m.csv_id)} | Type: <span style="text-transform: uppercase; font-weight: 600; color: ${badgeColor};">${escapeHTML(m.type)}</span></p>
                    <div class="breakdown-group">
                        <span class="breakdown-tag">🔗 Links: ${m.links ? m.links.length : 0}</span>
                        ${streamBadge}
                        ${m.rating ? `<span class="breakdown-tag">⭐ ${escapeHTML(m.rating)}</span>` : ''}
                        ${m.release_date ? `<span class="breakdown-tag">📅 ${escapeHTML(m.release_date)}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="user-stats" style="pointer-events: none;">
                <span style="font-size: 11px; color: var(--text-secondary);">View Details ➔</span>
            </div>
        `;
        
        row.addEventListener("click", () => {
            showMovieDetails(m);
        });
        
        listContainer.appendChild(row);
    });
    
    // Automatically keep the requests list in sync with catalog changes
    renderRequestsList();
}

function deleteMovie(csvId) {
    allCatalogMovies = allCatalogMovies.filter(m => m.csv_id !== csvId);
    if (!newlyDeletedIds.includes(csvId)) {
        newlyDeletedIds.push(csvId);
    }
    // Also remove from local additions and updates to prevent redundant writes
    newlyAddedIds = newlyAddedIds.filter(id => id !== csvId);
    newlyUpdatedIds = newlyUpdatedIds.filter(id => id !== csvId);
    
    catalogChangesMade = true;
    updatePublishButtonState();
    renderCatalogList();
}

function updatePublishButtonState() {
    const publishBtn = document.getElementById("btn-publish-catalog");
    if (publishBtn) {
        if (catalogChangesMade) {
            publishBtn.style.display = "inline-flex";
        const quickPub = document.getElementById("quick-bar-publish-btn"); if (quickPub) quickPub.style.display = "flex";
            // Save draft locally
            localStorage.setItem("filmhouse_unpublished_catalog", JSON.stringify({
                allCatalogMovies,
                newlyAddedIds,
                newlyUpdatedIds,
                newlyDeletedIds
            }));
        } else {
            publishBtn.style.display = "none";
        const quickPub = document.getElementById("quick-bar-publish-btn"); if (quickPub) quickPub.style.display = "none";
            localStorage.removeItem("filmhouse_unpublished_catalog");
        }
    }
}

// Search Catalog Input
const catalogSearchInput = document.getElementById("catalog-search-input");
if (catalogSearchInput) {
    catalogSearchInput.addEventListener("input", createAdminDebounce(renderCatalogList, 200));
}

// Helper to accurately auto-categorize titles for Movies & Series (Christian category is manual-only)
function determineAutoCategories(data, title, type) {
    const isSeries = (type || "").toLowerCase() === 'series' || (type || "").toLowerCase() === 'tv';
    const categories = ["Main"];
    const titleLower = (title || "").toLowerCase();
    const overviewLower = (data && data.overview ? data.overview : "").toLowerCase();
    const origLang = (data && data.original_language ? data.original_language : "en").toLowerCase();
    const tmdbGenres = data && data.genres ? data.genres.map(g => (typeof g === 'string' ? g : g.name || "").toLowerCase()) : [];
    
    // 1. African
    const africanCountries = ["NG", "ZA", "GH", "KE", "EG", "TZ", "UG", "MA", "DZ", "ET", "RW"];
    const isAfricanCountry = data && ((data.origin_country && data.origin_country.some(c => africanCountries.includes(c))) ||
                             (data.production_countries && data.production_countries.some(c => africanCountries.includes(c.iso_3166_1))));
    const africanKeywords = ["yolo", "blood and water", "blood & water", "supacell", "nollywood", "ghallywood", "anikulapo", "king of boys", "jagun jagun", "african", "nigeria", "ghana", "south africa", "kenya"];
    if (isAfricanCountry || africanKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k))) {
        categories.push("African");
    }

    // Anime & Animated Movies Detection (Evaluated first to strictly exclude from live-action regional categories)
    const isJP = (origLang === 'ja') || (data && ((data.origin_country && data.origin_country.includes('JP')) ||
                 (data.production_countries && data.production_countries.some(c => c.iso_3166_1 === 'JP'))));
    const isAnimation = tmdbGenres.includes("animation") || titleLower.includes("anime") || titleLower.includes("animated") || overviewLower.includes("anime");
    
    const animeKeywords = [
        "castlevania", "arcane", "avatar: the last airbender", "avatar the last airbender",
        "legend of korra", "cyberpunk: edgerunners", "cyberpunk edgerunners", "blue eye samurai",
        "anime", "solo leveling", "jujutsu kaisen", "demon slayer", "kimetsu no yaiba",
        "attack on titan", "shingeki no kyojin", "naruto", "boruto", "one piece", "bleach",
        "dragon ball", "death note", "my hero academia", "boku no hero", "hunter x hunter",
        "fullmetal alchemist", "chainsaw man", "tokyo ghoul", "black clover", "vinland saga",
        "sword art online", "tokyo revengers", "spy x family", "mob psycho", "one punch man",
        "haikyu", "dr. stone", "fairy tail", "code geass", "cowboy bebop", "berserk",
        "dandadan", "kaiju no. 8", "hell's paradise", "jojo", "inuyasha", "overlord",
        "re:zero", "violet evergarden", "fate/stay", "fate/zero", "neon genesis evangelion",
        "steins;gate", "yu-gi-oh", "pokemon", "digimon", "sailor moon"
    ];
    const isAnimeMatch = (isJP && isAnimation) || animeKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k));

    if (isAnimeMatch) {
        if (isSeries) {
            categories.push("Anime Series");
        } else {
            categories.push("Anime Movies");
            categories.push("Animated Movies");
        }
    } else if (isAnimation) {
        categories.push("Animated Movies");
    }

    // 2. Asian / Korean (Korean Drama for Series, Korean Movies for Movies - live action only, never anime)
    const asianCountryCodes = ["KR", "CN", "HK", "TW", "TR", "TH", "ID", "VN", "JP", "PH"];
    const isAsianCountry = data && ((data.origin_country && data.origin_country.some(c => asianCountryCodes.includes(c))) ||
                           (data.production_countries && data.production_countries.some(c => asianCountryCodes.includes(c.iso_3166_1))));
    const asianLangs = ['ko', 'zh', 'tr', 'th', 'id', 'vi', 'ja', 'tl'];
    const asianKeywords = ["korean", "kdrama", "k-drama", "cdrama", "c-drama", "j-drama", "jdrama", "thai drama", "turkish drama", "squid game", "boys over flowers", "queen of tears", "all of us are dead", "glory", "vincenzo", "crash landing on you", "the untamed", "hidden love", "meteor garden"];
    if (!isAnimeMatch && !isAnimation && (asianLangs.includes(origLang) || isAsianCountry || asianKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k)))) {
        if (isSeries) {
            categories.push("Asian Drama");
        } else {
            categories.push("Asian Movies");
        }
    }

    // 3. Bollywood (Indian)
    const isIndianCountry = data && ((data.origin_country && data.origin_country.includes("IN")) ||
                            (data.production_countries && data.production_countries.some(c => c.iso_3166_1 === "IN")));
    const indianLangs = ['hi', 'te', 'ta', 'ml', 'kn', 'mr', 'bn', 'pa'];
    const bollywoodKeywords = ["bollywood", "tollywood", "kollywood", "hindi", "telugu", "tamil", "indian"];
    if (indianLangs.includes(origLang) || isIndianCountry || bollywoodKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k))) {
        categories.push("Bollywood");
    }

    // 5. Kids Shows and Movies (Disney & Nickelodeon)
    const kidsKeywords = [
        "drake and josh", "henry danger", "sam and cat", "thundermans", 
        "victorious", "zoey 101", "nicky ricky", "gravity falls", 
        "baymax", "casagrandes", "carrossel", "loud house", 
        "phineas and ferb", "nickelodeon", "disney", "icarly", "matilda", "jessie", 
        "peppa pig", "cocomelon", "sponge bob", "spongebob", "paw patrol", "ben 10", 
        "powerpuff", "teen titans go"
    ];
    if (tmdbGenres.includes("family") || tmdbGenres.includes("kids") || kidsKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k))) {
        categories.push("Kids Shows and Movies (Nickelodeon and Disney)");
    }

    // 6. Classic Movies
    let releaseYear = 0;
    const releaseDate = data && (data.release_date || data.first_air_date) ? (data.release_date || data.first_air_date) : "";
    if (releaseDate && releaseDate.length >= 4) {
        releaseYear = parseInt(releaseDate.substring(0, 4)) || 0;
    }
    const classicKeywords = [
        "chucky", "child's play", "bride of chucky", "seed of chucky", "curse of chucky", 
        "cult of chucky", "american pie", "american wedding", "american reunion", 
        "naked mile", "beta house", "girls' rules", "band camp", "hole in one",
        "godfather", "pulp fiction", "casablanca", "matrix", "jurassic park", "terminator", "titanic"
    ];
    if ((releaseYear > 0 && releaseYear < 2000) || classicKeywords.some(k => titleLower.includes(k))) {
        categories.push("Classic Movies");
    }

    // 7. Comics
    const comicKeywords = [
        "marvel", "avengers", "spider-man", "spidey", "iron man", "captain america", "thor", 
        "guardians of the galaxy", "loki", "wandavision", "hulk", "deadpool", "wolverine", 
        "venom", "shang-chi", "eternals", "black widow", "hawkeye", "ms. marvel", "moon knight", 
        "she-hulk", "werewolf by night", "black panther", "echo", "madame web", "x-men", "kraven", 
        "daredevil", "born again", "ironheart", "fantastic 4", "fantastic four", "wonder man", "gen v", "the boys", 
        "invincible", "punisher", "batman", "superman", "shazam", "black adam", "dc comics", 
        "blue beetle", "kakegurui", "hit-monkey", "m.o.d.o.k.", "what if...?"
    ];
    const isToAllTheBoys = titleLower.includes("to all the boys");
    if (comicKeywords.some(k => titleLower.includes(k)) && !isToAllTheBoys) {
        categories.push("Comic");
    }

    // 8. Teen / High-School
    const teenKeywords = [
        "high school", "teenager", "teen", "college", "coming of age", "prom", 
        "student", "classmate", "graduation", "to all the boys", "kissing booth", 
        "euphoria", "sex education", "outer banks", "elite", "riverdale", "gossip girl", 
        "mean girls", "clueless", "superbad", "booksmart", "lady bird", "the edge of seventeen", 
        "perks of being a wallflower", "twilight", "heartstopper", "13 reasons why", 
        "cruel summer", "one of us is lying", "pretty little liars"
    ];
    if (teenKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k))) {
        categories.push("Teen/High-School");
    }

    // 9. Erotic Movies
    const eroticKeywords = ["365 days", "fifty shades", "fatal seduction", "erotic", "sex life", "sex/life"];
    if (eroticKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k))) {
        categories.push("Erotic Movies");
    }

    // 10. Regional fallback to Hollywood/British
    const isRegional = categories.some(cat => ["Asian Drama", "Asian Movies", "Korean Drama", "Korean Movies", "Bollywood", "African", "Anime Series", "Anime Movies"].includes(cat));
    if (!isRegional) {
        if (isSeries) {
            categories.push("Hollywood/British Series");
        } else {
            categories.push("Hollywood/British Movies");
        }
    }

    // NOTE: Christian Movies category is NEVER auto-assigned; it is manual only upon admin selection.
    return Array.from(new Set(categories));
}

// Automatically check matching checkboxes in Add or Edit Movie modal
function autoCheckCategoriesUI(selectedCategories, targetSelector = ".add-cat-checkbox") {
    const checkboxes = document.querySelectorAll(targetSelector);
    if (!checkboxes || checkboxes.length === 0) return;
    
    const catSet = new Set(selectedCategories || ["Main"]);
    catSet.add("Main"); // Always ensure Main is included
    
    if (catSet.has("Asian Drama") || catSet.has("Korean Drama")) {
        catSet.add("Asian Drama");
        catSet.add("Korean Drama");
    }
    if (catSet.has("Asian Movies") || catSet.has("Korean Movies")) {
        catSet.add("Asian Movies");
        catSet.add("Korean Movies");
    }
    
    checkboxes.forEach(cb => {
        // Keep Christian Movies checked ONLY if user manually checked it
        if (cb.value === "Christian Movies") {
            return;
        }
        cb.checked = catSet.has(cb.value);
    });
}

let autoCategoryFetchController = null;

// Real-time metadata fetch to automatically check categories in UI (supports ID and title query)
async function autoFetchAndCheckCategories(rawId, mediaType, fallbackTitle, targetSelector = ".add-cat-checkbox") {
    const titleToSearch = (fallbackTitle || "").trim() || (rawId ? String(rawId).trim() : "");
    const cleanTitle = String(titleToSearch).replace(/\s*\([^)]+\)\s*$/g, "").replace(/[*_`~]/g, "").trim();
    const numericId = rawId ? String(rawId).trim().split("-")[0] : "";
    const hasValidNumericId = numericId && /^\d+$/.test(numericId);
    
    if (!hasValidNumericId && !cleanTitle) return;
    
    if (autoCategoryFetchController) {
        autoCategoryFetchController.abort();
    }
    autoCategoryFetchController = new AbortController();
    const signal = autoCategoryFetchController.signal;

    try {
        const type = (mediaType || "").toLowerCase();
        const isTv = (type === "tv" || type === "series");
        const tmdbType = isTv ? "tv" : "movie";
        let data = null;
        let finalType = isTv ? "Series" : "Movie";

        if (hasValidNumericId) {
            try {
                let res = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${numericId}?api_key=${TMDB_API_KEY}`, { signal });
                if (res.ok) {
                    data = await res.json();
                } else {
                    const fallbackType = isTv ? "movie" : "tv";
                    const fallbackRes = await fetch(`https://api.themoviedb.org/3/${fallbackType}/${numericId}?api_key=${TMDB_API_KEY}`, { signal });
                    if (fallbackRes.ok) {
                        data = await fallbackRes.json();
                        finalType = isTv ? "Movie" : "Series";
                        const typeSelect = document.getElementById("movie-type");
                        if (typeSelect && targetSelector === ".add-cat-checkbox") {
                            typeSelect.value = (finalType === "Series") ? "tv" : "movie";
                            typeSelect.dispatchEvent(new Event("change"));
                        }
                    }
                }
            } catch (_) {}
        }

        // Search by title fallback if numeric ID lookup didn't yield result
        if (!data && cleanTitle) {
            try {
                const searchRes = await fetch(`https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`, { signal });
                if (searchRes.ok) {
                    const searchJson = await searchRes.json();
                    if (searchJson.results && searchJson.results.length > 0) {
                        data = searchJson.results[0];
                    }
                }
                if (!data) {
                    const otherType = isTv ? "movie" : "tv";
                    const otherRes = await fetch(`https://api.themoviedb.org/3/search/${otherType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`, { signal });
                    if (otherRes.ok) {
                        const otherJson = await otherRes.json();
                        if (otherJson.results && otherJson.results.length > 0) {
                            data = otherJson.results[0];
                            finalType = isTv ? "Movie" : "Series";
                        }
                    }
                }
            } catch (_) {}
        }
        
        if (data) {
            const matchedTitle = data.title || data.name || cleanTitle || "";
            const autoCats = determineAutoCategories(data, matchedTitle, finalType);
            autoCheckCategoriesUI(autoCats, targetSelector);
            return autoCats;
        }
    } catch (e) {
        if (e.name !== "AbortError") {
            console.warn("Auto category fetch warning:", e);
        }
    }
}

let addMovieLinksState = [{ url: "", quality: "720p" }];

function renderAddMovieLinks() {
    const wrapper = document.getElementById("add-movie-links-inputs-wrapper");
    if (!wrapper) return;
    
    const movieTypeSelect = document.getElementById("movie-type");
    const isSeries = movieTypeSelect && (movieTypeSelect.value.toLowerCase() === 'tv' || movieTypeSelect.value.toLowerCase() === 'series');
    
    wrapper.innerHTML = addMovieLinksState.map((linkObj, idx) => {
        const urlVal = typeof linkObj === 'object' && linkObj !== null ? linkObj.url : linkObj;
        const qualityVal = typeof linkObj === 'object' && linkObj !== null && linkObj.quality ? linkObj.quality : "720p";
        const seasonLabel = `Season ${idx + 1}`;
        const escaped = escapeHTML(urlVal || "");
        
        return `
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 11px; color: ${isSeries ? '#ffbc00' : 'var(--text-secondary)'}; font-weight: 700; width: ${isSeries ? '120px' : '45px'}; flex-shrink: 0;">${isSeries ? `Link ${idx + 1} (${seasonLabel}):` : `Link ${idx + 1}:`}</span>
                <input type="text" class="add-movie-link-url-input" data-index="${idx}" value="${escaped}" placeholder="${isSeries ? `Telegram URL for ${seasonLabel}...` : `Paste Telegram download URL`}" style="flex: 1; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px;">
                
                ${!isSeries ? `
                <select class="add-movie-link-quality-select" data-index="${idx}" style="padding: 8px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px; width: 95px; cursor: pointer;">
                    <option value="480p" ${qualityVal === '480p' ? 'selected' : ''}>480p</option>
                    <option value="720p" ${qualityVal === '720p' ? 'selected' : ''}>720p</option>
                    <option value="1080p" ${qualityVal === '1080p' ? 'selected' : ''}>1080p</option>
                    <option value="2160p (4K)" ${qualityVal === '2160p (4K)' || qualityVal === '4K UHD' ? 'selected' : ''}>2160p (4K)</option>
                    <option value="Cinema Cut / HDCam" ${qualityVal === 'Cinema Cut / HDCam' || qualityVal === 'Cinema Cut' || qualityVal === 'HDCam' ? 'selected' : ''}>Cinema Cut / HDCam</option>
                </select>
                ` : ''}

                <button type="button" class="btn-remove-add-movie-link" data-index="${idx}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 6px; display: ${addMovieLinksState.length > 1 ? 'block' : 'none'};">
                    <svg style="width: 14px; height: 14px; fill: currentColor;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
        `;
    }).join('');
    
    // Bind url input updates
    wrapper.querySelectorAll(".add-movie-link-url-input").forEach(input => {
        input.addEventListener("input", (e) => {
            const idx = parseInt(e.target.dataset.index);
            const isSeriesNow = movieTypeSelect && (movieTypeSelect.value.toLowerCase() === 'tv' || movieTypeSelect.value.toLowerCase() === 'series');
            const seasonLabel = `Season ${idx + 1}`;
            if (typeof addMovieLinksState[idx] !== 'object' || addMovieLinksState[idx] === null) {
                addMovieLinksState[idx] = isSeriesNow ? { url: e.target.value.trim(), season: seasonLabel } : { url: e.target.value.trim(), quality: "720p" };
            } else {
                addMovieLinksState[idx].url = e.target.value.trim();
                if (isSeriesNow) addMovieLinksState[idx].season = seasonLabel;
            }
        });
    });

    // Bind quality select updates
    wrapper.querySelectorAll(".add-movie-link-quality-select").forEach(select => {
        select.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.index);
            if (typeof addMovieLinksState[idx] !== 'object' || addMovieLinksState[idx] === null) {
                addMovieLinksState[idx] = { url: "", quality: e.target.value };
            } else {
                addMovieLinksState[idx].quality = e.target.value;
            }
        });
    });
    
    // Bind remove button clicks
    wrapper.querySelectorAll(".btn-remove-add-movie-link").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(e.currentTarget.dataset.index);
            addMovieLinksState.splice(idx, 1);
            renderAddMovieLinks();
        });
    });
}

let addMovieStreamLinksState = [{ url: "", quality: "720p", episode: 1 }];

function renderAddMovieStreamLinks() {
    const wrapper = document.getElementById("add-movie-streams-inputs-wrapper");
    if (!wrapper) return;
    
    const movieTypeSelect = document.getElementById("movie-type");
    const isSeries = movieTypeSelect && (movieTypeSelect.value.toLowerCase() === 'tv' || movieTypeSelect.value.toLowerCase() === 'series');
    
    // Update Add button label
    const addBtn = document.getElementById("btn-add-movie-stream-link-input");
    if (addBtn) {
        addBtn.textContent = isSeries ? "+ Add Episode Stream" : "+ Add Stream Link";
    }

    wrapper.innerHTML = addMovieStreamLinksState.map((linkObj, idx) => {
        const urlVal = typeof linkObj === 'object' && linkObj !== null ? (linkObj.url || linkObj.stream_url || "") : String(linkObj || "");
        const qualityVal = typeof linkObj === 'object' && linkObj !== null && linkObj.quality ? linkObj.quality : (idx === 0 ? "720p" : (idx === 1 ? "1080p" : "2160p (4K)"));
        const epNum = typeof linkObj === 'object' && linkObj !== null && linkObj.episode ? linkObj.episode : (idx + 1);
        const escaped = escapeHTML(urlVal || "");
        const cleanToken = cleanStreamInput(urlVal);
        
        return `
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 11px; color: ${isSeries ? '#00e676' : '#ffbc00'}; font-weight: 700; width: ${isSeries ? '100px' : '65px'}; flex-shrink: 0;">${isSeries ? `Episode ${epNum}:` : `Stream ${idx + 1}:`}</span>
                <input type="text" class="add-movie-stream-url-input" data-index="${idx}" value="${escaped}" placeholder="${isSeries ? `Paste token / URL for Episode ${epNum}...` : `Paste stream token or URL...`}" style="flex: 1; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; font-family: monospace;">
                
                ${!isSeries ? `
                <select class="add-movie-stream-quality-select" data-index="${idx}" style="padding: 8px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px; width: 95px; cursor: pointer;">
                    <option value="480p" ${qualityVal === '480p' ? 'selected' : ''}>480p</option>
                    <option value="720p" ${qualityVal === '720p' ? 'selected' : ''}>720p</option>
                    <option value="1080p" ${qualityVal === '1080p' ? 'selected' : ''}>1080p</option>
                    <option value="2160p (4K)" ${qualityVal === '2160p (4K)' || qualityVal === '4K UHD' ? 'selected' : ''}>2160p (4K)</option>
                    <option value="Cinema Cut / HDCam" ${qualityVal === 'Cinema Cut / HDCam' || qualityVal === 'Cinema Cut' || qualityVal === 'HDCam' ? 'selected' : ''}>Cinema Cut / HDCam</option>
                </select>
                ` : ''}

                ${cleanToken ? `
                <a href="https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(cleanToken)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 5px 8px; border-color: rgba(255, 188, 0, 0.4); color: #ffbc00; text-decoration: none; flex-shrink: 0;" title="Test Stream Player">Test ▶️</a>
                ` : ''}

                <button type="button" class="btn-remove-add-movie-stream" data-index="${idx}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 6px; display: ${addMovieStreamLinksState.length > 1 ? 'block' : 'none'};">
                    <svg style="width: 14px; height: 14px; fill: currentColor;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
        `;
    }).join('');
    
    // Bind url input updates
    wrapper.querySelectorAll(".add-movie-stream-url-input").forEach(input => {
        input.addEventListener("input", (e) => {
            const idx = parseInt(e.target.dataset.index);
            const isSeriesNow = movieTypeSelect && (movieTypeSelect.value.toLowerCase() === 'tv' || movieTypeSelect.value.toLowerCase() === 'series');
            if (typeof addMovieStreamLinksState[idx] !== 'object' || addMovieStreamLinksState[idx] === null) {
                addMovieStreamLinksState[idx] = isSeriesNow ? { url: e.target.value.trim(), episode: idx + 1 } : { url: e.target.value.trim(), quality: "720p" };
            } else {
                addMovieStreamLinksState[idx].url = e.target.value.trim();
                if (isSeriesNow && !addMovieStreamLinksState[idx].episode) addMovieStreamLinksState[idx].episode = idx + 1;
            }
        });
    });

    // Bind quality select updates
    wrapper.querySelectorAll(".add-movie-stream-quality-select").forEach(select => {
        select.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.index);
            if (typeof addMovieStreamLinksState[idx] !== 'object' || addMovieStreamLinksState[idx] === null) {
                addMovieStreamLinksState[idx] = { url: "", quality: e.target.value };
            } else {
                addMovieStreamLinksState[idx].quality = e.target.value;
            }
        });
    });
    
    // Bind remove button clicks
    wrapper.querySelectorAll(".btn-remove-add-movie-stream").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(e.currentTarget.dataset.index);
            addMovieStreamLinksState.splice(idx, 1);
            renderAddMovieStreamLinks();
        });
    });
}

const addMovieTypeSelect = document.getElementById("movie-type");
if (addMovieTypeSelect) {
    addMovieTypeSelect.addEventListener("change", () => {
        renderAddMovieLinks();
        renderAddMovieStreamLinks();
        const rawId = document.getElementById("movie-id")?.value.trim().split("-")[0];
        if (rawId && /^\d+$/.test(rawId)) {
            const currentTitle = document.getElementById("movie-title")?.value || "";
            autoFetchAndCheckCategories(rawId, addMovieTypeSelect.value, currentTitle);
        }
    });
}

// Bind Auto-Detect button in Add Movie modal
const btnAddAutoCats = document.getElementById("btn-add-auto-cats");
if (btnAddAutoCats) {
    btnAddAutoCats.addEventListener("click", async () => {
        btnAddAutoCats.disabled = true;
        btnAddAutoCats.textContent = "Detecting... ⏳";
        const titleEl = document.getElementById("movie-title");
        const idEl = document.getElementById("movie-id");
        const typeEl = document.getElementById("movie-type");
        const currentTitle = titleEl ? titleEl.value.trim() : "";
        const currentId = idEl ? idEl.value.trim() : "";
        const currentType = typeEl ? typeEl.value : "movie";
        const detected = await autoFetchAndCheckCategories(currentId, currentType, currentTitle, ".add-cat-checkbox");
        btnAddAutoCats.disabled = false;
        btnAddAutoCats.textContent = "⚡ Auto-Detect";
        if (detected && detected.length > 0) {
            showToast(`Auto-detected: ${detected.join(', ')}`, "success");
        } else {
            showToast("Could not auto-detect additional categories. Please check TMDB ID or Title.", "info");
        }
    });
}

// Modal Reset Logic for Add Movie Form
function resetAddMovieModalState() {
    addMovieLinksState = [{ url: "", quality: "720p" }];
    renderAddMovieLinks();

    addMovieStreamLinksState = [{ url: "", quality: "720p", episode: 1 }];
    renderAddMovieStreamLinks();

    const customSection = document.getElementById("add-movie-custom-fields");
    const toggleBtn = document.getElementById("btn-toggle-custom-fields");
    const toggleContainer = toggleBtn ? toggleBtn.parentElement : null;

    if (toggleContainer) toggleContainer.style.display = "flex";
    if (toggleBtn) {
        toggleBtn.style.display = "block";
        toggleBtn.textContent = "Show Custom Fields ▾";
    }
    if (customSection) customSection.style.display = "none";

    const customPoster = document.getElementById("movie-poster");
    const customBackdrop = document.getElementById("movie-backdrop");
    const customOverview = document.getElementById("movie-overview");
    const customTrailer = document.getElementById("movie-trailer");
    const customReleaseDate = document.getElementById("movie-release-date");

    if (customPoster) customPoster.value = "";
    if (customBackdrop) customBackdrop.value = "";
    if (customOverview) customOverview.value = "";
    if (customTrailer) customTrailer.value = "";
    if (customReleaseDate) customReleaseDate.value = "";

    document.querySelectorAll(".add-cat-checkbox").forEach(cb => {
        cb.checked = (cb.value === "Main");
    });

    const addMovieBulkWrapper = document.getElementById("add-movie-bulk-links-wrapper");
    const addMovieBulkInput = document.getElementById("add-movie-bulk-links-input");
    const btnAddMovieBulkToggle = document.getElementById("btn-add-movie-bulk-links-toggle");
    if (addMovieBulkWrapper) addMovieBulkWrapper.style.display = "none";
    if (addMovieBulkInput) addMovieBulkInput.value = "";
    if (btnAddMovieBulkToggle) btnAddMovieBulkToggle.textContent = "📋 Bulk Paste";

    const addMovieBulkStreamsWrapper = document.getElementById("add-movie-bulk-streams-wrapper");
    const addMovieBulkStreamsInput = document.getElementById("add-movie-bulk-streams-input");
    const btnAddMovieBulkStreamsToggle = document.getElementById("btn-add-movie-bulk-streams-toggle");
    if (addMovieBulkStreamsWrapper) addMovieBulkStreamsWrapper.style.display = "none";
    if (addMovieBulkStreamsInput) addMovieBulkStreamsInput.value = "";
    if (btnAddMovieBulkStreamsToggle) btnAddMovieBulkStreamsToggle.textContent = "📋 Bulk Paste";
}

// Modal Toggle Logic
const addMovieModal = document.getElementById("add-movie-modal");
const openModalBtn = document.getElementById("btn-add-movie-modal");
const closeModalBtn = document.getElementById("btn-close-movie-modal");

if (openModalBtn && addMovieModal) {
    openModalBtn.addEventListener("click", () => {
        resetAddMovieModalState();
        const addMovieForm = document.getElementById("add-movie-form");
        if (addMovieForm) addMovieForm.reset();
        addMovieModal.classList.add("active");
    });
}

if (closeModalBtn && addMovieModal) {
    closeModalBtn.addEventListener("click", () => {
        addMovieModal.classList.remove("active");
    });
}

const toggleCustomFieldsBtn = document.getElementById("btn-toggle-custom-fields");
if (toggleCustomFieldsBtn) {
    toggleCustomFieldsBtn.addEventListener("click", () => {
        const customSection = document.getElementById("add-movie-custom-fields");
        if (customSection) {
            const isHidden = customSection.style.display === "none" || !customSection.style.display;
            customSection.style.display = isHidden ? "block" : "none";
            toggleCustomFieldsBtn.textContent = isHidden ? "Hide Custom Fields ▴" : "Show Custom Fields ▾";
        }
    });
}

// TMDB In-App Search inside Add Movie Form
const btnSearchTmdb = document.getElementById("btn-search-tmdb");
const inputSearchTmdb = document.getElementById("movie-search-tmdb");
const resultsSearchTmdb = document.getElementById("tmdb-search-results");

if (btnSearchTmdb && inputSearchTmdb && resultsSearchTmdb) {
    const performSearch = async () => {
        const query = inputSearchTmdb.value.trim();
        if (!query) return;
        
        btnSearchTmdb.disabled = true;
        btnSearchTmdb.textContent = "Searching...";
        resultsSearchTmdb.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-secondary); font-size: 13px;">Searching TMDB... ⏳</div>`;
        resultsSearchTmdb.style.display = "block";
        
        try {
            let rawStr = String(query).toLowerCase().replace(/&/g, " and ");
            const yearMatch = rawStr.match(/\b(19\d\d|20\d\d)\b/);
            const matchedYear = yearMatch ? yearMatch[1] : null;
            rawStr = rawStr.replace(/\b(1080p|720p|480p|360p|4k|2160p|web-dl|webrip|bluray|brrip|dvdrip|hdrip|hdcam|camrip|cam|x264|x265|hevc|aac|sub|dub|multi|dual\s*audio|season|episode|s\d{1,2}|e\d{1,2}|complete)\b/gi, " ");
            rawStr = rawStr.replace(/[^\p{L}\p{N}\s]/gu, " ");
            const tokens = rawStr.split(/\s+/).filter(Boolean);
            const titleTokens = tokens.filter(t => t !== matchedYear);
            const cleanTitle = titleTokens.join(" ").trim() || tokens.join(" ").trim();

            let filteredResults = [];

            if (matchedYear && cleanTitle.length >= 2) {
                const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&first_air_date_year=${matchedYear}`;
                const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&primary_release_year=${matchedYear}`;
                const multiUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`;

                const [tvRes, movRes, multiRes] = await Promise.allSettled([
                    fetch(tvUrl).then(r => r.ok ? r.json() : null),
                    fetch(movieUrl).then(r => r.ok ? r.json() : null),
                    fetch(multiUrl).then(r => r.ok ? r.json() : null)
                ]);

                const tvItems = (tvRes.status === 'fulfilled' && tvRes.value?.results) ? tvRes.value.results.map(r => ({ ...r, media_type: 'tv' })) : [];
                const movItems = (movRes.status === 'fulfilled' && movRes.value?.results) ? movRes.value.results.map(r => ({ ...r, media_type: 'movie' })) : [];
                const multiItems = (multiRes.status === 'fulfilled' && multiRes.value?.results) ? multiRes.value.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv') : [];

                const seenIds = new Set();
                const combined = [];
                [...tvItems, ...movItems].forEach(item => {
                    if (!seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        combined.push(item);
                    }
                });
                multiItems.forEach(item => {
                    if (!seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        combined.push(item);
                    }
                });

                combined.sort((a, b) => {
                    const aTitle = (a.title || a.name || '').toLowerCase().trim();
                    const bTitle = (b.title || b.name || '').toLowerCase().trim();
                    const aDate = a.release_date || a.first_air_date || '';
                    const bDate = b.release_date || b.first_air_date || '';
                    const cleanLower = cleanTitle.toLowerCase();

                    const aYearMatch = aDate.startsWith(matchedYear);
                    const bYearMatch = bDate.startsWith(matchedYear);
                    const aExactTitle = aTitle === cleanLower;
                    const bExactTitle = bTitle === cleanLower;

                    if (aExactTitle && aYearMatch && !(bExactTitle && bYearMatch)) return -1;
                    if (!(aExactTitle && aYearMatch) && bExactTitle && bYearMatch) return 1;

                    if (aYearMatch && !bYearMatch) return -1;
                    if (!aYearMatch && bYearMatch) return 1;

                    if (aExactTitle && !bExactTitle) return -1;
                    if (!aExactTitle && bExactTitle) return 1;

                    return (b.popularity || 0) - (a.popularity || 0);
                });

                filteredResults = combined;
            } else {
                const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
                const response = await fetch(searchUrl);
                if (!response.ok) throw new Error("Search failed");
                const data = await response.json();
                filteredResults = (data.results || []).filter(item => item.media_type === "movie" || item.media_type === "tv");
            }
            
            if (filteredResults.length === 0) {
                resultsSearchTmdb.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-secondary); font-size: 13px;">No movies or series found ✖</div>`;
                return;
            }
            
            resultsSearchTmdb.innerHTML = "";
            filteredResults.forEach(item => {
                const title = item.title || item.name;
                const releaseDate = item.release_date || item.first_air_date || "";
                const year = releaseDate ? releaseDate.split("-")[0] : "N/A";
                const isTv = item.media_type === "tv";
                const posterPath = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : "MOVIE/img/FilmHouse3_nobg.png";
                
                const itemDiv = document.createElement("div");
                itemDiv.style.display = "flex";
                itemDiv.style.alignItems = "center";
                itemDiv.style.gap = "10px";
                itemDiv.style.padding = "8px";
                itemDiv.style.borderBottom = "1px solid rgba(255, 255, 255, 0.05)";
                itemDiv.style.cursor = "pointer";
                itemDiv.style.transition = "background 0.2s";
                
                // Hover effect styling
                itemDiv.addEventListener("mouseenter", () => {
                    itemDiv.style.background = "rgba(255, 188, 0, 0.08)";
                });
                itemDiv.addEventListener("mouseleave", () => {
                    itemDiv.style.background = "transparent";
                });
                
                itemDiv.innerHTML = `
                    <img src="${posterPath}" style="width: 34px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 13px; font-weight: bold; color: #fff; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHTML(title)}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                            ${year} &bull; <span style="text-transform: uppercase; font-weight: bold; color: ${isTv ? 'var(--primary-color)' : '#00bcd4'};">${isTv ? 'Series' : 'Movie'}</span>
                        </div>
                    </div>
                `;
                
                itemDiv.addEventListener("click", () => {
                    // Auto-fill form values
                    const movieTitleInput = document.getElementById("movie-title");
                    const movieIdInput = document.getElementById("movie-id");
                    const movieTypeSelect = document.getElementById("movie-type");
                    
                    if (movieTitleInput) movieTitleInput.value = title;
                    
                    if (movieTypeSelect) {
                        movieTypeSelect.value = isTv ? "tv" : "movie";
                        movieTypeSelect.dispatchEvent(new Event("change"));
                    }
                    
                    if (movieIdInput) {
                        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                        movieIdInput.value = `${item.id}-${slug}`;
                        // Trigger input event to update custom fields visibility automatically
                        movieIdInput.dispatchEvent(new Event("input"));
                    }
                    
                    // Immediately fetch full metadata & auto-check the right categories
                    autoFetchAndCheckCategories(item.id, isTv ? "tv" : "movie", title);
                    
                    // Clear search input and hide results
                    inputSearchTmdb.value = "";
                    resultsSearchTmdb.style.display = "none";
                });
                
                resultsSearchTmdb.appendChild(itemDiv);
            });
        } catch (e) {
            console.error("TMDB Search Error:", e);
            resultsSearchTmdb.innerHTML = `<div style="padding: 12px; text-align: center; color: #ff3b30; font-size: 13px;">Error fetching search results.</div>`;
        } finally {
            btnSearchTmdb.disabled = false;
            btnSearchTmdb.textContent = "Search";
        }
    };
    
    btnSearchTmdb.addEventListener("click", performSearch);
    inputSearchTmdb.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            performSearch();
        }
    });

    // Auto-search as the user types (with 500ms debounce)
    let tmdbSearchTimeout = null;
    inputSearchTmdb.addEventListener("input", () => {
        clearTimeout(tmdbSearchTimeout);
        const query = inputSearchTmdb.value.trim();
        if (!query) {
            resultsSearchTmdb.style.display = "none";
            resultsSearchTmdb.innerHTML = "";
            return;
        }
        
        // Show loading state under the input
        resultsSearchTmdb.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-secondary); font-size: 13px;">Searching TMDB... ⏳</div>`;
        resultsSearchTmdb.style.display = "block";
        
        tmdbSearchTimeout = setTimeout(() => {
            performSearch();
        }, 500);
    });
}

// Click outside to close TMDB search results dropdown
document.addEventListener("click", (e) => {
    const resultsContainer = document.getElementById("tmdb-search-results");
    const searchInput = document.getElementById("movie-search-tmdb");
    const searchBtn = document.getElementById("btn-search-tmdb");
    if (resultsContainer && e.target !== searchInput && e.target !== searchBtn && !resultsContainer.contains(e.target)) {
        resultsContainer.style.display = "none";
    }
});

const addMovieIdInput = document.getElementById("movie-id");
let addMovieIdDebounce = null;
if (addMovieIdInput) {
    addMovieIdInput.addEventListener("input", () => {
        const parsed = extractTmdbIdAndType(addMovieIdInput.value);
        if (parsed) {
            addMovieIdInput.value = parsed.id;
            const typeSelect = document.getElementById("movie-type");
            if (typeSelect) {
                typeSelect.value = parsed.type;
                typeSelect.dispatchEvent(new Event("change"));
            }
        }
        
        const val = addMovieIdInput.value.trim().split("-")[0];
        const isTmdb = val && /^\d+$/.test(val);
        const customSection = document.getElementById("add-movie-custom-fields");
        const toggleBtn = document.getElementById("btn-toggle-custom-fields");
        const toggleContainer = toggleBtn ? toggleBtn.parentElement : null;
        
        if (customSection) {
            if (val === "") {
                if (toggleContainer) toggleContainer.style.display = "flex";
                if (toggleBtn) {
                    toggleBtn.style.display = "block";
                    toggleBtn.textContent = "Show Custom Fields ▾";
                }
                customSection.style.display = "none";
            } else if (isTmdb) {
                // TMDB ID: Hide custom fields completely (API will handle everything)
                if (toggleContainer) toggleContainer.style.display = "none";
                customSection.style.display = "none";
            } else {
                // Custom ID: Show custom fields and hide toggle button (they must fill them)
                if (toggleContainer) {
                    toggleContainer.style.display = "flex";
                    // Keep header text but hide the collapse/expand button
                    if (toggleBtn) toggleBtn.style.display = "none";
                }
                customSection.style.display = "block";
            }
        }

        if (isTmdb) {
            clearTimeout(addMovieIdDebounce);
            addMovieIdDebounce = setTimeout(() => {
                const currentType = document.getElementById("movie-type")?.value || "movie";
                const currentTitle = document.getElementById("movie-title")?.value || "";
                autoFetchAndCheckCategories(val, currentType, currentTitle);
            }, 300);
        }
    });
}

const btnAddMovieLinkInput = document.getElementById("btn-add-movie-link-input");
if (btnAddMovieLinkInput) {
    btnAddMovieLinkInput.addEventListener("click", () => {
        addMovieLinksState.push({ url: "", quality: "720p" });
        renderAddMovieLinks();
    });
}

const btnAddMovieBulkToggle = document.getElementById("btn-add-movie-bulk-links-toggle");
const addMovieBulkWrapper = document.getElementById("add-movie-bulk-links-wrapper");
const addMovieBulkInput = document.getElementById("add-movie-bulk-links-input");
const btnApplyAddBulkLinks = document.getElementById("btn-apply-add-bulk-links");

if (btnAddMovieBulkToggle && addMovieBulkWrapper) {
    btnAddMovieBulkToggle.addEventListener("click", () => {
        const isHidden = addMovieBulkWrapper.style.display === "none";
        addMovieBulkWrapper.style.display = isHidden ? "block" : "none";
        btnAddMovieBulkToggle.textContent = isHidden ? "✕ Close Bulk" : "📋 Bulk Paste";
        if (isHidden && addMovieBulkInput) addMovieBulkInput.focus();
    });
}

if (btnApplyAddBulkLinks && addMovieBulkInput) {
    btnApplyAddBulkLinks.addEventListener("click", () => {
        const movieTypeSelect = document.getElementById("movie-type");
        const isSeries = movieTypeSelect && (movieTypeSelect.value.toLowerCase() === 'tv' || movieTypeSelect.value.toLowerCase() === 'series');
        const parsed = parseBulkLinks(addMovieBulkInput.value, isSeries);
        if (parsed.length === 0) {
            alert("Please paste at least one valid link!");
            return;
        }
        addMovieLinksState = parsed;
        renderAddMovieLinks();
        addMovieBulkInput.value = "";
        if (addMovieBulkWrapper) addMovieBulkWrapper.style.display = "none";
        if (btnAddMovieBulkToggle) btnAddMovieBulkToggle.textContent = "📋 Bulk Paste";
    });
}

// Add Movie Streaming Link Handlers
const btnAddMovieStreamLinkInput = document.getElementById("btn-add-movie-stream-link-input");
if (btnAddMovieStreamLinkInput) {
    btnAddMovieStreamLinkInput.addEventListener("click", () => {
        const movieTypeSelect = document.getElementById("movie-type");
        const isSeries = movieTypeSelect && (movieTypeSelect.value.toLowerCase() === 'tv' || movieTypeSelect.value.toLowerCase() === 'series');
        const nextIdx = addMovieStreamLinksState.length;
        if (isSeries) {
            addMovieStreamLinksState.push({ url: "", episode: nextIdx + 1 });
        } else {
            const standardQualities = ["720p", "1080p", "2160p (4K)", "480p"];
            addMovieStreamLinksState.push({ url: "", quality: standardQualities[nextIdx % standardQualities.length] || "720p" });
        }
        renderAddMovieStreamLinks();
    });
}

const btnAddMovieBulkStreamsToggle = document.getElementById("btn-add-movie-bulk-streams-toggle");
const addMovieBulkStreamsWrapper = document.getElementById("add-movie-bulk-streams-wrapper");
const addMovieBulkStreamsInput = document.getElementById("add-movie-bulk-streams-input");
const btnApplyAddBulkStreams = document.getElementById("btn-apply-add-bulk-streams");

if (btnAddMovieBulkStreamsToggle && addMovieBulkStreamsWrapper) {
    btnAddMovieBulkStreamsToggle.addEventListener("click", () => {
        const isHidden = addMovieBulkStreamsWrapper.style.display === "none";
        addMovieBulkStreamsWrapper.style.display = isHidden ? "block" : "none";
        btnAddMovieBulkStreamsToggle.textContent = isHidden ? "✕ Close Bulk" : "📋 Bulk Paste";
        if (isHidden && addMovieBulkStreamsInput) addMovieBulkStreamsInput.focus();
    });
}

if (btnApplyAddBulkStreams && addMovieBulkStreamsInput) {
    btnApplyAddBulkStreams.addEventListener("click", () => {
        const movieTypeSelect = document.getElementById("movie-type");
        const isSeries = movieTypeSelect && (movieTypeSelect.value.toLowerCase() === 'tv' || movieTypeSelect.value.toLowerCase() === 'series');
        const parsed = parseBulkStreams(addMovieBulkStreamsInput.value, isSeries);
        if (parsed.length === 0) {
            alert("Please paste at least one valid stream token or URL!");
            return;
        }
        addMovieStreamLinksState = parsed;
        renderAddMovieStreamLinks();
        addMovieBulkStreamsInput.value = "";
        if (addMovieBulkStreamsWrapper) addMovieBulkStreamsWrapper.style.display = "none";
        if (btnAddMovieBulkStreamsToggle) btnAddMovieBulkStreamsToggle.textContent = "📋 Bulk Paste";
    });
}

// Add Movie Form Submit
const addMovieForm = document.getElementById("add-movie-form");
if (addMovieForm) {
    addMovieForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        let title = document.getElementById("movie-title").value.trim();
        const id = document.getElementById("movie-id").value.trim();
        const type = document.getElementById("movie-type").value;
        const customPoster = document.getElementById("movie-poster")?.value.trim() || "";
        const customBackdrop = document.getElementById("movie-backdrop")?.value.trim() || "";
        const customOverview = document.getElementById("movie-overview")?.value.trim() || "";
        const customTrailerVal = document.getElementById("movie-trailer")?.value.trim() || "";
        const customTrailerId = extractYoutubeId(customTrailerVal);
        const customReleaseDate = document.getElementById("movie-release-date")?.value.trim() || "";
        
        const isInitialSeries = (type.toLowerCase() === 'tv' || type.toLowerCase() === 'series');
        const validStreams = addMovieStreamLinksState
            .map((s, idx) => {
                const u = cleanStreamInput(typeof s === 'object' && s !== null ? (s.url || s.stream_url) : s);
                if (!u) return null;
                if (isInitialSeries) {
                    const epNum = (typeof s === 'object' && s !== null && s.episode) ? s.episode : (idx + 1);
                    return { episode: epNum, season: 1, stream_url: u, url: u };
                } else {
                    const q = (typeof s === 'object' && s !== null && s.quality) ? s.quality : (idx === 0 ? "720p" : "1080p");
                    return { quality: q, stream_url: u, url: u };
                }
            })
            .filter(Boolean);

        const cleanStreamVal = validStreams.length > 0 ? (validStreams[0].stream_url || validStreams[0].url) : "";
        
        // Get selected categories
        const checkedCategories = Array.from(document.querySelectorAll(".add-cat-checkbox:checked")).map(cb => cb.value);
        
        const linksList = addMovieLinksState.filter(l => {
            const urlVal = typeof l === 'object' && l !== null ? l.url : l;
            return urlVal && urlVal.trim() !== "";
        }).map((l, idx) => {
            const urlVal = (typeof l === 'object' && l !== null ? l.url : l).trim();
            if (isInitialSeries) {
                return { url: urlVal, season: `Season ${idx + 1}` };
            }
            const qualityVal = (typeof l === 'object' && l !== null && l.quality) ? l.quality : "720p";
            return { url: urlVal, quality: qualityVal };
        });
        if (linksList.length === 0) {
            alert("Error: Please add at least one Telegram download link!");
            return;
        }
        
        // Prevent duplicate IDs locally
        if (allCatalogMovies.some(m => m.csv_id === id)) {
            alert("A title with this ID already exists in the catalog!");
            return;
        }

        const submitBtn = addMovieForm.querySelector("button[type='submit']");
        const originalBtnText = submitBtn ? submitBtn.textContent : "Add to Local List";
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Fetching TMDB info... ⏳";
        }

        // Fetch TMDB rich metadata on the fly if ID is numeric, otherwise use manual fields
        const numericId = id.split("-")[0];
        const isTmdb = numericId && /^\d+$/.test(numericId);
        
        let poster = "";
        let rating = 0;
        let releaseDate = "";
        let genres = [];
        let categories = ["Main"];
        let overview = "No synopsis available.";
        let backdrop = "";
        let original_language = "en";
        let trailerId = "";
        
        let finalType = type;
        if (isTmdb) {
            const mediaType = (type.toLowerCase() === 'tv' || type.toLowerCase() === 'series') ? 'tv' : 'movie';
            const url = `https://api.themoviedb.org/3/${mediaType}/${numericId}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
            try {
                let res = await fetch(url);
                let data = null;
                if (res.ok) {
                    data = await res.json();
                } else {
                    // Try fallback to the other media type
                    const fallbackType = (mediaType === 'tv') ? 'movie' : 'tv';
                    const fallbackUrl = `https://api.themoviedb.org/3/${fallbackType}/${numericId}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
                    const fallbackRes = await fetch(fallbackUrl);
                    if (fallbackRes.ok) {
                        data = await fallbackRes.json();
                        finalType = (fallbackType === 'tv') ? 'Series' : 'Movie';
                        
                        // Update UI dropdown value to match correct type
                        const typeSelect = document.getElementById("movie-type");
                        if (typeSelect) {
                            typeSelect.value = (fallbackType === 'tv') ? 'Series' : 'Movie';
                        }
                    } else {
                        throw new Error(`Failed to fetch from both movie and tv endpoints for TMDB ID ${numericId}`);
                    }
                }
                
                title = data.title || data.name || title;
                poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : "";
                backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : "";
                rating = Math.round((data.vote_average || 0) * 10) / 10;
                releaseDate = data.release_date || data.first_air_date || "";
                genres = data.genres ? data.genres.map(g => g.name) : [];
                original_language = data.original_language || "en";
                overview = data.overview || "No synopsis available.";
                
                // Extract YouTube trailer key automatically
                if (data.videos && data.videos.results) {
                    const officialTrailer = data.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
                    if (officialTrailer) {
                        trailerId = officialTrailer.key;
                    } else if (data.videos.results.length > 0) {
                        trailerId = data.videos.results[0].key;
                    }
                }
                
                // Categorize title automatically using the centralized classifier
                categories = determineAutoCategories(data, title, finalType);
            } catch (err) {
                console.warn("Could not enrich movie metadata on form submit:", err);
                alert("Error: Failed to fetch TMDB details. Please check the TMDB ID or your internet connection.");
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
                return;
            }
        } else {
            // Manual flow: strictly use user inputs
            poster = customPoster || "img/FilmHouse3_nobg.png";
            backdrop = customBackdrop || "img/FilmHouse.png";
            overview = customOverview || "No synopsis available.";
            releaseDate = customReleaseDate || "";
            rating = 0;
            trailerId = customTrailerId || "";
            categories = checkedCategories.length > 0 ? checkedCategories : ["Main"];
            
            // Map selected categories to genres so local filtering works
            genres = categories.filter(c => c !== "Main" && c !== "Hollywood/British Movies" && c !== "Hollywood/British Series");
        }

        // Merge manually checked categories from the checkboxes for the TMDB flow
        if (isTmdb && checkedCategories.length > 0) {
            checkedCategories.forEach(cat => {
                if (!categories.includes(cat)) {
                    categories.push(cat);
                }
            });
            // Update genres mapping after merge if TMDB genres were missing
            if (genres.length === 0) {
                genres = categories.filter(c => c !== "Main" && c !== "Hollywood/British Movies" && c !== "Hollywood/British Series");
            }
        }

        // Add to local state
        const newMovie = {
            csv_id: id,
            tmdb_id: isTmdb ? parseInt(numericId) : null,
            imdb_id: "",
            title: title,
            type: (finalType.toLowerCase() === 'series' || finalType.toLowerCase() === 'tv') ? 'Series' : 'Movie',
            categories: categories,
            genres: genres,
            overview: overview,
            poster: poster,
            backdrop: backdrop,
            rating: rating,
            release_date: releaseDate,
            language: original_language,
            cast: [],
            director: "",
            trailer: trailerId,
            runtime: "",
            stream_url: cleanStreamVal,
            stream_links: validStreams,
            links: linksList
        };
        if (cleanStreamVal && linksList.length > 0) {
            linksList[0].stream_url = cleanStreamVal;
            if (!isInitialSeries) {
                linksList.forEach(l => {
                    const match = validStreams.find(vs => normalizeQualityName(vs.quality) === normalizeQualityName(l.quality));
                    if (match) l.stream_url = match.stream_url;
                });
            }
        }
        
        allCatalogMovies.unshift(newMovie);
        newlyAddedIds.push(id); // Show new addition badge!
        catalogChangesMade = true;
        
        updatePublishButtonState();
        renderCatalogList();
        
        // Configure whether this new title should be broadcasted upon Publish Changes
        const postAddMovieToChan = document.getElementById("add-movie-post-to-channel");
        if (postAddMovieToChan && !postAddMovieToChan.checked) {
            newMovie.channelBroadcasted = true; // Admin opted out of broadcast
        }
        // Always record publication duty activity for the admin adding the movie to catalog
        if (typeof window.recordAdminActivity === 'function') {
            window.recordAdminActivity("publication", title);
        }
        
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
        resetAddMovieModalState();
        addMovieForm.reset();
        addMovieModal.classList.remove("active");
        alert(`"${title}" added locally with rich TMDB details! Click "Publish Changes 🚀" inside the header to make it live.`);
    });
}

// CSV Conversion Helper
function escapeCSV(field) {
    if (field === null || field === undefined) return '';
    const stringField = String(field).trim();
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n') || stringField.includes('\r')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}

function generateCSVContent() {
    const headers = "Title,ID,Type,Link 1 ,Link 2,Link 3 ,Link 4,Link 5,Link 6,Link 7,Link 8,Link 9,Link 10,Link 11,Link 12,Link 13,Link 14,Link 15,Link 16,Link 17,Link 18,Link 19,Link 20,Link 21,Link 22,Link 23,Link 24,Link 25,Link 26,Link 27,Link 28,Link 29,Link 30,Link 31,Link 32,Link 33,Link 34,Link 35,Link 36,Link 37,Link 38,Link 39,Link 40";
    
    // Convert back to original order: reverse unshift sequence if necessary, but we can just write as is
    const rows = allCatalogMovies.map(movie => {
        const row = [
            escapeCSV(movie.title),
            escapeCSV(movie.csv_id),
            escapeCSV(movie.type.toLowerCase() === 'series' || movie.type.toLowerCase() === 'tv' ? 'tv' : 'movie')
        ];
        
        // Output up to 40 links columns
        const linksList = movie.links || [];
        for (let i = 0; i < 40; i++) {
            const linkVal = linksList[i];
            const linkUrl = typeof linkVal === 'object' && linkVal !== null ? linkVal.url : linkVal;
            row.push(escapeCSV(linkUrl || ''));
        }
        
        return row.join(',');
    });
    
    return [headers, ...rows].join('\n');
}

// Robust GitHub API PUT helper with automatic retry for transient rule evaluation timeouts and network hiccups
async function putGitHubFileWithRetry(url, token, bodyObj, maxRetries = 3) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    "Authorization": `token ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json"
                },
                body: JSON.stringify(bodyObj)
            });

            if (response.ok) {
                return response;
            }

            let errMsg = response.statusText;
            try {
                const errData = await response.json();
                if (errData && errData.message) errMsg = errData.message;
            } catch (_) {}

            const isRuleTimeout = response.status === 403 && /timeout|rule/i.test(errMsg);
            const isServerError = response.status >= 500;

            if ((isRuleTimeout || isServerError) && attempt < maxRetries) {
                console.warn(`[Publish Debug] GitHub commit hit transient error (${errMsg}). Retrying attempt ${attempt + 1}/${maxRetries} in 2.5s...`);
                await new Promise(r => setTimeout(r, 2500));
                continue;
            }

            if (response.status === 401 || (response.status === 403 && !isRuleTimeout)) {
                throw new Error(`GitHub Authentication Failed (HTTP ${response.status}: ${errMsg}). Your Personal Access Token (PAT) is invalid, revoked, or expired. Please update it in ⚙️ System Configuration.`);
            }

            if (isRuleTimeout) {
                throw new Error(`GitHub automated rule evaluation timed out (HTTP 403: ${errMsg}). This is a temporary server load issue on GitHub's side (your token is valid). Please wait 10-15 seconds and try clicking 'Publish Changes' again.`);
            }

            throw new Error(`GitHub update failed (${response.status}): ${errMsg}`);
        } catch (err) {
            lastErr = err;
            if (attempt >= maxRetries || !/timeout|fetch|network/i.test(err.message)) {
                throw err;
            }
            console.warn(`[Publish Debug] Network/fetch error: ${err.message}. Retrying attempt ${attempt + 1}/${maxRetries}...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw lastErr;
}

// Publish Changes to GitHub
const publishBtn = document.getElementById("btn-publish-catalog");
if (publishBtn) {
    publishBtn.addEventListener("click", async () => {
        const token = (document.getElementById("github-token")?.value.trim()) || (githubToken ? githubToken.trim() : "");
        if (!token) {
            alert("Error: Please set your GitHub Personal Access Token (PAT) first in the Settings panel.");
            return;
        }
        
        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing... ⏳";
        
        const owner = "dans123456";
        const repo = "filmhouse";
        const pathCSV = "MOVIE/Data/datafile.csv";
        const pathJSON = "MOVIE/Data/movies_metadata.json";
        const apiCSVUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathCSV}`;
        const apiJSONUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathJSON}`;
        
        try {
            // 1. Fetch CSV and JSON SHA details in parallel (adding cache-buster parameters/headers to bypass browser cache)
            const [getCSVResponse, getJSONResponse] = await Promise.all([
                fetch(`${apiCSVUrl}?t=${Date.now()}`, {
                    headers: {
                        "Authorization": `token ${token}`,
                        "Accept": "application/vnd.github.v3+json"
                    }
                }),
                fetch(`${apiJSONUrl}?t=${Date.now()}`, {
                    headers: {
                        "Authorization": `token ${token}`,
                        "Accept": "application/vnd.github.v3+json"
                    }
                })
            ]);

            if (!getCSVResponse.ok) {
                let errMsg = getCSVResponse.statusText;
                try {
                    const errData = await getCSVResponse.json();
                    if (errData && errData.message) errMsg = errData.message;
                } catch (_) {}
                if (getCSVResponse.status === 401 || getCSVResponse.status === 403) {
                    throw new Error(`GitHub Authentication Failed (HTTP ${getCSVResponse.status}: ${errMsg}). Your Personal Access Token (PAT) is invalid, revoked, or expired. Please update it in ⚙️ System Configuration.`);
                }
                throw new Error(`GitHub API error fetching datafile.csv (${getCSVResponse.status}): ${errMsg}`);
            }
            if (!getJSONResponse.ok) {
                let errMsg = getJSONResponse.statusText;
                try {
                    const errData = await getJSONResponse.json();
                    if (errData && errData.message) errMsg = errData.message;
                } catch (_) {}
                if (getJSONResponse.status === 401 || getJSONResponse.status === 403) {
                    throw new Error(`GitHub Authentication Failed (HTTP ${getJSONResponse.status}: ${errMsg}). Your Personal Access Token (PAT) is invalid, revoked, or expired. Please update it in ⚙️ System Configuration.`);
                }
                throw new Error(`GitHub API error fetching movies_metadata.json (${getJSONResponse.status}): ${errMsg}`);
            }

            const [csvData, jsonData] = await Promise.all([
                getCSVResponse.json(),
                getJSONResponse.json()
            ]);
            const shaCSV = csvData.sha;
            const shaJSON = jsonData.sha;
            
            // Auto-Merge check: retrieve latest remote database list to prevent race conditions
            if (jsonData.content) {
                try {
                    const decodedJSON = decodeURIComponent(escape(atob(jsonData.content.replace(/\s/g, ""))));
                    const remoteMovies = JSON.parse(decodedJSON);
                    
                    let mergedCount = 0;
                    const localCsvIds = new Set(allCatalogMovies.map(m => m.csv_id));
                    
                    remoteMovies.forEach(rm => {
                        if (rm.csv_id && !localCsvIds.has(rm.csv_id)) {
                            allCatalogMovies.push(rm);
                            mergedCount++;
                        }
                    });
                    
                    if (mergedCount > 0) {
                        console.log(`Auto-merged ${mergedCount} remote movies into local list to prevent overwrite deletion!`);
                        // Ensure lists are sorted consistently
                        allCatalogMovies.sort((a, b) => a.title.localeCompare(b.title));
                        renderCatalogList();
                    }
                } catch (err) {
                    console.warn("Auto-merge remote verification check failed:", err);
                }
            }
            
            // 2. Generate contents
            const csvContent = generateCSVContent();
            const jsonContent = JSON.stringify(allCatalogMovies, null, 2);
            
            // 3. Commit CSV and JSON content sequentially to prevent mobile network socket timeouts/aborts
            const base64CSV = btoa(unescape(encodeURIComponent(csvContent)));
            const base64JSON = btoa(unescape(encodeURIComponent(jsonContent)));
            
            // Upload datafile.csv first
            const putCSVResponse = await putGitHubFileWithRetry(apiCSVUrl, token, {
                message: "Update catalog (datafile.csv) from Film House Admin Panel",
                content: base64CSV,
                sha: shaCSV
            });

            // Upload movies_metadata.json second
            const putJSONResponse = await putGitHubFileWithRetry(apiJSONUrl, token, {
                message: "Update catalog metadata (movies_metadata.json) from Film House Admin Panel",
                content: base64JSON,
                sha: shaJSON
            });
            
            // Update local check SHA from JSON commit response to avoid self-triggering updates dialog
            const jsonResData = await putJSONResponse.json();
            if (jsonResData && jsonResData.content) {
                lastKnownJsonSha = jsonResData.content.sha;
            }
            
            // Sync changes to Firestore movies collection (chunked in groups of 400 to avoid Firestore limits)
            if (typeof db !== "undefined" && db) {
                try {
                    const operations = [];
                    allCatalogMovies.forEach(m => {
                        if (newlyAddedIds.includes(m.csv_id) || newlyUpdatedIds.includes(m.csv_id)) {
                            operations.push({ type: "set", docId: m.csv_id, data: m });
                        }
                    });
                    newlyDeletedIds.forEach(id => {
                        operations.push({ type: "delete", docId: id });
                    });
                    
                    const opChunks = [];
                    for (let i = 0; i < operations.length; i += 400) {
                        opChunks.push(operations.slice(i, i + 400));
                    }
                    
                    const fsPromises = opChunks.map(chunk => {
                        const fsBatch = db.batch();
                        chunk.forEach(op => {
                            const movieRef = db.collection("movies").doc(op.docId);
                            if (op.type === "set") {
                                fsBatch.set(movieRef, op.data, { merge: true });
                            } else if (op.type === "delete") {
                                fsBatch.delete(movieRef);
                            }
                        });
                        return fsBatch.commit();
                    });
                    
                    await Promise.all(fsPromises);
                } catch (fsErr) {
                    console.warn("Failed to commit Firestore movie catalog changes:", fsErr);
                }
            }

            // Trigger instant catalog sync on the server/bot
            if (typeof db !== "undefined" && db) {
                try {
                    await db.collection("settings").doc("catalog_sync").set({
                        lastPublishedAt: Date.now(),
                        publishedBy: (typeof currentAdminName !== "undefined" && currentAdminName) ? currentAdminName : "admin"
                    }, { merge: true });
                } catch (syncDocErr) {
                    console.warn("Failed to notify bot of catalog publish:", syncDocErr);
                }
            }

            // Credit publication duty activity for the admin performing the publish
            if (newlyAddedIds && newlyAddedIds.length > 0) {
                const pubTitles = allCatalogMovies.filter(m => newlyAddedIds.includes(m.csv_id)).map(m => m.title).filter(Boolean);
                if (pubTitles.length > 0) {
                    if (typeof window.recordAdminBatchActivity === 'function') {
                        window.recordAdminBatchActivity("publication", pubTitles);
                    } else if (typeof window.recordAdminActivity === 'function') {
                        window.recordAdminActivity("publication", pubTitles[0]);
                    }
                }
            }
            
            alert("Catalog CSV and enriched JSON database successfully published directly to GitHub! Updates are live instantly.");
            catalogChangesMade = false;
            newlyAddedIds = [];
            newlyUpdatedIds = [];
            newlyDeletedIds = [];
            localStorage.removeItem("filmhouse_unpublished_catalog"); // Clear draft!
            updatePublishButtonState();
            renderCatalogList();
        } catch (error) {
            console.error("Publishing error:", error);
            if (error.name === "TypeError" && (error.message.includes("fetch") || error.message.includes("NetworkError"))) {
                alert("Network Connection Error: Could not reach GitHub. Please check your mobile signal/internet connection and try again.");
            } else {
                alert(`Failed to publish changes:\n\n${error.message}`);
            }
        } finally {
            publishBtn.disabled = false;
            publishBtn.textContent = "Publish Changes 🚀";
        }
    });
}

// Bind Import/Export buttons
const importBtn = document.getElementById("btn-import-csv");
const exportBtn = document.getElementById("btn-export-csv");
const csvFileInput = document.getElementById("input-import-csv");

if (importBtn && csvFileInput) {
    importBtn.addEventListener("click", () => {
        csvFileInput.click();
    });

    csvFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                if (!results.data || results.data.length === 0) {
                    alert("The CSV file appears to be empty or formatted incorrectly.");
                    return;
                }

                // Map row data
                const importedMovies = results.data.map(row => {
                    const keys = Object.keys(row);
                    const titleKey = keys.find(k => k.trim().toLowerCase() === 'title') || 'Title';
                    const idKey = keys.find(k => k.trim().toLowerCase() === 'id') || 'ID';
                    const typeKey = keys.find(k => k.trim().toLowerCase() === 'type') || 'Type';

                    const title = (row[titleKey] || '').trim();
                    const csv_id = (row[idKey] || '').trim();
                    const rawType = (row[typeKey] || '').trim().toLowerCase();
                    const type = (rawType === 'series' || rawType === 'tv') ? 'Series' : 'Movie';

                    // Parse up to 40 links columns
                    const links = [];
                    keys.forEach(k => {
                        const cleanKey = k.trim().toLowerCase();
                        if (cleanKey.startsWith('link') && row[k]) {
                            const linkVal = row[k].trim();
                            if (linkVal) links.push(linkVal);
                        }
                    });

                    return {
                        title,
                        csv_id,
                        type,
                        links,
                        poster: '',
                        rating: 0,
                        release_date: ''
                    };
                }).filter(m => m.title && m.csv_id);

                if (importedMovies.length > 0) {
                    showCSVReviewModal(importedMovies);
                } else {
                    alert("Failed to find any movies with valid Title and ID in the CSV.");
                }
                csvFileInput.value = ""; // Reset file selector
            },
            error: function(err) {
                alert("Error parsing CSV: " + err.message);
                csvFileInput.value = "";
            }
        });
    });
}

if (exportBtn) {
    exportBtn.addEventListener("click", () => {
        if (allCatalogMovies.length === 0) {
            alert("No movies available in the catalog to export!");
            return;
        }

        const csvContent = generateCSVContent();
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "datafile.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

// In-Browser TMDB Preview Scraper
async function fetchTMDBPreview(csvId, type) {
    const numericId = csvId.split("-")[0];
    if (!numericId || !/^\d+$/.test(numericId)) return null;
    
    const mediaType = (type.toLowerCase() === 'series' || type.toLowerCase() === 'tv') ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${mediaType}/${numericId}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            
            // Extract YouTube trailer key
            let trailerId = "";
            if (data.videos && data.videos.results) {
                const officialTrailer = data.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
                if (officialTrailer) {
                    trailerId = officialTrailer.key;
                } else if (data.videos.results.length > 0) {
                    trailerId = data.videos.results[0].key;
                }
            }

            return {
                tmdb_id: data.id,
                title: data.title || data.name || "",
                poster: data.poster_path ? `https://image.tmdb.org/t/p/w200${data.poster_path}` : "",
                backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : "",
                overview: data.overview || "",
                rating: Math.round((data.vote_average || 0) * 10) / 10,
                release_date: data.release_date || data.first_air_date || "",
                language: data.original_language || "en",
                genres: data.genres ? data.genres.map(g => g.name) : [],
                trailer: trailerId
            };
        }
    } catch (e) {
        console.error("Error fetching TMDB preview:", e);
    }
    return null;
}

// Render HTML inside Review Modal & Scrape TMDB Previews
function showCSVReviewModal(importedMovies) {
    const modal = document.getElementById("csv-review-modal");
    const reviewBody = document.getElementById("csv-review-body");
    if (!modal || !reviewBody) return;

    // Calculate diffs
    const existingMap = new Map(allCatalogMovies.map(m => [m.csv_id, m]));
    const importedMap = new Map(importedMovies.map(m => [m.csv_id, m]));

    const added = [];
    const updated = [];
    const removed = [];

    importedMovies.forEach(m => {
        if (!existingMap.has(m.csv_id)) {
            added.push(m);
        } else {
            const existing = existingMap.get(m.csv_id);
            const isTitleDiff = existing.title !== m.title;
            const isTypeDiff = existing.type !== m.type;
            const isLinksDiff = JSON.stringify(existing.links) !== JSON.stringify(m.links);
            if (isTitleDiff || isTypeDiff || isLinksDiff) {
                updated.push({ newMovie: m, oldMovie: existing });
            }
        }
    });

    allCatalogMovies.forEach(m => {
        if (!importedMap.has(m.csv_id)) {
            removed.push(m);
        }
    });

    pendingImportChanges = {
        importedList: importedMovies,
        added,
        updated,
        removed
    };

    // Render HTML inside Review Modal based on Overwrite checkbox state
    const overwriteCheckbox = document.getElementById("csv-import-overwrite");
    if (overwriteCheckbox) {
        overwriteCheckbox.checked = false; // default to safe merge/append mode
        overwriteCheckbox.replaceWith(overwriteCheckbox.cloneNode(true)); // clear old listeners
        const newCheckbox = document.getElementById("csv-import-overwrite");
        newCheckbox.addEventListener("change", () => {
            renderReviewUI();
        });
    }

    function renderReviewUI() {
        const checkbox = document.getElementById("csv-import-overwrite");
        const isOverwrite = checkbox ? checkbox.checked : false;
        const activeRemoved = isOverwrite ? removed : [];
        
        reviewBody.innerHTML = `
            <div style="margin-bottom: 16px; display: flex; gap: 12px; flex-wrap: wrap;">
                <span style="background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 4px 10px; border-radius: 6px; font-weight: 700;">🟢 Added: ${added.length}</span>
                <span style="background: rgba(33, 150, 243, 0.15); border: 1px solid rgba(33, 150, 243, 0.3); color: #2196f3; padding: 4px 10px; border-radius: 6px; font-weight: 700;">🔵 Updated: ${updated.length}</span>
                <span style="background: ${activeRemoved.length > 0 ? 'rgba(244, 67, 54, 0.15)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${activeRemoved.length > 0 ? 'rgba(244, 67, 54, 0.3)' : 'rgba(255,255,255,0.1)'}; color: ${activeRemoved.length > 0 ? '#f44336' : 'var(--text-secondary)'}; padding: 4px 10px; border-radius: 6px; font-weight: 700;">🔴 Removed: ${activeRemoved.length} ${!isOverwrite ? '(Merge Mode)' : ''}</span>
            </div>
            
            <div id="review-list-container" style="display: flex; flex-direction: column; gap: 12px;">
                ${added.length > 0 ? `
                    <div>
                        <h4 style="margin: 0 0 8px 0; color: #4caf50; font-size: 14px;">Pending Additions (${added.length})</h4>
                        <div id="added-preview-list" style="display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border: 1px solid rgba(76, 175, 80, 0.1);">
                            ${added.map(m => `
                                <div id="preview-row-${m.csv_id}" style="display: flex; gap: 10px; align-items: center; padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <div class="preview-spinner" style="width: 32px; height: 42px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px;">⏳</div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; color: #fff;">${m.title}</div>
                                        <div style="font-size: 11px; color: var(--text-secondary);">ID: ${m.csv_id} | Type: ${m.type}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${updated.length > 0 ? `
                    <div>
                        <h4 style="margin: 12px 0 8px 0; color: #2196f3; font-size: 14px;">Modified Titles (${updated.length})</h4>
                        <div style="display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border: 1px solid rgba(33, 150, 243, 0.1);">
                            ${updated.map(u => `
                                <div style="padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <div style="font-weight: 600; color: #fff;">${u.newMovie.title}</div>
                                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                                        ${u.oldMovie.title !== u.newMovie.title ? `<span style="color: #ff9800; text-decoration: line-through;">${u.oldMovie.title}</span> ➔ <span style="color: #4caf50;">${u.newMovie.title}</span><br>` : ''}
                                        ${u.oldMovie.links.length !== u.newMovie.links.length ? `Links: ${u.oldMovie.links.length} ➔ ${u.newMovie.links.length}` : 'Links content updated'}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${activeRemoved.length > 0 ? `
                    <div>
                        <h4 style="margin: 12px 0 8px 0; color: #f44336; font-size: 14px;">Titles to Remove (${activeRemoved.length})</h4>
                        <div style="display: flex; flex-direction: column; gap: 6px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border: 1px solid rgba(244, 67, 54, 0.1);">
                            ${activeRemoved.map(m => `
                                <div style="color: #e57373; text-decoration: line-through; padding: 4px 6px;">${m.title}</div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderReviewUI();
    modal.classList.add("active");

    // Fetch TMDB rich previews in-browser for newly added titles in parallel
    added.forEach(async m => {
        const preview = await fetchTMDBPreview(m.csv_id, m.type);
        const row = document.getElementById(`preview-row-${m.csv_id}`);
        if (row && preview) {
            row.innerHTML = `
                <img src="${preview.poster || 'MOVIE/img/FilmHouse3_nobg.png'}" style="width: 32px; height: 46px; border-radius: 4px; object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                <div style="flex: 1;">
                    <div style="font-weight: 600; color: #fff; display: flex; justify-content: space-between; align-items: center;">
                        <span>${preview.title || m.title}</span>
                        <span style="font-size: 10px; color: #ffbc00;">⭐ ${preview.rating ? preview.rating.toFixed(1) : '0.0'}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 340px;" title="${preview.overview}">${preview.overview || 'No synopsis loaded.'}</div>
                </div>
            `;
            m.tmdb_id = preview.tmdb_id;
            m.title = preview.title || m.title;
            m.overview = preview.overview || m.overview;
            m.poster = preview.poster;
            m.backdrop = preview.backdrop;
            m.rating = preview.rating;
            m.release_date = preview.release_date;
            m.language = preview.language;
            m.genres = preview.genres;
            m.trailer = preview.trailer;
        }
    });
}

// Bind review modal close/confirm handlers
const closeReviewModalBtn = document.getElementById("btn-close-review-modal");
const cancelCSVImportBtn = document.getElementById("btn-cancel-csv-import");
const confirmCSVImportBtn = document.getElementById("btn-confirm-csv-import");
const csvReviewModal = document.getElementById("csv-review-modal");

if (closeReviewModalBtn && csvReviewModal) {
    closeReviewModalBtn.addEventListener("click", () => {
        csvReviewModal.classList.remove("active");
    });
}

if (cancelCSVImportBtn && csvReviewModal) {
    cancelCSVImportBtn.addEventListener("click", () => {
        csvReviewModal.classList.remove("active");
        pendingImportChanges = null;
    });
}

if (confirmCSVImportBtn && csvReviewModal) {
    confirmCSVImportBtn.addEventListener("click", () => {
        if (pendingImportChanges) {
            const overwriteCheckbox = document.getElementById("csv-import-overwrite");
            const isOverwrite = overwriteCheckbox ? overwriteCheckbox.checked : false;

            // Build the final catalog by merging imported data with existing rich metadata
            let finalCatalog = [...allCatalogMovies];
            
            if (isOverwrite) {
                // If overwrite mode is checked, remove all movies not in the imported CSV
                const importedIds = new Set(pendingImportChanges.importedList.map(m => m.csv_id));
                finalCatalog = finalCatalog.filter(ex => importedIds.has(ex.csv_id));
            }
            
            pendingImportChanges.importedList.forEach(imported => {
                const existingIdx = finalCatalog.findIndex(ex => ex.csv_id === imported.csv_id);
                if (existingIdx !== -1) {
                    // Update only CSV-controlled columns (Title, Type, Links)
                    // Keep all other rich TMDB/custom metadata fields intact!
                    finalCatalog[existingIdx] = {
                        ...finalCatalog[existingIdx],
                        title: (finalCatalog[existingIdx].tmdb_id && finalCatalog[existingIdx].title) ? finalCatalog[existingIdx].title : imported.title,
                        type: imported.type,
                        links: imported.links
                    };
                } else {
                    // Set safe default values for new movies if TMDB preview wasn't fetched yet
                    finalCatalog.push({
                        ...imported,
                        categories: imported.categories || ["Main"],
                        genres: imported.genres || [],
                        overview: imported.overview || "No synopsis available.",
                        poster: imported.poster || "img/FilmHouse3_nobg.png",
                        backdrop: imported.backdrop || "img/FilmHouse.png",
                        rating: imported.rating || 0,
                        release_date: imported.release_date || "",
                        language: imported.language || "en",
                        cast: imported.cast || [],
                        director: imported.director || "",
                        trailer: imported.trailer || "",
                        runtime: imported.runtime || ""
                    });
                }
            });
            
            allCatalogMovies = finalCatalog;
            newlyAddedIds = pendingImportChanges.added.map(m => m.csv_id);
            newlyUpdatedIds = pendingImportChanges.updated.map(u => u.newMovie.csv_id);
            
            catalogChangesMade = true;
            updatePublishButtonState();
            renderCatalogList();
            
            csvReviewModal.classList.remove("active");
            alert(`Changes applied! You have ${newlyAddedIds.length} new additions and ${newlyUpdatedIds.length} updates. Click "Publish Changes 🚀" to save them to your app.`);
        }
    });
}

// Warn administrator before leaving page with unpublished changes
window.addEventListener("beforeunload", (e) => {
    if (catalogChangesMade) {
        e.preventDefault();
        e.returnValue = "You have unpublished changes. If you refresh, they will be lost!";
        return e.returnValue;
    }
});

// Fulfill Request Modal Event Listeners
let currentFulfillTitle = "";
let currentFulfillDocIds = [];
let currentFulfillReq = null;

const fulfillForm = document.getElementById("fulfill-request-form");
const fulfillRequestModal = document.getElementById("fulfill-request-modal");
const closeFulfillModalBtn = document.getElementById("btn-close-fulfill-modal");

window.closeFulfillRequestModal = function() {
    if (currentFulfillDocIds && currentFulfillDocIds.length > 0) {
        releaseClaimLock(currentFulfillTitle, currentFulfillDocIds);
    }
    const modal = document.getElementById("fulfill-request-modal");
    if (modal) {
        modal.classList.remove("active");
    }
    currentFulfillTitle = "";
    currentFulfillDocIds = [];
    currentFulfillReq = null;
    const fulfillBulkWrapper = document.getElementById("fulfill-bulk-links-wrapper");
    const fulfillBulkInput = document.getElementById("fulfill-bulk-links-input");
    const btnFulfillBulkToggle = document.getElementById("btn-fulfill-bulk-links-toggle");
    if (fulfillBulkWrapper) fulfillBulkWrapper.style.display = "none";
    if (fulfillBulkInput) fulfillBulkInput.value = "";
    if (btnFulfillBulkToggle) btnFulfillBulkToggle.textContent = "📋 Bulk Paste";
    const fulfillStreamInput = document.getElementById("fulfill-stream-url");
    if (fulfillStreamInput) fulfillStreamInput.value = "";
};

if (closeFulfillModalBtn) {
    closeFulfillModalBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeFulfillRequestModal();
    });
}

if (fulfillRequestModal) {
    fulfillRequestModal.addEventListener("click", (e) => {
        if (e.target === fulfillRequestModal) {
            closeFulfillRequestModal();
        }
    });
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const modal = document.getElementById("fulfill-request-modal");
        if (modal && modal.classList.contains("active")) {
            closeFulfillRequestModal();
        }
        closeAdminPerfModal();
    }
});

// --- BROADCAST TO UPDATES CHANNEL (Secure Backend Queue Worker) ---
window.broadcastMovieToMainChannel = async function(movieInfo) {
    if (!movieInfo || !movieInfo.title) return;
    
    const targetChannel = localStorage.getItem("filmhouse_updates_channel_id") || "-1004272961286"; // Film House Updates Channel
    const currentAdminId = sessionStorage.getItem("admin_auth_id") || window.Telegram?.WebApp?.initDataUnsafe?.user?.id || "1175336733";
    
    const rawTitle = movieInfo.title || "Movie Update";
    const cleanTitle = String(rawTitle).replace(/\s*\([^)]+\)\s*$/g, "").replace(/[*_`~]/g, "").trim();
    const yearText = movieInfo.release_date ? ` (${movieInfo.release_date.substring(0, 4)})` : (movieInfo.year ? ` (${movieInfo.year})` : "");
    const isSeries = (movieInfo.type || "").toLowerCase() === "series" || (movieInfo.type || "").toLowerCase() === "tv";
    const rawSeason = movieInfo.seasonOrPart || (isSeries ? "Complete Series" : "Full Movie");

    let seasonOrQualityText = isSeries 
        ? (String(rawSeason).toLowerCase().includes("season") ? rawSeason : `Season ${rawSeason}`)
        : (String(rawSeason).toLowerCase().includes("quality") ? rawSeason : `${rawSeason} Quality`);
    if (movieInfo.isSeriesComplete) {
        seasonOrQualityText = "Complete Series | All Seasons";
    }

    if (!movieInfo.overview || !movieInfo.genres || !movieInfo.backdrop) {
        try {
            const numericId = parseInt(String(movieInfo.tmdb_id || movieInfo.csv_id || movieInfo.id || "").split("-")[0]);
            const mediaType = isSeries ? 'tv' : 'movie';
            let tmdbResult = null;
            if (!isNaN(numericId) && numericId > 0) {
                const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${numericId}?api_key=${TMDB_API_KEY}`);
                if (res.ok) tmdbResult = await res.json();
            }
            if (!tmdbResult) {
                const yearParam = movieInfo.year ? (isSeries ? `&first_air_date_year=${movieInfo.year}` : `&primary_release_year=${movieInfo.year}`) : '';
                const searchRes = await fetch(`https://api.themoviedb.org/3/search/${mediaType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}${yearParam}`);
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData.results && searchData.results.length > 0) {
                        tmdbResult = searchData.results[0];
                    }
                }
            }
            if (tmdbResult) {
                if (!movieInfo.overview && tmdbResult.overview) movieInfo.overview = tmdbResult.overview;
                if ((!movieInfo.genres || movieInfo.genres.length === 0) && tmdbResult.genres) {
                    movieInfo.genres = tmdbResult.genres.map(g => (g && g.name) ? g.name : g);
                }
                if (!movieInfo.rating && tmdbResult.vote_average) {
                    movieInfo.rating = Math.round(tmdbResult.vote_average * 10) / 10;
                }
                if (!movieInfo.backdrop && tmdbResult.backdrop_path) {
                    movieInfo.backdrop = `https://image.tmdb.org/t/p/w1280${tmdbResult.backdrop_path}`;
                }
                if (!movieInfo.poster && tmdbResult.poster_path) {
                    movieInfo.poster = `https://image.tmdb.org/t/p/w1280${tmdbResult.poster_path}`;
                }
            }
        } catch (enrichErr) {
            console.warn("[MAIN CHANNEL POST] TMDB enrichment warning:", enrichErr);
        }
    }

    const rawGenres = Array.isArray(movieInfo.genres) ? movieInfo.genres : (Array.isArray(movieInfo.categories) ? movieInfo.categories : []);
    const ratingVal = movieInfo.rating || movieInfo.vote_average || "";
    const movieId = movieInfo.csv_id || movieInfo.tmdb_id || movieInfo.id || "";

    let bannerUrl = "";
    const lPoster = movieInfo.landscape_poster || movieInfo.landscapePoster || movieInfo.landscape;
    if (lPoster && String(lPoster).startsWith("http")) {
        bannerUrl = lPoster;
    } else if (movieInfo.backdrop && String(movieInfo.backdrop).startsWith("http")) {
        bannerUrl = movieInfo.backdrop;
    } else if (movieInfo.poster && String(movieInfo.poster).startsWith("http")) {
        bannerUrl = movieInfo.poster;
    } else {
        bannerUrl = "https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png";
    }

    if (bannerUrl.includes("image.tmdb.org/t/p/w500") || bannerUrl.includes("image.tmdb.org/t/p/w300") || bannerUrl.includes("image.tmdb.org/t/p/w780")) {
        bannerUrl = bannerUrl.replace(/\/w(300|500|780)\//, "/w1280/");
    }

    console.log(`[UPDATES CHANNEL POST] Queuing "${cleanTitle}" announcement to Updates Channel via secure backend worker...`);

    try {
        if (typeof firebase === "undefined" || !db) {
            console.error("Firestore is not available to queue broadcast.");
            return;
        }

        const queuePayload = {
            type: "channel_post",
            adminId: String(currentAdminId),
            channelId: targetChannel,
            movie: {
                title: cleanTitle,
                release_date: movieInfo.release_date || "",
                year: movieInfo.year || "",
                type: movieInfo.type || "",
                seasonOrPart: seasonOrQualityText,
                isSeriesComplete: !!movieInfo.isSeriesComplete,
                broadcastMode: movieInfo.broadcastMode || (movieInfo.isUpdate ? "updated" : (isSeries && String(seasonOrQualityText).toLowerCase().includes("season") ? "updated" : "released")),
                isUpdate: (movieInfo.broadcastMode === "updated") || !!movieInfo.isUpdate,
                genres: rawGenres,
                rating: ratingVal,
                overview: movieInfo.overview || "",
                csv_id: movieId,
                backdrop: bannerUrl,
                poster: bannerUrl
            },
            status: "pending",
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        let taskId = null;
        try {
            const taskRef = await db.collection("admin_broadcast_queue").add(queuePayload);
            taskId = taskRef.id;
        } catch (queueErr) {
            console.warn("Primary admin_broadcast_queue failed, attempting settings/broadcast_queue fallback:", queueErr);
            await db.collection("settings").doc("broadcast_queue").set({
                ...queuePayload,
                fallbackId: "task_" + Date.now()
            });
            taskId = "fallback_" + Date.now();
        }

        showToast(`📢 Announcement for "${cleanTitle}" queued for channel broadcast! ✈️`, "success");
        if (typeof window.recordAdminActivity === 'function') {
            window.recordAdminActivity("publication", cleanTitle);
        }
        return { ok: true, taskId: taskId };
    } catch (e) {
        console.error("[UPDATES CHANNEL POST] Error queuing broadcast to Firestore:", e);
        showToast(`❌ Failed to queue announcement: ${e.message}`, "error");
    }
};

// --- FRESH ADMIN PERFORMANCE & ACTIVITY RANKINGS LOGIC ---
let adminStatsCache = {};
// Starting fresh from today (September 2026) - ignores past arbitrary legacy counts
const FRESH_RANKING_START_MS = 1790200000000;

function initAdminLeaderboardListener() {
    if (typeof firebase === "undefined" || !db) return;
    try {
        db.collection("settings").doc("admin_stats").onSnapshot(doc => {
            if (doc.exists) {
                adminStatsCache = doc.data() || {};
            } else {
                adminStatsCache = {};
            }
            renderAdminLeaderboard();
        }, err => {
            console.warn("Could not listen to admin_stats:", err.message);
            renderAdminLeaderboard();
        });
    } catch (e) {
        console.warn("Error setting up admin_stats listener:", e);
    }
}

// Track Admin Activity (Fulfillments & Publications)
window.recordAdminActivity = function(type, title) {
    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    let currentAdminName = tgUser ? (tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name || 'Admin'}`) : (localStorage.getItem("filmhouse_admin_name") || sessionStorage.getItem("admin_auth_name") || "");
    let currentAdminId = String(tgUser ? tgUser.id : (sessionStorage.getItem("admin_auth_id") || new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || localStorage.getItem("filmhouse_admin_id") || ""));

    if (!currentAdminId || currentAdminId.toLowerCase() === "admin") {
        const savedName = (currentAdminName || "").toLowerCase();
        if (savedName.includes("joel") || savedName.includes("damnitz")) {
            currentAdminId = "1175336733";
            currentAdminName = "@damnitzjoel";
        } else if (savedName.includes("siaw") || savedName.includes("blaze")) {
            currentAdminId = "1329840839";
            currentAdminName = "@Siawblaze";
        } else {
            currentAdminId = "1175336733";
            currentAdminName = currentAdminName || "@damnitzjoel";
        }
    }

    try {
        localStorage.setItem("filmhouse_admin_id", currentAdminId);
        if (currentAdminName) localStorage.setItem("filmhouse_admin_name", currentAdminName);
    } catch (_) {}

    const adminKey = currentAdminId.replace(/[^a-zA-Z0-9_]/g, "_");

    if (!adminStatsCache[adminKey]) {
        adminStatsCache[adminKey] = {
            id: currentAdminId,
            name: currentAdminName || `Admin (${currentAdminId})`,
            fulfillments: 0,
            publications: 0,
            score: 0,
            lastActiveAt: Date.now(),
            titles: []
        };
    }

    if (title) {
        adminStatsCache[adminKey].titles = adminStatsCache[adminKey].titles || [];
        const cleanT = String(title).trim();
        const existingIdx = adminStatsCache[adminKey].titles.findIndex(t => t.title && t.title.toLowerCase() === cleanT.toLowerCase());
        if (existingIdx >= 0) {
            adminStatsCache[adminKey].titles[existingIdx].date = new Date().toISOString();
        } else {
            adminStatsCache[adminKey].titles.unshift({
                type: type,
                title: cleanT,
                date: new Date().toISOString()
            });
        }
        if (adminStatsCache[adminKey].titles.length > 30) {
            adminStatsCache[adminKey].titles = adminStatsCache[adminKey].titles.slice(0, 30);
        }
    }

    // Accumulate lifetime counts instead of capping to the 30-item slice
    if (type === "publication") {
        adminStatsCache[adminKey].publications = (adminStatsCache[adminKey].publications || 0) + 1;
    } else if (type === "fulfillment") {
        adminStatsCache[adminKey].fulfillments = (adminStatsCache[adminKey].fulfillments || 0) + 1;
    }

    // Keep counts at least as high as verified recent titles
    const recentF = (adminStatsCache[adminKey].titles || []).filter(t => t.type === "fulfillment" || !t.type).length;
    const recentP = (adminStatsCache[adminKey].titles || []).filter(t => t.type === "publication").length;
    adminStatsCache[adminKey].fulfillments = Math.max(adminStatsCache[adminKey].fulfillments || 0, recentF);
    adminStatsCache[adminKey].publications = Math.max(adminStatsCache[adminKey].publications || 0, recentP);
    adminStatsCache[adminKey].score = ((adminStatsCache[adminKey].fulfillments || 0) * 10) + ((adminStatsCache[adminKey].publications || 0) * 10);
    adminStatsCache[adminKey].lastActiveAt = Date.now();
    if (currentAdminName) adminStatsCache[adminKey].name = currentAdminName;

    // Purge fake legacy keys if present
    delete adminStatsCache.admin;
    delete adminStatsCache.Admin;

    try {
        localStorage.setItem("filmhouse_admin_stats_cache", JSON.stringify(adminStatsCache));
        if (db) {
            db.collection("settings").doc("admin_stats").set(adminStatsCache, { merge: true }).catch(err => {
                console.warn("Could not save admin stats to Firestore (quota or permission):", err.message);
            });
        }
    } catch (e) {}

    renderAdminLeaderboard();
};

// Batch track Admin Activity (e.g. batch TMDB imports or batch catalog additions)
window.recordAdminBatchActivity = function(type, titles) {
    if (!Array.isArray(titles) || titles.length === 0) return;
    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    let currentAdminName = tgUser ? (tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name || 'Admin'}`) : (localStorage.getItem("filmhouse_admin_name") || sessionStorage.getItem("admin_auth_name") || "");
    let currentAdminId = String(tgUser ? tgUser.id : (sessionStorage.getItem("admin_auth_id") || new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || localStorage.getItem("filmhouse_admin_id") || ""));

    if (!currentAdminId || currentAdminId.toLowerCase() === "admin") {
        const savedName = (currentAdminName || "").toLowerCase();
        if (savedName.includes("joel") || savedName.includes("damnitz")) {
            currentAdminId = "1175336733";
            currentAdminName = "@damnitzjoel";
        } else if (savedName.includes("siaw") || savedName.includes("blaze")) {
            currentAdminId = "1329840839";
            currentAdminName = "@Siawblaze";
        } else {
            currentAdminId = "1175336733";
            currentAdminName = currentAdminName || "@damnitzjoel";
        }
    }

    try {
        localStorage.setItem("filmhouse_admin_id", currentAdminId);
        if (currentAdminName) localStorage.setItem("filmhouse_admin_name", currentAdminName);
    } catch (_) {}

    const adminKey = currentAdminId.replace(/[^a-zA-Z0-9_]/g, "_");

    if (!adminStatsCache[adminKey]) {
        adminStatsCache[adminKey] = {
            id: currentAdminId,
            name: currentAdminName || `Admin (${currentAdminId})`,
            fulfillments: 0,
            publications: 0,
            score: 0,
            lastActiveAt: Date.now(),
            titles: []
        };
    }

    adminStatsCache[adminKey].titles = adminStatsCache[adminKey].titles || [];

    titles.forEach(tStr => {
        const cleanT = String(tStr).trim();
        if (!cleanT) return;
        const existingIdx = adminStatsCache[adminKey].titles.findIndex(t => t.title && t.title.toLowerCase() === cleanT.toLowerCase());
        if (existingIdx >= 0) {
            adminStatsCache[adminKey].titles[existingIdx].date = new Date().toISOString();
        } else {
            adminStatsCache[adminKey].titles.unshift({
                type: type,
                title: cleanT,
                date: new Date().toISOString()
            });
        }
    });

    if (adminStatsCache[adminKey].titles.length > 30) {
        adminStatsCache[adminKey].titles = adminStatsCache[adminKey].titles.slice(0, 30);
    }

    // Atomically increment cumulative count by the batch size
    if (type === "publication") {
        adminStatsCache[adminKey].publications = (adminStatsCache[adminKey].publications || 0) + titles.length;
    } else if (type === "fulfillment") {
        adminStatsCache[adminKey].fulfillments = (adminStatsCache[adminKey].fulfillments || 0) + titles.length;
    }

    const recentF = (adminStatsCache[adminKey].titles || []).filter(t => t.type === "fulfillment" || !t.type).length;
    const recentP = (adminStatsCache[adminKey].titles || []).filter(t => t.type === "publication").length;
    adminStatsCache[adminKey].fulfillments = Math.max(adminStatsCache[adminKey].fulfillments || 0, recentF);
    adminStatsCache[adminKey].publications = Math.max(adminStatsCache[adminKey].publications || 0, recentP);
    adminStatsCache[adminKey].score = ((adminStatsCache[adminKey].fulfillments || 0) * 10) + ((adminStatsCache[adminKey].publications || 0) * 10);
    adminStatsCache[adminKey].lastActiveAt = Date.now();
    if (currentAdminName) adminStatsCache[adminKey].name = currentAdminName;

    delete adminStatsCache.admin;
    delete adminStatsCache.Admin;

    try {
        localStorage.setItem("filmhouse_admin_stats_cache", JSON.stringify(adminStatsCache));
        if (db) {
            db.collection("settings").doc("admin_stats").set(adminStatsCache, { merge: true }).catch(err => {
                console.warn("Could not save batch admin stats to Firestore:", err.message);
            });
        }
    } catch (e) {}

    renderAdminLeaderboard();
};

function getComputedAdminRankings() {
    const adminMap = {};

    // 1. Seed known, verified admins only
    const verifiedAdminIds = Array.from(new Set([
        ...(window.cachedMasterAdminIds || []),
        ...(window.cachedSlaveAdminIds || []),
        ...(Array.isArray(adminIdsList) ? adminIdsList : []),
        "1329840839", "1175336733", "8266055508", "6462272022", "978567096"
    ])).map(s => String(s).trim()).filter(Boolean);

    verifiedAdminIds.forEach(id => {
        const uidStr = String(id).trim();
        if (!uidStr) return;
        const key = uidStr.replace(/[^a-zA-Z0-9_]/g, "_");
        const userMatch = Array.isArray(allUsers) ? allUsers.find(u => String(u.id) === uidStr) : null;
        let name = userMatch ? (userMatch.username ? `@${userMatch.username}` : (userMatch.fullName || `Admin (${uidStr})`)) : `Admin (${uidStr})`;
        
        // Known defaults for master admins
        if (uidStr === "1329840839" && (!name || name.startsWith("Admin ("))) name = "@Siawblaze";
        if (uidStr === "1175336733" && (!name || name.startsWith("Admin ("))) name = "@damnitzjoel";

        adminMap[key] = {
            id: uidStr,
            name: name,
            fulfillments: 0,
            publications: 0,
            score: 0,
            titles: [],
            lastActiveAt: null
        };
    });

    if (Array.isArray(allUsers)) {
        allUsers.forEach(u => {
            const uidStr = String(u.id).trim();
            const isAdm = (u.role === 'admin' || u.role === 'slave_admin' || u.isSlaveAdmin || u.isAdmin || verifiedAdminIds.includes(uidStr));
            if (isAdm) {
                const key = uidStr.replace(/[^a-zA-Z0-9_]/g, "_");
                const name = u.username ? `@${u.username}` : (u.fullName || `Admin (${u.id})`);
                if (!adminMap[key]) {
                    adminMap[key] = {
                        id: uidStr,
                        name: name,
                        fulfillments: 0,
                        publications: 0,
                        score: 0,
                        titles: [],
                        lastActiveAt: null
                    };
                } else if (u.username && (!adminMap[key].name || adminMap[key].name.startsWith("Admin ("))) {
                    adminMap[key].name = `@${u.username}`;
                }
            }
        });
    }

    // 2. Count fulfillments from allRequests (only fresh ones starting from today)
    if (Array.isArray(allRequests)) {
        allRequests.forEach(req => {
            if (req.status === "fulfilled" || req.status === "claimed" || req.claimed === true) {
                let fulfilledMs = 0;
                if (req.fulfilledAt) {
                    fulfilledMs = req.fulfilledAt.toDate ? req.fulfilledAt.toDate().getTime() : new Date(req.fulfilledAt).getTime();
                }
                // Filter out legacy requests without timestamp or before fresh start
                if (!fulfilledMs || fulfilledMs < FRESH_RANKING_START_MS) return;

                const reqAdminId = String(req.fulfilledById || req.adminClaimId || "").trim();
                const reqAdminName = String(req.fulfilledBy || req.adminClaimName || "").trim();

                // Skip generic placeholder "Admin" or unverified IDs
                if (!reqAdminId && (!reqAdminName || reqAdminName.toLowerCase() === "admin")) return;

                // Match to verified admin
                let matchedKey = null;
                const idKey = reqAdminId ? reqAdminId.replace(/[^a-zA-Z0-9_]/g, "_") : "";
                if (idKey && adminMap[idKey]) {
                    matchedKey = idKey;
                } else if (reqAdminId && verifiedAdminIds.includes(reqAdminId)) {
                    matchedKey = idKey;
                } else if (reqAdminName) {
                    const cleanReqName = reqAdminName.toLowerCase().replace(/^@/, '');
                    matchedKey = Object.keys(adminMap).find(k => {
                        const admName = (adminMap[k].name || "").toLowerCase().replace(/^@/, '');
                        return admName === cleanReqName || admName.includes(cleanReqName);
                    });
                }

                if (!matchedKey || !adminMap[matchedKey]) return;

                if (fulfilledMs > (adminMap[matchedKey].lastActiveAt || 0)) {
                    adminMap[matchedKey].lastActiveAt = fulfilledMs;
                }

                const titleKey = (req.title || "").trim();
                if (titleKey) {
                    const existingTitle = adminMap[matchedKey].titles.find(t => t.title && t.title.toLowerCase() === titleKey.toLowerCase());
                    if (!existingTitle) {
                        adminMap[matchedKey].titles.push({
                            type: "fulfillment",
                            title: req.title,
                            year: req.year || "",
                            user: req.requestedBy || "User",
                            date: fulfilledMs ? new Date(fulfilledMs) : new Date()
                        });
                    }
                }
            }
        });
    }

    // 3. Merge with adminStatsCache
    if (adminStatsCache && typeof adminStatsCache === "object") {
        Object.keys(adminStatsCache).forEach(k => {
            const stat = adminStatsCache[k];
            if (!stat) return;
            const kLower = k.toLowerCase();
            const statNameLower = (stat.name || "").toLowerCase();
            // Purge fake Admin entry
            if (kLower === "admin" || statNameLower === "admin") return;

            const lastActive = stat.lastActiveAt ? (typeof stat.lastActiveAt === 'number' ? stat.lastActiveAt : new Date(stat.lastActiveAt).getTime()) : 0;
            if (lastActive > 0 && lastActive < FRESH_RANKING_START_MS && !stat.publications) return;

            let matchedKey = null;
            if (adminMap[k]) {
                matchedKey = k;
            } else if (verifiedAdminIds.includes(k) || verifiedAdminIds.includes(String(stat.id))) {
                matchedKey = (stat.id || k).replace(/[^a-zA-Z0-9_]/g, "_");
                if (!adminMap[matchedKey]) {
                    adminMap[matchedKey] = {
                        id: stat.id || k,
                        name: stat.name || k,
                        fulfillments: 0,
                        publications: 0,
                        score: 0,
                        titles: [],
                        lastActiveAt: lastActive || null
                    };
                }
            } else if (stat.name) {
                const cleanStatName = statNameLower.replace(/^@/, '');
                matchedKey = Object.keys(adminMap).find(mKey => {
                    const admName = (adminMap[mKey].name || "").toLowerCase().replace(/^@/, '');
                    return admName === cleanStatName;
                });
            }

            if (!matchedKey || !adminMap[matchedKey]) return;

            if (lastActive > (adminMap[matchedKey].lastActiveAt || 0)) {
                adminMap[matchedKey].lastActiveAt = lastActive;
            }
            if (stat.name && (!adminMap[matchedKey].name || adminMap[matchedKey].name.startsWith("Admin ("))) {
                adminMap[matchedKey].name = stat.name;
            }
            if (stat.publications) {
                adminMap[matchedKey].publications = Math.max(adminMap[matchedKey].publications || 0, stat.publications);
            }
            if (stat.fulfillments || stat.count) {
                adminMap[matchedKey].fulfillments = Math.max(adminMap[matchedKey].fulfillments || 0, stat.fulfillments || stat.count || 0);
            }
            if (Array.isArray(stat.titles) && stat.titles.length > 0) {
                stat.titles.forEach(st => {
                    if (st && st.title && !adminMap[matchedKey].titles.some(t => t.title && t.title.toLowerCase() === st.title.toLowerCase())) {
                        adminMap[matchedKey].titles.push(st);
                    }
                });
            }
        });
    }

    // 4. Calculate total score and relative Work Share Percentage
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const adminList = Object.values(adminMap)
        .filter(adm => {
            if (!adm) return false;
            const nameLower = (adm.name || "").toLowerCase().trim();
            if (nameLower === "admin" && !verifiedAdminIds.includes(String(adm.id))) return false;
            return true;
        })
        .map(adm => {
            const fulfillmentTitles = (adm.titles || []).filter(t => t.type === 'fulfillment' || !t.type);
            const publicationTitles = (adm.titles || []).filter(t => t.type === 'publication');

            adm.fulfillments = Math.max(adm.fulfillments || 0, fulfillmentTitles.length);
            adm.publications = Math.max(adm.publications || 0, publicationTitles.length);
            adm.workUnits = adm.fulfillments + adm.publications;
            adm.score = (adm.fulfillments * 10) + (adm.publications * 10);
            adm.isActive24h = adm.lastActiveAt ? (now - adm.lastActiveAt <= oneDayMs) : false;
            return adm;
        });

    // Calculate team total work units
    const totalTeamWorkUnits = adminList.reduce((sum, adm) => sum + (adm.workUnits || 0), 0);

    adminList.forEach(adm => {
        adm.workSharePercent = totalTeamWorkUnits > 0
            ? Math.round((adm.workUnits / totalTeamWorkUnits) * 100)
            : 0;
    });

    // Sort by workUnits descending, then lastActiveAt descending
    adminList.sort((a, b) => {
        if (b.workUnits !== a.workUnits) return b.workUnits - a.workUnits;
        return (b.lastActiveAt || 0) - (a.lastActiveAt || 0);
    });

    return adminList;
}

function renderAdminLeaderboard() {
    const adminList = getComputedAdminRankings();
    const activeAdmins = adminList.filter(a => a.isActive24h);
    const activeCount = activeAdmins.length;

    // Update 4th card in Command Center 2x2 matrix
    const activeCountEl = document.getElementById("stat-active-admins-count");
    if (activeCountEl) {
        activeCountEl.textContent = activeCount;
    }

    const topSubEl = document.getElementById("stat-top-admin-sub");
    if (topSubEl) {
        const topAdmin = adminList.find(a => a.workUnits > 0);
        if (topAdmin) {
            topSubEl.textContent = `Top: ${escapeHTML(topAdmin.name)} (${topAdmin.workSharePercent}% Work Share)`;
        } else {
            topSubEl.textContent = `${activeCount} active in last 24h`;
        }
    }
}

window.openAdminRankingsModal = function(filter = 'active') {
    const modal = document.getElementById("admin-perf-modal");
    const titleEl = document.getElementById("admin-perf-modal-title");
    const bodyEl = document.getElementById("admin-perf-modal-body");
    if (!modal || !bodyEl) return;

    if (titleEl) {
        titleEl.innerHTML = `🏆 Admin Performance Rankings`;
    }

    const adminList = getComputedAdminRankings();
    const activeAdmins = adminList.filter(a => a.isActive24h);
    const displayList = (filter === 'active') ? activeAdmins : adminList;

    let listHtml = "";
    if (displayList.length === 0) {
        listHtml = `
            <div style="padding: 28px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
                ${filter === 'active' 
                    ? '😴 No admins active in the last 24 hours. Fulfill a request or publish a movie to get ranked!' 
                    : '🎯 Rankings start fresh today! Fulfill movie requests or publish duty titles to lead the team!'}
            </div>
        `;
    } else {
        listHtml = displayList.map((adm, idx) => {
            const rank = idx + 1;
            let rankBadge = "";
            let rankColor = "#ffbc00";
            if (rank === 1) {
                rankBadge = "🥇";
            } else if (rank === 2) {
                rankBadge = "🥈";
                rankColor = "#dcdcdc";
            } else if (rank === 3) {
                rankBadge = "🥉";
                rankColor = "#cd7f32";
            } else {
                rankBadge = `#${rank}`;
                rankColor = "var(--text-muted)";
            }

            const initial = (adm.name.replace(/^@/, "").charAt(0) || "A").toUpperCase();
            const timeAgo = adm.lastActiveAt ? formatTimeAgo(adm.lastActiveAt) : "Not yet active";

            return `
                <div style="display: flex; flex-direction: column; background: rgba(255,255,255,0.02); border: 1px solid ${rank === 1 ? 'rgba(255, 188, 0, 0.3)' : 'rgba(255,255,255,0.06)'}; border-radius: 10px; padding: 12px; margin-bottom: 8px; transition: border-color 0.2s;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                            <span style="font-size: 18px; font-weight: 800; min-width: 24px; text-align: center; color: ${rankColor};">${rankBadge}</span>
                            <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, rgba(255, 188, 0, 0.2), rgba(255, 59, 48, 0.2)); display: flex; align-items: center; justify-content: center; font-weight: 800; color: #ffbc00; font-size: 14px; border: 1px solid rgba(255, 188, 0, 0.3); flex-shrink: 0;">
                                ${initial}
                            </div>
                            <div style="min-width: 0;">
                                <div style="font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                                    ${escapeHTML(adm.name)}
                                </div>
                                <div style="font-size: 10px; color: ${adm.isActive24h ? '#4caf50' : 'var(--text-muted)'}; margin-top: 2px;">
                                    ${adm.isActive24h ? '🟢 Active in last 24h' : `⚪ ${timeAgo}`}
                                </div>
                            </div>
                        </div>
                        <div style="text-align: right; flex-shrink: 0;">
                            <div style="font-size: 16px; font-weight: 800; color: #ffbc00; font-family: var(--font-heading);">${adm.workSharePercent}% <span style="font-size: 10px; color: rgba(255,255,255,0.6); font-family: inherit;">Work Share</span></div>
                            <div style="font-size: 9px; color: var(--text-muted); margin-top: 1px;">${adm.workUnits || 0} total tasks</div>
                        </div>
                    </div>
                    <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; margin-top: 8px; overflow: hidden;">
                        <div style="width: ${adm.workSharePercent}%; height: 100%; background: linear-gradient(90deg, #ffbc00, #ff5722); border-radius: 2px; transition: width 0.4s ease;"></div>
                    </div>
                    <div style="display: flex; gap: 6px; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.04); flex-wrap: wrap; align-items: center;">
                        <span style="font-size: 10px; background: rgba(255, 188, 0, 0.12); color: #ffbc00; padding: 2px 8px; border-radius: 10px; font-weight: 700;">📥 ${adm.fulfillments || 0} Fulfilled</span>
                        <span style="font-size: 10px; background: rgba(0, 136, 204, 0.15); color: #0088cc; padding: 2px 8px; border-radius: 10px; font-weight: 700;">🎬 ${adm.publications || 0} Published</span>
                        ${adm.titles && adm.titles.length > 0 ? `<button type="button" onclick="showAdminTitlesBreakdown('${adm.id}')" style="margin-left: auto; background: none; border: none; color: var(--primary-color); font-size: 10px; font-weight: 700; cursor: pointer; text-decoration: underline;">View ${adm.titles.length} Titles ❯</button>` : ''}
                    </div>
                </div>
            `;
        }).join("");
    }

    bodyEl.innerHTML = `
        <div style="display: flex; gap: 8px; margin-bottom: 14px; background: rgba(255,255,255,0.03); padding: 4px; border-radius: 8px; border: 1px solid var(--border-color);">
            <button class="btn btn-sm ${filter === 'active' ? 'btn-primary' : 'btn-secondary'}" onclick="openAdminRankingsModal('active')" style="flex: 1; height: 32px; font-size: 11px; font-weight: 700;">⚡ Active (Last 24h) (${activeAdmins.length})</button>
            <button class="btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="openAdminRankingsModal('all')" style="flex: 1; height: 32px; font-size: 11px; font-weight: 700;">🏆 All Ranked (${adminList.length})</button>
        </div>
        <p style="font-size: 11px; color: var(--text-secondary); margin: 0 0 12px 0; line-height: 1.4;">
            📊 <i>Rankings allocate percentages rather than points to measure each admin's relative share of total team work (fulfillments + duty publications).</i>
        </p>
        <div style="max-height: 340px; overflow-y: auto; padding-right: 4px;">
            ${listHtml}
        </div>
        <button type="button" class="btn btn-secondary btn-block" onclick="closeAdminPerfModal()" style="margin-top: 14px; height: 38px;">Close</button>
    `;

    modal.classList.add("active");
};

function formatTimeAgo(timestamp) {
    if (!timestamp) return "Never";
    const ms = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

window.showAdminTitlesBreakdown = function(adminId) {
    const adminList = getComputedAdminRankings();
    const adm = adminList.find(a => String(a.id) === String(adminId));
    if (!adm || !adm.titles || adm.titles.length === 0) return;

    const bodyEl = document.getElementById("admin-perf-modal-body");
    if (!bodyEl) return;

    const titlesHtml = adm.titles.map(t => {
        const timeStr = t.date ? (t.date.toLocaleDateString ? t.date.toLocaleDateString() : new Date(t.date).toLocaleDateString()) : "Recent";
        const isFulfill = t.type === "fulfillment";
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; font-size: 12px; margin-bottom: 6px;">
                <div>
                    <div style="font-weight: 700; color: #fff;">${isFulfill ? '🍿' : '🎬'} ${escapeHTML(t.title)}</div>
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${isFulfill ? 'Request Fulfilled' : 'Catalog / Channel Published'} • ${timeStr}</div>
                </div>
                <span style="font-size: 10px; color: ${isFulfill ? '#4caf50' : '#0088cc'}; background: ${isFulfill ? 'rgba(76, 175, 80, 0.12)' : 'rgba(0, 136, 204, 0.12)'}; padding: 3px 8px; border-radius: 4px; font-weight: 700;">
                    ${isFulfill ? '🟢 Fulfilled' : '📢 Published'}
                </span>
            </div>
        `;
    }).join("");

    bodyEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="openAdminRankingsModal('all')" style="padding: 4px 10px; font-size: 11px;">❮ Back to Rankings</button>
            <span style="font-size: 13px; font-weight: 700; color: #fff;">${escapeHTML(adm.name)}'s Activity</span>
        </div>
        <div style="max-height: 320px; overflow-y: auto; padding-right: 4px;">
            ${titlesHtml}
        </div>
        <button type="button" class="btn btn-secondary btn-block" onclick="closeAdminPerfModal()" style="margin-top: 14px; height: 38px;">Close</button>
    `;
};

window.closeAdminPerfModal = function() {
    const modal = document.getElementById("admin-perf-modal");
    if (modal) modal.classList.remove("active");
};

// Bind modal background for admin perf modal
const adminPerfModal = document.getElementById("admin-perf-modal");

// --- LIVE STREAMERS & AUDIENCE PRESENCE TRACKING ---
let activeStreamersUnsubscribe = null;
let currentActiveStreamersList = [];
let totalStreamPlaysCount = 0;

function listenToActiveStreamers() {
    if (typeof firebase === "undefined" || !db) return;

    // Listen to stream metrics
    db.collection("settings").doc("stream_metrics").onSnapshot(doc => {
        if (doc && doc.exists) {
            const data = doc.data();
            totalStreamPlaysCount = data.totalStreamPlays || 0;
            const statPlaysEl = document.getElementById("stat-stream-plays-num");
            if (statPlaysEl) statPlaysEl.textContent = totalStreamPlaysCount.toLocaleString();
            const modalPlaysEl = document.getElementById("modal-total-streams-count");
            if (modalPlaysEl) modalPlaysEl.textContent = totalStreamPlaysCount.toLocaleString();
        }
    }, err => {
        console.warn("stream_metrics listener error:", err);
    });

    // Listen to real-time active_streams
    if (activeStreamersUnsubscribe) activeStreamersUnsubscribe();
    activeStreamersUnsubscribe = db.collection("active_streams").onSnapshot(snapshot => {
        const now = Date.now();
        const activeList = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            let lastHeartbeatMs = 0;
            if (data.lastHeartbeat && data.lastHeartbeat.toMillis) {
                lastHeartbeatMs = data.lastHeartbeat.toMillis();
            } else if (data.lastHeartbeat instanceof Date) {
                lastHeartbeatMs = data.lastHeartbeat.getTime();
            } else if (typeof data.lastHeartbeat === "number") {
                lastHeartbeatMs = data.lastHeartbeat;
            } else {
                lastHeartbeatMs = now;
            }

            // Kept active if heartbeat within last 90 seconds
            if (now - lastHeartbeatMs < 90000) {
                activeList.push({
                    id: doc.id,
                    ...data,
                    lastHeartbeatMs
                });
            } else {
                // Clean up stale doc
                doc.ref.delete().catch(() => {});
            }
        });

        currentActiveStreamersList = activeList;
        renderActiveStreamersUI();
    }, err => {
        console.warn("active_streams listener error:", err);
    });
}

function renderActiveStreamersUI() {
    const activeCount = currentActiveStreamersList.length;
    
    // Update dashboard counter
    const liveCountEl = document.getElementById("stat-live-count");
    if (liveCountEl) liveCountEl.textContent = activeCount;

    const liveSubEl = document.getElementById("stat-live-streamers-sub");
    if (liveSubEl) {
        liveSubEl.textContent = activeCount === 1 
            ? "1 active viewer right now" 
            : `${activeCount} active viewers right now`;
    }

    const quickLiveEl = document.getElementById("quick-bar-live-count");
    if (quickLiveEl) { quickLiveEl.textContent = activeCount; quickLiveEl.style.display = activeCount > 0 ? "inline-block" : "none"; }
    const modalCountEl = document.getElementById("modal-live-streamers-count");
    if (modalCountEl) modalCountEl.textContent = activeCount;

    // Render list in modal
    const listEl = document.getElementById("live-streamers-list");
    if (!listEl) return;

    if (activeCount === 0) {
        listEl.innerHTML = `
            <div style="padding: 32px 16px; text-align: center; color: var(--text-muted); font-size: 13px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px dashed rgba(255,255,255,0.08);">
                <div style="font-size: 32px; margin-bottom: 8px;">📺</div>
                <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">No Active Streamers Right Now</div>
                <div style="font-size: 11px;">When a user opens the video player in the Film House app, their live presence will show up here instantly.</div>
            </div>
        `;
        return;
    }

    const now = Date.now();
    listEl.innerHTML = currentActiveStreamersList.map(st => {
        let startedMs = now;
        if (st.startedAt && st.startedAt.toMillis) startedMs = st.startedAt.toMillis();
        else if (st.startedAt instanceof Date) startedMs = st.startedAt.getTime();
        
        const elapsedMinutes = Math.max(0, Math.floor((now - startedMs) / 60000));
        const durationText = elapsedMinutes === 0 ? "Just started" : `Streaming for ${elapsedMinutes}m`;
        
        const avatarInitial = (st.name && st.name.charAt(0) ? st.name.charAt(0) : "V").toUpperCase();
        const tgLink = st.username ? `https://t.me/${st.username}` : (st.userId && !st.userId.startsWith("guest") ? `tg://user?id=${st.userId}` : "");

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; gap: 10px; transition: border-color 0.2s;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, rgba(255,59,48,0.2) 0%, rgba(255,188,0,0.2) 100%); border: 1px solid rgba(255,59,48,0.4); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; color: #ffbc00; flex-shrink: 0;">
                        ${escapeHTML(avatarInitial)}
                    </div>
                    <div style="min-width: 0; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 13px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(st.name || "Viewer")}</span>
                            ${tgLink ? `<a href="${tgLink}" target="_blank" style="font-size: 11px; color: #00c8ff; text-decoration: none;" title="Open on Telegram">✈️</a>` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                            <span style="font-size: 11px; color: #ffbc00; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🎬 ${escapeHTML(st.title || "Cinema Stream")}</span>
                            <span style="font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(255,255,255,0.06); color: var(--text-muted);">${escapeHTML(st.type || "Movie")}</span>
                        </div>
                    </div>
                </div>

                <div style="text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
                    <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700; background: rgba(255,59,48,0.15); border: 1px solid rgba(255,59,48,0.3); color: #ff453a; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
                        <span style="width: 5px; height: 5px; background: #ff453a; border-radius: 50%; box-shadow: 0 0 5px #ff453a; animation: pulse 1.5s infinite;"></span>
                        <span>LIVE</span>
                    </span>
                    <span style="font-size: 10px; color: var(--text-muted);">${durationText}</span>
                </div>
            </div>
        `;
    }).join("");
}

window.openLiveStreamersModal = function() {
    const modal = document.getElementById("live-streamers-modal");
    if (modal) {
        modal.classList.add("active");
        renderActiveStreamersUI();
    }
};

window.closeLiveStreamersModal = function() {
    const modal = document.getElementById("live-streamers-modal");
    if (modal) modal.classList.remove("active");
};

const liveStreamersModal = document.getElementById("live-streamers-modal");
if (liveStreamersModal) {
    liveStreamersModal.addEventListener("click", (e) => {
        if (e.target === liveStreamersModal) closeLiveStreamersModal();
    });
}
if (adminPerfModal) {
    adminPerfModal.addEventListener("click", (e) => {
        if (e.target === adminPerfModal) closeAdminPerfModal();
    });
}

function renderFulfillLinksInputs(existingMovie, isSeries = true, reqSpec = "") {
    const wrapper = document.getElementById("fulfill-links-inputs-wrapper");
    if (!wrapper) return;
    wrapper.replaceChildren();

    const existingLinks = existingMovie && existingMovie.links && Array.isArray(existingMovie.links) ? existingMovie.links : [];

    let reqSeasonNum = 0;
    let reqQuality = "";
    if (typeof reqSpec === "number") {
        reqSeasonNum = reqSpec;
    } else if (typeof reqSpec === "string" && reqSpec) {
        const sMatch = reqSpec.match(/Season\s*(\d+)/i) || reqSpec.match(/S(\d+)/i) || reqSpec.match(/\d+/);
        if (isSeries && sMatch) {
            reqSeasonNum = parseInt(sMatch[1] || sMatch[0], 10);
        } else {
            reqQuality = normalizeQualityName(reqSpec);
        }
    }

    if (isSeries) {
        let count = Math.max(existingLinks.length, reqSeasonNum > 0 ? reqSeasonNum : 1);
        if (count < 1) count = 1;

        for (let idx = 0; idx < count; idx++) {
            const linkObj = existingLinks[idx] || null;
            const isObj = typeof linkObj === 'object' && linkObj !== null;
            const urlVal = isObj ? linkObj.url : (typeof linkObj === 'string' ? linkObj : "");
            const qualityVal = isObj && linkObj.quality ? linkObj.quality : "720p";
            const seasonNum = idx + 1;
            const isRequested = reqSeasonNum > 0 && seasonNum === reqSeasonNum;

            addFulfillLinkInputRow(idx, urlVal, qualityVal, true, isRequested);
        }
    } else {
        // FOR MOVIES: Render existing links and pre-select the requested quality automatically (defaulting to 720p if not specified)
        const targetQual = reqQuality ? normalizeQualityName(reqQuality) : "720p";

        if (existingLinks.length > 0) {
            let foundRequestedSlot = false;
            existingLinks.forEach((linkObj, idx) => {
                const isObj = typeof linkObj === 'object' && linkObj !== null;
                const urlVal = isObj ? linkObj.url : (typeof linkObj === 'string' ? linkObj : "");
                const qualityVal = isObj && linkObj.quality ? normalizeQualityName(linkObj.quality) : "720p";
                const isThisSlotRequested = !foundRequestedSlot && (qualityVal === targetQual);
                if (isThisSlotRequested) foundRequestedSlot = true;

                addFulfillLinkInputRow(idx, urlVal, qualityVal, false, isThisSlotRequested);
            });

            // Appending NEW link slot with the requested quality pre-selected if not present in existing links
            if (!foundRequestedSlot) {
                const newIdx = existingLinks.length;
                addFulfillLinkInputRow(newIdx, "", targetQual, false, true);
            }
        } else {
            addFulfillLinkInputRow(0, "", targetQual, false, true);
        }
    }
}

function addFulfillLinkInputRow(idx, defaultUrl = "", defaultQuality = "720p", isSeries = true, isRequested = false) {
    const wrapper = document.getElementById("fulfill-links-inputs-wrapper");
    if (!wrapper) return;

    const seasonNum = idx + 1;
    const row = document.createElement("div");
    row.className = "fulfill-link-row";
    row.dataset.index = idx;
    row.style.cssText = `display: flex; flex-wrap: wrap; gap: 6px; align-items: center; background: ${isRequested ? 'rgba(255, 188, 0, 0.08)' : 'rgba(255,255,255,0.02)'}; padding: 8px 10px; border-radius: 6px; border: 1px solid ${isRequested ? 'rgba(255, 188, 0, 0.4)' : 'rgba(255,255,255,0.05)'}; margin-bottom: 8px; width: 100%; box-sizing: border-box;`;

    const labelBadge = document.createElement("span");
    labelBadge.style.cssText = "font-size: 11px; color: #ffbc00; font-weight: 800; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;";
    
    const normQuality = normalizeQualityName(defaultQuality);

    if (isSeries) {
        labelBadge.innerHTML = `<span>Link ${seasonNum} (Season ${seasonNum})</span>${isRequested ? '<span style="font-size:9px; background:#ffbc00; color:#000; padding:1px 4px; border-radius:3px;">⚡ REQUESTED</span>' : ''}`;
    } else {
        labelBadge.innerHTML = `<span>Link ${seasonNum}:</span>${isRequested ? `<span style="font-size:9px; background:#ffbc00; color:#000; padding:1px 4px; border-radius:3px;">⚡ REQUESTED (${escapeHTML(normQuality)})</span>` : ''}`;
    }

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "fulfill-link-url-input";
    urlInput.value = defaultUrl;
    urlInput.placeholder = isSeries ? `Paste download URL for Season ${seasonNum}...` : `Paste download URL for ${normQuality}...`;
    urlInput.style.cssText = "flex: 1; min-width: 140px; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px; outline: none; box-sizing: border-box;";

    if (isRequested && !defaultUrl) {
        setTimeout(() => urlInput.focus(), 100);
    }

    row.appendChild(labelBadge);
    row.appendChild(urlInput);

    if (!isSeries) {
        const qualitySelect = document.createElement("select");
        qualitySelect.className = "fulfill-link-quality-select";
        qualitySelect.style.cssText = "padding: 8px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px; width: 115px; cursor: pointer; outline: none; flex-shrink: 0;";
        
        const qualities = ["480p", "720p", "1080p", "2160p (4K)", "Cinema Cut / HDCam"];
        qualities.forEach(q => {
            const opt = document.createElement("option");
            opt.value = q;
            opt.textContent = q;
            if (q === normQuality) opt.selected = true;
            qualitySelect.appendChild(opt);
        });
        row.appendChild(qualitySelect);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove Link";
    removeBtn.style.cssText = "background: rgba(255, 59, 48, 0.2); color: #ff3b30; border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;";
    removeBtn.onclick = () => row.remove();
    row.appendChild(removeBtn);

    wrapper.appendChild(row);
}

const btnAddFulfillLinkInput = document.getElementById("btn-add-fulfill-link-input");
if (btnAddFulfillLinkInput) {
    btnAddFulfillLinkInput.addEventListener("click", () => {
        const wrapper = document.getElementById("fulfill-links-inputs-wrapper");
        const nextIdx = wrapper ? wrapper.querySelectorAll(".fulfill-link-row").length : 0;
        const matchedReq = allRequests.find(r => r.title.toLowerCase().trim() === currentFulfillTitle.toLowerCase().trim());
        const isSeries = matchedReq ? (matchedReq.type.toLowerCase() === 'series' || matchedReq.type.toLowerCase() === 'tv') : true;
        addFulfillLinkInputRow(nextIdx, "", "720p", isSeries, false);
    });
}

const btnFulfillBulkToggle = document.getElementById("btn-fulfill-bulk-links-toggle");
const fulfillBulkWrapper = document.getElementById("fulfill-bulk-links-wrapper");
const fulfillBulkInput = document.getElementById("fulfill-bulk-links-input");
const btnApplyFulfillBulkLinks = document.getElementById("btn-apply-fulfill-bulk-links");

if (btnFulfillBulkToggle && fulfillBulkWrapper) {
    btnFulfillBulkToggle.addEventListener("click", () => {
        const isHidden = fulfillBulkWrapper.style.display === "none";
        fulfillBulkWrapper.style.display = isHidden ? "block" : "none";
        btnFulfillBulkToggle.textContent = isHidden ? "✕ Close Bulk" : "📋 Bulk Paste";
        if (isHidden && fulfillBulkInput) fulfillBulkInput.focus();
    });
}

if (btnApplyFulfillBulkLinks && fulfillBulkInput) {
    btnApplyFulfillBulkLinks.addEventListener("click", () => {
        const wrapper = document.getElementById("fulfill-links-inputs-wrapper");
        if (!wrapper) return;
        const matchedReq = allRequests.find(r => r.title.toLowerCase().trim() === (typeof currentFulfillTitle !== 'undefined' ? currentFulfillTitle.toLowerCase().trim() : ""));
        const isSeries = matchedReq ? (matchedReq.type.toLowerCase() === 'series' || matchedReq.type.toLowerCase() === 'tv') : true;

        const parsed = parseBulkLinks(fulfillBulkInput.value, isSeries);
        if (parsed.length === 0) {
            alert("Please paste at least one valid link!");
            return;
        }

        wrapper.replaceChildren();
        parsed.forEach((item, idx) => {
            addFulfillLinkInputRow(idx, item.url, item.quality || "720p", isSeries, idx === 0);
        });

        fulfillBulkInput.value = "";
        if (fulfillBulkWrapper) fulfillBulkWrapper.style.display = "none";
        if (btnFulfillBulkToggle) btnFulfillBulkToggle.textContent = "📋 Bulk Paste";
    });
}

// Fulfill Request Streaming Link Handlers
let fulfillStreamLinksState = [];

function renderFulfillStreamLinksInputs(existingMovie, isSeries = true, reqSpec = "") {
    const wrapper = document.getElementById("fulfill-streams-inputs-wrapper");
    if (!wrapper) return;
    wrapper.replaceChildren();

    const addBtn = document.getElementById("btn-add-fulfill-stream-input");
    if (addBtn) {
        addBtn.textContent = isSeries ? "+ Add Episode Stream" : "+ Add Stream / Quality";
    }

    let existingStreams = [];
    if (existingMovie) {
        if (existingMovie.stream_links && Array.isArray(existingMovie.stream_links) && existingMovie.stream_links.length > 0) {
            existingStreams = [...existingMovie.stream_links];
        } else if (existingMovie.links && Array.isArray(existingMovie.links)) {
            existingMovie.links.forEach((l, idx) => {
                if (l && (l.stream_url || (l.url && (l.url.includes("watch=") || l.url.includes("dl/"))))) {
                    const u = l.stream_url || l.url;
                    if (isSeries) {
                        existingStreams.push({ url: u, episode: l.episode || (idx + 1) });
                    } else {
                        existingStreams.push({ url: u, quality: l.quality || "720p" });
                    }
                }
            });
        }
        if (existingStreams.length === 0 && existingMovie.stream_url) {
            existingStreams.push(isSeries ? { url: existingMovie.stream_url, episode: 1 } : { url: existingMovie.stream_url, quality: "720p" });
        }
    }

    if (existingStreams.length > 0) {
        existingStreams.forEach((item, idx) => {
            const u = item.url || item.stream_url || "";
            const q = item.quality || "720p";
            const ep = item.episode || (idx + 1);
            addFulfillStreamLinkInputRow(idx, u, q, isSeries, idx === 0, ep);
        });
    } else {
        addFulfillStreamLinkInputRow(0, "", "720p", isSeries, true, 1);
    }
}

function addFulfillStreamLinkInputRow(idx, defaultUrl = "", defaultQuality = "720p", isSeries = true, isRequested = false, defaultEp = 1) {
    const wrapper = document.getElementById("fulfill-streams-inputs-wrapper");
    if (!wrapper) return;

    const row = document.createElement("div");
    row.className = "fulfill-stream-row";
    row.dataset.index = idx;
    row.style.cssText = `display: flex; flex-wrap: wrap; gap: 6px; align-items: center; background: ${isRequested ? 'rgba(76, 217, 100, 0.08)' : 'rgba(255,255,255,0.02)'}; padding: 8px 10px; border-radius: 6px; border: 1px solid ${isRequested ? 'rgba(76, 217, 100, 0.35)' : 'rgba(255,255,255,0.05)'}; margin-bottom: 8px; width: 100%; box-sizing: border-box;`;

    const labelBadge = document.createElement("span");
    labelBadge.style.cssText = "font-size: 11px; color: #4cd964; font-weight: 800; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;";
    
    const epNum = defaultEp || (idx + 1);
    const normQuality = normalizeQualityName(defaultQuality);

    if (isSeries) {
        labelBadge.innerHTML = `<span>Episode ${epNum}:</span>${isRequested ? '<span style="font-size:9px; background:#4cd964; color:#000; padding:1px 4px; border-radius:3px;">⚡ STREAM</span>' : ''}`;
    } else {
        labelBadge.innerHTML = `<span>Stream ${idx + 1}:</span>${isRequested ? '<span style="font-size:9px; background:#4cd964; color:#000; padding:1px 4px; border-radius:3px;">⚡ PRIMARY</span>' : ''}`;
    }

    const cleanInitial = cleanStreamInput(defaultUrl);

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "fulfill-stream-url-input";
    urlInput.value = cleanInitial;
    urlInput.placeholder = isSeries ? `Paste token / URL for Episode ${epNum}...` : `Paste stream token / URL for ${normQuality}...`;
    urlInput.style.cssText = "flex: 1; min-width: 140px; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px; font-family: monospace; outline: none; box-sizing: border-box;";

    row.appendChild(labelBadge);
    row.appendChild(urlInput);

    if (!isSeries) {
        const qualitySelect = document.createElement("select");
        qualitySelect.className = "fulfill-stream-quality-select";
        qualitySelect.style.cssText = "padding: 8px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 12px; width: 115px; cursor: pointer; outline: none; flex-shrink: 0;";
        
        const qualities = ["720p", "1080p", "2160p (4K)", "480p", "Cinema Cut / HDCam"];
        qualities.forEach(q => {
            const opt = document.createElement("option");
            opt.value = q;
            opt.textContent = q;
            if (q === normQuality) opt.selected = true;
            qualitySelect.appendChild(opt);
        });
        row.appendChild(qualitySelect);
    } else {
        const epInput = document.createElement("input");
        epInput.type = "hidden";
        epInput.className = "fulfill-stream-episode-val";
        epInput.value = epNum;
        row.appendChild(epInput);
    }

    const testBtn = document.createElement("a");
    testBtn.className = "fulfill-stream-test-btn";
    testBtn.textContent = "Test ▶️";
    testBtn.target = "_blank";
    testBtn.style.cssText = `font-size: 10px; padding: 4px 8px; border: 1px solid rgba(255, 188, 0, 0.4); border-radius: 4px; color: #ffbc00; text-decoration: none; display: ${cleanInitial ? 'inline-flex' : 'none'}; align-items: center; white-space: nowrap; flex-shrink: 0;`;
    if (cleanInitial) {
        testBtn.href = `https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(cleanInitial)}&title=${encodeURIComponent(typeof currentFulfillTitle !== 'undefined' ? currentFulfillTitle : 'Movie')}`;
    }

    urlInput.addEventListener("input", (e) => {
        const cleaned = cleanStreamInput(e.target.value.trim());
        if (cleaned) {
            testBtn.href = `https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(cleaned)}&title=${encodeURIComponent(typeof currentFulfillTitle !== 'undefined' ? currentFulfillTitle : 'Movie')}`;
            testBtn.style.display = "inline-flex";
        } else {
            testBtn.style.display = "none";
        }
    });

    row.appendChild(testBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove Stream";
    removeBtn.style.cssText = "background: rgba(255, 59, 48, 0.2); color: #ff3b30; border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;";
    removeBtn.onclick = () => row.remove();
    row.appendChild(removeBtn);

    wrapper.appendChild(row);
}

const btnAddFulfillStreamInput = document.getElementById("btn-add-fulfill-stream-input");
if (btnAddFulfillStreamInput) {
    btnAddFulfillStreamInput.addEventListener("click", () => {
        const wrapper = document.getElementById("fulfill-streams-inputs-wrapper");
        const nextIdx = wrapper ? wrapper.querySelectorAll(".fulfill-stream-row").length : 0;
        const matchedReq = allRequests.find(r => r.title.toLowerCase().trim() === currentFulfillTitle.toLowerCase().trim());
        const isSeries = matchedReq ? (matchedReq.type.toLowerCase() === 'series' || matchedReq.type.toLowerCase() === 'tv') : true;
        addFulfillStreamLinkInputRow(nextIdx, "", "720p", isSeries, false, nextIdx + 1);
    });
}

const btnFulfillBulkStreamsToggle = document.getElementById("btn-fulfill-bulk-streams-toggle");
const fulfillBulkStreamsWrapper = document.getElementById("fulfill-bulk-streams-wrapper");
const fulfillBulkStreamsInput = document.getElementById("fulfill-bulk-streams-input");
const btnApplyFulfillBulkStreams = document.getElementById("btn-apply-fulfill-bulk-streams");

if (btnFulfillBulkStreamsToggle && fulfillBulkStreamsWrapper) {
    btnFulfillBulkStreamsToggle.addEventListener("click", () => {
        const isHidden = fulfillBulkStreamsWrapper.style.display === "none";
        fulfillBulkStreamsWrapper.style.display = isHidden ? "block" : "none";
        btnFulfillBulkStreamsToggle.textContent = isHidden ? "✕ Close Bulk" : "📋 Bulk Paste";
        if (isHidden && fulfillBulkStreamsInput) fulfillBulkStreamsInput.focus();
    });
}

if (btnApplyFulfillBulkStreams && fulfillBulkStreamsInput) {
    btnApplyFulfillBulkStreams.addEventListener("click", () => {
        const wrapper = document.getElementById("fulfill-streams-inputs-wrapper");
        if (!wrapper) return;
        const matchedReq = allRequests.find(r => r.title.toLowerCase().trim() === (typeof currentFulfillTitle !== 'undefined' ? currentFulfillTitle.toLowerCase().trim() : ""));
        const isSeries = matchedReq ? (matchedReq.type.toLowerCase() === 'series' || matchedReq.type.toLowerCase() === 'tv') : true;

        const parsed = parseBulkStreams(fulfillBulkStreamsInput.value, isSeries);
        if (parsed.length === 0) {
            alert("Please paste at least one valid stream token or URL!");
            return;
        }

        wrapper.replaceChildren();
        parsed.forEach((item, idx) => {
            addFulfillStreamLinkInputRow(idx, item.url, item.quality || "720p", isSeries, idx === 0, item.episode || (idx + 1));
        });

        fulfillBulkStreamsInput.value = "";
        if (fulfillBulkStreamsWrapper) fulfillBulkStreamsWrapper.style.display = "none";
        if (btnFulfillBulkStreamsToggle) btnFulfillBulkStreamsToggle.textContent = "📋 Bulk Paste";
    });
}

if (fulfillForm && fulfillRequestModal) {
    fulfillForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const linkRows = Array.from(document.querySelectorAll("#fulfill-links-inputs-wrapper .fulfill-link-row"));
        const linksToSave = [];
        let primaryNotificationLink = "";

        linkRows.forEach((row, idx) => {
            const urlInput = row.querySelector(".fulfill-link-url-input");
            const qualitySelect = row.querySelector(".fulfill-link-quality-select");
            const url = urlInput ? urlInput.value.trim() : "";
            const quality = qualitySelect ? qualitySelect.value : "720p";
            const seasonLabel = `Season ${idx + 1}`;

            linksToSave.push({ seasonLabel, quality, url, index: idx });
            if (url && (!primaryNotificationLink || idx === 0)) {
                primaryNotificationLink = url;
            }
        });

        const hasAnyUrl = linksToSave.some(l => l.url !== "");
        if (!hasAnyUrl) {
            showToast("Please enter at least one download link!", "warning");
            return;
        }

        // Extract structured stream links
        const streamRows = Array.from(document.querySelectorAll("#fulfill-streams-inputs-wrapper .fulfill-stream-row"));
        const validFulfillStreams = [];

        streamRows.forEach((row, idx) => {
            const urlInput = row.querySelector(".fulfill-stream-url-input");
            const qualitySelect = row.querySelector(".fulfill-stream-quality-select");
            const epInput = row.querySelector(".fulfill-stream-episode-val");
            const rawUrl = urlInput ? urlInput.value.trim() : "";
            const cleanToken = cleanStreamInput(rawUrl);
            if (cleanToken) {
                const isSeriesNow = (currentFulfillReq && currentFulfillReq.type) ? ((currentFulfillReq.type || "").toLowerCase() === 'series' || (currentFulfillReq.type || "").toLowerCase() === 'tv') : true;
                if (isSeriesNow) {
                    const epNum = epInput ? parseInt(epInput.value, 10) : (idx + 1);
                    validFulfillStreams.push({ episode: epNum, season: 1, stream_url: cleanToken, url: cleanToken });
                } else {
                    const quality = qualitySelect ? qualitySelect.value : (idx === 0 ? "720p" : "1080p");
                    validFulfillStreams.push({ quality, stream_url: cleanToken, url: cleanToken });
                }
            }
        });

        const cleanStreamVal = validFulfillStreams.length > 0 ? (validFulfillStreams[0].stream_url || validFulfillStreams[0].url) : "";

        const downloadLink = primaryNotificationLink;
        
        // Disable form buttons during async operations
        const submitBtn = fulfillForm.querySelector("button[type='submit']");
        const cancelBtn = document.getElementById("btn-close-fulfill-modal");
        if (submitBtn) submitBtn.disabled = true;
        
        // 1. Sync to local CSV catalog
        const matchTitle = currentFulfillTitle.toLowerCase().trim();
        const matchedReq = (currentFulfillReq && currentFulfillReq.title) ? currentFulfillReq : (allRequests.find(r => r.title.toLowerCase().trim() === matchTitle) || allRequests.find(r => (currentFulfillDocIds || []).includes(r.docId)));
        const reqTmdbId = matchedReq ? (matchedReq.tmdb_id || matchedReq.tmdbId) : null;
        const reqYear = matchedReq ? (matchedReq.year || (matchedReq.release_date ? matchedReq.release_date.substring(0, 4) : "")) : "";
        const isSeries = matchedReq ? (matchedReq.type.toLowerCase() === 'series' || matchedReq.type.toLowerCase() === 'tv') : true;

        const cleanTitle = currentFulfillTitle.replace(/\s*\([^)]+\)\s*$/g, "").trim();
        const cleanMatchTitle = cleanTitle.toLowerCase();
        
        const existingMovie = allCatalogMovies.find(m => {
            const mTmdb = m.tmdb_id ? String(m.tmdb_id).trim() : (m.csv_id && !isNaN(m.csv_id) ? String(m.csv_id).trim() : "");
            if (reqTmdbId && mTmdb) {
                return String(reqTmdbId).trim() === mTmdb;
            }
            if (reqTmdbId && !mTmdb) {
                if (titlesMatch(m.title, currentFulfillTitle)) {
                    if (reqYear && m.year && String(m.year) === String(reqYear)) return true;
                    if (!reqYear) return true;
                }
                return false;
            }
            if (!reqTmdbId && !mTmdb) {
                if (titlesMatch(m.title, currentFulfillTitle)) {
                    if (reqYear && m.year && String(m.year) === String(reqYear)) return true;
                    if (!reqYear) return true;
                }
            }
            return false;
        });

        let movieToSync = null;

        if (existingMovie) {
            if (!existingMovie.links) existingMovie.links = [];
            
            linksToSave.forEach(item => {
                const formattedLink = isSeries ? { url: item.url, season: item.seasonLabel } : { url: item.url, quality: item.quality };
                const targetIdx = item.index;
                while (existingMovie.links.length < targetIdx + 1) {
                    const currentIdx = existingMovie.links.length;
                    existingMovie.links.push(isSeries ? { season: `Season ${currentIdx + 1}`, url: "" } : { quality: "720p", url: "" });
                }
                existingMovie.links[targetIdx] = formattedLink;
            });

            if (cleanStreamVal) {
                existingMovie.stream_url = cleanStreamVal;
                existingMovie.stream_links = validFulfillStreams;
                if (existingMovie.links && existingMovie.links.length > 0) {
                    existingMovie.links[0].stream_url = cleanStreamVal;
                    if (!isSeries) {
                        existingMovie.links.forEach(l => {
                            const match = validFulfillStreams.find(vs => normalizeQualityName(vs.quality) === normalizeQualityName(l.quality));
                            if (match) l.stream_url = match.stream_url;
                        });
                    }
                }
            }

            catalogChangesMade = true;
            if (!newlyUpdatedIds.includes(existingMovie.csv_id)) {
                newlyUpdatedIds.push(existingMovie.csv_id);
            }
            movieToSync = existingMovie;
        } else {
            // Create a new catalog entry
            const formattedLinksArray = [];
            linksToSave.forEach(item => {
                const formattedLink = isSeries ? { url: item.url, season: item.seasonLabel } : { url: item.url, quality: item.quality };
                const targetIdx = item.index;
                while (formattedLinksArray.length < targetIdx + 1) {
                    const currentIdx = formattedLinksArray.length;
                    formattedLinksArray.push(isSeries ? { season: `Season ${currentIdx + 1}`, url: "" } : { quality: "720p", url: "" });
                }
                formattedLinksArray[targetIdx] = formattedLink;
            });

            const mediaType = isSeries ? 'tv' : 'movie';
            let tmdbData = null;
            try {
                // Priority 1: Direct fetch by tmdb_id if provided on the request
                if (reqTmdbId) {
                    const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${reqTmdbId}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
                    const detailsRes = await fetch(detailsUrl);
                    if (detailsRes.ok) {
                        tmdbData = await detailsRes.json();
                    }
                }

                // Priority 2: Search with specific mediaType and year to avoid mismatched series/movies
                if (!tmdbData) {
                    const yearParam = reqYear ? (isSeries ? `&first_air_date_year=${reqYear}` : `&primary_release_year=${reqYear}`) : '';
                    const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}${yearParam}`;
                    const searchRes = await fetch(searchUrl);
                    if (searchRes.ok) {
                        const searchObj = await searchRes.json();
                        if (searchObj.results && searchObj.results.length > 0) {
                            const bestMatch = searchObj.results[0];
                            const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${bestMatch.id}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
                            const detailsRes = await fetch(detailsUrl);
                            if (detailsRes.ok) {
                                tmdbData = await detailsRes.json();
                            }
                        }
                    }
                }

                // Priority 3: Fallback search without year filter if no exact year match
                if (!tmdbData) {
                    const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`;
                    const searchRes = await fetch(searchUrl);
                    if (searchRes.ok) {
                        const searchObj = await searchRes.json();
                        if (searchObj.results && searchObj.results.length > 0) {
                            let bestMatch = searchObj.results[0];
                            if (reqYear) {
                                const yearMatch = searchObj.results.find(r => (r.first_air_date || r.release_date || "").startsWith(reqYear));
                                if (yearMatch) bestMatch = yearMatch;
                            }
                            const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${bestMatch.id}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
                            const detailsRes = await fetch(detailsUrl);
                            if (detailsRes.ok) {
                                tmdbData = await detailsRes.json();
                            }
                        }
                    }
                }
            } catch (tmdbErr) {
                console.warn("Failed to lookup TMDB info for new fulfilled request:", tmdbErr);
            }
            
            if (tmdbData) {
                const tmdbId = tmdbData.id;
                const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                const csvId = `${tmdbId}-${slug}`;
                
                let trailerId = "";
                if (tmdbData.videos && tmdbData.videos.results) {
                    const officialTrailer = tmdbData.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
                    if (officialTrailer) {
                        trailerId = officialTrailer.key;
                    } else if (tmdbData.videos.results.length > 0) {
                        trailerId = tmdbData.videos.results[0].key;
                    }
                }
                
                const autoCategories = determineAutoCategories(tmdbData, tmdbData.title || tmdbData.name || cleanTitle, isSeries ? 'Series' : 'Movie');
                let autoGenres = tmdbData.genres ? tmdbData.genres.map(g => g.name) : [];
                if (autoGenres.length === 0) {
                    autoGenres = autoCategories.filter(c => c !== "Main" && c !== "Hollywood/British Movies" && c !== "Hollywood/British Series");
                }
                
                const newMovie = {
                    csv_id: csvId,
                    tmdb_id: tmdbId,
                    imdb_id: "",
                    title: tmdbData.title || tmdbData.name || cleanTitle,
                    type: isSeries ? 'Series' : 'Movie',
                    categories: autoCategories,
                    genres: autoGenres,
                    overview: tmdbData.overview || "No synopsis available.",
                    poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : "img/FilmHouse3_nobg.png",
                    backdrop: tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}` : "img/FilmHouse.png",
                    rating: Math.round((tmdbData.vote_average || 0) * 10) / 10,
                    release_date: tmdbData.release_date || tmdbData.first_air_date || "",
                    language: tmdbData.original_language || "en",
                    cast: [],
                    director: "",
                    trailer: trailerId,
                    runtime: "",
                    stream_url: cleanStreamVal,
                    stream_links: validFulfillStreams,
                    links: formattedLinksArray
                };
                if (cleanStreamVal && formattedLinksArray.length > 0) {
                    formattedLinksArray[0].stream_url = cleanStreamVal;
                    if (!isSeries) {
                        formattedLinksArray.forEach(l => {
                            const match = validFulfillStreams.find(vs => normalizeQualityName(vs.quality) === normalizeQualityName(l.quality));
                            if (match) l.stream_url = match.stream_url;
                        });
                    }
                }
                allCatalogMovies.unshift(newMovie);
                newlyAddedIds.push(csvId);
                catalogChangesMade = true;
                movieToSync = newMovie;
            } else {
                const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                const csvId = `manual-${Date.now()}-${slug}`;
                
                const newMovie = {
                    csv_id: csvId,
                    tmdb_id: null,
                    imdb_id: "",
                    title: cleanTitle,
                    type: isSeries ? 'Series' : 'Movie',
                    categories: isSeries ? ["Main", "Hollywood/British Series"] : ["Main", "Hollywood/British Movies"],
                    genres: [],
                    overview: "No synopsis available.",
                    poster: "img/FilmHouse3_nobg.png",
                    backdrop: "img/FilmHouse.png",
                    rating: 0,
                    release_date: "",
                    language: "en",
                    cast: [],
                    director: "",
                    trailer: "",
                    runtime: "",
                    stream_url: cleanStreamVal,
                    stream_links: validFulfillStreams,
                    links: formattedLinksArray
                };
                if (cleanStreamVal && formattedLinksArray.length > 0) {
                    formattedLinksArray[0].stream_url = cleanStreamVal;
                    if (!isSeries) {
                        formattedLinksArray.forEach(l => {
                            const match = validFulfillStreams.find(vs => normalizeQualityName(vs.quality) === normalizeQualityName(l.quality));
                            if (match) l.stream_url = match.stream_url;
                        });
                    }
                }
                allCatalogMovies.unshift(newMovie);
                newlyAddedIds.push(csvId);
                catalogChangesMade = true;
                movieToSync = newMovie;
            }
        }
        
        // 2. Commit Firestore batch update (chunked into groups of 450 to avoid Firestore limits)
        let targetDocIds = Array.isArray(currentFulfillDocIds) && currentFulfillDocIds.length > 0 ? [...currentFulfillDocIds] : [];
        const cleanT = currentFulfillTitle.toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "").trim();
        allRequests.forEach(r => {
            if (r.docId && !targetDocIds.includes(r.docId)) {
                const rClean = (r.title || "").toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "").trim();
                const sameTmdb = reqTmdbId && r.tmdb_id && String(reqTmdbId) === String(r.tmdb_id);
                const hasDiffTmdb = reqTmdbId && r.tmdb_id && String(reqTmdbId) !== String(r.tmdb_id);
                const sameTitle = !hasDiffTmdb && rClean && (rClean === cleanT || titlesMatch(r.title, currentFulfillTitle));
                if ((sameTmdb || sameTitle) && r.status !== "fulfilled" && r.status !== "claimed") {
                    if (isSeries && matchedReq && matchedReq.seasonOrPart && String(matchedReq.seasonOrPart).toLowerCase().includes("season")) {
                        if (!r.seasonOrPart || r.seasonOrPart.toLowerCase().trim() === matchedReq.seasonOrPart.toLowerCase().trim()) {
                            targetDocIds.push(r.docId);
                        }
                    } else {
                        targetDocIds.push(r.docId);
                    }
                }
            }
        });

        const requestChunks = [];
        for (let i = 0; i < targetDocIds.length; i += 450) {
            requestChunks.push(targetDocIds.slice(i, i + 450));
        }
 
        const tgUserForFulfill = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
        const currentAdminName = tgUserForFulfill 
            ? (tgUserForFulfill.username ? `@${tgUserForFulfill.username}` : `${tgUserForFulfill.first_name || 'Admin'}`) 
            : (sessionStorage.getItem("admin_auth_name") || localStorage.getItem("filmhouse_admin_username") || "Admin");
        const currentAdminId = String(tgUserForFulfill ? tgUserForFulfill.id : (sessionStorage.getItem("admin_auth_id") || new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || ""));

        const postToChanEl = document.getElementById("fulfill-post-to-channel");
        const shouldPostToChannel = postToChanEl ? postToChanEl.checked : true;

        const fulfillPromises = requestChunks.map((chunk, chunkIdx) => {
            const batch = db.batch();
            chunk.forEach(id => {
                const ref = db.collection("requests").doc(id);
                batch.update(ref, {
                    status: "fulfilled",
                    downloadLink: downloadLink,
                    fulfilledBy: currentAdminName,
                    fulfilledById: currentAdminId || "",
                    publishToChannel: shouldPostToChannel,
                    channelPosted: false,
                    fulfilledAt: firebase.firestore.FieldValue.serverTimestamp(),
                    adminClaimId: firebase.firestore.FieldValue.delete(),
                    adminClaimName: firebase.firestore.FieldValue.delete(),
                    adminClaimTime: firebase.firestore.FieldValue.delete()
                });
            });
            if (chunkIdx === 0 && movieToSync) {
                const sanitizedMovie = JSON.parse(JSON.stringify(movieToSync));
                const movieRef = db.collection("movies").doc(movieToSync.csv_id);
                batch.set(movieRef, sanitizedMovie, { merge: true });
            }
            return batch.commit();
        });
 
        Promise.all(fulfillPromises).then(async () => {
            // Update in-memory allRequests immediately so UI shows fulfilled state without delay
            targetDocIds.forEach(id => {
                const reqItem = allRequests.find(r => r.docId === id);
                if (reqItem) {
                    reqItem.status = "fulfilled";
                    reqItem.fulfilledBy = currentAdminName;
                    reqItem.fulfilledById = currentAdminId || "";
                    reqItem.downloadLink = downloadLink;
                    reqItem.isFulfilled = true;
                    reqItem.fulfilledAt = { seconds: Math.floor(Date.now() / 1000) };
                }
            });
            renderRequestsList();
            updateStatsCounters();
            renderAdminLeaderboard();

            if (typeof window.recordAdminActivity === 'function') {
                window.recordAdminActivity("fulfillment", currentFulfillTitle);
            }
            // Channel announcement and requester notifications are handled centrally by bot.js via Firestore listener

            const requesters = [];
            currentFulfillDocIds.forEach(id => {
                const req = allRequests.find(r => r.docId === id);
                if (req && req.requestedById) {
                    requesters.push({
                        docId: id,
                        id: req.requestedById,
                        username: req.requestedBy || "User"
                    });
                }
            });

            // Telegram notification is handled on the backend bot via Firestore requests collection snapshot listener

            // Auto-Publish to GitHub in background if token exists!
            const token = (document.getElementById("github-token")?.value.trim()) || (githubToken ? githubToken.trim() : "");
            if (token) {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = "Publishing to GitHub... ⏳";
                }
                
                const owner = "dans123456";
                const repo = "filmhouse";
                const pathCSV = "MOVIE/Data/datafile.csv";
                const pathJSON = "MOVIE/Data/movies_metadata.json";
                const apiCSVUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathCSV}`;
                const apiJSONUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathJSON}`;
                
                try {
                    // Fetch SHA values with cache busters
                    const [getCSVResponse, getJSONResponse] = await Promise.all([
                        fetch(`${apiCSVUrl}?t=${Date.now()}`, {
                            headers: {
                                "Authorization": `token ${token}`,
                                "Accept": "application/vnd.github.v3+json"
                            }
                        }),
                        fetch(`${apiJSONUrl}?t=${Date.now()}`, {
                            headers: {
                                "Authorization": `token ${token}`,
                                "Accept": "application/vnd.github.v3+json"
                            }
                        })
                    ]);
                    
                    if (!getCSVResponse.ok) {
                        let errMsg = getCSVResponse.statusText;
                        try { const d = await getCSVResponse.json(); if (d && d.message) errMsg = d.message; } catch (_) {}
                        if (getCSVResponse.status === 401 || getCSVResponse.status === 403) {
                            throw new Error(`GitHub PAT invalid or expired (${getCSVResponse.status}: ${errMsg})`);
                        }
                        throw new Error(`Failed to fetch CSV: ${errMsg}`);
                    }
                    if (!getJSONResponse.ok) {
                        let errMsg = getJSONResponse.statusText;
                        try { const d = await getJSONResponse.json(); if (d && d.message) errMsg = d.message; } catch (_) {}
                        if (getJSONResponse.status === 401 || getJSONResponse.status === 403) {
                            throw new Error(`GitHub PAT invalid or expired (${getJSONResponse.status}: ${errMsg})`);
                        }
                        throw new Error(`Failed to fetch JSON: ${errMsg}`);
                    }

                    const csvData = await getCSVResponse.json();
                    const jsonData = await getJSONResponse.json();
                    const shaCSV = csvData.sha;
                    const shaJSON = jsonData.sha;
                    
                    const csvContent = generateCSVContent();
                    const jsonContent = JSON.stringify(allCatalogMovies, null, 2);
                    
                    const base64CSV = btoa(unescape(encodeURIComponent(csvContent)));
                    const base64JSON = btoa(unescape(encodeURIComponent(jsonContent)));
                    
                    // Push CSV
                    const putCSVResponse = await putGitHubFileWithRetry(apiCSVUrl, token, {
                        message: `Auto-update catalog (datafile.csv) on request fulfill: ${currentFulfillTitle}`,
                        content: base64CSV,
                        sha: shaCSV
                    });

                    // Push JSON
                    const putJSONResponse = await putGitHubFileWithRetry(apiJSONUrl, token, {
                        message: `Auto-update metadata (movies_metadata.json) on request fulfill: ${currentFulfillTitle}`,
                        content: base64JSON,
                        sha: shaJSON
                    });

                    const jsonResData = await putJSONResponse.json();
                    if (jsonResData && jsonResData.content) {
                        lastKnownJsonSha = jsonResData.content.sha;
                    }
                    catalogChangesMade = false;
                    newlyAddedIds = [];
                    newlyUpdatedIds = [];
                    localStorage.removeItem("filmhouse_unpublished_catalog");
                    
                    // Trigger instant catalog sync on the server/bot
                    if (typeof db !== "undefined" && db) {
                        db.collection("settings").doc("catalog_sync").set({
                            lastPublishedAt: Date.now(),
                            publishedBy: currentAdminName || "admin"
                        }, { merge: true }).catch(() => {});
                    }

                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Fulfill Request";
                    }
                    
                    renderCatalogList();
                    updatePublishButtonState();
                    fulfillRequestModal.classList.remove("active");
                    showToast(`Successfully fulfilled requests and published "${currentFulfillTitle}" directly live to GitHub! 🚀`, "success");
                    return;
                } catch (publishErr) {
                    console.error("Auto-publishing failed:", publishErr);
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Fulfill Request";
                    }
                    renderCatalogList();
                    updatePublishButtonState();
                    fulfillRequestModal.classList.remove("active");
                    showToast(`Firestore updated! Note: GitHub publish failed (${publishErr.message}). Update token in Settings or use 'Publish Changes' in header to retry.`, "warning");
                }
            } else {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Fulfill Request";
                }
                renderCatalogList();
                updatePublishButtonState();
                fulfillRequestModal.classList.remove("active");
                showToast(`⚠️ Request fulfilled & channel notified, but NOT pushed to GitHub! Click the yellow 'Publish Changes' button in the top header NOW to push live to the app.`, "warning", 8000);
                
                const pBtn = document.getElementById("btn-publish-catalog");
                if (pBtn) {
                    pBtn.style.boxShadow = "0 0 15px #ffc107";
                    setTimeout(() => { if (pBtn) pBtn.style.boxShadow = ""; }, 6000);
                }
            }
        }).catch(err => {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Fulfill Request";
            }
            console.error("Error fulfilling requests:", err);
            showToast("Failed to fulfill requests: " + err.message, "error");
        });
    });
}

// State for Category Browser Modal
let activeCategoryKey = "";
let activeCategoryDisplayName = "";

// Close Modal binding
const catMoviesModal = document.getElementById("category-movies-modal");
const closeCatMoviesBtn = document.getElementById("btn-close-cat-movies-modal");
if (closeCatMoviesBtn && catMoviesModal) {
    closeCatMoviesBtn.addEventListener("click", () => {
        catMoviesModal.classList.remove("active");
    });
}

// Bind Category Search filter input typing
const catMoviesSearchInput = document.getElementById("cat-movies-search");
if (catMoviesSearchInput) {
    catMoviesSearchInput.addEventListener("input", createAdminDebounce(renderCategoryMovies, 200));
}

function openCategoryMoviesModal(catKey, displayName) {
    activeCategoryKey = catKey;
    activeCategoryDisplayName = displayName;
    
    const titleEl = document.getElementById("category-modal-title");
    if (titleEl) titleEl.textContent = displayName;
    
    const searchEl = document.getElementById("cat-movies-search");
    if (searchEl) searchEl.value = "";
    
    renderCategoryMovies();
    if (catMoviesModal) catMoviesModal.classList.add("active");
}

function renderCategoryMovies() {
    const listContainer = document.getElementById("category-movies-list");
    if (!listContainer) return;
    
    listContainer.replaceChildren();
    
    // Filter movies in active category
    const catMovies = allCatalogMovies.filter(m => {
        const cats = m.categories || ["Main"];
        return cats.includes(activeCategoryKey);
    });
    
    // Filter by search text
    const searchQuery = (document.getElementById("cat-movies-search")?.value || "").toLowerCase().trim();
    const filtered = catMovies.filter(m => (m.title || "").toLowerCase().includes(searchQuery) || (m.csv_id || "").toLowerCase().includes(searchQuery));
    
    if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">No titles found.</div>`;
        return;
    }
    
    filtered.forEach(m => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.style.cssText = "cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border-color); background: rgba(255,255,255,0.015); border-radius: 6px; transition: all 0.2s;";
        
        row.addEventListener("mouseenter", () => {
            row.style.background = "rgba(255, 188, 0, 0.04)";
        });
        row.addEventListener("mouseleave", () => {
            row.style.background = "rgba(255,255,255,0.015)";
        });
        
        const posterUrl = getPosterUrl(m.poster);
        
        row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                <img src="${escapeHTML(posterUrl)}" style="width: 32px; height: 44px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border-color);" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                <div style="min-width: 0; flex: 1;">
                    <h5 style="margin: 0 0 2px 0; font-size: 13px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(m.title)}</h5>
                    <p style="margin: 0; font-size: 11px; color: var(--text-secondary);">ID: ${escapeHTML(m.csv_id)} | Year: ${m.release_date ? escapeHTML(m.release_date.substring(0, 4)) : 'N/A'}</p>
                </div>
            </div>
            <span style="font-size: 11px; color: var(--primary-color); font-weight: 600; flex-shrink: 0; margin-left: 10px;">Edit ➔</span>
        `;
        
        row.addEventListener("click", () => {
            if (catMoviesModal) catMoviesModal.classList.remove("active");
            showMovieDetails(m);
        });
        
        listContainer.appendChild(row);
    });
}

// --- TELEGRAM BOT BROADCASTING CENTER LOGIC ---
let isBroadcasting = false;
let shouldCancelBroadcast = false;

// DOM bindings for Broadcasting
document.addEventListener("DOMContentLoaded", () => {
    const broadcastTarget = document.getElementById("broadcast-target");
    const broadcastUserIdGroup = document.getElementById("broadcast-userid-group");
    const broadcastUserid = document.getElementById("broadcast-userid");
    const broadcastMessage = document.getElementById("broadcast-message");
    const broadcastCharCounter = document.getElementById("broadcast-char-counter");
    const btnStartBroadcast = document.getElementById("btn-start-broadcast");
    const btnCancelBroadcast = document.getElementById("btn-cancel-broadcast");
    const includeBtnCheckbox = document.getElementById("broadcast-include-button");
    const btnOptionsContainer = document.getElementById("broadcast-button-options");
    
    // Toggle optional custom button options
    if (includeBtnCheckbox && btnOptionsContainer) {
        includeBtnCheckbox.addEventListener("change", () => {
            btnOptionsContainer.style.display = includeBtnCheckbox.checked ? "block" : "none";
        });
    }
    
    // UI elements update on user profile list sync to show target count
    const updateTargetCountLabel = () => {
        const target = broadcastTarget ? broadcastTarget.value : "all";
        const countLabel = document.getElementById("broadcast-recipient-count");
        if (!countLabel) return;
        
        if (target === "all") {
            const total = (typeof allUsers !== 'undefined' && Array.isArray(allUsers)) ? allUsers.length : 0;
            const active = allUsers.filter(u => !u.blockedBot && !u.banned).length;
            const displayActive = active > 0 ? active : (total > 0 ? total : 0);
            countLabel.textContent = `Target: ~${displayActive} Active Subscribers (${total} Registered)`;
        } else if (target === "channel") {
            countLabel.textContent = `Target: @filmhousemain Channel`;
        } else {
            countLabel.textContent = `Target: 1 Specific User`;
        }
    };
    
    // Toggle User ID input
    if (broadcastTarget && broadcastUserIdGroup) {
        broadcastTarget.addEventListener("change", () => {
            const val = broadcastTarget.value;
            broadcastUserIdGroup.style.display = val === "single" ? "block" : "none";
            updateTargetCountLabel();
        });
    }
    
    // Character Counter
    if (broadcastMessage && broadcastCharCounter) {
        broadcastMessage.addEventListener("input", () => {
            const chars = broadcastMessage.value.length;
            broadcastCharCounter.textContent = `${chars} chars`;
        });
    }
    
    // Start Broadcast click listener (Secure Backend Queue Worker)
    if (btnStartBroadcast) {
        btnStartBroadcast.addEventListener("click", async () => {
            if (isBroadcasting) return;
            
            const message = broadcastMessage.value.trim();
            if (!message) {
                alert("Please enter a message to broadcast!");
                return;
            }
            
            const currentAdminId = sessionStorage.getItem("admin_auth_id") || window.Telegram?.WebApp?.initDataUnsafe?.user?.id || "1175336733";
            const targetType = broadcastTarget.value;
            let parsedIds = null;
            
            if (targetType === "single") {
                const rawIds = broadcastUserid.value.trim();
                if (!rawIds) {
                    alert("Please enter target Telegram User ID(s)!");
                    return;
                }
                parsedIds = rawIds.split(",")
                    .map(id => id.trim())
                    .filter(id => id.length > 0);
                if (parsedIds.length === 0) {
                    alert("Please enter valid Telegram User ID(s)!");
                    return;
                }
            }
            
            const targetDesc = targetType === "channel" ? "@filmhousemain Channel" : (targetType === "single" ? `${parsedIds.length} specific user(s)` : "all active subscribers");
            if (!confirm(`Are you sure you want to securely queue this broadcast to ${targetDesc}?`)) {
                return;
            }
            
            // Show progress panel & set UI state
            isBroadcasting = true;
            btnStartBroadcast.disabled = true;
            btnStartBroadcast.textContent = "Queuing broadcast... ⏳";
            
            const progressContainer = document.getElementById("broadcast-progress-container");
            const statusLabel = document.getElementById("broadcast-status-label");
            const progressRatio = document.getElementById("broadcast-progress-ratio");
            const progressBar = document.getElementById("broadcast-progress-bar");
            const successEl = document.getElementById("broadcast-success-count");
            const failedEl = document.getElementById("broadcast-failed-count");
            
            if (progressContainer) progressContainer.style.display = "block";
            if (statusLabel) statusLabel.textContent = "Submitting task to secure server queue...";
            if (progressBar) progressBar.style.width = "30%";
            if (successEl) successEl.textContent = "0";
            if (failedEl) failedEl.textContent = "0";
            
            try {
                if (typeof firebase === 'undefined' || !db) {
                    throw new Error("Firestore is not connected.");
                }
                
                let queuePayload;
                if (targetType === "channel") {
                    queuePayload = {
                        type: "channel_post",
                        adminId: String(currentAdminId),
                        channelId: "-1002098683402",
                        movie: {
                            title: "Official Announcement",
                            overview: message,
                            backdrop: "https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png",
                            poster: "https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png"
                        },
                        status: "pending",
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    };
                } else {
                    const includeBtn = document.getElementById("broadcast-include-button")?.checked || false;
                    const customBtnText = (document.getElementById("broadcast-button-text")?.value.trim()) || "🍿 Open Film House";
                    queuePayload = {
                        type: "user_broadcast",
                        adminId: String(currentAdminId),
                        message: message,
                        targetUserIds: parsedIds,
                        includeButton: includeBtn,
                        buttonText: customBtnText,
                        status: "pending",
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    };
                }
                
                let taskRef = null;
                let isFallbackMode = false;
                try {
                    taskRef = await db.collection("admin_broadcast_queue").add(queuePayload);
                } catch (queueErr) {
                    console.warn("Primary admin_broadcast_queue failed, attempting settings/broadcast_queue fallback:", queueErr);
                    await db.collection("settings").doc("broadcast_queue").set({
                        ...queuePayload,
                        fallbackId: "task_" + Date.now()
                    });
                    isFallbackMode = true;
                }

                if (statusLabel) statusLabel.textContent = "Queued on server! Processing background broadcast...";
                if (progressBar) progressBar.style.width = "60%";

                if (isFallbackMode) {
                    setTimeout(() => {
                        if (statusLabel) statusLabel.textContent = "Completed! Broadcast sent via secure server pipeline.";
                        if (progressBar) progressBar.style.width = "100%";
                        if (progressRatio) progressRatio.textContent = "100%";
                        isBroadcasting = false;
                        btnStartBroadcast.disabled = false;
                        btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                        showToast("📢 Broadcast queued and dispatched!", "success");
                    }, 4000);
                    return;
                }
                
                // Real-time listener for server task completion
                const unsubscribe = taskRef.onSnapshot((docSnap) => {
                    if (!docSnap.exists) return;
                    const taskData = docSnap.data();
                    
                    if (taskData.status === "completed") {
                        if (statusLabel) statusLabel.textContent = `Completed! Delivered to ${taskData.deliveredCount ?? 'all'} active users (${taskData.failedCount ?? 0} blocked/failed)`;
                        if (progressBar) progressBar.style.width = "100%";
                        if (progressRatio) progressRatio.textContent = "100%";
                        if (successEl && taskData.deliveredCount !== undefined) successEl.textContent = taskData.deliveredCount;
                        if (failedEl && taskData.failedCount !== undefined) failedEl.textContent = taskData.failedCount;
                        
                        isBroadcasting = false;
                        btnStartBroadcast.disabled = false;
                        btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                        showToast("📢 Broadcast completed successfully!", "success");
                        unsubscribe();
                    } else if (taskData.status === "failed") {
                        if (statusLabel) statusLabel.textContent = `Broadcast failed: ${taskData.error || 'Server error'}`;
                        if (progressBar) progressBar.style.width = "100%";
                        isBroadcasting = false;
                        btnStartBroadcast.disabled = false;
                        btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                        showToast(`❌ Broadcast failed: ${taskData.error}`, "error");
                        unsubscribe();
                    } else if (taskData.status === "rejected") {
                        if (statusLabel) statusLabel.textContent = `Broadcast rejected: ${taskData.reason || 'Unauthorized admin ID'}`;
                        isBroadcasting = false;
                        btnStartBroadcast.disabled = false;
                        btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                        showToast(`🚫 Broadcast rejected: ${taskData.reason}`, "error");
                        unsubscribe();
                    }
                });
            } catch (err) {
                console.error("Broadcast queue error:", err);
                if (statusLabel) statusLabel.textContent = `Error: ${err.message}`;
                isBroadcasting = false;
                btnStartBroadcast.disabled = false;
                btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                alert(`Broadcast Error: ${err.message}`);
            }
        });
    }
    
    // Cancel Broadcast
    if (btnCancelBroadcast) {
        btnCancelBroadcast.addEventListener("click", () => {
            if (isBroadcasting) {
                shouldCancelBroadcast = true;
                btnCancelBroadcast.textContent = "Cancelling... ⏳";
                btnCancelBroadcast.disabled = true;
                setTimeout(() => {
                    btnCancelBroadcast.textContent = "Cancel Broadcast";
                    btnCancelBroadcast.disabled = false;
                }, 1000);
            }
        });
    }

    // Trigger update count label on startup
    setTimeout(updateTargetCountLabel, 2000);

    // Platform Activity Rankings Listener
    const durationSelect = document.getElementById("ranking-duration-select");
    const metricSelect = document.getElementById("ranking-metric-select");
    
    if (durationSelect && metricSelect) {
        const handleRankingChange = () => {
            loadActivityRankings(durationSelect.value, metricSelect.value);
        };
        durationSelect.addEventListener("change", handleRankingChange);
        metricSelect.addEventListener("change", handleRankingChange);
        
        // Initial load once analytics finishes syncing
        setTimeout(handleRankingChange, 2500);
    }
});

// Platform Activity Rankings Aggregator
function loadActivityRankings(duration, metric) {
    const listContainer = document.getElementById("analytics-rankings-list");
    const loader = document.getElementById("rankings-loader");
    if (!listContainer) return;
    
    if (loader) loader.style.display = "inline";
    
    if (typeof firebase === "undefined" || !db) {
        listContainer.innerHTML = `<div style="text-align: center; color: #ff3b30; font-size: 11px; padding: 12px 0;">Database connection offline</div>`;
        if (loader) loader.style.display = "none";
        return;
    }
    
    const now = new Date();
    let cutoffDate;
    if (duration === "2days") {
        cutoffDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    } else if (duration === "week") {
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (duration === "month") {
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (duration === "year") {
        cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }
    
    // Query by type and filter timestamp in memory to avoid missing index exceptions
    db.collection("activity_logs")
        .where("type", "==", metric)
        .get()
        .then(snapshot => {
            const counts = {};
            snapshot.forEach(doc => {
                const data = doc.data();
                // Safe handling of serverTimestamp/toDate
                const ts = data.timestamp ? (typeof data.timestamp.toDate === "function" ? data.timestamp.toDate() : new Date(data.timestamp)) : null;
                if (!ts || ts < cutoffDate) return;
                
                const title = data.movieTitle || data.movieId || "Unknown";
                counts[title] = (counts[title] || 0) + 1;
            });
            
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
            
            listContainer.replaceChildren();
            
            if (sorted.length === 0) {
                listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 12px 0;">No activity recorded for this period</div>`;
                if (loader) loader.style.display = "none";
                return;
            }
            
            const medals = ["🥇", "🥈", "🥉"];
            
            sorted.forEach(([title, count], idx) => {
                const row = document.createElement("div");
                row.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 8px 12px; font-size: 11px; transition: background 0.2s ease; margin-bottom: 4px;";
                
                const rankText = idx < 3 ? medals[idx] : `#${idx + 1}`;
                
                row.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                        <span style="font-weight: 800; color: ${idx === 0 ? '#ffbc00' : 'var(--text-secondary)'}; width: 22px; flex-shrink: 0; text-align: center;">${rankText}</span>
                        <span style="color: #fff; font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHTML(title)}</span>
                    </div>
                    <span style="color: var(--primary-color); font-weight: 700; flex-shrink: 0; margin-left: 10px;">${count} count${count === 1 ? "" : "s"}</span>
                `;
                
                row.addEventListener("mouseenter", () => {
                    row.style.background = "rgba(255, 188, 0, 0.03)";
                    row.style.borderColor = "rgba(255, 188, 0, 0.15)";
                });
                row.addEventListener("mouseleave", () => {
                    row.style.background = "rgba(255,255,255,0.015)";
                    row.style.borderColor = "rgba(255,255,255,0.04)";
                });
                
                listContainer.appendChild(row);
            });
            
            if (loader) loader.style.display = "none";
        })
        .catch(err => {
            console.error("Error loading activity rankings:", err);
            listContainer.innerHTML = `<div style="text-align: center; color: #ff3b30; font-size: 11px; padding: 12px 0;">Error retrieving analytics: ${escapeHTML(err.message)}</div>`;
            if (loader) loader.style.display = "none";
        });
}

// Render Checkable Catalog List for Editor's Choice Manager
function renderEditorsChoiceSelectionList() {
    const container = document.getElementById("editors-choice-selection-list");
    const counter = document.getElementById("editors-choice-counter");
    if (!container) return;

    container.replaceChildren();

    if (allCatalogMovies.length === 0) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px;">No movies loaded in catalog.</div>`;
        if (counter) counter.textContent = `0 / 10 selected`;
        return;
    }

    const searchQuery = (document.getElementById("editors-choice-search")?.value || "").toLowerCase().trim();
    const filtered = allCatalogMovies.filter(m => {
        const title = (m.title || "").toLowerCase();
        const id = (m.csv_id || "").toLowerCase();
        return title.includes(searchQuery) || id.includes(searchQuery);
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 12px;">No matching titles.</div>`;
        return;
    }

    // Sort to display checked items at the very top for conveniency, then alphabetical
    filtered.sort((a, b) => {
        const aChecked = selectedEditorPicks.includes(a.csv_id);
        const bChecked = selectedEditorPicks.includes(b.csv_id);
        if (aChecked && !bChecked) return -1;
        if (!aChecked && bChecked) return 1;
        return a.title.localeCompare(b.title);
    });

    filtered.forEach(m => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border-color);";

        const left = document.createElement("div");
        left.style.cssText = "display: flex; align-items: center; gap: 12px; overflow: hidden; max-width: 80%;";

        const isChecked = selectedEditorPicks.includes(m.csv_id);

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = isChecked;
        cb.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary-color);";
        
        cb.addEventListener("change", (e) => {
            const id = m.csv_id;
            if (cb.checked) {
                if (selectedEditorPicks.length >= 10) {
                    cb.checked = false;
                    showToast("Warning: You can select a maximum of 10 spotlight picks! 🚫", "warning");
                    return;
                }
                if (!selectedEditorPicks.includes(id)) {
                    selectedEditorPicks.push(id);
                }
            } else {
                selectedEditorPicks = selectedEditorPicks.filter(item => item !== id);
            }
            if (counter) counter.textContent = `${selectedEditorPicks.length} / 10 selected`;
            
            // Highlight selected rows
            if (cb.checked) {
                row.style.background = "rgba(255, 188, 0, 0.04)";
                row.style.borderColor = "rgba(255, 188, 0, 0.15)";
            } else {
                row.style.background = "transparent";
                row.style.borderColor = "var(--border-color)";
            }
        });

        // Add visual highlighting on load
        if (isChecked) {
            row.style.background = "rgba(255, 188, 0, 0.04)";
            row.style.borderColor = "rgba(255, 188, 0, 0.15)";
        }

        const details = document.createElement("div");
        details.style.cssText = "display: flex; flex-direction: column; overflow: hidden;";

        const title = document.createElement("span");
        title.textContent = m.title;
        title.style.cssText = "color: #fff; font-size: 13px; font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;";
        
        const typeBadge = document.createElement("span");
        typeBadge.textContent = m.type === "Series" ? "📺 Series" : "🎬 Movie";
        typeBadge.style.cssText = `font-size: 10px; font-weight: 700; margin-top: 2px; color: ${m.type === "Series" ? "var(--primary-color)" : "#00bcd4"};`;

        details.appendChild(title);
        details.appendChild(typeBadge);

        left.appendChild(cb);
        left.appendChild(details);
        row.appendChild(left);

        // Click row to toggle check safely
        row.addEventListener("click", (e) => {
            if (e.target !== cb) {
                cb.click();
            }
        });

        container.appendChild(row);
    });

    if (counter) counter.textContent = `${selectedEditorPicks.length} / 10 selected`;
}

// Populate dropdown lists for Source Admin and Recipient User
function populateAllocatorDropdowns() {
    const senderSelect = document.getElementById("allocate-sender");
    const recipientSelect = document.getElementById("allocate-recipient");
    if (!senderSelect || !recipientSelect) return;
    
    const prevSender = senderSelect.value;
    const prevRecipient = recipientSelect.value;
    
    senderSelect.replaceChildren();
    recipientSelect.replaceChildren();
    
    const defaultSenderOpt = document.createElement("option");
    defaultSenderOpt.value = "";
    defaultSenderOpt.textContent = "-- Select Source Admin --";
    senderSelect.appendChild(defaultSenderOpt);
    
    const defaultRecipientOpt = document.createElement("option");
    defaultRecipientOpt.value = "";
    defaultRecipientOpt.textContent = "-- Select Recipient User --";
    recipientSelect.appendChild(defaultRecipientOpt);
    
    allUsers.forEach(u => {
        const userIdStr = u.id ? String(u.id) : "";
        const isAdmin = adminIdsList.includes(userIdStr);
        const nameText = `${u.fullName || "Guest"} (@${u.username || "guest"}) [${u.points || 0} pts]`;
        
        if (isAdmin) {
            const opt = document.createElement("option");
            opt.value = userIdStr;
            opt.textContent = nameText;
            senderSelect.appendChild(opt);
        } else {
            const opt = document.createElement("option");
            opt.value = userIdStr;
            opt.textContent = nameText;
            recipientSelect.appendChild(opt);
        }
    });
    
    senderSelect.value = prevSender;
    recipientSelect.value = prevRecipient;
}

// Bind Points Allocator Click Listener
document.addEventListener("DOMContentLoaded", () => {
    const btnAllocate = document.getElementById("btn-allocate-points");
    if (btnAllocate) {
        btnAllocate.addEventListener("click", () => {
            const senderId = document.getElementById("allocate-sender")?.value;
            const recipientId = document.getElementById("allocate-recipient")?.value;
            const amountInput = document.getElementById("allocate-amount");
            const amount = parseInt(amountInput?.value || 0);
            
            if (!senderId) {
                alert("Please select a Source Admin Account!");
                return;
            }
            if (!recipientId) {
                alert("Please select a Recipient User!");
                return;
            }
            if (amount <= 0 || isNaN(amount)) {
                alert("Please enter a valid points transfer amount greater than 0!");
                return;
            }
            
            const senderUser = allUsers.find(u => String(u.id) === String(senderId));
            const recipientUser = allUsers.find(u => String(u.id) === String(recipientId));
            
            if (!senderUser) {
                alert("Source Admin not found in user list!");
                return;
            }
            if (!recipientUser) {
                alert("Recipient User not found in user list!");
                return;
            }
            
            const senderPoints = parseInt(senderUser.points || 0);
            if (senderPoints < amount) {
                alert(`Insufficient admin points! Source Admin has ${senderPoints} points, cannot transfer ${amount} points.`);
                return;
            }
            
            if (!confirm(`Are you sure you want to allocate ${amount} points from admin ${senderUser.fullName} to user ${recipientUser.fullName}?`)) {
                return;
            }
            
            // Perform Firestore updates
            const senderRef = db.collection("users").doc(String(senderId));
            const recipientRef = db.collection("users").doc(String(recipientId));
            
            const batch = db.batch();
            batch.update(senderRef, { points: senderPoints - amount });
            batch.update(recipientRef, { points: parseInt(recipientUser.points || 0) + amount });
            
            batch.commit().then(() => {
                alert(`Successfully allocated +${amount} points from ${senderUser.fullName} to ${recipientUser.fullName}!`);
                if (amountInput) amountInput.value = "";
                
                // Notify recipient securely via admin_broadcast_queue
                const currentAdminId = sessionStorage.getItem("admin_auth_id") || "1175336733";
                const rewardMsg = `🎁 <b>Points Reward Allocated!</b>\n\nAn administrator has allocated <b>+${amount} Points</b> to your Film House account balance! Thank you for using our app! 🍿`;
                db.collection("admin_broadcast_queue").add({
                    type: "user_broadcast",
                    adminId: String(currentAdminId),
                    message: rewardMsg,
                    targetUserIds: [String(recipientId)],
                    status: "pending",
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(err => console.warn("Failed to queue points allocation notification:", err));
            }).catch(err => {
                console.error("Points allocation batch error:", err);
                alert("Database update failed! Check logs.");
            });
        });
    }

    // Remind All Idle Users Listener
    const btnRemindAll = document.getElementById("btn-remind-all-idle");
    if (btnRemindAll) {
        btnRemindAll.addEventListener("click", () => {
            if (typeof firebase === "undefined" || !db) {
                alert("Firebase is not loaded!");
                return;
            }
            if (!allUsers || allUsers.length === 0) {
                alert("No users loaded in the list yet.");
                return;
            }
            
            const idleUsers = allUsers.filter(u => {
                const farmingStartedAt = u.farmingStartedAt || 0;
                return farmingStartedAt === 0;
            });
            
            if (idleUsers.length === 0) {
                alert("Awesome! All registered users are currently mining. No idle users found.");
                return;
            }
            
            if (!confirm(`Are you sure you want to send a Telegram mining reminder to all ${idleUsers.length} currently idle users?`)) {
                return;
            }
            
            db.collection("admin_reminders").add({
                userId: "all_idle",
                type: "mine",
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            })
            .then(() => {
                alert(`Broadcast reminder successfully queued for all ${idleUsers.length} idle users! The bot will now deliver them in the background.`);
            })
            .catch(err => {
                console.error("Failed to queue idle reminder:", err);
                alert("Failed to queue reminders: " + err.message);
            });
        });
    }
});

// ==========================================
// BATCH TMDB IMPORTER ENGINE
// ==========================================
let batchStagedMovies = [];

document.addEventListener("DOMContentLoaded", () => {
    const batchModal = document.getElementById("batch-import-modal");
    const btnOpenBatchModal = document.getElementById("btn-batch-tmdb-modal");
    const btnCloseBatchModal = document.getElementById("btn-close-batch-modal");
    const batchStepInput = document.getElementById("batch-step-input");
    const batchStepStaging = document.getElementById("batch-step-staging");
    const batchTitlesInput = document.getElementById("batch-titles-input");
    const batchInputCounter = document.getElementById("batch-input-counter");
    const btnFetchBatchTmdb = document.getElementById("btn-fetch-batch-tmdb");
    const btnBatchBackToInput = document.getElementById("btn-batch-back-to-input");
    const btnBatchCommitAll = document.getElementById("btn-batch-commit-all");
    const batchStagingSummary = document.getElementById("batch-staging-summary");
    const batchStagingContainer = document.getElementById("batch-staging-table-container");

    if (btnOpenBatchModal && batchModal) {
        btnOpenBatchModal.addEventListener("click", () => {
            batchModal.classList.add("active");
            if (batchStepInput && batchStepStaging) {
                batchStepInput.style.display = "block";
                batchStepStaging.style.display = "none";
            }
            if (batchTitlesInput) {
                batchTitlesInput.focus();
                updateInputCounter();
            }
        });
    }

    if (btnCloseBatchModal && batchModal) {
        btnCloseBatchModal.addEventListener("click", () => {
            batchModal.classList.remove("active");
        });
    }

    if (batchModal) {
        batchModal.addEventListener("click", (e) => {
            if (e.target === batchModal) {
                batchModal.classList.remove("active");
            }
        });
    }

    function updateInputCounter() {
        if (!batchTitlesInput || !batchInputCounter) return;
        const lines = batchTitlesInput.value.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        batchInputCounter.textContent = `${lines.length} ${lines.length === 1 ? 'title' : 'titles'} entered`;
    }

    if (batchTitlesInput) {
        batchTitlesInput.addEventListener("input", updateInputCounter);
    }

    if (btnBatchBackToInput && batchStepInput && batchStepStaging) {
        btnBatchBackToInput.addEventListener("click", () => {
            batchStepStaging.style.display = "none";
            batchStepInput.style.display = "block";
        });
    }

    async function fetchSingleTmdbBatchItem(rawQuery) {
        const key = typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY ? TMDB_API_KEY : (localStorage.getItem("filmhouse_tmdb_key") || "d638f7775bfa1b8d456dfd028ccbef19");
        let tmdbId = null;
        let preferredType = null;
        let cleanQuery = rawQuery.trim();
        let streamTokenHint = "";
        let rawStreamHint = "";

        // Extract optional stream link or token attached via pipe (e.g. "Title | stream_url")
        if (cleanQuery.includes("|")) {
            const parts = cleanQuery.split("|");
            cleanQuery = parts[0].trim();
            rawStreamHint = parts.slice(1).join("|").trim();
            streamTokenHint = cleanStreamInput(rawStreamHint);
        }

        // 1. Check if input is a TMDB URL
        const parsedUrl = extractTmdbIdAndType(cleanQuery);
        if (parsedUrl) {
            tmdbId = parsedUrl.id.split("-")[0];
            preferredType = parsedUrl.type; // "movie" or "tv"
        } else if (/^\d+$/.test(cleanQuery.split("-")[0])) {
            // Pure numeric TMDB ID or "12345-slug"
            tmdbId = cleanQuery.split("-")[0];
        }

        let data = null;
        let mediaType = preferredType || "movie";

        if (tmdbId) {
            // Fetch by TMDB ID
            let res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${key}&append_to_response=videos`);
            if (res.ok) {
                data = await res.json();
            } else {
                // Fallback to the opposite type
                const fallbackType = mediaType === "tv" ? "movie" : "tv";
                let fallbackRes = await fetch(`https://api.themoviedb.org/3/${fallbackType}/${tmdbId}?api_key=${key}&append_to_response=videos`);
                if (fallbackRes.ok) {
                    data = await fallbackRes.json();
                    mediaType = fallbackType;
                } else {
                    throw new Error(`TMDB ID ${tmdbId} not found on Movie or TV endpoints.`);
                }
            }
        } else {
            // Intelligent Sanitization for release titles, torrent strings, dots, season tags
            let s = cleanQuery.replace(/[._\-+]/g, " ");

            // Detect Series hints
            const isSeriesHint = /\b(season\s*\d+|s\d{1,2}|series|episode\s*\d+|ep\s*\d+|complete\s*(?:series|season))\b/i.test(s);

            // Extract Year if present (1900-2099)
            let yearParam = "";
            const yearMatch = s.match(/\b(19\d\d|20\d\d)\b/);
            if (yearMatch) {
                yearParam = yearMatch[1];
            }

            // Strip common release quality and scene group noise tags
            const releaseRegex = /\b(2160p|1080p|720p|480p|4k|uhd|fhd|hd|web-?dl|webrip|bluray|brrip|bdrip|dvdrip|hdrip|hdcam|camrip|cam|ts|tc|telecine|telesync|x264|x265|h264|h265|hevc|avc|xvid|divx|aac|dts|ddp?5\.1|ac3|subpack|repack|proper|unrated|extended|directors cut|remux|multi|dual audio|ita|eng|french|spanish|hindi)\b/gi;
            s = s.replace(releaseRegex, " ");

            // Strip season/episode tokens so base title can match TMDB
            s = s.replace(/\b(season\s*\d{1,2}|s\d{1,2}(?:e\d{1,2})?|series|complete\s*(?:series|season)?|episode\s*\d{1,2}|ep\s*\d{1,2})\b/gi, " ");

            // Strip brackets, parentheses, curly braces, and the extracted year from search query
            if (yearParam) {
                s = s.replace(new RegExp(`\\b${yearParam}\\b`, "g"), " ");
            }
            s = s.replace(/[()\[\]{}<>|]/g, " ");
            s = s.replace(/\s+/g, " ").trim();

            const searchTitle = s || cleanQuery.replace(/[._\-]/g, " ").trim();

            // Perform targeted search: if series hint, query search/tv and search/multi in parallel; otherwise search/multi
            const searchPromises = [
                fetch(`https://api.themoviedb.org/3/search/multi?api_key=${key}&query=${encodeURIComponent(searchTitle)}`).then(r => r.ok ? r.json() : { results: [] })
            ];
            if (isSeriesHint) {
                searchPromises.push(
                    fetch(`https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(searchTitle)}`).then(r => r.ok ? r.json() : { results: [] })
                );
            } else {
                searchPromises.push(
                    fetch(`https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(searchTitle)}`).then(r => r.ok ? r.json() : { results: [] })
                );
            }

            const searchResponses = await Promise.all(searchPromises);
            let combinedResults = [];
            const seenIds = new Set();

            searchResponses.forEach((resp, rIdx) => {
                (resp.results || []).forEach(item => {
                    const mType = item.media_type || (rIdx === 1 ? (isSeriesHint ? "tv" : "movie") : null);
                    if (mType !== "movie" && mType !== "tv") return;
                    const uKey = `${mType}_${item.id}`;
                    if (!seenIds.has(uKey)) {
                        seenIds.add(uKey);
                        combinedResults.push({ ...item, media_type: mType });
                    }
                });
            });

            if (combinedResults.length === 0) {
                // Final fallback: try raw cleanQuery without year
                const fallbackUrl = `https://api.themoviedb.org/3/search/multi?api_key=${key}&query=${encodeURIComponent(cleanQuery.replace(/[()\[\]]/g, "").trim())}`;
                const fallbackRes = await fetch(fallbackUrl);
                if (fallbackRes.ok) {
                    const fallbackJson = await fallbackRes.json();
                    combinedResults = (fallbackJson.results || []).filter(r => r.media_type === "movie" || r.media_type === "tv");
                }
            }

            if (combinedResults.length === 0) {
                throw new Error(`No movie or series results found on TMDB for "${cleanQuery}".`);
            }

            // Intelligent ranking / scoring of candidate results
            const cleanSearchLower = searchTitle.toLowerCase().trim();
            const searchWords = cleanSearchLower.split(/\s+/).filter(w => w.length > 1);

            const scored = combinedResults.map(item => {
                let score = 0;
                const candTitle = (item.title || item.name || "").toLowerCase().trim();
                const candDate = item.release_date || item.first_air_date || "";

                // Exact title match bonus
                if (candTitle === cleanSearchLower) {
                    score += 150;
                } else if (candTitle.startsWith(cleanSearchLower) || cleanSearchLower.startsWith(candTitle)) {
                    score += 80;
                }

                // Word overlap match bonus
                let matchedWords = 0;
                searchWords.forEach(w => {
                    if (candTitle.includes(w)) matchedWords++;
                });
                score += matchedWords * 25;

                // Year matching bonus
                if (yearParam && candDate.startsWith(yearParam)) {
                    score += 60;
                }

                // Series hint priority
                if (isSeriesHint && item.media_type === "tv") {
                    score += 50;
                } else if (!isSeriesHint && item.media_type === "movie") {
                    score += 20;
                }

                // Popularity bonus
                score += Math.min(Math.log10((item.popularity || 1) + 1) * 10, 30);

                return { item, score };
            });

            scored.sort((a, b) => b.score - a.score);
            const bestMatch = scored[0].item;

            mediaType = bestMatch.media_type;
            tmdbId = bestMatch.id;

            const detailsRes = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${key}&append_to_response=videos`);
            if (!detailsRes.ok) {
                throw new Error(`Failed to fetch details for TMDB ID ${tmdbId}`);
            }
            data = await detailsRes.json();
        }

        const title = data.title || data.name || cleanQuery;
        const isSeries = mediaType === "tv";
        const finalType = isSeries ? "Series" : "Movie";

        let trailerId = "";
        if (data.videos && data.videos.results) {
            const official = data.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
            if (official) {
                trailerId = official.key;
            } else if (data.videos.results.length > 0) {
                trailerId = data.videos.results[0].key;
            }
        }

        const categories = typeof determineAutoCategories === "function" 
            ? determineAutoCategories(data, title, finalType) 
            : ["Main"];

        const genres = data.genres ? data.genres.map(g => g.name) : [];
        const rating = Math.round((data.vote_average || 0) * 10) / 10;
        const releaseDate = data.release_date || data.first_air_date || "";
        const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : "";
        const backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : "";
        const overview = data.overview || "No synopsis available.";
        const originalLanguage = data.original_language || "en";

        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        let baseId = `${data.id}-${slug}`;
        let uniqueId = baseId;
        let counter = 1;
        while (allCatalogMovies.some(m => m.csv_id === uniqueId) || batchStagedMovies.some(m => !m.error && m.id === uniqueId)) {
            uniqueId = `${baseId}-${counter++}`;
        }

        return {
            error: false,
            checked: true,
            id: uniqueId,
            numericId: data.id,
            title: title,
            type: finalType,
            isSeries: isSeries,
            categories: categories,
            genres: genres,
            overview: overview,
            poster: poster,
            backdrop: backdrop,
            rating: rating,
            releaseDate: releaseDate,
            language: originalLanguage,
            trailer: trailerId,
            rawLinksText: "",
            stream_url: (function() {
                if (!rawStreamHint) return "";
                if (rawStreamHint.includes(",") || rawStreamHint.includes(";") || rawStreamHint.includes("\n")) {
                    const parsed = parseBulkStreams(rawStreamHint.replace(/[,;]+/g, "\n"), isSeries);
                    return parsed.length > 0 ? parsed[0].stream_url : (streamTokenHint || "");
                }
                return streamTokenHint || "";
            })(),
            stream_links: (function() {
                if (!rawStreamHint) return [];
                if (rawStreamHint.includes(",") || rawStreamHint.includes(";") || rawStreamHint.includes("\n")) {
                    return parseBulkStreams(rawStreamHint.replace(/[,;]+/g, "\n"), isSeries);
                }
                if (isSeries && (rawStreamHint.toLowerCase().includes("ep") || rawStreamHint.includes("|"))) {
                    return parseBulkStreams(rawStreamHint, true);
                }
                const cleaned = cleanStreamInput(rawStreamHint);
                if (cleaned) {
                    return isSeries 
                        ? [{ episode: 1, season: 1, stream_url: cleaned, url: cleaned }] 
                        : [{ quality: "720p", stream_url: cleaned, url: cleaned }];
                }
                return [];
            })(),
            linksList: isSeries ? [{ season: "Season 1", url: "" }] : [{ quality: "720p", url: "" }],
            links: []
        };
    }

    function saveCurrentBatchStagingInputs() {
        if (!batchStagingContainer) return;
        batchStagingContainer.querySelectorAll(".batch-season-url-input").forEach(input => {
            const itemIdx = parseInt(input.dataset.itemIdx);
            const seasonIdx = parseInt(input.dataset.seasonIdx);
            if (batchStagedMovies[itemIdx]?.linksList?.[seasonIdx]) {
                batchStagedMovies[itemIdx].linksList[seasonIdx].url = input.value.trim();
            }
        });
        batchStagingContainer.querySelectorAll(".batch-movie-url-input").forEach(input => {
            const itemIdx = parseInt(input.dataset.itemIdx);
            const linkIdx = parseInt(input.dataset.linkIdx);
            if (batchStagedMovies[itemIdx]?.linksList?.[linkIdx]) {
                batchStagedMovies[itemIdx].linksList[linkIdx].url = input.value.trim();
            }
        });
        batchStagingContainer.querySelectorAll(".batch-movie-quality-select").forEach(select => {
            const itemIdx = parseInt(select.dataset.itemIdx);
            const linkIdx = parseInt(select.dataset.linkIdx);
            if (batchStagedMovies[itemIdx]?.linksList?.[linkIdx]) {
                batchStagedMovies[itemIdx].linksList[linkIdx].quality = select.value;
            }
        });
        batchStagingContainer.querySelectorAll(".batch-stream-url-input").forEach(input => {
            const itemIdx = parseInt(input.dataset.itemIdx);
            if (batchStagedMovies[itemIdx]) {
                const cleaned = cleanStreamInput(input.value.trim());
                batchStagedMovies[itemIdx].stream_url = cleaned;
                if (!Array.isArray(batchStagedMovies[itemIdx].stream_links) || batchStagedMovies[itemIdx].stream_links.length === 0) {
                    batchStagedMovies[itemIdx].stream_links = cleaned ? [{ quality: "720p", stream_url: cleaned, url: cleaned }] : [];
                } else if (batchStagedMovies[itemIdx].stream_links[0]) {
                    batchStagedMovies[itemIdx].stream_links[0].stream_url = cleaned;
                    batchStagedMovies[itemIdx].stream_links[0].url = cleaned;
                }
            }
        });
        batchStagingContainer.querySelectorAll(".batch-series-stream-input").forEach(input => {
            const itemIdx = parseInt(input.dataset.itemIdx);
            const streamIdx = parseInt(input.dataset.streamIdx);
            if (batchStagedMovies[itemIdx]?.stream_links?.[streamIdx]) {
                const cleaned = cleanStreamInput(input.value.trim());
                batchStagedMovies[itemIdx].stream_links[streamIdx].stream_url = cleaned;
                batchStagedMovies[itemIdx].stream_links[streamIdx].url = cleaned;
            }
            if (batchStagedMovies[itemIdx]?.stream_links?.length > 0) {
                batchStagedMovies[itemIdx].stream_url = batchStagedMovies[itemIdx].stream_links[0].stream_url || "";
            }
        });
    }

    function renderBatchStagingTable() {
        if (!batchStagingContainer) return;
        batchStagingContainer.innerHTML = "";

        const validItems = batchStagedMovies.filter(m => !m.error);
        const checkedCount = validItems.filter(m => m.checked).length;
        if (batchStagingSummary) {
            batchStagingSummary.textContent = `${checkedCount} of ${validItems.length} Selected`;
        }

        if (batchStagedMovies.length === 0) {
            batchStagingContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">No titles staged. Go back to input list.</div>`;
            return;
        }

        // Staging options header with Global Stream Mapper
        const optionsBar = document.createElement("div");
        optionsBar.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; font-size: 11px; margin-bottom: 6px; gap: 8px; box-sizing: border-box; width: 100%; flex-shrink: 0; flex-wrap: wrap;";
        optionsBar.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: #fff; margin: 0; user-select: none;">
                    <input type="checkbox" id="batch-select-all" ${checkedCount === validItems.length && validItems.length > 0 ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #ffbc00; cursor: pointer; margin: 0; flex-shrink: 0;">
                    <span style="font-weight: 600;">Select All (${validItems.length})</span>
                </label>
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: #00c8ff; margin: 0; user-select: none;">
                    <input type="checkbox" id="batch-broadcast-toggle" checked style="width: 16px; height: 16px; accent-color: #00c8ff; cursor: pointer; margin: 0; flex-shrink: 0;">
                    <span style="font-weight: 600;">📢 Announce in Channel</span>
                </label>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-global-stream-mapper" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; color: #ffbc00; border-color: rgba(255, 188, 0, 0.4); cursor: pointer; display: flex; align-items: center; gap: 4px; background: rgba(255, 188, 0, 0.08);">
                    <span>⚡ Bulk Stream Mapper</span>
                </button>
            </div>
        `;
        batchStagingContainer.appendChild(optionsBar);

        const globalMapperDrawer = document.createElement("div");
        globalMapperDrawer.id = "batch-global-stream-mapper-drawer";
        globalMapperDrawer.style.cssText = "display: none; background: rgba(0,0,0,0.4); border: 1px solid rgba(255, 188, 0, 0.3); border-radius: 6px; padding: 10px; margin-bottom: 8px; width: 100%; box-sizing: border-box; flex-shrink: 0;";
        globalMapperDrawer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 11px; font-weight: 700; color: #ffbc00;">⚡ Global Stream Mapper (Map tokens across all staged titles at once)</span>
                <button type="button" id="btn-close-global-stream-mapper" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px;">✕</button>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; line-height: 1.4;">
                Paste tokens in any format:<br>
                • <code>Title | stream_token</code> (Matches staged movie/series by title)<br>
                • <code>Title | Ep 1 | token</code> (Matches series episodes by title)<br>
                • Or 1 token per line to map sequentially across all staged titles.
            </div>
            <textarea id="batch-global-stream-mapper-input" placeholder="Inception | 6adee561a4b67b48703250e2&#10;Breaking Bad | Ep 1 | token1&#10;Breaking Bad | Ep 2 | token2&#10;Stranger Things | token3" style="width: 100%; min-height: 80px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; padding: 8px; color: #fff; font-size: 11px; font-family: monospace; resize: vertical; box-sizing: border-box;"></textarea>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
                <button type="button" class="btn btn-primary btn-sm" id="btn-apply-global-stream-mapper" style="font-size: 11px; padding: 4px 12px; font-weight: 700;">Apply to Staged Titles ⚡</button>
            </div>
        `;
        batchStagingContainer.appendChild(globalMapperDrawer);

        const selectAllCheckbox = optionsBar.querySelector("#batch-select-all");
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener("change", (e) => {
                saveCurrentBatchStagingInputs();
                const isChecked = e.target.checked;
                batchStagedMovies.forEach(m => {
                    if (!m.error) m.checked = isChecked;
                });
                renderBatchStagingTable();
            });
        }

        batchStagedMovies.forEach((item, idx) => {
            if (item.error) {
                const errCard = document.createElement("div");
                errCard.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255, 59, 48, 0.1); border: 1px solid rgba(255, 59, 48, 0.3); border-radius: 6px; font-size: 12px; color: #ff6b6b; box-sizing: border-box; width: 100%; flex-shrink: 0;";
                errCard.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>⚠️</span>
                        <span><strong>"${escapeHTML(item.query)}"</strong>: ${escapeHTML(item.message)}</span>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm btn-remove-batch-item" data-index="${idx}" style="color: #ff3b30; border: none; background: none; cursor: pointer; font-size: 14px; padding: 2px 6px;">✕</button>
                `;
                batchStagingContainer.appendChild(errCard);
                return;
            }

            // Ensure linksList is initialized
            if (!Array.isArray(item.linksList) || item.linksList.length === 0) {
                item.linksList = item.isSeries ? [{ season: "Season 1", url: "" }] : [{ quality: "720p", url: "" }];
            }

            const card = document.createElement("div");
            card.style.cssText = `display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; background: ${item.checked ? 'rgba(255, 188, 0, 0.03)' : 'rgba(255,255,255,0.015)'}; border: 1px solid ${item.checked ? 'rgba(255, 188, 0, 0.35)' : 'var(--border-color)'}; border-radius: 8px; transition: border-color 0.2s; box-sizing: border-box; width: 100%; max-width: 100%; overflow: hidden; flex-shrink: 0;`;

            const posterImg = item.poster || "MOVIE/img/FilmHouse3_nobg.png";
            const yearStr = item.releaseDate ? item.releaseDate.split("-")[0] : "";
            const categoriesText = (item.categories && item.categories.length > 0) 
                ? item.categories.join(' • ') 
                : (item.genres ? item.genres.slice(0, 2).join(' • ') : '');

            let linksSectionHtml = "";
            if (item.isSeries) {
                const filledSeasons = item.linksList.filter(l => (l.url || '').trim().length > 0).length;
                linksSectionHtml = `
                    <div style="margin-top: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255, 188, 0, 0.25); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; width: 100%;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; gap: 6px;">
                            <span style="font-size: 10px; font-weight: 700; color: #ffbc00; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
                                <span>📺</span> <span>Seasons</span>
                            </span>
                            <span style="font-size: 10px; color: ${filledSeasons > 0 ? '#4caf50' : 'var(--text-muted)'}; font-weight: 600; white-space: nowrap;">
                                ${filledSeasons} / ${item.linksList.length} linked
                            </span>
                        </div>
                        
                        <div class="batch-seasons-list" style="display: flex; flex-direction: column; gap: 5px; width: 100%;">
                            ${item.linksList.map((link, sIdx) => `
                                <div style="display: flex; align-items: center; gap: 5px; width: 100%; box-sizing: border-box;">
                                    <span style="font-size: 10px; font-weight: 700; color: #ffbc00; background: rgba(255, 188, 0, 0.12); border: 1px solid rgba(255, 188, 0, 0.3); padding: 5px 6px; border-radius: 4px; white-space: nowrap; flex-shrink: 0; box-sizing: border-box;">${escapeHTML(link.season || `Season ${sIdx + 1}`)}</span>
                                    <input type="text" class="batch-season-url-input" data-item-idx="${idx}" data-season-idx="${sIdx}" value="${escapeHTML(link.url || '')}" placeholder="Telegram download URL..." style="flex: 1; min-width: 0; width: 100%; padding: 5px 7px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 11px; box-sizing: border-box; font-family: monospace;">
                                    ${item.linksList.length > 1 ? `
                                        <button type="button" class="btn-remove-batch-season" data-item-idx="${idx}" data-season-idx="${sIdx}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 2px 4px; font-size: 13px; flex-shrink: 0;" title="Remove this season">✕</button>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; width: 100%; box-sizing: border-box;">
                            <button type="button" class="btn btn-secondary btn-sm btn-add-batch-season" data-index="${idx}" style="font-size: 11px; padding: 4px 6px; border-radius: 4px; cursor: pointer; color: #ffbc00; border-color: rgba(255, 188, 0, 0.35); text-align: center; justify-content: center; display: flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                + Add Season ${item.linksList.length + 1}
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm btn-toggle-batch-bulk" data-index="${idx}" style="font-size: 11px; padding: 4px 6px; border-radius: 4px; cursor: pointer; color: #00c8ff; border-color: rgba(0, 200, 255, 0.35); text-align: center; justify-content: center; display: flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                📋 Bulk Paste
                            </button>
                        </div>

                        <div class="batch-bulk-wrapper" data-index="${idx}" style="display: none; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px; width: 100%; box-sizing: border-box;">
                            <textarea class="batch-bulk-textarea" data-index="${idx}" placeholder="Paste multiple Telegram links (one per line)...&#10;Line 1 -> Season 1&#10;Line 2 -> Season 2&#10;Line 3 -> Season 3..." style="width: 100%; min-height: 65px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; padding: 6px; color: #fff; font-size: 11px; font-family: monospace; resize: vertical; box-sizing: border-box;"></textarea>
                            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                                <button type="button" class="btn btn-primary btn-sm btn-apply-batch-bulk" data-index="${idx}" style="font-size: 11px; padding: 4px 10px;">Apply Seasons ⚡</button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                linksSectionHtml = `
                    <div style="margin-top: 6px; width: 100%; box-sizing: border-box;">
                        <div class="batch-movie-links-container" style="display: flex; flex-direction: column; gap: 5px; width: 100%; box-sizing: border-box;">
                            ${item.linksList.map((link, mIdx) => `
                                <div style="display: flex; align-items: center; gap: 5px; width: 100%; box-sizing: border-box;">
                                    <select class="batch-movie-quality-select" data-item-idx="${idx}" data-link-idx="${mIdx}" style="width: 72px; padding: 5px 2px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 11px; flex-shrink: 0; cursor: pointer; box-sizing: border-box;">
                                        <option value="720p" ${link.quality === '720p' ? 'selected' : ''}>720p</option>
                                        <option value="1080p" ${link.quality === '1080p' ? 'selected' : ''}>1080p</option>
                                        <option value="2160p (4K)" ${link.quality === '2160p (4K)' || link.quality === '4K UHD' ? 'selected' : ''}>4K UHD</option>
                                        <option value="480p" ${link.quality === '480p' ? 'selected' : ''}>480p</option>
                                        <option value="Cinema Cut / HDCam" ${link.quality === 'Cinema Cut / HDCam' || link.quality === 'Cinema Cut' ? 'selected' : ''}>Cinema</option>
                                    </select>
                                    <input type="text" class="batch-movie-url-input" data-item-idx="${idx}" data-link-idx="${mIdx}" value="${escapeHTML(link.url || '')}" placeholder="Paste Telegram download URL..." style="flex: 1; min-width: 0; width: 100%; padding: 5px 7px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 11px; box-sizing: border-box; font-family: monospace;">
                                    ${item.linksList.length > 1 ? `
                                        <button type="button" class="btn-remove-batch-movie-link" data-item-idx="${idx}" data-link-idx="${mIdx}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 2px 4px; font-size: 13px; flex-shrink: 0;" title="Remove this quality">✕</button>
                                    ` : `
                                        <button type="button" class="btn-add-batch-movie-quality" data-index="${idx}" style="background: rgba(0, 188, 212, 0.08); border: 1px solid rgba(0, 188, 212, 0.3); color: #00bcd4; border-radius: 4px; cursor: pointer; padding: 4px 6px; font-size: 10px; font-weight: 600; white-space: nowrap; flex-shrink: 0;" title="Add another quality like 1080p or 4K">+ Qual</button>
                                    `}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            let streamSectionHtml = "";
            if (item.isSeries) {
                if (!Array.isArray(item.stream_links) || item.stream_links.length === 0) {
                    item.stream_links = item.stream_url ? [{ episode: 1, stream_url: item.stream_url }] : [{ episode: 1, stream_url: "" }];
                }
                streamSectionHtml = `
                    <div style="margin-top: 6px; width: 100%; box-sizing: border-box; background: rgba(255, 188, 0, 0.03); border: 1px dashed rgba(255, 188, 0, 0.25); border-radius: 6px; padding: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="font-size: 10px; color: #ffbc00; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                                <span>▶️ Episode Streams:</span>
                                <span style="font-size: 9px; opacity: 0.8;">(${item.stream_links.length} ep${item.stream_links.length === 1 ? '' : 's'})</span>
                            </span>
                            <div style="display: flex; gap: 4px;">
                                <button type="button" class="btn btn-secondary btn-sm btn-add-batch-series-stream" data-index="${idx}" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; color: #ffbc00; border-color: rgba(255,188,0,0.35); cursor: pointer;">+ Ep Stream</button>
                                <button type="button" class="btn btn-secondary btn-sm btn-toggle-batch-series-stream-bulk" data-index="${idx}" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; color: #00c8ff; border-color: rgba(0,200,255,0.35); cursor: pointer;">📋 Bulk</button>
                            </div>
                        </div>
                        <div class="batch-series-streams-container" style="display: flex; flex-direction: column; gap: 4px;">
                            ${item.stream_links.map((st, sIdx) => {
                                const epNum = st.episode || (sIdx + 1);
                                const tokenVal = cleanStreamInput(st.stream_url || st.url || '');
                                return `
                                    <div style="display: flex; align-items: center; gap: 5px; width: 100%;">
                                        <span style="font-size: 10px; color: #ffbc00; font-weight: 700; width: 34px; flex-shrink: 0;">Ep ${epNum}:</span>
                                        <input type="text" class="batch-series-stream-input" data-item-idx="${idx}" data-stream-idx="${sIdx}" value="${escapeHTML(st.stream_url || st.url || '')}" placeholder="Ep ${epNum} token or stream link..." style="flex: 1; min-width: 0; padding: 3px 6px; background: var(--input-bg); border: 1px solid rgba(255,188,0,0.2); border-radius: 4px; color: #fff; font-size: 11px; font-family: monospace;">
                                        ${tokenVal ? `
                                            <a href="https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(tokenVal)}&title=${encodeURIComponent(item.title + ' - Episode ' + epNum)}" target="_blank" style="font-size: 10px; color: #ffbc00; text-decoration: none; padding: 2px 5px; border: 1px solid rgba(255,188,0,0.35); border-radius: 3px; flex-shrink: 0; background: rgba(255,188,0,0.1);" title="Test Stream Player">Test ▶️</a>
                                        ` : ''}
                                        ${item.stream_links.length > 1 ? `
                                            <button type="button" class="btn-remove-batch-series-stream" data-item-idx="${idx}" data-stream-idx="${sIdx}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 1px 4px; font-size: 12px; flex-shrink: 0;" title="Remove this episode stream">✕</button>
                                        ` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        <div class="batch-series-stream-bulk-wrapper" data-index="${idx}" style="display: none; margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px;">
                            <textarea class="batch-series-stream-bulk-textarea" data-index="${idx}" placeholder="Paste multiple stream tokens/links for ${escapeHTML(item.title)} (one per line)...&#10;Line 1 -> Ep 1&#10;Line 2 -> Ep 2..." style="width: 100%; min-height: 55px; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); border-radius: 4px; padding: 5px; color: #fff; font-size: 11px; font-family: monospace; resize: vertical; box-sizing: border-box;"></textarea>
                            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px;">
                                <button type="button" class="btn btn-primary btn-sm btn-apply-batch-series-stream-bulk" data-index="${idx}" style="font-size: 10px; padding: 3px 8px;">Apply Stream Episodes ⚡</button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                const tokenVal = cleanStreamInput(item.stream_url || '');
                streamSectionHtml = `
                    <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;">
                        <span style="font-size: 10px; color: #ffbc00; font-weight: 700; white-space: nowrap; flex-shrink: 0; display: flex; align-items: center; gap: 3px;">
                            <span>▶️ Stream:</span>
                        </span>
                        <input type="text" class="batch-stream-url-input" data-item-idx="${idx}" value="${escapeHTML(item.stream_url || '')}" placeholder="Paste File Stream Bot link or token (optional)..." style="flex: 1; min-width: 0; width: 100%; padding: 4px 7px; background: rgba(255, 188, 0, 0.04); border: 1px solid rgba(255, 188, 0, 0.25); border-radius: 4px; color: #fff; font-size: 11px; box-sizing: border-box; font-family: monospace;">
                        ${tokenVal ? `
                            <a href="https://filmhouse-player.blogspot.com/?watch=${encodeURIComponent(tokenVal)}&title=${encodeURIComponent(item.title)}" target="_blank" style="font-size: 10px; color: #ffbc00; text-decoration: none; padding: 2px 7px; border: 1px solid rgba(255, 188, 0, 0.35); border-radius: 3px; flex-shrink: 0; white-space: nowrap; background: rgba(255, 188, 0, 0.1);" title="Test Stream Player">Test ▶️</a>
                        ` : ''}
                    </div>
                `;
            }

            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; padding-top: 2px;">
                    <input type="checkbox" class="batch-stage-checkbox" data-index="${idx}" ${item.checked ? 'checked' : ''} style="width: 17px; height: 17px; accent-color: #ffbc00; cursor: pointer; margin: 0; flex-shrink: 0;">
                    <img src="${posterImg}" alt="${escapeHTML(item.title)}" style="width: 36px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.12); flex-shrink: 0;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; width: 100%;">
                        <div style="min-width: 0; flex: 1;">
                            <span style="font-size: 13px; font-weight: 700; color: #fff; word-break: break-word;">${escapeHTML(item.title)}</span>
                            <span style="font-size: 11px; color: var(--text-muted); margin-left: 3px; white-space: nowrap;">(${yearStr || 'N/A'})</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                            <span style="font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 3px; background: ${item.type === 'Series' ? 'var(--primary-color)' : '#00bcd4'}; color: #000; white-space: nowrap;">${item.type}</span>
                            <span style="font-size: 11px; color: #ffbc00; font-weight: 700; white-space: nowrap;">★ ${item.rating || '0.0'}</span>
                            <button type="button" class="btn-remove-batch-item" data-index="${idx}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 1px 4px; font-size: 15px; line-height: 1;" title="Remove title">✕</button>
                        </div>
                    </div>
                    ${categoriesText ? `<div style="font-size: 10px; color: var(--text-muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(categoriesText)}</div>` : ''}
                    ${linksSectionHtml}
                    ${streamSectionHtml}
                </div>
            `;

            batchStagingContainer.appendChild(card);
        });

        // Global Stream Mapper Event Listeners
        const btnToggleGlobal = batchStagingContainer.querySelector("#btn-toggle-global-stream-mapper");
        const btnCloseGlobal = batchStagingContainer.querySelector("#btn-close-global-stream-mapper");
        const globalDrawer = batchStagingContainer.querySelector("#batch-global-stream-mapper-drawer");
        const btnApplyGlobal = batchStagingContainer.querySelector("#btn-apply-global-stream-mapper");
        const inputGlobal = batchStagingContainer.querySelector("#batch-global-stream-mapper-input");

        if (btnToggleGlobal && globalDrawer) {
            btnToggleGlobal.addEventListener("click", () => {
                const isHidden = globalDrawer.style.display === "none";
                globalDrawer.style.display = isHidden ? "block" : "none";
                if (isHidden && inputGlobal) inputGlobal.focus();
            });
        }
        if (btnCloseGlobal && globalDrawer) {
            btnCloseGlobal.addEventListener("click", () => {
                globalDrawer.style.display = "none";
            });
        }
        if (btnApplyGlobal && inputGlobal) {
            btnApplyGlobal.addEventListener("click", () => {
                saveCurrentBatchStagingInputs();
                const rawText = inputGlobal.value.trim();
                if (!rawText) {
                    alert("Please paste some stream tokens or links first!");
                    return;
                }
                const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length === 0) return;

                let mappedCount = 0;
                const hasPipes = lines.some(l => l.includes("|"));

                if (hasPipes) {
                    lines.forEach(line => {
                        const parts = line.split("|").map(p => p.trim());
                        if (parts.length >= 2) {
                            const queryTitle = parts[0].toLowerCase();
                            const matchedItem = batchStagedMovies.find(m => 
                                !m.error && m.title && (m.title.toLowerCase() === queryTitle || m.title.toLowerCase().includes(queryTitle))
                            );
                            if (matchedItem) {
                                if (matchedItem.isSeries) {
                                    if (!Array.isArray(matchedItem.stream_links)) matchedItem.stream_links = [];
                                    if (parts.length >= 3) {
                                        // Format: Title | Ep 2 | token
                                        const epMatch = parts[1].match(/(?:ep|episode)?\s*(\d+)/i);
                                        const epNum = epMatch ? parseInt(epMatch[1]) : (matchedItem.stream_links.length + 1);
                                        const token = cleanStreamInput(parts[2]);
                                        const existingEp = matchedItem.stream_links.find(s => s.episode === epNum);
                                        if (existingEp) {
                                            existingEp.stream_url = token;
                                            existingEp.url = token;
                                        } else {
                                            matchedItem.stream_links.push({ episode: epNum, stream_url: token, url: token });
                                        }
                                        matchedItem.stream_links.sort((a,b) => (a.episode || 0) - (b.episode || 0));
                                        if (matchedItem.stream_links[0]) matchedItem.stream_url = matchedItem.stream_links[0].stream_url;
                                        mappedCount++;
                                    } else {
                                        // Format: Title | token1, token2, token3 OR Title | token
                                        const tokens = parts[1].split(",").map(t => cleanStreamInput(t.trim())).filter(Boolean);
                                        if (tokens.length > 1) {
                                            matchedItem.stream_links = tokens.map((tk, tIdx) => ({ episode: tIdx + 1, stream_url: tk, url: tk }));
                                            matchedItem.stream_url = tokens[0] || "";
                                            mappedCount += tokens.length;
                                        } else if (tokens.length === 1) {
                                            if (matchedItem.stream_links.length === 0) {
                                                matchedItem.stream_links = [{ episode: 1, stream_url: tokens[0], url: tokens[0] }];
                                            } else {
                                                matchedItem.stream_links[0].stream_url = tokens[0];
                                                matchedItem.stream_links[0].url = tokens[0];
                                            }
                                            matchedItem.stream_url = tokens[0];
                                            mappedCount++;
                                        }
                                    }
                                } else {
                                    // Movie
                                    const token = cleanStreamInput(parts[1]);
                                    matchedItem.stream_url = token;
                                    matchedItem.stream_links = [{ quality: "720p", stream_url: token, url: token }];
                                    mappedCount++;
                                }
                            }
                        }
                    });
                } else {
                    // Sequential mapping across valid staged items
                    const validItems = batchStagedMovies.filter(m => !m.error);
                    lines.forEach((tokenLine, lIdx) => {
                        const targetItem = validItems[lIdx];
                        if (targetItem) {
                            const cleanedToken = cleanStreamInput(tokenLine);
                            targetItem.stream_url = cleanedToken;
                            if (targetItem.isSeries) {
                                if (!Array.isArray(targetItem.stream_links) || targetItem.stream_links.length === 0) {
                                    targetItem.stream_links = [{ episode: 1, stream_url: cleanedToken, url: cleanedToken }];
                                } else {
                                    targetItem.stream_links[0].stream_url = cleanedToken;
                                    targetItem.stream_links[0].url = cleanedToken;
                                }
                            } else {
                                targetItem.stream_links = [{ quality: "720p", stream_url: cleanedToken, url: cleanedToken }];
                            }
                            mappedCount++;
                        }
                    });
                }

                renderBatchStagingTable();
                showToast(`Successfully mapped ${mappedCount} stream link(s) across staged titles!`, "success");
            });
        }

        // Event listeners for staged items
        batchStagingContainer.querySelectorAll(".batch-stage-checkbox").forEach(cb => {
            cb.addEventListener("change", (e) => {
                saveCurrentBatchStagingInputs();
                const idx = parseInt(e.target.dataset.index);
                if (batchStagedMovies[idx]) {
                    batchStagedMovies[idx].checked = e.target.checked;
                    const validItems = batchStagedMovies.filter(m => !m.error);
                    const checkedCount = validItems.filter(m => m.checked).length;
                    if (batchStagingSummary) {
                        batchStagingSummary.textContent = `Staged Titles: ${checkedCount} of ${validItems.length} selected`;
                    }
                    const selectAllBox = batchStagingContainer.querySelector("#batch-select-all");
                    if (selectAllBox) {
                        selectAllBox.checked = (checkedCount === validItems.length && validItems.length > 0);
                    }
                }
            });
        });

        batchStagingContainer.querySelectorAll(".batch-season-url-input").forEach(input => {
            input.addEventListener("input", (e) => {
                const itemIdx = parseInt(e.target.dataset.itemIdx);
                const seasonIdx = parseInt(e.target.dataset.seasonIdx);
                if (batchStagedMovies[itemIdx]?.linksList?.[seasonIdx]) {
                    batchStagedMovies[itemIdx].linksList[seasonIdx].url = e.target.value.trim();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-add-batch-season").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const idx = parseInt(e.currentTarget.dataset.index);
                if (batchStagedMovies[idx]) {
                    const nextSeasonNum = batchStagedMovies[idx].linksList.length + 1;
                    batchStagedMovies[idx].linksList.push({
                        season: `Season ${nextSeasonNum}`,
                        url: ""
                    });
                    renderBatchStagingTable();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-remove-batch-season").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const itemIdx = parseInt(e.currentTarget.dataset.itemIdx);
                const seasonIdx = parseInt(e.currentTarget.dataset.seasonIdx);
                if (batchStagedMovies[itemIdx]?.linksList) {
                    batchStagedMovies[itemIdx].linksList.splice(seasonIdx, 1);
                    batchStagedMovies[itemIdx].linksList.forEach((l, i) => {
                        l.season = `Season ${i + 1}`;
                    });
                    renderBatchStagingTable();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-toggle-batch-bulk").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                const wrapper = batchStagingContainer.querySelector(`.batch-bulk-wrapper[data-index="${idx}"]`);
                if (wrapper) {
                    const isHidden = wrapper.style.display === "none";
                    wrapper.style.display = isHidden ? "block" : "none";
                    btn.textContent = isHidden ? "✕ Close Bulk" : "📋 Bulk Paste";
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-apply-batch-bulk").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const idx = parseInt(e.currentTarget.dataset.index);
                const textarea = batchStagingContainer.querySelector(`.batch-bulk-textarea[data-index="${idx}"]`);
                if (textarea && batchStagedMovies[idx]) {
                    const parsed = parseBulkLinks(textarea.value, true);
                    if (parsed.length > 0) {
                        batchStagedMovies[idx].linksList = parsed;
                        renderBatchStagingTable();
                        showToast(`Parsed ${parsed.length} season(s) for "${batchStagedMovies[idx].title}"!`, "success");
                    } else {
                        alert("Please paste at least one valid link!");
                    }
                }
            });
        });

        batchStagingContainer.querySelectorAll(".batch-movie-url-input").forEach(input => {
            input.addEventListener("input", (e) => {
                const itemIdx = parseInt(e.target.dataset.itemIdx);
                const linkIdx = parseInt(e.target.dataset.linkIdx);
                if (batchStagedMovies[itemIdx]?.linksList?.[linkIdx]) {
                    batchStagedMovies[itemIdx].linksList[linkIdx].url = e.target.value.trim();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".batch-movie-quality-select").forEach(select => {
            select.addEventListener("change", (e) => {
                const itemIdx = parseInt(e.target.dataset.itemIdx);
                const linkIdx = parseInt(e.target.dataset.linkIdx);
                if (batchStagedMovies[itemIdx]?.linksList?.[linkIdx]) {
                    batchStagedMovies[itemIdx].linksList[linkIdx].quality = select.value;
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-add-batch-movie-quality").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const idx = parseInt(e.currentTarget.dataset.index);
                if (batchStagedMovies[idx]) {
                    const existingQualities = batchStagedMovies[idx].linksList.map(l => l.quality);
                    const defaultNext = existingQualities.includes("1080p") ? "2160p (4K)" : "1080p";
                    batchStagedMovies[idx].linksList.push({
                        quality: defaultNext,
                        url: ""
                    });
                    renderBatchStagingTable();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-remove-batch-movie-link").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const itemIdx = parseInt(e.currentTarget.dataset.itemIdx);
                const linkIdx = parseInt(e.currentTarget.dataset.linkIdx);
                if (batchStagedMovies[itemIdx]?.linksList) {
                    batchStagedMovies[itemIdx].linksList.splice(linkIdx, 1);
                    renderBatchStagingTable();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-remove-batch-item").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const idx = parseInt(e.currentTarget.dataset.index);
                batchStagedMovies.splice(idx, 1);
                renderBatchStagingTable();
            });
        });

        batchStagingContainer.querySelectorAll(".batch-stream-url-input").forEach(input => {
            input.addEventListener("input", (e) => {
                const itemIdx = parseInt(e.target.dataset.itemIdx);
                if (batchStagedMovies[itemIdx]) {
                    batchStagedMovies[itemIdx].stream_url = e.target.value.trim();
                }
            });
        });

        // Series Episode Stream Event Listeners
        batchStagingContainer.querySelectorAll(".btn-add-batch-series-stream").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const idx = parseInt(e.currentTarget.dataset.index);
                if (batchStagedMovies[idx]) {
                    if (!Array.isArray(batchStagedMovies[idx].stream_links)) batchStagedMovies[idx].stream_links = [];
                    const nextEp = batchStagedMovies[idx].stream_links.length + 1;
                    batchStagedMovies[idx].stream_links.push({
                        episode: nextEp,
                        stream_url: ""
                    });
                    renderBatchStagingTable();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-remove-batch-series-stream").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const itemIdx = parseInt(e.currentTarget.dataset.itemIdx);
                const streamIdx = parseInt(e.currentTarget.dataset.streamIdx);
                if (batchStagedMovies[itemIdx]?.stream_links) {
                    batchStagedMovies[itemIdx].stream_links.splice(streamIdx, 1);
                    batchStagedMovies[itemIdx].stream_links.forEach((st, i) => {
                        st.episode = i + 1;
                    });
                    if (batchStagedMovies[itemIdx].stream_links.length > 0) {
                        batchStagedMovies[itemIdx].stream_url = batchStagedMovies[itemIdx].stream_links[0].stream_url || "";
                    } else {
                        batchStagedMovies[itemIdx].stream_url = "";
                    }
                    renderBatchStagingTable();
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-toggle-batch-series-stream-bulk").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                const wrapper = batchStagingContainer.querySelector(`.batch-series-stream-bulk-wrapper[data-index="${idx}"]`);
                if (wrapper) {
                    const isHidden = wrapper.style.display === "none";
                    wrapper.style.display = isHidden ? "block" : "none";
                    btn.textContent = isHidden ? "✕ Close" : "📋 Bulk";
                }
            });
        });

        batchStagingContainer.querySelectorAll(".btn-apply-batch-series-stream-bulk").forEach(btn => {
            btn.addEventListener("click", (e) => {
                saveCurrentBatchStagingInputs();
                const idx = parseInt(e.currentTarget.dataset.index);
                const textarea = batchStagingContainer.querySelector(`.batch-series-stream-bulk-textarea[data-index="${idx}"]`);
                if (textarea && batchStagedMovies[idx]) {
                    const lines = textarea.value.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                    if (lines.length > 0) {
                        batchStagedMovies[idx].stream_links = lines.map((line, lIdx) => {
                            const cleaned = cleanStreamInput(line);
                            return {
                                episode: lIdx + 1,
                                stream_url: cleaned,
                                url: cleaned
                            };
                        });
                        batchStagedMovies[idx].stream_url = batchStagedMovies[idx].stream_links[0].stream_url || "";
                        renderBatchStagingTable();
                        showToast(`Parsed ${lines.length} episode stream(s) for "${batchStagedMovies[idx].title}"!`, "success");
                    } else {
                        alert("Please paste at least one stream token or link!");
                    }
                }
            });
        });
    }

    if (btnFetchBatchTmdb) {
        btnFetchBatchTmdb.addEventListener("click", async () => {
            const rawLines = batchTitlesInput.value.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            if (rawLines.length === 0) {
                alert("Please enter at least one title, TMDB ID, or TMDB URL!");
                return;
            }

            btnFetchBatchTmdb.disabled = true;
            const originalText = btnFetchBatchTmdb.textContent;
            btnFetchBatchTmdb.textContent = `Fetching 0 / ${rawLines.length}... ⏳`;

            batchStagedMovies = [];
            let completedCount = 0;

            const results = await Promise.all(rawLines.map(async (rawQuery) => {
                try {
                    const item = await fetchSingleTmdbBatchItem(rawQuery);
                    completedCount++;
                    btnFetchBatchTmdb.textContent = `Fetching ${completedCount} / ${rawLines.length}... ⏳`;
                    return item;
                } catch (err) {
                    console.warn(`Batch TMDB query error for "${rawQuery}":`, err);
                    completedCount++;
                    btnFetchBatchTmdb.textContent = `Fetching ${completedCount} / ${rawLines.length}... ⏳`;
                    return {
                        error: true,
                        query: rawQuery,
                        message: err.message || "Failed to find or fetch metadata"
                    };
                }
            }));

            btnFetchBatchTmdb.disabled = false;
            btnFetchBatchTmdb.textContent = originalText;

            batchStagedMovies = results;
            renderBatchStagingTable();

            if (batchStepInput && batchStepStaging) {
                batchStepInput.style.display = "none";
                batchStepStaging.style.display = "flex";
            }
        });
    }

    if (btnBatchCommitAll) {
        btnBatchCommitAll.addEventListener("click", () => {
            saveCurrentBatchStagingInputs();
            const itemsToCommit = batchStagedMovies.filter(m => !m.error && m.checked);
            if (itemsToCommit.length === 0) {
                alert("No titles selected to import! Please check at least one title.");
                return;
            }

            const broadcastCheckbox = document.getElementById("batch-broadcast-toggle");
            const shouldBroadcast = broadcastCheckbox ? broadcastCheckbox.checked : true;
            let addedCount = 0;
            const importedTitles = [];
            itemsToCommit.forEach(item => {
                // Parse links from linksList or fallback rawLinksText
                let finalLinks = [];
                if (Array.isArray(item.linksList) && item.linksList.length > 0) {
                    finalLinks = item.linksList
                        .map((l, lIdx) => {
                            const u = (l.url || '').trim();
                            if (!u) return null;
                            if (item.isSeries) {
                                return { url: u, season: l.season || `Season ${lIdx + 1}` };
                            } else {
                                return { url: u, quality: l.quality || '720p' };
                            }
                        })
                        .filter(Boolean);
                } else if (item.rawLinksText) {
                    finalLinks = parseBulkLinks(item.rawLinksText, item.isSeries);
                }

                let finalStreams = [];
                if (Array.isArray(item.stream_links) && item.stream_links.length > 0) {
                    finalStreams = item.stream_links
                        .map((st, sIdx) => {
                            const raw = (st.stream_url || st.url || "").trim();
                            const cleaned = cleanStreamInput(raw);
                            if (!cleaned) return null;
                            if (item.isSeries) {
                                return {
                                    episode: st.episode || (sIdx + 1),
                                    stream_url: cleaned,
                                    url: cleaned
                                };
                            } else {
                                return {
                                    quality: st.quality || '720p',
                                    stream_url: cleaned,
                                    url: cleaned
                                };
                            }
                        })
                        .filter(Boolean);
                } else if (item.stream_url) {
                    const cleaned = cleanStreamInput(item.stream_url);
                    if (cleaned) {
                        finalStreams = [{
                            quality: item.isSeries ? undefined : '720p',
                            episode: item.isSeries ? 1 : undefined,
                            stream_url: cleaned,
                            url: cleaned
                        }];
                    }
                }

                const cleanStreamVal = finalStreams.length > 0 ? (finalStreams[0].stream_url || finalStreams[0].url || "") : cleanStreamInput(item.stream_url || "");
                const newMovie = {
                    csv_id: item.id,
                    tmdb_id: item.numericId,
                    imdb_id: "",
                    title: item.title,
                    type: item.type,
                    categories: item.categories && item.categories.length > 0 ? item.categories : ["Main"],
                    genres: item.genres || [],
                    overview: item.overview || "No synopsis available.",
                    poster: item.poster || "",
                    backdrop: item.backdrop || "",
                    rating: item.rating || 0,
                    release_date: item.releaseDate || "",
                    language: item.language || "en",
                    cast: [],
                    director: "",
                    trailer: item.trailer || "",
                    runtime: "",
                    stream_url: cleanStreamVal,
                    stream_links: finalStreams,
                    links: finalLinks,
                    channelBroadcasted: !shouldBroadcast // If opted out, mark true
                };
                if (cleanStreamVal && finalLinks.length > 0) {
                    finalLinks[0].stream_url = cleanStreamVal;
                }

                allCatalogMovies.unshift(newMovie);
                newlyAddedIds.push(newMovie.csv_id);
                addedCount++;
                if (item.title) importedTitles.push(item.title);
            });

            if (importedTitles.length > 0) {
                if (typeof window.recordAdminBatchActivity === 'function') {
                    window.recordAdminBatchActivity("publication", importedTitles);
                } else if (typeof window.recordAdminActivity === 'function') {
                    window.recordAdminActivity("publication", importedTitles[0]);
                }
            }

            catalogChangesMade = true;
            updatePublishButtonState();
            renderCatalogList();

            if (batchModal) {
                batchModal.classList.remove("active");
            }

            // Reset staging state
            batchStagedMovies = [];
            if (batchTitlesInput) batchTitlesInput.value = "";
            if (batchInputCounter) batchInputCounter.textContent = "0 titles entered";

            const publishBtn = document.getElementById("btn-publish-catalog");
            if (publishBtn) {
                publishBtn.scrollIntoView({ behavior: "smooth", block: "nearest" });
                publishBtn.style.boxShadow = "0 0 20px #ffbc00";
                setTimeout(() => {
                    publishBtn.style.boxShadow = "";
                }, 3500);
            }

            alert(`🎉 Successfully imported ${addedCount} title(s) to the catalog!\n\nClick "Publish Changes 🚀" in the catalog toolbar to commit them to GitHub and make them live.`);
        });
    }
});


