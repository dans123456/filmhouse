const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// Native .env parser (guarantees instant loading of .env without external dependencies)
try {
    const envPath = path.join(__dirname, ".env");
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
        console.log("[Config] Loaded environment variables from .env successfully.");
    }
} catch (e) {}

const { Telegraf } = require("telegraf");
const admin = require("firebase-admin");
const http = require("http");
const crypto = require("crypto");
const LocalUserStore = require("./localStore");
const localStore = new LocalUserStore();

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'of', 'in', 'to', 'for', 'on', 'at', 'by', 'with', 'from',
    'part', 'chapter', 'vol', 'volume', 'pt', 's', 'movie', 'film'
]);

const TITLE_ALIASES = {
    "girls raised in the south": "grits",
    "grits": "girls raised in the south",
    "hard matter": "kill code",
    "kill code": "hard matter",
    "bel": "bel air",
    "bel air": "bel",
    "matchbox the": "matchbox",
    "the matchbox": "matchbox",
    "chassing lullaby": "chasing lullaby",
    "chasing lullaby": "chassing lullaby"
};

function romanToNum(roman) {
    if (!roman) return "";
    const r = String(roman).toLowerCase().trim();
    const map = { "i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10" };
    return map[r] || r;
}

function getRawAcronym(str) {
    if (!str) return "";
    const clean = String(str).toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2) return "";
    return words.map(w => w[0]).join("");
}

// Normalize titles for comparison, matching and search: strips symbols, leading articles, handles plurals, apostrophes, Roman numerals
function normalizeTitleForComparison(title) {
    if (!title) return "";
    let s = String(title).toLowerCase();
    s = s.replace(/\s*\([^)]+\)\s*$/g, "").trim();

    // Strip ALL apostrophes: It's -> its, Zane's -> zanes, Grey's -> greys
    s = s.replace(/['’`]/g, "");

    // Roman Numerals normalization: "vol. ii" -> "2", "ii" -> "2"
    s = s.replace(/\bvol(?:ume)?[\s\.\-_]*([0-9ivxlcdm]+)\b/gi, (m, g) => romanToNum(g));
    s = s.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi, (m, g) => romanToNum(g));

    s = s.replace(/&/g, " and ");
    s = s.replace(/^(the|a|an)\s+/i, "");
    s = s.replace(/\bthe\b/gi, " ");
    s = s.replace(/\b(star\s*wars|marvel|disney)\b/gi, " ");
    s = s.replace(/\b(iq|iqiyi|dual|fil|filmh|filmhouse)\b/gi, " ");
    s = s.replace(/[^\p{L}\p{N}\s]/gu, " "); // Removes all symbols (!, ?, :, -, _, ;, etc.)
    s = s.replace(/\s+/g, " ").trim();
    return s;
}

function getCollapsedTitle(title) {
    if (!title) return "";
    const clean = normalizeTitleForComparison(title);
    return clean.replace(/[^a-z0-9]/gi, "");
}

function titlesMatch(titleA, titleB) {
    if (!titleA || !titleB) return false;

    // Direct acronym match: e.g. "Girls Raised In The South" <-> "GRITS"
    const rawA = String(titleA).toLowerCase().replace(/[^a-z0-9]/g, "");
    const rawB = String(titleB).toLowerCase().replace(/[^a-z0-9]/g, "");
    const acroA = getRawAcronym(titleA);
    const acroB = getRawAcronym(titleB);
    if ((acroA && acroA === rawB) || (acroB && acroB === rawA)) return true;

    const normA = normalizeTitleForComparison(titleA);
    const normB = normalizeTitleForComparison(titleB);
    if (!normA || !normB) return false;
    if (normA === normB) return true;

    // Check alias mapping
    const aliasA = TITLE_ALIASES[normA];
    const aliasB = TITLE_ALIASES[normB];
    if (aliasA && (aliasA === normB || normalizeTitleForComparison(aliasA) === normB)) return true;
    if (aliasB && (aliasB === normA || normalizeTitleForComparison(aliasB) === normA)) return true;

    const colA = getCollapsedTitle(titleA);
    const colB = getCollapsedTitle(titleB);
    if (colA && colB && colA === colB) return true;

    // Double consonant tolerance (e.g. "chassing" vs "chasing")
    if (colA && colB) {
        const dedupA = colA.replace(/(.)\1+/g, (m, c) => c);
        const dedupB = colB.replace(/(.)\1+/g, (m, c) => c);
        if (dedupA.length >= 5 && dedupA === dedupB) return true;
    }

    // Subtitle / Prefix match: e.g. "Maxton Hall — The World Between Us" vs "Maxton Hall"
    // or "Brand New Cherry Flavor" vs "Brand New Cherry"
    // or "All Quiet on the Western Front" vs "All Quiet on the Western"
    const shortStr = normA.length < normB.length ? normA : normB;
    const longStr = normA.length < normB.length ? normB : normA;
    const shortWords = shortStr.split(/\s+/).filter(w => !STOP_WORDS.has(w));
    if (shortWords.length >= 2 && shortStr.length >= 7 && longStr.startsWith(shortStr)) {
        return true;
    }

    // Keyword-level comparison with stop-word filtering
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

    // Moderate Jaccard similarity (>= 60%) on content keywords with at least 2 shared keywords
    // Handles e.g. "The SpongeBob Movie: Sponge on the Run" vs "The Spongebob Sponge On The Run"
    const jaccard = intersection.length / union.size;
    if (jaccard >= 0.60 && intersection.length >= 2) {
        return true;
    }

    // Sub-phrase overlap: if all content words of the shorter title are contained in the longer title (min 2 words)
    // Handles e.g. "How To Make Millions" vs "How to Make Millions Before Grandma Dies"
    if (effA.length >= 2 && effB.length >= 2) {
        const shorter = effA.length < effB.length ? setA : setB;
        const longer = effA.length < effB.length ? setB : setA;
        const allContained = [...shorter].every(t => longer.has(t));
        if (allContained && shorter.size >= 2) {
            return true;
        }
    }

    return false;
}


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

// Auto-synchronize live Cloudflare tunnel URL to Firestore system/streaming_config
let lastSyncedTunnelUrl = null;
function syncStreamingServerConfig() {
    try {
        const candidates = [
            "/home/ubuntu/filmhouse-stream-bot/tunnel.log",
            path.join(__dirname, "..", "filmhouse-stream-bot", "tunnel.log"),
            path.join(__dirname, "tunnel.log")
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                const content = fs.readFileSync(p, "utf8");
                const matches = content.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g);
                if (matches && matches.length > 0) {
                    const latestUrl = matches[matches.length - 1];
                    if (latestUrl !== lastSyncedTunnelUrl) {
                        lastSyncedTunnelUrl = latestUrl;
                        db.collection("system").doc("streaming_config").set({
                            server_url: latestUrl,
                            updated_at: new Date().toISOString()
                        }, { merge: true }).then(() => {
                            console.log(`[StreamConfig] Synced active Cloudflare tunnel to Firestore: ${latestUrl}`);
                        }).catch(err => console.warn("[StreamConfig] Firestore sync notice:", err.message));
                    }
                    return latestUrl;
                }
            }
        }
    } catch (e) {
        console.warn("[StreamConfig] Tunnel sync notice:", e.message);
    }
}
syncStreamingServerConfig();
setInterval(syncStreamingServerConfig, 30000);


// Helper: Safe remote server updater with syntax integrity checks and PM2 reload
function performServerGitUpdate(onProgress) {
    return new Promise((resolve) => {
        const projectDir = path.resolve(__dirname);
        // Safely stash local modifications (like movies_metadata.json) before pulling so dirty files never block git pull
        const pullCmd = "git stash push -u -m 'auto-stash-updater' || true; git pull origin main";
        exec(pullCmd, { cwd: projectDir, timeout: 25000 }, (pullErr, pullOut, pullErrOut) => {
            if (pullErr) {
                console.error("[ServerUpdater] git pull failed:", pullErr);
                return resolve({
                    success: false,
                    error: `Git pull failed: ${pullErr.message}\n${pullErrOut || ""}`,
                    output: pullErrOut || pullErr.message
                });
            }

            const gitOutput = (pullOut || pullErrOut || "").trim();
            const isAlreadyUpdated = gitOutput.includes("Already up to date") || gitOutput.includes("Already up-to-date");

            if (typeof onProgress === "function") onProgress("Verifying JavaScript syntax integrity...");

            exec("node -c bot.js", { cwd: projectDir, timeout: 10000 }, (syntaxErr, synOut, synErrOut) => {
                if (syntaxErr) {
                    console.error("[ServerUpdater] Syntax check failed:", syntaxErr);
                    return resolve({
                        success: false,
                        error: `Syntax validation failed on bot.js. PM2 reload aborted to keep server online: ${synErrOut || syntaxErr.message}`,
                        output: synErrOut || syntaxErr.message
                    });
                }

                // Schedule PM2 reload to ensure the active memory process is running the latest code
                setTimeout(() => {
                    exec("pm2 reload filmhouse-bot || pm2 restart filmhouse-bot || pm2 reload all || pm2 restart all", { cwd: projectDir, timeout: 15000 }, (pm2Err, pm2Out) => {
                        if (pm2Err) {
                            console.warn("[ServerUpdater] PM2 reload notice:", pm2Err.message);
                        } else {
                            console.log("[ServerUpdater] PM2 reload completed:", pm2Out);
                        }
                    });
                }, 1200);

                if (isAlreadyUpdated) {
                    console.log("[ServerUpdater] Repository is up to date. PM2 reload dispatched.");
                    return resolve({
                        success: true,
                        alreadyUpToDate: true,
                        output: gitOutput,
                        message: "Repository is already up to date. PM2 process reloaded."
                    });
                }

                if (typeof onProgress === "function") onProgress("Update pulled! Reloading PM2 process (Zero Downtime)...");
                console.log("[ServerUpdater] Changes detected and syntax verified. Reloading PM2 process...");

                return resolve({
                    success: true,
                    alreadyUpToDate: false,
                    output: gitOutput,
                    message: "Successfully pulled latest code and triggered PM2 zero-downtime reload!"
                });
            });
        });
    });
}

// HTML escaping helper for clean Telegram formatting
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Markdown escaping helper for clean Telegram formatting
function escapeMarkdown(str) {
    if (!str) return "";
    return String(str).replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
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

// Formats full date, day of week, and time: e.g. "Mon, Oct 12, 2026 • 04:15 PM"
function formatRequestDateTime(date, includeYear = true) {
    if (!date) return "";
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

// Global Telegram helpers and pending requests store (module-scoped for access across setupBot and init)
let callTelegramWithRetry = async () => {};
let callAdminTelegramWithRetry = async () => {};
let publishMovieToChannel = async () => {};
let getAllAdminIds = async () => ["1329840839", "1175336733"];
const PENDING_FILE = path.join(__dirname, "data", "pending_requests.json");
let cachedPendingRequests = [];
const _channelPostingLocks = new Set();
const adminRequestMsgMap = new Map(); // message_id -> request info for instant reply-to-fulfill

// Categorized in-memory ring buffers for live tracing
const categorizedLogs = {
    server: [],
    admin_bot: [],
    user_bot: [],
    user_app: [],
    admin_app: [],
    error: []
};

function recordLog(category, msg) {
    if (!categorizedLogs[category]) categorizedLogs[category] = [];
    const timestamp = new Date().toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const entry = `[${timestamp} UTC] ${String(msg)}`;
    categorizedLogs[category].push(entry);
    if (categorizedLogs[category].length > 60) {
        categorizedLogs[category].shift();
    }
    const lower = String(msg).toLowerCase();
    if (category === "error" || lower.includes("error") || lower.includes("failed") || lower.includes("exception")) {
        if (category !== "error") {
            categorizedLogs.error.push(`[${timestamp} UTC][${category.toUpperCase()}] ${String(msg)}`);
            if (categorizedLogs.error.length > 60) categorizedLogs.error.shift();
        }
    }
}

// Global console interception to automatically feed live logs into categories
const _origConsoleLog = console.log;
const _origConsoleWarn = console.warn;
const _origConsoleError = console.error;

console.log = function(...args) {
    _origConsoleLog.apply(console, args);
    const msg = args.map(a => (typeof a === 'object' ? (a && a.message ? a.message : JSON.stringify(a)) : String(a))).join(' ');
    let cat = "server";
    const lower = msg.toLowerCase();
    if (lower.includes("adminbot") || lower.includes("admin bot") || lower.includes("admin command") || lower.includes("admin menu") || lower.includes("boost alert") || lower.includes("[admin")) {
        cat = "admin_bot";
    } else if (lower.includes("user /start") || lower.includes("publicbot") || lower.includes("public bot") || lower.includes("inline query") || lower.includes("channel publish") || lower.includes("request received")) {
        cat = "user_bot";
    } else if (lower.includes("userapp") || lower.includes("user app") || lower.includes("request submitted") || lower.includes("feedback")) {
        cat = "user_app";
    } else if (lower.includes("adminapp") || lower.includes("admin app") || lower.includes("fulfilled") || lower.includes("catalog update")) {
        cat = "admin_app";
    }
    recordLog(cat, msg);
};

console.warn = function(...args) {
    _origConsoleWarn.apply(console, args);
    const msg = args.map(a => (typeof a === 'object' ? (a && a.message ? a.message : JSON.stringify(a)) : String(a))).join(' ');
    let cat = "server";
    const lower = msg.toLowerCase();
    if (lower.includes("admin")) cat = "admin_bot";
    else if (lower.includes("user")) cat = "user_bot";
    recordLog(cat, `⚠️ ${msg}`);
};

console.error = function(...args) {
    _origConsoleError.apply(console, args);
    const msg = args.map(a => (typeof a === 'object' ? (a && a.message ? a.message : JSON.stringify(a)) : String(a))).join(' ');
    recordLog("error", `❌ ${msg}`);
};

// Pre-load movies_metadata.json into memory for instant (<1ms) deep-link lookup
let cachedMoviesMetadata = null;
const localMetaPathGlobal = path.resolve(__dirname, "./MOVIE/Data/movies_metadata.json");
try {
    if (fs.existsSync(localMetaPathGlobal)) {
        cachedMoviesMetadata = JSON.parse(fs.readFileSync(localMetaPathGlobal, "utf8"));
        console.log(`[MetadataCache] Successfully pre-loaded ${cachedMoviesMetadata.length} movie entries into memory.`);
    }
} catch (e) {
    console.warn("[MetadataCache] Could not pre-load movies_metadata.json:", e.message);
}

// Native helper to fetch JSON via HTTP/HTTPS with redirect support
async function fetchJsonFromUrl(url) {
    if (typeof fetch === "function") {
        const res = await fetch(url, { headers: { "User-Agent": "FilmHouse-Bot-AutoSync" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return await res.json();
    }
    return new Promise((resolve, reject) => {
        const https = require("https");
        https.get(url, { headers: { "User-Agent": "FilmHouse-Bot-AutoSync" } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJsonFromUrl(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        }).on("error", reject);
    });
}

const BROADCASTED_CATALOG_FILE = path.resolve(__dirname, "./data/broadcasted_catalog.json");
let broadcastedCatalogIds = new Set();

try {
    if (fs.existsSync(BROADCASTED_CATALOG_FILE)) {
        const raw = fs.readFileSync(BROADCASTED_CATALOG_FILE, "utf8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
            broadcastedCatalogIds = new Set(list.map(id => String(id).toLowerCase().trim()));
        }
    } else {
        if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
            cachedMoviesMetadata.forEach(m => {
                if (m.csv_id) broadcastedCatalogIds.add(String(m.csv_id).toLowerCase().trim());
                if (m.title) broadcastedCatalogIds.add(String(m.title).toLowerCase().trim());
            });
            const dir = path.dirname(BROADCASTED_CATALOG_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(BROADCASTED_CATALOG_FILE, JSON.stringify(Array.from(broadcastedCatalogIds)), "utf8");
            console.log(`[CatalogAutoPublish] Initialized broadcast tracker with ${broadcastedCatalogIds.size} existing items.`);
        }
    }
} catch (bErr) {
    console.warn("[CatalogAutoPublish] Error loading broadcast tracker:", bErr.message);
}

// Automatically sync movies_metadata.json from GitHub to Ubuntu disk and update in-memory cache
async function syncCatalogFromGitHub() {
    try {
        const rawUrl = "https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/Data/movies_metadata.json?t=" + Date.now();
        console.log("[GitHubSync] Checking GitHub for catalog updates...");
        const data = await fetchJsonFromUrl(rawUrl);
        if (Array.isArray(data) && data.length > 0) {
            const currentCount = cachedMoviesMetadata ? cachedMoviesMetadata.length : 0;
            const localMetaPath = path.resolve(__dirname, "./MOVIE/Data/movies_metadata.json");
            
            const dir = path.dirname(localMetaPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            // Preserve locally indexed stream links so GitHub sync never clobbers newly matched streams
            if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                const streamMap = new Map();
                cachedMoviesMetadata.forEach(m => {
                    const id = String(m.csv_id || m.id || "").toLowerCase().trim();
                    if (id && (m.stream_url || (Array.isArray(m.stream_links) && m.stream_links.length > 0))) {
                        streamMap.set(id, {
                            stream_url: m.stream_url,
                            stream_links: m.stream_links
                        });
                    }
                });
                if (streamMap.size > 0) {
                    data.forEach(m => {
                        const id = String(m.csv_id || m.id || "").toLowerCase().trim();
                        const existing = streamMap.get(id);
                        if (existing) {
                            if (!m.stream_url && existing.stream_url) m.stream_url = existing.stream_url;
                            if ((!m.stream_links || m.stream_links.length === 0) && existing.stream_links) {
                                m.stream_links = existing.stream_links;
                            }
                        }
                    });
                }
            }

            fs.writeFileSync(localMetaPath, JSON.stringify(data, null, 2), "utf8");
            cachedMoviesMetadata = data;
            console.log(`[GitHubSync] Successfully synchronized ${data.length} movies from GitHub main to Ubuntu disk! (Previous in-memory: ${currentCount})`);

            // Auto-broadcast any newly published titles or new seasons/cuts added to existing titles
            if (currentCount > 0 && typeof publishMovieToChannel === 'function') {
                const newItemsToBroadcast = [];
                const prevMap = new Map();
                if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                    cachedMoviesMetadata.forEach(m => {
                        const k = String(m.csv_id || "").toLowerCase().trim();
                        if (k) prevMap.set(k, m);
                    });
                }

                for (const m of data) {
                    const idKey = String(m.csv_id || "").toLowerCase().trim();
                    const titleKey = String(m.title || "").toLowerCase().replace(/\s*\([^)]+\)\s*$/g, "").trim();
                    const hasLinks = Array.isArray(m.links) && m.links.length > 0 && m.links.some(l => (typeof l === 'object' && l !== null ? (l.url || l.link) : (l && String(l).trim() !== "")));

                    if (!hasLinks || !idKey) continue;

                    const prevM = prevMap.get(idKey);
                    if (!prevM) {
                        // Entirely brand-new title
                        if (!broadcastedCatalogIds.has(idKey) && !broadcastedCatalogIds.has(titleKey)) {
                            newItemsToBroadcast.push(m);
                        }
                    } else {
                        // Existing title: Check if new seasons or new qualities/cuts were added!
                        const prevLinks = Array.isArray(prevM.links) ? prevM.links : [];
                        const prevSpecKeys = new Set(prevLinks.map(l => {
                            const spec = typeof l === 'object' && l !== null ? (l.season || l.quality || "") : "";
                            return String(spec).toLowerCase().trim();
                        }).filter(Boolean));

                        m.links.forEach(l => {
                            const url = typeof l === 'object' && l !== null ? (l.url || l.link) : l;
                            if (!url || String(url).trim() === "") return;
                            const spec = typeof l === 'object' && l !== null ? (l.season || l.quality || "") : "";
                            const specKey = String(spec).toLowerCase().trim();
                            if (specKey && !prevSpecKeys.has(specKey)) {
                                const dedupeKey = `${idKey}_${specKey}`;
                                if (!broadcastedCatalogIds.has(dedupeKey)) {
                                    newItemsToBroadcast.push({
                                        ...m,
                                        seasonOrPart: spec
                                    });
                                }
                            }
                        });
                    }
                }

                if (newItemsToBroadcast.length > 0) {
                    console.log(`[CatalogAutoPublish] Found ${newItemsToBroadcast.length} newly published release update(s) to announce to Updates Channel!`);
                    for (let idx = 0; idx < newItemsToBroadcast.length; idx++) {
                        const item = newItemsToBroadcast[idx];
                        try {
                            const res = await publishMovieToChannel(item);
                            if (res && res.message_id) {
                                console.log(`[CatalogAutoPublish] Successfully announced "${item.title}" ${item.seasonOrPart || ""} to Updates Channel (msg_id: ${res.message_id})`);
                            }
                        } catch (pErr) {
                            console.warn(`[CatalogAutoPublish] Error broadcasting "${item.title}":`, pErr.message);
                        }

                        const idKey = String(item.csv_id || "").toLowerCase().trim();
                        const titleKey = String(item.title || "").toLowerCase().trim();
                        const specKey = String(item.seasonOrPart || "").toLowerCase().trim();
                        if (specKey) {
                            if (idKey) broadcastedCatalogIds.add(`${idKey}_${specKey}`);
                            if (titleKey) broadcastedCatalogIds.add(`${titleKey}_${specKey}`);
                        } else {
                            if (idKey) broadcastedCatalogIds.add(idKey);
                            if (titleKey) broadcastedCatalogIds.add(titleKey);
                        }

                        // Pacing delay between consecutive broadcasts to prevent Telegram rate limit (429)
                        // and ensure Telegram's linked discussion group forwarder doesn't drop group comment threads
                        if (idx < newItemsToBroadcast.length - 1) {
                            await new Promise(r => setTimeout(r, 3500));
                        }
                    }
                    try {
                        const dir = path.dirname(BROADCASTED_CATALOG_FILE);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(BROADCASTED_CATALOG_FILE, JSON.stringify(Array.from(broadcastedCatalogIds)), "utf8");
                    } catch (saveErr) {}
                }
            }

            return { success: true, count: data.length, updated: data.length !== currentCount };
        }
    } catch (err) {
        console.warn("[GitHubSync] Sync failed or timed out:", err.message);
        return { success: false, error: err.message };
    }
    return { success: false, error: "Empty or invalid catalog data received" };
}

// Run initial catalog sync 5 seconds after startup, then poll every 20 seconds
setTimeout(() => {
    syncCatalogFromGitHub().catch(() => {});
}, 5000);
setInterval(() => {
    syncCatalogFromGitHub().catch(() => {});
}, 20 * 1000);

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

    // Global Telegraf error handlers to keep polling loops alive during network or formatting glitches
    bot.catch((err, ctx) => {
        console.error(`[PublicBot Error] Handled error on update ${ctx ? ctx.updateType : 'unknown'}:`, err.message || err);
    });

    if (adminBot && typeof adminBot.catch === 'function') {
        adminBot.catch((err, ctx) => {
            console.error(`[AdminBot Error] Handled error on update ${ctx ? ctx.updateType : 'unknown'}:`, err.message || err);
        });
    }

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

    // In-memory cache for banned users and admin lists to eliminate per-update Firestore latency
    const bannedUsersCache = new Set();
    const envAdmins = (process.env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    let cachedAdmins = Array.from(new Set(["1329840839", "1175336733", ...envAdmins]));
    let cachedMasters = Array.from(new Set(["1329840839", "1175336733", ...envAdmins]));
    let lastAdminFetchTime = 0;

    // In-memory rate limiting map (sliding-window + cooldown penalty)
    const userRateLimits = new Map();
    const RATE_LIMIT_WINDOW_MS = 3000; // 3-second sliding window
    const MAX_REQUESTS_PER_WINDOW = 5;  // Max 5 messages/commands per window
    const COOLDOWN_DURATION_MS = 10000; // 10-second penalty cooldown

    // Periodic cleanup of rate limits every 10 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [uid, record] of userRateLimits.entries()) {
            if (now - record.windowStart > 60000 && now > record.cooldownUntil) {
                userRateLimits.delete(uid);
            }
        }
    }, 10 * 60 * 1000);

    bot.use(async (ctx, next) => {
        if (!ctx.from || !ctx.message) return next();
        const userId = String(ctx.from.id);
        const isMaster = cachedMasters.includes(userId);
        
        if (!isMaster) {
            const now = Date.now();
            let record = userRateLimits.get(userId);
            if (!record) {
                record = { count: 1, windowStart: now, cooldownUntil: 0 };
                userRateLimits.set(userId, record);
            } else {
                if (now < record.cooldownUntil) {
                    // In active cooldown - drop silently to prevent spam floods
                    return;
                }
                if (now - record.windowStart < RATE_LIMIT_WINDOW_MS) {
                    record.count++;
                    if (record.count > MAX_REQUESTS_PER_WINDOW) {
                        record.cooldownUntil = now + COOLDOWN_DURATION_MS;
                        try {
                            await ctx.reply("⏳ <b>Please slow down!</b>\nYou are sending commands too quickly. Please wait 10 seconds before trying again.", { parse_mode: 'HTML' });
                        } catch(e) {}
                        return;
                    }
                } else {
                    record.count = 1;
                    record.windowStart = now;
                }
            }
        }

        localStore.upsertUser({
            id: userId,
            username: ctx.from.username || "",
            fullName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Telegram User"
        });
        return next();
    });

    async function refreshAdminCache() {
        const now = Date.now();
        if (now - lastAdminFetchTime < 15 * 60 * 1000) return;
        lastAdminFetchTime = now;
        try {
            const adminPromise = db.collection("settings").doc("admins").get();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500));
            const doc = await Promise.race([adminPromise, timeoutPromise]);
            if (doc && doc.exists) {
                const adminList = doc.data().ids || [];
                const masterList = doc.data().masters || [];
                cachedAdmins = Array.from(new Set(["1329840839", "1175336733", ...envAdmins, ...adminList, ...masterList]));
                cachedMasters = Array.from(new Set(["1329840839", "1175336733", ...envAdmins, ...masterList]));
            }
        } catch (e) {}
    }

    // Helper: Get all active admin Telegram IDs safely with zero-dependency quota fallback
    getAllAdminIds = async () => {
        await refreshAdminCache().catch(() => {});
        return cachedAdmins.map(String).filter(Boolean);
    };

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

    // Helper: Call Admin Telegram Bot strictly on the dedicated admin bot instance
    callAdminTelegramWithRetry = async function(methodName, ...args) {
        if (!adminBot) {
            console.warn(`[AdminBot] Dedicated adminBot not configured, skipping admin notification.`);
            return null;
        }
        try {
            return await adminBot.telegram[methodName](...args);
        } catch (err) {
            console.warn(`[AdminBot] Call ${methodName} error:`, err.message);
            return null;
        }
    };

    // Global in-memory set to prevent duplicate channel broadcasts within session
    const _recentlyBroadcastedKeys = new Set();

    // Engine: Publish new movie/series release update to Film House Updates Channel (Channel auto-delete managed natively in Telegram channel settings)
    publishMovieToChannel = async function(movieInfo) {
        const channelTarget = process.env.UPDATES_CHANNEL_ID || process.env.CHANNEL_TARGET || "-1004272961286"; // Film House Updates Channel
        try {
            const rawTitle = movieInfo.title || "Movie Update";
            const cleanTitle = String(rawTitle).replace(/\s*\([^)]+\)\s*$/g, "").replace(/[*_`~]/g, "").trim();
            const cleanKey = cleanTitle.toLowerCase();
            const normId = String(movieInfo.csv_id || movieInfo.id || movieInfo.tmdb_id || "").toLowerCase().trim();
            const isSeries = (movieInfo.type || "").toLowerCase() === "series" || (movieInfo.type || "").toLowerCase() === "tv";
            const seasonKey = movieInfo.seasonOrPart ? String(movieInfo.seasonOrPart).toLowerCase().trim() : "";
            const dedupeKey = normId ? `${normId}_${seasonKey}` : `${cleanKey}_${seasonKey}`;

            // Deduplication guard:
            // 1. If explicit forceBroadcast is true, allow broadcast unconditionally
            // 2. If a specific season or cut is specified (seasonKey), only deduplicate on that specific release
            // 3. If generic whole-title post (no seasonKey), check base title/ID
            if (!movieInfo.forceBroadcast) {
                if (_recentlyBroadcastedKeys.has(dedupeKey)) {
                    console.log(`[CHANNEL PUBLISH] Skipping duplicate announcement for "${cleanTitle}" (Key: ${dedupeKey}). Already published recently.`);
                    return { message_id: null, skipped: true };
                }
                if (seasonKey) {
                    if (broadcastedCatalogIds.has(dedupeKey)) {
                        console.log(`[CHANNEL PUBLISH] Skipping duplicate announcement for "${cleanTitle}" (Key: ${dedupeKey}). Already published.`);
                        return { message_id: null, skipped: true };
                    }
                } else {
                    if ((normId && broadcastedCatalogIds.has(normId)) || broadcastedCatalogIds.has(cleanKey)) {
                        console.log(`[CHANNEL PUBLISH] Skipping duplicate announcement for "${cleanTitle}" (Base Key). Already published.`);
                        return { message_id: null, skipped: true };
                    }
                }
            }
            _recentlyBroadcastedKeys.add(dedupeKey);
            if (normId && seasonKey) _recentlyBroadcastedKeys.add(`${normId}_${seasonKey}`);

            const yearText = movieInfo.year ? ` (${movieInfo.year})` : "";
            const rawSeason = movieInfo.seasonOrPart || (isSeries ? "Complete Series" : "Full Movie");

            let seasonOrQualityText = isSeries 
                ? (String(rawSeason).toLowerCase().includes("season") ? rawSeason : `Season ${rawSeason}`)
                : (String(rawSeason).toLowerCase().includes("quality") ? rawSeason : `${rawSeason} Quality`);
            if (movieInfo.isSeriesComplete) {
                seasonOrQualityText = "Complete Series | All Seasons";
            }

            // Enrich with metadata if missing using in-memory cache first, then TMDB API (0 Firestore reads)
            if ((!movieInfo.overview || !movieInfo.genres || !movieInfo.categories || !movieInfo.poster || !movieInfo.backdrop) && (movieInfo.csv_id || movieInfo.id || movieInfo.tmdb_id)) {
                const lookupId = String(movieInfo.csv_id || movieInfo.id || movieInfo.tmdb_id || "").toLowerCase();
                const localMatch = cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)
                    ? cachedMoviesMetadata.find(m => String(m.csv_id || "").toLowerCase() === lookupId || String(m.tmdb_id) === lookupId)
                    : null;
                if (localMatch) {
                    movieInfo.overview = movieInfo.overview || localMatch.overview;
                    movieInfo.genres = movieInfo.genres || localMatch.genres || localMatch.categories;
                    movieInfo.rating = movieInfo.rating || localMatch.rating || localMatch.vote_average;
                    movieInfo.year = movieInfo.year || (localMatch.release_date ? localMatch.release_date.substring(0, 4) : localMatch.year);
                    movieInfo.poster = movieInfo.poster || localMatch.poster;
                    movieInfo.backdrop = movieInfo.backdrop || localMatch.backdrop;
                }
            }

            // If still missing overview, genres, or image, fetch directly from TMDB (zero Firestore reads, 100% reliable)
            if (!movieInfo.overview || !movieInfo.genres || !movieInfo.poster || !movieInfo.backdrop) {
                try {
                    const fetchModule = await import('node-fetch').catch(() => null);
                    const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
                    if (fetchFn) {
                        const tmdbApiKey = process.env.TMDB_API_KEY || "d638f7775bfa1b8d456dfd028ccbef19";
                        let tmdbResult = null;
                        const numericId = parseInt(String(movieInfo.tmdb_id || movieInfo.csv_id || movieInfo.id || "").split("-")[0]);
                        const mediaEndpoint = isSeries ? 'tv' : 'movie';
                        
                        if (!isNaN(numericId) && numericId > 0) {
                            const res = await fetchFn(`https://api.themoviedb.org/3/${mediaEndpoint}/${numericId}?api_key=${tmdbApiKey}`);
                            if (res.ok) tmdbResult = await res.json();
                        }
                        
                        if (!tmdbResult) {
                            const yearParam = movieInfo.year ? (isSeries ? `&first_air_date_year=${movieInfo.year}` : `&primary_release_year=${movieInfo.year}`) : '';
                            const searchRes = await fetchFn(`https://api.themoviedb.org/3/search/${mediaEndpoint}?api_key=${tmdbApiKey}&query=${encodeURIComponent(cleanTitle)}${yearParam}`);
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
                            if (!movieInfo.year && (tmdbResult.first_air_date || tmdbResult.release_date)) {
                                movieInfo.year = (tmdbResult.first_air_date || tmdbResult.release_date).substring(0, 4);
                            }
                            if (!movieInfo.backdrop && tmdbResult.backdrop_path) {
                                movieInfo.backdrop = `https://image.tmdb.org/t/p/w1280${tmdbResult.backdrop_path}`;
                            }
                            if (!movieInfo.poster && tmdbResult.poster_path) {
                                movieInfo.poster = `https://image.tmdb.org/t/p/w1280${tmdbResult.poster_path}`;
                            }
                        }
                    }
                } catch (tmdbEnrichErr) {
                    console.warn("[CHANNEL PUBLISH] TMDB enrichment warning:", tmdbEnrichErr.message);
                }
            }

            const rawGenres = Array.isArray(movieInfo.genres) ? movieInfo.genres : (Array.isArray(movieInfo.categories) ? movieInfo.categories : []);
            const genresText = rawGenres.filter(g => g && g !== "Main").slice(0, 3).join(", ");
            const ratingVal = movieInfo.rating || movieInfo.vote_average || "";
            const ratingText = ratingVal ? (String(ratingVal).includes("/") ? ratingVal : `${ratingVal}/10`) : "";

            let metaLine = "";
            if (genresText && ratingText) {
                metaLine = `🎭 ${escapeHtml(genresText)} | ⭐️ ${escapeHtml(ratingText)}\n`;
            } else if (genresText) {
                metaLine = `🎭 ${escapeHtml(genresText)}\n`;
            } else if (ratingText) {
                metaLine = `⭐️ ${escapeHtml(ratingText)}\n`;
            }

            let overviewText = "";
            if (movieInfo.overview && typeof movieInfo.overview === 'string' && movieInfo.overview.toLowerCase() !== "no synopsis available.") {
                const cleanO = movieInfo.overview.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
                if (cleanO.length > 160) {
                    overviewText = cleanO.substring(0, 157) + "...";
                } else {
                    overviewText = cleanO;
                }
            }

            let overviewLine = "";
            if (overviewText) {
                overviewLine = `💬 <i>${escapeHtml(overviewText)}</i>\n\n`;
            } else if (metaLine) {
                overviewLine = "\n";
            }

            const movieId = movieInfo.csv_id || movieInfo.tmdb_id || movieInfo.id || "";
            const deepLinkUrl = movieInfo.downloadLink || movieInfo.stream_url || (movieId 
                ? `https://t.me/Filmhouseappbot?start=dl_${movieId}` 
                : `https://t.me/Filmhouseappbot`);

            // Build high-impact announcement header badge and update callout
            let headerBadge = "🍿 <b>NEW RELEASE ADDED!</b> 🎬";
            let updateCallout = "";

            const rawSpec = movieInfo.seasonOrPart || (movieInfo.updateType || "");
            const specLower = String(rawSpec).toLowerCase().trim();
            const bMode = String(movieInfo.broadcastMode || (movieInfo.isUpdate ? "updated" : "")).toLowerCase();
            const isExplicitRelease = bMode === "released" || bMode === "release" || bMode === "new";
            const isExplicitUpdate = bMode === "updated" || bMode === "update";

            if (isSeries) {
                if (specLower.includes("season") || specLower.match(/\bs\d+\b/i)) {
                    const sMatch = specLower.match(/season\s*(\d+)/i) || specLower.match(/\bs(\d+)\b/i);
                    const sNum = sMatch ? sMatch[1] : rawSpec;
                    if (isExplicitRelease) {
                        headerBadge = "🔥 <b>NEW SEASON RELEASED!</b> 🍿";
                    } else {
                        // Default for seasons is NEW SEASON UPDATED!
                        headerBadge = "🔥 <b>NEW SEASON UPDATED!</b> 🍿";
                    }
                    updateCallout = `📌 <b>Update:</b> <b>Season ${escapeHtml(sNum)} Now Available!</b> ⚡\n`;
                } else if (movieInfo.isSeriesComplete || specLower.includes("complete")) {
                    if (isExplicitUpdate) {
                        headerBadge = "⚡ <b>SERIES UPDATED!</b> 🍿";
                    } else {
                        headerBadge = "🎉 <b>COMPLETE SERIES BATCH!</b> 🎬";
                    }
                    updateCallout = `📌 <b>Update:</b> <b>All Seasons & Episodes Included!</b> ⚡\n`;
                } else if (rawSpec) {
                    if (isExplicitRelease) {
                        headerBadge = "🔥 <b>NEW SERIES RELEASED!</b> 🍿";
                    } else {
                        headerBadge = "⚡ <b>SERIES UPDATED!</b> 🍿";
                    }
                    updateCallout = `📌 <b>Update:</b> <b>${escapeHtml(rawSpec)} Added!</b> ⚡\n`;
                } else {
                    if (isExplicitUpdate) {
                        headerBadge = "⚡ <b>SERIES UPDATED!</b> 🍿";
                        updateCallout = `📌 <b>Update:</b> <b>New Seasons & Episodes Available!</b> ⚡\n`;
                    } else {
                        headerBadge = "🍿 <b>NEW SERIES ADDED!</b> 🎬";
                        updateCallout = `📁 <b>Type:</b> Series • Multi-Season\n`;
                    }
                }
            } else {
                // Movies
                if (specLower.includes("cinema") || specLower.includes("cam") || specLower.includes("theatre")) {
                    headerBadge = isExplicitUpdate ? "📽️ <b>CINEMA CUT UPDATED!</b> 🔥" : "📽️ <b>NEW CINEMA CUT RELEASE!</b> 🔥";
                    updateCallout = `📌 <b>Update:</b> <b>Cinema Cut (Early Access) Now Available!</b> ⚡\n`;
                } else if (specLower.includes("director")) {
                    headerBadge = isExplicitUpdate ? "🎬 <b>DIRECTOR'S CUT UPDATED!</b> 🔥" : "🎬 <b>DIRECTOR'S CUT RELEASE!</b> 🔥";
                    updateCallout = `📌 <b>Update:</b> <b>Director's Cut Added!</b> ⚡\n`;
                } else if (specLower.includes("extended") || specLower.includes("unrated")) {
                    headerBadge = isExplicitUpdate ? "⚡ <b>EXTENDED EDITION UPDATED!</b> 🔥" : "⚡ <b>EXTENDED EDITION RELEASE!</b> 🔥";
                    updateCallout = `📌 <b>Update:</b> <b>Extended / Unrated Version Added!</b> ⚡\n`;
                } else if (specLower.includes("quality") || specLower.includes("1080") || specLower.includes("4k") || specLower.includes("2160") || specLower.includes("720")) {
                    headerBadge = isExplicitRelease ? "✨ <b>HIGH DEFINITION RELEASE!</b> 🍿" : "✨ <b>HIGH DEFINITION UPDATE!</b> 🍿";
                    updateCallout = `📌 <b>Update:</b> <b>${escapeHtml(rawSpec)} Now Available!</b> ⚡\n`;
                } else if (rawSpec) {
                    headerBadge = isExplicitRelease ? "🎬 <b>NEW EDITION ADDED!</b> 🔥" : "✨ <b>MOVIE UPDATED!</b> 🍿";
                    updateCallout = `📌 <b>Update:</b> <b>${escapeHtml(rawSpec)} Now Available!</b> ⚡\n`;
                } else {
                    headerBadge = isExplicitUpdate ? "✨ <b>MOVIE UPDATED!</b> 🍿" : "🍿 <b>NEW MOVIE ADDED!</b> 🎬";
                    updateCallout = isExplicitUpdate ? `📌 <b>Update:</b> <b>HD Direct Stream & Download Live!</b> ⚡\n` : `📁 <b>Type:</b> Full Movie • HD Quality\n`;
                }
            }

            const caption = 
                `${headerBadge}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🎬 <b>${escapeHtml(cleanTitle)}</b>${escapeHtml(yearText)}\n` +
                `${updateCallout}\n` +
                metaLine +
                overviewLine +
                `👉 <a href="${deepLinkUrl}">CLICK HERE TO DOWNLOAD</a> ✔️`;

            // Prioritize landscape poster, fallback to backdrop, then vertical poster, then working GitHub raw banner
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

            const candidateTargets = Array.from(new Set([
                process.env.UPDATES_CHANNEL_ID,
                process.env.CHANNEL_ID,
                "-1004272961286",
                channelTarget
            ].filter(Boolean)));

            console.log(`[CHANNEL PUBLISH] Publishing "${cleanTitle}" announcement to channel...`);

            const miniAppUrl = movieId 
                ? `https://t.me/Filmhouseappbot/filmhouseapp?startapp=movie_${movieId}`
                : `https://t.me/Filmhouseappbot/filmhouseapp`;
            const shareText = encodeURIComponent(`🍿 Watch "${cleanTitle}" on Film House!\nStream and download in HD:`);
            const shareUrl = encodeURIComponent(miniAppUrl);

            const channelReplyMarkup = {
                inline_keyboard: [
                    [
                        {
                            text: "🎬 Watch / Download in App 🍿",
                            url: miniAppUrl
                        }
                    ],
                    [
                        {
                            text: "📢 Share with Friends",
                            url: `https://t.me/share/url?url=${shareUrl}&text=${shareText}`
                        }
                    ]
                ]
            };

            const sendToTarget = async (botInstance, target) => {
                if (!botInstance) throw new Error("Bot instance unavailable");
                try {
                    // Fast path: Telegram natively downloads image URLs via high-speed CDN directly (instant, 0 node overhead)
                    if (bannerUrl && String(bannerUrl).startsWith("http")) {
                        try {
                            return await botInstance.telegram.sendPhoto(target, bannerUrl, {
                                caption: caption,
                                parse_mode: "HTML",
                                reply_markup: channelReplyMarkup
                            });
                        } catch (urlSendErr) {
                            console.warn(`[CHANNEL PUBLISH] Direct URL send failed (${urlSendErr.message}), falling back to buffer download...`);
                        }
                    }

                    // Fallback path: Download buffer only if direct URL was rejected
                    let photoPayload = bannerUrl;
                    if (bannerUrl && String(bannerUrl).startsWith("http")) {
                        try {
                            const fetchModule = await import('node-fetch').catch(() => null);
                            const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
                            if (fetchFn) {
                                const imgRes = await fetchFn(bannerUrl);
                                if (imgRes.ok) {
                                    const arrBuf = await imgRes.arrayBuffer();
                                    photoPayload = { source: Buffer.from(arrBuf) };
                                }
                            }
                        } catch (bufErr) {
                            console.warn(`[CHANNEL PUBLISH] Buffer fetch warning:`, bufErr.message);
                        }
                    }

                    return await botInstance.telegram.sendPhoto(target, photoPayload, {
                        caption: caption,
                        parse_mode: "HTML",
                        reply_markup: channelReplyMarkup
                    });
                } catch (photoErr) {
                    if (photoErr.message && (photoErr.message.includes("photo") || photoErr.message.includes("IMAGE") || photoErr.message.includes("wrong file") || photoErr.message.includes("HTTP") || photoErr.message.includes("failed to get http"))) {
                        console.warn(`[CHANNEL PUBLISH] Photo send failed (${photoErr.message}), falling back to sendMessage...`);
                        return await botInstance.telegram.sendMessage(target, caption, {
                            parse_mode: "HTML",
                            disable_web_page_preview: true,
                            reply_markup: channelReplyMarkup
                        });
                    }
                    throw photoErr;
                }
            };

            let result = null;
            let lastError = null;

            // Try public bot first on all candidate targets
            for (const target of candidateTargets) {
                try {
                    result = await sendToTarget(bot, target);
                    console.log(`[CHANNEL PUBLISH] Published to ${target} via public bot (msg_id: ${result.message_id})`);
                    break;
                } catch (bErr) {
                    lastError = bErr;
                }
            }

            // Fall back to admin bot if public bot was not able to post
            if (!result && adminBot) {
                for (const target of candidateTargets) {
                    try {
                        result = await sendToTarget(adminBot, target);
                        console.log(`[CHANNEL PUBLISH] Published to ${target} via admin bot (msg_id: ${result.message_id})`);
                        break;
                    } catch (aErr) {
                        lastError = aErr;
                    }
                }
            }

            if (result && result.message_id) {
                if (normId) broadcastedCatalogIds.add(normId);
                if (cleanKey) broadcastedCatalogIds.add(cleanKey);
                if (dedupeKey) broadcastedCatalogIds.add(dedupeKey);
                try {
                    const dir = path.dirname(BROADCASTED_CATALOG_FILE);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(BROADCASTED_CATALOG_FILE, JSON.stringify(Array.from(broadcastedCatalogIds)), "utf8");
                } catch (saveErr) {}
            }

            if (!result && lastError) {
                throw lastError;
            }
            return result;
        } catch (err) {
            console.warn(`[CHANNEL PUBLISH] Notice: Could not post to channel: ${err.message}. (Ensure @Filmhouseappbot is an Administrator in Updates Channel with 'Post Messages' permission enabled)`);
            return null;
        }
    };

    // Engine: Admin Reply-to-Fulfill Handler
    // Enables any admin to fulfill movie/stream requests by simply replying to the alert message with a URL or video file
    async function handleAdminReplyToFulfill(ctx) {
        try {
            if (!ctx.message || !ctx.message.reply_to_message) return false;

            const replyMsg = ctx.message.reply_to_message;
            const replyText = replyMsg.text || replyMsg.caption || "";

            // 1. Identify request doc ID from #REQ_ tag or in-memory map
            let docId = null;
            const reqMatch = replyText.match(/#REQ_([a-zA-Z0-9_-]+)/i);
            if (reqMatch) {
                docId = reqMatch[1];
            } else if (adminRequestMsgMap.has(String(replyMsg.message_id))) {
                docId = adminRequestMsgMap.get(String(replyMsg.message_id)).docId;
            }

            // Not a reply to a request notification
            if (!docId) return false;

            // 2. Authorization check
            const senderId = String(ctx.from ? ctx.from.id : "");
            const authorized = await isAdmin(senderId);
            if (!authorized) {
                await ctx.reply("⛔ <b>Unauthorized:</b> Only Film House Administrators can fulfill requests.", { parse_mode: "HTML" });
                return true;
            }

            // 3. Strict Link Parsing & Multi-Quality Batching
            const rawContent = (ctx.message.text || ctx.message.caption || "").trim();
            if (!rawContent && !(ctx.message.document || ctx.message.video)) {
                await ctx.reply(
                    "❌ <b>Invalid Link Format!</b>\n\nPlease provide a valid Telegram bot deep link (e.g., <code>https://t.me/FilmHouseFile3bot?start=...</code>).",
                    { parse_mode: "HTML" }
                );
                return true;
            }

            // Telegram bot deep link regex requirement:
            // https://t.me/{dynamic_bot_name}bot?start={payload}
            const TG_DEEP_LINK_REGEX = /^https?:\/\/(?:t\.me|telegram\.me)\/[a-zA-Z0-9_]+bot\?start=[a-zA-Z0-9_-]+$/i;
            const STREAM_URL_REGEX = /^https?:\/\/[^\s]+$/i;

            // Extract lines for multi-quality batching
            const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const parsedQualities = []; // Array of { quality: string, url: string }
            let hasMultiQualityFormat = false;

            const QUALITY_LINE_REGEX = /^([0-9]{3,4}p|4k|2160p|hd|cam)\s*:\s*(https?:\/\/[^\s]+)$/i;

            for (const line of lines) {
                const match = line.match(QUALITY_LINE_REGEX);
                if (match) {
                    hasMultiQualityFormat = true;
                    parsedQualities.push({
                        quality: match[1].toUpperCase(),
                        url: match[2].trim()
                    });
                }
            }

            // If multi-quality lines were provided, validate all of them
            if (hasMultiQualityFormat) {
                if (parsedQualities.length === 0) {
                    await ctx.reply(
                        "❌ <b>Invalid Multi-Quality Format!</b>\n\nFormat each line as:\n<code>720p: https://t.me/...bot?start=...</code>\n<code>1080p: https://t.me/...bot?start=...</code>",
                        { parse_mode: "HTML" }
                    );
                    return true;
                }
                for (const pq of parsedQualities) {
                    if (!TG_DEEP_LINK_REGEX.test(pq.url) && !STREAM_URL_REGEX.test(pq.url)) {
                        await ctx.reply(
                            `❌ <b>Invalid Link Format for ${pq.quality}!</b>\n\nPlease provide a valid Telegram bot deep link:\n<code>${escapeHtml(pq.url)}</code>`,
                            { parse_mode: "HTML" }
                        );
                        return true;
                    }
                }
            } else {
                // Single link evaluation
                let singleLink = "";
                if (ctx.message.document || ctx.message.video) {
                    const fileObj = ctx.message.document || ctx.message.video;
                    singleLink = `https://t.me/Filmhouseappbot?start=${fileObj.file_id}`;
                } else {
                    const match = rawContent.match(/https?:\/\/[^\s]+/i);
                    singleLink = match ? match[0].trim() : "";
                }

                if (!singleLink) {
                    await ctx.reply(
                        "❌ <b>Invalid Link Format!</b>\n\nPlease provide a valid Telegram bot deep link (e.g., <code>https://t.me/FilmHouseFile3bot?start=...</code>).",
                        { parse_mode: "HTML" }
                    );
                    return true;
                }

                // Check link validation: If bot link or general stream link
                const isTgDeepLink = TG_DEEP_LINK_REGEX.test(singleLink);
                const isStreamUrl = STREAM_URL_REGEX.test(singleLink);

                if (!isTgDeepLink && !isStreamUrl) {
                    await ctx.reply(
                        "❌ <b>Invalid Link Format!</b>\n\nPlease provide a valid Telegram bot deep link (e.g., <code>https://t.me/FilmHouseFile3bot?start=...</code>).",
                        { parse_mode: "HTML" }
                    );
                    return true;
                }

                // Extract optional inline quality tag if typed like "1080p https://..."
                let detectedQuality = "1080P";
                const qInline = rawContent.match(/\b(480p|720p|1080p|2160p|4k|HD|CAM)\b/i);
                if (qInline) detectedQuality = qInline[1].toUpperCase();

                parsedQualities.push({
                    quality: detectedQuality,
                    url: singleLink
                });
            }

            // 4. Content Type Validation & Routing (Read Request First)
            const reqRef = db.collection("requests").doc(docId);
            const reqSnap = await reqRef.get();
            if (!reqSnap.exists) {
                await ctx.reply(`⚠️ Request <code>#REQ_${escapeHtml(docId)}</code> was not found in Firestore.`, { parse_mode: "HTML" });
                return true;
            }

            const reqData = reqSnap.data() || {};
            if (reqData.status === "fulfilled") {
                await ctx.reply("❌ <b>This request has already been fulfilled or the link is already in the database.</b>", { parse_mode: "HTML" });
                return true;
            }

            const isSeries = (reqData.type || "").toLowerCase() === "series" || (reqData.type || "").toLowerCase() === "tv";
            const reqSeason = (reqData.seasonOrPart || "").trim();

            // Series validation rule:
            // If the user requested a specific season (e.g., "Season 1"), proceed.
            // If the request is for an "Entire Series" (or lacks a specific season), abort.
            if (isSeries) {
                const isFullSeries = !reqSeason || /entire|all\s*seasons|full/i.test(reqSeason);
                if (isFullSeries) {
                    await ctx.reply(
                        "⚠️ <b>Full series requests require complex link routing.</b>\n\nPlease tap '<b>Open Film House Admin to Fulfill 🚀</b>' to complete this action in the app.",
                        { parse_mode: "HTML" }
                    );
                    return true;
                }
            }

            const isStreamReq = (reqData.type === "stream" || reqData.requestType === "stream" || reqData.target === "stream_url");
            const reqTitle = (reqData.title || "Movie").trim();
            const cleanReqTitle = reqTitle.toLowerCase().replace(/\s*\([^)]+\)\s*$/g, "").trim();
            const reqCsvId = String(reqData.csv_id || "").toLowerCase().trim();
            const reqTmdbId = String(reqData.tmdb_id || "").trim();
            const adminId = String(ctx.from.id);
            const adminUsername = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || "Admin");

            // Match or generate movie doc key
            let movieDocKey = reqCsvId;
            let existingMovie = null;
            if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                existingMovie = cachedMoviesMetadata.find(m => {
                    const mCsv = String(m.csv_id || "").toLowerCase().trim();
                    const mTmdb = String(m.tmdb_id || "").trim();
                    if (reqTmdbId && mTmdb && reqTmdbId === mTmdb) return true;
                    if (reqCsvId && mCsv && reqCsvId === mCsv) return true;
                    if (!reqTmdbId && cleanReqTitle) {
                        const mClean = String(m.title || "").toLowerCase().replace(/\s*\([^)]+\)\s*$/g, "").trim();
                        return mClean === cleanReqTitle || (typeof titlesMatch === 'function' && titlesMatch(m.title, cleanReqTitle));
                    }
                    return false;
                });
            }

            if (existingMovie && existingMovie.csv_id) {
                movieDocKey = existingMovie.csv_id;
            } else if (!movieDocKey) {
                const slug = cleanReqTitle.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'movie';
                movieDocKey = `${reqTmdbId || Date.now()}-${slug}`;
            }

            const movieRef = db.collection("movies").doc(movieDocKey);
            const adminStatsRef = db.collection("settings").doc("admin_stats");
            const adminKey = adminId.replace(/[^a-zA-Z0-9_]/g, "_");

            let totalAdminFulfillCount = 1;
            const primaryLink = parsedQualities[0].url;

            // 5. Concurrency Protection (Firestore Transactions)
            // Reads request & movie doc first. Aborts if fulfilled or link already exists.
            try {
                await db.runTransaction(async (transaction) => {
                    const transReqSnap = await transaction.get(reqRef);
                    if (!transReqSnap.exists) {
                        throw new Error("REQUEST_NOT_FOUND");
                    }
                    const liveReq = transReqSnap.data() || {};
                    if (liveReq.status === "fulfilled") {
                        throw new Error("ALREADY_FULFILLED");
                    }

                    const transMovieSnap = await transaction.get(movieRef);
                    const movieData = transMovieSnap.exists ? transMovieSnap.data() : (existingMovie || {});
                    const currentLinks = Array.isArray(movieData.links) ? movieData.links : [];

                    // Check if submitted link(s) already exist
                    for (const pq of parsedQualities) {
                        const linkExists = currentLinks.some(l => {
                            if (typeof l === "string") return l === pq.url;
                            return l && l.url === pq.url;
                        }) || movieData.stream_url === pq.url || movieData.downloadLink === pq.url;

                        if (linkExists) {
                            throw new Error("LINK_ALREADY_EXISTS");
                        }
                    }

                    // Prepare updated links array
                    const updatedLinks = [...currentLinks];
                    for (const pq of parsedQualities) {
                        const newEntry = {
                            url: pq.url,
                            quality: pq.quality,
                            ...(reqSeason ? { season: reqSeason } : {})
                        };
                        const replaceIdx = updatedLinks.findIndex(l => {
                            if (typeof l === "string") return false;
                            if (reqSeason && l.season && l.season.toLowerCase() === reqSeason.toLowerCase()) {
                                return (l.quality || "").toUpperCase() === pq.quality;
                            }
                            return (l.quality || "").toUpperCase() === pq.quality;
                        });
                        if (replaceIdx >= 0) {
                            updatedLinks[replaceIdx] = newEntry;
                        } else {
                            updatedLinks.push(newEntry);
                        }
                    }

                    // Build updated movie payload
                    const updatedMoviePayload = {
                        csv_id: movieDocKey,
                        title: movieData.title || reqTitle,
                        year: movieData.year || reqData.year || "",
                        type: isSeries ? "Series" : "Movie",
                        links: isStreamReq ? (movieData.links || []) : updatedLinks,
                        downloadLink: isStreamReq ? (movieData.downloadLink || "") : primaryLink,
                        stream_url: isStreamReq ? primaryLink : (movieData.stream_url || ""),
                        last_updated: admin.firestore.FieldValue.serverTimestamp()
                    };

                    // Read Admin Stats
                    const statsSnap = await transaction.get(adminStatsRef);
                    const statsData = statsSnap.exists ? statsSnap.data() : {};
                    const adminObj = statsData[adminKey] || {
                        id: adminId,
                        name: adminUsername,
                        fulfillments: 0,
                        publications: 0,
                        titles: []
                    };
                    adminObj.name = adminUsername;
                    adminObj.fulfillments = (adminObj.fulfillments || 0) + 1;
                    totalAdminFulfillCount = adminObj.fulfillments;
                    adminObj.lastActiveAt = Date.now();
                    adminObj.titles = adminObj.titles || [];
                    adminObj.titles.unshift({
                        type: "fulfillment",
                        title: reqTitle,
                        date: new Date().toISOString()
                    });
                    if (adminObj.titles.length > 30) adminObj.titles = adminObj.titles.slice(0, 30);
                    statsData[adminKey] = adminObj;

                    // Atomic Writes
                    transaction.update(reqRef, {
                        status: "fulfilled",
                        downloadLink: primaryLink,
                        ...(isStreamReq ? { streamUrl: primaryLink, stream_url: primaryLink } : {}),
                        fulfilledBy: adminUsername,
                        fulfilledById: adminId,
                        fulfilledQualities: parsedQualities,
                        publishToChannel: true,
                        channelPosted: false,
                        fulfilledAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    transaction.set(movieRef, updatedMoviePayload, { merge: true });
                    transaction.set(adminStatsRef, statsData, { merge: true });
                });
            } catch (transErr) {
                if (transErr.message === "ALREADY_FULFILLED" || transErr.message === "LINK_ALREADY_EXISTS") {
                    await ctx.reply("❌ <b>This request has already been fulfilled or the link is already in the database.</b>", { parse_mode: "HTML" });
                    return true;
                }
                throw transErr;
            }

            // Sync with local in-memory catalog cache and local disk (zero Firestore cost)
            if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                let localTarget = cachedMoviesMetadata.find(m => m.csv_id === movieDocKey);
                if (localTarget) {
                    if (isStreamReq) {
                        localTarget.stream_url = primaryLink;
                    } else {
                        localTarget.downloadLink = primaryLink;
                        localTarget.links = localTarget.links || [];
                        for (const pq of parsedQualities) {
                            const entry = { url: pq.url, quality: pq.quality, ...(reqSeason ? { season: reqSeason } : {}) };
                            const idx = localTarget.links.findIndex(l => l && l.quality === pq.quality && (!reqSeason || l.season === reqSeason));
                            if (idx >= 0) localTarget.links[idx] = entry;
                            else localTarget.links.push(entry);
                        }
                    }
                }
                try {
                    fs.writeFileSync(localMetaPathGlobal, JSON.stringify(cachedMoviesMetadata, null, 2), "utf8");
                } catch (e) {}
            }

            // 6. Post-Fulfillment Alerts
            // Edit original request alert message in the admin group if possible
            const fulfilledAlertText = 
                `✅ <b>Request Fulfilled!</b> 🍿\n` +
                `🎬 <b>Title:</b> <b>${escapeHtml(reqTitle)}</b>\n` +
                `👑 <b>Fulfilled by:</b> ${escapeHtml(adminUsername)} (${totalAdminFulfillCount} 🏆)\n` +
                `🔗 <b>Added Link(s):</b>\n` +
                parsedQualities.map(pq => `• <b>${pq.quality}:</b> <code>${escapeHtml(pq.url)}</code>`).join("\n");

            try {
                if (replyMsg.message_id && ctx.chat && ctx.chat.id) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        replyMsg.message_id,
                        null,
                        replyText + `\n\n━━━━━━━━━━━━━━━━━━━━\n✅ <b>FULFILLED by ${escapeHtml(adminUsername)} (${totalAdminFulfillCount} 🏆)</b>`,
                        { parse_mode: "HTML" }
                    ).catch(() => {});
                }
            } catch (editErr) {}

            // Send confirmation reply in admin group
            await ctx.reply(fulfilledAlertText, { parse_mode: "HTML" });

            // Notify the user via User Bot API DM
            const requesterUserId = reqData.userId || reqData.user_id;
            if (requesterUserId) {
                const userMsg = 
                    `🎉 <b>Good news!</b>\n\n` +
                    `✅ Your request for <b>${escapeHtml(reqTitle)}</b> has been fulfilled!\n\n` +
                    (reqSeason ? `📺 <b>Season:</b> ${escapeHtml(reqSeason)}\n\n` : "") +
                    `Enjoy streaming and downloading in the Film House Mini App! 🍿`;

                const miniAppUrl = `https://dans123456.github.io/filmhouse/index.html?movie=${encodeURIComponent(movieDocKey)}`;
                try {
                    await callTelegramWithRetry("sendMessage", requesterUserId, userMsg, {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: "▶️ Watch / Download Now 🎬",
                                        url: miniAppUrl
                                    }
                                ]
                            ]
                        }
                    });
                    await reqRef.update({ notifiedFulfilled: true }).catch(() => {});
                } catch (dmErr) {
                    console.warn(`[ReplyFulfill] User DM notification error to ${requesterUserId}:`, dmErr.message);
                }
            }

            return true;
        } catch (err) {
            console.error("[ReplyFulfill Error]:", err);
            try {
                await ctx.reply(`❌ <b>Fulfillment Failed:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
            } catch (e) {}
            return true;
        }
    }

    // ==========================================
    // AUTO-TMDB MEDIA PARSER & SHOWCASE POSTER ENGINE (Phase 2)
    // ==========================================
    const TMDB_GENRES = {
        28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
        99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
        27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
        10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
        10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
        10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
    };

    // Automated Ingest / Vault Channel Configuration (Workflow C - Hybrid Ingestor)
    let dynamicIngestChannelId = process.env.INGEST_CHANNEL_ID || null;
    async function getIngestChannelId() {
        if (dynamicIngestChannelId) return String(dynamicIngestChannelId);
        try {
            const doc = await db.collection("system").doc("ingest_config").get();
            if (doc.exists && doc.data().channelId) {
                dynamicIngestChannelId = String(doc.data().channelId);
                return dynamicIngestChannelId;
            }
        } catch (e) {}
        return null;
    }

    function parseMediaFilename(rawInput) {
        if (!rawInput) return { cleanTitle: '', year: null, quality: '1080P', isSeries: false, seasonOrPart: null, seasonNum: 1, episodeNum: null };

        let s = String(rawInput).replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|ts|m4v)$/i, '');
        s = s.replace(/[\._]/g, ' ');

        let quality = '1080P';
        const qMatch = s.match(/\b(2160p|4k|1080p|720p|480p|uhd|camrip|cam|hdrip|webrip|web-dl|bluray|brrip|bdrip|telesync|ts|hdts|hdcam)\b/i);
        if (qMatch) {
            quality = qMatch[1].toUpperCase();
            if (quality === '4K') quality = '2160P';
        }

        let isSeries = false;
        let seasonOrPart = null;
        let seasonNum = 1;
        let episodeNum = null;
        let endEpisodeNum = null;
        let extraEpisodes = [];

        const multiEpMatch = s.match(/\bS(\d{1,2})[\s\.\-_]*E(\d{1,3})[\s\.\-_]*(?:-|to|e|E)[\s\.\-_]*(?:[eE])?(\d{1,3})\b/i) || s.match(/\b(\d{1,2})x(\d{1,3})[\s\.\-_]*(?:-|to)[\s\.\-_]*(\d{1,3})\b/i);
        const sEpMatch = s.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) || s.match(/\b(\d{1,2})x(\d{1,3})\b/i);
        const epOnlyMatch = s.match(/\b(?:Episode|Ep|E)\s*(\d{1,3})\b/i);
        const sMatch = s.match(/\b(?:Season|S)\s*(\d{1,2})\b/i);
        const compMatch = s.match(/\b(complete|complete\s*series|all\s*seasons)\b/i);

        if (multiEpMatch) {
            isSeries = true;
            seasonNum = parseInt(multiEpMatch[1], 10);
            episodeNum = parseInt(multiEpMatch[2], 10);
            endEpisodeNum = parseInt(multiEpMatch[3], 10);
            seasonOrPart = 'S' + String(seasonNum).padStart(2, '0') + 'E' + String(episodeNum).padStart(2, '0') + '-E' + String(endEpisodeNum).padStart(2, '0');
            for (let e = episodeNum + 1; e <= endEpisodeNum; e++) {
                extraEpisodes.push(e);
            }
        } else if (sEpMatch) {
            isSeries = true;
            seasonNum = parseInt(sEpMatch[1], 10);
            episodeNum = parseInt(sEpMatch[2], 10);
            seasonOrPart = 'S' + String(seasonNum).padStart(2, '0') + 'E' + String(episodeNum).padStart(2, '0');
        } else if (epOnlyMatch) {
            isSeries = true;
            episodeNum = parseInt(epOnlyMatch[1], 10);
            seasonNum = sMatch ? parseInt(sMatch[1], 10) : 1;
            seasonOrPart = 'S' + String(seasonNum).padStart(2, '0') + 'E' + String(episodeNum).padStart(2, '0');
        } else if (sMatch) {
            isSeries = true;
            seasonNum = parseInt(sMatch[1], 10);
            seasonOrPart = 'Season ' + seasonNum;
        } else if (compMatch) {
            isSeries = true;
            seasonOrPart = 'Complete Series';
        }

        const partMatch = s.match(/\b(part\s*\d+|pt\s*\d+|cd\s*\d+)\b/i);
        if (partMatch && !seasonOrPart) {
            seasonOrPart = partMatch[1].replace(/pt\s*/i, 'Part ').replace(/cd\s*/i, 'Part ').replace(/part\s*/i, 'Part ');
            seasonOrPart = seasonOrPart.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }

        let year = null;
        const yearMatch = s.match(/\b(19\d\d|20\d\d)\b/);
        if (yearMatch) {
            year = yearMatch[1];
        }

        s = s.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^\}]*\}/g, ' ');

        const cutoffRegex = /\b(19\d\d|20\d\d|s\d{1,2}e\d{1,3}|\d{1,2}x\d{1,3}|season\s*\d{1,2}|s\d{1,2}|e\d{1,3}|ep\d{1,3}|episode\s*\d{1,3}|complete|2160p|4k|1080p|720p|480p|uhd|webrip|web-dl|bluray|bdrip|brrip|camrip|cam|x264|x265|hevc|h264|h265|aac|dts|ddp5\.1)\b/i;
        const cutIdx = s.search(cutoffRegex);
        let titlePart = cutIdx !== -1 ? s.substring(0, cutIdx) : s;
        titlePart = titlePart.replace(/[()\-–—]/g, ' ').replace(/\s+/g, ' ').trim();

        if (partMatch && titlePart) {
            titlePart = titlePart.replace(/\b(part\s*\d+|pt\s*\d+|cd\s*\d+)\b/i, '').replace(/\s+/g, ' ').trim();
        }

        // Strip leftover ripper, audio, and platform tags
        titlePart = titlePart.replace(/\b(iq|iqiyi|dual\s*audio|dual|fil|filmh|filmhouse|telefilm|stream)\b/gi, ' ');
        titlePart = titlePart.replace(/\b(nf|amzn|dsnp|hulu|zee5|hotstar)\b/gi, ' ');
        titlePart = titlePart.replace(/\s+/g, ' ').trim();

        // Specific aliases
        if (titlePart.toLowerCase() === 'bel' && isSeries) {
            titlePart = 'Bel-Air';
        }
        if (titlePart.toLowerCase() === 'matchbox the') {
            titlePart = 'Matchbox';
        }

        return {
            cleanTitle: titlePart || s.trim(),
            year: year,
            quality: quality,
            isSeries: isSeries,
            seasonOrPart: seasonOrPart,
            seasonNum: seasonNum,
            episodeNum: episodeNum,
            endEpisodeNum: endEpisodeNum,
            extraEpisodes: extraEpisodes
        };
    }

    async function fetchTmdbMetadata(cleanTitle, year, isSeries) {
        try {
            const fetchModule = await import('node-fetch').catch(() => null);
            const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
            if (!fetchFn) return null;

            const tmdbApiKey = process.env.TMDB_API_KEY || "d638f7775bfa1b8d456dfd028ccbef19";
            const endpoint = isSeries ? 'tv' : 'movie';

            const queriesToTry = [cleanTitle];
            const partMatch = cleanTitle.match(/^(.+?)(?:\s+Part\s+\d+)/i);
            if (partMatch) queriesToTry.push(partMatch[1].trim());
            if (cleanTitle.includes(' ')) queriesToTry.push(cleanTitle.replace(/\s+/g, ''));

            let foundResult = null;
            let targetType = isSeries ? 'Series' : 'Movie';

            for (const q of queriesToTry) {
                // 1. Try endpoint with year if provided
                if (year) {
                    const yearParam = isSeries ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`;
                    const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}${yearParam}`;
                    const res = await fetchFn(url);
                    if (res && res.ok) {
                        const d = await res.json();
                        if (d && d.results && d.results.length > 0) {
                            foundResult = d.results[0];
                            break;
                        }
                    }
                }

                // 2. Try endpoint without year
                const noYearUrl = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}`;
                const resNoYear = await fetchFn(noYearUrl);
                if (resNoYear && resNoYear.ok) {
                    const d = await resNoYear.json();
                    if (d && d.results && d.results.length > 0) {
                        foundResult = d.results[0];
                        break;
                    }
                }

                // 3. Try multi search
                const multiUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}`;
                const resMulti = await fetchFn(multiUrl);
                if (resMulti && resMulti.ok) {
                    const d = await resMulti.json();
                    const filtered = (d.results || []).filter(x => x.media_type === 'movie' || x.media_type === 'tv');
                    if (filtered.length > 0) {
                        foundResult = filtered[0];
                        targetType = foundResult.media_type === 'tv' ? 'Series' : 'Movie';
                        break;
                    }
                }
            }

            if (foundResult) {
                const genres = (foundResult.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean);
                const rDate = foundResult.release_date || foundResult.first_air_date || "";
                const parsedYear = rDate ? rDate.substring(0, 4) : (year || "");
                const title = foundResult.title || foundResult.name || cleanTitle;

                return {
                    tmdb_id: foundResult.id,
                    title: title,
                    year: parsedYear,
                    release_date: rDate,
                    type: (foundResult.media_type === 'tv' || isSeries) ? 'Series' : targetType,
                    rating: foundResult.vote_average ? Math.round(foundResult.vote_average * 10) / 10 : 0,
                    vote_count: foundResult.vote_count || 0,
                    overview: foundResult.overview || "No overview available.",
                    genres: genres,
                    origin_country: foundResult.origin_country || [],
                    original_language: foundResult.original_language || "en",
                    poster: foundResult.poster_path ? `https://image.tmdb.org/t/p/w1280${foundResult.poster_path}` : null,
                    backdrop: foundResult.backdrop_path ? `https://image.tmdb.org/t/p/w1280${foundResult.backdrop_path}` : null
                };
            }
        } catch (e) {
            console.warn("[TMDB Parse Metadata Error]:", e.message);
        }
        return null;
    }

    async function fetchTmdbEpisodeMetadata(tmdbId, seasonNum, episodeNum) {
        if (!tmdbId || !episodeNum) return null;
        try {
            const fetchModule = await import('node-fetch').catch(() => null);
            const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
            if (!fetchFn) return null;
            const tmdbApiKey = process.env.TMDB_API_KEY || "d638f7775bfa1b8d456dfd028ccbef19";
            const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum || 1}/episode/${episodeNum}?api_key=${tmdbApiKey}`;
            const res = await fetchFn(url);
            if (res.ok) {
                const data = await res.json();
                return {
                    name: data.name || `Episode ${episodeNum}`,
                    overview: data.overview || "",
                    still: data.still_path ? `https://image.tmdb.org/t/p/w780${data.still_path}` : null,
                    runtime: data.runtime ? `${data.runtime}m` : null,
                    air_date: data.air_date || ""
                };
            }
        } catch (e) {
            console.warn("[TMDB Episode Parse Error]:", e.message);
        }
        return null;
    }

    // Extraction helper for raw file, text forward, or Streamer Bot post
    function extractMediaAndStreamInfo(msg) {
        if (!msg) return null;
        const fileObj = msg.video || msg.document || msg.animation;
        const text = msg.text || msg.caption || "";
        const rawFilename = fileObj?.file_name || text.split(/\r?\n/)[0] || "";

        // Collect all potential URLs from text, entities, and inline keyboard buttons
        const collectedUrls = [];
        const textMatches = text.match(/https?:\/\/[^\s]+/gi) || [];
        collectedUrls.push(...textMatches);

        const allEntities = [...(msg.entities || []), ...(msg.caption_entities || [])];
        allEntities.forEach(ent => {
            if (ent && ent.url) collectedUrls.push(ent.url);
        });

        if (msg.reply_markup && Array.isArray(msg.reply_markup.inline_keyboard)) {
            msg.reply_markup.inline_keyboard.forEach(row => {
                if (Array.isArray(row)) {
                    row.forEach(btn => {
                        if (btn && btn.url) collectedUrls.push(btn.url);
                    });
                }
            });
        }

        // Detect any HTTP stream URL in text, caption, entities or buttons (e.g. from Streamer Bot)
        const streamRegex = /https?:\/\/[^\s]+(?:\/watch\/|\/dl\/)[^\s]*/i;
        const generalHttpRegex = /https?:\/\/(?:filmhouse-stream|trycloudflare|herokuapp|duckdns)[^\s]*/i;
        const foundStream = collectedUrls.find(u => streamRegex.test(u) || generalHttpRegex.test(u));
        let streamUrl = foundStream ? foundStream.trim() : null;

        // Active streaming server fallback
        const baseServer = (typeof lastSyncedTunnelUrl === "string" && lastSyncedTunnelUrl) || "https://filmhouse-stream.duckdns.org";

        if (!streamUrl && fileObj?.file_id) {
            streamUrl = `${baseServer}/watch/${fileObj.file_id}`;
        }

        let fileDeepLink = "";
        const tgLinkRegex = /https?:\/\/(?:t\.me|telegram\.me)\/[a-zA-Z0-9_]+bot\?start=[a-zA-Z0-9_-]+/i;
        const tgMatch = collectedUrls.find(u => tgLinkRegex.test(u));
        if (tgMatch) {
            fileDeepLink = tgMatch.trim();
        } else if (fileObj?.file_id) {
            fileDeepLink = `https://t.me/Filmhouseappbot?start=${fileObj.file_id}`;
        }

        let fileSizeStr = "";
        if (fileObj?.file_size) {
            const mb = fileObj.file_size / (1024 * 1024);
            fileSizeStr = mb >= 1000 ? (mb / 1024).toFixed(2) + " GB" : Math.round(mb) + " MB";
        }

        return { fileObj, text, rawFilename, streamUrl, fileDeepLink, fileSizeStr };
    }

    const pendingMediaShowcases = new Map();
    const pendingTitleEdits = new Map(); // adminId -> { sessionId }

    async function handleAdminMediaForward(ctx, isFromChannel = false) {
        try {
            const msg = ctx.channelPost || ctx.message;
            if (!msg) return false;

            const mediaInfo = extractMediaAndStreamInfo(msg);
            if (!mediaInfo) return false;

            const { fileObj, text, rawFilename, streamUrl, fileDeepLink, fileSizeStr } = mediaInfo;
            if (!fileObj && !streamUrl) return false;

            // Security Authorization:
            // 1. If from channel: verify chat ID matches configured Ingest Channel OR auto-detected via keywords (Vault, Ingest, Storage, Stream, Upload, Files)
            // 2. If direct forward: verify sender is an authorized Administrator
            const senderId = String(ctx.from ? ctx.from.id : "");
            const chatId = String(ctx.chat ? ctx.chat.id : "");
            const chatTitle = String(ctx.chat?.title || "").toLowerCase();
            const chatUsername = String(ctx.chat?.username || "").toLowerCase();
            const configuredIngestId = await getIngestChannelId();

            if (isFromChannel) {
                const isConfiguredChannel = configuredIngestId && (chatId === configuredIngestId);
                const isKeywordMatchedChannel = /vault|ingest|storage|stream|upload|files/i.test(chatTitle) || /vault|ingest|storage|stream|upload|files/i.test(chatUsername);
                if (!isConfiguredChannel && !isKeywordMatchedChannel) {
                    return false; // Not an ingest channel, ignore silently
                }
            } else {
                const authorized = await isAdmin(senderId);
                if (!authorized) return false;
            }

            const parsed = parseMediaFilename(rawFilename);
            if (!parsed.cleanTitle) {
                if (!isFromChannel) {
                    await ctx.reply(
                        "🎬 <b>Media received!</b>\n\nPlease reply with the title and year (e.g. <code>Dune Part Two 2024</code>) to match on TMDB.",
                        { parse_mode: "HTML" }
                    );
                }
                return true;
            }

            let initialMsg = null;
            if (!isFromChannel) {
                initialMsg = await ctx.reply(
                    `🔍 <b>Analyzing:</b> <code>${escapeHtml(parsed.cleanTitle)}</code> ${parsed.year ? `(${escapeHtml(parsed.year)})` : ""}\n` +
                    `<i>Fetching official TMDB posters, ratings & episode metadata...</i>`,
                    { parse_mode: "HTML" }
                );
            }

            // Fetch TMDB metadata
            const tmdbData = await fetchTmdbMetadata(parsed.cleanTitle, parsed.year, parsed.isSeries);
            const tmdb = tmdbData || {
                tmdb_id: Date.now(),
                title: parsed.cleanTitle,
                year: parsed.year || new Date().getFullYear().toString(),
                type: parsed.isSeries ? 'Series' : 'Movie',
                rating: 0,
                vote_count: 0,
                overview: 'No synopsis available.',
                genres: [],
                poster: 'https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png',
                backdrop: 'https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png'
            };

            // If it's a TV series with specific episode, fetch episode metadata
            let epMeta = null;
            if (parsed.isSeries && parsed.episodeNum && tmdb.tmdb_id) {
                epMeta = await fetchTmdbEpisodeMetadata(tmdb.tmdb_id, parsed.seasonNum, parsed.episodeNum);
            }

            // Check if title already exists in catalogue
            let existingInCatalog = false;
            let existingQualities = [];
            const cleanTitleLower = tmdb.title.toLowerCase().trim();
            if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                const found = cachedMoviesMetadata.find(m => 
                    (m.tmdb_id && String(m.tmdb_id) === String(tmdb.tmdb_id)) ||
                    (m.title && m.title.toLowerCase().trim() === cleanTitleLower)
                );
                if (found) {
                    existingInCatalog = true;
                    if (Array.isArray(found.links)) {
                        existingQualities = found.links.map(l => l.quality || l.season || "Link").filter(Boolean);
                    }
                }
            }

            const sessionId = "f_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6);
            const targetAdminId = senderId || (await getAllAdminIds())[0];
            const adminName = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || "Admin");

            pendingMediaShowcases.set(sessionId, {
                fileObj,
                parsed,
                tmdb,
                epMeta,
                streamUrl,
                fileDeepLink,
                adminId: targetAdminId,
                adminName,
                isFromChannel,
                existingInCatalog
            });
            setTimeout(() => pendingMediaShowcases.delete(sessionId), 30 * 60 * 1000);

            const genresStr = (tmdb.genres && tmdb.genres.length > 0) ? tmdb.genres.slice(0, 3).join(", ") : (tmdb.type || "Movie");
            const ratingStr = tmdb.rating ? `⭐ <b>${tmdb.rating}/10</b>` : "⭐ <i>Unrated</i>";
            const yearStr = tmdb.year ? ` (${tmdb.year})` : "";
            const sizeStr = fileSizeStr ? ` • 💾 <code>${fileSizeStr}</code>` : "";

            let overviewSnippet = epMeta?.overview || tmdb.overview || "No synopsis available.";
            if (overviewSnippet.length > 200) {
                overviewSnippet = overviewSnippet.substring(0, 197) + "...";
            }

            let statusLine = existingInCatalog 
                ? (parsed.isSeries 
                    ? `🔄 <b>Catalogue Status:</b> <i>Found existing series! Will add ${escapeHtml(parsed.seasonOrPart || "new episode")}</i>`
                    : `🔄 <b>Catalogue Status:</b> <i>Found existing movie! Will add ${escapeHtml(parsed.quality || "new quality")} switcher</i>`)
                : `✨ <b>Catalogue Status:</b> <i>Brand new title! Will create new catalogue entry</i>`;

            let episodeLine = "";
            if (parsed.isSeries && parsed.seasonOrPart) {
                const epTitleStr = epMeta?.name ? ` • "${escapeHtml(epMeta.name)}"` : "";
                const epRuntimeStr = epMeta?.runtime ? ` (${escapeHtml(epMeta.runtime)})` : "";
                episodeLine = `📺 <b>Episode:</b> ${escapeHtml(parsed.seasonOrPart)}${epTitleStr}${epRuntimeStr}\n`;
            }

            const previewCaption = 
                `🎬 <b>TMDB Matched:</b> <b>${escapeHtml(tmdb.title)}</b>${escapeHtml(yearStr)}\n` +
                `${ratingStr} | 🎭 ${escapeHtml(genresStr)}\n` +
                `📁 <b>Stream Quality:</b> <code>${escapeHtml(parsed.quality || "1080P")}</code>${sizeStr}\n` +
                episodeLine +
                `\n${statusLine}\n\n` +
                `🔗 <b>Stream URL:</b> <code>${escapeHtml(streamUrl || "Auto-stream")}</code>\n\n` +
                `📖 <i>${escapeHtml(overviewSnippet)}</i>\n\n` +
                `👇 <b>Confirm publishing streaming link:</b>`;

            const showcaseKeyboard = {
                inline_keyboard: [
                    [
                        { text: "🚀 Confirm, Publish & Broadcast", callback_data: `fwd_post:${sessionId}` }
                    ],
                    [
                        { text: "💾 Publish to App Only", callback_data: `fwd_cat:${sessionId}` }
                    ],
                    [
                        { text: "✏️ Edit Title / TMDB", callback_data: `fwd_edit:${sessionId}` },
                        { text: "❌ Dismiss", callback_data: `fwd_dis:${sessionId}` }
                    ]
                ]
            };

            if (initialMsg && initialMsg.message_id) {
                ctx.telegram.deleteMessage(ctx.chat.id, initialMsg.message_id).catch(() => {});
            }

            const photoUrl = epMeta?.still || tmdb.backdrop || tmdb.poster;

            // If triggered from Ingest Channel, dispatch to Master Admins in private chat
            if (isFromChannel) {
                const masterAdmins = await getAllAdminIds();
                for (const admId of masterAdmins) {
                    try {
                        if (photoUrl && photoUrl.startsWith("http")) {
                            await callTelegramWithRetry('sendPhoto', admId, photoUrl, {
                                caption: `📥 <b>Ingest Vault Detected New File!</b>\n\n` + previewCaption,
                                parse_mode: "HTML",
                                reply_markup: showcaseKeyboard
                            });
                        } else {
                            await callTelegramWithRetry('sendMessage', admId, `📥 <b>Ingest Vault Detected New File!</b>\n\n` + previewCaption, {
                                parse_mode: "HTML",
                                reply_markup: showcaseKeyboard
                            });
                        }
                    } catch (e) {
                        console.warn(`[Ingest Dispatch] Error sending preview to admin ${admId}:`, e.message);
                    }
                }
                return true;
            }

            // Direct DM Forward response
            if (photoUrl && photoUrl.startsWith("http")) {
                try {
                    await ctx.replyWithPhoto(photoUrl, {
                        caption: previewCaption,
                        parse_mode: "HTML",
                        reply_markup: showcaseKeyboard
                    });
                    return true;
                } catch (photoErr) {
                    console.warn("[Media Forward] Photo fallback to text:", photoErr.message);
                }
            }

            await ctx.reply(previewCaption, {
                parse_mode: "HTML",
                reply_markup: showcaseKeyboard
            });
            return true;
        } catch (err) {
            console.error("[Media Forward Error]:", err);
            return false;
        }
    }

    async function handleMediaShowcaseCallback(ctx) {
        try {
            const action = ctx.match[1];
            const sessionId = ctx.match[2];
            await ctx.answerCbQuery().catch(() => {});

            const session = pendingMediaShowcases.get(sessionId);
            if (!session && action !== 'dis') {
                return ctx.reply("⚠️ <b>This session has expired.</b> Please forward or upload the file again.", { parse_mode: "HTML" });
            }

            if (action === "dis") {
                pendingMediaShowcases.delete(sessionId);
                try {
                    await ctx.deleteMessage();
                } catch {
                    await ctx.editMessageCaption("❌ <b>Showcase preview dismissed.</b>", { reply_markup: { inline_keyboard: [] } }).catch(() => {});
                }
                return;
            }

            if (action === "edit") {
                const senderId = String(ctx.from ? ctx.from.id : "");
                pendingTitleEdits.set(senderId, { sessionId });
                return ctx.reply(
                    `✏️ <b>Override Title / TMDB:</b>\n\nPlease reply to this message with the exact Movie or Series title and year (e.g. <code>Dune Part Two 2024</code>) or TMDB ID:`,
                    { parse_mode: "HTML" }
                );
            }

            const { fileObj, parsed, tmdb, epMeta, streamUrl, fileDeepLink, adminId, adminName } = session;

            // Determine or match Firestore document key
            const cleanTitle = (tmdb.title || "").trim();
            const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'movie';
            let docKey = `${tmdb.tmdb_id || Date.now()}-${slug}`;

            // Search if already exists in Firestore by tmdb_id or slug
            let movieRef = db.collection("movies").doc(docKey);
            try {
                if (tmdb.tmdb_id) {
                    const snap = await db.collection("movies").where("tmdb_id", "==", tmdb.tmdb_id).limit(1).get();
                    if (!snap.empty) {
                        docKey = snap.docs[0].id;
                        movieRef = snap.docs[0].ref;
                    }
                }
            } catch (e) {}

            // Construct new link entry
            let newLinkEntry;
            if (parsed.isSeries && parsed.episodeNum) {
                newLinkEntry = {
                    season: parsed.seasonNum || 1,
                    seasonOrPart: parsed.seasonOrPart || `Season ${parsed.seasonNum || 1}`,
                    episode: parsed.episodeNum,
                    episodeNum: parsed.episodeNum,
                    quality: parsed.quality || "720p",
                    name: epMeta?.name || `Episode ${parsed.episodeNum}`,
                    still_path: epMeta?.still || tmdb.backdrop || "",
                    overview: epMeta?.overview || "",
                    runtime: epMeta?.runtime || "",
                    url: streamUrl,
                    stream_url: streamUrl,
                    downloadLink: fileDeepLink
                };
            } else {
                newLinkEntry = {
                    quality: parsed.quality || "1080P",
                    url: streamUrl,
                    stream_url: streamUrl,
                    downloadLink: fileDeepLink,
                    ...(parsed.seasonOrPart ? { season: parsed.seasonOrPart } : {})
                };
            }

            // Save to Firestore
            await ctx.reply("💾 <b>Publishing streaming link to FilmHouse Catalogue...</b>", { parse_mode: "HTML" });

            const docSnap = await movieRef.get();
            if (docSnap.exists) {
                const existing = docSnap.data() || {};
                const currentLinks = Array.isArray(existing.links) ? existing.links : [];

                // Find and update or append
                let matchIdx = -1;
                if (parsed.isSeries && parsed.episodeNum) {
                    matchIdx = currentLinks.findIndex(l => 
                        (l.season == (parsed.seasonNum || 1)) && 
                        (l.episode == parsed.episodeNum || l.episodeNum == parsed.episodeNum) &&
                        (String(l.quality || '').toUpperCase() === String(parsed.quality || '720P').toUpperCase())
                    );
                } else {
                    matchIdx = currentLinks.findIndex(l => 
                        (l.quality || '').toUpperCase() === (parsed.quality || '1080P').toUpperCase() &&
                        (l.season || '') === (parsed.seasonOrPart || '')
                    );
                }

                if (matchIdx >= 0) {
                    currentLinks[matchIdx] = newLinkEntry;
                } else {
                    currentLinks.push(newLinkEntry);
                }

                await movieRef.set({
                    links: currentLinks,
                    stream_url: existing.stream_url || streamUrl,
                    downloadLink: existing.downloadLink || fileDeepLink,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            } else {
                await movieRef.set({
                    csv_id: docKey,
                    tmdb_id: tmdb.tmdb_id,
                    title: tmdb.title,
                    year: tmdb.year,
                    type: tmdb.type,
                    overview: tmdb.overview,
                    genres: tmdb.genres,
                    rating: tmdb.rating,
                    poster: tmdb.poster,
                    backdrop: tmdb.backdrop,
                    stream_url: streamUrl,
                    downloadLink: fileDeepLink,
                    links: [newLinkEntry],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }

            // Update in-memory metadata cache for instant client availability
            if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                const idx = cachedMoviesMetadata.findIndex(m => m.csv_id === docKey || String(m.tmdb_id) === String(tmdb.tmdb_id));
                const catalogEntry = {
                    csv_id: docKey,
                    tmdb_id: tmdb.tmdb_id,
                    title: tmdb.title,
                    year: tmdb.year,
                    type: tmdb.type,
                    overview: tmdb.overview,
                    genres: tmdb.genres,
                    rating: tmdb.rating,
                    poster: tmdb.poster,
                    backdrop: tmdb.backdrop,
                    stream_url: streamUrl,
                    downloadLink: fileDeepLink,
                    links: [newLinkEntry]
                };
                if (idx >= 0) {
                    const existingLinks = Array.isArray(cachedMoviesMetadata[idx].links) ? cachedMoviesMetadata[idx].links : [];
                    const mergedLinks = [...existingLinks.filter(l => (l.quality || '').toUpperCase() !== (parsed.quality || '1080P').toUpperCase()), newLinkEntry];
                    cachedMoviesMetadata[idx] = { ...cachedMoviesMetadata[idx], ...catalogEntry, links: mergedLinks };
                } else {
                    cachedMoviesMetadata.unshift(catalogEntry);
                }
            }

            // Credit admin work share stats
            try {
                if (adminId) {
                    const adminKey = adminId.replace(/[^a-zA-Z0-9_]/g, "_");
                    const statsRef = db.collection("settings").doc("admin_stats");
                    const statsDoc = await statsRef.get();
                    const currentStats = statsDoc.exists ? statsDoc.data() : {};
                    const adm = currentStats[adminKey] || { id: adminId, name: adminName, fulfillments: 0, publications: 0, titles: [] };
                    adm.name = adminName;
                    adm.titles = adm.titles || [];
                    if (!adm.titles.some(t => t.title && t.title.toLowerCase() === cleanTitle.toLowerCase())) {
                        adm.titles.unshift({ type: "publication", title: cleanTitle, date: new Date().toISOString() });
                    }
                    if (adm.titles.length > 30) adm.titles = adm.titles.slice(0, 30);
                    adm.publications = (adm.publications || 0) + 1;
                    adm.lastActiveAt = Date.now();
                    currentStats[adminKey] = adm;
                    await statsRef.set(currentStats, { merge: true });
                }
            } catch (statErr) {
                console.warn("[Media Forward Showcase] Admin stats update warning:", statErr.message);
            }

            pendingMediaShowcases.delete(sessionId);

            // If action is "post", also broadcast to Updates Channel
            if (action === "post") {
                await ctx.reply("📢 <b>Broadcasting release announcement to Updates Channel...</b>", { parse_mode: "HTML" });
                const res = await publishMovieToChannel({
                    ...tmdb,
                    id: docKey,
                    csv_id: docKey,
                    seasonOrPart: parsed.seasonOrPart || (parsed.quality + " HD"),
                    downloadLink: fileDeepLink,
                    stream_url: streamUrl,
                    forceBroadcast: true
                });

                if (res && res.message_id) {
                    return ctx.reply(
                        `🎉 <b>Published to Catalogue & Broadcast to Channel!</b>\n\n` +
                        `🎬 <b>Title:</b> ${escapeHtml(tmdb.title)} (${escapeHtml(tmdb.year)})\n` +
                        `📁 <b>Quality:</b> <code>${escapeHtml(parsed.quality || "1080P")}</code>\n` +
                        `🔗 <b>Stream URL:</b> <code>${escapeHtml(streamUrl)}</code>\n` +
                        `📢 <b>Channel Post ID:</b> <code>${res.message_id}</code>\n\n` +
                        `🍿 Live now in FilmHouse Cinema Player!`,
                        { parse_mode: "HTML" }
                    );
                }
            }

            // Normal catalog publish confirmation
            return ctx.reply(
                `🎉 <b>Successfully Published to FilmHouse Catalogue!</b>\n\n` +
                `🎬 <b>Title:</b> ${escapeHtml(tmdb.title)} (${escapeHtml(tmdb.year)})\n` +
                `📁 <b>Stream Quality:</b> <code>${escapeHtml(parsed.quality || "1080P")}</code>\n` +
                `🔗 <b>Stream URL:</b> <code>${escapeHtml(streamUrl)}</code>\n\n` +
                `🍿 Live now in FilmHouse Cinema Player with multi-quality switching!\n\n` +
                `<i>Optional: Tap below if you would like to broadcast it to your Updates Channel:</i>`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "📢 Broadcast to Updates Channel", callback_data: `fwd_post:${sessionId}` }
                            ],
                            [
                                { text: "❌ Close", callback_data: `fwd_dis:${sessionId}` }
                            ]
                        ]
                    }
                }
            );

        } catch (cbErr) {
            console.error("[Media Showcase Callback Error]:", cbErr);
            return ctx.reply(`❌ <b>Action failed:</b> ${escapeHtml(cbErr.message)}`, { parse_mode: "HTML" });
        }
    }

    // ==========================================
    // DEDICATED ADMIN BOT SUITE (@Fiimhouse_adminBot)
    // ==========================================
    if (adminBot) {
        // Register Admin Bot commands with Telegram for native command menu
        adminBot.telegram.setMyCommands([
            { command: 'start', description: '👑 Admin Command Center' },
            { command: 'menu', description: '👑 Show Admin Menu' },
            { command: 'broadcast', description: '📢 Broadcast Announcement to All Users' },
            { command: 'topadmins', description: '🏆 Top Admin Fulfillers Leaderboard' },
            { command: 'logs', description: '📜 View live server logs' },
            { command: 'pending', description: '📋 View pending movie requests' },
            { command: 'post', description: '📢 Post title announcement to Updates Channel' },
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

        // Admin Reply-to-Fulfill handler for dedicated admin bot
        adminBot.use(async (ctx, next) => {
            if (ctx.message && ctx.message.reply_to_message) {
                const handled = await handleAdminReplyToFulfill(ctx);
                if (handled) return;
            }
            return next();
        });

        // Admin Forward/Upload media handler for dedicated admin bot
        adminBot.on(['video', 'document', 'animation'], async (ctx, next) => {
            if (ctx.message && ctx.message.reply_to_message) {
                const handled = await handleAdminReplyToFulfill(ctx);
                if (handled) return;
            }
            const handled = await handleAdminMediaForward(ctx);
            if (!handled && typeof next === 'function') return next();
        });

        // Action handler for forward showcase buttons
        adminBot.action(/^fwd_(post|cat|edit|dis):(.+)$/, async (ctx) => {
            await handleMediaShowcaseCallback(ctx);
        });

        // Admin text handler for title overrides and stream link text forwards
        adminBot.on('text', async (ctx, next) => {
            const senderId = String(ctx.from ? ctx.from.id : "");
            if (pendingTitleEdits.has(senderId)) {
                const { sessionId } = pendingTitleEdits.get(senderId);
                pendingTitleEdits.delete(senderId);
                const session = pendingMediaShowcases.get(sessionId);
                if (session) {
                    const newTitleInput = ctx.message.text.trim();
                    await ctx.reply(`🔍 Re-matching with: <code>${escapeHtml(newTitleInput)}</code>...`, { parse_mode: "HTML" });
                    const newParsed = parseMediaFilename(newTitleInput);
                    const newTmdb = await fetchTmdbMetadata(newParsed.cleanTitle, newParsed.year, session.parsed.isSeries);
                    if (newTmdb) {
                        session.tmdb = newTmdb;
                        session.parsed.cleanTitle = newParsed.cleanTitle;
                        if (newParsed.year) session.parsed.year = newParsed.year;
                        await ctx.reply(`✅ Matched: <b>${escapeHtml(newTmdb.title)} (${escapeHtml(newTmdb.year)})</b>. Please tap Confirm on the previous card to publish.`, { parse_mode: "HTML" });
                        return;
                    } else {
                        await ctx.reply("⚠️ Could not match on TMDB. Please try another title or TMDB ID.");
                        return;
                    }
                }
            }
            if (ctx.message && (await isAdmin(senderId))) {
                const info = extractMediaAndStreamInfo(ctx.message);
                if (info && (info.streamUrl || info.fileObj)) {
                    const handled = await handleAdminMediaForward(ctx);
                    if (handled) return;
                }
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
                        .filter(r => {
                            if (r.downloadLink && String(r.downloadLink).trim() !== "") return false;
                            if (r.status === "fulfilled" || r.fulfilled === true) return false;
                            if (r.status === "priority" || r.boosted === true || r.isPriority === true) return true;
                            if (r.status === "claimed" || r.claimed === true) return false;
                            return true;
                        });
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
                parse_mode: payload.parse_mode || "HTML",
                reply_markup: {
                    inline_keyboard: payload.keyboard
                }
            };

            const sendOrEdit = async (text, opts) => {
                if (ctx.callbackQuery && ctx.callbackQuery.message) {
                    try {
                        return await ctx.editMessageText(text, opts);
                    } catch (err) {
                        if (err.message && err.message.includes("message is not modified")) {
                            return;
                        }
                        return await ctx.reply(text, opts);
                    }
                } else {
                    return await ctx.reply(text, opts);
                }
            };

            try {
                return await sendOrEdit(payload.text, options);
            } catch (err) {
                if (err.message && (err.message.includes("can't parse entities") || err.message.includes("entity"))) {
                    console.warn(`[AdminBot] HTML parse failed (${err.message}). Retrying plain text fallback...`);
                    const fallbackOpts = { ...options };
                    delete fallbackOpts.parse_mode;
                    const plainText = String(payload.text || "")
                        .replace(/<[^>]+>/g, "")
                        .replace(/&amp;/g, "&")
                        .replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">");
                    return await sendOrEdit(plainText, fallbackOpts);
                }
                throw err;
            }
        };

        // View 1: Main Admin Menu / Command Center
        const getAdminMenuPayload = (adminName = 'Admin', adminId = '') => {
            const subCount = localStore.getCount();
            const mem = process.memoryUsage();
            const memoryMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
            const uptimeHours = (process.uptime() / 3600).toFixed(1);
            const pendingCount = cachedPendingRequests.length;
            const safeName = escapeHtml(adminName || 'Admin');
            const adminUrl = adminId 
                ? `https://dans123456.github.io/filmhouse/admin.html?tg_id=${adminId}`
                : `https://dans123456.github.io/filmhouse/admin.html`;

            const text = 
                `👑 <b>Film House Admin Command Center</b>\n\n` +
                `👋 Welcome, <b>${safeName}</b>!\n\n` +
                `📊 <b>Live System Overview:</b>\n` +
                `• 👥 <b>Subscribers (Ubuntu DB):</b> <code>${subCount}</code>\n` +
                `• ⏳ <b>Pending Requests:</b> <code>${pendingCount}</code>\n` +
                `• ⚡ <b>Server Uptime:</b> <code>${uptimeHours} hrs</code> (RAM: <code>${memoryMB} MB</code>)\n` +
                `• 🛡 <b>Public Bot:</b> Online & Polling\n` +
                `• 👑 <b>Admin Bot:</b> Active & Listening\n\n` +
                `🛠 <b>Available Commands:</b>\n` +
                `• /scanquick — Ultra-fast 2s scan of newest uploads\n` +
                `• /scanlibrary — Full scan & link streaming files\n` +
                `• /autoingest — Auto-create cards from TMDB & link streams\n` +
                `• /publishcatalog — Push latest stream links to GitHub main\n` +
                `• /update — Pull latest GitHub code & reload bot\n` +
                `• /help — Admin tutorials & duty workflows\n` +
                `• /post [Title] — Publish title announcement to Updates Channel\n` +
                `• /logs — View live server & bot logs\n` +
                `• /pending — View pending movie requests\n` +
                `• /backup — Download weekly CSV catalog backup\n` +
                `• /sync_catalog — Sync movies catalog from GitHub\n` +
                `• /topadmins — View admin Work Share leaderboard\n` +
                `• /stats — Detailed server & subscriber metrics`;

            const keyboard = [
                [
                    { text: "👑 Open Admin Panel 🚀", web_app: { url: adminUrl } }
                ],
                [
                    { text: "⚡ Quick Scan (2s)", callback_data: "admin_trigger_scanquick" },
                    { text: "📡 Full Scan", callback_data: "admin_trigger_scan" }
                ],
                [
                    { text: "✨ Auto-Ingest TMDB", callback_data: "admin_trigger_autoingest" },
                    { text: "🚀 Push to GitHub", callback_data: "admin_trigger_pushgithub" }
                ],
                [
                    { text: "📋 Pending Requests", callback_data: "admin_pending" },
                    { text: "📜 Server Logs", callback_data: "admin_logs" }
                ],
                [
                    { text: "❓ Help & Tutorials", callback_data: "admin_help" },
                    { text: "📊 System Stats", callback_data: "admin_stats" }
                ],
                [
                    { text: "💾 Download Backup", callback_data: "admin_backup" },
                    { text: "🔄 Refresh Overview", callback_data: "admin_menu" }
                ]
            ];

            return { text, keyboard, parse_mode: "HTML" };
        };

        // View 2: Pending Requests (Grouped with Pagination)
        const getPendingRequestsPayload = (requests = [], page = 0) => {
            // Group requests by Title + TMDB ID / Year + Season
            const groupedMap = {};
            requests.forEach(r => {
                const rawTitle = r.title || "Movie";
                const cleanTitleKey = rawTitle.toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "");
                const tmdbPart = r.tmdb_id || r.tmdbId || "";
                const yearPart = r.year || "";
                const seasonPart = (r.seasonOrPart || "").toLowerCase().trim();
                const groupKey = tmdbPart 
                    ? `${cleanTitleKey}_tmdb_${tmdbPart}_${seasonPart}` 
                    : (yearPart ? `${cleanTitleKey}_year_${yearPart}_${seasonPart}` : `${cleanTitleKey}_${seasonPart}`);
                
                const reqDate = parseRequestDate(r.requestedAt || r._localTime || r.createdAt || r.timestamp);

                if (!groupedMap[groupKey]) {
                    groupedMap[groupKey] = {
                        title: rawTitle,
                        year: r.year || "",
                        type: r.type || "Movie",
                        seasonOrPart: r.seasonOrPart || "",
                        isPriority: (r.status === "priority" || r.boosted || r.isPriority === true),
                        requesters: [],
                        latestDate: reqDate
                    };
                } else {
                    if (reqDate && (!groupedMap[groupKey].latestDate || reqDate > groupedMap[groupKey].latestDate)) {
                        groupedMap[groupKey].latestDate = reqDate;
                    }
                }
                if (r.status === "priority" || r.boosted || r.isPriority === true) {
                    groupedMap[groupKey].isPriority = true;
                }
                
                const reqUser = r.requestedBy || r.user || r.userId || 'guest';
                const userDisplay = String(reqUser).startsWith('@') ? reqUser : `@${reqUser}`;
                if (!groupedMap[groupKey].requesters.includes(userDisplay)) {
                    groupedMap[groupKey].requesters.push(userDisplay);
                }
            });

            const groupedList = Object.values(groupedMap);
            
            // Sort: High priority first, then by requester count descending, then newest request
            groupedList.sort((a, b) => {
                if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
                if (b.requesters.length !== a.requesters.length) return b.requesters.length - a.requesters.length;
                const timeA = a.latestDate ? a.latestDate.getTime() : 0;
                const timeB = b.latestDate ? b.latestDate.getTime() : 0;
                return timeB - timeA;
            });

            const pageSize = 10;
            const totalPages = Math.ceil(groupedList.length / pageSize) || 1;
            const currentPage = Math.max(0, Math.min(page, totalPages - 1));
            const pageItems = groupedList.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

            let msg = `📋 <b>Pending Movie Requests (${requests.length} total, ${groupedList.length} titles):</b>\n`;
            if (totalPages > 1) {
                msg += `<i>Page ${currentPage + 1} of ${totalPages}</i>\n\n`;
            } else {
                msg += `\n`;
            }

            if (groupedList.length === 0) {
                msg += `🎉 <b>All caught up!</b> There are no pending requests right now.\n\n`;
            } else {
                pageItems.forEach((item, idx) => {
                    const globalIdx = currentPage * pageSize + idx + 1;
                    const prioBadge = item.isPriority ? " 🔥 <b>[HIGH PRIORITY]</b>" : "";
                    const year = item.year && !item.title.includes(item.year) ? ` (${escapeHtml(item.year)})` : "";
                    const season = item.seasonOrPart ? ` [${escapeHtml(item.seasonOrPart)}]` : "";
                    const cleanTitle = escapeHtml(item.title);
                    const cleanType = escapeHtml(item.type);
                    
                    let requestersStr = "";
                    if (item.requesters.length === 1) {
                        requestersStr = escapeHtml(item.requesters[0]);
                    } else {
                        requestersStr = `Requesters (${item.requesters.length}): ` + item.requesters.map(u => escapeHtml(u)).join(", ");
                    }
                    
                    const dateFormatted = item.latestDate ? ` | 📅 ${formatRequestDateTime(item.latestDate, false)}` : "";
                    msg += `${globalIdx}. <b>${cleanTitle}</b>${year}${season}${prioBadge}\n   • 📁 <i>${cleanType}</i> | 👤 ${requestersStr}${dateFormatted}\n\n`;
                });

                msg += `💡 Open the Admin Web App to fulfill these requests with download links!\n`;
            }

            // Pagination buttons
            const navButtons = [];
            if (currentPage > 0) {
                navButtons.push({ text: "⬅️ Previous", callback_data: `admin_req_page_${currentPage - 1}` });
            }
            if (totalPages > 1) {
                navButtons.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: `admin_req_page_${currentPage}` });
            }
            if (currentPage < totalPages - 1) {
                navButtons.push({ text: "Next ➡️", callback_data: `admin_req_page_${currentPage + 1}` });
            }

            const keyboard = [
                [
                    { text: "👑 Open Admin to Fulfill 🚀", web_app: { url: "https://dans123456.github.io/filmhouse/admin.html" } }
                ]
            ];

            if (navButtons.length > 0) {
                keyboard.push(navButtons);
            }

            keyboard.push([
                { text: "🔄 Refresh Requests", callback_data: `admin_req_page_${currentPage}` },
                { text: "« Back to Menu", callback_data: "admin_menu" }
            ]);

            return { text: msg, keyboard, parse_mode: "HTML" };
        };

        // View 3A: Server & Diagnostic Logs Category Selection Menu
        const getLogsCategoryMenuPayload = () => {
            const serverCount = (categorizedLogs.server || []).length;
            const adminBotCount = (categorizedLogs.admin_bot || []).length;
            const userBotCount = (categorizedLogs.user_bot || []).length;
            const userAppCount = (categorizedLogs.user_app || []).length;
            const adminAppCount = (categorizedLogs.admin_app || []).length;
            const errCount = (categorizedLogs.error || []).length;

            const msg = 
                `📜 <b>Server & Application Diagnostics Logs</b>\n\n` +
                `Select a specific log stream to inspect live diagnostic traces and troubleshoot issues:\n\n` +
                `• 🖥 <b>Server / General:</b> <code>${serverCount}</code> entries\n` +
                `• 👑 <b>Admin Bot:</b> <code>${adminBotCount}</code> entries\n` +
                `• 🤖 <b>User Bot:</b> <code>${userBotCount}</code> entries\n` +
                `• 📱 <b>User App:</b> <code>${userAppCount}</code> entries\n` +
                `• 💼 <b>Admin App:</b> <code>${adminAppCount}</code> entries\n` +
                `• ⚠️ <b>Error Logs:</b> <code>${errCount}</code> errors\n\n` +
                `💡 <i>Tap any category below to inspect recent activity in real time.</i>`;

            const keyboard = [
                [
                    { text: `🖥 Server / General (${serverCount})`, callback_data: "admin_log_cat_server" },
                    { text: `👑 Admin Bot (${adminBotCount})`, callback_data: "admin_log_cat_admin_bot" }
                ],
                [
                    { text: `🤖 User Bot (${userBotCount})`, callback_data: "admin_log_cat_user_bot" },
                    { text: `📱 User App (${userAppCount})`, callback_data: "admin_log_cat_user_app" }
                ],
                [
                    { text: `💼 Admin App (${adminAppCount})`, callback_data: "admin_log_cat_admin_app" },
                    { text: `⚠️ Error Logs (${errCount})`, callback_data: "admin_log_cat_error" }
                ],
                [
                    { text: "« Back to Menu", callback_data: "admin_menu" }
                ]
            ];

            return { text: msg, keyboard, parse_mode: "HTML" };
        };

        // View 3B: Categorized Logs Stream Viewer
        const getLogsPayload = (category = "server") => {
            const catMap = {
                server: { title: "🖥 Server / General", desc: "Process, PM2, DB sync & background cron" },
                admin_bot: { title: "👑 Admin Bot", desc: "Admin commands, menu clicks, backups & alerts" },
                user_bot: { title: "🤖 User Bot", desc: "User /start, movie searches, DM delivery & pings" },
                user_app: { title: "📱 User App", desc: "Movie requests, search queries & user actions" },
                admin_app: { title: "💼 Admin App", desc: "Admin fulfillments, catalog updates & management" },
                error: { title: "⚠️ Error Logs", desc: "Exceptions, network errors & failed deliveries" }
            };

            const catInfo = catMap[category] || catMap.server;
            const entries = categorizedLogs[category] || [];
            
            let logText = "";
            if (entries.length > 0) {
                logText = entries.slice(-25).join("\n");
            } else {
                // If on Ubuntu with PM2 logs, fallback for server and error categories
                if (category === "server" || category === "error") {
                    const pm2Logs = getRecentLogs(category === "error" ? "error" : "out");
                    if (pm2Logs && !pm2Logs.includes("Log file not found")) {
                        logText = pm2Logs;
                    }
                }
            }

            if (!logText || logText.trim().length === 0) {
                logText = `No entries recorded for ${catInfo.title} yet.\n(Listening for live events...)`;
            }

            const safeLogs = escapeHtml(logText);
            const msg = 
                `📜 <b>Log Stream: ${catInfo.title}</b>\n` +
                `<i>${catInfo.desc}</i> (Last 25 entries):\n\n` +
                `<pre>${safeLogs.slice(-3500)}</pre>`;

            const keyboard = [
                [
                    { text: "🔄 Refresh", callback_data: `admin_log_cat_${category}` },
                    { text: "📋 Log Categories", callback_data: "admin_logs" }
                ],
                [
                    { text: "« Back to Menu", callback_data: "admin_menu" }
                ]
            ];

            return { text: msg, keyboard, parse_mode: "HTML" };
        };

        // View 4: System Stats
        const getStatsPayload = () => {
            const mem = process.memoryUsage();
            const heapUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
            const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
            const uptime = (process.uptime() / 3600).toFixed(2);
            const subscribers = localStore.getCount();

            const msg = 
                `📊 <b>Film House Server & Bot Statistics</b>\n\n` +
                `🖥 <b>Server Environment:</b> Oracle Cloud Always Free (Ubuntu 24.04 LTS)\n` +
                `⏱ <b>Process Uptime:</b> <code>${uptime} hours</code>\n` +
                `💾 <b>Memory:</b> <code>${heapUsedMB} MB</code> (Heap) / <code>${rssMB} MB</code> (RSS)\n` +
                `👥 <b>Local Subscribers:</b> <code>${subscribers}</code> users on disk\n` +
                `📁 <b>Local Database:</b> <code>./data/bot_users.json</code>\n` +
                `🛡 <b>Public Bot:</b> Polling mode active\n` +
                `👑 <b>Admin Bot:</b> Polling mode active`;

            const keyboard = [
                [
                    { text: "🔄 Refresh Stats", callback_data: "admin_stats" },
                    { text: "« Back to Menu", callback_data: "admin_menu" }
                ]
            ];

            return { text: msg, keyboard, parse_mode: "HTML" };
        };

        // View 5: Admin Tutorials & Master Operations Hub
        const getAdminHelpPayload = () => {
            const text = 
                `📚 <b>Film House Master Operations & Bot Guide</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Choose a guide below for complete step-by-step instructions:\n\n` +
                `🌟 <b>Golden Naming Standard:</b> Format rules to guarantee 100% automated matches\n` +
                `📡 <b>Library Scanner:</b> How to use <code>/scanlibrary</code>, fast skip, & cancel\n` +
                `🎬 <b>Forwarding Media:</b> Movies & TV series batch processing\n` +
                `🖥 <b>Server & VPS:</b> Daily commands, 1-click updates, and logs\n\n` +
                `<i>Tap any category below to read:</i>`;

            const keyboard = [
                [
                    { text: "🌟 Golden Naming Standard", callback_data: "admin_help_naming" },
                    { text: "📡 Library Scanner Guide", callback_data: "admin_help_scanner" }
                ],
                [
                    { text: "🎬 Forwarding Media Guide", callback_data: "admin_help_stream" },
                    { text: "🖥 VPS Terminal Commands", callback_data: "admin_help_vps" }
                ],
                [
                    { text: "📋 Pending Requests", callback_data: "admin_pending" },
                    { text: "📜 Server Logs", callback_data: "admin_logs" }
                ],
                [
                    { text: "👑 Open Admin Panel 🚀", web_app: { url: "https://dans123456.github.io/filmhouse/admin.html" } }
                ],
                [
                    { text: "« Back to Menu", callback_data: "admin_menu" }
                ]
            ];

            return { text, keyboard, parse_mode: "HTML" };
        };

        const getHelpNamingPayload = () => {
            const text = 
                `🌟 <b>The Golden Naming Standard</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `To guarantee 100% automated matching between Telegram files and your catalogue, name files using this clean dot format:\n\n` +
                `🎬 <b>For Movies:</b>\n` +
                `<code>Title.Year.Quality.ext</code>\n` +
                `• <code>Gladiator.II.2024.1080p.mkv</code>\n` +
                `• <code>Dune.Part.Two.2024.720p.mkv</code>\n` +
                `• <code>Black.Panther.2018.4K.mkv</code>\n\n` +
                `📺 <b>For TV Series:</b>\n` +
                `<code>Title.S01E01.Quality.ext</code>\n` +
                `• <code>Severance.S02E05.1080p.mkv</code>\n` +
                `• <code>Game.of.Thrones.S01E01.720p.mkv</code>\n` +
                `• <code>Squid.Game.S02E01.720p.mkv</code>\n\n` +
                `✅ <b>Quick Best Practices:</b>\n` +
                `• Use dots (<code>.</code>) between words instead of ugly symbols.\n` +
                `• Always include the 4-digit release year for movies.\n` +
                `• Always use <code>S01E01</code> format for series episodes.\n` +
                `• Don't worry about special characters (<code>'</code>, <code>!</code>, <code>&</code>, <code>II</code>) — the bot handles them automatically!`;

            const keyboard = [
                [
                    { text: "📡 Scanner Guide", callback_data: "admin_help_scanner" },
                    { text: "🎬 Forwarding Guide", callback_data: "admin_help_stream" }
                ],
                [
                    { text: "« Back to Help Menu", callback_data: "admin_help" }
                ]
            ];

            return { text, keyboard, parse_mode: "HTML" };
        };

        const getHelpScannerPayload = () => {
            const text = 
                `📡 <b>Library Scanner & Auto-Ingest Guide</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `The scanner connects directly to your Stream Engine ledger and automatically assigns stream links to your catalogue cards.\n\n` +
                `⚡ <b>1. Ultra-Fast Quick Scan (Recommended for New Uploads):</b>\n` +
                `• Type <code>/scanquick</code>\n` +
                `• Scans your latest uploads in ~2 seconds, assigns streaming links, and pushes directly to GitHub & Web App!\n\n` +
                `📡 <b>2. Full Library Scan:</b>\n` +
                `• Type <code>/scanlibrary</code>\n` +
                `• The bot checks every file. Any file that is <b>already linked</b> is skipped in <b>0.001 ms</b>!\n\n` +
                `✨ <b>3. Auto-Ingest from TMDB:</b>\n` +
                `• Type <code>/autoingest</code>\n` +
                `• Any unmatched title is automatically queried on TMDB, generating posters, backdrops, and cards, and attaching streams 100% automatically!\n\n` +
                `🚀 <b>4. Manual Push to GitHub:</b>\n` +
                `• Type <code>/publishcatalog</code>\n` +
                `• Instantly pushes all in-memory and Firestore streaming links to GitHub main so GitHub Pages is 100% up to date.\n\n` +
                `🔄 <b>5. Forced Full Re-Scan:</b>\n` +
                `• Type <code>/scanlibrary force</code>\n\n` +
                `❌ <b>6. Instant Cancel:</b>\n` +
                `• Tap the red <b>[ ❌ Cancel Scan ]</b> button on the live progress message at any point to stop immediately.\n\n` +
                `📥 <b>7. Unmatched Report & 1-Click Ingest:</b>\n` +
                `• When scan completes, tap <b>[ ✨ Auto-Ingest Unmatched ]</b> or download the complete .txt file.`;

            const keyboard = [
                [
                    { text: "🌟 Golden Naming", callback_data: "admin_help_naming" },
                    { text: "🖥 VPS Commands", callback_data: "admin_help_vps" }
                ],
                [
                    { text: "« Back to Help Menu", callback_data: "admin_help" }
                ]
            ];

            return { text, keyboard, parse_mode: "HTML" };
        };

        const getHelpStreamPayload = () => {
            const text = 
                `🎬 <b>Media Forwarding & Batch Processing Guide</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `How to forward files to your Stream Bot (<b>@FilmHouseStreamer_bot</b>):\n\n` +
                `🎥 <b>Forwarding Movies:</b>\n` +
                `• Forward any single movie file $\rightarrow$ receives a direct stream link immediately.\n` +
                `• Forwarding 2 qualities (e.g. 1080p and 720p) of the same movie $\rightarrow$ groups them into a single <b>Multi-Quality Movie Card</b>!\n\n` +
                `📺 <b>Forwarding TV Series:</b>\n` +
                `• Select up to 60 episodes in Telegram and forward all at once.\n` +
                `• The bot buffers incoming files, automatically sorts them strictly <b>Ep 1 $\rightarrow$ Ep 60</b> in numerical order.\n` +
                `• It sends a single continuous message with all links formatted cleanly (Option A delivery with no file attachment).\n\n` +
                `❌ <b>How to Cancel Frozen Batches:</b>\n` +
                `• Send <code>/cancel</code> or tap the <b>[ ❌ Cancel Batch ]</b> inline button anytime to abort a batch!`;

            const keyboard = [
                [
                    { text: "📡 Scanner Guide", callback_data: "admin_help_scanner" },
                    { text: "🌟 Golden Naming", callback_data: "admin_help_naming" }
                ],
                [
                    { text: "« Back to Help Menu", callback_data: "admin_help" }
                ]
            ];

            return { text, keyboard, parse_mode: "HTML" };
        };

        const getHelpVpsPayload = () => {
            const text = 
                `🖥 <b>Server & VPS Management Guide</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Essential commands to run in your Ubuntu VPS terminal:\n\n` +
                `🔄 <b>1. 1-Click Update Both Bots:</b>\n` +
                `<code>cd /home/ubuntu/filmhouse && git fetch origin main && git reset --hard origin/main && pm2 restart all</code>\n\n` +
                `📊 <b>2. Check Live Running Status:</b>\n` +
                `<code>pm2 status</code>\n\n` +
                `📜 <b>3. View Real-Time Logs:</b>\n` +
                `• All logs: <code>pm2 logs</code>\n` +
                `• Stream Bot logs: <code>pm2 logs filmhouse-stream-bot</code>\n` +
                `• Catalog Bot logs: <code>pm2 logs filmhouse</code>\n\n` +
                `🔄 <b>4. Restarting Services:</b>\n` +
                `• <code>pm2 restart all</code>`;

            const keyboard = [
                [
                    { text: "📡 Scanner Guide", callback_data: "admin_help_scanner" },
                    { text: "« Back to Help Menu", callback_data: "admin_help" }
                ]
            ];

            return { text, keyboard, parse_mode: "HTML" };
        };

        // Command: /help - Admin tutorials and workflow guide
        adminBot.command('help', async (ctx) => {
            return renderOrEdit(ctx, getAdminHelpPayload());
        });

        // Command: /start and /menu
        
        // /setingest: Set current channel/chat as automated Ingest Vault (or pass channel ID in DM)
        adminBot.command('setingest', async (ctx) => {
            const senderId = String(ctx.from ? ctx.from.id : "");
            const authorized = await isAdmin(senderId);
            if (!authorized) return ctx.reply("⛔ Unauthorized.");
            const textParts = (ctx.message?.text || "").trim().split(/\s+/);
            const argId = textParts[1];
            const targetChatId = (argId && (argId.startsWith("-100") || argId.startsWith("@"))) ? argId.trim() : String(ctx.chat.id);
            dynamicIngestChannelId = targetChatId;
            try {
                await db.collection("system").doc("ingest_config").set({
                    channelId: targetChatId,
                    setBy: senderId,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                return ctx.reply(`✅ <b>Ingest Vault Configured!</b>\n\nChannel ID <code>${targetChatId}</code> is now your automated Ingest Channel. Whenever files are posted or dropped here, FilmHouse will automatically index, extract stream links, match TMDB, and send you confirmation cards!`, { parse_mode: "HTML" });
            } catch (err) {
                return ctx.reply(`❌ Error configuring ingest channel: ${err.message}`);
            }
        });

        // Channel post automated listener for Ingest Vault
        adminBot.on('channel_post', async (ctx, next) => {
            const handled = await handleAdminMediaForward(ctx, true);
            if (!handled && typeof next === 'function') return next();
        });

        // 1-Click Vault Setup Action from Channel Member Add
        adminBot.action(/^set_vault:(.+)$/, async (ctx) => {
            const chatId = ctx.match[1];
            dynamicIngestChannelId = chatId;
            try {
                await db.collection("system").doc("ingest_config").set({
                    channelId: chatId,
                    setBy: String(ctx.from?.id || ""),
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                await ctx.editMessageText(`✅ <b>Ingest Vault Configured!</b>\n\nThis channel is now your automated Ingest Channel. Whenever files are posted or dropped here, FilmHouse will automatically index, extract stream links, match TMDB, and send you confirmation cards!`, { parse_mode: "HTML" });
            } catch (err) {
                await ctx.reply(`❌ Error setting ingest channel: ${err.message}`);
            }
        });

        adminBot.on('my_chat_member', async (ctx) => {
            try {
                const member = ctx.myChatMember;
                if (!member) return;
                const newStatus = member.new_chat_member?.status;
                if (newStatus === 'administrator') {
                    const chatId = String(ctx.chat.id);
                    const chatTitle = ctx.chat.title || "Channel";
                    await ctx.reply(
                        `🤖 <b>Film House Bot Connected!</b>\n\n` +
                        `Would you like to set <b>${escapeHtml(chatTitle)}</b> as your <b>Automated Ingest Vault</b>? Every movie/series dropped here will be indexed automatically.`,
                        {
                            parse_mode: "HTML",
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: "📥 Set as Auto-Ingest Vault", callback_data: `set_vault:${chatId}` }
                                    ]
                                ]
                            }
                        }
                    );
                }
            } catch (e) {}
        });

        adminBot.command(['start', 'menu'], async (ctx) => {
            const adminName = ctx.from && ctx.from.first_name ? ctx.from.first_name : 'Admin';
            const adminId = ctx.from && ctx.from.id ? String(ctx.from.id) : '';
            await getPendingRequestsList();
            return renderOrEdit(ctx, getAdminMenuPayload(adminName, adminId));
        });

        // Command: /login - Generate 1-click magic desktop access link (Zero PIN / Zero password)
        adminBot.command(['login', 'auth', 'web'], async (ctx) => {
            const adminId = String(ctx.from && ctx.from.id ? ctx.from.id : '');
            const isAuth = await isMasterAdmin(adminId);
            if (!isAuth) {
                return ctx.reply("❌ Unauthorized: Only registered Master Administrators can generate login tokens.");
            }
            
            const expiry = Date.now() + (15 * 60 * 1000); // 15-minute token
            const rawToken = `${adminId}:${expiry}`;
            const tokenBase64 = Buffer.from(rawToken).toString('base64');
            const loginUrl = `https://dans123456.github.io/filmhouse/admin.html?auth_token=${tokenBase64}&tg_id=${adminId}`;
            
            return ctx.reply(
                `🔐 <b>One-Click Admin Login Link</b>\n\n` +
                `Click below to open the Film House Admin Console on your computer:\n\n` +
                `👉 <a href="${loginUrl}"><b>Open Admin Console on Desktop 🚀</b></a>\n\n` +
                `⏱️ <i>This private magic link expires in 15 minutes and requires no PIN or password.</i>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🖥️ Launch Admin Console", url: loginUrl }]
                        ]
                    }
                }
            );
        });

        // Command: /logs [category]
        adminBot.command('logs', async (ctx) => {
            const rawText = (ctx.message && ctx.message.text ? ctx.message.text : "").toLowerCase().trim();
            const parts = rawText.split(/\s+/);
            const arg = parts[1] || "";
            if (arg) {
                let cat = "server";
                if (arg.includes("admin") && arg.includes("bot")) cat = "admin_bot";
                else if (arg.includes("admin") && arg.includes("app")) cat = "admin_app";
                else if (arg.includes("user") && arg.includes("bot")) cat = "user_bot";
                else if (arg.includes("user") && arg.includes("app")) cat = "user_app";
                else if (arg.includes("err")) cat = "error";
                else if (arg.includes("server") || arg.includes("out")) cat = "server";
                return renderOrEdit(ctx, getLogsPayload(cat));
            }
            return renderOrEdit(ctx, getLogsCategoryMenuPayload());
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
            const generatingMsg = await ctx.reply("⏳ <b>Syncing latest catalog from GitHub & generating backup CSV...</b>", {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                }
            });
            try {
                await syncCatalogFromGitHub();
                await checkAndRunWeeklyBackup(adminBot, true, ctx.chat.id);
                return ctx.telegram.editMessageText(
                    ctx.chat.id,
                    generatingMsg.message_id,
                    undefined,
                    "✅ <b>Backup generation complete and sent to Master Admins above! (Synchronized with GitHub)</b>",
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                        }
                    }
                ).catch(() => {});
            } catch (err) {
                return ctx.reply(`❌ Backup failed: ${escapeHtml(err.message)}`, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            }
        });

        // Command: /sync_catalog (Manually trigger sync from GitHub to Ubuntu disk & memory)
        adminBot.command('sync_catalog', async (ctx) => {
            const waitMsg = await ctx.reply("⏳ <b>Synchronizing catalog with GitHub repository...</b>", { parse_mode: "HTML" });
            const result = await syncCatalogFromGitHub();
            if (result.success) {
                const statusTxt = result.updated
                    ? `✅ <b>Successfully synchronized!</b> Updated local disk and memory to <b>${result.count}</b> movies from GitHub main.`
                    : `✅ <b>Catalog already up to date!</b> Total movies in catalog: <b>${result.count}</b>.`;
                return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, statusTxt, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                }).catch(() => {});
            } else {
                return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `❌ <b>Sync failed:</b> ${escapeHtml(result.error || "Unknown error")}`, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                }).catch(() => {});
            }
        });

        adminBot.command(['update', 'upgrade', 'pull', 'restart'], async (ctx) => {
            const adminId = String(ctx.from?.id || "");
            const isAuth = await isMasterAdmin(adminId);
            if (!isAuth) return ctx.reply("⛔ Unauthorized. Master Admins only.", { parse_mode: 'HTML' });

            const statusMsg = await ctx.reply("🔄 <b>Checking for GitHub updates & reloading...</b>\nConnecting to repository on Ubuntu server...", { parse_mode: 'HTML' });

            const result = await performServerGitUpdate((stepText) => {
                ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    null,
                    `🔄 <b>Updating Ubuntu Server...</b>\n\n<i>${escapeHtml(stepText)}</i>`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            });

            if (!result.success) {
                return ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    null,
                    `❌ <b>Server Update Failed!</b>\n\n<code>${escapeHtml(result.error || result.output)}</code>`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }

            if (result.alreadyUpToDate) {
                return ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    null,
                    `✅ <b>Server is Up to Date & Reloaded!</b>\n\n<code>${escapeHtml(result.output)}</code>\n\n🚀 <b>PM2 bot process reloaded with zero downtime.</b>`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }

            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                `🎉 <b>Server Successfully Updated & Reloaded!</b>\n\n` +
                `<b>Git Commit:</b>\n<code>${escapeHtml(result.output.substring(0, 300))}</code>\n\n` +
                `🚀 <b>PM2 Bot instance reloaded seamlessly with zero downtime.</b>`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        });

        // Auto-publish movies_metadata.json to GitHub repository via GitHub REST API
        async function publishMetadataToGitHub(reason = "Auto-sync stream links from Library Scan [skip ci]") {
            if (!cachedMoviesMetadata || !Array.isArray(cachedMoviesMetadata) || cachedMoviesMetadata.length === 0) {
                console.warn("[GitHubPublish] No cached metadata to publish.");
                return { success: false, error: "Empty metadata" };
            }

            try {
                let token = process.env.GITHUB_TOKEN;
                if (!token && db) {
                    try {
                        const doc = await db.collection("settings").doc("github").get();
                        if (doc.exists && doc.data()?.token) {
                            token = doc.data().token;
                        }
                    } catch (err) {
                        console.warn("[GitHubPublish] Could not read token from Firestore:", err.message);
                    }
                }

                if (!token) {
                    console.warn("[GitHubPublish] No GitHub Personal Access Token found. Skipping auto-publish to GitHub.");
                    return { success: false, error: "No GitHub token configured" };
                }

                const owner = "dans123456";
                const repo = "filmhouse";
                const filePath = "MOVIE/Data/movies_metadata.json";
                const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

                const fetchModule = await import('node-fetch').catch(() => null);
                const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
                if (!fetchFn) {
                    return { success: false, error: "Fetch API not available" };
                }

                // 1. Fetch current file SHA
                const getRes = await fetchFn(`${apiUrl}?t=${Date.now()}`, {
                    headers: {
                        "Authorization": `token ${token}`,
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "FilmHouse-Bot"
                    }
                });

                if (!getRes.ok) {
                    const errBody = await getRes.text().catch(() => "");
                    console.warn(`[GitHubPublish] Failed to fetch current SHA (${getRes.status}):`, errBody);
                    return { success: false, error: `SHA fetch failed HTTP ${getRes.status}` };
                }

                const fileData = await getRes.json();
                const currentSha = fileData.sha;

                // 2. Prepare clean JSON payload
                const cleanPayload = cachedMoviesMetadata.map(m => {
                    const copy = { ...m };
                    delete copy._docId;
                    delete copy._ref;
                    return copy;
                });

                const jsonString = JSON.stringify(cleanPayload, null, 2);
                const base64Content = Buffer.from(jsonString, 'utf-8').toString('base64');

                // 3. PUT update to GitHub
                const putRes = await fetchFn(apiUrl, {
                    method: "PUT",
                    headers: {
                        "Authorization": `token ${token}`,
                        "Accept": "application/vnd.github.v3+json",
                        "Content-Type": "application/json",
                        "User-Agent": "FilmHouse-Bot"
                    },
                    body: JSON.stringify({
                        message: reason,
                        content: base64Content,
                        sha: currentSha,
                        branch: "main"
                    })
                });

                if (!putRes.ok) {
                    const putErr = await putRes.text().catch(() => "");
                    console.warn(`[GitHubPublish] Commit failed (${putRes.status}):`, putErr);
                    return { success: false, error: `Commit failed HTTP ${putRes.status}` };
                }

                const putResult = await putRes.json();
                console.log(`[GitHubPublish] Successfully published updated metadata to GitHub main! (Commit: ${putResult.commit?.sha?.substring(0, 7) || 'ok'})`);
                return { success: true, commitSha: putResult.commit?.sha };
            } catch (err) {
                console.error("[GitHubPublish] Unexpected error:", err.message);
                return { success: false, error: err.message };
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // /scanlibrary — Auto-scan Streamer Engine database & assign stream links
        // to matching movies/series in the catalogue. No manual work needed.
        // ─────────────────────────────────────────────────────────────────────────
        function generateSecureStreamToken(messageId, secretKey = "filmhouse_secure_streaming_key_8f92a10b7c3d4e5f6") {
            const crypto = require('crypto');
            const msgStr = String(messageId);
            const signature = crypto.createHmac('sha256', secretKey).update(msgStr).digest('hex').substring(0, 16);
            const rawPayload = `${msgStr}:${signature}`;
            return Buffer.from(rawPayload, 'utf-8').toString('base64url').replace(/=/g, '');
        }

        async function fetchStreamEngineMediaRecords() {
            // Source 1: Read local tracked_media.json from disk on the server
            const candidatePaths = [
                "/home/ubuntu/filmhouse-stream-bot/data/tracked_media.json",
                path.join(__dirname, "..", "filmhouse-stream-bot", "data", "tracked_media.json"),
                path.join(__dirname, "..", "filmhousestream", "data", "tracked_media.json"),
                path.join(__dirname, "data", "tracked_media.json")
            ];

            for (const p of candidatePaths) {
                try {
                    if (fs.existsSync(p)) {
                        const raw = fs.readFileSync(p, 'utf8');
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            console.log(`[ScanLibrary] Loaded ${parsed.length} items from ${p}`);
                            return { source: `local database (${path.basename(p)})`, items: parsed };
                        }
                    }
                } catch (_) {}
            }

            // Source 2: Query Stream Server API (/api/media) with Admin Key
            const apiEndpoints = [
                "http://127.0.0.1:8080/api/media",
                "https://filmhouse-stream.duckdns.org/api/media"
            ];

            for (const ep of apiEndpoints) {
                try {
                    const fetchModule = await import('node-fetch').catch(() => null);
                    const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
                    if (!fetchFn) continue;

                    const res = await fetchFn(ep, {
                        headers: {
                            "X-Admin-Key": "filmhouse_admin_2026_pass"
                        },
                        timeout: 10000
                    });
                    if (res.ok) {
                        const rawData = await res.json();
                        const itemsList = Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.items) ? rawData.items : []);
                        if (itemsList.length > 0) {
                            console.log(`[ScanLibrary] Loaded ${itemsList.length} items from API: ${ep}`);
                            return { source: `Stream API (${ep})`, items: itemsList };
                        }
                    }
                } catch (_) {}
            }

            return { source: 'none', items: [] };
        }

        const activeScanSessions = new Map();

        async function processBatchMediaItems(items, ctx, progressMsg, baseServer, sessionId, isForce = false, isAutoIngest = false) {
            let totalScanned = 0;
            let matched = 0;
            let newlyMatched = 0;
            let alreadyLinked = 0;
            let autoIngested = 0;
            let unmatched = 0;
            let skipped = 0;
            let wasCancelled = false;
            const unmatchedFiles = [];

            const scanSessionState = { cancelled: false };
            if (sessionId) activeScanSessions.set(sessionId, scanSessionState);

            const updateProgress = async (text) => {
                if (!ctx || !progressMsg) return;
                try {
                    await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, undefined, text, {
                        parse_mode: 'HTML',
                        reply_markup: sessionId ? {
                            inline_keyboard: [
                                [{ text: "❌ Cancel Scan", callback_data: `scan_cancel:${sessionId}` }]
                            ]
                        } : undefined
                    });
                } catch (_) {}
            };

            // Helper to clean & extract raw token from full stream URLs or raw tokens
            const extractToken = (str) => {
                if (!str) return "";
                const s = String(str).trim();
                if (s.includes("/dl/")) {
                    return s.split("/dl/")[1].split(/[?#&]/)[0].trim();
                }
                return s;
            };

            const recordAssignedUrl = (val) => {
                if (!val) return;
                const raw = String(val).trim();
                if (!raw) return;
                assignedUrls.add(raw);
                const tok = extractToken(raw);
                if (tok) assignedUrls.add(tok);
            };

            // Pre-compile already assigned stream URLs for instant O(1) lookups
            const assignedUrls = new Set();

            // 1. Prime from local disk cache first (contains all 2,200+ catalog titles)
            if (!isForce && cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                for (const m of cachedMoviesMetadata) {
                    if (m.stream_url) recordAssignedUrl(m.stream_url);
                    if (Array.isArray(m.stream_links)) {
                        m.stream_links.forEach(s => {
                            if (s && s.stream_url) recordAssignedUrl(s.stream_url);
                            if (s && s.url) recordAssignedUrl(s.url);
                        });
                    }
                    if (Array.isArray(m.links)) {
                        m.links.forEach(l => {
                            if (l && l.stream_url) recordAssignedUrl(l.stream_url);
                            if (l && l.url && (l.url.includes('/dl/') || l.url.includes('filmhouse-stream'))) {
                                recordAssignedUrl(l.url);
                            }
                        });
                    }
                }
            }

            // 2. Pre-fetch live catalogue from Firestore to MERGE live stream links without overwriting the 2,200+ catalog
            try {
                if (typeof db !== 'undefined' && db && typeof db.collection === 'function') {
                    const snap = await db.collection('movies').get();
                    if (!snap.empty) {
                        console.log(`[ScanLibrary] Merging ${snap.size} live catalogue documents from Firestore.`);
                        const fsMap = new Map();
                        snap.forEach(doc => {
                            const data = doc.data() || {};
                            fsMap.set(String(doc.id).toLowerCase(), { ...data, _docId: doc.id, _ref: doc.ref });

                            if (!isForce) {
                                if (data.stream_url) recordAssignedUrl(data.stream_url);
                                if (Array.isArray(data.stream_links)) {
                                    data.stream_links.forEach(s => {
                                        if (s && s.stream_url) recordAssignedUrl(s.stream_url);
                                        if (s && s.url) recordAssignedUrl(s.url);
                                    });
                                }
                                if (Array.isArray(data.links)) {
                                    data.links.forEach(l => {
                                        if (l && l.stream_url) recordAssignedUrl(l.stream_url);
                                        if (l && l.url && (l.url.includes('/dl/') || l.url.includes('filmhouse-stream'))) {
                                            recordAssignedUrl(l.url);
                                        }
                                    });
                                }
                            }
                        });

                        // Merge Firestore references and links into cachedMoviesMetadata
                        if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                            cachedMoviesMetadata.forEach(m => {
                                const docKey = String(m.csv_id || m.id || m.tmdb_id || "").toLowerCase();
                                const live = fsMap.get(docKey);
                                if (live) {
                                    m._docId = live._docId;
                                    m._ref = live._ref;
                                    if (live.stream_url) m.stream_url = live.stream_url;
                                    if (Array.isArray(live.stream_links)) m.stream_links = live.stream_links;
                                    if (Array.isArray(live.links)) m.links = live.links;
                                }
                            });
                        }
                    }
                }
            } catch (snapErr) {
                console.warn('[ScanLibrary] Could not pre-fetch movies collection:', snapErr.message);
            }

            // High-speed batch commit manager (batches of 100 docs max per write)
            const pendingBatches = new Map();

            const commitPendingBatch = async () => {
                if (pendingBatches.size === 0) return;
                try {
                    const batch = db.batch();
                    for (const [_, item] of pendingBatches) {
                        batch.set(item.ref, item.data, { merge: true });
                    }
                    await batch.commit();
                    console.log(`[ScanLibrary] Committed batch of ${pendingBatches.size} updates to Firestore.`);
                    pendingBatches.clear();
                } catch (bErr) {
                    console.warn('[ScanLibrary] Batch commit error, falling back to individual writes:', bErr.message);
                    for (const [_, item] of pendingBatches) {
                        try {
                            await item.ref.set(item.data, { merge: true });
                        } catch (_) {}
                    }
                    pendingBatches.clear();
                }
            };

            let lastProgressUpdate = Date.now();

            for (const item of items) {
                if (scanSessionState.cancelled) {
                    wasCancelled = true;
                    break;
                }
                if (!item) continue;
                totalScanned++;

                const rawFilename = item.file_name || item.filename || item.title || '';
                if (!rawFilename) { skipped++; continue; }

                let streamUrl = item.stream_url || item.url || '';
                if (!streamUrl && item.message_id) {
                    const token = generateSecureStreamToken(item.message_id);
                    streamUrl = `${baseServer}/dl/${token}`;
                }

                if (!streamUrl) {
                    unmatched++;
                    unmatchedFiles.push(rawFilename);
                    continue;
                }

                // ⚡ Instant skip if stream link or token is already assigned (finishes in 0.0001ms!)
                const itemToken = extractToken(streamUrl);
                if (!isForce && (assignedUrls.has(streamUrl) || (itemToken && assignedUrls.has(itemToken)))) {
                    alreadyLinked++;
                    matched++;
                    continue;
                }

                // Parse filename for clean title, year, season, episode, quality
                const parsed = parseMediaFilename(rawFilename);
                if (!parsed.cleanTitle) {
                    unmatched++;
                    unmatchedFiles.push(rawFilename);
                    continue;
                }

                // Match against in-memory catalog
                let catalogMatch = null;
                if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                    catalogMatch = cachedMoviesMetadata.find(m =>
                        m.title && titlesMatch(m.title, parsed.cleanTitle)
                    );
                    if (!catalogMatch && parsed.year) {
                        catalogMatch = cachedMoviesMetadata.find(m => {
                            if (!m.title) return false;
                            const titleOk = titlesMatch(m.title, parsed.cleanTitle);
                            const mYear = m.year ? String(m.year).substring(0, 4) : '';
                            const yearOk = mYear === String(parsed.year).substring(0, 4);
                            return titleOk || (yearOk && m.title.toLowerCase().includes(parsed.cleanTitle.toLowerCase().split(' ')[0]));
                        });
                    }
                }

                if (!catalogMatch) {
                    if (isAutoIngest && parsed.cleanTitle) {
                        try {
                            const tmdbData = await fetchTmdbMetadata(parsed.cleanTitle, parsed.year, parsed.isSeries);
                            if (tmdbData && tmdbData.tmdb_id) {
                                const slug = (tmdbData.title || parsed.cleanTitle).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                                const newCsvId = `${tmdbData.tmdb_id}-${slug}`;

                                const isAfrican = (tmdbData.origin_country && (tmdbData.origin_country.includes('NG') || tmdbData.origin_country.includes('GH') || tmdbData.origin_country.includes('ZA') || tmdbData.origin_country.includes('KE'))) ||
                                    ['yo', 'ig', 'ha', 'tw', 'ak'].includes(tmdbData.original_language) ||
                                    (tmdbData.overview && /(nollywood|ghana|nigeria|african)/i.test(tmdbData.overview));

                                const categories = ['Main'];
                                if (isAfrican) {
                                    categories.push('African');
                                } else if (parsed.isSeries || tmdbData.type === 'Series') {
                                    categories.push('Hollywood/British Series');
                                } else if (tmdbData.genres && tmdbData.genres.includes('Animation')) {
                                    categories.push('Animated Movies');
                                } else {
                                    categories.push('Hollywood/British Movies');
                                }

                                const newDocRef = (typeof db !== 'undefined' && db && typeof db.collection === 'function')
                                    ? db.collection('movies').doc(newCsvId)
                                    : null;

                                const newCard = {
                                    csv_id: newCsvId,
                                    tmdb_id: tmdbData.tmdb_id,
                                    imdb_id: "",
                                    title: tmdbData.title || parsed.cleanTitle,
                                    type: (parsed.isSeries || tmdbData.type === 'Series') ? "Series" : "Movie",
                                    categories: categories,
                                    genres: tmdbData.genres || [],
                                    overview: tmdbData.overview || "No overview available.",
                                    poster: tmdbData.poster || "",
                                    backdrop: tmdbData.backdrop || "",
                                    rating: tmdbData.rating || 0,
                                    release_date: tmdbData.release_date || (tmdbData.year ? `${tmdbData.year}-01-01` : ""),
                                    language: tmdbData.original_language || "en",
                                    cast: [],
                                    director: "",
                                    trailer: "",
                                    runtime: "",
                                    stream_url: streamUrl,
                                    stream_links: [],
                                    links: [],
                                    _docId: newCsvId,
                                    _ref: newDocRef
                                };

                                if (!Array.isArray(cachedMoviesMetadata)) cachedMoviesMetadata = [];
                                cachedMoviesMetadata.push(newCard);
                                catalogMatch = newCard;
                                autoIngested++;
                                console.log(`[Auto-Ingest] Created new card "${newCard.title}" (${newCard.csv_id})`);
                            }
                        } catch (tmdbErr) {
                            console.warn('[Auto-Ingest Error]:', tmdbErr.message);
                        }
                    }
                }

                if (!catalogMatch) {
                    unmatched++;
                    unmatchedFiles.push(`${rawFilename} (parsed: "${parsed.cleanTitle}")`);
                    continue;
                }

                // Build link slot entries (handles single episodes, multi-episodes, and strict movie types)
                const linkEntriesToProcess = [];
                const isCatalogMovie = catalogMatch && String(catalogMatch.type || '').toLowerCase() === 'movie';
                if (parsed.isSeries && parsed.episodeNum && !isCatalogMovie) {
                    const epLabel = parsed.endEpisodeNum ? `Episode ${parsed.episodeNum}–${parsed.endEpisodeNum}` : `Episode ${parsed.episodeNum}`;
                    linkEntriesToProcess.push({
                        season: parsed.seasonNum || 1,
                        seasonOrPart: parsed.seasonOrPart || `Season ${parsed.seasonNum || 1}`,
                        episode: parsed.episodeNum,
                        episodeNum: parsed.episodeNum,
                        quality: parsed.quality || '720p',
                        name: epLabel,
                        url: streamUrl,
                        stream_url: streamUrl
                    });
                    if (Array.isArray(parsed.extraEpisodes)) {
                        for (const extraEp of parsed.extraEpisodes) {
                            linkEntriesToProcess.push({
                                season: parsed.seasonNum || 1,
                                seasonOrPart: parsed.seasonOrPart || `Season ${parsed.seasonNum || 1}`,
                                episode: extraEp,
                                episodeNum: extraEp,
                                quality: parsed.quality || '720p',
                                name: `Episode ${extraEp} (${epLabel})`,
                                url: streamUrl,
                                stream_url: streamUrl
                            });
                        }
                    }
                } else {
                    linkEntriesToProcess.push({
                        quality: parsed.quality || '1080P',
                        url: streamUrl,
                        stream_url: streamUrl,
                        ...(parsed.seasonOrPart ? { season: parsed.seasonOrPart } : {})
                    });
                }

                const docId = catalogMatch._docId || catalogMatch.csv_id;
                let movieRef = catalogMatch._ref || null;
                if (!movieRef && docId && typeof db !== 'undefined' && db) {
                    movieRef = db.collection('movies').doc(String(docId));
                }

                if (!movieRef) {
                    unmatched++;
                    unmatchedFiles.push(rawFilename);
                    continue;
                }

                const currentLinks = Array.isArray(catalogMatch.links) ? [...catalogMatch.links] : [];
                const currentStreamLinks = Array.isArray(catalogMatch.stream_links) ? [...catalogMatch.stream_links] : [];

                for (const newLinkEntry of linkEntriesToProcess) {
                    let slotIdx = -1;
                    let streamSlotIdx = -1;
                    if (parsed.isSeries && newLinkEntry.episodeNum) {
                        slotIdx = currentLinks.findIndex(l =>
                            (l.season == (parsed.seasonNum || 1)) &&
                            (l.episode == newLinkEntry.episodeNum || l.episodeNum == newLinkEntry.episodeNum)
                        );
                        streamSlotIdx = currentStreamLinks.findIndex(s =>
                            (s.season == (parsed.seasonNum || 1)) &&
                            (s.episode == newLinkEntry.episodeNum || s.episodeNum == newLinkEntry.episodeNum)
                        );
                    } else {
                        slotIdx = currentLinks.findIndex(l =>
                            (l.quality || '').toUpperCase() === (parsed.quality || '1080P').toUpperCase() &&
                            (l.season || l.seasonOrPart || '') === (parsed.seasonOrPart || '')
                        );
                        streamSlotIdx = currentStreamLinks.findIndex(s =>
                            (s.quality || '').toUpperCase() === (parsed.quality || '1080P').toUpperCase() &&
                            (s.season || s.seasonOrPart || '') === (parsed.seasonOrPart || '')
                        );
                    }

                    // Keep Telegram download links and Stream links strictly segregated
                    const isTelegramLink = typeof streamUrl === "string" && (streamUrl.includes("t.me/") || streamUrl.includes("telegram.me/"));
                    if (isTelegramLink) {
                        if (slotIdx >= 0) {
                            currentLinks[slotIdx] = { ...currentLinks[slotIdx], ...newLinkEntry };
                        } else {
                            currentLinks.push(newLinkEntry);
                        }
                    }

                    if (!isTelegramLink) {
                        if (streamSlotIdx >= 0) {
                            currentStreamLinks[streamSlotIdx] = { ...currentStreamLinks[streamSlotIdx], ...newLinkEntry };
                        } else {
                            currentStreamLinks.push(newLinkEntry);
                        }
                    }
                }

                // Update catalogMatch in memory immediately
                catalogMatch.links = currentLinks;
                catalogMatch.stream_links = currentStreamLinks;
                catalogMatch.stream_url = streamUrl || catalogMatch.stream_url;

                // Queue batch update (merge full card properties so newly ingested titles are saved with full metadata)
                const batchPayload = {
                    ...catalogMatch,
                    links: currentLinks,
                    stream_links: currentStreamLinks,
                    stream_url: streamUrl || catalogMatch.stream_url,
                    updatedAt: new Date().toISOString()
                };
                delete batchPayload._docId;
                delete batchPayload._ref;

                pendingBatches.set(movieRef.path, {
                    ref: movieRef,
                    data: batchPayload
                });

                matched++;
                newlyMatched++;
                assignedUrls.add(streamUrl);

                if (pendingBatches.size >= 100) {
                    await commitPendingBatch();
                }

                // Rate-limited Telegram progress updates (at most once every 1.5 seconds)
                if (Date.now() - lastProgressUpdate > 1500 && (totalScanned % 20 === 0 || totalScanned === items.length)) {
                    lastProgressUpdate = Date.now();
                    await updateProgress(
                        `🔍 <b>Library Matching in Progress...</b>\n\n` +
                        `📂 Processed: <b>${totalScanned} / ${items.length}</b>\n` +
                        `⚡ Skipped (Already Linked): <b>${alreadyLinked}</b>\n` +
                        `✅ Newly Matched: <b>${newlyMatched}</b>\n` +
                        (autoIngested > 0 ? `✨ Auto-Ingested (TMDB): <b>${autoIngested}</b>\n` : '') +
                        `⚠️ Unmatched: <b>${unmatched}</b>\n\n` +
                        `<i>Batch saving to database...</i>`
                    );
                }
            }

            // Commit any remaining pending batches
            if (pendingBatches.size > 0) {
                await commitPendingBatch();
            }

            // Flush updated metadata to disk so Admin Panel, website, and local loaders immediately see the stream links
            try {
                if (cachedMoviesMetadata && localMetaPathGlobal) {
                    const cleanToFlush = cachedMoviesMetadata.map(m => {
                        const copy = { ...m };
                        delete copy._docId;
                        delete copy._ref;
                        return copy;
                    });
                    fs.writeFileSync(localMetaPathGlobal, JSON.stringify(cleanToFlush, null, 2), 'utf8');
                    console.log(`[ScanLibrary] Flushed ${cleanToFlush.length} movies with stream links to disk.`);
                }
            } catch (diskErr) {
                console.warn('[ScanLibrary] Could not flush to disk:', diskErr.message);
            }

            let githubPublished = false;
            // Auto-publish to GitHub if new stream links were matched or auto-ingested!
            if (newlyMatched > 0 || autoIngested > 0) {
                try {
                    console.log(`[ScanLibrary] Auto-publishing to GitHub (${newlyMatched} new stream links, ${autoIngested} auto-ingested)...`);
                    const pubRes = await publishMetadataToGitHub(`Auto-sync ${newlyMatched} stream links from Library Scan [skip ci]`);
                    if (pubRes && pubRes.success) {
                        githubPublished = true;
                        console.log('[ScanLibrary] GitHub auto-publish succeeded!');
                    } else {
                        console.warn('[ScanLibrary] GitHub auto-publish notice:', pubRes?.error);
                    }
                } catch (pubErr) {
                    console.warn('[ScanLibrary] Auto-publish error:', pubErr.message);
                }
            }

            return {
                totalScanned,
                matched,
                newlyMatched,
                alreadyLinked,
                autoIngested,
                unmatched,
                skipped,
                wasCancelled,
                unmatchedFiles,
                githubPublished
            };
        }

        const scanUnmatchedSessions = new Map();

        function buildUnmatchedReportPayload(sessionId, session, page = 0) {
            const pageSize = 15;
            const total = session.unmatchedFiles ? session.unmatchedFiles.length : 0;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const currentPage = Math.max(0, Math.min(page, totalPages - 1));

            const startIdx = currentPage * pageSize;
            const slice = (session.unmatchedFiles || []).slice(startIdx, startIdx + pageSize);
            const previewLines = slice.map(f => `• <code>${escapeHtml(f)}</code>`).join('\n');

            const text =
                (session.wasCancelled
                    ? `🛑 <b>Library Scan Cancelled by Admin!</b>\n`
                    : `📡 <b>Library Scan Complete!</b>\n`) +
                `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📂 Total Files Processed: <b>${session.totalScanned}</b>\n` +
                `⚡ Already Linked (Skipped): <b>${session.alreadyLinked || 0}</b>\n` +
                `✅ Newly Matched & Saved: <b>${session.newlyMatched || 0}</b>\n` +
                (session.autoIngested ? `✨ Auto-Ingested from TMDB: <b>${session.autoIngested}</b>\n` : '') +
                `⚠️ Unmatched: <b>${session.unmatched}</b>\n` +
                `⏭️ Skipped (Empty): <b>${session.skipped}</b>\n` +
                (session.githubPublished ? `🚀 <b>GitHub & Web App Synced:</b> ✅ Main Updated\n\n` : `\n`) +
                (total > 0
                    ? `📋 <b>Unmatched Files (Page ${currentPage + 1} of ${totalPages} • Items ${startIdx + 1}–${Math.min(startIdx + pageSize, total)}):</b>\n${previewLines}\n\n<i>Tap '✨ Auto-Ingest Unmatched' below to create missing cards from TMDB, or download the full list:</i>`
                    : `🎉 <b>All files matched and streaming links assigned successfully!</b>\n\n🍿 <i>Stream links are now live in FilmHouse cinema!</i>`);

            const navRow = [];
            if (currentPage > 0) {
                navRow.push({ text: "⬅️ Prev", callback_data: `scan_p:${sessionId}:${currentPage - 1}` });
            }
            if (totalPages > 1) {
                navRow.push({ text: `📄 ${currentPage + 1}/${totalPages}`, callback_data: `scan_noop` });
            }
            if (currentPage < totalPages - 1) {
                navRow.push({ text: "Next ➡️", callback_data: `scan_p:${sessionId}:${currentPage + 1}` });
            }

            const keyboard = [];
            if (navRow.length > 0) keyboard.push(navRow);
            if (total > 0) {
                keyboard.push([
                    { text: `✨ Auto-Ingest Unmatched (${total})`, callback_data: `scan_autoingest:${sessionId}` }
                ]);
                keyboard.push([
                    { text: `📥 Download All ${total} Unmatched (.txt)`, callback_data: `scan_f:${sessionId}` }
                ]);
            }

            return {
                text,
                reply_markup: { inline_keyboard: keyboard }
            };
        }

        adminBot.action(/^scan_cancel:(.+)$/, async (ctx) => {
            const sId = ctx.match[1];
            await ctx.answerCbQuery("Cancelling library scan...").catch(() => {});
            const sess = activeScanSessions.get(sId);
            if (sess) {
                sess.cancelled = true;
            }
            try {
                await ctx.editMessageText(
                    "⏳ <b>Cancelling Scan...</b>\n\nFinalizing remaining operations and generating report...",
                    { parse_mode: 'HTML' }
                );
            } catch (_) {}
        });

        adminBot.action(/^scan_p:([^:]+):(\d+)$/, async (ctx) => {
            const sessionId = ctx.match[1];
            const page = parseInt(ctx.match[2], 10) || 0;
            await ctx.answerCbQuery().catch(() => {});
            const session = scanUnmatchedSessions.get(sessionId);
            if (!session) return ctx.reply("⚠️ Scan session expired. Run /scanlibrary again.");
            const payload = buildUnmatchedReportPayload(sessionId, session, page);
            return ctx.editMessageText(payload.text, { parse_mode: 'HTML', reply_markup: payload.reply_markup }).catch(() => {});
        });

        adminBot.action(/^scan_f:(.+)$/, async (ctx) => {
            const sessionId = ctx.match[1];
            await ctx.answerCbQuery("Generating complete unmatched file list...").catch(() => {});
            const session = scanUnmatchedSessions.get(sessionId);
            if (!session || !session.unmatchedFiles || !session.unmatchedFiles.length) {
                return ctx.reply("⚠️ No unmatched files found or session expired.");
            }
            const fullText = session.unmatchedFiles.join('\n');
            return ctx.replyWithDocument({
                source: Buffer.from(fullText, 'utf8'),
                filename: `unmatched_files_${Date.now()}.txt`
            }, {
                caption: `📋 <b>All ${session.unmatchedFiles.length} Unmatched Files</b>\n\n<i>Add these titles to your catalogue or rename them, then run /scanlibrary again!</i>`,
                parse_mode: 'HTML'
            });
        });

        adminBot.action(/^scan_autoingest:(.+)$/, async (ctx) => {
            const sessionId = ctx.match[1];
            await ctx.answerCbQuery("Starting Auto-Ingest from TMDB...").catch(() => {});
            const session = scanUnmatchedSessions.get(sessionId);
            if (!session) return ctx.reply("⚠️ Scan session expired. Run /autoingest instead.");

            const progressMsg = await ctx.reply(
                "✨ <b>Auto-Ingesting Unmatched Titles from TMDB...</b>\n\n" +
                "📡 Reading library files, creating missing catalogue cards, and syncing streams...",
                { parse_mode: 'HTML' }
            );

            const baseServer = (typeof lastSyncedTunnelUrl === 'string' && lastSyncedTunnelUrl)
                || 'https://filmhouse-stream.duckdns.org';

            const { items } = await fetchStreamEngineMediaRecords();
            if (!items || items.length === 0) {
                return ctx.telegram.editMessageText(
                    ctx.chat.id,
                    progressMsg.message_id,
                    undefined,
                    "⚠️ Could not read stream engine ledger. Try /autoingest directly.",
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }

            const newSessionId = "auto_" + Date.now().toString(36);
            const result = await processBatchMediaItems(items, ctx, progressMsg, baseServer, newSessionId, false, true);
            scanUnmatchedSessions.set(newSessionId, result);

            const payload = buildUnmatchedReportPayload(newSessionId, result, 0);
            await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, undefined, payload.text, {
                parse_mode: 'HTML',
                reply_markup: payload.reply_markup
            }).catch(() => {});
        });

        adminBot.action("admin_trigger_scanquick", async (ctx) => {
            await ctx.answerCbQuery("Starting Quick Scan...").catch(() => {});
            return executeLibraryScanWorkflow(ctx, false, false, true);
        });

        adminBot.action("admin_trigger_scan", async (ctx) => {
            await ctx.answerCbQuery("Starting Library Scan...").catch(() => {});
            return executeLibraryScanWorkflow(ctx, false, false, false);
        });

        adminBot.action("admin_trigger_autoingest", async (ctx) => {
            await ctx.answerCbQuery("Starting Auto-Ingest...").catch(() => {});
            return executeLibraryScanWorkflow(ctx, false, true, false);
        });

        adminBot.action("admin_trigger_pushgithub", async (ctx) => {
            await ctx.answerCbQuery("Publishing catalog to GitHub...").catch(() => {});
            const waitMsg = await ctx.reply("⏳ <b>Publishing latest catalog and stream links to GitHub main...</b>", { parse_mode: 'HTML' });
            try {
                const pubRes = await publishMetadataToGitHub("Manual push catalog and stream links from Admin Bot");
                if (pubRes && pubRes.success) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        waitMsg.message_id,
                        undefined,
                        `✅ <b>Successfully Published to GitHub!</b>\n\n` +
                        `Commit: <code>${escapeHtml(pubRes.commitSha || 'success')}</code>\n` +
                        `🍿 <i>GitHub Pages and Web App are now updating with all stream links.</i>`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                } else {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        waitMsg.message_id,
                        undefined,
                        `⚠️ <b>GitHub Publish Notice:</b> ${escapeHtml(pubRes?.error || 'Unknown status')}`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                }
            } catch (err) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    waitMsg.message_id,
                    undefined,
                    `❌ <b>Error:</b> ${escapeHtml(err.message)}`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        });

        adminBot.action("scan_noop", async (ctx) => {
            await ctx.answerCbQuery().catch(() => {});
        });

        async function executeLibraryScanWorkflow(ctx, isForce = false, isAutoIngest = false, isQuick = false) {
            const senderId = String(ctx.from?.id || '');
            const isAuthorized = await isAdmin(senderId).catch(() => false);
            if (!isAuthorized) {
                return ctx.reply('⛔ <b>Unauthorized.</b> This command is for admins only.', { parse_mode: 'HTML' });
            }

            const headerTitle = isAutoIngest ? '✨ <b>Starting Auto-Ingest from TMDB...</b>' : '🔍 <b>Connecting to Stream Engine Database...</b>';
            const subTitle = isAutoIngest 
                ? '📡 Reading files, querying TMDB for missing cards, and syncing streams...' 
                : '📡 Reading indexed media files from local database & Stream API...';

            const progressMsg = await ctx.reply(
                `${headerTitle}\n\n${subTitle}`,
                { parse_mode: 'HTML' }
            );

            const baseServer = (typeof lastSyncedTunnelUrl === 'string' && lastSyncedTunnelUrl)
                || 'https://filmhouse-stream.duckdns.org';

            try {
                // Pre-sync freshest catalog from GitHub main so recently added titles are instantly in memory
                if (typeof syncCatalogFromGitHub === 'function') {
                    await syncCatalogFromGitHub().catch(e => console.warn('[ScanLibrary] Catalog pre-sync notice:', e.message));
                }

                const { source, items } = await fetchStreamEngineMediaRecords();

                if (!items || items.length === 0) {
                    return ctx.telegram.editMessageText(
                        ctx.chat.id,
                        progressMsg.message_id,
                        undefined,
                        '⚠️ <b>No Files Found in Stream Engine Database!</b>\n\n' +
                        'The Stream Bot hasn\'t written files to its local ledger yet.\n\n' +
                        '💡 <b>Alternative 1-Click Method:</b>\n' +
                        'You can send your stream links directly here!\n\n' +
                        '• Send a <b>.txt file</b> containing your links/filenames, OR\n' +
                        '• Type: <code>/importlinks &lt;paste lines&gt;</code>\n' +
                        '• Or forward the summary message from your Streamer Bot directly here!',
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                }

                // Order items newest first so recently uploaded media matches immediately!
                const sortedItems = [...items].sort((a, b) => {
                    const timeA = new Date(a.created_at || a.timestamp || 0).getTime() || (a.message_id ? Number(a.message_id) : 0);
                    const timeB = new Date(b.created_at || b.timestamp || 0).getTime() || (b.message_id ? Number(b.message_id) : 0);
                    if (timeA && timeB) return timeB - timeA;
                    return 0;
                });
                if (sortedItems.length > 1 && (!sortedItems[0].created_at && !sortedItems[0].message_id)) {
                    sortedItems.reverse();
                }

                const finalItems = isQuick ? sortedItems.slice(0, 50) : sortedItems;

                const sessionId = (isAutoIngest ? "ingest_" : "scan_") + Date.now().toString(36);
                const cancelMarkup = {
                    inline_keyboard: [
                        [{ text: "❌ Cancel Scan", callback_data: `scan_cancel:${sessionId}` }]
                    ]
                };

                const modeLabel = isQuick ? "⚡ <b>Quick Scan (Latest 50 Uploads)</b>" : "📡 <b>Full Library Scan</b>";
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    progressMsg.message_id,
                    undefined,
                    `${modeLabel}\n` +
                    `Found <b>${items.length}</b> total files from ${escapeHtml(source)} (processing <b>${finalItems.length}</b>).\n\n` +
                    `🔍 <i>${isAutoIngest ? 'Auto-ingesting missing cards & matching streams...' : 'Matching catalogue entries in real-time...'}</i>`,
                    { parse_mode: 'HTML', reply_markup: cancelMarkup }
                ).catch(() => {});

                const result = await processBatchMediaItems(finalItems, ctx, progressMsg, baseServer, sessionId, isForce, isAutoIngest);
                scanUnmatchedSessions.set(sessionId, result);
                setTimeout(() => scanUnmatchedSessions.delete(sessionId), 60 * 60 * 1000); // 1 hour memory

                const payload = buildUnmatchedReportPayload(sessionId, result, 0);
                await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, undefined, payload.text, {
                    parse_mode: 'HTML',
                    reply_markup: payload.reply_markup
                }).catch(() => {});
            } catch (err) {
                console.error('[Library Scan/Ingest Error]:', err);
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    progressMsg.message_id,
                    undefined,
                    `❌ <b>Operation Error:</b> ${escapeHtml(err.message)}`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        }

        adminBot.command(['scanquick', 'fastscan', 'quickscan'], async (ctx) => {
            const cmdText = String(ctx.message?.text || '').toLowerCase();
            const isForce = cmdText.includes('force');
            const isAutoIngest = cmdText.includes('auto') || cmdText.includes('ingest');
            return executeLibraryScanWorkflow(ctx, isForce, isAutoIngest, true);
        });

        adminBot.command('scanlibrary', async (ctx) => {
            const cmdText = String(ctx.message?.text || '').toLowerCase();
            const isForce = cmdText.includes('force') || cmdText.includes('all');
            const isAutoIngest = cmdText.includes('auto') || cmdText.includes('ingest');
            const isQuick = cmdText.includes('quick') || cmdText.includes('fast');
            return executeLibraryScanWorkflow(ctx, isForce, isAutoIngest, isQuick);
        });

        adminBot.command(['autoingest', 'ingestlibrary', 'autocatalog'], async (ctx) => {
            return executeLibraryScanWorkflow(ctx, false, true, false);
        });

        adminBot.command(['publishcatalog', 'pushcatalog', 'syncgithub'], async (ctx) => {
            const senderId = String(ctx.from?.id || '');
            const isAuthorized = await isAdmin(senderId).catch(() => false);
            if (!isAuthorized) return;

            const waitMsg = await ctx.reply("⏳ <b>Publishing latest catalog and stream links to GitHub main...</b>", { parse_mode: 'HTML' });
            try {
                const pubRes = await publishMetadataToGitHub("Manual push catalog and stream links from Admin Bot");
                if (pubRes && pubRes.success) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        waitMsg.message_id,
                        undefined,
                        `✅ <b>Successfully Published to GitHub!</b>\n\n` +
                        `Commit: <code>${escapeHtml(pubRes.commitSha || 'success')}</code>\n` +
                        `🍿 <i>GitHub Pages and Web App are now updating with all stream links.</i>`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                } else {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        waitMsg.message_id,
                        undefined,
                        `⚠️ <b>GitHub Publish Notice:</b> ${escapeHtml(pubRes?.error || 'Unknown status')}`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                }
            } catch (err) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    waitMsg.message_id,
                    undefined,
                    `❌ <b>Error:</b> ${escapeHtml(err.message)}`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        });

        // Command: /importlinks <paste or forward>
        adminBot.command(['importlinks', 'bulklinks', 'importstreams'], async (ctx) => {
            const senderId = String(ctx.from?.id || '');
            const isAuthorized = await isAdmin(senderId).catch(() => false);
            if (!isAuthorized) return;

            const text = (ctx.message?.text || '').replace(/^\/(importlinks|bulklinks|importstreams)(@\w+)?/i, '').trim();
            if (!text) {
                return ctx.reply(
                    '📋 <b>Usage:</b>\n' +
                    'Paste your links below the command, like:\n' +
                    '<code>/importlinks\n' +
                    'Gladiator.II.2024.1080p.mkv https://filmhouse-stream.duckdns.org/dl/...\n' +
                    'Severance.S02E05.1080p.mkv https://filmhouse-stream.duckdns.org/dl/...</code>\n\n' +
                    '<i>Or simply upload a .txt file containing the links!</i>',
                    { parse_mode: 'HTML' }
                );
            }

            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const items = lines.map(line => {
                const urlMatch = line.match(/https?:\/\/[^\s]+/i);
                const url = urlMatch ? urlMatch[0] : '';
                const filename = line.replace(url, '').replace(/[->:|]+/g, ' ').trim() || (url ? path.basename(url) : '');
                return { file_name: filename, stream_url: url };
            }).filter(it => it.file_name && it.stream_url);

            if (items.length === 0) {
                return ctx.reply('⚠️ Could not extract valid filename + stream URL pairs from your text.');
            }

            const sessionId = "import_" + Date.now().toString(36);
            const cancelMarkup = {
                inline_keyboard: [
                    [{ text: "❌ Cancel Import", callback_data: `scan_cancel:${sessionId}` }]
                ]
            };
            const waitMsg = await ctx.reply(`🔍 <b>Processing ${items.length} stream links...</b>`, { parse_mode: 'HTML', reply_markup: cancelMarkup });
            const baseServer = (typeof lastSyncedTunnelUrl === 'string' && lastSyncedTunnelUrl) || 'https://filmhouse-stream.duckdns.org';
            const result = await processBatchMediaItems(items, ctx, waitMsg, baseServer, sessionId, false);
            scanUnmatchedSessions.set(sessionId, result);
            setTimeout(() => scanUnmatchedSessions.delete(sessionId), 60 * 60 * 1000);
            const payload = buildUnmatchedReportPayload(sessionId, result, 0);
            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, payload.text, {
                parse_mode: 'HTML',
                reply_markup: payload.reply_markup
            }).catch(() => {});
        });

        // Document upload: Accept .txt files with links
        adminBot.on('document', async (ctx, next) => {
            const doc = ctx.message?.document;
            const filename = doc?.file_name || '';
            const senderId = String(ctx.from?.id || '');
            const isAuthorized = await isAdmin(senderId).catch(() => false);

            if (!isAuthorized || !filename.endsWith('.txt')) {
                return next ? next() : false;
            }

            try {
                const sessionId = "doc_" + Date.now().toString(36);
                const cancelMarkup = {
                    inline_keyboard: [
                        [{ text: "❌ Cancel Import", callback_data: `scan_cancel:${sessionId}` }]
                    ]
                };
                const waitMsg = await ctx.reply(`📄 <b>Reading ${escapeHtml(filename)}...</b>`, { parse_mode: 'HTML', reply_markup: cancelMarkup });
                const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                const fetchModule = await import('node-fetch').catch(() => null);
                const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
                if (!fetchFn) return ctx.reply('❌ Network fetch module unavailable.');

                const res = await fetchFn(fileLink.href);
                const textContent = await res.text();
                const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);
                const items = lines.map(line => {
                    const urlMatch = line.match(/https?:\/\/[^\s]+/i);
                    const url = urlMatch ? urlMatch[0] : '';
                    const name = line.replace(url, '').replace(/[->:|]+/g, ' ').trim();
                    return { file_name: name, stream_url: url };
                }).filter(it => it.file_name && it.stream_url);

                if (items.length === 0) {
                    return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '⚠️ No valid stream link + filename pairs found in this file.', { parse_mode: 'HTML' }).catch(() => {});
                }

                await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🔍 <b>Parsed ${items.length} items from ${escapeHtml(filename)}. Matching to catalogue...</b>`, { parse_mode: 'HTML', reply_markup: cancelMarkup }).catch(() => {});
                const baseServer = (typeof lastSyncedTunnelUrl === 'string' && lastSyncedTunnelUrl) || 'https://filmhouse-stream.duckdns.org';
                const result = await processBatchMediaItems(items, ctx, waitMsg, baseServer, sessionId, false);
                scanUnmatchedSessions.set(sessionId, result);
                setTimeout(() => scanUnmatchedSessions.delete(sessionId), 60 * 60 * 1000);
                const payload = buildUnmatchedReportPayload(sessionId, result, 0);
                await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, payload.text, {
                    parse_mode: 'HTML',
                    reply_markup: payload.reply_markup
                }).catch(() => {});
            } catch (docErr) {
                console.error('[Document Import Error]:', docErr);
                return ctx.reply(`❌ Failed to process text file: ${escapeHtml(docErr.message)}`, { parse_mode: 'HTML' });
            }
        });

        // Also register on main bot for convenience (admin-only guarded inside)
        bot.command(['scanquick', 'fastscan', 'quickscan', 'scanlibrary', 'autoingest', 'ingestlibrary', 'publishcatalog'], async (ctx) => {
            const senderId = String(ctx.from?.id || '');
            const isAuthorized = await isAdmin(senderId).catch(() => false);
            if (!isAuthorized) return;
            return ctx.reply(
                '📡 <b>Library Scanner, Quick Scan & Auto-Ingest</b> are best run from your Admin Bot.\n\nPlease send <code>/scanquick</code> or <code>/scanlibrary</code> to <b>@FilmHouseAdminBot</b> (your admin bot DM) to begin.',
                { parse_mode: 'HTML' }
            );
        });

        const pendingAdminPostActions = new Map();

        async function processAdminChannelPost(ctx, foundMovie, mode, adminId, adminName, isCallback = false) {
            try {
                const res = await publishMovieToChannel({
                    ...foundMovie,
                    broadcastMode: mode,
                    forceBroadcast: true
                });

                if (res && res.message_id) {
                    try {
                        if (adminId) {
                            const adminKey = adminId.replace(/[^a-zA-Z0-9_]/g, "_");
                            const statsRef = db.collection("settings").doc("admin_stats");
                            const statsDoc = await statsRef.get();
                            const currentStats = statsDoc.exists ? statsDoc.data() : {};
                            
                            const adm = currentStats[adminKey] || {
                                id: adminId,
                                name: adminName,
                                fulfillments: 0,
                                publications: 0,
                                titles: []
                            };
                            
                            adm.name = adminName;
                            adm.titles = adm.titles || [];
                            const cleanT = (foundMovie.title || "").trim();
                            const exists = adm.titles.some(t => t.title && t.title.toLowerCase() === cleanT.toLowerCase());
                            if (!exists) {
                                adm.titles.unshift({
                                    type: "publication",
                                    title: cleanT,
                                    date: new Date().toISOString()
                                });
                            }
                            if (adm.titles.length > 30) adm.titles = adm.titles.slice(0, 30);
                            
                            adm.publications = (adm.publications || 0) + 1;
                            const fCount = adm.titles.filter(t => t.type === "fulfillment" || !t.type).length;
                            const pCount = adm.titles.filter(t => t.type === "publication").length;
                            adm.fulfillments = Math.max(adm.fulfillments || 0, fCount);
                            adm.publications = Math.max(adm.publications || 0, pCount);
                            adm.lastActiveAt = Date.now();
                            
                            currentStats[adminKey] = adm;
                            await statsRef.set(currentStats, { merge: true });
                        }
                    } catch (statErr) {
                        console.warn("Could not record publication stat in /post:", statErr.message);
                    }

                    const modeLabel = mode === "updated" ? "UPDATED 🔄" : "RELEASED 🆕";
                    const replyText = `✅ <b>Published as ${modeLabel} to Updates Channel!</b>\n\n🎬 <b>Title:</b> ${escapeHtml(foundMovie.title)}\n🔗 <b>Message ID:</b> <code>${res.message_id}</code>\n📊 <i>Publication duty successfully credited to your Work Share!</i>`;
                    const replyMarkup = {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    };

                    if (isCallback) {
                        return ctx.editMessageText(replyText, { parse_mode: "HTML", reply_markup: replyMarkup }).catch(() => ctx.reply(replyText, { parse_mode: "HTML", reply_markup: replyMarkup }));
                    } else {
                        return ctx.reply(replyText, { parse_mode: "HTML", reply_markup: replyMarkup });
                    }
                } else {
                    const failText = `⚠️ <b>Notice:</b> Could not post to Updates Channel.\n\nPlease make sure <b>@Filmhouseappbot</b> is added to your channel as an <b>Administrator</b> with <b>Post Messages</b> permission enabled!`;
                    if (isCallback) {
                        return ctx.editMessageText(failText, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] } }).catch(() => {});
                    } else {
                        return ctx.reply(failText, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] } });
                    }
                }
            } catch (err) {
                const errText = `❌ <b>Failed to post:</b> ${escapeHtml(err.message)}`;
                if (isCallback) {
                    return ctx.editMessageText(errText, { parse_mode: "HTML" }).catch(() => {});
                } else {
                    return ctx.reply(errText, { parse_mode: "HTML" });
                }
            }
        }

        // Action handler for interactive post choice
        adminBot.action(/^bpost:(upd|rel|cnc):(.+)$/, async (ctx) => {
            const action = ctx.match[1];
            const postId = ctx.match[2];
            await ctx.answerCbQuery().catch(() => {});

            if (action === "cnc") {
                pendingAdminPostActions.delete(postId);
                return ctx.editMessageText("❌ <b>Post announcement cancelled.</b>", {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] }
                });
            }

            const item = pendingAdminPostActions.get(postId);
            if (!item || !item.movie) {
                return ctx.editMessageText("⚠️ <b>This post session has expired.</b> Please run <code>/post &lt;title&gt;</code> again.", {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] }
                });
            }

            pendingAdminPostActions.delete(postId);
            const mode = action === "upd" ? "updated" : "released";
            return processAdminChannelPost(ctx, item.movie, mode, item.adminId, item.adminName, true);
        });

        // Command: /post <Title> - Publish title announcement to Updates Channel
        adminBot.command('post', async (ctx) => {
            const raw = ctx.message && ctx.message.text ? ctx.message.text : "";
            const rawQuery = raw.replace(/^\/post(@\w+)?/i, '').trim();
            if (!rawQuery) {
                return ctx.reply("📢 <b>Usage:</b> <code>/post &lt;Movie or Series Title&gt;</code>\n\nOptions:\n• <code>/post Young Sheldon</code> (Prompts to choose Updated vs Released)\n• <code>/post update Family Matters</code> (Posts directly as Updated 🔄)\n• <code>/post release Dune 2</code> (Posts directly as Released 🆕)", {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            }

            let explicitMode = null;
            let query = rawQuery;

            if (/^(update|updated)\s+/i.test(rawQuery)) {
                explicitMode = "updated";
                query = rawQuery.replace(/^(update|updated)\s+/i, '').trim();
            } else if (/^(release|released|new)\s+/i.test(rawQuery)) {
                explicitMode = "released";
                query = rawQuery.replace(/^(release|released|new)\s+/i, '').trim();
            }

            await ctx.reply(`🔍 Searching for "${escapeHtml(query)}" to publish...`, { parse_mode: "HTML" });
            try {
                let foundMovie = null;
                const cleanQuery = query.toLowerCase().trim();

                // 1. Search in local in-memory catalog cache (fastest & most accurate)
                if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                    // Exact title match
                    foundMovie = cachedMoviesMetadata.find(m => String(m.title || "").toLowerCase().trim() === cleanQuery);
                    // Symbol/punctuation-insensitive match
                    if (!foundMovie) {
                        foundMovie = cachedMoviesMetadata.find(m => m.title && titlesMatch(m.title, query));
                    }
                    // Substring match
                    if (!foundMovie) {
                        foundMovie = cachedMoviesMetadata.find(m => m.title && String(m.title).toLowerCase().includes(cleanQuery));
                    }
                    // csv_id match
                    if (!foundMovie) {
                        foundMovie = cachedMoviesMetadata.find(m => String(m.csv_id || "").toLowerCase() === cleanQuery);
                    }
                }

                // 2. Fallback to Firestore movies collection if not found in memory
                if (!foundMovie) {
                    const qSnap = await db.collection("movies").where("title", "==", query).limit(1).get();
                    if (!qSnap.empty) {
                        foundMovie = qSnap.docs[0].data();
                    } else {
                        const allSnap = await db.collection("movies").limit(500).get();
                        for (const doc of allSnap.docs) {
                            const m = doc.data();
                            if (m.title && (titlesMatch(m.title, query) || String(m.title).toLowerCase().includes(cleanQuery))) {
                                foundMovie = m;
                                break;
                            }
                        }
                    }
                }

                // 3. Fallback to TMDB enrichment search if completely new title
                if (!foundMovie) {
                    try {
                        const searchRes = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
                        if (searchRes.ok) {
                            const searchData = await searchRes.json();
                            if (searchData.results && searchData.results.length > 0) {
                                const tmdb = searchData.results[0];
                                const isTv = tmdb.media_type === 'tv';
                                foundMovie = {
                                    title: tmdb.title || tmdb.name || query,
                                    type: isTv ? 'Series' : 'Movie',
                                    seasonOrPart: isTv ? 'Complete Series' : 'Full Movie',
                                    overview: tmdb.overview || '',
                                    rating: tmdb.vote_average ? Math.round(tmdb.vote_average * 10) / 10 : '',
                                    backdrop: tmdb.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}` : null,
                                    poster: tmdb.poster_path ? `https://image.tmdb.org/t/p/w1280${tmdb.poster_path}` : null,
                                    tmdb_id: tmdb.id
                                };
                            }
                        }
                    } catch (tmdbErr) {
                        console.warn("[/post TMDB enrich warning]:", tmdbErr.message);
                    }
                }

                if (!foundMovie) {
                    foundMovie = {
                        title: query,
                        type: "Movie",
                        seasonOrPart: "Full Movie",
                        poster: "https://dans123456.github.io/filmhouse/img/FilmHouse.png"
                    };
                }

                const adminId = ctx.from && ctx.from.id ? String(ctx.from.id) : "";
                const adminName = ctx.from ? (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || "Admin") : "Admin";

                if (explicitMode) {
                    return processAdminChannelPost(ctx, foundMovie, explicitMode, adminId, adminName, false);
                }

                // If not explicitly set via command prefix, offer interactive choice buttons
                const postId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6);
                pendingAdminPostActions.set(postId, {
                    movie: foundMovie,
                    adminId: adminId,
                    adminName: adminName
                });
                setTimeout(() => pendingAdminPostActions.delete(postId), 10 * 60 * 1000);

                const isTv = (foundMovie.type || "").toLowerCase() === 'series' || (foundMovie.type || "").toLowerCase() === 'tv';
                const editionTag = foundMovie.seasonOrPart || (isTv ? "All Seasons" : "HD Quality");

                return ctx.reply(
                    `🎬 <b>Found:</b> <b>${escapeHtml(foundMovie.title || query)}</b>\n` +
                    `🏷️ <b>Category:</b> ${isTv ? 'Series 📺' : 'Movie 🎬'} | 📌 <b>Format:</b> ${escapeHtml(editionTag)}\n\n` +
                    `📢 <b>How would you like to post this announcement?</b>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: isTv ? "🔄 Post as NEW SEASON UPDATED" : "🔄 Post as MOVIE UPDATED", callback_data: `bpost:upd:${postId}` }
                                ],
                                [
                                    { text: isTv ? "🆕 Post as NEW SERIES RELEASED" : "🆕 Post as NEW MOVIE RELEASED", callback_data: `bpost:rel:${postId}` }
                                ],
                                [
                                    { text: "❌ Cancel", callback_data: `bpost:cnc:${postId}` }
                                ]
                            ]
                        }
                    }
                );
            } catch (err) {
                console.error("Error in /post command:", err);
                return ctx.reply(`❌ <b>Failed to search/post:</b> ${escapeHtml(err.message)}`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] }
                });
            }
        });

        // Command: /topadmins or /adminstats - View Work Share percentage leaderboard
        adminBot.command(['topadmins', 'adminstats'], async (ctx) => {
            try {
                const statsDoc = await db.collection("settings").doc("admin_stats").get();
                if (!statsDoc.exists) {
                    return ctx.reply("📊 <b>No admin performance statistics recorded yet.</b>", {
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] }
                    });
                }
                const stats = statsDoc.data() || {};
                const entries = Object.values(stats).filter(s => s && (typeof s.count === 'number' || typeof s.fulfillments === 'number' || typeof s.publications === 'number') && (s.name || '').toLowerCase() !== 'admin');
                if (entries.length === 0) {
                    return ctx.reply("📊 <b>No admin performance statistics recorded yet.</b>", {
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] }
                    });
                }

                entries.forEach(e => {
                    const f = e.fulfillments || e.count || 0;
                    const p = e.publications || 0;
                    e.totalWork = f + p;
                    e.fulfillments = f;
                    e.publications = p;
                });

                const totalTeamWork = entries.reduce((acc, e) => acc + e.totalWork, 0);

                entries.forEach(e => {
                    e.workShare = totalTeamWork > 0 ? Math.round((e.totalWork / totalTeamWork) * 100) : 0;
                });

                entries.sort((a, b) => b.totalWork - a.totalWork);

                let text = "🏆 <b>Film House Admin Work Share Leaderboard</b> 🏆\n\n<i>Relative workload share (% of total team tasks):</i>\n\n";
                const medals = ["🥇", "🥈", "🥉"];
                entries.forEach((e, idx) => {
                    const medal = medals[idx] || `<b>#${idx + 1}</b>`;
                    text += `${medal} <b>${escapeHtml(e.name || 'Admin')}</b>: <b>${e.workShare}% Work Share</b>\n`;
                    text += `   • 📥 <code>${e.fulfillments}</code> Fulfilled | 🎬 <code>${e.publications}</code> Published (${e.totalWork} tasks)\n\n`;
                });
                text += `📊 <i>Work share reflects team duty contributions and request fulfillments combined!</i>`;
                return ctx.reply(text, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]] }
                });
            } catch (err) {
                return ctx.reply(`❌ Error fetching admin stats: ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
            }
        });

        // Action Handlers for Inline Navigation Buttons (All edit seamlessly in-place)
        adminBot.action('admin_menu', async (ctx) => {
            const adminName = ctx.from && ctx.from.first_name ? ctx.from.first_name : 'Admin';
            const adminId = ctx.from && ctx.from.id ? String(ctx.from.id) : '';
            return renderOrEdit(ctx, getAdminMenuPayload(adminName, adminId));
        });

        adminBot.action('admin_help', async (ctx) => {
            return renderOrEdit(ctx, getAdminHelpPayload());
        });

        adminBot.action('admin_help_naming', async (ctx) => {
            return renderOrEdit(ctx, getHelpNamingPayload());
        });

        adminBot.action('admin_help_scanner', async (ctx) => {
            return renderOrEdit(ctx, getHelpScannerPayload());
        });

        adminBot.action('admin_help_stream', async (ctx) => {
            return renderOrEdit(ctx, getHelpStreamPayload());
        });

        adminBot.action('admin_help_vps', async (ctx) => {
            return renderOrEdit(ctx, getHelpVpsPayload());
        });

        adminBot.action(['admin_logs', 'admin_logs_menu'], async (ctx) => {
            return renderOrEdit(ctx, getLogsCategoryMenuPayload());
        });

        adminBot.action(/^admin_log_cat_([a-z_]+)$/, async (ctx) => {
            const cat = ctx.match[1] || "server";
            return renderOrEdit(ctx, getLogsPayload(cat));
        });

        adminBot.action('admin_logs_out', async (ctx) => {
            return renderOrEdit(ctx, getLogsPayload("server"));
        });

        adminBot.action('admin_logs_error', async (ctx) => {
            return renderOrEdit(ctx, getLogsPayload("error"));
        });

        adminBot.action('admin_pending', async (ctx) => {
            const list = await getPendingRequestsList();
            return renderOrEdit(ctx, getPendingRequestsPayload(list, 0));
        });

        adminBot.action(/^admin_req_page_(\d+)$/, async (ctx) => {
            const page = parseInt(ctx.match[1], 10) || 0;
            const list = await getPendingRequestsList();
            return renderOrEdit(ctx, getPendingRequestsPayload(list, page));
        });

        adminBot.action('admin_stats', async (ctx) => {
            return renderOrEdit(ctx, getStatsPayload());
        });

        adminBot.action('admin_backup', async (ctx) => {
            try {
                await ctx.editMessageText("⏳ <b>Generating catalog backup CSV and sending document...</b>", {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            } catch (e) {}

            try {
                await checkAndRunWeeklyBackup(adminBot, true, ctx.chat.id);
                return await ctx.editMessageText("✅ <b>Catalog backup generated and sent below!</b>", {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "« Back to Menu", callback_data: "admin_menu" }]]
                    }
                });
            } catch (err) {
                return await ctx.editMessageText(`❌ <b>Backup failed:</b> ${escapeHtml(err.message)}`, {
                    parse_mode: "HTML",
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
        try {
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

        // Check for download deep-link payload (start=dl_movieId or start=movie_movieId)
        if (payload && (payload.startsWith("dl_") || payload.startsWith("movie_"))) {
            const movieId = payload.replace(/^(dl_|movie_)/, "").trim();
            try {
                let movieData = null;

                // 1. Fast in-memory cache from pre-loaded movies_metadata.json (instant <1ms response)
                if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                    const idLower = movieId.toLowerCase();
                    const numericId = parseInt(idLower.split("-")[0]);
                    movieData = cachedMoviesMetadata.find(m => 
                        (m.csv_id && String(m.csv_id).toLowerCase() === idLower) ||
                        (String(m.tmdb_id) === String(movieId)) ||
                        (!isNaN(numericId) && m.tmdb_id && parseInt(m.tmdb_id) === numericId)
                    );
                }

                // 2. Safe fallback to Firestore movies collection if not found locally
                if (!movieData) {
                    try {
                        const movieDoc = await Promise.race([
                            db.collection("movies").doc(movieId).get(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1000))
                        ]);
                        if (movieDoc && movieDoc.exists) {
                            movieData = movieDoc.data();
                        } else {
                            const numericId = parseInt(movieId.split("-")[0]);
                            if (!isNaN(numericId)) {
                                const snap = await Promise.race([
                                    db.collection("movies").where("tmdb_id", "==", numericId).limit(1).get(),
                                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1000))
                                ]);
                                if (snap && !snap.empty) movieData = snap.docs[0].data();
                            }
                        }
                    } catch (fsErr) {
                        console.warn("[DL CARD] Firestore lookup skipped/quota exceeded:", fsErr.message);
                    }
                }

                // 3. Fallback to direct TMDB API lookup if not in Firestore/memory (0 Firestore reads, instant delivery)
                if (!movieData) {
                    try {
                        const fetchModule = await import('node-fetch').catch(() => null);
                        const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
                        if (fetchFn) {
                            const tmdbApiKey = process.env.TMDB_API_KEY || "d638f7775bfa1b8d456dfd028ccbef19";
                            const numericId = parseInt(movieId.split("-")[0]);
                            let tmdbObj = null;
                            let isTv = false;

                            if (!isNaN(numericId) && numericId > 0) {
                                const tvRes = await fetchFn(`https://api.themoviedb.org/3/tv/${numericId}?api_key=${tmdbApiKey}`);
                                if (tvRes.ok) {
                                    tmdbObj = await tvRes.json();
                                    isTv = true;
                                } else {
                                    const movRes = await fetchFn(`https://api.themoviedb.org/3/movie/${numericId}?api_key=${tmdbApiKey}`);
                                    if (movRes.ok) {
                                        tmdbObj = await movRes.json();
                                        isTv = false;
                                    }
                                }
                            }

                            if (tmdbObj) {
                                movieData = {
                                    csv_id: movieId,
                                    tmdb_id: tmdbObj.id,
                                    title: tmdbObj.name || tmdbObj.title || "Movie",
                                    type: isTv ? "Series" : "Movie",
                                    overview: tmdbObj.overview || "",
                                    genres: (tmdbObj.genres || []).map(g => (g && g.name) ? g.name : g),
                                    rating: tmdbObj.vote_average ? Math.round(tmdbObj.vote_average * 10) / 10 : 0,
                                    release_date: tmdbObj.first_air_date || tmdbObj.release_date || "",
                                    year: (tmdbObj.first_air_date || tmdbObj.release_date || "").substring(0, 4),
                                    poster: tmdbObj.poster_path ? `https://image.tmdb.org/t/p/w1280${tmdbObj.poster_path}` : null,
                                    backdrop: tmdbObj.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdbObj.backdrop_path}` : null
                                };
                            }
                        }
                    } catch (tmdbErr) {
                        console.warn("[DL CARD] TMDB direct fallback error:", tmdbErr.message);
                    }
                }

                if (movieData) {
                    const isSeries = (movieData.type || "").toLowerCase() === "series" || (movieData.type || "").toLowerCase() === "tv";
                    const cleanTitle = (movieData.title || "Movie").replace(/\s*\([^)]+\)\s*$/g, "").trim();
                    const yearText = movieData.release_date ? ` (${movieData.release_date.substring(0, 4)})` : (movieData.year ? ` (${movieData.year})` : "");
                    const rawGenres = Array.isArray(movieData.categories) ? movieData.categories : (Array.isArray(movieData.genres) ? movieData.genres : []);
                    const genresText = rawGenres.filter(g => g && g !== "Main").slice(0, 3).join(", ");
                    const ratingVal = movieData.rating || movieData.vote_average || "";
                    const ratingText = ratingVal ? (String(ratingVal).includes("/") ? ratingVal : `${ratingVal}/10`) : "";

                    let metaLine = "";
                    if (genresText && ratingText) {
                        metaLine = `🎭 <b>Genre:</b> ${escapeHtml(genresText)} | ⭐️ <b>Rating:</b> ${escapeHtml(ratingText)}\n`;
                    } else if (genresText) {
                        metaLine = `🎭 <b>Genre:</b> ${escapeHtml(genresText)}\n`;
                    } else if (ratingText) {
                        metaLine = `⭐️ <b>Rating:</b> ${escapeHtml(ratingText)}\n`;
                    }

                    let overviewText = "";
                    if (movieData.overview && typeof movieData.overview === 'string' && movieData.overview.toLowerCase() !== "no synopsis available.") {
                        const cleanO = movieData.overview.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
                        if (cleanO.length > 200) {
                            overviewText = cleanO.substring(0, 197) + "...";
                        } else {
                            overviewText = cleanO;
                        }
                    }

                    let overviewLine = "";
                    if (overviewText) {
                        overviewLine = `\n💬 <i>${escapeHtml(overviewText)}</i>\n`;
                    }

                    const deepAppUrl = `https://dans123456.github.io/filmhouse/index.html?startapp=movie_${movieData.csv_id || movieData.tmdb_id || movieId}`;

                    const cardCaption = 
                        `🎬 <b>${escapeHtml(cleanTitle)}</b>${escapeHtml(yearText)}\n` +
                        `📦 <b>Type:</b> ${isSeries ? "TV Series" : "Full Movie"}\n` +
                        metaLine +
                        overviewLine +
                        `\n<blockquote>⏳ <b>Auto-Delete Notice:</b>\n` +
                        `This message will self-destruct in <b>5 minutes</b> to protect server links. Please download or save now!</blockquote>`;

                    // Single primary button only
                    const inlineButtons = [
                        [
                            {
                                text: "🎬 Open in Film House App 🚀",
                                web_app: { url: deepAppUrl }
                            }
                        ]
                    ];

                    let cardImage = (movieData.backdrop && String(movieData.backdrop).startsWith("http"))
                        ? movieData.backdrop
                        : ((movieData.poster && String(movieData.poster).startsWith("http")) ? movieData.poster : "https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png");

                    if (cardImage.includes("image.tmdb.org/t/p/w500") || cardImage.includes("image.tmdb.org/t/p/w300") || cardImage.includes("image.tmdb.org/t/p/w780")) {
                        cardImage = cardImage.replace(/\/w(300|500|780)\//, "/w1280/");
                    }

                    let sentMsg = null;
                    try {
                        // Attempt direct URL send first for instant sub-second delivery
                        sentMsg = await ctx.replyWithPhoto(cardImage, {
                            caption: cardCaption,
                            parse_mode: "HTML",
                            reply_markup: { inline_keyboard: inlineButtons }
                        });
                    } catch (urlSendErr) {
                        // If direct URL fails, buffer fetch and retry
                        try {
                            const fetchModule = await import('node-fetch').catch(() => null);
                            const fetchFn = (typeof fetch === 'function') ? fetch : (fetchModule ? fetchModule.default : null);
                            if (fetchFn) {
                                const imgRes = await fetchFn(cardImage);
                                if (imgRes.ok) {
                                    const arrBuf = await imgRes.arrayBuffer();
                                    sentMsg = await ctx.replyWithPhoto({ source: Buffer.from(arrBuf) }, {
                                        caption: cardCaption,
                                        parse_mode: "HTML",
                                        reply_markup: { inline_keyboard: inlineButtons }
                                    });
                                }
                            }
                        } catch (bufErr) {
                            console.warn(`[DL CARD] Buffer photo send failed (${bufErr.message}), falling back to text message...`);
                        }
                        if (!sentMsg) {
                            sentMsg = await ctx.reply(cardCaption, {
                                parse_mode: "HTML",
                                reply_markup: { inline_keyboard: inlineButtons },
                                disable_web_page_preview: true
                            });
                        }
                    }

                    if (sentMsg && sentMsg.message_id) {
                        const targetChatId = ctx.chat.id;
                        const targetMsgId = sentMsg.message_id;
                        console.log(`[DL CARD] Scheduled auto-delete for message ${targetMsgId} in chat ${targetChatId} in 5 minutes.`);
                        setTimeout(async () => {
                            try {
                                await ctx.telegram.deleteMessage(targetChatId, targetMsgId);
                                console.log(`[DL CARD] Auto-deleted temporary download card ${targetMsgId} in chat ${targetChatId} after 5 minutes.`);
                            } catch (delErr) {
                                console.warn(`[DL CARD] Could not auto-delete message ${targetMsgId}:`, delErr.message);
                            }
                        }, 5 * 60 * 1000);
                    }
                    return;
                }
            } catch (dlErr) {
                console.error("Error processing download start payload:", dlErr);
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
            try {
                return await ctx.reply(caption, {
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                });
            } catch (textHtmlErr) {
                console.warn("HTML caption reply failed, falling back to plain text:", textHtmlErr.message);
                const plainCaption = caption.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
                return await ctx.reply(plainCaption, {
                    reply_markup: replyMarkup
                }).catch(finalErr => console.error("Final fallback text reply failed:", finalErr.message));
            }
        }
    } catch (fatalStartErr) {
            console.error("[Fatal /start Error] Caught unhandled exception in /start handler:", fatalStartErr);
            try {
                await ctx.reply("🍿 Welcome to Film House! Tap below to open the app:", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Launch Film House 🚀", url: "https://t.me/Filmhouseappbot/filmhouseapp" }]
                        ]
                    }
                });
            } catch (fallbackSendErr) {
                console.error("Critical fallback reply failed:", fallbackSendErr.message);
            }
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
        const safeUsername = escapeMarkdown(usernameDisplay);

        try {
            return await ctx.reply(
                `👤 *Your Profile Status*\n\n` +
                `• *Telegram ID:* \`${userId}\`\n` +
                `• *Username:* ${safeUsername}\n` +
                `• *Loyalty Points:* 🪙 \`${points.toLocaleString()}\` pts\n` +
                `• *VIP Badge:* 🏆 \`${badge}\``,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup,
                    reply_to_message_id: ctx.message.message_id
                }
            );
        } catch (settingsErr) {
            return await ctx.reply(
                `👤 Your Profile Status\n\n` +
                `• Telegram ID: ${userId}\n` +
                `• Username: ${usernameDisplay}\n` +
                `• Loyalty Points: 🪙 ${points.toLocaleString()} pts\n` +
                `• VIP Badge: 🏆 ${badge}`,
                { 
                    reply_markup: replyMarkup,
                    reply_to_message_id: ctx.message.message_id
                }
            );
        }
    });

    // Command: /ping
    bot.command('ping', (ctx) => {
        return ctx.reply("🏓 Pong! I am online and running.", {
            reply_to_message_id: ctx.message.message_id
        });
    });

    // Command: /login - Generate 1-click magic desktop access link
    bot.command(['login', 'adminlogin'], async (ctx) => {
        const adminId = String(ctx.from?.id || "");
        const isAuth = await isMasterAdmin(adminId);
        if (!isAuth) return; // Silently ignore for regular non-admin users
        
        const expiry = Date.now() + (15 * 60 * 1000); // 15-minute token
        const rawToken = `${adminId}:${expiry}`;
        const tokenBase64 = Buffer.from(rawToken).toString('base64');
        const loginUrl = `https://dans123456.github.io/filmhouse/admin.html?auth_token=${tokenBase64}&tg_id=${adminId}`;
        
        return ctx.reply(
            `🔐 <b>One-Click Admin Login Link</b>\n\n` +
            `Click below to open the Film House Admin Console on your computer:\n\n` +
            `👉 <a href="${loginUrl}"><b>Open Admin Console on Desktop 🚀</b></a>\n\n` +
            `⏱️ <i>This private magic link expires in 15 minutes and requires no PIN or password.</i>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🖥️ Launch Admin Console", url: loginUrl }]
                    ]
                }
            }
        );
    });

    // Command: /update & /upgrade - Remote 1-Click Server Bot & Catalog Safe Updater
    bot.command(['update', 'upgrade', 'pull'], async (ctx) => {
        const adminId = String(ctx.from?.id || "");
        const isAuth = await isMasterAdmin(adminId);
        if (!isAuth) return; // Silently ignore for regular non-admin users

        const statusMsg = await ctx.reply("🔄 <b>Checking for GitHub updates...</b>\nConnecting to repository on Ubuntu server...", { parse_mode: 'HTML' });

        const result = await performServerGitUpdate((stepText) => {
            ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                `🔄 <b>Updating Ubuntu Server...</b>\n\n<i>${escapeHtml(stepText)}</i>`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        });

        if (!result.success) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                `❌ <b>Server Update Failed!</b>\n\n<code>${escapeHtml(result.error || result.output)}</code>`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }

        if (result.alreadyUpToDate) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                `✅ <b>Server is Already Up to Date!</b>\n\n<code>${escapeHtml(result.output)}</code>\n\n🚀 Running latest build with 0 syntax errors.`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }

        return ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `🎉 <b>Update Successfully Applied!</b>\n\n<code>${escapeHtml(result.output)}</code>\n\n⚡ PM2 zero-downtime reload initiated.`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    });


    // Command: /pending & /requests (Admin pending queue lookup on user bot)
    bot.command(['pending', 'requests'], async (ctx) => {
        const userId = String(ctx.from?.id);
        const adminIds = await getAllAdminIds();
        if (!adminIds.includes(userId)) {
            return ctx.reply("ℹ️ To request a movie or check your personal requests, please open the Film House App!", {
                reply_markup: {
                    inline_keyboard: [[{ text: "🎬 Open Film House App", web_app: { url: "https://dans123456.github.io/filmhouse/" } }]]
                }
            });
        }
        const list = await getPendingRequestsList();
        return renderOrEdit(ctx, getPendingRequestsPayload(list, 0));
    });

    bot.action(/^admin_req_page_(\d+)$/, async (ctx) => {
        const userId = String(ctx.from?.id);
        const adminIds = await getAllAdminIds();
        if (!adminIds.includes(userId)) return;
        const page = parseInt(ctx.match[1], 10) || 0;
        const list = await getPendingRequestsList();
        return renderOrEdit(ctx, getPendingRequestsPayload(list, page));
    });

    // Command: /broadcast (Seamless In-Place Single-Message Editing)
    const handleSeamlessBroadcast = async (ctx) => {
        const userId = String(ctx.from.id);
        if (!(await isMasterAdmin(userId))) {
            return ctx.reply("❌ Unauthorized. This command is restricted to Master Administrators.");
        }

        const replyTo = ctx.message.reply_to_message;
        const textParam = ctx.message.text ? ctx.message.text.replace(/^\/broadcast(@\w+)?/i, "").trim() : "";
        
        if (!replyTo && !textParam) {
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

        // Send a SINGLE status message that will be edited in-place
        let statusMsg = await ctx.reply("✈️ *Initializing broadcast...*", { 
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        }).catch(() => null);

        if (!statusMsg) {
            return ctx.reply("❌ Could not initiate broadcast status message.");
        }

        const statusChatId = ctx.chat.id;
        const statusMsgId = statusMsg.message_id;

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

        const totalSubs = subscribers.length;
        if (totalSubs === 0) {
            return ctx.telegram.editMessageText(
                statusChatId,
                statusMsgId,
                null,
                "⚠️ *No subscribers found in database to broadcast to.*",
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }

        const startTime = Date.now();
        let successCount = 0;
        let failedCount = 0;
        let lastEditTime = Date.now();

        // Helper to generate a visual progress bar
        const getProgressBar = (current, total) => {
            const barLength = 10;
            const filled = Math.min(barLength, Math.round((current / total) * barLength));
            return '█'.repeat(filled) + '░'.repeat(barLength - filled);
        };

        // Initial edit
        await ctx.telegram.editMessageText(
            statusChatId,
            statusMsgId,
            null,
            `✈️ *Broadcasting Announcement...* 📢\n\n` +
            `⏳ *Progress:* \`0%\` [${getProgressBar(0, totalSubs)}] (\`0/${totalSubs}\`)\n` +
            `🟢 *Delivered:* \`0\`\n` +
            `🔴 *Failed / Blocked:* \`0\`\n\n` +
            `_Sending seamlessly to active subscribers..._`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});

        for (let i = 0; i < totalSubs; i++) {
            const u = subscribers[i];
            try {
                if (replyTo) {
                    await callTelegramWithRetry('copyMessage', u.id, ctx.chat.id, replyTo.message_id);
                } else {
                    await callTelegramWithRetry('sendMessage', u.id, textParam, { parse_mode: "Markdown" });
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

            // Edit progress message every 20 users or every 2.5 seconds (Telegram limits max ~1 edit/sec per chat)
            const now = Date.now();
            const isLast = (i === totalSubs - 1);
            if ((i > 0 && i % 20 === 0 && now - lastEditTime > 2000) && !isLast) {
                lastEditTime = now;
                const percent = Math.round(((i + 1) / totalSubs) * 100);
                const bar = getProgressBar(i + 1, totalSubs);
                await ctx.telegram.editMessageText(
                    statusChatId,
                    statusMsgId,
                    null,
                    `✈️ *Broadcasting Announcement...* 📢\n\n` +
                    `⏳ *Progress:* \`${percent}%\` [${bar}] (\`${i + 1}/${totalSubs}\`)\n` +
                    `🟢 *Delivered:* \`${successCount}\`\n` +
                    `🔴 *Failed / Blocked:* \`${failedCount}\`\n\n` +
                    `_Sending seamlessly to active subscribers..._`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }

            // Rate limiting delay (35ms between Telegram sends = ~28 msgs/sec safely under Telegram limit)
            await new Promise(r => setTimeout(r, 35));
        }

        const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));

        // Final seamless in-place edit!
        await ctx.telegram.editMessageText(
            statusChatId,
            statusMsgId,
            null,
            `📢 *Broadcast Completed Successfully!* 🎉\n\n` +
            `🟢 *Delivered:* \`${successCount}\`\n` +
            `🔴 *Failed / Blocked:* \`${failedCount}\`\n` +
            `👥 *Total Audience:* \`${totalSubs}\`\n` +
            `⏱️ *Time Elapsed:* \`${elapsedSec}s\``,
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    };

    bot.command('broadcast', handleSeamlessBroadcast);
    if (adminBot) adminBot.command('broadcast', handleSeamlessBroadcast);
    if (adminBot) {
        adminBot.command('ban', async (ctx) => bot.handleUpdate(ctx.update));
        adminBot.command('unban', async (ctx) => bot.handleUpdate(ctx.update));
        adminBot.command('setwelcomecaption', async (ctx) => bot.handleUpdate(ctx.update));
    }

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

    // Admin Reply-to-Fulfill Handler for main bot
    bot.use(async (ctx, next) => {
        if (ctx.message && ctx.message.reply_to_message) {
            const handled = await handleAdminReplyToFulfill(ctx);
            if (handled) return;
        }
        return next();
    });

    // Channel post automated listener for main bot Ingest Vault
    bot.on('channel_post', async (ctx, next) => {
        const handled = await handleAdminMediaForward(ctx, true);
        if (!handled && typeof next === 'function') return next();
    });

    // 1-Click Vault Setup Action from Channel Member Add
    bot.action(/^set_vault:(.+)$/, async (ctx) => {
        const chatId = ctx.match[1];
        dynamicIngestChannelId = chatId;
        try {
            await db.collection("system").doc("ingest_config").set({
                channelId: chatId,
                setBy: String(ctx.from?.id || ""),
                updatedAt: new Date().toISOString()
            }, { merge: true });
            await ctx.editMessageText(`✅ <b>Ingest Vault Configured!</b>\n\nThis channel is now your automated Ingest Channel. Whenever files are posted or dropped here, FilmHouse will automatically index, extract stream links, match TMDB, and send you confirmation cards!`, { parse_mode: "HTML" });
        } catch (err) {
            await ctx.reply(`❌ Error setting ingest channel: ${err.message}`);
        }
    });

    bot.on('my_chat_member', async (ctx) => {
        try {
            const member = ctx.myChatMember;
            if (!member) return;
            const newStatus = member.new_chat_member?.status;
            if (newStatus === 'administrator') {
                const chatId = String(ctx.chat.id);
                const chatTitle = ctx.chat.title || "Channel";
                await ctx.reply(
                    `🤖 <b>Film House Bot Connected!</b>\n\n` +
                    `Would you like to set <b>${escapeHtml(chatTitle)}</b> as your <b>Automated Ingest Vault</b>? Every movie/series dropped here will be indexed automatically.`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "📥 Set as Auto-Ingest Vault", callback_data: `set_vault:${chatId}` }
                                ]
                            ]
                        }
                    }
                );
            }
        } catch (e) {}
    });

    // /setingest command for main bot (in-channel or pass channel ID in DM)
    bot.command('setingest', async (ctx) => {
        const senderId = String(ctx.from ? ctx.from.id : "");
        const authorized = await isAdmin(senderId);
        if (!authorized) return ctx.reply("⛔ Unauthorized.");
        const textParts = (ctx.message?.text || "").trim().split(/\s+/);
        const argId = textParts[1];
        const targetChatId = (argId && (argId.startsWith("-100") || argId.startsWith("@"))) ? argId.trim() : String(ctx.chat.id);
        dynamicIngestChannelId = targetChatId;
        try {
            await db.collection("system").doc("ingest_config").set({
                channelId: targetChatId,
                setBy: senderId,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            return ctx.reply(`✅ <b>Ingest Vault Configured!</b>\n\nChannel ID <code>${targetChatId}</code> is now your automated Ingest Channel. Whenever files are posted or dropped here, FilmHouse will automatically index, extract stream links, match TMDB, and send you confirmation cards!`, { parse_mode: "HTML" });
        } catch (err) {
            return ctx.reply(`❌ Error configuring ingest channel: ${err.message}`);
        }
    });

    // Admin Media Forward / Upload Handler for main bot
    bot.on(['video', 'document', 'animation'], async (ctx, next) => {
        if (ctx.message && ctx.message.reply_to_message) {
            const handled = await handleAdminReplyToFulfill(ctx);
            if (handled) return;
        }
        const handled = await handleAdminMediaForward(ctx);
        if (!handled && typeof next === 'function') return next();
    });

    // Action handler for forward showcase buttons on main bot
    bot.action(/^fwd_(post|cat|edit|dis):(.+)$/, async (ctx) => {
        await handleMediaShowcaseCallback(ctx);
    });

    // Default reply for regular text messages (Automation)
    bot.on('text', async (ctx, next) => {
        const senderId = String(ctx.from ? ctx.from.id : "");
        if (pendingTitleEdits.has(senderId)) {
            const { sessionId } = pendingTitleEdits.get(senderId);
            pendingTitleEdits.delete(senderId);
            const session = pendingMediaShowcases.get(sessionId);
            if (session) {
                const newTitleInput = ctx.message.text.trim();
                await ctx.reply(`🔍 Re-matching with: <code>${escapeHtml(newTitleInput)}</code>...`, { parse_mode: "HTML" });
                const newParsed = parseMediaFilename(newTitleInput);
                const newTmdb = await fetchTmdbMetadata(newParsed.cleanTitle, newParsed.year, session.parsed.isSeries);
                if (newTmdb) {
                    session.tmdb = newTmdb;
                    session.parsed.cleanTitle = newParsed.cleanTitle;
                    if (newParsed.year) session.parsed.year = newParsed.year;
                    await ctx.reply(`✅ Matched: <b>${escapeHtml(newTmdb.title)} (${escapeHtml(newTmdb.year)})</b>. Please tap Confirm on the previous card to publish.`, { parse_mode: "HTML" });
                    return;
                } else {
                    await ctx.reply("⚠️ Could not match on TMDB. Please try another title or TMDB ID.");
                    return;
                }
            }
        }

        // Check if admin forwarded a media/text message containing a stream link (e.g. from Streamer Bot)
        if (ctx.message && (await isAdmin(senderId))) {
            const info = extractMediaAndStreamInfo(ctx.message);
            if (info && (info.streamUrl || info.fileObj)) {
                const handled = await handleAdminMediaForward(ctx);
                if (handled) return;
            }
        }

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
            // Ensure Ubuntu disk and in-memory cache are 100% in sync with latest GitHub publications first
            try {
                await syncCatalogFromGitHub();
            } catch (syncErr) {
                console.warn("[WeeklyBackup] Catalog sync before backup encountered error:", syncErr.message);
            }
            let moviesList = [];
            const localMetaPath = path.resolve(__dirname, "./MOVIE/Data/movies_metadata.json");
            const localCsvPath = path.resolve(__dirname, "./MOVIE/Data/datafile.csv");

            if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata) && cachedMoviesMetadata.length > 0) {
                moviesList = cachedMoviesMetadata;
            } else if (fs.existsSync(localMetaPath)) {
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
            console.warn("Notice: Firestore token fetch warning (will use fallback):", err.message || err);
        }
    }

    if (!botToken) {
        console.error("FATAL: No TELEGRAM_BOT_TOKEN found in .env or Firestore settings.");
        process.exit(1);
    }

    // Load admin bot token strictly from environment variable or Firestore
    let adminBotToken = process.env.ADMIN_BOT_TOKEN;
    if (!adminBotToken) {
        try {
            const doc = await db.collection("settings").doc("telegram").get();
            if (doc.exists && doc.data().adminBotToken) {
                adminBotToken = doc.data().adminBotToken;
            }
        } catch (err) {}
    }

    try {
        const bot = new Telegraf(botToken);
        let adminBot = null;
        if (adminBotToken && adminBotToken.trim().length > 0) {
            try {
                adminBot = new Telegraf(adminBotToken);
            } catch (err) {
                console.warn("Failed to initialize dedicated adminBot:", err.message);
            }
        }
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
        if (adminBot) {
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
        }

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

        const handleApiLogRequest = (req, res) => {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': '*'
                });
                res.end();
                return true;
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        const payload = JSON.parse(body || '{}');
                        const category = payload.category === 'admin_app' ? 'admin_app' : 'user_app';
                        const user = payload.user || payload.admin || 'Anonymous';
                        const msg = `[${user}] ${payload.message || payload.action || JSON.stringify(payload)}`;
                        recordLog(category, msg);
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': '*'
                        });
                        res.end(JSON.stringify({ ok: true }));
                    } catch (e) {
                        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return true;
            }
            return false;
        };

        if (webhookUrl) {
            console.log(`Configuring Webhook mode with base URL: ${webhookUrl}`);
            const webhookCallback = bot.webhookCallback(secretPath);
            
            server = http.createServer((req, res) => {
                if (req.url === '/api/log') {
                    if (handleApiLogRequest(req, res)) return;
                } else if (req.url === secretPath) {
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
                if (req.url === '/api/log') {
                    if (handleApiLogRequest(req, res)) return;
                } else if (req.url === '/debug-info') {
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

            if (adminBot) {
                adminBot.launch({
                    allowedUpdates: ['message', 'callback_query']
                }).then(() => {
                    console.log("Film House Admin Bot successfully started! 👑 Running listener (@Fiimhouse_adminBot)...");
                }).catch(err => {
                    console.error("Admin Bot launch error:", err.message);
                });
            }
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

        // Real-time catalog sync trigger from Admin Panel (Instant publish sync)
        let _lastSyncTimestamp = Date.now();
        let _syncDebounceTimeout = null;
        try {
            db.collection("settings").doc("catalog_sync").onSnapshot(doc => {
                if (!doc || !doc.exists) return;
                const data = doc.data() || {};
                const pubAt = data.lastPublishedAt || 0;
                if (pubAt > _lastSyncTimestamp && (Date.now() - pubAt < 180000)) {
                    _lastSyncTimestamp = pubAt;
                    console.log(`[CATALOG SYNC] Instant publish trigger received from Admin Panel! (Published at: ${new Date(pubAt).toLocaleTimeString()})`);
                    if (_syncDebounceTimeout) clearTimeout(_syncDebounceTimeout);
                    _syncDebounceTimeout = setTimeout(() => {
                        syncCatalogFromGitHub().catch(err => console.warn("[CATALOG SYNC] Instant sync error:", err.message));
                    }, 2000);
                }
            }, err => console.warn("[CATALOG SYNC] Listener error:", err.message));
        } catch (syncListenErr) {
            console.warn("[CATALOG SYNC] Could not attach listener:", syncListenErr.message);
        }

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
                        const text = `🍿 <b>FilmHouse Cinema & Loyalty Hub Alert!</b> 🍿\n\n` +
                            `👋 <b>Hey Movie Lover!</b>\n` +
                            `Your mining rig is currently idle! Don't let your free daily <b>Loyalty Points</b> slip away. 🪙\n\n` +
                            `💎 <b>Why Mine Your Daily Points?</b>\n` +
                            `• Redeem points for <b>Ad-Free Cinema Streaming Passes</b> 🎬\n` +
                            `• Unlock high-speed VIP servers & FHD streaming ⚡\n` +
                            `• Enjoy unlimited uninterrupted series & movies 🍿\n\n` +
                            `⛏️ <i>Every minute without mining is points left on the table!</i>\n` +
                            `Tap below to start your session, claim your points, and stream your favorite movies:`;
                        
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
                                                parse_mode: "HTML",
                                                reply_markup: {
                                                    inline_keyboard: [
                                                        [
                                                            {
                                                                text: "⛏️ Mine Loyalty Points & Stream Now",
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
                                    parse_mode: "HTML",
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                {
                                                    text: "⛏️ Mine Loyalty Points & Stream Now",
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

        // Real-time listener for secure admin broadcast & channel post queue
        const processedBroadcastTasks = new Set();
        db.collection("admin_broadcast_queue").onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "added") {
                    const docId = change.doc.id;
                    const data = change.doc.data();
                    
                    if (data.status && data.status !== "pending") return;
                    if (processedBroadcastTasks.has(docId)) return;
                    processedBroadcastTasks.add(docId);

                    // Skip historical tasks older than 60 seconds on startup
                    if (data.timestamp) {
                        const docMs = data.timestamp.toMillis ? data.timestamp.toMillis() : new Date(data.timestamp).getTime();
                        if (Date.now() - docMs > 60000) return;
                    }

                    // Authenticate sender
                    const senderId = String(data.adminId || "");
                    const adminIds = await getAllAdminIds();
                    const isAuthorized = adminIds.includes(senderId) || senderId === "1329840839" || senderId === "1175336733";
                    if (!isAuthorized) {
                        console.warn(`[SecurityQueue] Blocked unauthorized broadcast attempt from ID: ${senderId}`);
                        await db.collection("admin_broadcast_queue").doc(docId).update({
                            status: "rejected",
                            reason: "Unauthorized administrator ID"
                        }).catch(() => {});
                        return;
                    }

                    console.log(`[SecurityQueue] Processing authorized task ${docId} of type '${data.type}' from admin ${senderId}`);
                    await db.collection("admin_broadcast_queue").doc(docId).update({ status: "processing" }).catch(() => {});

                    if (data.type === "channel_post") {
                        try {
                            const movie = data.movie || {};
                            const targetChannel = data.channelId || process.env.UPDATES_CHANNEL_ID || "-1004272961286";
                            
                            const rawTitle = movie.title || "Movie Update";
                            const cleanTitle = String(rawTitle).replace(/\s*\([^)]+\)\s*$/g, "").replace(/[*_`~]/g, "").trim();
                            const yearText = movie.release_date ? ` (${movie.release_date.substring(0, 4)})` : (movie.year ? ` (${movie.year})` : "");
                            const isSeries = (movie.type || "").toLowerCase() === "series" || (movie.type || "").toLowerCase() === "tv";
                            const rawSeason = movie.seasonOrPart || (isSeries ? "Complete Series" : "Full Movie");

                            let seasonOrQualityText = isSeries 
                                ? (String(rawSeason).toLowerCase().includes("season") ? rawSeason : `Season ${rawSeason}`)
                                : (String(rawSeason).toLowerCase().includes("quality") ? rawSeason : `${rawSeason} Quality`);
                            if (movie.isSeriesComplete) {
                                seasonOrQualityText = "Complete Series | All Seasons";
                            }

                            const genresList = Array.isArray(movie.genres) ? movie.genres.slice(0, 4).join(" • ") : "Action";
                            const ratingStars = movie.rating ? `★ ${movie.rating}` : "★ 8.5";

                            const bMode = String(movie.broadcastMode || (movie.isUpdate ? "updated" : (isSeries && String(rawSeason).toLowerCase().includes("season") ? "updated" : "released"))).toLowerCase();
                            const isExplicitRelease = bMode === "released" || bMode === "release" || bMode === "new";
                            const headerBadge = isSeries
                                ? (isExplicitRelease ? "🔥 <b>NEW SEASON RELEASED!</b> 🍿" : "🔥 <b>NEW SEASON UPDATED!</b> 🍿")
                                : (isExplicitRelease ? "🔥 <b>NEW RELEASE AVAILABLE!</b> 🍿" : "✨ <b>MOVIE UPDATED!</b> 🍿");

                            const caption = `${headerBadge}\n\n` +
                                            `🎬 <b>${escapeHtml(cleanTitle)}${escapeHtml(yearText)}</b>\n` +
                                            `🏷️ <b>Format:</b> ${escapeHtml(seasonOrQualityText)}\n` +
                                            `⭐ <b>Rating:</b> ${escapeHtml(ratingStars)} | 📁 ${escapeHtml(genresList)}\n\n` +
                                            `📝 <i>${escapeHtml((movie.overview || "No synopsis available.").substring(0, 200))}...</i>\n\n` +
                                            `🍿 <b>Stream or Download via Film House App:</b>`;

                            const deepLink = movie.csv_id ? `https://t.me/Filmhouseappbot?start=dl_${movie.csv_id}` : `https://t.me/Filmhouseappbot`;
                            const replyMarkup = {
                                inline_keyboard: [
                                    [
                                        { text: "📥 Download / Watch in Bot", url: deepLink }
                                    ]
                                ]
                            };

                            const posterImg = movie.backdrop || movie.poster || "https://raw.githubusercontent.com/dans123456/filmhouse/main/MOVIE/img/FilmHouse.png";

                            let postRes;
                            try {
                                postRes = await callTelegramWithRetry('sendPhoto', targetChannel, posterImg, {
                                    caption: caption,
                                    parse_mode: 'HTML',
                                    reply_markup: replyMarkup
                                });
                            } catch (photoErr) {
                                console.warn(`[SecurityQueue] sendPhoto failed (${photoErr.message}), falling back to sendMessage...`);
                                postRes = await callTelegramWithRetry('sendMessage', targetChannel, caption, {
                                    parse_mode: 'HTML',
                                    reply_markup: replyMarkup,
                                    disable_web_page_preview: false
                                });
                            }

                            console.log(`[SecurityQueue] Channel post delivered successfully for "${cleanTitle}" to ${targetChannel}`);
                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "completed",
                                messageId: postRes?.message_id || null,
                                processedAt: admin.firestore.FieldValue.serverTimestamp()
                            }).catch(() => {});
                        } catch (postErr) {
                            console.error(`[SecurityQueue] Channel post failed for task ${docId}:`, postErr.message);
                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "failed",
                                error: postErr.message
                            }).catch(() => {});
                        }
                    } else if (data.type === "user_broadcast") {
                        try {
                            const messageText = data.message;
                            let eligibleUsers = [];
                            if (Array.isArray(data.targetUserIds) && data.targetUserIds.length > 0) {
                                eligibleUsers = data.targetUserIds.map(id => ({ id: String(id) }));
                            } else {
                                const allUsers = localStore.getAllUsers();
                                eligibleUsers = allUsers.filter(u => u && u.id && !u.banned && !u.blockedBot);
                            }

                            console.log(`[SecurityQueue] Starting server-side user broadcast to ${eligibleUsers.length} users...`);
                            let sent = 0;
                            let failed = 0;

                            // Build optional button (only attached if admin checked "Attach Button")
                            let replyMarkup = undefined;
                            if (data.includeButton === true) {
                                const btnText = data.buttonText || "🍿 Open Film House";
                                const rawUrl = data.buttonUrl || "https://dans123456.github.io/filmhouse/";
                                // If web URL, open mini app via web_app so clicking directly launches the app inside Telegram
                                if (rawUrl.startsWith("https://") || rawUrl.startsWith("http://")) {
                                    replyMarkup = {
                                        inline_keyboard: [
                                            [{ text: btnText, web_app: { url: rawUrl } }]
                                        ]
                                    };
                                } else {
                                    replyMarkup = {
                                        inline_keyboard: [
                                            [{ text: btnText, url: rawUrl }]
                                        ]
                                    };
                                }
                            }

                            for (const u of eligibleUsers) {
                                try {
                                    const sendOptions = { parse_mode: 'HTML' };
                                    if (replyMarkup) {
                                        sendOptions.reply_markup = replyMarkup;
                                    }
                                    await callTelegramWithRetry('sendMessage', u.id, messageText, sendOptions);
                                    sent++;
                                } catch (e) {
                                    failed++;
                                    if (e.message && (e.message.includes("blocked") || e.message.includes("deactivated"))) {
                                        localStore.setBlocked(u.id, true);
                                    }
                                }
                                await new Promise(r => setTimeout(r, 40));
                            }

                            console.log(`[SecurityQueue] User broadcast finished. Delivered: ${sent}, Failed: ${failed}`);
                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "completed",
                                deliveredCount: sent,
                                failedCount: failed,
                                processedAt: admin.firestore.FieldValue.serverTimestamp()
                            }).catch(() => {});
                        } catch (bErr) {
                            console.error(`[SecurityQueue] User broadcast failed for task ${docId}:`, bErr.message);
                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "failed",
                                error: bErr.message
                            }).catch(() => {});
                        }
                    } else if (data.type === "series_episode_broadcast") {
                        try {
                            const tmdbId = parseInt(data.tmdb_id, 10);
                            const seriesTitle = data.series_title || "Ongoing Series";
                            const season = parseInt(data.season, 10) || 1;
                            const episode = parseInt(data.episode, 10) || 1;
                            const episodeTitle = data.episode_title || "";
                            const csvId = data.csv_id || String(tmdbId);

                            console.log(`[SeriesBroadcast] Processing episode broadcast for "${seriesTitle}" S${season}E${episode} (TMDB: ${tmdbId})...`);

                            // 1. Fetch all subscribers for this series
                            let subscribers = [];
                            try {
                                const numSnap = await db.collection("subscriptions").where("tmdb_id", "==", tmdbId).get();
                                numSnap.forEach(d => {
                                    const s = d.data();
                                    if (s && s.user_telegram_id) subscribers.push(s);
                                });

                                if (subscribers.length === 0) {
                                    const strSnap = await db.collection("subscriptions").where("tmdb_id", "==", String(tmdbId)).get();
                                    strSnap.forEach(d => {
                                        const s = d.data();
                                        if (s && s.user_telegram_id) subscribers.push(s);
                                    });
                                }
                            } catch (subErr) {
                                console.error(`[SeriesBroadcast] Failed to query subscriptions for ${tmdbId}:`, subErr.message);
                            }

                            console.log(`[SeriesBroadcast] Found ${subscribers.length} subscriber(s) for "${seriesTitle}".`);

                            const cleanSafe = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                            const epTitleLine = episodeTitle ? ` - <i>${cleanSafe(episodeTitle)}</i>` : "";

                            const messageText = 
                                `🍿 <b>New Episode Available!</b>\n\n` +
                                `📺 <b>${cleanSafe(seriesTitle)}</b>\n` +
                                `🎬 <b>Season ${season}, Episode ${episode}</b>${epTitleLine} is now ready to watch!\n\n` +
                                `<i>Tap below to stream instantly in Full HD or download directly on Telegram.</i>`;

                            const streamMiniAppUrl = data.stream_url || `https://dans123456.github.io/filmhouse/?stream_id=${encodeURIComponent(csvId)}&season=${season}&ep=${episode}`;
                            const actionRow = [
                                { text: `▶️ Stream S${season}E${episode}`, web_app: { url: streamMiniAppUrl } }
                            ];

                            if (data.download_url && (data.download_url.startsWith("http://") || data.download_url.startsWith("https://") || data.download_url.startsWith("t.me/"))) {
                                const dlUrl = data.download_url.startsWith("t.me/") ? `https://${data.download_url}` : data.download_url;
                                actionRow.push({ text: `⬇️ Download S${season}E${episode}`, url: dlUrl });
                            }

                            const replyMarkup = {
                                inline_keyboard: [
                                    actionRow,
                                    [{ text: "🍿 Open Film House Mini App", web_app: { url: "https://dans123456.github.io/filmhouse/" } }]
                                ]
                            };

                            let sent = 0;
                            let failed = 0;

                            for (const sub of subscribers) {
                                const targetId = String(sub.user_telegram_id);
                                try {
                                    await callTelegramWithRetry('sendMessage', targetId, messageText, {
                                        parse_mode: 'HTML',
                                        reply_markup: replyMarkup
                                    });
                                    sent++;
                                } catch (sendErr) {
                                    failed++;
                                    if (sendErr.message && (sendErr.message.includes("blocked") || sendErr.message.includes("deactivated"))) {
                                        localStore.setBlocked(targetId, true);
                                    }
                                }
                                await new Promise(r => setTimeout(r, 40));
                            }

                            console.log(`[SeriesBroadcast] Broadcast finished. Delivered: ${sent}, Failed: ${failed}`);

                            // If this was marked to purge subscriptions (season completed)
                            if (data.purge_subscriptions === true) {
                                try {
                                    console.log(`[SeriesBroadcast] Season complete. Purging subscriptions for TMDB ${tmdbId}...`);
                                    const purgeDocs = [];
                                    const pSnap1 = await db.collection("subscriptions").where("tmdb_id", "==", tmdbId).get();
                                    pSnap1.forEach(d => purgeDocs.push(d.ref));
                                    const pSnap2 = await db.collection("subscriptions").where("tmdb_id", "==", String(tmdbId)).get();
                                    pSnap2.forEach(d => purgeDocs.push(d.ref));

                                    if (purgeDocs.length > 0) {
                                        const pBatch = db.batch();
                                        purgeDocs.forEach(ref => pBatch.delete(ref));
                                        await pBatch.commit();
                                        console.log(`[SeriesBroadcast] Purged ${purgeDocs.length} subscription records for completed series.`);
                                    }
                                } catch (pErr) {
                                    console.error(`[SeriesBroadcast] Subscriber purge failed:`, pErr.message);
                                }
                            }

                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "completed",
                                subscriberCount: subscribers.length,
                                deliveredCount: sent,
                                failedCount: failed,
                                processedAt: admin.firestore.FieldValue.serverTimestamp()
                            }).catch(() => {});

                        } catch (epErr) {
                            console.error(`[SecurityQueue] Series episode broadcast failed for task ${docId}:`, epErr.message);
                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "failed",
                                error: epErr.message
                            }).catch(() => {});
                        }
                    } else if (data.type === "series_purge_subscriptions") {
                        try {
                            const tmdbId = parseInt(data.tmdb_id, 10);
                            console.log(`[SecurityQueue] Standalone subscriber purge for TMDB ${tmdbId}...`);
                            const purgeDocs = [];
                            const pSnap1 = await db.collection("subscriptions").where("tmdb_id", "==", tmdbId).get();
                            pSnap1.forEach(d => purgeDocs.push(d.ref));
                            const pSnap2 = await db.collection("subscriptions").where("tmdb_id", "==", String(tmdbId)).get();
                            pSnap2.forEach(d => purgeDocs.push(d.ref));

                            if (purgeDocs.length > 0) {
                                const pBatch = db.batch();
                                purgeDocs.forEach(ref => pBatch.delete(ref));
                                await pBatch.commit();
                            }

                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "completed",
                                purgedCount: purgeDocs.length,
                                processedAt: admin.firestore.FieldValue.serverTimestamp()
                            }).catch(() => {});
                        } catch (purgeErr) {
                            console.error(`[SecurityQueue] Standalone subscriber purge failed:`, purgeErr.message);
                            await db.collection("admin_broadcast_queue").doc(docId).update({
                                status: "failed",
                                error: purgeErr.message
                            }).catch(() => {});
                        }
                    }
                }
            });
        }, (err) => console.error("Admin broadcast queue listener error:", err));

        // Fallback listener for settings/broadcast_queue doc writes
        db.collection("settings").doc("broadcast_queue").onSnapshot(async (docSnap) => {
            if (!docSnap.exists) return;
            const data = docSnap.data();
            if (!data || data.status !== "pending") return;
            const taskKey = data.fallbackId || (data.timestamp ? String(data.timestamp) : "");
            if (taskKey && processedBroadcastTasks.has(taskKey)) return;
            if (taskKey) processedBroadcastTasks.add(taskKey);

            if (data.type === "channel_post" && data.movie && typeof publishMovieToChannel === 'function') {
                console.log(`[FallbackQueue] Processing channel broadcast for "${data.movie.title}"`);
                try {
                    await publishMovieToChannel(data.movie);
                    await docSnap.ref.update({ status: "completed" }).catch(() => {});
                } catch (err) {
                    console.error("[FallbackQueue] Error:", err.message);
                }
            }
        }, (err) => console.warn("Fallback broadcast queue listener warning:", err.message));

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
                    const cleanUser = escapeHtml(data.user || data.username || "guest");
                    const cleanUserId = escapeHtml(data.userId || data.user_id || "");
                    const cleanCategory = escapeHtml(data.category || data.type || "General");
                    const cleanSubject = escapeHtml(data.subject || "No Subject");
                    const cleanMsg = escapeHtml(data.msg || data.message || "");

                    const adminText = `📝 <b>New Feedback Submitted!</b>\n\n` +
                                      `👤 <b>User:</b> @${cleanUser} (ID: <code>${cleanUserId}</code>)\n` +
                                      `📁 <b>Type:</b> ${cleanCategory}\n` +
                                      `📌 <b>Subject:</b> ${cleanSubject}\n\n` +
                                      `💬 <b>Message:</b>\n${cleanMsg}`;
                    
                    try {
                        const allAdmins = await getAllAdminIds();
                        for (const adminId of allAdmins) {
                            try {
                                await callAdminTelegramWithRetry('sendMessage', adminId, adminText, { parse_mode: "HTML" });
                                console.log(`Feedback DM notification successfully sent to admin ${adminId}`);
                            } catch (e) {
                                console.warn(`Failed to notify admin ${adminId} of feedback:`, e.message);
                            }
                        }
                    } catch (err) {
                        console.error("Error sending feedback notification to admins:", err);
                    }
                }
            });
        }, (err) => console.error("Feedbacks listener error:", err));

        // Real-time listener for requests additions and status changes (boosted, claimed, fulfilled)
        db.collection("requests").onSnapshot((snapshot) => {
            try {
                cachedPendingRequests = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(r => {
                        if (r.downloadLink && String(r.downloadLink).trim() !== "") return false;
                        if (r.status === "fulfilled" || r.fulfilled === true) return false;
                        if (r.status === "priority" || r.boosted === true || r.isPriority === true) return true;
                        if (r.status === "claimed" || r.claimed === true) return false;
                        return true;
                    });
                savePendingRequestsToDisk(cachedPendingRequests);
                console.log(`[PendingStore] Synchronized ${cachedPendingRequests.length} pending requests from Firestore.`);
            } catch (e) {
                console.error("Error updating cached pending requests:", e.message);
            }

            snapshot.docChanges().forEach(async (change) => {
                const data = change.doc.data();
                const docId = change.doc.id;
                
                let userId = data.userId || data.requestedById || "";
                if (userId === "undefined") {
                    userId = "";
                }
                
                const title = data.title;
                const type = data.type;
                const year = data.year || "";
                const rawUser = (data.requestedBy && data.requestedBy !== "guest") ? data.requestedBy : (data.fullName || data.user || (userId ? `User ${userId}` : "Guest User"));
                const username = (rawUser && rawUser !== "guest" && rawUser !== "None" && !rawUser.includes(" ") && !rawUser.startsWith("User ")) ? `@${rawUser.replace(/^@/, '')}` : rawUser;
                const downloadLink = data.downloadLink;
                const timestamp = data.timestamp || data.requestedAt;

                const yearSuffix = year ? ` (${year})` : "";

                if (change.type === "added") {
                    if (timestamp) {
                        const docMs = timestamp.toMillis ? timestamp.toMillis() : new Date(timestamp).getTime();
                        if (Date.now() - docMs > 60000) return; // skip historical
                    }

                    const cleanTitle = escapeHtml(String(title || "Movie").replace(/[*_`~]/g, '').trim());
                    const cleanYear = year ? ` (${escapeHtml(String(year).replace(/[*_`~()]/g, '').trim())})` : "";
                    const cleanType = escapeHtml(String(type || "Movie").replace(/[*_`~]/g, '').trim());
                    const cleanSeason = data.seasonOrPart ? `\n📌 <b>Season/Part:</b> ${escapeHtml(String(data.seasonOrPart).replace(/[*_`~]/g, '').trim())}` : '';
                    const cleanUser = escapeHtml(String(username || (userId ? `User ${userId}` : "Guest User")).replace(/[*_`~]/g, '').trim());

                    const isStreamReq = (data.type === "stream" || data.requestType === "stream" || data.target === "stream_url");

                    // 1. Send confirmation to requesting user if userId is available
                    if (userId) {
                        const canBoost = !data.boosted && !isStreamReq;
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

                        const userReqText = isStreamReq
                            ? `🍿 <b>Stream Request Received!</b>\n\nYour request for an online streaming link of <b>${cleanTitle}</b>${cleanYear} has been logged in our queue.\n\nWe will notify you here as soon as the stream player is active! 🚀`
                            : `🍿 <b>Request Received!</b>\n\nYour request for <b>${cleanTitle}</b>${cleanYear} (${cleanType}) has been logged in our queue.\n\n` +
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
                                await db.collection("users").doc(userId).update({ blockedBot: true }).catch(() => {});
                            }
                            console.warn(`Failed to send request confirmation to ${userId}:`, e.message);
                        }
                    }

                    // 2. Notify admins (Always runs unconditionally)
                    const reqDate = parseRequestDate(data.requestedAt || data.createdAt || data.timestamp) || new Date();
                    const reqDateFormatted = formatRequestDateTime(reqDate, true);
                    const isDirectPriority = (data.status === "priority" || data.boosted === true);
                    
                    let adminText = "";
                    if (isStreamReq) {
                        adminText = `🎬🟣 <b>NEW STREAM LINK REQUEST!</b> 🟣🎬\n\n` +
                                    `🎬 <b>Title:</b> <b>${cleanTitle}</b>${cleanYear}\n` +
                                    `🎯 <b>Target:</b> 🟣 <b>Online Stream Player Link</b>\n` +
                                    `👤 <b>Requested By:</b> ${cleanUser}${userId ? ` (ID: <code>${userId}</code>)` : ''}\n` +
                                    `📅 <b>Requested:</b> ${reqDateFormatted}\n` +
                                    `🆔 <b>Req ID:</b> <code>#REQ_${docId}</code>\n\n` +
                                    `💬 <i>Tip: Reply directly to this message with a stream URL to fulfill instantly!</i>`;
                    } else if (isDirectPriority) {
                        adminText = `🚀🔥 <b>NEW MOVIE REQUEST (HIGH PRIORITY)!</b> 🔥🚀\n\n` +
                                    `🎬 <b>Title:</b> <b>${cleanTitle}</b>${cleanYear}\n` +
                                    `📁 <b>Type:</b> ${cleanType}${cleanSeason}\n` +
                                    `👤 <b>Requested By:</b> ${cleanUser}${userId ? ` (ID: <code>${userId}</code>)` : ''}\n` +
                                    `📅 <b>Requested:</b> ${reqDateFormatted}\n` +
                                    `🔥 <b>Priority:</b> ⚡⚡ <b>HIGH PRIORITY</b> ⚡⚡\n` +
                                    `🆔 <b>Req ID:</b> <code>#REQ_${docId}</code>\n\n` +
                                    `💬 <i>Tip: Reply directly to this message with a download/stream link to fulfill instantly!</i>`;
                    } else {
                        adminText = `🍿 <b>New Movie Request!</b>\n\n` +
                                    `🎬 <b>Title:</b> <b>${cleanTitle}</b>${cleanYear}\n` +
                                    `📁 <b>Type:</b> ${cleanType}${cleanSeason}\n` +
                                    `👤 <b>Requested By:</b> ${cleanUser}${userId ? ` (ID: <code>${userId}</code>)` : ''}\n` +
                                    `📅 <b>Requested:</b> ${reqDateFormatted}\n` +
                                    `🆔 <b>Req ID:</b> <code>#REQ_${docId}</code>\n\n` +
                                    `💬 <i>Tip: Reply directly to this message with a download/stream link to fulfill instantly!</i>`;
                    }

                    try {
                        const allAdmins = await getAllAdminIds();
                        for (const adminId of allAdmins) {
                            try {
                                const adminUrl = `https://dans123456.github.io/filmhouse/admin.html?tg_id=${adminId}`;
                                const fulfillBtn = String(adminId).startsWith("-")
                                    ? { text: "👑 Open Film House Admin to Fulfill 🚀", url: adminUrl }
                                    : { text: "👑 Open Film House Admin to Fulfill 🚀", web_app: { url: adminUrl } };
                                const sentMsg = await callAdminTelegramWithRetry('sendMessage', adminId, adminText, {
                                    parse_mode: "HTML",
                                    reply_markup: {
                                        inline_keyboard: [
                                            [fulfillBtn]
                                        ]
                                    }
                                });
                                if (sentMsg && sentMsg.message_id) {
                                    if (adminRequestMsgMap.size > 2000) {
                                        const firstKey = adminRequestMsgMap.keys().next().value;
                                        adminRequestMsgMap.delete(firstKey);
                                    }
                                    adminRequestMsgMap.set(String(sentMsg.message_id), {
                                        docId,
                                        title,
                                        year,
                                        type,
                                        seasonOrPart: data.seasonOrPart,
                                        csv_id: data.csv_id,
                                        tmdb_id: data.tmdb_id,
                                        userId,
                                        username,
                                        isStreamReq
                                    });
                                }
                            } catch (e) {
                                console.warn(`Failed to notify admin ${adminId} of request:`, e.message);
                            }
                        }
                    } catch (err) {
                        console.error("Error sending new request notification to admins:", err);
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
                                await db.collection("users").doc(userId).update({ blockedBot: true }).catch(() => {});
                            }
                            console.warn(`Failed to send boost confirmation to ${userId}:`, e.message);
                        }

                        // 2. Notify admins in their DMs with high-visibility HTML alert and Delete Request button
                        const boostDateFormatted = formatRequestDateTime(new Date(), true);
                        const adminBoostText = `🚀🔥 <b>REQUEST BOOSTED TO HIGH PRIORITY!</b> 🔥🚀\n\n` +
                                              `🎬 <b>Title:</b> <b>${cleanTitle}</b>${cleanYear}\n` +
                                              `📁 <b>Type:</b> ${cleanType}${cleanSeason}\n` +
                                              `👤 <b>Requested By:</b> ${cleanUser} (ID: <code>${userId}</code>)\n` +
                                              `⚡ <b>Boosted By:</b> ${cleanBooster}\n` +
                                              `📅 <b>Boosted:</b> ${boostDateFormatted}\n` +
                                              `🪙 <b>Points Spent:</b> <code>1,000 Loyalty Points</code> ⚡\n` +
                                              `🔥 <b>Priority Level:</b> ⚡⚡ <b>HIGH PRIORITY</b> ⚡⚡\n` +
                                              `🆔 <b>Req ID:</b> <code>#REQ_${docId}</code>\n\n` +
                                              `💬 <i>Tip: Reply directly to this message with a download/stream link to fulfill instantly!</i>`;

                        try {
                            const allAdmins = await getAllAdminIds();
                            console.log(`[BOOST ALERT] Sending HTML notification for "${title}" to ${allAdmins.length} admin(s)...`);

                            for (const adminId of allAdmins) {
                                try {
                                    const adminUrl = `https://dans123456.github.io/filmhouse/admin.html?tg_id=${adminId}`;
                                    const boostFulfillBtn = String(adminId).startsWith("-")
                                        ? { text: "⚡🔥 Open Admin to Fulfill Priority 🚀", url: adminUrl }
                                        : { text: "⚡🔥 Open Admin to Fulfill Priority 🚀", web_app: { url: adminUrl } };
                                    const sentBoostMsg = await callAdminTelegramWithRetry('sendMessage', adminId, adminBoostText, {
                                        parse_mode: "HTML",
                                        reply_markup: {
                                            inline_keyboard: [
                                                [boostFulfillBtn]
                                            ]
                                        }
                                    });
                                    if (sentBoostMsg && sentBoostMsg.message_id) {
                                        if (adminRequestMsgMap.size > 2000) {
                                            const firstKey = adminRequestMsgMap.keys().next().value;
                                            adminRequestMsgMap.delete(firstKey);
                                        }
                                        adminRequestMsgMap.set(String(sentBoostMsg.message_id), {
                                            docId,
                                            title,
                                            year,
                                            type,
                                            seasonOrPart: data.seasonOrPart,
                                            csv_id: data.csv_id,
                                            tmdb_id: data.tmdb_id,
                                            userId,
                                            username,
                                            isStreamReq: false
                                        });
                                    }
                                    console.log(`[BOOST ALERT] HTML DM successfully sent to admin ${adminId}`);
                                } catch (e) {
                                    console.warn(`Failed to notify admin ${adminId} of boost:`, e.message);
                                }
                            }
                        } catch (err) {
                            console.error("Error sending admin boost DM notification:", err);
                        }
                    }

                    // Auto-publish release announcement to Main Channel (@filmhouse_main)
                    // Evaluated immediately and independently so channel posts are never delayed, skipped or blocked
                    if (data.status === "fulfilled" && data.publishToChannel !== false && !data.channelMessageId) {
                        const rawClean = String(title || "").toLowerCase().replace(/\s*\([^)]+\)\s*$/g, "").trim();
                        const movieKey = String(data.csv_id || data.tmdb_id || rawClean || docId).toLowerCase().trim();
                        const specKey = String(data.seasonOrPart || "").toLowerCase().trim();
                        const fullKey = specKey ? `${movieKey}_${specKey}` : movieKey;

                        const isAlreadyBroadcasted = specKey 
                            ? (broadcastedCatalogIds.has(fullKey) || _channelPostingLocks.has(fullKey))
                            : (broadcastedCatalogIds.has(movieKey) || broadcastedCatalogIds.has(rawClean) || _channelPostingLocks.has(movieKey) || _channelPostingLocks.has(rawClean));

                        if (!isAlreadyBroadcasted) {
                            _channelPostingLocks.add(fullKey);
                            if (!specKey) _channelPostingLocks.add(movieKey);
                            (async () => {
                                try {
                                    console.log(`[CHANNEL PUBLISH] Initiating immediate auto-publish for fulfilled request "${title}" (Key: ${fullKey})...`);

                                    let movieDataForChannel = null;
                                    const lookupCsvId = String(data.csv_id || "").toLowerCase().trim();
                                    const lookupTmdbId = String(data.tmdb_id || "").trim();
                                    const lookupTitle = rawClean;

                                    if (cachedMoviesMetadata && Array.isArray(cachedMoviesMetadata)) {
                                        const found = cachedMoviesMetadata.find(m => {
                                            const mCsv = String(m.csv_id || "").toLowerCase().trim();
                                            const mTmdb = String(m.tmdb_id || "").trim();
                                            if (lookupTmdbId && mTmdb) {
                                                return lookupTmdbId === mTmdb;
                                            }
                                            if (lookupCsvId && mCsv) {
                                                return lookupCsvId === mCsv;
                                            }
                                            // Only consider title match if neither entry has a known conflicting TMDB ID
                                            if (!lookupTmdbId && !mTmdb && lookupTitle) {
                                                const mClean = String(m.title || "").toLowerCase().replace(/\s*\([^)]+\)\s*$/g, "").trim();
                                                return mClean === lookupTitle || titlesMatch(m.title, lookupTitle);
                                            }
                                            return false;
                                        });
                                        if (found) {
                                            movieDataForChannel = {
                                                ...found,
                                                seasonOrPart: data.seasonOrPart || found.seasonOrPart || ""
                                            };
                                        }
                                    }

                                    if (!movieDataForChannel) {
                                        movieDataForChannel = {
                                            title: title,
                                            year: year,
                                            type: data.type,
                                            seasonOrPart: data.seasonOrPart,
                                            csv_id: data.csv_id || "",
                                            tmdb_id: data.tmdb_id || null,
                                            overview: data.overview || "",
                                            genres: data.genres || data.categories || [],
                                            rating: data.rating || data.vote_average || "",
                                            poster: data.poster || null,
                                            backdrop: data.backdrop || null
                                        };
                                    }

                                    const pubResult = await publishMovieToChannel(movieDataForChannel);
                                    if (pubResult && pubResult.message_id) {
                                        console.log(`[CHANNEL PUBLISH] Successfully published announcement for "${title}" to Updates Channel (msg_id: ${pubResult.message_id})`);
                                        
                                        // Register in broadcasted catalog tracker to prevent duplicate repost when GitHub syncs!
                                        const bcIdKey = String(movieDataForChannel.csv_id || data.csv_id || "").toLowerCase().trim();
                                        const bcTitleKey = String(movieDataForChannel.title || title || "").toLowerCase().replace(/\s*\([^)]+\)\s*$/g, "").trim();
                                        if (specKey) {
                                            if (bcIdKey) broadcastedCatalogIds.add(`${bcIdKey}_${specKey}`);
                                            if (bcTitleKey) broadcastedCatalogIds.add(`${bcTitleKey}_${specKey}`);
                                        } else {
                                            if (bcIdKey) broadcastedCatalogIds.add(bcIdKey);
                                            if (bcTitleKey) broadcastedCatalogIds.add(bcTitleKey);
                                        }
                                        try {
                                            const bDir = path.dirname(BROADCASTED_CATALOG_FILE);
                                            if (!fs.existsSync(bDir)) fs.mkdirSync(bDir, { recursive: true });
                                            fs.writeFileSync(BROADCASTED_CATALOG_FILE, JSON.stringify(Array.from(broadcastedCatalogIds)), "utf8");
                                        } catch (sErr) {}

                                        await db.collection("requests").doc(docId).update({
                                            channelPosted: true,
                                            channelMessageId: pubResult.message_id,
                                            channelPostedAt: admin.firestore.FieldValue.serverTimestamp()
                                        }).catch(() => {});
                                    } else {
                                        console.warn(`[CHANNEL PUBLISH] publishMovieToChannel returned null/skipped for "${title}".`);
                                        _channelPostingLocks.delete(fullKey);
                                        _channelPostingLocks.delete(movieKey);
                                        _channelPostingLocks.delete(rawClean);
                                    }
                                } catch (cpErr) {
                                    console.error(`[CHANNEL PUBLISH] Failed to auto-publish "${title}" to main channel:`, cpErr);
                                    _channelPostingLocks.delete(fullKey);
                                    _channelPostingLocks.delete(movieKey);
                                    _channelPostingLocks.delete(rawClean);
                                }
                            })();
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
                                    detailText = `🚀 <b>Season Update!</b>\n\n<b>${escapeHtml(sLabel)}</b> of <b>${cleanUserTitle}</b> has just been added! To download remaining seasons, open Film House App! 🍿`;
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
                                const allAdmins = await getAllAdminIds();

                                const pendingCount = cachedPendingRequests.length;
                                const fulfilledBy = data.fulfilledBy || data.adminClaimName || "An Admin";
                                const cleanAdminTitle = escapeHtml(title || "Movie");
                                const cleanAdminYear = year ? ` (${escapeHtml(year)})` : "";
                                const cleanFulfilledBy = escapeHtml(fulfilledBy);
                                const cleanReqUser = escapeHtml(username || `User ${userId}`);
                                const displayUser = cleanReqUser.startsWith('@') ? cleanReqUser : `@${cleanReqUser}`;

                                // Track fulfillment counts per admin in Firestore safely (verified admin only)
                                let adminTotalFulfillCount = 0;
                                const rawAdminId = data.fulfilledById || (fulfilledBy && fulfilledBy.toLowerCase() !== 'admin' ? fulfilledBy : null);
                                if (rawAdminId) {
                                    const adminIdKey = String(rawAdminId).replace(/[^a-zA-Z0-9_]/g, "_");
                                    try {
                                        const statsDocRef = db.collection("settings").doc("admin_stats");
                                        const statsDoc = await statsDocRef.get();
                                        let currentStats = statsDoc && statsDoc.exists ? statsDoc.data() || {} : {};
                                        // Purge fake legacy "admin" or "Admin" key if present
                                        delete currentStats.admin;
                                        delete currentStats.Admin;
                                        const adminStat = currentStats[adminIdKey] || { count: 0, fulfillments: 0, name: fulfilledBy };
                                        adminStat.count = (adminStat.count || 0) + 1;
                                        adminStat.fulfillments = (adminStat.fulfillments || 0) + 1;
                                        adminStat.name = fulfilledBy || adminStat.name;
                                        adminStat.lastFulfilledAt = Date.now();
                                        adminStat.lastActiveAt = Date.now();
                                        adminTotalFulfillCount = adminStat.fulfillments || adminStat.count;
                                        currentStats[adminIdKey] = adminStat;
                                        await statsDocRef.set(currentStats, { merge: true });
                                    } catch (statErr) {
                                        console.warn("Could not update admin fulfillment stats:", statErr.message);
                                    }
                                }

                                recordLog("admin_app", `Request fulfilled: "${cleanAdminTitle}" by ${cleanFulfilledBy}`);

                                const fulfillDateFormatted = formatRequestDateTime(new Date(), true);
                                const countBadge = adminTotalFulfillCount > 0 ? ` (${adminTotalFulfillCount} Fulfilled 🏆)` : "";
                                const adminNotifyText = `✅ <b>Request Fulfilled!</b>\n\n` +
                                                     `🎬 <b>Title:</b> <b>${cleanAdminTitle}</b>${cleanAdminYear}\n` +
                                                     `👤 <b>Fulfilled by:</b> ${cleanFulfilledBy}${countBadge}\n` +
                                                     `🍿 <b>Requested for:</b> ${displayUser} (ID: <code>${escapeHtml(userId)}</code>)\n` +
                                                     `📅 <b>Fulfilled:</b> ${fulfillDateFormatted}\n\n` +
                                                     `⚡ <b>Remaining Queue:</b> <code>${pendingCount}</code> pending request(s) left.`;

                                for (const adminId of allAdmins) {
                                    try {
                                        const adminUrl = `https://dans123456.github.io/filmhouse/admin.html?tg_id=${adminId}`;
                                        const adminPanelBtn = String(adminId).startsWith("-")
                                            ? { text: "👑 Open Film House Admin 🚀", url: adminUrl }
                                            : { text: "👑 Open Film House Admin 🚀", web_app: { url: adminUrl } };
                                        const adminReplyMarkup = {
                                            inline_keyboard: [
                                                ...(downloadLink ? [[{ text: "📥 Download Movie / Series 🍿", url: downloadLink }]] : []),
                                                [adminPanelBtn]
                                            ]
                                        };
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
                            `✅ <b>Mining Cycle Complete!</b> 💎\n\n` +
                            `Awesome job! Your 8-hour session has finished and your <b>Loyalty Points</b> are ready to claim. ⛏️\n\n` +
                            `🍿 <b>Cinema Perk:</b> Redeem your Loyalty Points for an <b>Ad-Free Cinema Streaming Pass</b> or VIP High-Speed streaming! 🎬\n\n` +
                            `Tap below to claim your points and dive into your favorite movies:`,
                            {
                                parse_mode: "HTML",
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            {
                                                text: "Claim Points & Watch 🍿",
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
                if (err.message && !err.message.includes("RESOURCE_EXHAUSTED") && !err.message.includes("Quota exceeded")) {
                    console.error("Error in farming reminder cron loop:", err.message);
                }
            }
        }, 15 * 60 * 1000); // check every 15 minutes instead of every 60 seconds

        // Automated Smart Ongoing Series Tracker (Smart Polling, Hiatus Handling, Admin Alerts & Cleanup)
        const { startSeriesTrackerService } = require("./seriesTracker.js");
        startSeriesTrackerService(db, adminBot || bot);

        // Graceful shutdown hooks
        
        // Setup Firestore listener for remote tasks (e.g. 1-click update from Admin Console)
        let isTaskProcessing = false;
        db.collection("settings").doc("server_tasks").onSnapshot(async (docSnap) => {
            if (!docSnap.exists) return;
            const task = docSnap.data();
            if (task.action === "git_update" && task.status === "pending") {
                if (isTaskProcessing) return;
                
                const taskTime = task.timestamp ? (task.timestamp.toMillis ? task.timestamp.toMillis() : new Date(task.timestamp).getTime()) : 0;
                if (taskTime && (Date.now() - taskTime > 3 * 60 * 1000)) {
                    console.log("[ServerTasks] Ignoring stale update request from:", task.requestedBy);
                    await db.collection("settings").doc("server_tasks").set({ status: "expired" }, { merge: true });
                    return;
                }

                isTaskProcessing = true;
                console.log(`[ServerTasks] Received remote git_update request from admin: ${task.requestedBy || "unknown"}`);
                
                await db.collection("settings").doc("server_tasks").set({
                    status: "in_progress",
                    progressText: "Pulling latest code from GitHub...",
                    startedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                const updateResult = await performServerGitUpdate(async (step) => {
                    try {
                        await db.collection("settings").doc("server_tasks").set({
                            progressText: step
                        }, { merge: true });
                    } catch (e) {}
                });

                if (updateResult.success) {
                    await db.collection("settings").doc("server_tasks").set({
                        status: "completed",
                        alreadyUpToDate: !!updateResult.alreadyUpToDate,
                        output: updateResult.output || "",
                        message: updateResult.message || "Completed successfully",
                        completedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                } else {
                    await db.collection("settings").doc("server_tasks").set({
                        status: "failed",
                        error: updateResult.error || "Unknown error during update",
                        output: updateResult.output || "",
                        failedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
                isTaskProcessing = false;
            }
        }, (err) => {
            console.warn("[ServerTasks] Snapshot listener notice:", err.message);
        });

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
