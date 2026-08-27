// Early Telegram WebApp initialization to prevent loading splash hang
if (window.Telegram && window.Telegram.WebApp) {
    try {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
    } catch (e) {
        console.warn("Early Telegram WebApp initialization warning:", e);
    }
}

// Native Telegram WebApp Haptic Feedback Helper
function triggerHaptic(type = "light") {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        try {
            const haptic = window.Telegram.WebApp.HapticFeedback;
            if (type === "success" || type === "error" || type === "warning") {
                haptic.notificationOccurred(type);
            } else if (type === "selection") {
                haptic.selectionChanged();
            } else {
                haptic.impactOccurred(type);
            }
        } catch (e) {
            console.warn("Haptic feedback failed:", e);
        }
    }
}

// Clean request/catalog titles by stripping trailing parenthesis groups (e.g. season or custom version suffixes)
function getCleanRequestTitle(title) {
    if (!title) return "";
    return title.replace(/\s*\([^)]+\)\s*$/g, "").trim();
}

// Helper to determine if a movie/series is currently ongoing / releasing weekly episodes
function isMovieOngoing(movie) {
    if (!movie) return false;
    if (movie.status === "Ended" || movie.status === "Canceled") return false;
    if (movie.isOngoing === true) return true;
    if (movie.isOngoing === false) return false;
    if (movie.status === "Ongoing" || movie.status === "Returning Series" || movie.status === "In Production" || movie.in_production === true) return true;
    if (movie.next_episode_to_air) return true;
    if (movie.categories && Array.isArray(movie.categories) && movie.categories.some(c => c.toLowerCase().includes("ongoing"))) return true;
    const isTV = (movie.type || "").toLowerCase() === "series" || (movie.type || "").toLowerCase() === "tv";
    if (isTV && (movie.links && movie.links.some(l => (typeof l === 'object' && l !== null && (l.type === "weekly" || (l.season && l.season.toLowerCase().includes("ongoing"))))))) return true;
    return false;
}

// Async helper to dynamically query TMDB for series airing status and update isOngoing in real-time
async function checkTvSeriesOngoingStatus(movie) {
    if (!movie) return false;
    const isTV = (movie.type || "").toLowerCase() === "series" || (movie.type || "").toLowerCase() === "tv" || (movie.categories && movie.categories.some(c => c.toLowerCase().includes("series")));
    if (!isTV) return false;

    if (typeof movie.isOngoing === "boolean") return movie.isOngoing;

    const apiKey = typeof getTmdbApiKey === "function" ? getTmdbApiKey() : "d638f7775bfa1b8d456dfd028ccbef19";
    const tmdbId = movie.tmdb_id || (movie.id && !isNaN(parseInt(movie.id, 10)) ? parseInt(movie.id, 10) : null);

    let tvData = null;
    if (tmdbId) {
        try {
            const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`);
            if (res.ok) tvData = await res.json();
        } catch (e) {}
    }

    const searchTitle = typeof getCleanRequestTitle === "function" ? getCleanRequestTitle(movie.title || "") : (movie.title || "");
    if (!tvData && searchTitle) {
        try {
            const res = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(searchTitle)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.results && data.results.length > 0) {
                    const tvId = data.results[0].id;
                    const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${tvId}?api_key=${apiKey}`);
                    if (detailRes.ok) tvData = await detailRes.json();
                }
            }
        } catch (e) {}
    }

    if (tvData) {
        movie.status = tvData.status || movie.status;
        movie.in_production = tvData.in_production;
        movie.next_episode_to_air = tvData.next_episode_to_air;

        if (tvData.status === "Ended" || tvData.status === "Canceled") {
            movie.isOngoing = false;
        } else if (tvData.status === "Returning Series" || tvData.status === "In Production" || tvData.status === "In Development" || tvData.in_production === true || tvData.next_episode_to_air !== null) {
            movie.isOngoing = true;
        } else if (tvData.first_air_date && new Date(tvData.first_air_date).getFullYear() >= 2025) {
            movie.isOngoing = true;
        } else if (tvData.last_episode_to_air && tvData.last_episode_to_air.air_date) {
            const lastAir = new Date(tvData.last_episode_to_air.air_date);
            const daysDiff = (new Date() - lastAir) / (1000 * 60 * 60 * 24);
            if (daysDiff <= 45) {
                movie.isOngoing = true;
            }
        }
    }

    return isMovieOngoing(movie);
}

// Helper to generate floating ONGOING badge element for movie posters
function getOngoingBadgeElement(movie) {
    if (!movie || !isMovieOngoing(movie)) return null;
    const badge = document.createElement("div");
    badge.className = "movie-card-ongoing-badge";
    badge.style.cssText = "position: absolute; bottom: 8px; right: 8px; background: linear-gradient(135deg, #ff0055, #ff2a2a); color: #ffffff; font-size: 9px; font-weight: 800; padding: 3px 7px; border-radius: 4px; z-index: 4; box-shadow: 0 2px 8px rgba(255,0,85,0.5); display: flex; align-items: center; gap: 3px; letter-spacing: 0.5px;";
    badge.innerHTML = "<span>🔴</span><span>ONGOING</span>";
    return badge;
}

// Helper to determine if a movie is upcoming / coming soon
function isMovieUpcoming(movie) {
    if (!movie) return false;
    if (movie.isUpcoming === true) return true;
    if (movie.categories && Array.isArray(movie.categories) && movie.categories.some(c => c.toLowerCase().includes("upcoming") || c.toLowerCase().includes("coming soon"))) return true;
    if (movie.status && (movie.status === "In Production" || movie.status === "Post Production" || movie.status === "Planned" || movie.status === "Upcoming")) return true;
    if (movie.release_date) {
        const relYear = parseInt(movie.release_date.substring(0, 4), 10);
        const currentYear = new Date().getFullYear();
        if (relYear > currentYear) return true;
    }
    return false;
}

// Helper to generate floating UPCOMING badge element for movie posters
function getUpcomingBadgeElement(movie) {
    if (!movie || !isMovieUpcoming(movie)) return null;
    const badge = document.createElement("div");
    badge.className = "movie-card-upcoming-badge";
    badge.style.cssText = "position: absolute; bottom: 8px; right: 8px; background: linear-gradient(135deg, #00c6ff, #0072ff); color: #ffffff; font-size: 9px; font-weight: 800; padding: 3px 7px; border-radius: 4px; z-index: 4; box-shadow: 0 2px 8px rgba(0,198,255,0.5); display: flex; align-items: center; gap: 3px; letter-spacing: 0.5px;";
    badge.innerHTML = "<span>✨</span><span>COMING SOON</span>";
    return badge;
}

// Helper to generate floating CINEMA CUT / HDCAM badge element for movie posters
function getCinemaCutBadgeElement(movie) {
    if (!movie || !movie.links || !Array.isArray(movie.links)) return null;
    const hasCinemaCut = movie.links.some(l => {
        const q = (typeof l === 'object' && l !== null ? (l.quality || "") : "").toLowerCase();
        return q.includes("cinema cut") || q.includes("hdcam") || q.includes("cam");
    });
    if (!hasCinemaCut) return null;

    const badge = document.createElement("div");
    badge.className = "movie-card-cinemacut-badge";
    badge.style.cssText = "position: absolute; bottom: 8px; left: 8px; background: linear-gradient(135deg, #ff9800, #ff5722); color: #ffffff; font-size: 9px; font-weight: 800; padding: 3px 7px; border-radius: 4px; z-index: 4; box-shadow: 0 2px 8px rgba(255,152,0,0.5); display: flex; align-items: center; gap: 3px; letter-spacing: 0.5px;";
    badge.innerHTML = "<span>📽️</span><span>CINEMA CUT</span>";
    return badge;
}

// Load Eruda In-App Mobile Console if ?debug=true is passed in URL
(function() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === 'true') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/eruda';
            script.onload = function() {
                eruda.init();
                console.log("Eruda Mobile Debugger successfully initialized!");
            };
            document.head.appendChild(script);
        }
    } catch (e) {
        console.warn("Could not load Eruda debugger:", e);
    }
})();

// Helper to detect if app is running in Beta Environment mode (?env=beta or ?beta=true)
function isBetaEnvironment() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('env') === 'beta' || params.get('beta') === 'true') return true;
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
            const startParam = window.Telegram.WebApp.initDataUnsafe.start_param || "";
            if (startParam.includes("beta")) return true;
        }
    } catch (e) {}
    return false;
}

// Dynamically render BETA STAGING badge if ?env=beta is present
document.addEventListener("DOMContentLoaded", () => {
    if (isBetaEnvironment()) {
        const brandTitle = document.querySelector(".brand-title");
        if (brandTitle && !brandTitle.querySelector(".beta-staging-tag")) {
            brandTitle.style.display = "inline-flex";
            brandTitle.style.alignItems = "center";
            brandTitle.style.gap = "6px";
            
            const badge = document.createElement("span");
            badge.className = "beta-staging-tag";
            badge.style.cssText = "font-size: 9px; line-height: 1; background: rgba(0, 198, 255, 0.15); color: #00c6ff; border: 1px solid rgba(0, 198, 255, 0.4); padding: 3px 7px; border-radius: 4px; font-weight: 800; letter-spacing: 0.5px; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;";
            badge.innerHTML = "<span>🧪</span><span>BETA STAGING</span>";
            brandTitle.appendChild(badge);
        }
    }
});

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

// Firebase Configuration & Admin Panel Settings
const ADMIN_TELEGRAM_IDS = ["123456789"]; // Add your Telegram user ID here to access the admin dashboard
const firebaseConfig = {
    apiKey: "AIzaSyCXs2tNgG07tAlsCkR96PNNIVIDyDkJD78",
    authDomain: "film-house-2.firebaseapp.com",
    projectId: "film-house-2",
    storageBucket: "film-house-2.firebasestorage.app",
    messagingSenderId: "698060918982",
    appId: "1:698060918982:web:cf5fd73cc71aef002907c7"
};

let db = null;
let globalAdminIds = ["1329840839", "1175336733"];
let firestoreTmdbApiKey = null;

if (typeof firebase !== "undefined") {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        
        // Load TMDB API Key from Firestore settings
        db.collection("settings").doc("tmdb").get().then(doc => {
            if (doc.exists && doc.data().apiKey) {
                firestoreTmdbApiKey = doc.data().apiKey;
                console.log("TMDB API Key loaded from Firestore settings.");
            }
        }).catch(err => console.warn("Failed to load TMDB API key from Firestore:", err));
    } catch (e) {
        console.error("Firebase initialization failed:", e);
    }
}

// TMDB Configuration & Constants
// TMDB API Key retrieval function (prevents hardcoded secrets in source code files)
function getTmdbApiKey() {
    const userKey = localStorage.getItem("filmhouse_tmdb_key");
    if (userKey) return userKey;
    if (firestoreTmdbApiKey) return firestoreTmdbApiKey;
    // Log a warning regarding demo key usage for horizontal scaling and security
    console.warn("Using fallback demo TMDB API key. Please set your own key in Profile settings!");
    return "d638f7775bfa1b8d456dfd028ccbef19";
}
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const CSV_FILE_PATH = "./MOVIE/Data/datafile.csv";
const JSON_FILE_PATH = "./MOVIE/Data/movies_metadata.json";

// Adsgram Ad Placement Configuration
const ADSGRAM_DOWNLOAD_BLOCK_ID = "36631";
const ADSGRAM_REQUEST_BLOCK_ID = "36680"; // Updated to request placement block ID
const ADSGRAM_TASK_BLOCK_ID = "task-36911"; // Set to your Adsgram Task Block ID (CPA format)

// State Management Object
const state = {
    movies: [],            // Complete list of enriched movies
    filteredMovies: [],    // Currently active subset after search/category filter
    watchlist: [],         // IDs of movies in the watchlist
    history: [],           // IDs of recently viewed movies
    editorPicks: [],       // Admin picks IDs for Editor's Choice carousel
    editorsChoiceTitle: "Editor's Choice 🎬", // Customizable spotlight section title
    visibleCount: 24,      // Snappy DOM load limits
    activeCategory: "Main",
    searchQuery: "",
    user: {
        id: "000000000",
        username: "demouser",
        fullName: "Demo User",
        avatar: "img/FilmHouse3_nobg.png",
        greetingFontStyle: "default",
        points: 0,
        badge: "",
        badgeExpiresAt: 0,
        farmingStartedAt: 0,
        checkInStreak: 0,
        lastCheckInDate: "",
        pointsBreakdown: { downloads: 0, visits: 0, shares: 0, watched: 0 },
        dailyStats: {
            date: "",
            checkInClaimed: false,
            sharesCount: 0,
            shareClaimed: false,
            adWatchesCount: 0,
            adWatchesClaimed: false,
            downloadsCount: 0,
            downloadsClaimed: false,
            inviteShared: false
        }
    },
    isTelegram: false,
    filters: {
        genre: "All",
        genre2: "All",
        selectedGenres: ["All"],
        rating: 0,
        year: "All"
    },
    carouselIndex: 0,
    carouselInterval: null,
    adsgramControllers: {},
    activeWatchlistTab: "watchlist",
    externalSearchResults: [],
    upcomingMovies: [],
    ongoingMovies: [],
    categoryTmdbMovies: {},
    isLoadingTmdbCategory: false,
    lastDiscoverQuery: null
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

// SVG Icon Helper
function createSvgIcon(iconId, className = "icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${iconId}`);
    svg.appendChild(use);
    return svg;
}

// Toast Notifications Helper
function showToast(message, type = "success", action = null) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    const textNode = document.createElement("span");
    textNode.textContent = message;
    toast.appendChild(textNode);

    if (action) {
        const actionBtn = document.createElement("button");
        actionBtn.className = "toast-action-btn";
        actionBtn.textContent = action.text;
        actionBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            action.callback();
            toast.classList.add("fade-out");
            setTimeout(() => toast.remove(), 300);
        });
        toast.appendChild(actionBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "toast-close-btn";
    closeBtn.ariaLabel = "Close notification";
    
    const closeIcon = createSvgIcon("icon-close", "toast-close-icon");
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener("click", () => {
        toast.classList.add("fade-out");
        setTimeout(() => toast.remove(), 300);
    });
    
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    // Auto-remove toast
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.add("fade-out");
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
}

// Delay Helper for batch requests
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper to shuffle movies randomly
function shuffleAndPinNewMovies(movies) {
    if (!movies || movies.length === 0) return [];

    const shuffled = [...movies];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Dynamic Enrichment & Database Loader
async function initializeDatabase() {
    const statusEl = document.getElementById("preloader-status");
    let loadedFromServer = false;
    
    // 1. Try to load pre-enriched JSON
    try {
        statusEl.textContent = "Loading catalog metadata...";
        const response = await fetch(`${JSON_FILE_PATH}?t=${Date.now()}`);
        if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
                // Auto-migration for manually added/imported entries missing categories or assets
                data.forEach(m => {
                    // Prepend MOVIE/ to local assets relative paths to resolve 404s
                    if (m.poster && m.poster.startsWith("img/")) {
                        m.poster = "MOVIE/" + m.poster;
                    }
                    if (m.backdrop && m.backdrop.startsWith("img/")) {
                        m.backdrop = "MOVIE/" + m.backdrop;
                    }
                    
                    if (!m.categories || !Array.isArray(m.categories) || m.categories.length === 0) {
                        m.categories = ["Main"];
                        const isTV = (m.type || "").toLowerCase() === "series" || (m.type || "").toLowerCase() === "tv";
                        if (isTV) {
                            m.categories.push("Hollywood/British Series");
                        } else {
                            m.categories.push("Hollywood/British Movies");
                        }
                    }
                    if (!m.poster) {
                        m.poster = "MOVIE/img/FilmHouse3_nobg.png";
                    }
                    
                    // Precompute search string for highly responsive filtering
                    m._searchStr = [
                        m.title,
                        m.overview,
                        (m.genres || []).join(" "),
                        (m.cast || []).join(" "),
                        m.director,
                        m.type,
                        (m.categories || []).join(" ")
                    ].filter(Boolean).join(" ").toLowerCase();
                });
                state.newMovieIds = data.slice(0, 10).map(m => m.csv_id);
                state.movies = shuffleAndPinNewMovies(data);
                statusEl.textContent = "Starting Film House...";
                loadedFromServer = true;
                
                // Clear old client-side cache so it doesn't build up or conflict
                localStorage.removeItem("filmhouse_enriched_db_v5");
            }
        }
    } catch (e) {
        console.warn("Could not load local JSON metadata, falling back to client-side CSV load: ", e);
    }

    // 2. Load from localStorage cache ONLY if server fetch failed
    if (!loadedFromServer) {
        const cachedData = localStorage.getItem("filmhouse_enriched_db_v5");
        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                // If the cache was generated in the subfolder, prepend MOVIE/ to local assets
                parsed.forEach(m => {
                    if (m.poster && m.poster.startsWith("img/")) {
                        m.poster = "MOVIE/" + m.poster;
                    }
                    if (m.backdrop && m.backdrop.startsWith("img/")) {
                        m.backdrop = "MOVIE/" + m.backdrop;
                    }
                    
                    // Precompute search string for highly responsive filtering
                    m._searchStr = [
                        m.title,
                        m.overview,
                        (m.genres || []).join(" "),
                        (m.cast || []).join(" "),
                        m.director,
                        m.type,
                        (m.categories || []).join(" ")
                    ].filter(Boolean).join(" ").toLowerCase();
                });
                state.newMovieIds = parsed.slice(0, 10).map(m => m.csv_id);
                state.movies = shuffleAndPinNewMovies(parsed);
                statusEl.textContent = "Loading cached database...";
            } catch (e) {
                localStorage.removeItem("filmhouse_enriched_db_v5");
            }
        }
    }
    


    if (state.movies && state.movies.length > 0) {
        return;
    }

    // 3. Fallback: Parse CSV and enrich dynamically
    statusEl.textContent = "Fetching movie list...";
    let csvData = [];
    try {
        const response = await fetch(`${CSV_FILE_PATH}?t=${Date.now()}`);
        const text = await response.text();
        
        // Use PapaParse if loaded
        if (window.Papa) {
            const parsed = window.Papa.parse(text, { header: false });
            csvData = parsed.data;
        } else {
            // Manual CSV split fallback
            csvData = text.split("\n").map(line => line.split(","));
        }
    } catch (err) {
        console.error("Failed to fetch movies.csv", err);
        statusEl.textContent = "Error loading movies catalog.";
        return;
    }

    // Filter valid rows (skip header)
    const rows = csvData.filter((row, idx) => idx > 0 && row.length > 0 && row[0].trim());
    const enrichedList = [];
    
    // Setup client-side API progress screen
    const total = rows.length;
    statusEl.textContent = `Synchronizing with TMDB API (first-time setup: 0/${total})...`;
    
    // Fetch details in batches to stay within safe client-side rate limits
    for (let i = 0; i < total; i++) {
        const row = rows[i];
        // New CSV format: Title, ID (may include slug), Type, Links...
        const row_title = row[0] ? row[0].trim() : "null";
        const raw_id = row[1] ? row[1].trim() : "";
        // Extract numeric TMDB ID from slug format like "243875-georgie-mandy-s-first-marriage"
        const movie_id_str = raw_id.split("-")[0] || raw_id;
        const row_type = row[2] ? row[2].trim() : "movie";
        const links = row.slice(3).map(lnk => lnk.trim()).filter(lnk => lnk);
        
        statusEl.textContent = `Synchronizing with TMDB API (first-time setup: ${i + 1}/${total})...`;
        
        let details = null;
        if (movie_id_str && !isNaN(movie_id_str)) {
            const tmdb_id = parseInt(movie_id_str);
            const isTV = row_type.toLowerCase() === "tv" || row_type.toLowerCase().includes("series") || row_type.toLowerCase().includes("cartoon");
            
            // Try matching media endpoint
            const endpoint = isTV ? "tv" : "movie";
            try {
                const res = await fetch(`${TMDB_BASE_URL}/${endpoint}/${tmdb_id}?api_key=${getTmdbApiKey()}&append_to_response=credits,videos,external_ids`);
                if (res.ok) {
                    details = await res.json();
                    details.media_type = isTV ? 'tv' : 'movie';
                } else if (!isTV) {
                    // Fallback try tv show details
                    const fallbackRes = await fetch(`${TMDB_BASE_URL}/tv/${tmdb_id}?api_key=${getTmdbApiKey()}&append_to_response=credits,videos,external_ids`);
                    if (fallbackRes.ok) {
                        details = await fallbackRes.json();
                        details.media_type = 'tv';
                    }
                }
            } catch (err) {
                console.error(`Error querying ID ${tmdb_id}`, err);
            }
        }

        // Search by Title if ID fails or is empty
        if (!details && row_title && row_title.toLowerCase() !== "null") {
            try {
                const searchRes = await fetch(`${TMDB_BASE_URL}/search/multi?api_key=${getTmdbApiKey()}&query=${encodeURIComponent(row_title)}`);
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData.results && searchData.results.length > 0) {
                        const bestMatch = searchData.results[0];
                        const mType = bestMatch.media_type === 'tv' ? 'tv' : 'movie';
                        const detailRes = await fetch(`${TMDB_BASE_URL}/${mType}/${bestMatch.id}?api_key=${getTmdbApiKey()}&append_to_response=credits,videos,external_ids`);
                        if (detailRes.ok) {
                            details = await detailRes.json();
                            details.media_type = mType;
                        }
                    }
                }
            } catch (err) {
                console.error(`Error searching title ${row_title}`, err);
            }
        }

        // Extract metadata fields
        let title = row_title;
        let overview = "No synopsis available.";
        let poster = "img/FilmHouse3_nobg.png";
        let backdrop = "img/FilmHouse.png";
        let rating = 0.0;
        let releaseDate = "";
        let lang = "en";
        let genres = [];
        let cast = [];
        let director = "";
        let trailer = "";
        let runtime = "";
        let mType = 'movie';
        let imdbId = "";

        if (details) {
            title = details.title || details.name || row_title;
            overview = details.overview || overview;
            rating = details.vote_average || rating;
            lang = details.original_language || lang;
            releaseDate = details.release_date || details.first_air_date || "";
            mType = details.media_type || 'movie';
            imdbId = details.imdb_id || (details.external_ids ? details.external_ids.imdb_id : "") || "";
            
            // Runtime
            if (details.runtime) {
                runtime = `${details.runtime} min`;
            } else if (details.episode_run_time && details.episode_run_time.length > 0) {
                runtime = `${details.episode_run_time[0]} min`;
            }

            if (details.poster_path) poster = `https://image.tmdb.org/t/p/w500${details.poster_path}`;
            if (details.backdrop_path) backdrop = `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`;

            // Genres
            if (details.genres) genres = details.genres.map(g => g.name);

            // Cast
            if (details.credits && details.credits.cast) {
                cast = details.credits.cast.slice(0, 5).map(c => c.name);
            }

            // Crew / Director
            if (mType === 'movie' && details.credits && details.credits.crew) {
                const dir = details.credits.crew.find(c => c.job === 'Director');
                if (dir) director = dir.name;
            } else if (details.created_by && details.created_by.length > 0) {
                director = details.created_by[0].name;
            }

            // Trailer
            if (details.videos && details.videos.results) {
                const tr = details.videos.results.find(v => v.site === 'YouTube' && v.type === 'Trailer');
                if (tr) trailer = tr.key;
            }
        } else {
            mType = (row_type.toLowerCase() === 'tv' || row_type.toLowerCase().includes('series')) ? 'tv' : 'movie';
        }

        // Evaluate Categories
        const categories = ["Main"];
        const titleLower = title.toLowerCase();
        
        // Classify Category Rules
        const eroticTitles = ["365 days", "fifty shades", "fatal seduction", "sex education", "erotic"];
        if (anyMatch(titleLower, eroticTitles)) categories.push("Erotic Movies");

        if (lang === "ko" || titleLower.includes("korean") || anyMatch(titleLower, ["boys over flowers", "squid game"])) {
            categories.push("Korean Drama");
        }

        const isIndian = lang === "hi" || lang === "te" || lang === "ta" || (details && details.production_countries && details.production_countries.some(c => c.iso_3166_1 === 'IN'));
        if (isIndian || titleLower.includes("bollywood")) {
            categories.push("Bollywood");
        }

        const africanCountries = ["ZA", "NG", "GH", "KE", "EG", "MA", "ET"];
        const isAfricanCountry = details && (
            (mType === 'movie' && details.production_countries && details.production_countries.some(c => africanCountries.includes(c.iso_3166_1))) ||
            (mType === 'tv' && details.origin_country && details.origin_country.some(c => africanCountries.includes(c)))
        );
        if (isAfricanCountry || anyMatch(titleLower, ["yolo", "blood and water", "blood & water", "supacell"])) {
            categories.push("African");
        }

        const isJP = details && (
            (mType === 'movie' && details.production_countries && details.production_countries.some(c => c.iso_3166_1 === 'JP')) ||
            (mType === 'tv' && details.origin_country && details.origin_country.some(c => c === 'JP'))
        );
        if (isJP && genres.includes("Animation")) {
            categories.push("Anime");
        } else if (titleLower.includes("anime")) {
            categories.push("Anime");
        }

        if (genres.includes("Animation") && !categories.includes("Anime")) {
            categories.push("Animated Movies");
        }

        const kidsKeywords = [
            "drake and josh", "henry danger", "sam and cat", "thundermans", 
            "victorious", "zoey 101", "nicky ricky", "gravity falls", 
            "baymax", "casagrandes", "carrossel", "loud house", 
            "phineas and ferb", "nickelodeon", "disney", "icarly", "matilda", "jessie"
        ];
        if (genres.includes("Family") || genres.includes("Kids") || anyMatch(titleLower, kidsKeywords)) {
            categories.push("Kids Shows and Movies (Nickelodeon and Disney)");
        }

        let releaseYear = 0;
        if (releaseDate && releaseDate.length >= 4) {
            releaseYear = parseInt(releaseDate.substring(0, 4)) || 0;
        }
        const classicKeywords = [
            "chucky", "child's play", "bride of chucky", "seed of chucky", "curse of chucky", 
            "cult of chucky", "american pie", "american wedding", "american reunion", 
            "naked mile", "beta house", "girls' rules", "band camp", "hole in one"
        ];
        if ((releaseYear > 0 && releaseYear < 2000) || anyMatch(titleLower, classicKeywords)) {
            categories.push("Classic Movies");
        }

        const comicKeywords = [
            "marvel", "avengers", "spider-man", "spidey", "iron man", "captain america", "thor", 
            "guardians of the galaxy", "loki", "wandavision", "hulk", "deadpool", "wolverine", 
            "venom", "shang-chi", "eternals", "black widow", "hawkeye", "ms. marvel", "moon knight", 
            "she-hulk", "werewolf by night", "black panther", "echo", "madame web", "x-men", "kraven", 
            "daredevil", "born again", "ironheart", "fantastic 4", "wonder man", "gen v", "the boys", 
            "invincible", "punisher", "batman", "superman", "shazam", "black adam", "dc comics", 
            "blue beetle", "kakegurui", "hit-monkey", "m.o.d.o.k.", "what if...?"
        ];
        const isToAllTheBoys = titleLower.includes("to all the boys");
        if (anyMatch(titleLower, comicKeywords) && !isToAllTheBoys) {
            categories.push("Comic");
        }

        const isRegional = categories.some(cat => ["Korean Drama", "Bollywood", "African", "Anime"].includes(cat));
        if (!isRegional) {
            if (mType === 'tv') {
                categories.push("Hollywood/British Series");
            } else {
                categories.push("Hollywood/British Movies");
            }
        }

        const movieObj = {
            csv_id: movie_id_str,
            tmdb_id: details ? details.id : null,
            imdb_id: imdbId,
            title,
            type: mType === 'tv' ? "Series" : "Movie",
            categories,
            genres,
            overview,
            poster,
            backdrop,
            rating: Math.round(rating * 10) / 10,
            release_date: releaseDate,
            language: lang,
            cast,
            director,
            trailer,
            runtime,
            links
        };
        movieObj._searchStr = [
            movieObj.title,
            movieObj.overview,
            (movieObj.genres || []).join(" "),
            (movieObj.cast || []).join(" "),
            movieObj.director,
            movieObj.type,
            (movieObj.categories || []).join(" ")
        ].filter(Boolean).join(" ").toLowerCase();
        enrichedList.push(movieObj);

        // Small spacing delay between fetch calls to avoid API lockups
        await delay(60);
    }

    state.newMovieIds = enrichedList.slice(0, 10).map(m => m.csv_id);
    state.movies = shuffleAndPinNewMovies(enrichedList);
    localStorage.setItem("filmhouse_enriched_db_v5", JSON.stringify(enrichedList));
    statusEl.textContent = "Complete!";

    // 4. Start real-time Firestore sync of custom catalog additions/updates
    if (typeof firebase !== "undefined" && db) {
        db.collection("movies").onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                const docData = change.doc.data();
                const csv_id = change.doc.id;
                
                docData.csv_id = csv_id;
                
                // Prepend MOVIE/ to local assets relative paths to resolve 404s
                if (docData.poster && docData.poster.startsWith("img/")) {
                    docData.poster = "MOVIE/" + docData.poster;
                }
                if (docData.backdrop && docData.backdrop.startsWith("img/")) {
                    docData.backdrop = "MOVIE/" + docData.backdrop;
                }
                if (!docData.poster) {
                    docData.poster = "MOVIE/img/FilmHouse3_nobg.png";
                }
                
                // Precompute search index
                docData._searchStr = [
                    docData.title,
                    docData.overview,
                    (docData.genres || []).join(" "),
                    (docData.cast || []).join(" "),
                    docData.director,
                    docData.type,
                    (docData.categories || []).join(" ")
                ].filter(Boolean).join(" ").toLowerCase();

                if (change.type === "added" || change.type === "modified") {
                    // Ensure local category array has correct subcategories based on media type
                    if (!docData.categories || !Array.isArray(docData.categories) || docData.categories.length <= 1) {
                        docData.categories = docData.categories || ["Main"];
                        if (!docData.categories.includes("Main")) {
                            docData.categories.push("Main");
                        }
                        const isTV = (docData.type || "").toLowerCase() === "series" || (docData.type || "").toLowerCase() === "tv";
                        const subCat = isTV ? "Hollywood/British Series" : "Hollywood/British Movies";
                        if (!docData.categories.includes(subCat)) {
                            docData.categories.push(subCat);
                        }
                    }

                    const idx = state.movies.findIndex(m => m.csv_id === csv_id);
                    if (idx !== -1) {
                        state.movies[idx] = { ...state.movies[idx], ...docData };
                    } else {
                        state.movies.unshift(docData);
                        if (state.newMovieIds && !state.newMovieIds.includes(csv_id)) {
                            state.newMovieIds.push(csv_id);
                        }
                    }
                } else if (change.type === "removed") {
                    state.movies = state.movies.filter(m => m.csv_id !== csv_id);
                    if (state.newMovieIds) {
                        state.newMovieIds = state.newMovieIds.filter(id => id !== csv_id);
                    }
                }
            });
            
            // Re-render feed display if currently active on home screen
            if (state.activeScreen === "home") {
                renderFeaturedGrid();
                renderCarouselBanner();
                renderEditorsChoice();
            }
        }, err => console.warn("Firestore live catalog sync warning:", err));
    }
}

function anyMatch(text, arr) {
    return arr.some(el => text.includes(el));
}

// Telegram mini-app login handling
function handleTelegramAuth() {
    const tg = window.Telegram?.WebApp;
    if (tg) {
        state.isTelegram = true;
        try {
            tg.ready();
            tg.expand();
            // Color header match application theme if supported (v6.1+)
            if (tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) {
                try {
                    tg.setHeaderColor('#07080c');
                    tg.setBackgroundColor('#07080c');
                } catch (colorErr) {
                    console.warn("Theme coloring not supported:", colorErr);
                }
            }
        } catch (e) {
            console.error("TG WebApp SDK execution issue:", e);
        }

        // Get WebApp User Details
        const tgUser = tg.initDataUnsafe?.user;
        if (tgUser) {
            state.user.id = tgUser.id ? String(tgUser.id) : state.user.id;
            state.user.username = tgUser.username || "";
            state.user.fullName = [tgUser.first_name, tgUser.last_name].filter(n => n).join(" ") || state.user.fullName || "Telegram User";
            if (tgUser.photo_url) {
                state.user.avatar = tgUser.photo_url;
            }
        }
    }

    // Refresh UI components with user details
    const headerAvatar = document.getElementById("header-user-avatar");
    const headerName = document.getElementById("header-user-name");
    const profileAvatarImg = document.getElementById("profile-avatar-img");
    const profileFullName = document.getElementById("profile-full-name");
    const profileTelegramTag = document.getElementById("profile-telegram-tag");
    const profileTelegramId = document.getElementById("profile-telegram-id");

    if (headerAvatar) headerAvatar.src = state.user.avatar;
    if (headerName) headerName.textContent = state.user.fullName || state.user.username || "Guest";
    if (profileAvatarImg) profileAvatarImg.src = state.user.avatar;
    if (profileFullName) profileFullName.textContent = state.user.fullName;
    if (profileTelegramTag) profileTelegramTag.textContent = state.user.username ? `@${state.user.username}` : "No handle";
    if (profileTelegramId) profileTelegramId.textContent = `ID: ${state.user.id}`;
}
// User Profile Management & Loaders
function loadUserProfile() {
    const defaultProfile = {
        fullName: state.user.fullName,
        avatar: state.user.avatar,
        greetingFontStyle: "default",
        favoriteCategories: [],
        notificationsEnabled: true,
        subAnime: true,
        subHollywood: true,
        subRecs: true,
        contactPreference: "telegram",
        points: 0
    };
    
    let profile = defaultProfile;
    const saved = localStorage.getItem("filmhouse_user_profile");
    if (saved) {
        try {
            profile = JSON.parse(saved);
        } catch (e) {
            console.error("Failed to parse user profile:", e);
        }
    }


    // Merge into state
    state.user.fullName = profile.fullName || state.user.fullName;
    state.user.greetingFontStyle = profile.greetingFontStyle || "default";
    if (state.user.points === 0 && profile.points) {
        state.user.points = profile.points;
    }
    state.user.badge = profile.badge || null;
    state.user.badgeExpiresAt = profile.badgeExpiresAt || 0;
    state.user.farmingStartedAt = profile.farmingStartedAt || 0;
    state.user.checkInStreak = profile.checkInStreak || 0;
    state.user.lastCheckInDate = profile.lastCheckInDate || "";
    if ((!state.user.pointsBreakdown || state.user.pointsBreakdown.downloads === 0) && profile.pointsBreakdown) {
        state.user.pointsBreakdown = profile.pointsBreakdown;
    }
    state.user.dailyStats = profile.dailyStats || {
        date: new Date().toISOString().split("T")[0],
        checkInClaimed: false,
        sharesCount: 0,
        shareClaimed: false,
        adWatchesCount: 0,
        adWatchesClaimed: false,
        downloadsCount: 0,
        downloadsClaimed: false,
        inviteShared: false
    };
    checkAndResetDailyMissions();
    
    if (profile.avatar) {
        const isCustomUploaded = profile.avatar.startsWith("data:");
        const hasTelegramPhoto = state.user.avatar && state.user.avatar.startsWith("http");
        // Only overwrite fresh Telegram photo if user uploaded a custom base64 image
        if (isCustomUploaded || !hasTelegramPhoto) {
            state.user.avatar = profile.avatar;
        }
    }
    
    // Resolve relative default avatar paths dynamically to prevent 404s between root & subfolder
    if (state.user.avatar && !state.user.avatar.startsWith("data:") && !state.user.avatar.startsWith("http")) {
        const isSubfolder = window.location.pathname.includes("/MOVIE/");
        if (isSubfolder) {
            state.user.avatar = "img/FilmHouse3_nobg.png";
        } else {
            state.user.avatar = "MOVIE/img/FilmHouse3_nobg.png";
        }
    }
    
    state.user.favoriteCategories = profile.favoriteCategories || [];
    state.user.notificationsEnabled = profile.notificationsEnabled !== undefined ? profile.notificationsEnabled : true;
    state.user.subAnime = profile.subAnime !== undefined ? profile.subAnime : true;
    state.user.subHollywood = profile.subHollywood !== undefined ? profile.subHollywood : true;
    state.user.subRecs = profile.subRecs !== undefined ? profile.subRecs : true;
    state.user.contactPreference = profile.contactPreference || "telegram";

    // Sync input values in UI
    const inputName = document.getElementById("edit-profile-name");
    if (inputName) inputName.value = state.user.fullName;

    // Sync greeting font style selectors in UI
    const editFontStyleSelect = document.getElementById("edit-profile-font-style");
    if (editFontStyleSelect) editFontStyleSelect.value = state.user.greetingFontStyle;
    const pageFontStyleSelect = document.getElementById("profile-page-font-style");
    if (pageFontStyleSelect) pageFontStyleSelect.value = state.user.greetingFontStyle;

    const notifToggle = document.getElementById("settings-notifications-toggle");
    if (notifToggle) notifToggle.checked = state.user.notificationsEnabled;

    const subAnimeCheck = document.getElementById("sub-opt-anime");
    if (subAnimeCheck) subAnimeCheck.checked = state.user.subAnime;

    const subHollywoodCheck = document.getElementById("sub-opt-hollywood");
    if (subHollywoodCheck) subHollywoodCheck.checked = state.user.subHollywood;

    const subRecsCheck = document.getElementById("sub-opt-recs");
    if (subRecsCheck) subRecsCheck.checked = state.user.subRecs;

    // Toggle options panel visibility based on notificationsEnabled
    const subOptionsPanel = document.getElementById("notification-sub-options");
    if (subOptionsPanel) {
        subOptionsPanel.style.display = state.user.notificationsEnabled ? "flex" : "none";
    }

    // Sync Profile Screen Fields
    const pageName = document.getElementById("profile-page-name");
    if (pageName) pageName.value = state.user.fullName;

    const displayFullName = document.getElementById("profile-display-name");
    if (displayFullName) displayFullName.textContent = state.user.fullName || "Guest User";
    
    const displayUsername = document.getElementById("profile-display-username");
    if (displayUsername) displayUsername.textContent = state.user.username ? `@${state.user.username}` : "No handle";

    const pageAvatar = document.getElementById("profile-page-avatar");
    if (pageAvatar) pageAvatar.src = state.user.avatar;

    const pageTgTag = document.getElementById("profile-page-telegram-tag");
    if (pageTgTag) pageTgTag.value = state.user.username ? `@${state.user.username}` : "No handle";

    const pageTgId = document.getElementById("profile-page-telegram-id");
    if (pageTgId) pageTgId.value = state.user.id;

    const pageContactPref = document.getElementById("profile-page-contact-pref");
    if (pageContactPref) pageContactPref.value = state.user.contactPreference;

    // Sync all header/avatar images
    const headerAvatar = document.getElementById("header-user-avatar");
    if (headerAvatar) headerAvatar.src = state.user.avatar;

    const headerName = document.getElementById("header-user-name");
    if (headerName) headerName.textContent = state.user.fullName || state.user.username || "Guest";

    const profileAvatarImg = document.getElementById("profile-avatar-img");
    if (profileAvatarImg) profileAvatarImg.src = state.user.avatar;

    const profileFullName = document.getElementById("profile-full-name");
    if (profileFullName) profileFullName.textContent = state.user.fullName;

    // Build favorite genres checklist dynamically
    renderFavoriteCategoriesChecklist();
    
    // Check if VIP Custom Badge has expired before syncing UI
    checkVipBadgeExpiry();
    
    // Sync points UI elements
    updatePointsUI();

    // Sync profile movie summary sections
    renderProfileMovieSummaries();

    // Sync profile data to Firestore database on startup (with load check)
    syncUserToFirestore(true);

    // Start real-time listener for user's movie requests
    startUserRequestsListener();

    // Merge locally cached self-healed TMDB details
    try {
        const healedCacheStr = localStorage.getItem("filmhouse_healed_movies");
        if (healedCacheStr) {
            const healedMap = JSON.parse(healedCacheStr);
            state.movies.forEach(m => {
                const healed = healedMap[m.csv_id];
                if (healed) {
                    if (healed.poster && (!m.poster || m.poster.includes("FilmHouse3_nobg.png"))) {
                        m.poster = healed.poster;
                    }
                    if (healed.backdrop && (!m.backdrop || m.backdrop.includes("FilmHouse.png"))) {
                        m.backdrop = healed.backdrop;
                    }
                    if (healed.rating > 0 && !m.rating) {
                        m.rating = healed.rating;
                    }
                    if (healed.release_date && !m.release_date) {
                        m.release_date = healed.release_date;
                    }
                    if (healed.overview && (!m.overview || m.overview === "No synopsis available.")) {
                        m.overview = healed.overview;
                    }
                }
            });
        }
    } catch (e) {
        console.warn("Could not merge healed movie details cache:", e);
    }
    
    // Sync top-left personalized name greeting
    updateUserGreeting();
}

// Render Watchlist and Watched List mini horizontal scrolls on the Profile page
function renderProfileMovieSummaries() {
    const watchlistScroll = document.getElementById("profile-watchlist-scroll-container");
    const watchedScroll = document.getElementById("profile-watched-scroll-container");
    
    // 1. Populate Watchlist summaries
    if (watchlistScroll) {
        watchlistScroll.replaceChildren();
        const watchlistMovies = state.movies.filter(m => state.watchlist.includes(m.csv_id));
        
        const countLabel = document.getElementById("profile-watchlist-count-label");
        if (countLabel) countLabel.textContent = watchlistMovies.length;
        
        if (watchlistMovies.length === 0) {
            const empty = document.createElement("div");
            empty.className = "profile-movies-empty";
            empty.textContent = "Your watchlist is empty. Save movies to see them here!";
            watchlistScroll.appendChild(empty);
        } else {
            watchlistMovies.forEach(movie => {
                const poster = document.createElement("img");
                poster.className = "profile-movie-poster";
                poster.src = movie.poster;
                poster.alt = movie.title;
                poster.title = movie.title;
                poster.addEventListener("click", () => openDetailModal(movie));
                watchlistScroll.appendChild(poster);
            });
        }
    }
    
    // 2. Populate Watched history summaries
    if (watchedScroll) {
        watchedScroll.replaceChildren();
        const watchedMovies = state.movies.filter(m => state.history.includes(m.csv_id));
        
        const countLabel = document.getElementById("profile-watched-count-label");
        if (countLabel) countLabel.textContent = watchedMovies.length;
        
        if (watchedMovies.length === 0) {
            const empty = document.createElement("div");
            empty.className = "profile-movies-empty";
            empty.textContent = "No watched movies yet. Mark movies as watched to see them here!";
            watchedScroll.appendChild(empty);
        } else {
            watchedMovies.forEach(movie => {
                const poster = document.createElement("img");
                poster.className = "profile-movie-poster";
                poster.src = movie.poster;
                poster.alt = movie.title;
                poster.title = movie.title;
                poster.addEventListener("click", () => openDetailModal(movie));
                watchedScroll.appendChild(poster);
            });
        }
    }
}


// Leaderboard competitors list
const LEADERBOARD_COMPETITORS = [
    { username: "cinemaprince", fullName: "Cinema Prince", points: 780, avatar: "img/FilmHouse1.png", badge: "Cinema King" },
    { username: "moviefanatic", fullName: "Movie Fanatic", points: 540, avatar: "img/FilmHouse2.png", badge: "Super Fan" },
    { username: "hollywoodking", fullName: "Hollywood King", points: 420, avatar: "img/FilmHouse3.png", badge: "Movie Buff" },
    { username: "filmguru", fullName: "Film Guru", points: 310, avatar: "img/FilmHouse.png", badge: "Guru" },
    { username: "bingewatcher", fullName: "Binge Watcher", points: 210, avatar: "img/FilmHouse1.png", badge: "Marathoner" },
    { username: "kdramalover", fullName: "K-Drama Lover", points: 120, avatar: "img/FilmHouse2.png", badge: "K-Drama Fan" },
];

function getDynamicLeaderboard() {
    const isSubfolder = window.location.pathname.includes("/MOVIE/");
    const prefix = isSubfolder ? "" : "MOVIE/";
    
    // Build list of competitors with dynamic paths
    const list = LEADERBOARD_COMPETITORS.map(c => ({
        ...c,
        avatar: c.avatar ? prefix + c.avatar : ""
    }));
    
    // Add current user
    list.push({
        username: state.user.username || "guest",
        fullName: state.user.fullName || "Guest Collector",
        points: state.user.points || 0,
        avatar: state.user.avatar || (prefix + "img/FilmHouse3_nobg.png"),
        badge: getAchievementBadge(state.user.points || 0, state.user.badge),
        isCurrentUser: true
    });
    
    // Sort descending
    list.sort((a, b) => b.points - a.points);
    return list;
}

function getAchievementBadge(points, userBadge) {
    if (userBadge) return userBadge;
    if (points >= 500) return "Cinema King";
    if (points >= 300) return "Movie Buff";
    if (points >= 150) return "Super Fan";
    if (points >= 50) return "Active Critic";
    return "New Collector";
}

function calculateUserRank() {
    const list = getDynamicLeaderboard();
    const userIndex = list.findIndex(item => item.isCurrentUser);
    return userIndex !== -1 ? userIndex + 1 : list.length;
}

function awardPoints(points, reason) {
    state.user.points = (state.user.points || 0) + points;
    
    if (!state.user.pointsBreakdown) {
        state.user.pointsBreakdown = { downloads: 0, visits: 0, shares: 0, watched: 0 };
    }
    if (reason === "download" && points > 0) {
        state.user.pointsBreakdown.downloads = (state.user.pointsBreakdown.downloads || 0) + 1;
        updateMissionProgress("download", 1);
    } else if (reason === "visit" && points > 0) {
        state.user.pointsBreakdown.visits = (state.user.pointsBreakdown.visits || 0) + 1;
    } else if (reason === "share" && points > 0) {
        state.user.pointsBreakdown.shares = (state.user.pointsBreakdown.shares || 0) + 1;
        updateMissionProgress("share", 1);
    } else if (reason === "watched") {
        if (points > 0) {
            state.user.pointsBreakdown.watched = (state.user.pointsBreakdown.watched || 0) + 1;
            updateMissionProgress("ad", 1);
        } else {
            state.user.pointsBreakdown.watched = Math.max(0, (state.user.pointsBreakdown.watched || 0) - 1);
        }
    }
    
    // Save to user profile in localStorage
    const saved = localStorage.getItem("filmhouse_user_profile");
    let profile = {};
    if (saved) {
        try {
            profile = JSON.parse(saved);
        } catch (e) {}
    }
    profile.points = state.user.points;
    profile.pointsBreakdown = state.user.pointsBreakdown;
    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
    
    // Sync to Firebase Firestore
    syncUserToFirestore();
    
    // Update UI components
    updatePointsUI();
    
    // Render Leaderboard dynamically if active
    const leaderboardScreen = document.getElementById("screen-leaderboard");
    if (leaderboardScreen && leaderboardScreen.classList.contains("active")) {
        renderLeaderboard();
    }
    
    // Notify the user via toast
    let reasonText = "";
    if (reason === "download") reasonText = "downloading a movie";
    else if (reason === "task") reasonText = "completing the task";
    else if (reason === "visit") reasonText = "your daily visit";
    else if (reason === "share") reasonText = "sharing a movie";
    else if (reason === "mining") reasonText = "mining rewards";
    else if (reason === "watched") reasonText = points > 0 ? "marking a movie as watched" : "removing a movie from watched list";
    
    if (points > 0) {
        showToast(`Earned +${points} Loyalty Points for ${reasonText}! 🏆`, "success");
    } else if (points < 0) {
        showToast(`Removed ${Math.abs(points)} Loyalty Points for ${reasonText}.`, "info");
    }
}

function updatePointsUI() {
    // 1. Drawer stat point counts
    const drawerPoints = document.getElementById("stat-profile-points-drawer");
    if (drawerPoints) drawerPoints.textContent = state.user.points || 0;

    // 1b. Rewards Drawer points display
    const rewardsPoints = document.getElementById("rewards-points-display");
    if (rewardsPoints) rewardsPoints.textContent = state.user.points || 0;
    
    // 2. Profile screen points counts
    const profilePoints = document.getElementById("profile-loyalty-points");
    if (profilePoints) profilePoints.textContent = state.user.points || 0;
    
    // 3. Profile screen rank label
    const profileRankLabel = document.getElementById("profile-loyalty-rank-label");
    if (profileRankLabel) {
        if (typeof globalAdminIds !== "undefined" && globalAdminIds.includes(String(state.user.id))) {
            profileRankLabel.textContent = "Global Ranking: Staff Curator 👑";
        } else if (typeof firebase !== "undefined" && db) {
            db.collection("users").where("points", ">", state.user.points || 0).get().then(snap => {
                let nonAdminGreaterCount = 0;
                snap.forEach(doc => {
                    const uid = doc.data().id ? String(doc.data().id) : "";
                    if (typeof globalAdminIds !== "undefined" && !globalAdminIds.includes(uid)) {
                        nonAdminGreaterCount++;
                    }
                });
                const rank = nonAdminGreaterCount + 1;
                db.collection("users").get().then(totalSnap => {
                    let totalUsersCount = 0;
                    totalSnap.forEach(doc => {
                        const uid = doc.data().id ? String(doc.data().id) : "";
                        if (typeof globalAdminIds !== "undefined" && !globalAdminIds.includes(uid)) {
                            totalUsersCount++;
                        }
                    });
                    profileRankLabel.textContent = `Global Ranking: #${rank} of ${totalUsersCount || totalSnap.size}`;
                }).catch(() => {
                    profileRankLabel.textContent = `Global Ranking: #${rank}`;
                });
            }).catch(err => {
                const rank = calculateUserRank();
                profileRankLabel.textContent = `Global Ranking: #${rank} of ${LEADERBOARD_COMPETITORS.length + 1}`;
            });
        } else {
            const rank = calculateUserRank();
            profileRankLabel.textContent = `Global Ranking: #${rank} of ${LEADERBOARD_COMPETITORS.length + 1}`;
        }
    }

    // 4. Points Breakdown list updates
    const bkD = document.getElementById("breakdown-downloads");
    const bkV = document.getElementById("breakdown-visits");
    const bkS = document.getElementById("breakdown-shares");
    const bkW = document.getElementById("breakdown-watched");
    
    const breakdown = state.user.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 };
    
    if (bkD) bkD.textContent = `${breakdown.downloads * 10} pts (${breakdown.downloads} downloads)`;
    if (bkV) bkV.textContent = `${breakdown.visits * 5} pts (${breakdown.visits} visits)`;
    if (bkS) bkS.textContent = `${breakdown.shares * 2} pts (${breakdown.shares} shares)`;
    if (bkW) bkW.textContent = `${breakdown.watched * 5} pts (${breakdown.watched} watched)`;

    // 5. Update VIP Badge active status / expiry info in Reward Center
    const vipCard = document.querySelector('[data-reward-id="vip-badge"]')?.closest('.reward-item-card');
    if (vipCard) {
        const descEl = vipCard.querySelector('p');
        const btnEl = vipCard.querySelector('button');
        if (state.user.badge && state.user.badgeExpiresAt > Date.now()) {
            const timeLeftMs = state.user.badgeExpiresAt - Date.now();
            const daysLeft = Math.ceil(timeLeftMs / (24 * 60 * 60 * 1000));
            if (descEl) descEl.innerHTML = `<span style="color: #ffbc00; font-weight: 700;">★ Active Badge: "${escapeHTML(state.user.badge)}"</span><br><span style="color: var(--text-secondary); font-size: 10px;">Expires in ${daysLeft} day(s).</span>`;
            if (btnEl) {
                btnEl.textContent = "Active";
                btnEl.disabled = true;
                btnEl.style.opacity = "0.6";
                btnEl.style.background = "var(--border-color)";
                btnEl.style.borderColor = "var(--border-color)";
            }
        } else {
            if (descEl) descEl.textContent = "Stand out on the leaderboard with a custom VIP tag (lasts 7 days).";
            if (btnEl) {
                btnEl.textContent = "2,500 pts";
                btnEl.disabled = false;
                btnEl.style.opacity = "";
                btnEl.style.background = "";
                btnEl.style.borderColor = "";
            }
        }
    }

    // 6. Update Ad-Free active status / expiry info in Reward Center
    const adFreeCard = document.querySelector('[data-reward-id="ad-free"]')?.closest('.reward-item-card');
    if (adFreeCard) {
        const descEl = adFreeCard.querySelector('p');
        const btnEl = adFreeCard.querySelector('button');
        const adFreeUntil = parseInt(localStorage.getItem("ad_free_until") || "0");
        if (adFreeUntil > Date.now()) {
            const timeLeftMs = adFreeUntil - Date.now();
            const hoursLeft = Math.ceil(timeLeftMs / (60 * 60 * 1000));
            if (descEl) descEl.innerHTML = `<span style="color: #ffbc00; font-weight: 700;">★ Active Ad-Free Pass</span><br><span style="color: var(--text-secondary); font-size: 10px;">Expires in ${hoursLeft} hour(s).</span>`;
            if (btnEl) {
                btnEl.textContent = "Active";
                btnEl.disabled = true;
                btnEl.style.opacity = "0.6";
                btnEl.style.background = "var(--border-color)";
                btnEl.style.borderColor = "var(--border-color)";
            }
        } else {
            if (descEl) descEl.textContent = "Disable Adsgram ads when opening movies for 24 hours.";
            if (btnEl) {
                btnEl.textContent = "1,500 pts";
                btnEl.disabled = false;
                btnEl.style.opacity = "";
                btnEl.style.background = "";
                btnEl.style.borderColor = "";
            }
        }
    }

    // 7. Update Tier Badge and Progress Bar
    const tierIcon = document.getElementById("profile-tier-icon");
    const tierName = document.getElementById("profile-tier-name");
    const tierBadge = document.getElementById("profile-tier-badge");
    const progressFill = document.getElementById("profile-tier-progress-fill");
    const progressPercent = document.getElementById("profile-tier-progress-percent");
    const progressText = document.getElementById("profile-tier-progress-text");
    
    const pts = state.user.points || 0;
    const tier = getUserTier(pts);
    
    if (tierIcon) tierIcon.textContent = tier.icon;
    if (tierName) tierName.textContent = tier.name;
    if (tierBadge) {
        tierBadge.style.color = tier.color;
        tierBadge.style.borderColor = tier.borderColor;
        tierBadge.style.background = tier.bgColor;
    }
    
    if (tier.nextPts === null) {
        if (progressFill) progressFill.style.width = "100%";
        if (progressPercent) progressPercent.textContent = "100%";
        if (progressText) progressText.textContent = "Congratulations! You have reached the maximum VIP tier! 👑";
    } else {
        const range = tier.nextPts - tier.prevPts;
        const currentProgress = pts - tier.prevPts;
        const percentage = Math.min(100, Math.max(0, Math.round((currentProgress / range) * 100)));
        const ptsNeeded = tier.nextPts - pts;
        
        if (progressFill) progressFill.style.width = `${percentage}%`;
        if (progressPercent) progressPercent.textContent = `${percentage}%`;
        if (progressText) {
            const nextTier = getUserTier(tier.nextPts);
            progressText.textContent = `${ptsNeeded} points needed to unlock next rank (${nextTier.name} ${nextTier.icon})`;
        }
    }
}

function getUserTier(points) {
    const pts = parseInt(points || 0);
    if (pts >= 1000) {
        return {
            name: "VIP Director",
            icon: "👑",
            color: "#f5c518",
            bgColor: "rgba(245, 197, 24, 0.08)",
            borderColor: "rgba(245, 197, 24, 0.3)",
            nextPts: null,
            prevPts: 1000
        };
    }
    if (pts >= 500) {
        return {
            name: "Gold Collector",
            icon: "🥇",
            color: "#ffbc00",
            bgColor: "rgba(255, 188, 0, 0.08)",
            borderColor: "rgba(255, 188, 0, 0.3)",
            nextPts: 1000,
            prevPts: 500
        };
    }
    if (pts >= 100) {
        return {
            name: "Silver Critic",
            icon: "🥈",
            color: "#e0e0e0",
            bgColor: "rgba(255, 255, 255, 0.08)",
            borderColor: "rgba(255, 255, 255, 0.2)",
            nextPts: 500,
            prevPts: 100
        };
    }
    return {
        name: "Bronze Cinephile",
        icon: "🥉",
        color: "#cd7f32",
        bgColor: "rgba(205, 127, 50, 0.08)",
        borderColor: "rgba(205, 127, 50, 0.2)",
        nextPts: 100,
        prevPts: 0
    };
}

function checkDailyVisitPoints() {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const lastVisit = localStorage.getItem("filmhouse_last_visit_date");
    if (lastVisit !== today) {
        localStorage.setItem("filmhouse_last_visit_date", today);
        // Only award daily visit points if they have started/setup a profile
        if (localStorage.getItem("filmhouse_user_profile")) {
            setTimeout(() => {
                awardPoints(5, "visit");
            }, 2500);
        }
    }
}

let leaderboardUnsubscribe = null;

function renderLeaderboard() {
    const userRankCard = document.getElementById("leaderboard-user-rank-card");
    const rowsContainer = document.getElementById("leaderboard-rows-container");
    if (!userRankCard || !rowsContainer) return;
    
    // Clear previous listener if any
    if (typeof leaderboardUnsubscribe === "function") {
        try {
            leaderboardUnsubscribe();
        } catch (e) {
            console.warn("Error unsubscribing leaderboard:", e);
        }
        leaderboardUnsubscribe = null;
    }

    // Clear containers and show loading state
    userRankCard.innerHTML = `<div style="padding: 10px; text-align: center; color: var(--text-secondary); width: 100%;">Loading ranking...</div>`;
    rowsContainer.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-secondary);">Loading global leaderboard...</div>`;
    
    const badgePrefix = window.location.pathname.includes("/MOVIE/") ? "" : "MOVIE/";
    
    // If Firebase is available, load live leaderboard
    if (typeof firebase !== "undefined" && db) {
        db.collection("settings").doc("admins").get().then(adminDoc => {
            const adminIds = adminDoc.exists ? adminDoc.data().ids || [] : [];
            const defaultAdmins = ["1329840839", "1175336733"];
            const allAdminIds = Array.from(new Set([...defaultAdmins, ...adminIds]));

            // Subscribe to real-time updates using onSnapshot
            leaderboardUnsubscribe = db.collection("users").orderBy("points", "desc").limit(60).onSnapshot(async (snapshot) => {
                const list = [];
                const staffList = [];
                const seenIds = new Set();
                const seenUsernames = new Set();
                const seenFullNames = new Set();
                
                snapshot.forEach(doc => {
                    const u = doc.data();
                    const userIdStr = u.id ? String(u.id) : "";
                    
                    // Skip if duplicate ID
                    if (u.id && seenIds.has(u.id)) return;
                    // Skip if duplicate username (unless it is "guest" or empty)
                    if (u.username && u.username !== "guest" && u.username !== "" && seenUsernames.has(u.username)) return;
                    // Skip if duplicate display name (unless it is a generic guest/demo name)
                    const isGuestName = !u.fullName || u.fullName.includes("Guest") || u.fullName.includes("Demo User");
                    if (u.fullName && !isGuestName && u.fullName !== "" && seenFullNames.has(u.fullName)) return;
                    
                    if (u.id) seenIds.add(u.id);
                    if (u.username && u.username !== "guest" && u.username !== "") seenUsernames.add(u.username);
                    if (u.fullName && !isGuestName && u.fullName !== "") seenFullNames.add(u.fullName);
                    
                    const isMe = u.id === state.user.id;
                    const avatarVal = u.avatar || (badgePrefix + "img/FilmHouse3_nobg.png");
                    const badgeVal = getAchievementBadge(u.points || 0, u.badge);

                    const isStaff = allAdminIds.includes(userIdStr);
                    if (isStaff) {
                        staffList.push({
                            username: u.username || "guest",
                            fullName: u.fullName || "Guest Curator",
                            points: u.points || 0,
                            avatar: avatarVal,
                            badge: badgeVal,
                            isCurrentUser: isMe
                        });
                    } else {
                        // Limit output of regular leaderboard to top 25 unique users
                        if (list.length >= 25) return;
                        list.push({
                            username: u.username || "guest",
                            fullName: u.fullName || "Guest Collector",
                            points: u.points || 0,
                            avatar: avatarVal,
                            badge: badgeVal,
                            isCurrentUser: isMe
                        });
                    }
                });
                
                // If current user is not in top 25, get their rank
                let userRank = 1;
                try {
                    const allUsersSnapshot = await db.collection("users").where("points", ">", state.user.points || 0).get();
                    let nonAdminGreaterCount = 0;
                    allUsersSnapshot.forEach(doc => {
                        const uid = doc.data().id ? String(doc.data().id) : "";
                        if (!allAdminIds.includes(uid)) {
                            nonAdminGreaterCount++;
                        }
                    });
                    userRank = nonAdminGreaterCount + 1;
                } catch (e) {
                    console.error("Error fetching user rank:", e);
                    const index = list.findIndex(item => item.isCurrentUser);
                    userRank = index !== -1 ? index + 1 : list.length + 1;
                }
                
                const isCurrentUserStaff = allAdminIds.includes(String(state.user.id));
                displayLeaderboardData(list, userRank, staffList, isCurrentUserStaff);
            }, (err) => {
                console.warn("Failed to subscribe to live leaderboard, falling back to demo data:", err);
                renderStaticLeaderboard();
            });
        }).catch(err => {
            console.warn("Failed to load admins list, falling back to standard list:", err);
            renderStaticLeaderboard();
        });
    } else {
        renderStaticLeaderboard();
    }
    
    function renderStaticLeaderboard() {
        const list = getDynamicLeaderboard();
        const userRank = calculateUserRank();
        const isCurrentUserStaff = typeof globalAdminIds !== "undefined" && globalAdminIds.includes(String(state.user.id));
        displayLeaderboardData(list, userRank, [], isCurrentUserStaff);
    }
    
    function displayLeaderboardData(list, userRank, staffList = [], isCurrentUserStaff = false) {
        userRankCard.replaceChildren();
        rowsContainer.replaceChildren();
        
        const userAvatarPath = state.user.avatar || (badgePrefix + "img/FilmHouse3_nobg.png");
        
        let rankHTML = `
            <span style="font-size: 16px; font-weight: 800; color: #f5c518; display: block; line-height: 1;">#${userRank}</span>
            <span style="font-size: 10px; color: var(--text-secondary); font-weight: 500;">Rank | ${state.user.points || 0} pts</span>
        `;
        if (isCurrentUserStaff) {
            rankHTML = `
                <span style="font-size: 13px; font-weight: 800; color: var(--primary-color); display: block; line-height: 1.2; text-transform: uppercase;">👑 Staff</span>
                <span style="font-size: 9px; color: var(--text-secondary); font-weight: 500;">Curator | ${state.user.points || 0} pts</span>
            `;
        }
        
        const userCardHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <img src="${escapeHTML(userAvatarPath)}" alt="Your Avatar" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid #f5c518;" onerror="this.src='${badgePrefix}img/FilmHouse3_nobg.png'">
                <div>
                    <h4 style="font-size: 13px; font-weight: 700; margin: 0; color: var(--text-primary);">You (${escapeHTML(state.user.fullName)})</h4>
                    <span class="leaderboard-badge">${escapeHTML(getAchievementBadge(state.user.points || 0, state.user.badge))}</span>
                </div>
            </div>
            <div style="text-align: right;">
                ${rankHTML}
            </div>
        `;
        userRankCard.innerHTML = userCardHTML;
        
        // Render Pinned Staff / Curators if present
        if (staffList && staffList.length > 0) {
            const staffContainer = document.createElement("div");
            staffContainer.className = "leaderboard-pinned-staff-container";
            staffContainer.innerHTML = `
                <div class="leaderboard-pinned-staff-title">
                    <span>👑 Film House Curators</span>
                </div>
                <div class="leaderboard-pinned-staff-list">
                    ${staffList.map(s => `
                        <div class="leaderboard-staff-item">
                            <div class="leaderboard-staff-left">
                                <img src="${escapeHTML(s.avatar)}" alt="${escapeHTML(s.fullName)}" class="leaderboard-staff-avatar" onerror="this.src='${badgePrefix}img/FilmHouse3_nobg.png'">
                                <span class="leaderboard-staff-name">${escapeHTML(s.fullName)}</span>
                            </div>
                            <span class="leaderboard-staff-points">${s.points} pts</span>
                        </div>
                    `).join("")}
                </div>
            `;
            rowsContainer.appendChild(staffContainer);
        }
        
        list.forEach((item, index) => {
            const rank = index + 1;
            const row = document.createElement("div");
            row.className = `leaderboard-row ${item.isCurrentUser ? "current-user" : ""}`;
            
            let rankBadgeClass = "leaderboard-rank-default";
            let rankBadgeContent = rank;
            if (rank === 1) {
                rankBadgeClass = "leaderboard-rank-1";
                rankBadgeContent = "🥇";
            } else if (rank === 2) {
                rankBadgeClass = "leaderboard-rank-2";
                rankBadgeContent = "🥈";
            } else if (rank === 3) {
                rankBadgeClass = "leaderboard-rank-3";
                rankBadgeContent = "🥉";
            }
            
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="leaderboard-rank-badge ${rankBadgeClass}">${rankBadgeContent}</div>
                    <img src="${escapeHTML(item.avatar)}" alt="${escapeHTML(item.fullName)}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color);" onerror="this.src='${badgePrefix}img/FilmHouse3_nobg.png'">
                    <div>
                        <h4 style="font-size: 12px; font-weight: 600; margin: 0; color: ${item.isCurrentUser ? "#f5c518" : "var(--text-primary)"};">${escapeHTML(item.fullName)}</h4>
                        <span class="leaderboard-badge" style="font-size: 8px; padding: 1px 4px;">${escapeHTML(item.badge)}</span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 12px; font-weight: 700; color: var(--text-primary);">${item.points}</span>
                    <span style="font-size: 9px; color: var(--text-secondary); display: block;">pts</span>
                </div>
            `;
            rowsContainer.appendChild(row);
        });
    }
}

function renderFavoriteCategoriesChecklist() {
    const listContainers = [
        document.getElementById("edit-genres-checklist"),
        document.getElementById("profile-genres-checklist")
    ];

    const categoryList = [
        "Hollywood/British Movies", "Hollywood/British Series", 
        "Bollywood", "Korean Drama", "African", "Anime", "Comic", 
        "Animated Movies", "Kids Shows and Movies (Nickelodeon and Disney)", 
        "Classic Movies", "Erotic Movies", "Teen/High-School", "Christian Movies"
    ];

    const categoryLabels = {
        "Hollywood/British Movies": "Hollywood Movies",
        "Hollywood/British Series": "Hollywood Series",
        "Bollywood": "Bollywood",
        "Korean Drama": "K-Drama",
        "African": "African",
        "Anime": "Anime",
        "Comic": "Comic",
        "Animated Movies": "Animated",
        "Kids Shows and Movies (Nickelodeon and Disney)": "Kids / Family",
        "Classic Movies": "Classics",
        "Erotic Movies": "Romance / Erotic",
        "Teen/High-School": "Teen / High-School",
        "Christian Movies": "Christian"
    };

    listContainers.forEach(container => {
        if (!container) return;
        container.replaceChildren();

        categoryList.forEach(cat => {
            const label = document.createElement("label");
            label.style.display = "flex";
            label.style.alignItems = "center";
            label.style.gap = "8px";
            label.style.fontSize = "11px";
            label.style.color = "var(--text-secondary)";
            label.style.cursor = "pointer";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = cat;
            checkbox.checked = state.user.favoriteCategories.includes(cat);
            checkbox.style.cursor = "pointer";

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(categoryLabels[cat] || cat));

            container.appendChild(label);
        });
    });
}

function saveProfile(isFromPage = false) {
    if (isFromPage) {
        // Sync from Profile page fields
        const pageName = document.getElementById("profile-page-name");
        if (pageName) state.user.fullName = pageName.value.trim() || state.user.fullName;

        const pageFontStyle = document.getElementById("profile-page-font-style");
        if (pageFontStyle) state.user.greetingFontStyle = pageFontStyle.value;

        const pageContactPref = document.getElementById("profile-page-contact-pref");
        if (pageContactPref) state.user.contactPreference = pageContactPref.value;

        const checklist = document.getElementById("profile-genres-checklist");
        if (checklist) {
            const checked = [];
            const checkboxes = checklist.querySelectorAll("input[type='checkbox']");
            checkboxes.forEach(cb => {
                if (cb.checked) checked.push(cb.value);
            });
            state.user.favoriteCategories = checked;
        }
    } else {
        // Sync from Drawer fields
        const inputName = document.getElementById("edit-profile-name");
        if (inputName) state.user.fullName = inputName.value.trim() || state.user.fullName;

        const inputFontStyle = document.getElementById("edit-profile-font-style");
        if (inputFontStyle) state.user.greetingFontStyle = inputFontStyle.value;

        const checklist = document.getElementById("edit-genres-checklist");
        if (checklist) {
            const checked = [];
            const checkboxes = checklist.querySelectorAll("input[type='checkbox']");
            checkboxes.forEach(cb => {
                if (cb.checked) checked.push(cb.value);
            });
            state.user.favoriteCategories = checked;
        }

        const notifToggle = document.getElementById("settings-notifications-toggle");
        if (notifToggle) state.user.notificationsEnabled = notifToggle.checked;

        const subAnimeCheck = document.getElementById("sub-opt-anime");
        if (subAnimeCheck) state.user.subAnime = subAnimeCheck.checked;

        const subHollywoodCheck = document.getElementById("sub-opt-hollywood");
        if (subHollywoodCheck) state.user.subHollywood = subHollywoodCheck.checked;

        const subRecsCheck = document.getElementById("sub-opt-recs");
        if (subRecsCheck) state.user.subRecs = subRecsCheck.checked;
    }

    const profileObj = {
        fullName: state.user.fullName,
        avatar: state.user.avatar,
        greetingFontStyle: state.user.greetingFontStyle || "default",
        favoriteCategories: state.user.favoriteCategories,
        notificationsEnabled: state.user.notificationsEnabled,
        subAnime: state.user.subAnime,
        subHollywood: state.user.subHollywood,
        subRecs: state.user.subRecs,
        contactPreference: state.user.contactPreference,
        points: state.user.points || 0,
        pointsBreakdown: state.user.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 }
    };

    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profileObj));

    // Reload user profile in UI
    loadUserProfile();

    // Sync profile settings updates to Firestore
    syncUserToFirestore();

    showToast("Profile updated successfully!", "success");

    // Close edit drawer collapsible form if open
    const editSection = document.getElementById("profile-edit-section");
    const chevron = document.getElementById("edit-profile-chevron");
    if (editSection) editSection.style.display = "none";
    if (chevron) chevron.classList.remove("chevron-rotated");

    generateNotificationAlerts();
    renderEditorsChoice();
}

// Notifications Engine
function generateNotificationAlerts() {
    if (!state.user.notificationsEnabled) {
        state.notifications = [];
        updateNotificationsBadge();
        return;
    }

    const notifications = [];
    
    // Find Anime movie
    if (state.user.subAnime) {
        const animeMovie = state.movies.find(m => m.categories.includes("Anime"));
        if (animeMovie) {
            notifications.push({
                id: `notif-anime-${animeMovie.csv_id}`,
                title: "🔔 New Anime Alert",
                body: `New Release: "${animeMovie.title}" is now available in Anime!`,
                time: "2 hours ago",
                movieId: animeMovie.csv_id,
                unread: true
            });
        }
    }

    // Find Hollywood Movie
    if (state.user.subHollywood) {
        const hwMovie = state.movies.find(m => m.categories.includes("Hollywood/British Movies"));
        if (hwMovie) {
            notifications.push({
                id: `notif-hw-${hwMovie.csv_id}`,
                title: "🎬 Blockbuster Added",
                body: `Fresh from Hollywood: "${hwMovie.title}" is now ready to download.`,
                time: "5 hours ago",
                movieId: hwMovie.csv_id,
                unread: true
            });
        }
    }

    // Favorite Category Match
    state.user.favoriteCategories.forEach(cat => {
        const matchedMovie = state.movies.find(m => m.categories.includes(cat));
        if (matchedMovie) {
            if (!notifications.some(n => n.movieId === matchedMovie.csv_id)) {
                notifications.push({
                    id: `notif-pref-${matchedMovie.csv_id}`,
                    title: `✨ Preferred Category Update`,
                    body: `Based on your love for ${cat}: "${matchedMovie.title}" is featured now!`,
                    time: "1 day ago",
                    movieId: matchedMovie.csv_id,
                    unread: true
                });
            }
        }
    });

    // Recommendation Alert
    if (state.user.subRecs && state.watchlist.length > 0) {
        const watchlistMovies = state.movies.filter(m => state.watchlist.includes(m.csv_id));
        const categories = new Set();
        watchlistMovies.forEach(m => m.categories.forEach(c => categories.add(c)));
        
        const recMovie = state.movies.find(m => !state.watchlist.includes(m.csv_id) && m.categories.some(c => categories.has(c)));
        if (recMovie) {
            notifications.push({
                id: `notif-rec-${recMovie.csv_id}`,
                title: "💡 Recommended For You",
                body: `You might enjoy "${recMovie.title}" based on your watchlist!`,
                time: "Just now",
                movieId: recMovie.csv_id,
                unread: true
            });
        }
    }

    const storedStatus = JSON.parse(localStorage.getItem("filmhouse_notifications_status") || "{}");
    
    notifications.forEach(n => {
        if (storedStatus[n.id] !== undefined) {
            n.unread = storedStatus[n.id];
        }
    });

    state.notifications = notifications;
    updateNotificationsBadge();
}

// Stats badge updater
function updateNotificationsBadge() {
    const badge = document.getElementById("notifications-count-badge");
    if (!badge) return;

    const unreadCount = state.notifications.filter(n => n.unread).length;
    if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = "flex";
    } else {
        badge.style.display = "none";
    }
}

function renderNotificationsList() {
    const container = document.getElementById("notifications-list");
    const emptyState = document.getElementById("notifications-empty-state");
    const clearBtn = document.getElementById("btn-clear-notifications");

    if (!container || !emptyState || !clearBtn) return;
    container.replaceChildren();

    if (!state.notifications || state.notifications.length === 0) {
        emptyState.style.display = "flex";
        clearBtn.style.display = "none";
        return;
    }

    emptyState.style.display = "none";
    
    const unreadCount = state.notifications.filter(n => n.unread).length;
    clearBtn.style.display = unreadCount > 0 ? "block" : "none";

    state.notifications.forEach(n => {
        const card = document.createElement("div");
        card.className = `notification-card ${n.unread ? 'unread' : ''}`;
        
        const header = document.createElement("div");
        header.className = "notification-header";
        
        const title = document.createElement("span");
        title.className = "notification-title";
        title.textContent = n.title;
        header.appendChild(title);
        
        const time = document.createElement("span");
        time.className = "notification-time";
        time.textContent = n.time;
        header.appendChild(time);
        
        card.appendChild(header);

        const body = document.createElement("div");
        body.className = "notification-body";
        body.textContent = n.body;
        card.appendChild(body);

        card.addEventListener("click", () => {
            n.unread = false;
            const storedStatus = JSON.parse(localStorage.getItem("filmhouse_notifications_status") || "{}");
            storedStatus[n.id] = false;
            localStorage.setItem("filmhouse_notifications_status", JSON.stringify(storedStatus));
            
            const notifModal = document.getElementById("notifications-modal");
            if (notifModal) notifModal.classList.remove("active");
            
            const profileDrawer = document.getElementById("profile-drawer");
            if (profileDrawer) profileDrawer.classList.remove("active");

            const movie = state.movies.find(m => m.csv_id === n.movieId);
            if (movie) {
                openDetailModal(movie);
            }
            
            updateNotificationsBadge();
            renderNotificationsList();
        });

        container.appendChild(card);
    });
}

// Requested Badge Generator Helper
function getRequestedBadgeElement(movie) {
    if (!movie || typeof currentUserRequests === 'undefined' || !currentUserRequests || currentUserRequests.length === 0) return null;
    const cleanTitle = getCleanRequestTitle(movie.title).toLowerCase();
    const userReq = currentUserRequests.find(r => 
        r.title && getCleanRequestTitle(r.title).toLowerCase() === cleanTitle &&
        r.status !== "fulfilled"
    );
    if (!userReq) return null;
    
    const reqBadge = document.createElement("div");
    reqBadge.className = "movie-card-req-badge";
    reqBadge.style.cssText = "position: absolute; top: 6px; left: 6px; background: linear-gradient(135deg, #ffbc00, #ff8c00); color: #000; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 4px; z-index: 4; box-shadow: 0 2px 8px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 3px;";
    reqBadge.innerHTML = userReq.status === "priority" ? "<span>⚡</span><span>PRIORITY</span>" : "<span>⏳</span><span>REQUESTED</span>";
    return reqBadge;
}

// Watch History Render Modal Helpers
function renderHistoryGrid() {
    const container = document.getElementById("history-grid-container");
    const emptyState = document.getElementById("history-empty-state");
    const clearBtn = document.getElementById("btn-clear-history");

    if (!container || !emptyState || !clearBtn) return;
    container.replaceChildren();

    if (!state.history || state.history.length === 0) {
        emptyState.style.display = "flex";
        clearBtn.style.display = "none";
        return;
    }

    emptyState.style.display = "none";
    clearBtn.style.display = "block";

    const historyMovies = state.movies.filter(m => state.history.includes(m.csv_id));

    historyMovies.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card";
        card.dataset.id = movie.csv_id;

        const imgWrapper = document.createElement("div");
        imgWrapper.className = "movie-card-poster-wrapper";

        const img = document.createElement("img");
        img.className = "movie-card-poster";
        img.src = movie.poster;
        img.alt = movie.title;
        img.loading = "lazy";
        imgWrapper.appendChild(img);

        const reqBadge = getRequestedBadgeElement(movie);
        if (reqBadge) imgWrapper.appendChild(reqBadge);

        if (movie.rating > 0) {
            const rating = document.createElement("div");
            rating.className = "movie-card-rating";
            const star = createSvgIcon("icon-star", "star-card-icon");
            rating.appendChild(star);
            const score = document.createElement("span");
            score.textContent = movie.rating;
            rating.appendChild(score);
            imgWrapper.appendChild(rating);
        }

        const type = document.createElement("div");
        type.className = "movie-card-type-badge";
        type.textContent = movie.type;
        imgWrapper.appendChild(type);

        card.appendChild(imgWrapper);

        const info = document.createElement("div");
        info.className = "movie-card-info";

        const title = document.createElement("h4");
        title.className = "movie-card-title";
        title.textContent = movie.title;
        info.appendChild(title);

        const metaRow = document.createElement("div");
        metaRow.className = "movie-card-meta";

        const yearLabel = document.createElement("span");
        if (movie.release_date && movie.release_date.length >= 4) {
            yearLabel.textContent = movie.release_date.substring(0, 4);
        } else {
            yearLabel.textContent = "N/A";
        }
        metaRow.appendChild(yearLabel);

        info.appendChild(metaRow);
        card.appendChild(info);

        card.addEventListener("click", () => {
            const historyModal = document.getElementById("history-modal");
            if (historyModal) historyModal.classList.remove("active");

            const profileDrawer = document.getElementById("profile-drawer");
            if (profileDrawer) profileDrawer.classList.remove("active");

            openDetailModal(movie);
        });

        container.appendChild(card);
    });
}

function clearWatchHistory() {
    state.history = [];
    localStorage.setItem("filmhouse_history", JSON.stringify(state.history));
    
    const countLabel = document.getElementById("stat-history-count");
    if (countLabel) countLabel.textContent = 0;

    renderHistoryGrid();
    showToast("Watch history cleared!");
}

// View Routing Manager
function navigateToScreen(targetScreenId) {
    // Unsubscribe from leaderboard if navigating away
    if (targetScreenId !== "leaderboard" && typeof leaderboardUnsubscribe === "function") {
        try {
            leaderboardUnsubscribe();
        } catch (e) {
            console.warn("Error unsubscribing leaderboard:", e);
        }
        leaderboardUnsubscribe = null;
    }

    // Hide all screens
    const screens = document.querySelectorAll(".app-screen");
    screens.forEach(s => s.classList.remove("active"));

    // Deactivate bottom-nav highlights
    const navItems = document.querySelectorAll(".bottom-nav-item");
    navItems.forEach(item => item.classList.remove("active"));

    // Activate selected screen
    const activeScreen = document.getElementById(`screen-${targetScreenId}`);
    if (activeScreen) {
        activeScreen.classList.add("active");
    }

    // Toggle body class to hide bottom navigation bar on mobile if searching
    if (targetScreenId !== "home") {
        document.body.classList.remove("search-active");
    } else if (state.searchQuery && state.searchQuery.trim().length > 0) {
        document.body.classList.add("search-active");
    }

    // Highlight corresponding bottom navigation tab if applicable
    const activeNav = Array.from(navItems).find(item => item.getAttribute("data-target") === targetScreenId);
    if (activeNav) {
        activeNav.classList.add("active");
    }

    // Custom view actions
    if (targetScreenId === "home") {
        state.visibleCount = 24;
        renderFeaturedGrid();
        renderEditorsChoice();
    } else if (targetScreenId === "watchlist") {
        renderWatchlistGrid();
    } else if (targetScreenId === "profile") {
        loadUserProfile();
    } else if (targetScreenId === "mining") {
        updateFarmingUI();
        loadMiningTaskAd();
    } else if (targetScreenId === "leaderboard") {
        renderLeaderboard();
    }

    // Reset scroll positions
    window.scrollTo(0, 0);
}

// Populate Categories Selector
function renderCategoriesBar() {
    const bar = document.getElementById("categories-bar-slider");
    if (!bar) return;
    bar.replaceChildren();

    const categoryList = [
        "Main", "Ongoing Series", "Upcoming Movies", "Hollywood/British Movies", "Hollywood/British Series", 
        "Korean Drama", "Korean Movies", "Anime Series", "Anime Movies", 
        "Bollywood", "African", "Comic", "Animated Movies", 
        "Kids Shows and Movies (Nickelodeon and Disney)", 
        "Classic Movies", "Erotic Movies", "Teen/High-School", "Christian Movies"
    ];

    const categoryLabels = {
        "Main": "Featured",
        "Ongoing Series": "Ongoing 🔴",
        "Upcoming Movies": "Latest ⚡",
        "Latest Movies": "Latest ⚡",
        "Hollywood/British Movies": "Hollywood",
        "Hollywood/British Series": "Series",
        "Korean Drama": "Asian Drama 🫰",
        "Asian Drama": "Asian Drama 🫰",
        "Korean Movies": "Asian Movies 🎬",
        "Asian Movies": "Asian Movies 🎬",
        "Anime Series": "Anime 🥷",
        "Anime Movies": "Anime Movies 🎨",
        "Bollywood": "Bollywood",
        "African": "African",
        "Anime": "Anime",
        "Comic": "Comic",
        "Animated Movies": "Animated",
        "Kids Shows and Movies (Nickelodeon and Disney)": "Kids",
        "Classic Movies": "Classics",
        "Erotic Movies": "Erotic",
        "Teen/High-School": "Teen / High-School",
        "Christian Movies": "Christian"
    };

    const categoryEmojis = {
        "Main": "🍿",
        "Ongoing Series": "🔴",
        "Upcoming Movies": "✨",
        "Hollywood/British Movies": "🎬",
        "Hollywood/British Series": "📺",
        "Korean Drama": "🫰",
        "Korean Movies": "🎬",
        "Anime Series": "🥷",
        "Anime Movies": "🎨",
        "Bollywood": "🎶",
        "African": "🌍",
        "Anime": "🥷",
        "Comic": "💥",
        "Animated Movies": "🎨",
        "Kids Shows and Movies (Nickelodeon and Disney)": "🧸",
        "Classic Movies": "🎞️",
        "Erotic Movies": "💋",
        "Teen/High-School": "🏫",
        "Christian Movies": "⛪"
    };

    categoryList.forEach(cat => {
        const button = document.createElement("button");
        button.className = `category-pill ${state.activeCategory === cat ? 'active' : ''}`;
        button.title = categoryLabels[cat] || cat;

        const iconEl = document.createElement("span");
        iconEl.className = "category-pill-icon";
        iconEl.textContent = categoryEmojis[cat] || "🍿";
        button.appendChild(iconEl);

        const textLabel = document.createElement("span");
        textLabel.className = "category-pill-text";
        textLabel.textContent = categoryLabels[cat] || cat;
        button.appendChild(textLabel);

        button.addEventListener("click", () => {
            const activeEl = bar.querySelector(".category-pill.active");
            if (activeEl) activeEl.classList.remove("active");
            
            button.classList.add("active");
            state.activeCategory = cat;
            state.visibleCount = 24;
            
            const heading = document.getElementById("grid-title");
            if (heading) heading.textContent = categoryLabels[cat] || cat;

            renderFeaturedGrid();
            if (cat !== "Main") {
                fetchTmdbCategoryMovies(cat);
            }
        });

        bar.appendChild(button);
    });

    // Trigger scroll event to update arrow visibility indicators
    bar.dispatchEvent(new Event("scroll"));
}

// Render horizontal Genre filter chips
function renderGenreChips() {
    const wrapper = document.getElementById("genre-chips-wrapper");
    if (!wrapper) return;
    wrapper.replaceChildren();

    const genres = ["All", "Action", "Adventure", "Action & Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Kids", "Music", "Mystery", "News", "Reality", "Romance", "Sci-Fi", "Science Fiction", "Sci-Fi & Fantasy", "Soap", "Talk", "Thriller", "TV Movie", "War", "War & Politics", "Western"];
    
    genres.forEach(genre => {
        const chip = document.createElement("div");
        const isActive = state.filters.selectedGenres.includes(genre);
        chip.className = `genre-chip ${isActive ? "active" : ""}`;
        chip.textContent = genre;
        
        chip.addEventListener("click", () => {
            if (genre === "All") {
                state.filters.selectedGenres = ["All"];
            } else {
                // Remove "All" if it was active
                state.filters.selectedGenres = state.filters.selectedGenres.filter(g => g !== "All");
                
                // Toggle clicked genre
                if (state.filters.selectedGenres.includes(genre)) {
                    state.filters.selectedGenres = state.filters.selectedGenres.filter(g => g !== genre);
                } else {
                    state.filters.selectedGenres.push(genre);
                }
                
                // If empty, set back to "All"
                if (state.filters.selectedGenres.length === 0) {
                    state.filters.selectedGenres = ["All"];
                }
            }
            
            state.visibleCount = 24;
            
            // Re-render chips to update active styling
            renderGenreChips();
            renderFeaturedGrid();
        });
        
        wrapper.appendChild(chip);
    });
}

// Render Movie Grid
function renderFeaturedGrid(fromDiscover = false) {
    const grid = document.getElementById("movies-grid-container");
    if (!grid) return;
    grid.replaceChildren();

    const filtersActive = state.filters.genre !== "All" || state.filters.genre2 !== "All" || state.filters.rating > 0 || state.filters.year !== "All";

    // Toggle search-active class on screen-home for layout shifting
    const homeScreen = document.getElementById("screen-home");
    if (homeScreen) {
        if (state.searchQuery) {
            homeScreen.classList.add("search-active");
        } else {
            homeScreen.classList.remove("search-active");
        }
    }

    // Toggle Carousel and Editor's Choice visibility based on search activity, filter activity, or active category
    const carousel = document.getElementById("hero-carousel");
    const recs = document.getElementById("editors-choice-section-wrapper");
    if (state.searchQuery || state.activeCategory !== "Main" || filtersActive) {
        if (carousel) carousel.style.display = "none";
        if (recs) recs.style.display = "none";
    } else {
        if (carousel) carousel.style.display = "";
        renderEditorsChoice();
    }

    // Update Grid Title header based on search query or active category
    const heading = document.getElementById("grid-title");
    if (heading) {
        if (state.searchQuery) {
            heading.textContent = `Search Results for "${state.searchQuery}"`;
        } else {
            const categoryLabels = {
                "Main": "Featured",
                "Hollywood/British Movies": "Hollywood",
                "Hollywood/British Series": "Series",
                "Bollywood": "Bollywood",
                "Korean Drama": "K-Drama",
                "African": "African",
                "Anime": "Anime",
                "Comic": "Comic",
                "Animated Movies": "Animated",
                "Kids Shows and Movies (Nickelodeon and Disney)": "Kids",
                "Classic Movies": "Classics",
                "Erotic Movies": "Erotic",
                "Teen/High-School": "Teen / High-School",
                "Christian Movies": "Christian"
            };
            heading.textContent = categoryLabels[state.activeCategory] || state.activeCategory;
        }
    }

    state.lastDiscoverQuery = null;

    // Filter by active category (or search globally if search term is active)
    let list = state.movies;
    if (!state.searchQuery) {
        if (state.activeCategory === "Ongoing Series") {
            list = list.filter(m => isMovieOngoing(m));
            if (!state.categoryTmdbMovies) state.categoryTmdbMovies = {};
            const catExt = state.categoryTmdbMovies["Ongoing Series"] || [];
            if (catExt.length > 0) {
                const localTmdbIds = new Set(list.map(m => m.tmdb_id).filter(id => id));
                const filteredExt = catExt.filter(ext => !localTmdbIds.has(ext.tmdb_id));
                list = [...list, ...filteredExt];
            } else if (!state.isLoadingTmdbCategory) {
                fetchTmdbCategoryMovies("Ongoing Series");
            }
        } else if (state.activeCategory === "Upcoming Movies" || state.activeCategory === "Latest Movies") {
            list = list.filter(m => isMovieUpcoming(m));
            if (!state.categoryTmdbMovies) state.categoryTmdbMovies = {};
            const catExt = state.categoryTmdbMovies["Upcoming Movies"] || state.categoryTmdbMovies["Latest Movies"] || [];
            if (catExt.length > 0) {
                const localTmdbIds = new Set(list.map(m => m.tmdb_id).filter(id => id));
                const filteredExt = catExt.filter(ext => !localTmdbIds.has(ext.tmdb_id));
                list = [...list, ...filteredExt];
            } else if (!state.isLoadingTmdbCategory) {
                fetchTmdbCategoryMovies("Upcoming Movies");
            }
        } else if (state.activeCategory !== "Main") {
            // Regional & Genre category tabs ONLY show published titles with active download links!
            list = list.filter(m => m.categories && m.categories.includes(state.activeCategory) && m.links && m.links.length > 0);
        }
    }

    // Apply Search Term
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase().trim();
        list = list.filter(m => {
            if (m._searchStr) {
                return m._searchStr.includes(query);
            }
            // Fallback filtering if search string is not precomputed
            const titleMatch = m.title && m.title.toLowerCase().includes(query);
            const overviewMatch = m.overview && m.overview.toLowerCase().includes(query);
            const genresMatch = m.genres && m.genres.some(g => g && g.toLowerCase().includes(query));
            const castMatch = m.cast && m.cast.some(c => c && c.toLowerCase().includes(query));
            const directorMatch = m.director && m.director.toLowerCase().includes(query);
            const typeMatch = m.type && m.type.toLowerCase().includes(query);
            const categoriesMatch = m.categories && m.categories.some(c => c && c.toLowerCase().includes(query));
            return titleMatch || overviewMatch || genresMatch || castMatch || directorMatch || typeMatch || categoriesMatch;
        });

        if (state.externalSearchResults && state.externalSearchResults.length > 0) {
            const localTmdbIds = new Set(list.map(m => m.tmdb_id).filter(id => id));
            const filteredExternal = state.externalSearchResults.filter(ext => !localTmdbIds.has(ext.tmdb_id));
            list = [...list, ...filteredExternal];
        }
    }

    // Apply Multi-select homepage genre chips (AND logic to narrow down matching results case-insensitively)
    if (state.filters.selectedGenres && !state.filters.selectedGenres.includes("All")) {
        list = list.filter(m => {
            if (!m.genres) return false;
            return state.filters.selectedGenres.every(sel => {
                const selLower = sel.toLowerCase().trim();
                return m.genres.some(g => g && g.toLowerCase().trim() === selLower);
            });
        });
    }

    // Apply Advanced Dropdown Filters
    if (state.filters.genre !== "All") {
        list = list.filter(m => m.genres && m.genres.includes(state.filters.genre));
    }
    if (state.filters.genre2 !== "All") {
        list = list.filter(m => m.genres && m.genres.includes(state.filters.genre2));
    }
    if (state.filters.rating > 0) {
        list = list.filter(m => m.rating >= state.filters.rating);
    }
    if (state.filters.year !== "All") {
        list = list.filter(m => {
            if (!m.release_date) return false;
            return m.release_date.startsWith(state.filters.year);
        });
    }

    // Merge external discover / TMDB live API results if filters/categories are active and search query is empty
    if (!state.searchQuery && (state.activeCategory === "Main" || state.activeCategory === "Upcoming Movies" || state.activeCategory === "Ongoing Series") && state.externalSearchResults && state.externalSearchResults.length > 0) {
        const localTmdbIds = new Set(list.map(m => m.tmdb_id).filter(id => id));
        const filteredExternal = state.externalSearchResults.filter(ext => !localTmdbIds.has(ext.tmdb_id));
        list = [...list, ...filteredExternal];
    }

    state.filteredMovies = list;
    console.log("[Render Debug] Final movies list length to build cards:", list.length);

    if (list.length === 0) {
        const noResults = document.createElement("div");
        noResults.className = "empty-state-grid";
        noResults.style.gridColumn = "1 / -1";
        noResults.style.textAlign = "center";
        noResults.style.padding = "40px 0";

        const text = document.createElement("p");
        if (state.isLoadingTmdbCategory) {
            text.textContent = "Loading live titles from TMDB... ⏳🍿";
            text.style.color = "var(--primary-color)";
            text.style.fontWeight = "600";
        } else {
            text.textContent = "No titles match your criteria currently.";
            text.style.color = "var(--text-secondary)";
        }
        noResults.appendChild(text);

        grid.appendChild(noResults);
        return;
    }

    // Render list capped at state.visibleCount to optimize DOM workload
    const totalCount = list.length;
    const sliced = list.slice(0, state.visibleCount);

    // Build movie cards securely
    sliced.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card";
        card.dataset.id = movie.csv_id;

        // Card image container
        const imgWrapper = document.createElement("div");
        imgWrapper.className = "movie-card-poster-wrapper";

        const img = document.createElement("img");
        img.className = "movie-card-poster";
        img.src = movie.poster;
        img.alt = movie.title;
        img.loading = "lazy";
        imgWrapper.appendChild(img);

        const reqBadge = getRequestedBadgeElement(movie);
        if (reqBadge) imgWrapper.appendChild(reqBadge);

        const ongoingBadge = getOngoingBadgeElement(movie);
        if (ongoingBadge) {
            imgWrapper.appendChild(ongoingBadge);
        } else {
            const isTV = (movie.type || "").toLowerCase() === "series" || (movie.type || "").toLowerCase() === "tv" || (movie.categories && movie.categories.some(c => c.toLowerCase().includes("series")));
            if (isTV && typeof movie.isOngoing === "undefined") {
                checkTvSeriesOngoingStatus(movie).then(isOngoing => {
                    if (isOngoing && !imgWrapper.querySelector(".movie-card-ongoing-badge")) {
                        const bg = getOngoingBadgeElement(movie);
                        if (bg) imgWrapper.appendChild(bg);
                    }
                });
            }
        }

        const upcomingBadge = getUpcomingBadgeElement(movie);
        if (upcomingBadge) imgWrapper.appendChild(upcomingBadge);

        const cinemaCutBadge = getCinemaCutBadgeElement(movie);
        if (cinemaCutBadge) imgWrapper.appendChild(cinemaCutBadge);

        // Dynamic NEW Badge Overlay for top additions
        if (state.newMovieIds && state.newMovieIds.includes(movie.csv_id)) {
            const newBadge = document.createElement("div");
            newBadge.className = "movie-card-new-badge";
            newBadge.textContent = "NEW";
            imgWrapper.appendChild(newBadge);
        }

        // Rating Badge
        if (movie.rating > 0) {
            const rating = document.createElement("div");
            rating.className = "movie-card-rating";
            
            const star = createSvgIcon("icon-star", "star-card-icon");
            rating.appendChild(star);
            
            const score = document.createElement("span");
            score.textContent = movie.rating;
            rating.appendChild(score);
            
            imgWrapper.appendChild(rating);
        }

        // Media Type Badge
        const type = document.createElement("div");
        type.className = "movie-card-type-badge";
        type.textContent = movie.type;
        imgWrapper.appendChild(type);

        card.appendChild(imgWrapper);

        // Card Details
        const info = document.createElement("div");
        info.className = "movie-card-info";

        const title = document.createElement("h4");
        title.className = "movie-card-title";
        title.textContent = movie.title;
        info.appendChild(title);

        const metaRow = document.createElement("div");
        metaRow.className = "movie-card-meta";

        const yearLabel = document.createElement("span");
        if (movie.release_date && movie.release_date.length >= 4) {
            yearLabel.textContent = movie.release_date.substring(0, 4);
        } else {
            yearLabel.textContent = "N/A";
        }
        metaRow.appendChild(yearLabel);

        const countLabel = document.createElement("span");
        if (movie.links) {
            countLabel.textContent = movie.type === "Series" ? `${movie.links.length} ${movie.links.length === 1 ? 'Season' : 'Seasons'}` : "Direct";
        }
        metaRow.appendChild(countLabel);

        info.appendChild(metaRow);
        card.appendChild(info);

        // Interaction Action Click
        card.addEventListener("click", () => {
            openDetailModal(movie);
        });

        grid.appendChild(card);
    });

    // Render "Show More" button if catalog size exceeds current visible limit
    if (totalCount > state.visibleCount) {
        const loadMoreBtn = document.createElement("button");
        loadMoreBtn.className = "btn btn-secondary";
        loadMoreBtn.style.cssText = "grid-column: 1 / -1; margin: 16px auto 24px auto; padding: 10px 24px; font-weight: 700; border-radius: 24px; font-size: 12px; display: block; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: #fff; cursor: pointer; transition: all 0.2s; font-family: var(--font-primary);";
        loadMoreBtn.textContent = `Show More (+${totalCount - state.visibleCount} titles) 🎬`;
        
        loadMoreBtn.addEventListener("mouseenter", () => {
            loadMoreBtn.style.background = "var(--primary-gradient)";
            loadMoreBtn.style.color = "#000";
            loadMoreBtn.style.borderColor = "var(--primary-color)";
        });
        loadMoreBtn.addEventListener("mouseleave", () => {
            loadMoreBtn.style.background = "rgba(255,255,255,0.03)";
            loadMoreBtn.style.color = "#fff";
            loadMoreBtn.style.borderColor = "var(--border-color)";
        });
        
        loadMoreBtn.addEventListener("click", () => {
            state.visibleCount += 24;
            renderFeaturedGrid();
        });
        grid.appendChild(loadMoreBtn);
    }
}

// Render Recommendations Section based on user Watchlist and History preferences
// Render Editor's Choice Section based on admin selections from settings/admin_picks
function renderEditorsChoice() {
    const wrapper = document.getElementById("editors-choice-section-wrapper");
    const container = document.getElementById("editors-choice-scroll-container");
    if (!wrapper || !container) return;

    const isGenreChipActive = state.filters.selectedGenres && !state.filters.selectedGenres.includes("All");
    const filtersActive = state.filters.genre !== "All" || state.filters.genre2 !== "All" || state.filters.rating > 0 || state.filters.year !== "All" || isGenreChipActive;
    const shouldShow = !state.searchQuery && state.activeCategory === "Main" && !filtersActive;
    if (!shouldShow) {
        wrapper.style.display = "none";
        return;
    }

    let picks = [];
    if (Array.isArray(state.editorPicks) && state.editorPicks.length > 0) {
        // Map matches from catalog
        picks = state.editorPicks.map(id => state.movies.find(m => m.csv_id === id)).filter(Boolean);
    }

    // Fallback if no picks are loaded/saved yet (use top 10 rated catalog movies)
    if (picks.length === 0) {
        picks = state.movies.filter(m => m.rating >= 7.5).slice(0, 10);
    }

    if (picks.length === 0) {
        wrapper.style.display = "none";
        return;
    }

    wrapper.style.display = "block";
    
    const titleHeader = wrapper.querySelector(".section-title");
    if (titleHeader) {
        titleHeader.textContent = state.editorsChoiceTitle || "Editor's Choice 🎬";
    }

    container.replaceChildren();

    picks.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card";
        card.dataset.id = movie.csv_id;
        // Inline sizing to force horizontal inline display inside the flex row
        card.style.cssText = "min-width: 110px; max-width: 110px; flex-shrink: 0; margin-bottom: 0;";

        const imgWrapper = document.createElement("div");
        imgWrapper.className = "movie-card-poster-wrapper";

        const img = document.createElement("img");
        img.className = "movie-card-poster";
        img.src = movie.poster;
        img.alt = movie.title;
        img.loading = "lazy";
        imgWrapper.appendChild(img);

        if (movie.rating > 0) {
            const rating = document.createElement("div");
            rating.className = "movie-card-rating";
            
            const star = createSvgIcon("icon-star", "star-card-icon");
            rating.appendChild(star);
            
            const score = document.createElement("span");
            score.textContent = movie.rating;
            rating.appendChild(score);
            
            imgWrapper.appendChild(rating);
        }

        const type = document.createElement("div");
        type.className = "movie-card-type-badge";
        type.textContent = movie.type;
        imgWrapper.appendChild(type);

        card.appendChild(imgWrapper);

        const info = document.createElement("div");
        info.className = "movie-card-info";
        info.style.padding = "6px 2px";

        const title = document.createElement("h4");
        title.className = "movie-card-title";
        title.textContent = movie.title;
        title.style.fontSize = "11px";
        title.style.lineHeight = "1.2";
        info.appendChild(title);

        const metaRow = document.createElement("div");
        metaRow.className = "movie-card-meta";
        const yearLabel = document.createElement("span");
        yearLabel.textContent = movie.release_date ? movie.release_date.substring(0, 4) : "N/A";
        metaRow.appendChild(yearLabel);
        
        info.appendChild(metaRow);
        card.appendChild(info);

        card.addEventListener("click", () => {
            openDetailModal(movie);
        });

        container.appendChild(card);
    });
}

// Render Watchlist Grid
function renderWatchlistGrid() {
    const grid = document.getElementById("watchlist-grid-container");
    const emptyState = document.getElementById("watchlist-empty-state");
    if (!grid || !emptyState) return;

    grid.replaceChildren();

    const isWatchedTab = state.activeWatchlistTab === "watched";
    const list = state.movies.filter(m => {
        return isWatchedTab 
            ? state.history.includes(m.csv_id)
            : state.watchlist.includes(m.csv_id);
    });

    if (list.length === 0) {
        grid.style.display = "none";
        emptyState.style.display = "flex";
        
        // Update empty state text based on active tab
        const emptyIcon = emptyState.querySelector(".empty-icon use");
        const emptyTitle = emptyState.querySelector("h3");
        const emptyDesc = emptyState.querySelector("p");
        if (isWatchedTab) {
            if (emptyIcon) emptyIcon.setAttribute("href", "#icon-check");
            if (emptyTitle) emptyTitle.textContent = "Your Watched List is Empty";
            if (emptyDesc) emptyDesc.textContent = "Mark movies as watched or download them to see them here!";
        } else {
            if (emptyIcon) emptyIcon.setAttribute("href", "#icon-bookmark");
            if (emptyTitle) emptyTitle.textContent = "Your Watchlist is Empty";
            if (emptyDesc) emptyDesc.textContent = "Bookmark movies while exploring to save them here for later!";
        }
        return;
    }

    grid.style.display = "grid";
    emptyState.style.display = "none";

    list.forEach(movie => {
        const card = document.createElement("div");
        card.className = "watchlist-item-card";
        card.dataset.id = movie.csv_id;

        const imgWrapper = document.createElement("div");
        imgWrapper.className = "watchlist-poster-wrapper";

        const img = document.createElement("img");
        img.className = "watchlist-poster-img";
        img.src = movie.poster;
        img.alt = movie.title;
        img.loading = "lazy";
        imgWrapper.appendChild(img);

        // Rating Badge
        if (movie.rating > 0) {
            const rating = document.createElement("div");
            rating.className = "watchlist-rating-badge";
            rating.appendChild(createSvgIcon("icon-star", "star-card-icon"));
            
            const score = document.createElement("span");
            score.textContent = movie.rating;
            rating.appendChild(score);
            imgWrapper.appendChild(rating);
        }

        // Type Badge
        const type = document.createElement("div");
        type.className = "watchlist-type-badge";
        type.textContent = movie.type;
        imgWrapper.appendChild(type);

        card.appendChild(imgWrapper);

        const info = document.createElement("div");
        info.className = "watchlist-info-content";

        const title = document.createElement("h4");
        title.className = "watchlist-item-title";
        title.textContent = movie.title;
        info.appendChild(title);

        const metaRow = document.createElement("div");
        metaRow.className = "watchlist-item-meta";
        const yearLabel = document.createElement("span");
        yearLabel.textContent = movie.release_date ? movie.release_date.substring(0, 4) : "N/A";
        metaRow.appendChild(yearLabel);
        
        if (movie.rating > 0) {
            const ratingLabel = document.createElement("span");
            ratingLabel.textContent = `IMDb ${movie.rating}`;
            ratingLabel.style.color = "var(--primary-color)";
            metaRow.appendChild(ratingLabel);
        }
        info.appendChild(metaRow);

        // Button Actions Row
        const actionRow = document.createElement("div");
        actionRow.className = "watchlist-item-actions";

        const viewBtn = document.createElement("button");
        viewBtn.className = "btn btn-primary btn-sm btn-block-sm";
        viewBtn.textContent = "View Details";
        viewBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openDetailModal(movie);
        });
        actionRow.appendChild(viewBtn);

        const downloadBtn = document.createElement("button");
        downloadBtn.className = "btn btn-secondary btn-sm btn-block-sm";
        downloadBtn.appendChild(createSvgIcon("icon-download"));
        const downloadText = document.createElement("span");
        downloadText.textContent = "Download";
        downloadBtn.appendChild(downloadText);
        downloadBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            addWatchHistory(movie.csv_id);
            openDownloadModal(movie);
        });
        actionRow.appendChild(downloadBtn);

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-secondary btn-sm btn-block-sm btn-danger-sm";
        
        const trashIcon = createSvgIcon("icon-close", "remove-icon");
        removeBtn.appendChild(trashIcon);
        
        const removeText = document.createElement("span");
        removeText.textContent = isWatchedTab ? "Unwatch" : "Remove";
        removeBtn.appendChild(removeText);

        removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isWatchedTab) {
                // Remove from watched list
                state.history = state.history.filter(id => id !== movie.csv_id);
                localStorage.setItem("filmhouse_history", JSON.stringify(state.history));
                
                // Deduct points
                awardPoints(-5, "watched");
                
                const countLabel = document.getElementById("stat-history-count");
                if (countLabel) countLabel.textContent = state.history.length;
            } else {
                toggleWatchlist(movie.csv_id);
            }
            renderWatchlistGrid(); // Refresh screen
        });
        actionRow.appendChild(removeBtn);

        info.appendChild(actionRow);
        card.appendChild(info);
        grid.appendChild(card);
    });
}

// Carousel Banner Slider populate
function renderCarouselBanner() {
    const container = document.getElementById("hero-carousel");
    if (!container) return;
    container.replaceChildren();

    // Pick highly rated movies/series (best rated pool, e.g. rating >= 7.2)
    let bestPool = state.movies.filter(m => m.rating >= 7.2);
    if (bestPool.length < 5) {
        bestPool = [...state.movies];
    }
    // Shuffle the pool randomly and select top 5
    let featuredList = bestPool.sort(() => 0.5 - Math.random()).slice(0, 5);

    if (featuredList.length === 0) return;

    // Create Slides
    featuredList.forEach((movie, idx) => {
        const slide = document.createElement("div");
        slide.className = `carousel-slide ${idx === 0 ? 'active' : ''}`;
        slide.setAttribute("data-index", idx);

        const backdropImg = document.createElement("img");
        backdropImg.className = "carousel-backdrop-img";
        backdropImg.src = movie.backdrop;
        backdropImg.alt = movie.title;
        slide.appendChild(backdropImg);

        const overlay = document.createElement("div");
        overlay.className = "carousel-overlay";

        const badge = document.createElement("span");
        badge.className = "carousel-slide-badge";
        badge.textContent = movie.type;
        overlay.appendChild(badge);

        const title = document.createElement("h2");
        title.className = "carousel-slide-title";
        title.textContent = movie.title;
        overlay.appendChild(title);

        const metaRow = document.createElement("div");
        metaRow.className = "carousel-slide-meta";

        if (movie.rating > 0) {
            const rating = document.createElement("span");
            rating.className = "rating";
            rating.appendChild(createSvgIcon("icon-star"));
            
            const ratingScore = document.createElement("span");
            ratingScore.textContent = `${movie.rating}/10`;
            rating.appendChild(ratingScore);
            
            metaRow.appendChild(rating);
        }

        const yearLabel = document.createElement("span");
        yearLabel.textContent = movie.release_date ? movie.release_date.substring(0, 4) : "N/A";
        metaRow.appendChild(yearLabel);

        const genreLabel = document.createElement("span");
        genreLabel.textContent = (movie.genres && Array.isArray(movie.genres)) ? movie.genres.slice(0, 2).join(", ") : "";
        metaRow.appendChild(genreLabel);

        overlay.appendChild(metaRow);

        const desc = document.createElement("p");
        desc.className = "carousel-slide-desc";
        desc.textContent = movie.overview;
        overlay.appendChild(desc);

        const actions = document.createElement("div");
        actions.className = "carousel-actions";

        const infoBtn = document.createElement("button");
        infoBtn.className = "btn btn-primary";
        infoBtn.textContent = "More Info";
        infoBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openDetailModal(movie);
        });
        actions.appendChild(infoBtn);

        if (movie.trailer) {
            const trailerBtn = document.createElement("button");
            trailerBtn.className = "btn btn-secondary";
            trailerBtn.textContent = "Watch Trailer";
            trailerBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openTrailerModal(movie.trailer);
            });
            actions.appendChild(trailerBtn);
        }

        overlay.appendChild(actions);
        slide.appendChild(overlay);
        container.appendChild(slide);
    });

    // Create Navigation Indicator Dots
    const dotsContainer = document.createElement("div");
    dotsContainer.className = "carousel-dots";
    
    featuredList.forEach((_, idx) => {
        const dot = document.createElement("div");
        dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
        dot.addEventListener("click", () => showSlide(idx));
        dotsContainer.appendChild(dot);
    });
    
    container.appendChild(dotsContainer);

    // Set Slider timer rotation
    if (state.carouselInterval) clearInterval(state.carouselInterval);
    state.carouselInterval = setInterval(() => {
        let next = state.carouselIndex + 1;
        if (next >= featuredList.length) next = 0;
        showSlide(next);
    }, 6000);
}

function showSlide(index) {
    const container = document.getElementById("hero-carousel");
    if (!container) return;

    const slides = container.querySelectorAll(".carousel-slide");
    const dots = container.querySelectorAll(".carousel-dot");
    
    if (slides.length === 0) return;

    slides.forEach(s => s.classList.remove("active"));
    dots.forEach(d => d.classList.remove("active"));

    state.carouselIndex = index;
    
    const activeSlide = Array.from(slides).find(s => parseInt(s.getAttribute("data-index")) === index);
    if (activeSlide) activeSlide.classList.add("active");
    
    if (dots[index]) dots[index].classList.add("active");
}

// Advanced filters options loaders
function initializeFilterDropdowns() {
    const genreSelect = document.getElementById("filter-genre");
    const genreSelect2 = document.getElementById("filter-genre-2");
    const yearSelect = document.getElementById("filter-year");
    if (!genreSelect || !genreSelect2 || !yearSelect) return;

    // Collect distinct genres
    const genreSet = new Set();
    const yearSet = new Set();

    state.movies.forEach(m => {
        if (m.genres) m.genres.forEach(g => genreSet.add(g));
        if (m.release_date && m.release_date.length >= 4) {
            const y = m.release_date.substring(0, 4);
            if (!isNaN(y)) yearSet.add(y);
        }
    });

    const sortedGenres = Array.from(genreSet).sort();

    // Populate Genre 1
    sortedGenres.forEach(g => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        genreSelect.appendChild(opt);
    });

    // Populate Genre 2
    sortedGenres.forEach(g => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        genreSelect2.appendChild(opt);
    });

    // Populate years
    Array.from(yearSet).sort((a,b) => b-a).forEach(y => {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
    });
}

// Movie Detail modal build
function openDetailModal(movie) {
    const modal = document.getElementById("detail-modal");
    const body = document.getElementById("detail-modal-body");
    if (!modal || !body) return;

    logAppEvent("view", movie.csv_id || movie.id, movie.title);

    // Normalize movie fields to prevent crashes on missing metadata (CSV imports/batch adds)
    movie.poster = movie.poster || "MOVIE/img/FilmHouse3_nobg.png";
    movie.backdrop = movie.backdrop || "MOVIE/img/FilmHouse.png";
    movie.overview = movie.overview || "No synopsis available.";
    movie.language = movie.language || "en";
    movie.categories = movie.categories || ["Main"];
    movie.genres = movie.genres || [];
    movie.cast = movie.cast || [];
    movie.rating = movie.rating || 0;
    movie.release_date = movie.release_date || "";

    body.replaceChildren();

    // 1. Hero banner area
    const hero = document.createElement("div");
    hero.className = "detail-hero";

    const backdrop = document.createElement("img");
    backdrop.className = "detail-backdrop";
    backdrop.src = movie.backdrop;
    backdrop.alt = movie.title;
    hero.appendChild(backdrop);

    const gradient = document.createElement("div");
    gradient.className = "detail-hero-gradient";
    hero.appendChild(gradient);
    body.appendChild(hero);

    // 2. Main split layout
    const mainLayout = document.createElement("div");
    mainLayout.className = "detail-main-layout";

    // Poster Column
    const posterColumn = document.createElement("div");
    posterColumn.className = "detail-poster-column";
    
    const posterCard = document.createElement("div");
    posterCard.className = "detail-poster-card";
    posterCard.style.position = "relative";
    
    const posterImg = document.createElement("img");
    posterImg.src = movie.poster;
    posterImg.alt = movie.title;
    posterCard.appendChild(posterImg);

    const ongoingBadge = getOngoingBadgeElement(movie);
    if (ongoingBadge) {
        posterCard.appendChild(ongoingBadge);
    } else {
        const isTV = (movie.type || "").toLowerCase() === "series" || (movie.type || "").toLowerCase() === "tv" || (movie.categories && movie.categories.some(c => c.toLowerCase().includes("series")));
        if (isTV && typeof movie.isOngoing === "undefined") {
            checkTvSeriesOngoingStatus(movie).then(isOngoing => {
                if (isOngoing && !posterCard.querySelector(".movie-card-ongoing-badge")) {
                    const bg = getOngoingBadgeElement(movie);
                    if (bg) posterCard.appendChild(bg);
                }
            });
        }
    }

    posterColumn.appendChild(posterCard);
    mainLayout.appendChild(posterColumn);

    // Info details Column
    const infoColumn = document.createElement("div");
    infoColumn.className = "detail-info-column";

    const title = document.createElement("h2");
    title.className = "detail-title";
    title.textContent = movie.title;
    infoColumn.appendChild(title);

    // Metadata Row
    const metaList = document.createElement("div");
    metaList.className = "detail-meta-list";

    if (movie.rating > 0) {
        const rating = document.createElement("span");
        rating.className = "rating";
        rating.appendChild(createSvgIcon("icon-star"));
        
        const ratingScore = document.createElement("span");
        ratingScore.textContent = `IMDb ${movie.rating}/10`;
        rating.appendChild(ratingScore);
        
        metaList.appendChild(rating);
        metaList.appendChild(createMetaDivider());
    }

    const typeBadge = document.createElement("span");
    typeBadge.className = "detail-badge";
    typeBadge.textContent = movie.type;
    metaList.appendChild(typeBadge);
    metaList.appendChild(createMetaDivider());

    if (isMovieOngoing(movie)) {
        const ongoingPill = document.createElement("span");
        ongoingPill.className = "detail-ongoing-badge-pill";
        ongoingPill.style.cssText = "background: rgba(255, 0, 85, 0.15); color: #ff0055; border: 1px solid rgba(255, 0, 85, 0.4); font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; letter-spacing: 0.5px;";
        ongoingPill.innerHTML = "<span>🔴</span><span>ONGOING</span>";
        metaList.appendChild(ongoingPill);
        metaList.appendChild(createMetaDivider());
    } else {
        const isTV = (movie.type || "").toLowerCase() === "series" || (movie.type || "").toLowerCase() === "tv" || (movie.categories && movie.categories.some(c => c.toLowerCase().includes("series")));
        if (isTV) {
            checkTvSeriesOngoingStatus(movie).then(isOngoing => {
                if (isOngoing && !metaList.querySelector(".detail-ongoing-badge-pill")) {
                    const ongoingPill = document.createElement("span");
                    ongoingPill.className = "detail-ongoing-badge-pill";
                    ongoingPill.style.cssText = "background: rgba(255, 0, 85, 0.15); color: #ff0055; border: 1px solid rgba(255, 0, 85, 0.4); font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; letter-spacing: 0.5px;";
                    ongoingPill.innerHTML = "<span>🔴</span><span>ONGOING</span>";
                    metaList.appendChild(ongoingPill);
                    metaList.appendChild(createMetaDivider());
                }
            });
        }
    }

    const yearLabel = document.createElement("span");
    yearLabel.className = "detail-year-label";
    yearLabel.textContent = movie.release_date ? movie.release_date.substring(0, 4) : "N/A";
    metaList.appendChild(yearLabel);
    metaList.appendChild(createMetaDivider());

    const langLabel = document.createElement("span");
    langLabel.className = "detail-badge";
    langLabel.textContent = movie.language.toUpperCase();
    metaList.appendChild(langLabel);

    if (movie.genres && movie.genres.length > 0) {
        metaList.appendChild(createMetaDivider());
        const genreBadge = document.createElement("span");
        genreBadge.className = "detail-badge";
        genreBadge.textContent = movie.genres.slice(0, 3).join(", ");
        metaList.appendChild(genreBadge);
    }

    if (movie.runtime) {
        metaList.appendChild(createMetaDivider());
        const runtimeLabel = document.createElement("span");
        runtimeLabel.textContent = movie.runtime;
        metaList.appendChild(runtimeLabel);
    }

    infoColumn.appendChild(metaList);

    // Live Ongoing Series Banner
    if (isMovieOngoing(movie)) {
        const ongoingBanner = document.createElement("div");
        ongoingBanner.className = "ongoing-status-banner";
        ongoingBanner.style.cssText = "margin-top: 10px; margin-bottom: 6px; padding: 8px 12px; background: rgba(255, 0, 85, 0.12); border: 1px solid rgba(255, 0, 85, 0.35); border-radius: var(--border-radius-sm); color: #ffffff; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; gap: 8px;";
        ongoingBanner.innerHTML = `
            <span style="display: flex; align-items: center; gap: 6px;">
                <span>🔴</span>
                <strong>ONGOING SERIES:</strong> New episodes are updated weekly as they air!
            </span>
            <span style="font-size: 10px; opacity: 0.85; background: rgba(255, 0, 85, 0.25); padding: 2px 7px; border-radius: 10px; font-weight: 800;">Airing 📡</span>
        `;
        infoColumn.appendChild(ongoingBanner);
    }

    // Live Upcoming / Coming Soon Banner
    if (isMovieUpcoming(movie)) {
        const upcomingBanner = document.createElement("div");
        upcomingBanner.className = "upcoming-status-banner";
        upcomingBanner.style.cssText = "margin-top: 10px; margin-bottom: 6px; padding: 8px 12px; background: rgba(0, 198, 255, 0.12); border: 1px solid rgba(0, 198, 255, 0.35); border-radius: var(--border-radius-sm); color: #ffffff; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; gap: 8px;";
        upcomingBanner.innerHTML = `
            <span style="display: flex; align-items: center; gap: 6px;">
                <span>✨</span>
                <strong>UPCOMING RELEASE:</strong> Live feed from TMDB API! Tap Request to get notified when downloads drop!
            </span>
            <span style="font-size: 10px; opacity: 0.85; background: rgba(0, 198, 255, 0.25); padding: 2px 7px; border-radius: 10px; font-weight: 800;">Coming Soon 🍿</span>
        `;
        infoColumn.appendChild(upcomingBanner);
    }

    // Action buttons row
    const actionsRow = document.createElement("div");
    actionsRow.className = "detail-actions-row";

    // Bookmark/Watchlist
    const inWatchlist = state.watchlist.includes(movie.csv_id);
    const watchlistBtn = document.createElement("button");
    watchlistBtn.className = `btn ${inWatchlist ? 'btn-secondary' : 'btn-primary'}`;
    
    const wIcon = createSvgIcon(inWatchlist ? "icon-bookmark-fill" : "icon-bookmark");
    watchlistBtn.appendChild(wIcon);
    
    const wText = document.createElement("span");
    wText.textContent = inWatchlist ? "Saved" : "Watchlist";
    watchlistBtn.appendChild(wText);
    
    watchlistBtn.addEventListener("click", () => {
        toggleWatchlist(movie);
        const active = state.watchlist.includes(movie.csv_id);
        watchlistBtn.className = `btn ${active ? 'btn-secondary' : 'btn-primary'}`;
        
        const newIcon = createSvgIcon(active ? "icon-bookmark-fill" : "icon-bookmark");
        wText.textContent = active ? "Saved" : "Watchlist";
        watchlistBtn.replaceChild(newIcon, watchlistBtn.querySelector("svg"));
    });
    actionsRow.appendChild(watchlistBtn);

    // Mark as Watched
    const inHistory = state.history.includes(movie.csv_id);
    const watchedBtn = document.createElement("button");
    watchedBtn.id = "btn-watched-toggle";
    watchedBtn.className = `btn ${inHistory ? 'btn-secondary' : 'btn-primary'}`;
    
    const watchedIcon = createSvgIcon("icon-check");
    watchedBtn.appendChild(watchedIcon);
    
    const watchedText = document.createElement("span");
    watchedText.textContent = inHistory ? "Watched" : "Mark Watched";
    watchedBtn.appendChild(watchedText);
    
    watchedBtn.addEventListener("click", () => {
        const active = state.history.includes(movie.csv_id);
        if (active) {
            // Remove from history
            state.history = state.history.filter(id => id !== movie.csv_id);
            localStorage.setItem("filmhouse_history", JSON.stringify(state.history));
            
            // Deduct points
            awardPoints(-5, "watched");
            
            // Update UI
            watchedBtn.className = "btn btn-primary";
            watchedText.textContent = "Mark Watched";
        } else {
            // Add to history (automatically removes from watchlist)
            addWatchHistory(movie);
            
            // Award points (+5)
            awardPoints(5, "watched");
            
            // Update UI
            watchedBtn.className = "btn btn-secondary";
            watchedText.textContent = "Watched";

            // Update Watchlist button UI if in watchlist previously
            wText.textContent = "Watchlist";
            watchlistBtn.className = "btn btn-primary";
            const newIcon = createSvgIcon("icon-bookmark");
            const oldSvg = watchlistBtn.querySelector("svg");
            if (oldSvg) watchlistBtn.replaceChild(newIcon, oldSvg);

            showToast("Moved to Watched list! 🍿", "success");
        }
        
        // Update stats Viewed count
        const countLabel = document.getElementById("stat-history-count");
        if (countLabel) countLabel.textContent = state.history.length;
        
        // Refresh grids if visible
        const watchHistoryScreen = document.getElementById("screen-watchlist");
        if (watchHistoryScreen && watchHistoryScreen.classList.contains("active")) {
            renderWatchlistGrid();
        }
    });
    actionsRow.appendChild(watchedBtn);

    // Trailer Button (IMDb Video Gallery / YouTube)
    if (movie.imdb_id || movie.trailer) {
        const trailerBtn = document.createElement("button");
        trailerBtn.className = "btn btn-secondary";
        trailerBtn.appendChild(createSvgIcon("icon-play"));
        
        const tText = document.createElement("span");
        tText.textContent = "Trailer";
        trailerBtn.appendChild(tText);

        trailerBtn.addEventListener("click", () => {
            if (movie.trailer) {
                openTrailerModal(movie.trailer);
            } else if (movie.imdb_id) {
                window.open(`https://www.imdb.com/title/${movie.imdb_id}/videogallery`, '_blank');
            }
        });
        
        actionsRow.appendChild(trailerBtn);
    }

    // IMDb link button
    if (movie.imdb_id) {
        const imdbBtn = document.createElement("a");
        imdbBtn.href = `https://www.imdb.com/title/${movie.imdb_id}`;
        imdbBtn.target = "_blank";
        imdbBtn.rel = "noopener noreferrer";
        imdbBtn.className = "btn btn-secondary";
        imdbBtn.style.display = "inline-flex";
        imdbBtn.style.alignItems = "center";
        imdbBtn.style.gap = "6px";
        imdbBtn.style.textDecoration = "none";
        
        const imdbLabel = document.createElement("span");
        imdbLabel.textContent = "IMDb";
        imdbLabel.style.fontWeight = "800";
        imdbLabel.style.background = "#f5c518";
        imdbLabel.style.color = "#000000";
        imdbLabel.style.padding = "2px 6px";
        imdbLabel.style.borderRadius = "4px";
        imdbLabel.style.fontSize = "11px";
        imdbLabel.style.lineHeight = "1";
        
        imdbBtn.appendChild(imdbLabel);
        
        const viewText = document.createElement("span");
        viewText.textContent = "View";
        imdbBtn.appendChild(viewText);
        
        actionsRow.appendChild(imdbBtn);
    }

    // Download or Request Button
    if (!movie.links || movie.links.length === 0) {
        const existingReq = currentUserRequests && currentUserRequests.find(r => 
            r.title && getCleanRequestTitle(r.title).toLowerCase() === getCleanRequestTitle(movie.title).toLowerCase() &&
            r.status !== "fulfilled"
        );

        const requestBtn = document.createElement("a");
        requestBtn.className = "btn btn-request-premium";
        requestBtn.href = "https://t.me/+09ahNmGdB1U2MzFk";
        requestBtn.target = "_blank";
        requestBtn.rel = "noopener noreferrer";
        requestBtn.style.textDecoration = "none";
        
        if (existingReq) {
            const isPriority = existingReq.status === "priority";
            requestBtn.appendChild(createSvgIcon("icon-check"));
            const rText = document.createElement("span");
            rText.textContent = isPriority ? "Priority Request ⚡" : "Requested ⏳";
            requestBtn.appendChild(rText);
            requestBtn.style.background = isPriority 
                ? "linear-gradient(135deg, rgba(255, 188, 0, 0.25), rgba(255, 120, 0, 0.3))" 
                : "rgba(255, 188, 0, 0.15)";
            requestBtn.style.borderColor = "var(--primary-color)";
        } else {
            requestBtn.appendChild(createSvgIcon("icon-share"));
            const rText = document.createElement("span");
            rText.textContent = movie.type === "Series" ? "Request Series" : "Request Movie";
            requestBtn.appendChild(rText);
        }

        requestBtn.addEventListener("click", (e) => {
            e.preventDefault();
            showRequestSpecsDrawer(movie);
        });
        
        actionsRow.appendChild(requestBtn);

        if (existingReq) {
            const reqBanner = document.createElement("div");
            reqBanner.className = "requested-status-banner";
            reqBanner.style.cssText = "margin-top: 12px; padding: 10px 14px; background: rgba(255, 188, 0, 0.1); border: 1px solid rgba(255, 188, 0, 0.3); border-radius: var(--border-radius-sm); color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px;";
            const isPriority = existingReq.status === "priority";
            reqBanner.innerHTML = `
                <span style="display: flex; align-items: center; gap: 6px;">
                    <span>${isPriority ? '⚡' : '📌'}</span>
                    <strong>Request Status:</strong> ${isPriority ? 'High Priority Processing' : 'Pending Admin Fulfillment'}
                </span>
                <span style="font-size: 10px; opacity: 0.8; background: rgba(255,188,0,0.2); padding: 2px 8px; border-radius: 10px;">${isPriority ? 'Priority' : 'In Queue'}</span>
            `;
            infoColumn.appendChild(reqBanner);
        }
    } else {
        const downloadBtn = document.createElement("button");
        downloadBtn.className = "btn btn-secondary";
        downloadBtn.appendChild(createSvgIcon("icon-download"));
        
        const dText = document.createElement("span");
        dText.textContent = "Download";
        downloadBtn.appendChild(dText);

        downloadBtn.addEventListener("click", () => {
            // Record watch history
            addWatchHistory(movie.csv_id);
            // Open download options instantly
            openDownloadModal(movie);
        });
        actionsRow.appendChild(downloadBtn);
    }

    // Share Button
    const shareBtn = document.createElement("button");
    shareBtn.className = "btn btn-secondary";
    shareBtn.appendChild(createSvgIcon("icon-share"));
    
    const sText = document.createElement("span");
    sText.textContent = "Share";
    shareBtn.appendChild(sText);

    shareBtn.addEventListener("click", () => {
        shareMovie(movie);
    });
    actionsRow.appendChild(shareBtn);

    infoColumn.appendChild(actionsRow);
    mainLayout.appendChild(infoColumn);
    body.appendChild(mainLayout);

    // 3. Overview section
    const overviewSec = document.createElement("div");
    overviewSec.className = "detail-overview-section";

    // Synopsis
    const synopsisBox = document.createElement("div");
    synopsisBox.className = "detail-synopsis-box";
    const synTitle = document.createElement("h3");
    synTitle.textContent = "Synopsis";
    synopsisBox.appendChild(synTitle);
    const synDesc = document.createElement("p");
    synDesc.className = "detail-synopsis-desc";
    synDesc.textContent = movie.overview;
    synopsisBox.appendChild(synDesc);
    overviewSec.appendChild(synopsisBox);

    // Cast / Crew
    if ((movie.cast && movie.cast.length > 0) || movie.director) {
        const castBox = document.createElement("div");
        castBox.className = "detail-cast-box";
        
        const castTitle = document.createElement("h3");
        castTitle.textContent = "Cast & Crew";
        castBox.appendChild(castTitle);

        const castList = document.createElement("div");
        castList.className = "cast-pills-list";

        if (movie.director) {
            const dirPill = document.createElement("a");
            dirPill.className = "cast-pill director clickable-pill";
            dirPill.textContent = `${movie.type === "Series" ? "Creator" : "Director"}: ${movie.director}`;
            dirPill.href = `https://www.imdb.com/find?q=${encodeURIComponent(movie.director)}&s=nm`;
            dirPill.target = "_blank";
            dirPill.rel = "noopener noreferrer";
            castList.appendChild(dirPill);
        }

        if (movie.cast) {
            movie.cast.forEach(actor => {
                const actorPill = document.createElement("a");
                actorPill.className = "cast-pill clickable-pill";
                actorPill.textContent = actor;
                actorPill.href = `https://www.imdb.com/find?q=${encodeURIComponent(actor)}&s=nm`;
                actorPill.target = "_blank";
                actorPill.rel = "noopener noreferrer";
                castList.appendChild(actorPill);
            });
        }

        castBox.appendChild(castList);
        overviewSec.appendChild(castBox);
    }

    // Related carousel slider
    const relatedList = state.movies.filter(m => m.csv_id !== movie.csv_id && m.categories.some(c => movie.categories.includes(c))).slice(0, 8);
    if (relatedList.length > 0) {
        const relatedSec = document.createElement("div");
        relatedSec.className = "related-movies-section";
        const relTitle = document.createElement("h3");
        relTitle.textContent = "More Like This";
        relatedSec.appendChild(relTitle);

        const slider = document.createElement("div");
        slider.className = "related-movies-slider";

        relatedList.forEach(rel => {
            const relCard = document.createElement("div");
            relCard.className = "related-card";

            const relImgWrapper = document.createElement("div");
            relImgWrapper.className = "related-card-poster";
            const relImg = document.createElement("img");
            relImg.src = rel.poster;
            relImg.alt = rel.title;
            relImgWrapper.appendChild(relImg);
            relCard.appendChild(relImgWrapper);

            const relLabel = document.createElement("p");
            relLabel.className = "related-card-title";
            relLabel.textContent = rel.title;
            relCard.appendChild(relLabel);

            relCard.addEventListener("click", () => {
                openDetailModal(rel);
            });

            slider.appendChild(relCard);
        });

        relatedSec.appendChild(slider);
        overviewSec.appendChild(relatedSec);
    }

    body.appendChild(overviewSec);

    // Open Modal
    modal.classList.add("active");

    // Dynamic Self-Healing: Fetch missing TMDB details in background if missing
    const numericId = movie.tmdb_id || (movie.csv_id && movie.csv_id.split("-")[0]);
    if (numericId && /^\d+$/.test(numericId) && (!movie.overview || movie.overview === "No synopsis available." || !movie.release_date || !movie.poster || movie.poster.includes("FilmHouse3_nobg.png"))) {
        const mediaType = (movie.type || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'tv' ? 'tv' : 'movie';
        const apiKey = getTmdbApiKey();
        fetch(`https://api.themoviedb.org/3/${mediaType}/${numericId}?api_key=${apiKey}`)
            .then(res => { if (res.ok) return res.json(); })
            .then(data => {
                if (data) {
                    movie.overview = data.overview || movie.overview;
                    movie.release_date = data.release_date || data.first_air_date || movie.release_date;
                    movie.rating = data.vote_average ? Math.round(data.vote_average * 10) / 10 : movie.rating;
                    if (data.poster_path && (!movie.poster || movie.poster.includes("FilmHouse3_nobg.png"))) {
                        movie.poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
                    }
                    if (data.backdrop_path && (!movie.backdrop || movie.backdrop.includes("FilmHouse.png"))) {
                        movie.backdrop = `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`;
                    }
                    
                    // Save to local self-healing cache
                    try {
                        const cacheStr = localStorage.getItem("filmhouse_healed_movies") || "{}";
                        const cache = JSON.parse(cacheStr);
                        cache[movie.csv_id] = {
                            poster: movie.poster,
                            backdrop: movie.backdrop,
                            rating: movie.rating,
                            release_date: movie.release_date,
                            overview: movie.overview
                        };
                        localStorage.setItem("filmhouse_healed_movies", JSON.stringify(cache));
                    } catch (e) {
                        console.warn("Could not save healed movie to cache:", e);
                    }

                    // Update DOM cards on the fly
                    updateMovieCardDOM(movie);
                    
                    // Update DOM elements on the fly if user is still viewing this card
                    const openModal = document.getElementById("detail-modal");
                    if (openModal && openModal.classList.contains("active")) {
                        const currentTitle = document.querySelector(".detail-title");
                        if (currentTitle && currentTitle.textContent === movie.title) {
                            const backdropEl = document.querySelector(".detail-backdrop");
                            if (backdropEl && movie.backdrop) backdropEl.src = movie.backdrop;
                            
                            const posterEl = document.querySelector(".detail-poster-card img");
                            if (posterEl && movie.poster) posterEl.src = movie.poster;
                            
                            const synopsisEl = document.querySelector(".detail-synopsis-desc");
                            if (synopsisEl && movie.overview) synopsisEl.textContent = movie.overview;
                            
                            const yearLabelEl = document.querySelector(".detail-year-label");
                            if (yearLabelEl && movie.release_date) {
                                yearLabelEl.textContent = movie.release_date.substring(0, 4);
                            }
                        }
                    }
                }
            })
            .catch(err => console.warn("Self-healing TMDB details fetch failed:", err));
    }
}

// Dynamically patch any matching movie card in the UI grids
function updateMovieCardDOM(movie) {
    if (!movie || !movie.csv_id) return;
    
    // 1. Update standard movie-cards
    const cards = document.querySelectorAll(`.movie-card[data-id="${movie.csv_id}"]`);
    cards.forEach(card => {
        const img = card.querySelector(".movie-card-poster");
        if (img && movie.poster && !movie.poster.includes("FilmHouse3_nobg.png")) {
            img.src = movie.poster;
        }
        let ratingBadge = card.querySelector(".movie-card-rating");
        const imgWrapper = card.querySelector(".movie-card-poster-wrapper");
        if (movie.rating > 0 && imgWrapper) {
            if (!ratingBadge) {
                ratingBadge = document.createElement("div");
                ratingBadge.className = "movie-card-rating";
                const star = createSvgIcon("icon-star", "star-card-icon");
                ratingBadge.appendChild(star);
                const score = document.createElement("span");
                score.textContent = movie.rating;
                ratingBadge.appendChild(score);
                imgWrapper.appendChild(ratingBadge);
            } else {
                const score = ratingBadge.querySelector("span");
                if (score) score.textContent = movie.rating;
            }
        }
        const metaRow = card.querySelector(".movie-card-meta");
        if (metaRow && movie.release_date && movie.release_date.length >= 4) {
            const yearLabel = metaRow.querySelector("span:first-child");
            if (yearLabel) {
                yearLabel.textContent = movie.release_date.substring(0, 4);
            }
        }
    });

    // 2. Update watchlist-item-cards
    const wlCards = document.querySelectorAll(`.watchlist-item-card[data-id="${movie.csv_id}"]`);
    wlCards.forEach(card => {
        const img = card.querySelector(".watchlist-poster-img");
        if (img && movie.poster && !movie.poster.includes("FilmHouse3_nobg.png")) {
            img.src = movie.poster;
        }
        let ratingBadge = card.querySelector(".watchlist-rating-badge");
        const imgWrapper = card.querySelector(".watchlist-poster-wrapper");
        if (movie.rating > 0 && imgWrapper) {
            if (!ratingBadge) {
                ratingBadge = document.createElement("div");
                ratingBadge.className = "watchlist-rating-badge";
                ratingBadge.appendChild(createSvgIcon("icon-star", "star-card-icon"));
                const score = document.createElement("span");
                score.textContent = movie.rating;
                ratingBadge.appendChild(score);
                imgWrapper.appendChild(ratingBadge);
            } else {
                const score = ratingBadge.querySelector("span");
                if (score) score.textContent = movie.rating;
            }
        }
        const metaRow = card.querySelector(".watchlist-meta-row");
        if (metaRow && movie.release_date && movie.release_date.length >= 4) {
            const yearLabel = metaRow.querySelector("span:first-child");
            if (yearLabel) {
                yearLabel.textContent = movie.release_date.substring(0, 4);
            }
        }
    });
}

function createMetaDivider() {
    const divider = document.createElement("span");
    divider.className = "meta-divider";
    divider.textContent = "•";
    return divider;
}

// Watchlist local Storage helper
function toggleWatchlist(movie) {
    const movieId = typeof movie === 'object' ? movie.csv_id : movie;
    const index = state.watchlist.indexOf(movieId);
    triggerHaptic("light");
    if (index === -1) {
        state.watchlist.push(movieId);
        logAppEvent("watchlist", movieId, (typeof movie === "object" && movie.title ? movie.title : movieId));
        // Persist external movie metadata if it's not a local database movie
        if (typeof movie === 'object' && movie.links && movie.links.length === 0) {
            saveExternalMovieLocally(movie);
        }
        showToast("Added to your watchlist!", "success", {
            text: "View",
            callback: () => {
                const modal = document.getElementById("detail-modal");
                if (modal) modal.classList.remove("active");
                navigateToScreen("watchlist");
            }
        });
    } else {
        state.watchlist.splice(index, 1);
        showToast("Removed from watchlist.", "success");
    }
    localStorage.setItem("filmhouse_watchlist", JSON.stringify(state.watchlist));
    
    // Update Stats counters in UI profile panel
    const countLabel = document.getElementById("stat-watchlist-count");
    if (countLabel) countLabel.textContent = state.watchlist.length;

    // Refresh recommendations list dynamically
    renderEditorsChoice();
}

function saveExternalMovieLocally(movie) {
    try {
        const saved = localStorage.getItem("filmhouse_external_movies");
        let list = saved ? JSON.parse(saved) : [];
        if (!list.some(m => m.csv_id === movie.csv_id)) {
            list.push(movie);
            localStorage.setItem("filmhouse_external_movies", JSON.stringify(list));
        }
    } catch (e) {
        console.error("Error saving external movie", e);
    }
}

function loadExternalMovies() {
    try {
        const saved = localStorage.getItem("filmhouse_external_movies");
        if (saved) {
            const list = JSON.parse(saved);
            list.forEach(extMovie => {
                if (!state.movies.some(m => m.csv_id === extMovie.csv_id)) {
                    state.movies.push(extMovie);
                }
            });
        }
    } catch (e) {
        console.error("Error loading external movies", e);
    }
}

function loadWatchlist() {
    loadExternalMovies();
    const saved = localStorage.getItem("filmhouse_watchlist");
    if (saved) {
        try {
            state.watchlist = JSON.parse(saved);
        } catch (e) {
            state.watchlist = [];
        }
    }
    
    const countLabel = document.getElementById("stat-watchlist-count");
    if (countLabel) countLabel.textContent = state.watchlist.length;
}

// Watch History persistence helper
function addWatchHistory(movie) {
    const movieId = typeof movie === 'object' ? movie.csv_id : movie;

    // Automatically remove from watchlist if present so it transitions cleanly to watched
    const watchlistIndex = state.watchlist.indexOf(movieId);
    if (watchlistIndex !== -1) {
        state.watchlist.splice(watchlistIndex, 1);
        localStorage.setItem("filmhouse_watchlist", JSON.stringify(state.watchlist));
        const wCountLabel = document.getElementById("stat-watchlist-count");
        if (wCountLabel) wCountLabel.textContent = state.watchlist.length;
    }

    if (!state.history.includes(movieId)) {
        state.history.unshift(movieId);
        if (state.history.length > 20) state.history.pop();
        if (typeof movie === 'object' && movie.links && movie.links.length === 0) {
            saveExternalMovieLocally(movie);
        }
        localStorage.setItem("filmhouse_history", JSON.stringify(state.history));
    }
    const countLabel = document.getElementById("stat-history-count");
    if (countLabel) countLabel.textContent = state.history.length;

    // Refresh recommendations list & profile summary
    renderEditorsChoice();
    if (typeof renderProfileWatchlistSummaries === 'function') {
        renderProfileWatchlistSummaries();
    }
}

function loadWatchHistory() {
    loadExternalMovies();
    const saved = localStorage.getItem("filmhouse_history");
    if (saved) {
        try {
            state.history = JSON.parse(saved);
        } catch (e) {
            state.history = [];
        }
    }
    const countLabel = document.getElementById("stat-history-count");
    if (countLabel) countLabel.textContent = state.history.length;
}

// Open YouTube Trailer video modal
function openTrailerModal(videoKey) {
    const modal = document.getElementById("trailer-modal");
    const container = document.getElementById("trailer-iframe-container");
    if (!modal || !container || !videoKey) return;

    container.replaceChildren();

    // Create sandbox iframe
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube.com/embed/${videoKey}?autoplay=1`;
    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    
    container.appendChild(iframe);
    modal.classList.add("active");
}

// Helper to fetch total season count for a TV Series from TMDB
async function fetchTvSeriesTotalSeasons(movie) {
    if (!movie) return 0;
    if (movie.number_of_seasons && typeof movie.number_of_seasons === "number") {
        return movie.number_of_seasons;
    }
    const apiKey = typeof getTmdbApiKey === "function" ? getTmdbApiKey() : "d638f7775bfa1b8d456dfd028ccbef19";
    const tmdbId = movie.tmdb_id || (movie.id && !isNaN(parseInt(movie.id, 10)) ? parseInt(movie.id, 10) : null);
    
    if (tmdbId) {
        try {
            const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.number_of_seasons) {
                    movie.number_of_seasons = data.number_of_seasons;
                    return data.number_of_seasons;
                }
            }
        } catch (e) {}
    }
    
    const searchTitle = typeof getCleanRequestTitle === "function" ? getCleanRequestTitle(movie.title || "") : (movie.title || "");
    if (searchTitle) {
        try {
            const res = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(searchTitle)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.results && data.results.length > 0) {
                    const tvId = data.results[0].id;
                    const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${tvId}?api_key=${apiKey}`);
                    if (detailRes.ok) {
                        const detailData = await detailRes.json();
                        if (detailData && detailData.number_of_seasons) {
                            movie.number_of_seasons = detailData.number_of_seasons;
                            return detailData.number_of_seasons;
                        }
                    }
                }
            }
        } catch (e) {}
    }
    return 0;
}

// Helper to fetch released/aired season numbers for a TV Series from TMDB (filtering out unreleased seasons)
async function fetchTvSeriesAiredSeasons(movie) {
    if (!movie) return [];
    const apiKey = typeof getTmdbApiKey === "function" ? getTmdbApiKey() : "d638f7775bfa1b8d456dfd028ccbef19";
    const tmdbId = movie.tmdb_id || (movie.id && !isNaN(parseInt(movie.id, 10)) ? parseInt(movie.id, 10) : null);
    
    let tvData = null;
    if (tmdbId) {
        try {
            const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`);
            if (res.ok) tvData = await res.json();
        } catch (e) {}
    }
    
    const searchTitle = typeof getCleanRequestTitle === "function" ? getCleanRequestTitle(movie.title || "") : (movie.title || "");
    if (!tvData && searchTitle) {
        try {
            const res = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(searchTitle)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.results && data.results.length > 0) {
                    const tvId = data.results[0].id;
                    const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${tvId}?api_key=${apiKey}`);
                    if (detailRes.ok) tvData = await detailRes.json();
                }
            }
        } catch (e) {}
    }

    if (!tvData || !tvData.seasons || !Array.isArray(tvData.seasons)) return [];

    const now = new Date();
    const releasedSeasons = [];

    tvData.seasons.forEach(s => {
        if (!s || s.season_number <= 0) return; // Skip specials
        
        let hasAired = false;
        if (s.air_date) {
            const airDate = new Date(s.air_date);
            if (airDate <= now) hasAired = true;
        }
        
        const epCount = typeof s.episode_count === 'number' ? s.episode_count : 0;
        if (hasAired && epCount > 0) {
            releasedSeasons.push({
                season_number: s.season_number,
                air_date: s.air_date,
                name: s.name || `Season ${s.season_number}`,
                episode_count: epCount
            });
        }
    });

    return releasedSeasons;
}

// Open Download Modal listing links
function openDownloadModal(movie) {
    const modal = document.getElementById("download-modal");
    const title = document.getElementById("download-modal-movie-title");
    const grid = document.getElementById("download-links-grid");
    const modalHeading = modal ? modal.querySelector(".download-modal-content > h2") : null;
    const sectionHeading = modal ? modal.querySelector(".download-options-section h3") : null;
    
    if (!modal || !title || !grid) return;

    const isTVShow = (movie.type || "").toLowerCase() === "series" || 
                     (movie.type || "").toLowerCase() === "tv" || 
                     (movie.categories && movie.categories.some(c => c.toLowerCase().includes("series")));

    title.textContent = movie.title;
    grid.replaceChildren();

    // Update modal heading and section heading based on type
    if (modalHeading) {
        modalHeading.textContent = isTVShow ? "Download Series" : "Download Movie";
    }
    if (sectionHeading) {
        sectionHeading.textContent = isTVShow ? "Available Seasons" : "Available Quality";
    }

    // Track uploaded season numbers for series
    const uploadedSeasonNums = new Set();

    // Quality labels for movies
    const qualityLabels = ["720p", "1080p", "4K UHD", "480p", "WEBDL", "BluRay"];
    const qualityIcons = ["🎬", "🎥", "✨", "📱", "🌐", "💿"];

    if (!movie.links || movie.links.length === 0) {
        if (!isTVShow) {
            const fallbackMsg = document.createElement("div");
            fallbackMsg.className = "download-empty-state";
            fallbackMsg.innerHTML = `
                <svg style="width:40px;height:40px;color:var(--text-muted);margin-bottom:10px;"><use href="#icon-download"></use></svg>
                <p style="color:var(--text-muted);font-size:13px;">No links available for this title yet.</p>
                <p style="color:var(--text-secondary);font-size:11px;margin-top:4px;">Check back soon!</p>
            `;
            fallbackMsg.style.cssText = "display:flex;flex-direction:column;align-items:center;padding:24px 0;";
            grid.appendChild(fallbackMsg);
        }
    } else {
        movie.links.forEach((link, idx) => {
            const linkUrl = typeof link === 'object' && link !== null ? link.url : link;
            if (isTVShow && (!linkUrl || !String(linkUrl).trim())) {
                return; // Skip blank season link slot
            }

            const anchor = document.createElement("div");
            anchor.className = "download-link-item";
            
            const matchingRequest = currentUserRequests && currentUserRequests.find(r => 
                r.title && getCleanRequestTitle(r.title).toLowerCase() === getCleanRequestTitle(movie.title).toLowerCase() &&
                r.status === "fulfilled"
            );

            if (matchingRequest) {
                anchor.addEventListener("click", () => {
                    showToast("Fulfillment download unlocked! Connecting directly...", "success");
                    logAppEvent("download", movie.csv_id || movie.id, movie.title);
                    window.open(linkUrl, "_blank");
                });
            } else {
                anchor.addEventListener("click", () => {
                    logAppEvent("download", movie.csv_id || movie.id, movie.title);
                    showConnectionDrawer(linkUrl, ADSGRAM_DOWNLOAD_BLOCK_ID);
                });
            }

            if (isTVShow) {
                // --- TV SERIES: Season layout ---
                const isObj = typeof link === 'object' && link !== null;
                const seasonLabel = isObj && link.season ? link.season : `Season ${idx + 1}`;
                const badgeText = isObj && link.shortLabel ? link.shortLabel : (isObj && link.season ? (link.season.replace(/[^0-9]/g, '') ? `S${link.season.replace(/[^0-9]/g, '')}` : link.season.substring(0, 4)) : `S${idx + 1}`);

                const sMatch = seasonLabel.match(/\d+/);
                if (sMatch) {
                    uploadedSeasonNums.add(parseInt(sMatch[0], 10));
                } else {
                    uploadedSeasonNums.add(idx + 1);
                }

                const badge = document.createElement("span");
                badge.className = "download-link-badge season-badge";
                badge.textContent = badgeText;
                anchor.appendChild(badge);

                const labelWrap = document.createElement("div");
                labelWrap.className = "download-link-label-wrap";
                const label = document.createElement("span");
                label.className = "download-link-label";
                label.textContent = seasonLabel;
                const isLatestSeason = idx === movie.links.length - 1;
                const isExplicitlyOngoingSeason = isObj && (link.type === "weekly" || (link.season && link.season.toLowerCase().includes("ongoing")));

                if (matchingRequest) {
                    sublabel.textContent = "Unlock Season • Free Fulfillment (No Ads)";
                } else if (isExplicitlyOngoingSeason || (isMovieOngoing(movie) && isLatestSeason)) {
                    sublabel.textContent = "🔴 Ongoing Season • New Episodes Added Weekly";
                } else {
                    sublabel.textContent = "Complete Season (All Episodes)";
                }
                labelWrap.appendChild(label);
                labelWrap.appendChild(sublabel);
                anchor.appendChild(labelWrap);
            } else {
                // --- MOVIE: Quality layout ---
                const isObj = typeof link === 'object' && link !== null;
                const qLabel = isObj && link.quality ? link.quality : (qualityLabels[idx] || `Link ${idx + 1}`);
                
                let qIcon = "📥";
                if (qLabel.includes("720p")) qIcon = "🎬";
                else if (qLabel.includes("1080p")) qIcon = "🎥";
                else if (qLabel.includes("4K") || qLabel.includes("2160p")) qIcon = "✨";
                else if (qLabel.includes("480p")) qIcon = "📱";
                else if (qLabel.includes("WEBDL")) qIcon = "🌐";
                else if (qLabel.includes("BluRay")) qIcon = "💿";
                else {
                    qIcon = qualityIcons[idx] || "📥";
                }

                const badge = document.createElement("span");
                badge.className = "download-link-badge quality-badge";
                badge.textContent = qIcon;
                anchor.appendChild(badge);

                const labelWrap = document.createElement("div");
                labelWrap.className = "download-link-label-wrap";
                const label = document.createElement("span");
                label.className = "download-link-label";
                label.textContent = qLabel;
                
                const sublabel = document.createElement("span");
                sublabel.className = "download-link-sublabel";
                
                let qualityText = "Direct Download";
                if (qLabel.includes("1080p")) qualityText = "High Quality (1080p)";
                else if (qLabel.includes("720p")) qualityText = "Standard Quality (720p)";
                else if (qLabel.includes("4K")) qualityText = "Ultra HD Quality (4K)";
                else if (qLabel.includes("480p")) qualityText = "Mobile Quality (480p)";
                
                if (matchingRequest) {
                    sublabel.textContent = `${qualityText} • Free Fulfillment (No Ads)`;
                } else {
                    sublabel.textContent = `${qualityText} • Watch Ad to Get Link`;
                }
                labelWrap.appendChild(label);
                labelWrap.appendChild(sublabel);
                anchor.appendChild(labelWrap);
            }

            const actionLabel = document.createElement("span");
            actionLabel.className = "download-link-action-label";
            actionLabel.textContent = isTVShow ? "Download 📥" : "Download 📥";
            actionLabel.appendChild(createSvgIcon("icon-download"));
            anchor.appendChild(actionLabel);

            grid.appendChild(anchor);
        });

        // Missing Quality Request Cards for Movies
        if (!isTVShow) {
            const uploadedQualities = (movie.links || []).map(l => {
                const q = typeof l === 'object' && l !== null ? (l.quality || "") : "";
                return q.toLowerCase();
            });

            const has1080p = uploadedQualities.some(q => q.includes("1080p"));
            const has4K = uploadedQualities.some(q => q.includes("4k") || q.includes("2160p"));

            const missingQualities = [];
            if (!has1080p) missingQualities.push({ label: "1080p Full HD", badge: "🎥 1080p", code: "1080p" });
            if (!has4K) missingQualities.push({ label: "4K Ultra HD", badge: "✨ 4K UHD", code: "4K" });

            if (missingQualities.length > 0) {
                const qWrapper = document.createElement("div");
                qWrapper.className = "missing-quality-wrapper";

                const divider = document.createElement("div");
                divider.style.cssText = "margin: 16px 0 10px 0; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 11px; font-weight: 800; text-transform: uppercase; color: #00c6ff; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;";
                divider.innerHTML = `<span>⚡</span><span>Request Higher Quality Version</span>`;
                qWrapper.appendChild(divider);

                missingQualities.forEach(qItem => {
                    const qItemEl = document.createElement("div");
                    qItemEl.className = "download-link-item missing-quality-item";
                    qItemEl.style.cssText = "border: 1px dashed rgba(0, 198, 255, 0.4); background: rgba(0, 198, 255, 0.05); display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: var(--border-radius-sm); margin-bottom: 8px;";

                    const badge = document.createElement("span");
                    badge.className = "download-link-badge quality-badge";
                    badge.style.cssText = "background: rgba(0, 198, 255, 0.2); color: #00c6ff; border: 1px solid rgba(0, 198, 255, 0.4); font-weight: 800; font-size: 11px; padding: 4px 8px; border-radius: 4px;";
                    badge.textContent = qItem.badge;
                    qItemEl.appendChild(badge);

                    const labelWrap = document.createElement("div");
                    labelWrap.className = "download-link-label-wrap";
                    labelWrap.style.cssText = "flex: 1; margin-left: 12px; display: flex; flex-direction: column; gap: 2px;";
                    
                    const label = document.createElement("span");
                    label.className = "download-link-label";
                    label.style.cssText = "font-weight: 700; color: #ffffff; font-size: 14px;";
                    label.textContent = qItem.label;
                    
                    const sublabel = document.createElement("span");
                    sublabel.className = "download-link-sublabel";
                    sublabel.style.cssText = "font-size: 11px; color: var(--text-secondary);";
                    sublabel.textContent = "Not Uploaded Yet • Tap to Request HD";

                    labelWrap.appendChild(label);
                    labelWrap.appendChild(sublabel);
                    qItemEl.appendChild(labelWrap);

                    const reqActionBtn = document.createElement("button");
                    reqActionBtn.className = "btn-request-quality-action";
                    
                    const reqQualityStr = `${qItem.code} Quality`;
                    const cleanMovieTitle = getCleanRequestTitle(movie.title).toLowerCase();
                    
                    const isAlreadyReq = currentUserRequests && currentUserRequests.some(r => {
                        const rClean = getCleanRequestTitle(r.title).toLowerCase();
                        const matchesTitle = rClean === cleanMovieTitle;
                        const matchesQuality = r.title && r.title.toLowerCase().includes(qItem.code.toLowerCase());
                        return matchesTitle && matchesQuality && r.status !== "fulfilled";
                    });

                    if (isAlreadyReq) {
                        reqActionBtn.textContent = `Requested ${qItem.code} ⏳`;
                        reqActionBtn.style.cssText = "background: rgba(0, 198, 255, 0.15); color: #00c6ff; border: 1px solid rgba(0, 198, 255, 0.4); font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 6px; cursor: default;";
                        sublabel.textContent = "Request Status: Pending Admin Fulfillment 📌";
                    } else {
                        reqActionBtn.textContent = `REQUEST ${qItem.code} ⚡`;
                        reqActionBtn.style.cssText = "background: linear-gradient(135deg, #00c6ff, #0072ff); color: #ffffff; border: none; font-size: 11px; font-weight: 800; padding: 7px 13px; border-radius: 6px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,198,255,0.3); transition: transform 0.15s ease;";
                        
                        reqActionBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            logMovieRequestToFirestore(movie, reqQualityStr);
                            reqActionBtn.textContent = `Requested ${qItem.code} ⏳`;
                            reqActionBtn.style.cssText = "background: rgba(0, 198, 255, 0.15); color: #00c6ff; border: 1px solid rgba(0, 198, 255, 0.4); font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 6px; cursor: default;";
                            sublabel.textContent = "Request Status: Pending Admin Fulfillment 📌";
                        });
                    }

                    qItemEl.appendChild(reqActionBtn);
                    qWrapper.appendChild(qItemEl);
                });

                grid.appendChild(qWrapper);
            }
        }
    }

    // TMDB Released-Only Missing Season Request Renderer for TV Series
    if (isTVShow) {
        fetchTvSeriesAiredSeasons(movie).then(releasedSeasons => {
            if (!releasedSeasons || releasedSeasons.length === 0) return;

            const missingReleasedSeasons = releasedSeasons.filter(s => !uploadedSeasonNums.has(s.season_number));
            if (missingReleasedSeasons.length === 0) return;

            grid.querySelectorAll(".missing-season-wrapper").forEach(el => el.remove());

            const wrapper = document.createElement("div");
            wrapper.className = "missing-season-wrapper";

            const divider = document.createElement("div");
            divider.style.cssText = "margin: 16px 0 10px 0; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 11px; font-weight: 800; text-transform: uppercase; color: #ffbc00; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;";
            divider.innerHTML = `<span>⚡</span><span>Request Missing Released Seasons</span>`;
            wrapper.appendChild(divider);

            missingReleasedSeasons.forEach(sObj => {
                const seasonNum = sObj.season_number;
                const missingItem = document.createElement("div");
                missingItem.className = "download-link-item missing-season-item";
                missingItem.style.cssText = "border: 1px dashed rgba(255, 188, 0, 0.4); background: rgba(255, 188, 0, 0.05); display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: var(--border-radius-sm); margin-bottom: 8px;";

                const badge = document.createElement("span");
                badge.className = "download-link-badge season-badge";
                badge.style.cssText = "background: rgba(255, 188, 0, 0.2); color: #ffbc00; border: 1px solid rgba(255, 188, 0, 0.4); font-weight: 800; font-size: 11px; padding: 4px 8px; border-radius: 4px;";
                badge.textContent = `S${seasonNum}`;
                missingItem.appendChild(badge);

                const labelWrap = document.createElement("div");
                labelWrap.className = "download-link-label-wrap";
                labelWrap.style.cssText = "flex: 1; margin-left: 12px; display: flex; flex-direction: column; gap: 2px;";
                
                const label = document.createElement("span");
                label.className = "download-link-label";
                label.style.cssText = "font-weight: 700; color: #ffffff; font-size: 14px;";
                label.textContent = `Season ${seasonNum}`;
                
                const sublabel = document.createElement("span");
                sublabel.className = "download-link-sublabel";
                sublabel.style.cssText = "font-size: 11px; color: var(--text-secondary);";
                sublabel.textContent = isMovieOngoing(movie) ? "🔴 Currently Airing • Tap to Request Episodes" : "Full Season Aired • Tap to Request Upload";

                labelWrap.appendChild(label);
                labelWrap.appendChild(sublabel);
                missingItem.appendChild(labelWrap);

                const reqActionBtn = document.createElement("button");
                reqActionBtn.className = "btn-request-season-action";
                
                const reqSeasonStr = `Season ${seasonNum}`;
                const cleanMovieTitle = getCleanRequestTitle(movie.title).toLowerCase();
                
                const isAlreadyReq = currentUserRequests && currentUserRequests.some(r => {
                    const rClean = getCleanRequestTitle(r.title).toLowerCase();
                    const matchesTitle = rClean === cleanMovieTitle;
                    const matchesSeason = (r.seasonOrPart && r.seasonOrPart.toLowerCase() === reqSeasonStr.toLowerCase()) || 
                                          (r.title && r.title.toLowerCase().includes(`season ${seasonNum}`));
                    return matchesTitle && matchesSeason && r.status !== "fulfilled";
                });

                if (isAlreadyReq) {
                    reqActionBtn.textContent = `Requested S${seasonNum} ⏳`;
                    reqActionBtn.style.cssText = "background: rgba(255, 188, 0, 0.15); color: #ffbc00; border: 1px solid rgba(255, 188, 0, 0.4); font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 6px; cursor: default;";
                    sublabel.textContent = "Request Status: Pending Admin Fulfillment 📌";
                } else {
                    reqActionBtn.textContent = `REQUEST S${seasonNum} ⚡`;
                    reqActionBtn.style.cssText = "background: linear-gradient(135deg, #ffbc00, #ff8c00); color: #000000; border: none; font-size: 11px; font-weight: 800; padding: 7px 13px; border-radius: 6px; cursor: pointer; box-shadow: 0 2px 8px rgba(255,188,0,0.3); transition: transform 0.15s ease;";
                    
                    reqActionBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        logMovieRequestToFirestore(movie, `Season ${seasonNum}`);
                        reqActionBtn.textContent = `Requested S${seasonNum} ⏳`;
                        reqActionBtn.style.cssText = "background: rgba(255, 188, 0, 0.15); color: #ffbc00; border: 1px solid rgba(255, 188, 0, 0.4); font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 6px; cursor: default;";
                        sublabel.textContent = "Request Status: Pending Admin Fulfillment 📌";
                    });
                }

                missingItem.appendChild(reqActionBtn);
                wrapper.appendChild(missingItem);
            });

            grid.appendChild(wrapper);
        });
    }

    modal.classList.add("active");
}

// Share Media integration
function shareMovie(movie) {
    const shareText = `Check out "${movie.title}" on Film House! Rating: ${movie.rating}/10. Play now: https://t.me/Filmhouseappbot/filmhouseapp`;
    const shareUrl = "https://t.me/Filmhouseappbot/filmhouseapp";
    const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
    
    // Award points (+2)
    awardPoints(2, "share");
    
    const tg = window.Telegram?.WebApp;
    if (tg && tg.openTelegramLink) {
        try {
            tg.openTelegramLink(telegramShareUrl);
            return;
        } catch (e) {
            console.error("tg.openTelegramLink failed, using fallback:", e);
        }
    }
    
    // Fallback if not inside Telegram or failed
    if (navigator.share) {
        navigator.share({
            title: 'Film House',
            text: shareText,
            url: shareUrl
        }).then(() => {
            showToast("Shared successfully!");
        }).catch(err => {
            window.open(telegramShareUrl, '_blank');
        });
    } else {
        window.open(telegramShareUrl, '_blank');
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast("Text copied to clipboard!");
    }).catch(() => {
        showToast("Failed to copy link automatically.", "error");
    });
}

// Initialize Adsgram controller dynamically for a specific block ID
function initializeAdsgram(blockId) {
    if (!window.Adsgram) {
        console.warn("Adsgram SDK not loaded yet.");
        return null;
    }
    
    const id = blockId || ADSGRAM_DOWNLOAD_BLOCK_ID;
    if (!state.adsgramControllers) {
        state.adsgramControllers = {};
    }
    
    if (!state.adsgramControllers[id]) {
        state.adsgramControllers[id] = window.Adsgram.init({ blockId: id });
    }
    return state.adsgramControllers[id];
}

function showAdRewardFlow(onStatusUpdate, blockId) {
    const status = (msg) => { if (typeof onStatusUpdate === "function") onStatusUpdate(msg); };

    // Check VIP Ad-Free Status
    const adFreeUntil = parseInt(localStorage.getItem("ad_free_until") || "0");
    if (adFreeUntil > Date.now()) {
        status("VIP Ad-Free Active! 🎫 Bypassing ads...");
        return Promise.resolve();
    }

    const id = blockId || ADSGRAM_DOWNLOAD_BLOCK_ID;

    // Detect if we are running inside a real Telegram environment with initData
    const isTelegramEnv = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== "";

    return new Promise((resolve) => {
        // Temporarily mock showAlert during the ad flow to suppress empty ad buffer error alerts
        const tg = window.Telegram?.WebApp;
        let originalShowAlert = null;
        if (tg && tg.showAlert) {
            originalShowAlert = tg.showAlert;
            tg.showAlert = function(options, callback) {
                console.log("Mocked WebApp.showAlert invoked:", options);
                const msg = typeof options === "string" ? options : (options?.message || "");
                if (msg.toLowerCase().includes("ad") || msg.toLowerCase().includes("oops") || msg.toLowerCase().includes("moment") || msg.toLowerCase().includes("later")) {
                    if (typeof callback === "function") callback();
                    return;
                }
                originalShowAlert.call(tg, options, callback);
            };
        }

        let resolved = false;
        const safeResolve = () => {
            if (tg && originalShowAlert) {
                tg.showAlert = originalShowAlert;
            }
            if (!resolved) { resolved = true; resolve(); }
        };

        // Safety timeout: auto-resolve after 60s so user is never stuck
        setTimeout(() => {
            if (!resolved) {
                console.warn("Adsgram ad flow timed out after 60s, bypassing.");
                status("Timed out – continuing");
                safeResolve();
            }
        }, 60000);

        if (!isTelegramEnv || !window.Adsgram) {
            status("Connecting…");
            safeResolve();
            return;
        }

        // Initialize video controller if not already done
        if (!state.adsgramControllers[id]) {
            state.adsgramControllers[id] = window.Adsgram.init({ blockId: id });
        }

        status("Loading ad…");
        const controller = state.adsgramControllers[id];
        if (controller) {
            controller.show().then(() => {
                status("Reward received ✓");
                safeResolve();
            }).catch((err) => {
                console.warn("Adsgram ad skipped or error:", err);
                status("No ad available – continuing");
                safeResolve();
            });
        } else {
            safeResolve();
        }
    });
}

// Initialize FAQ accordion details
function renderFAQAccordion() {
    const accordion = document.getElementById("faq-accordion");
    if (!accordion) return;

    accordion.replaceChildren();

    const faqs = [
        {
            q: "How do I download movies?",
            a: "Find the movie you want to download, click 'Download', watch the interstitial ad until completion, and select from the available download links which will direct you to the corresponding Telegram movie file storage."
        },
        {
            q: "Why are some movie links not loading?",
            a: "Telegram files are hosted inside custom channels. Ensure you have the Telegram app installed and have joined our primary updates channel (@filmhouse_main) to resolve connections."
        },
        {
            q: "How can I request new films?",
            a: "Navigate to the 'Feedback' tab in the navigation bar, choose 'Request Movie / Show' from the category dropdown, enter details, and submit the request directly to our catalog managers."
        },
        {
            q: "Can I watch movies on desktop?",
            a: "Yes! While optimized as a Telegram Mini App for mobile layout sizes, the website is fully compatible with standard computer web browsers."
        }
    ];

    faqs.forEach(faq => {
        const item = document.createElement("div");
        item.className = "faq-item";

        const qRow = document.createElement("div");
        qRow.className = "faq-question";
        
        const qText = document.createElement("span");
        qText.textContent = faq.q;
        qRow.appendChild(qText);
        
        const arrow = createSvgIcon("icon-chevron-right");
        qRow.appendChild(arrow);
        item.appendChild(qRow);

        const aRow = document.createElement("div");
        aRow.className = "faq-answer";
        const aText = document.createElement("p");
        aText.textContent = faq.a;
        aRow.appendChild(aText);
        item.appendChild(aRow);

        qRow.addEventListener("click", () => {
            const active = item.classList.contains("active");
            
            // Close active open rows
            const openRows = accordion.querySelectorAll(".faq-item.active");
            openRows.forEach(r => r.classList.remove("active"));

            if (!active) {
                item.classList.add("active");
            }
        });

        accordion.appendChild(item);
    });
}

// Genre mapping helper for TMDB Discover API
function getTmdbGenreId(genreName, isTV) {
    if (!genreName || genreName === "All") return null;
    const name = genreName.toLowerCase().trim();
    if (isTV) {
        if (name.includes("action") || name.includes("adventure")) return 10759;
        if (name.includes("animation")) return 16;
        if (name.includes("comedy")) return 35;
        if (name.includes("crime")) return 80;
        if (name.includes("documentary")) return 99;
        if (name.includes("drama")) return 18;
        if (name.includes("family")) return 10751;
        if (name.includes("kids")) return 10762;
        if (name.includes("mystery")) return 9648;
        if (name.includes("sci-fi") || name.includes("science") || name.includes("fantasy")) return 10765;
        if (name.includes("war") || name.includes("politics")) return 10768;
        if (name.includes("western")) return 37;
    } else {
        if (name.includes("action")) return 28;
        if (name.includes("adventure")) return 12;
        if (name.includes("animation")) return 16;
        if (name.includes("comedy")) return 35;
        if (name.includes("crime")) return 80;
        if (name.includes("documentary")) return 99;
        if (name.includes("drama")) return 18;
        if (name.includes("family")) return 10751;
        if (name.includes("fantasy")) return 14;
        if (name.includes("history")) return 36;
        if (name.includes("horror")) return 27;
        if (name.includes("music")) return 10402;
        if (name.includes("mystery")) return 9648;
        if (name.includes("romance")) return 10749;
        if (name.includes("science fiction") || name.includes("sci-fi")) return 878;
        if (name.includes("thriller")) return 53;
        if (name.includes("tv movie")) return 10770;
        if (name.includes("war")) return 10752;
        if (name.includes("western")) return 37;
    }
    return null;
}

// Global TMDB Discover Search when advanced filters are applied
let currentDiscoverAbortController = null;
async function performGlobalTmdbDiscover() {
    // If there is a text query, we don't run discover search (we run text search instead)
    if (state.searchQuery) return;
    
    // Check if filters are active (if all are default/empty, clear external discover results)
    const genre1 = state.filters.genre;
    const genre2 = state.filters.genre2;
    const rating = state.filters.rating;
    const year = state.filters.year;
    
    if (genre1 === "All" && genre2 === "All" && rating === 0 && year === "All") {
        state.externalSearchResults = [];
        return;
    }
    
    // Set up active loading state indicator
    const grid = document.getElementById("movies-grid-container");
    if (grid) {
        grid.replaceChildren();
        const loader = document.createElement("div");
        loader.className = "flex flex-col items-center justify-center py-10 w-full";
        loader.style.gridColumn = "1 / -1";
        loader.innerHTML = `
            <div class="loader-spinner" style="border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid var(--accent-color); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 12px; margin-left: auto; margin-right: auto;"></div>
            <p style="color: var(--text-secondary); font-size: 14px; text-align: center;">Searching global database...</p>
        `;
        grid.appendChild(loader);
    }
    
    // Abort previous discover request if still pending
    if (currentDiscoverAbortController) {
        currentDiscoverAbortController.abort();
    }
    currentDiscoverAbortController = new AbortController();
    const signal = currentDiscoverAbortController.signal;
    
    console.log("[Discover Debug] Querying TMDB discover with filters:", { genre1, genre2, rating, year });
    
    try {
        const apiKey = getTmdbApiKey();
        
        // Build genre ID strings
        const movieGenreIds = [getTmdbGenreId(genre1, false), getTmdbGenreId(genre2, false)].filter(id => id !== null).join(",");
        const tvGenreIds = [getTmdbGenreId(genre1, true), getTmdbGenreId(genre2, true)].filter(id => id !== null).join(",");
        
        // Build base discover queries
        let movieUrl = `${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&vote_average.gte=${rating}&sort_by=popularity.desc`;
        let tvUrl = `${TMDB_BASE_URL}/discover/tv?api_key=${apiKey}&vote_average.gte=${rating}&sort_by=popularity.desc`;
        
        if (movieGenreIds) movieUrl += `&with_genres=${movieGenreIds}`;
        if (tvGenreIds) tvUrl += `&with_genres=${tvGenreIds}`;
        
        if (year !== "All") {
            movieUrl += `&primary_release_year=${year}`;
            tvUrl += `&first_air_date_year=${year}`;
        }
        
        // Fetch concurrently
        const [movieRes, tvRes] = await Promise.all([
            fetch(movieUrl, { signal }).catch(e => null),
            fetch(tvUrl, { signal }).catch(e => null)
        ]);
        
        if (signal.aborted) return;
        
        let movieData = { results: [] };
        let tvData = { results: [] };
        
        if (movieRes && movieRes.ok) movieData = await movieRes.json();
        if (tvRes && tvRes.ok) tvData = await tvRes.json();
        
        const combinedResults = [];
        
        // Format movies
        movieData.results.forEach(item => {
            combinedResults.push({
                csv_id: String(item.id),
                tmdb_id: item.id,
                imdb_id: "",
                title: item.title || item.original_title || "",
                type: "Movie",
                categories: [],
                genres: [],
                overview: item.overview || "No synopsis available.",
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "img/FilmHouse3_nobg.png",
                backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : "img/FilmHouse.png",
                rating: Math.round((item.vote_average || 0) * 10) / 10,
                release_date: item.release_date || "",
                language: item.original_language || "en",
                cast: [],
                director: "",
                trailer: "",
                runtime: "",
                links: []
            });
        });
        
        // Format TV shows
        tvData.results.forEach(item => {
            combinedResults.push({
                csv_id: String(item.id),
                tmdb_id: item.id,
                imdb_id: "",
                title: item.name || item.original_name || "",
                type: "Series",
                categories: [],
                genres: [],
                overview: item.overview || "No synopsis available.",
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "img/FilmHouse3_nobg.png",
                backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : "img/FilmHouse.png",
                rating: Math.round((item.vote_average || 0) * 10) / 10,
                release_date: item.first_air_date || "",
                language: item.original_language || "en",
                cast: [],
                director: "",
                trailer: "",
                runtime: "",
                links: []
            });
        });
        
        // Deduplicate discover results against local database items
        const localTmdbIds = new Set(state.movies.map(m => m.tmdb_id).filter(id => id));
        state.externalSearchResults = combinedResults.filter(ext => !localTmdbIds.has(ext.tmdb_id));
        
        console.log("[Discover Debug] Fetched and filtered external discover results count:", state.externalSearchResults.length);
        
        // Re-trigger grid rendering to show the merged list
        renderFeaturedGrid(true);
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log("[Discover Debug] Discover fetch aborted.");
        } else {
            console.error("[Discover Debug] Error executing discover search: ", err);
        }
    }
}

// Universal live TMDB Category Fetcher for Anime, K-Drama, Bollywood, African, Comic, Animated, etc.
async function fetchTmdbCategoryMovies(category) {
    if (!category) return;
    if (state.isLoadingTmdbCategory) return;
    state.isLoadingTmdbCategory = true;
    renderFeaturedGrid();

    try {
        const apiKey = getTmdbApiKey();
        let urls = [];

        if (category === "Upcoming Movies" || category === "Latest Movies") {
            urls = [
                `${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&primary_release_date.gte=2024-01-01&with_original_language=en&sort_by=popularity.desc&page=1`,
                `${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_original_language=ko&primary_release_date.gte=2024-01-01&sort_by=popularity.desc&page=1`,
                `${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_original_language=hi&primary_release_date.gte=2024-01-01&sort_by=popularity.desc&page=1`
            ];
        } else if (category === "Ongoing Series") {
            urls = [
                `${TMDB_BASE_URL}/discover/tv?api_key=${apiKey}&air_date.gte=2024-01-01&first_air_date.gte=2023-01-01&with_original_language=en&sort_by=popularity.desc&page=1`,
                `${TMDB_BASE_URL}/discover/tv?api_key=${apiKey}&with_genres=16&with_original_language=ja&air_date.gte=2024-01-01&first_air_date.gte=2023-01-01&sort_by=popularity.desc&page=1`,
                `${TMDB_BASE_URL}/discover/tv?api_key=${apiKey}&with_original_language=ko&air_date.gte=2024-01-01&first_air_date.gte=2023-01-01&sort_by=popularity.desc&page=1`
            ];
        } else if (category === "Anime" || category === "Anime Series") {
            urls = [`${TMDB_BASE_URL}/discover/tv?api_key=${apiKey}&with_genres=16&with_original_language=ja&first_air_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Anime Movies") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_genres=16&with_original_language=ja&primary_release_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Korean Drama" || category === "Asian Drama") {
            urls = [`${TMDB_BASE_URL}/discover/tv?api_key=${apiKey}&with_original_language=ko|zh|ja|tr&first_air_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Korean Movies" || category === "Asian Movies") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_original_language=ko|zh|ja|tr&primary_release_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Bollywood") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_original_language=hi&primary_release_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "African") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_origin_country=NG|ZA|GH|KE&sort_by=popularity.desc&page=1`];
        } else if (category === "Comic") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_genres=28,878&primary_release_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Animated Movies") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_genres=16&primary_release_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Kids Shows and Movies (Nickelodeon and Disney)") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_genres=10751,16&primary_release_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Hollywood/British Movies") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_original_language=en&primary_release_date.gte=2024-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Hollywood/British Series") {
            urls = [`${TMDB_BASE_URL}/discover/tv?api_key=${apiKey}&with_original_language=en&first_air_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else if (category === "Classic Movies") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&primary_release_date.lte=1999-12-31&sort_by=popularity.desc&page=1`];
        } else if (category === "Teen/High-School") {
            urls = [`${TMDB_BASE_URL}/discover/movie?api_key=${apiKey}&with_genres=35,18&primary_release_date.gte=2023-01-01&sort_by=popularity.desc&page=1`];
        } else {
            urls = [`${TMDB_BASE_URL}/trending/all/week?api_key=${apiKey}&page=1`];
        }

        const responses = await Promise.all(urls.map(u => fetch(u).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] }))));
        
        let allResults = [];
        const seenIds = new Set();

        responses.forEach(data => {
            if (data && data.results && Array.isArray(data.results)) {
                data.results.forEach(item => {
                    if (item.id && !seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        allResults.push(item);
                    }
                });
            }
        });

        if (allResults.length > 0) {
            const formatted = allResults
                .filter(item => {
                    const releaseDate = item.release_date || item.first_air_date || "";
                    if (category === "Classic Movies") return true;
                    if (!releaseDate) return false;
                    const year = parseInt(releaseDate.substring(0, 4), 10);
                    if (category === "Ongoing Series" && year < 2023) return false;
                    if (category === "Upcoming Movies" && year < 2025) return false;
                    if (category !== "Classic Movies" && year < 2022) return false;
                    return true;
                })
                .map(item => {
                    const isTV = item.first_air_date || item.name || item.media_type === "tv";
                    const origLang = item.original_language || "";
                    
                    const genresList = [category];
                    if (origLang === "ja") genresList.push("Anime");
                    if (origLang === "ko") genresList.push("Korean", "Korean Drama");
                    if (origLang === "hi") genresList.push("Bollywood");
                    if (origLang === "en") genresList.push("Hollywood");

                    return {
                        csv_id: String(item.id),
                        tmdb_id: item.id,
                        imdb_id: "",
                        title: item.title || item.name || category,
                        type: isTV ? "Series" : "Movie",
                        categories: [category, "Main"],
                        genres: genresList,
                        overview: item.overview || "Popular recent release on Film House.",
                        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "img/FilmHouse3_nobg.png",
                        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : "img/FilmHouse.png",
                        rating: Math.round((item.vote_average || 0) * 10) / 10,
                        release_date: item.release_date || item.first_air_date || "",
                        language: origLang || "en",
                        cast: [],
                        director: "",
                        trailer: "",
                        runtime: "",
                        isUpcoming: category === "Upcoming Movies",
                        isOngoing: category === "Ongoing Series",
                        links: []
                    };
                });

            if (!state.categoryTmdbMovies) state.categoryTmdbMovies = {};
            const localTmdbIds = new Set(state.movies.map(m => m.tmdb_id).filter(id => id));
            state.categoryTmdbMovies[category] = formatted.filter(ext => !localTmdbIds.has(ext.tmdb_id));

            if (category === "Upcoming Movies") state.upcomingMovies = state.categoryTmdbMovies[category];
            if (category === "Ongoing Series") state.ongoingMovies = state.categoryTmdbMovies[category];
        }
    } catch (err) {
        console.error(`Error fetching TMDB live category movies for ${category}:`, err);
    } finally {
        state.isLoadingTmdbCategory = false;
        renderFeaturedGrid(true);
    }
}

// Fetch live upcoming movies from TMDB API (/movie/upcoming)
async function fetchTmdbUpcomingMovies() {
    return fetchTmdbCategoryMovies("Upcoming Movies");
}

// Fetch live currently airing TV series from TMDB API (/tv/on_the_air)
async function fetchTmdbOngoingSeries() {
    return fetchTmdbCategoryMovies("Ongoing Series");
}

// Global TMDB Multi-Search for global search support
async function performGlobalTmdbSearch(query) {
    if (!query || query.trim().length < 3 || state.searchQuery !== query) return;
    
    logAppEvent("search", query.trim(), query.trim());
    console.log("[Search Debug] Starting global search for query:", query);
    try {
        const apiKey = getTmdbApiKey();
        const url = `${TMDB_BASE_URL}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        console.log("[Search Debug] API response status:", res.status, res.statusText);
        if (!res.ok) {
            console.error("[Search Debug] API request failed with status:", res.status);
            return;
        }
        
        const data = await res.json();
        console.log("[Search Debug] Raw results count:", data.results ? data.results.length : 0);
        if (state.searchQuery !== query) {
            console.warn("[Search Debug] Search query changed while fetching. Aborting render.");
            return;
        }
        
        if (data.results) {
            const results = data.results.filter(item => item.media_type === 'movie' || item.media_type === 'tv');
            console.log("[Search Debug] Filtered movie/tv results count:", results.length);
            
            const formatted = results.map(item => {
                const title = item.title || item.name || "";
                const releaseDate = item.release_date || item.first_air_date || "";
                const mType = item.media_type === 'tv' ? 'Series' : 'Movie';
                
                return {
                    csv_id: String(item.id),
                    tmdb_id: item.id,
                    imdb_id: "",
                    title: title,
                    type: mType,
                    categories: [],
                    genres: [],
                    overview: item.overview || "No synopsis available.",
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "img/FilmHouse3_nobg.png",
                    backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : "img/FilmHouse.png",
                    rating: Math.round((item.vote_average || 0) * 10) / 10,
                    release_date: releaseDate,
                    language: item.original_language || "en",
                    cast: [],
                    director: "",
                    trailer: "",
                    runtime: "",
                    links: []
                };
            });
            
            const localTmdbIds = new Set(state.movies.map(m => m.tmdb_id).filter(id => id));
            state.externalSearchResults = formatted.filter(ext => !localTmdbIds.has(ext.tmdb_id));
            console.log("[Search Debug] Final external search results to display:", state.externalSearchResults.length);
            
            renderFeaturedGrid();
        }
    } catch (err) {
        console.error("[Search Debug] Error doing global search: ", err);
    }
}

// Event Bindings and Setup listeners
function bindEvents() {
    // Top Nav triggers
    const logoTrigger = document.getElementById("logo-home-trigger");
    if (logoTrigger) {
        logoTrigger.addEventListener("click", () => {
            navigateToScreen("home");
        });
    }

    const profileTrigger = document.getElementById("profile-drawer-trigger");
    if (profileTrigger) {
        profileTrigger.addEventListener("click", () => {
            navigateToScreen("profile");
        });
    }

    const profileDrawer = document.getElementById("profile-drawer");
    const btnCloseProfile = document.getElementById("btn-close-profile");
    if (btnCloseProfile && profileDrawer) {
        btnCloseProfile.addEventListener("click", () => {
            profileDrawer.classList.remove("active");
        });
    }
    
    // Close profile drawer if clicked outside card area
    if (profileDrawer) {
        profileDrawer.addEventListener("click", (e) => {
            if (e.target === profileDrawer) {
                profileDrawer.classList.remove("active");
            }
        });
    }

    // Modal close binds
    const setupModalClose = (modalId, btnId) => {
        const modal = document.getElementById(modalId);
        const btn = document.getElementById(btnId);
        if (modal && btn) {
            btn.addEventListener("click", () => {
                modal.classList.remove("active");
                // Stop iframe video streaming on trailer close
                if (modalId === "trailer-modal") {
                    const frameBox = document.getElementById("trailer-iframe-container");
                    if (frameBox) frameBox.replaceChildren();
                }
            });
            // Click outside close
            modal.addEventListener("click", (e) => {
                if (e.target === modal) {
                    modal.classList.remove("active");
                    if (modalId === "trailer-modal") {
                        const frameBox = document.getElementById("trailer-iframe-container");
                        if (frameBox) frameBox.replaceChildren();
                    }
                }
            });
        }
    };
    
    setupModalClose("detail-modal", "btn-close-detail");
    setupModalClose("trailer-modal", "btn-close-trailer");
    setupModalClose("download-modal", "btn-close-download");


    const btnDwnCancel = document.getElementById("btn-download-cancel");
    if (btnDwnCancel) {
        btnDwnCancel.addEventListener("click", () => {
            const m = document.getElementById("download-modal");
            if (m) m.classList.remove("active");
        });
    }

    // Bottom tab navigations
    const bottomNavItems = document.querySelectorAll(".bottom-nav-item");
    bottomNavItems.forEach(item => {
        item.addEventListener("click", () => {
            const target = item.getAttribute("data-target");
            navigateToScreen(target);
            triggerHaptic("selection");
        });
    });

    // Profile Help Button
    const btnProfileHelp = document.getElementById("btn-profile-help");
    if (btnProfileHelp) {
        btnProfileHelp.addEventListener("click", () => {
            navigateToScreen("help");
        });
    }

    // Mining Tutorial Guide Modal Event Listeners
    const btnMiningGuide = document.getElementById("btn-mining-guide");
    const miningGuideModal = document.getElementById("mining-guide-modal");
    const btnCloseMiningGuide = document.getElementById("btn-close-mining-guide");
    const btnMiningGuideOk = document.getElementById("btn-mining-guide-ok");

    if (btnMiningGuide && miningGuideModal) {
        btnMiningGuide.addEventListener("click", () => {
            miningGuideModal.classList.add("active");
            triggerHaptic("selection");
        });
    }
    if (btnCloseMiningGuide && miningGuideModal) {
        btnCloseMiningGuide.addEventListener("click", () => {
            miningGuideModal.classList.remove("active");
            triggerHaptic("selection");
        });
    }
    if (btnMiningGuideOk && miningGuideModal) {
        btnMiningGuideOk.addEventListener("click", () => {
            miningGuideModal.classList.remove("active");
            triggerHaptic("success");
        });
    }

    // Points Mining Action Button
    const btnFarmAction = document.getElementById("btn-farm-action");
    if (btnFarmAction) {
        btnFarmAction.addEventListener("click", () => {
            const startedAt = state.user.farmingStartedAt || 0;
            if (startedAt === 0) {
                // Start mining session
                const now = Date.now();
                state.user.farmingStartedAt = now;
                
                // Save local profile cache
                const saved = localStorage.getItem("filmhouse_user_profile");
                let profile = {};
                if (saved) {
                    try { profile = JSON.parse(saved); } catch (e) {}
                }
                profile.farmingStartedAt = now;
                localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
                
                // Sync to Firestore
                if (typeof firebase !== "undefined" && db && state.user.id) {
                    db.collection("users").doc(state.user.id).update({
                        farmingStartedAt: now,
                        farmingReminded: false
                    }).catch(err => console.warn("Error saving farming state:", err));
                }
                
                updateFarmingUI();
                triggerHaptic("medium");
                showToast("Mining session started! Check back in 8 hours.", "success");
            } else {
                const elapsed = Date.now() - startedAt;
                if (elapsed >= FARMING_DURATION) {
                    // Claim farming rewards
                    state.user.farmingStartedAt = 0;
                    triggerHaptic("success");
                    
                    // Save local profile cache
                    const saved = localStorage.getItem("filmhouse_user_profile");
                    let profile = {};
                    if (saved) {
                        try { profile = JSON.parse(saved); } catch (e) {}
                    }
                    profile.farmingStartedAt = 0;
                    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
                    
                    // Sync to Firestore
                    if (typeof firebase !== "undefined" && db && state.user.id) {
                        db.collection("users").doc(state.user.id).update({
                            farmingStartedAt: 0,
                            farmingReminded: false
                        }).catch(err => console.warn("Error updating farming state:", err));
                    }
                    
                    // Award the reward points!
                    awardPoints(FARMING_REWARD, "mining");
                    updateFarmingUI();
                }
            }
        });
    }

    // Segmented watchlist toggle tabs
    const btnToggleWatchlist = document.getElementById("btn-toggle-watchlist");
    const btnToggleWatched = document.getElementById("btn-toggle-watched");
    if (btnToggleWatchlist && btnToggleWatched) {
        btnToggleWatchlist.addEventListener("click", () => {
            state.activeWatchlistTab = "watchlist";
            btnToggleWatchlist.classList.add("active");
            btnToggleWatched.classList.remove("active");
            btnToggleWatchlist.style.color = "var(--text-primary)";
            btnToggleWatched.style.color = "var(--text-secondary)";
            renderWatchlistGrid();
        });
        btnToggleWatched.addEventListener("click", () => {
            state.activeWatchlistTab = "watched";
            btnToggleWatched.classList.add("active");
            btnToggleWatchlist.classList.remove("active");
            btnToggleWatched.style.color = "var(--text-primary)";
            btnToggleWatchlist.style.color = "var(--text-secondary)";
            renderWatchlistGrid();
        });
    }

    // Leaderboard entries click triggers
    const headerTrophyBtn = document.getElementById("btn-header-leaderboard");
    if (headerTrophyBtn) {
        headerTrophyBtn.addEventListener("click", () => {
            navigateToScreen("leaderboard");
        });
    }

    const rankingCard = document.getElementById("profile-loyalty-ranking-card");
    if (rankingCard) {
        rankingCard.addEventListener("click", () => {
            navigateToScreen("leaderboard");
        });
    }

    const btnWatchlistExplore = document.getElementById("btn-watchlist-explore");
    if (btnWatchlistExplore) {
        btnWatchlistExplore.addEventListener("click", () => {
            navigateToScreen("home");
        });
    }

    // Search bar triggers & Mobile Expansion Overlay
    const searchInput = document.getElementById("global-search-input");
    const searchWrapper = document.querySelector(".search-bar-wrapper");
    const searchIcon = document.querySelector(".search-icon");
    let searchDebounceTimer = null;
    if (searchInput) {
        const clearBtn = document.getElementById("search-clear-btn");
        const dropdown = document.getElementById("search-autocomplete-dropdown");
        
        const renderAutocomplete = (query) => {
            if (!dropdown) return;
            const q = (query || "").toLowerCase().trim();
            const badgePrefix = window.location.pathname.includes("/MOVIE/") ? "" : "MOVIE/";
            
            if (q.length < 2) {
                dropdown.style.display = "none";
                dropdown.innerHTML = "";
                return;
            }
            
            // Filter local library movies
            const matches = state.movies.filter(m => 
                (m.title || "").toLowerCase().includes(q)
            ).slice(0, 5);
            
            if (matches.length === 0) {
                dropdown.style.display = "none";
                dropdown.innerHTML = "";
                return;
            }
            
            dropdown.innerHTML = "";
            matches.forEach(m => {
                const item = document.createElement("div");
                item.className = "autocomplete-item";
                
                const posterUrl = m.poster || (badgePrefix + "img/FilmHouse3_nobg.png");
                const genreStr = Array.isArray(m.genres) ? m.genres.join(", ") : (m.genre || "Media");
                const ratingStr = m.rating ? `⭐ ${m.rating}` : "N/A";
                
                item.innerHTML = `
                    <img src="${escapeHTML(posterUrl)}" alt="Poster" class="autocomplete-poster" onerror="this.src='${badgePrefix}img/FilmHouse3_nobg.png'">
                    <div class="autocomplete-details">
                        <div class="autocomplete-title">${escapeHTML(m.title)}</div>
                        <div class="autocomplete-meta">${escapeHTML(genreStr)} | ${ratingStr}</div>
                    </div>
                `;
                
                item.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openDetailModal(m);
                    dropdown.style.display = "none";
                    dropdown.innerHTML = "";
                });
                
                dropdown.appendChild(item);
            });
            dropdown.style.display = "flex";
        };

        let localSearchDebounceTimer = null;
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value;
            state.searchQuery = query;
            state.visibleCount = 24;
            if (clearBtn) {
                clearBtn.style.display = query ? "flex" : "none";
            }
            
            if (query.trim().length > 0) {
                document.body.classList.add("search-active");
            } else {
                document.body.classList.remove("search-active");
            }
            
            renderAutocomplete(query);

            // Debounce local grid rendering to prevent keystroke input stuttering/lag
            clearTimeout(localSearchDebounceTimer);
            localSearchDebounceTimer = setTimeout(() => {
                if (query.trim().length < 3) {
                    state.externalSearchResults = [];
                    renderFeaturedGrid();
                } else {
                    renderFeaturedGrid();
                }
            }, 180);

            // Debounce external TMDB global search (only for queries length >= 3)
            if (query.trim().length >= 3) {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => {
                    performGlobalTmdbSearch(query);
                }, 400);
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                searchInput.value = "";
                state.searchQuery = "";
                state.visibleCount = 24;
                state.externalSearchResults = [];
                clearBtn.style.display = "none";
                if (dropdown) {
                    dropdown.style.display = "none";
                    dropdown.innerHTML = "";
                }
                document.body.classList.remove("search-active");
                renderFeaturedGrid();
                searchInput.focus();
            });
        }

        document.addEventListener("click", (e) => {
            if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) {
                dropdown.style.display = "none";
            }
        });
    }
    if (searchWrapper && searchInput && searchIcon) {
        searchIcon.addEventListener("click", (e) => {
            if (window.innerWidth < 600) {
                e.stopPropagation();
                if (!searchWrapper.classList.contains("expanded")) {
                    searchWrapper.classList.add("expanded");
                    searchInput.focus();
                } else {
                    if (!searchInput.value.trim()) {
                        searchWrapper.classList.remove("expanded");
                    }
                }
            }
        });
        
        document.addEventListener("click", (e) => {
            if (window.innerWidth < 600) {
                if (searchWrapper.classList.contains("expanded") && !searchWrapper.contains(e.target)) {
                    const filtersPanel = document.getElementById("search-filters-panel");
                    if (!filtersPanel || !filtersPanel.contains(e.target)) {
                        searchWrapper.classList.remove("expanded");
                    }
                }
            }
        });
    }

    // Filters drop down visibility toggle
    const filterToggle = document.getElementById("search-filter-toggle");
    const filterPanel = document.getElementById("search-filters-panel");
    if (filterToggle && filterPanel) {
        filterToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            const active = filterToggle.classList.contains("active");
            if (active) {
                filterToggle.classList.remove("active");
                filterPanel.style.display = "none";
            } else {
                filterToggle.classList.add("active");
                filterPanel.style.display = "flex";
            }
        });
    }

    // Categories bar slider horizontal scroll indicators
    const catSlider = document.getElementById("categories-bar-slider");
    const catLeftBtn = document.getElementById("categories-scroll-left");
    const catRightBtn = document.getElementById("categories-scroll-right");
    if (catSlider && catLeftBtn && catRightBtn) {
        const updateScrollArrows = () => {
            const scrollLeft = catSlider.scrollLeft;
            const maxScroll = catSlider.scrollWidth - catSlider.clientWidth;
            catLeftBtn.style.display = scrollLeft > 5 ? "flex" : "none";
            catRightBtn.style.display = scrollLeft < maxScroll - 5 ? "flex" : "none";
        };
        
        catSlider.addEventListener("scroll", updateScrollArrows);
        window.addEventListener("resize", updateScrollArrows);
        
        catLeftBtn.addEventListener("click", () => {
            catSlider.scrollBy({ left: -200, behavior: "smooth" });
        });
        catRightBtn.addEventListener("click", () => {
            catSlider.scrollBy({ left: 200, behavior: "smooth" });
        });
        
        // Initial execution check
        setTimeout(updateScrollArrows, 500);
    }

    // Apply Filter actions
    const btnApplyFilters = document.getElementById("btn-apply-filters");
    if (btnApplyFilters) {
        btnApplyFilters.addEventListener("click", () => {
            const genreVal = document.getElementById("filter-genre").value;
            const genreVal2 = document.getElementById("filter-genre-2").value;
            const ratingVal = parseFloat(document.getElementById("filter-rating").value) || 0;
            const yearVal = document.getElementById("filter-year").value;

            state.filters.genre = genreVal;
            state.filters.genre2 = genreVal2;
            state.filters.rating = ratingVal;
            state.filters.year = yearVal;
            state.visibleCount = 24;

            renderFeaturedGrid();
            renderGenreChips();
            
            // Close filters panel
            if (filterToggle && filterPanel) {
                filterToggle.classList.remove("active");
                filterPanel.style.display = "none";
            }
        });
    }

    // Reset filters
    const btnResetFilters = document.getElementById("btn-reset-filters");
    if (btnResetFilters) {
        btnResetFilters.addEventListener("click", () => {
            document.getElementById("filter-genre").value = "All";
            document.getElementById("filter-genre-2").value = "All";
            document.getElementById("filter-rating").value = "0";
            document.getElementById("filter-year").value = "All";

            state.filters.genre = "All";
            state.filters.genre2 = "All";
            state.filters.rating = 0;
            state.filters.year = "All";
            state.filters.selectedGenres = ["All"];
            state.visibleCount = 24;
            state.externalSearchResults = [];

            renderFeaturedGrid();
            renderGenreChips();
        });
    }

    // Feedback Submit handler
    const feedbackForm = document.getElementById("feedback-form");
    if (feedbackForm) {
        feedbackForm.addEventListener("submit", (e) => {
            e.preventDefault();
            
            const category = document.getElementById("feedback-type").value;
            const subject = document.getElementById("feedback-subject").value;
            const message = document.getElementById("feedback-message").value;

            // Save feedback locally in mock database
            const feedbackList = JSON.parse(localStorage.getItem("filmhouse_user_feedbacks") || "[]");
            feedbackList.push({
                user: state.user.username,
                category,
                subject,
                message,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem("filmhouse_user_feedbacks", JSON.stringify(feedbackList));

            // Sync feedback to Firestore (notifications are handled securely by backend bot listener)
            if (typeof firebase !== "undefined" && db) {
                db.collection("feedbacks").add({
                    user: state.user.username || "guest",
                    userId: state.user.id || "",
                    category: category,
                    subject: subject,
                    message: message,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(err => console.warn("Error saving feedback to Firestore:", err));
            }

            showToast("Feedback submitted successfully!");
            feedbackForm.reset();
            navigateToScreen("home");
        });
    }

    // Support contact submit handler
    const supportForm = document.getElementById("support-contact-form");
    if (supportForm) {
        supportForm.addEventListener("submit", (e) => {
            e.preventDefault();
            
            const email = document.getElementById("contact-email").value;
            const msg = document.getElementById("contact-message").value;

            // Mock submit support ticket
            const tickets = JSON.parse(localStorage.getItem("filmhouse_support_tickets") || "[]");
            tickets.push({
                user: state.user.username,
                email,
                message: msg,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem("filmhouse_support_tickets", JSON.stringify(tickets));

            showToast("Support ticket created! We will contact you soon.");
            supportForm.reset();
            navigateToScreen("home");
        });
    }

    // TMDB API Key Save binding
    const btnSaveTmdbKey = document.getElementById("btn-save-tmdb-key");
    const inputTmdbKey = document.getElementById("settings-tmdb-key");
    if (btnSaveTmdbKey && inputTmdbKey) {
        // Populate current key if exists
        inputTmdbKey.value = localStorage.getItem("filmhouse_tmdb_key") || "";
        
        btnSaveTmdbKey.addEventListener("click", () => {
            const key = inputTmdbKey.value.trim();
            if (key) {
                localStorage.setItem("filmhouse_tmdb_key", key);
                showToast("TMDB API Key saved successfully!");
                // Clear movie database cache to force reload under the new key
                localStorage.removeItem("filmhouse_enriched_db_v4");
            } else {
                localStorage.removeItem("filmhouse_tmdb_key");
                showToast("TMDB API Key reset to default.");
            }
        });
    }

    // Log out / Disconnect Account
    const btnLogout = document.getElementById("btn-account-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", () => {
            // Invalidate local storage cache and reload page triggering fresh login handshake
            localStorage.removeItem("filmhouse_enriched_db_v4");
            localStorage.removeItem("filmhouse_watchlist");
            localStorage.removeItem("filmhouse_history");
            localStorage.removeItem("filmhouse_user_profile");
            localStorage.removeItem("filmhouse_notifications_status");
            showToast("State reset. Reloading app...");
            setTimeout(() => {
                window.location.reload();
            }, 800);
        });
    }

    // Invite Friends logic and Share App Modal
    const btnInviteFriends = document.getElementById("btn-invite-friends");
    const shareModal = document.getElementById("share-app-modal");
    const btnCloseShareModal = document.getElementById("btn-close-share-modal");
    
    if (btnInviteFriends && shareModal) {
        btnInviteFriends.addEventListener("click", () => {
            shareModal.classList.add("active");
        });
    }
    
    if (btnCloseShareModal && shareModal) {
        btnCloseShareModal.addEventListener("click", () => {
            shareModal.classList.remove("active");
        });
    }
    
    if (shareModal) {
        shareModal.addEventListener("click", (e) => {
            if (e.target === shareModal) {
                shareModal.classList.remove("active");
            }
        });
    }

    const optWhatsapp = document.getElementById("share-opt-whatsapp");
    const optTelegram = document.getElementById("share-opt-telegram");
    const optTwitter = document.getElementById("share-opt-twitter");
    const optCopy = document.getElementById("share-opt-copy");
    
    const inviteShareText = `Hey! Check out Film House, the ultimate app to watch and download your favorite movies and series directly inside Telegram! 🎬🍿`;
    
    // Dynamic invitation URL builder
    const getInviteShareUrl = () => {
        const referrerParam = state.user && state.user.id && state.user.id !== "000000000" ? `?startapp=ref_${state.user.id}` : "";
        return `https://t.me/Filmhouseappbot/filmhouseapp${referrerParam}`;
    };

    const getFullInviteMessage = () => {
        return `${inviteShareText}\nPlay now: ${getInviteShareUrl()}`;
    };
    
    if (optWhatsapp) {
        optWhatsapp.addEventListener("click", () => {
            const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(getFullInviteMessage())}`;
            window.open(whatsappUrl, "_blank");
            checkAndResetDailyMissions();
            if (!state.user.dailyStats.inviteShared) {
                state.user.dailyStats.inviteShared = true;
                saveDailyStats();
                if (typeof awardPoints === "function") {
                    awardPoints(5, "share");
                }
            } else {
                showToast("Invite link shared! (Daily reward already claimed)", "info");
            }
            if (shareModal) shareModal.classList.remove("active");
        });
    }
    
    if (optTelegram) {
        optTelegram.addEventListener("click", () => {
            const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(getInviteShareUrl())}&text=${encodeURIComponent(inviteShareText)}`;
            const tg = window.Telegram?.WebApp;
            if (tg && tg.openTelegramLink) {
                try {
                    tg.openTelegramLink(telegramShareUrl);
                } catch (e) {
                    window.open(telegramShareUrl, "_blank");
                }
            } else {
                window.open(telegramShareUrl, "_blank");
            }
            checkAndResetDailyMissions();
            if (!state.user.dailyStats.inviteShared) {
                state.user.dailyStats.inviteShared = true;
                saveDailyStats();
                if (typeof awardPoints === "function") {
                    awardPoints(5, "share");
                }
            } else {
                showToast("Invite link shared! (Daily reward already claimed)", "info");
            }
            if (shareModal) shareModal.classList.remove("active");
        });
    }
    
    if (optTwitter) {
        optTwitter.addEventListener("click", () => {
            const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(getFullInviteMessage())}`;
            window.open(twitterUrl, "_blank");
            checkAndResetDailyMissions();
            if (!state.user.dailyStats.inviteShared) {
                state.user.dailyStats.inviteShared = true;
                saveDailyStats();
                if (typeof awardPoints === "function") {
                    awardPoints(5, "share");
                }
            } else {
                showToast("Invite link shared! (Daily reward already claimed)", "info");
            }
            if (shareModal) shareModal.classList.remove("active");
        });
    }
    
    if (optCopy) {
        optCopy.addEventListener("click", () => {
            if (typeof copyToClipboard === "function") {
                copyToClipboard(getFullInviteMessage());
            }
            checkAndResetDailyMissions();
            if (!state.user.dailyStats.inviteShared) {
                state.user.dailyStats.inviteShared = true;
                saveDailyStats();
                if (typeof awardPoints === "function") {
                    awardPoints(5, "share");
                }
            } else {
                showToast("Invite link copied to clipboard!", "success");
            }
            if (shareModal) shareModal.classList.remove("active");
        });
    }

    // Collapsible Profile Edit Toggle
    const btnToggleEdit = document.getElementById("btn-toggle-edit-profile");
    const editSection = document.getElementById("profile-edit-section");
    const editChevron = document.getElementById("edit-profile-chevron");
    if (btnToggleEdit && editSection) {
        btnToggleEdit.addEventListener("click", () => {
            const isHidden = editSection.style.display === "none" || !editSection.style.display;
            editSection.style.display = isHidden ? "flex" : "none";
            if (editChevron) {
                if (isHidden) {
                    editChevron.classList.add("chevron-rotated");
                } else {
                    editChevron.classList.remove("chevron-rotated");
                }
            }
        });
    }

    // Save Profile Changes
    const btnSaveProfile = document.getElementById("btn-save-profile-changes");
    if (btnSaveProfile) {
        btnSaveProfile.addEventListener("click", () => {
            saveProfile();
        });
    }

    // Notifications toggle switch display synchronization
    const toggleNotifications = document.getElementById("settings-notifications-toggle");
    const notificationSubOptions = document.getElementById("notification-sub-options");
    if (toggleNotifications && notificationSubOptions) {
        toggleNotifications.addEventListener("change", () => {
            notificationSubOptions.style.display = toggleNotifications.checked ? "flex" : "none";
            saveProfile();
        });
    }

    // Auto save on sub-option clicks
    const subOpts = ["sub-opt-anime", "sub-opt-hollywood", "sub-opt-recs"];
    subOpts.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => {
                saveProfile();
            });
        }
    });

    // Notifications Center Modal Triggers
    const btnViewNotifications = document.getElementById("btn-view-notifications");
    const notificationsModal = document.getElementById("notifications-modal");
    const btnCloseNotifications = document.getElementById("btn-close-notifications");
    
    if (btnViewNotifications && notificationsModal) {
        btnViewNotifications.addEventListener("click", () => {
            renderNotificationsList();
            notificationsModal.classList.add("active");
        });
    }
    
    if (btnCloseNotifications && notificationsModal) {
        btnCloseNotifications.addEventListener("click", () => {
            notificationsModal.classList.remove("active");
        });
    }
    
    if (notificationsModal) {
        notificationsModal.addEventListener("click", (e) => {
            if (e.target === notificationsModal) {
                notificationsModal.classList.remove("active");
            }
        });
    }

    // Mark all notifications read
    const btnClearNotifications = document.getElementById("btn-clear-notifications");
    if (btnClearNotifications) {
        btnClearNotifications.addEventListener("click", () => {
            state.notifications.forEach(n => {
                n.unread = false;
            });
            const storedStatus = {};
            state.notifications.forEach(n => {
                storedStatus[n.id] = false;
            });
            localStorage.setItem("filmhouse_notifications_status", JSON.stringify(storedStatus));
            updateNotificationsBadge();
            renderNotificationsList();
            showToast("All notifications marked as read.");
        });
    }

    // Watch History Modal Triggers
    const btnViewHistory = document.getElementById("btn-view-watch-history");
    const historyModal = document.getElementById("history-modal");
    const btnCloseHistory = document.getElementById("btn-close-history");
    
    if (btnViewHistory && historyModal) {
        btnViewHistory.addEventListener("click", () => {
            renderHistoryGrid();
            historyModal.classList.add("active");
        });
    }
    
    if (btnCloseHistory && historyModal) {
        btnCloseHistory.addEventListener("click", () => {
            historyModal.classList.remove("active");
        });
    }
    
    if (historyModal) {
        historyModal.addEventListener("click", (e) => {
            if (e.target === historyModal) {
                historyModal.classList.remove("active");
            }
        });
    }

    // Clear History Button
    const btnClearHistory = document.getElementById("btn-clear-history");
    if (btnClearHistory) {
        btnClearHistory.addEventListener("click", () => {
            clearWatchHistory();
        });
    }

    // Profile Picture File Upload binding
    const imageWrapper = document.getElementById("profile-image-upload-wrapper");
    const fileInput = document.getElementById("profile-pic-input");
    if (imageWrapper && fileInput) {
        imageWrapper.addEventListener("click", () => {
            fileInput.click();
        });
        
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(evt) {
                    state.user.avatar = evt.target.result;
                    
                    const profileObj = {
                        fullName: state.user.fullName,
                        avatar: state.user.avatar,
                        favoriteCategories: state.user.favoriteCategories,
                        notificationsEnabled: state.user.notificationsEnabled,
                        subAnime: state.user.subAnime,
                        subHollywood: state.user.subHollywood,
                        subRecs: state.user.subRecs,
                        contactPreference: state.user.contactPreference
                    };
                    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profileObj));
                    
                    loadUserProfile();
                    showToast("Profile picture updated!");
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Save Profile Page preferences button binding
    const btnSaveProfilePage = document.getElementById("btn-save-profile-page");
    if (btnSaveProfilePage) {
        btnSaveProfilePage.addEventListener("click", () => {
            saveProfile(true);
        });
    }

    // Reset Account / Delete Profile logic for testing and database cleanup
    const btnResetAccount = document.getElementById("btn-reset-account");
    if (btnResetAccount) {
        btnResetAccount.addEventListener("click", () => {
            const confirmed = confirm("⚠️ Are you sure you want to RESET your account? This will DELETE your profile from the database and clear all points, so you can test as a completely fresh new user. Proceed?");
            if (confirmed) {
                triggerHaptic("warning");
                
                // Show loading state on button
                btnResetAccount.disabled = true;
                btnResetAccount.textContent = "Deleting Profile... ⏳";
                
                // Clear local storage profile keys
                localStorage.removeItem("filmhouse_user_profile");
                localStorage.removeItem("filmhouse_tour_completed");
                localStorage.removeItem("acknowledged_fulfillments");

                // Delete from Firestore
                if (db && state.user.id) {
                    db.collection("users").doc(state.user.id).delete()
                        .then(() => {
                            showToast("Profile deleted from Firestore successfully!", "success");
                            setTimeout(() => {
                                window.location.reload();
                            }, 1000);
                        })
                        .catch(err => {
                            console.error("Error deleting document from Firestore:", err);
                            showToast("Failed to delete from Firestore. Clearing local data and reloading...", "warning");
                            setTimeout(() => {
                                window.location.reload();
                            }, 1500);
                        });
                } else {
                    showToast("No active database connection found. Reloading...", "warning");
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                }
            }
        });
    }

    // Simulated Telegram OAuth handlers
    const btnOAuth = document.getElementById("btn-telegram-login-oauth");
    const btnGuest = document.getElementById("btn-telegram-login-guest");
    const loginModal = document.getElementById("telegram-login-modal");
    const choiceStep = document.getElementById("login-step-choice");
    const formStep = document.getElementById("login-step-form");
    const cancelOAuthBtn = document.getElementById("btn-cancel-oauth");
    const oauthForm = document.getElementById("oauth-simulation-form");
    
    if (btnOAuth && choiceStep && formStep) {
        btnOAuth.addEventListener("click", () => {
            choiceStep.style.display = "none";
            formStep.style.display = "block";
        });
    }
    
    if (cancelOAuthBtn && choiceStep && formStep) {
        cancelOAuthBtn.addEventListener("click", () => {
            formStep.style.display = "none";
            choiceStep.style.display = "block";
        });
    }
    
    if (btnGuest && loginModal) {
        btnGuest.addEventListener("click", () => {
            const defaultProfile = {
                fullName: state.user.fullName,
                avatar: state.user.avatar,
                favoriteCategories: [],
                notificationsEnabled: true,
                subAnime: true,
                subHollywood: true,
                subRecs: true,
                contactPreference: "telegram",
                points: 0
            };
            localStorage.setItem("filmhouse_user_profile", JSON.stringify(defaultProfile));
            loadUserProfile();
            loginModal.classList.remove("active");
            navigateToScreen("home");
            showToast("Welcome! Proceeding as Guest. Watchlist and preferences are local only.", "success");
        });
    }

    
    if (oauthForm && loginModal) {
        oauthForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const fullNameInput = document.getElementById("oauth-fullname");
            const usernameInput = document.getElementById("oauth-username");
            
            if (fullNameInput && usernameInput) {
                state.user.fullName = fullNameInput.value.trim();
                state.user.username = usernameInput.value.trim().replace(/^@/, "");
                state.user.id = String(Math.floor(100000000 + Math.random() * 900000000));
                state.user.avatar = "img/FilmHouse3_nobg.png";

                const profileObj = {
                    fullName: state.user.fullName,
                    avatar: state.user.avatar,
                    favoriteCategories: [],
                    notificationsEnabled: true,
                    subAnime: true,
                    subHollywood: true,
                    subRecs: true,
                    contactPreference: "telegram",
                    points: 0
                };
                localStorage.setItem("filmhouse_user_profile", JSON.stringify(profileObj));
                
                loadUserProfile();
                loginModal.classList.remove("active");
                navigateToScreen("home");
                showToast("Telegram authentication simulated successfully!", "success");
            }
        });
    }

    // Profile screen tabs interaction
    const tabButtons = document.querySelectorAll(".profile-tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.getAttribute("data-tab");
            
            // Toggle active class on buttons
            tabButtons.forEach(b => {
                if (b === btn) b.classList.add("active");
                else b.classList.remove("active");
            });
            
            // Toggle active content panel
            const dashboardContent = document.getElementById("profile-tab-content-dashboard");
            const settingsContent = document.getElementById("profile-tab-content-settings");
            
            if (targetTab === "dashboard") {
                if (dashboardContent) dashboardContent.style.display = "block";
                if (settingsContent) settingsContent.style.display = "none";
            } else if (targetTab === "settings") {
                if (dashboardContent) dashboardContent.style.display = "none";
                if (settingsContent) settingsContent.style.display = "block";
            }
        });
    });

    // Free Up Storage Cache cleaning utility
    const btnClearCache = document.getElementById("btn-clear-cache");
    if (btnClearCache) {
        btnClearCache.addEventListener("click", () => {
            // Remove cached movies details but keep user profile data
            localStorage.removeItem("filmhouse_healed_movies");
            localStorage.removeItem("filmhouse_search_history");
            showToast("App cache cleared successfully! 🧹", "success");
            setTimeout(() => {
                window.location.reload();
            }, 800);
        });
    }
}

// Firebase Firestore Database Synchronization Helpers
function syncUserToFirestore(forceFetch = false) {
    if (typeof firebase === "undefined" || !db || !state.user.id) return;
    const userRef = db.collection("users").doc(state.user.id);

    const data = {
        id: state.user.id,
        username: state.user.username || "guest",
        fullName: state.user.fullName || "Guest User",
        avatar: state.user.avatar || "",
        points: state.user.points || 0,
        badge: state.user.badge || "",
        badgeExpiresAt: state.user.badgeExpiresAt || 0,
        farmingStartedAt: state.user.farmingStartedAt || 0,
        checkInStreak: state.user.checkInStreak || 0,
        lastCheckInDate: state.user.lastCheckInDate || "",
        pointsBreakdown: state.user.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 },
        dailyStats: state.user.dailyStats || {},
        notificationsEnabled: state.user.notificationsEnabled !== undefined ? state.user.notificationsEnabled : true,
        subAnime: state.user.subAnime !== undefined ? state.user.subAnime : true,
        subHollywood: state.user.subHollywood !== undefined ? state.user.subHollywood : true,
        subRecs: state.user.subRecs !== undefined ? state.user.subRecs : true,
        contactPreference: state.user.contactPreference || "telegram",
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (forceFetch) {
        userRef.get().then(doc => {
            if (doc.exists) {
                const docData = doc.data();
                if (docData) {
                    if (docData.banned === true) {
                        showBannedScreen();
                        return;
                    }
                    if (docData.points !== undefined) {
                        state.user.points = docData.points;
                        data.points = docData.points;
                    }
                    if (docData.pointsBreakdown !== undefined) {
                        state.user.pointsBreakdown = docData.pointsBreakdown;
                        data.pointsBreakdown = docData.pointsBreakdown;
                    }
                    if (docData.fullName !== undefined) {
                        state.user.fullName = docData.fullName;
                        data.fullName = docData.fullName;
                    }
                    if (docData.avatar !== undefined) {
                        state.user.avatar = docData.avatar;
                        data.avatar = docData.avatar;
                    }
                    if (docData.greetingFontStyle !== undefined) {
                        state.user.greetingFontStyle = docData.greetingFontStyle;
                        data.greetingFontStyle = docData.greetingFontStyle;
                    }
                    if (docData.favoriteCategories !== undefined) {
                        state.user.favoriteCategories = docData.favoriteCategories;
                        data.favoriteCategories = docData.favoriteCategories;
                    }
                    if (docData.notificationsEnabled !== undefined) state.user.notificationsEnabled = docData.notificationsEnabled;
                    if (docData.subAnime !== undefined) state.user.subAnime = docData.subAnime;
                    if (docData.subHollywood !== undefined) state.user.subHollywood = docData.subHollywood;
                    if (docData.subRecs !== undefined) state.user.subRecs = docData.subRecs;
                    if (docData.contactPreference !== undefined) state.user.contactPreference = docData.contactPreference;
                    if (docData.farmingStartedAt !== undefined) {
                        state.user.farmingStartedAt = docData.farmingStartedAt;
                        data.farmingStartedAt = docData.farmingStartedAt;
                    }
                    if (docData.checkInStreak !== undefined) {
                        state.user.checkInStreak = docData.checkInStreak;
                        data.checkInStreak = docData.checkInStreak;
                    }
                    if (docData.lastCheckInDate !== undefined) {
                        state.user.lastCheckInDate = docData.lastCheckInDate;
                        data.lastCheckInDate = docData.lastCheckInDate;
                    }
                    if (docData.dailyStats !== undefined) {
                        state.user.dailyStats = docData.dailyStats;
                        data.dailyStats = docData.dailyStats;
                    }
                    if (docData.badge !== undefined) {
                        state.user.badge = docData.badge;
                        data.badge = docData.badge;
                    }
                    if (docData.badgeExpiresAt !== undefined) {
                        state.user.badgeExpiresAt = docData.badgeExpiresAt;
                        data.badgeExpiresAt = docData.badgeExpiresAt;
                    }

                    // Save fully synchronized state to local storage
                    saveProfileToLocalStorage();

                    // Reload UI with updated state
                    updatePointsUI();
                    updateUserGreeting();
                    renderStreakCalendar();
                    renderDailyMissions();
                }
            }
            if (!doc.exists) {
                data.joinedDate = firebase.firestore.FieldValue.serverTimestamp();
            }
            userRef.set(data, { merge: true }).catch(err => console.warn("Firestore set error:", err));
        }).catch(err => {
            userRef.set(data, { merge: true }).catch(e => console.warn("Firestore fallback set error:", e));
        });
    } else {
        userRef.set(data, { merge: true }).catch(err => console.warn("Firestore set error:", err));
    }
}

// Apply Theme Accent custom properties
function applyThemeAccent(themeName) {
    const root = document.documentElement;
    const themes = {
        gold: {
            color: '#ffbc00',
            glow: 'rgba(255, 188, 0, 0.4)',
            gradient: 'linear-gradient(135deg, #ffbc00 0%, #ff7b00 100%)',
            glowBorder: 'rgba(255, 188, 0, 0.3)'
        },
        crimson: {
            color: '#e50914',
            glow: 'rgba(229, 9, 20, 0.4)',
            gradient: 'linear-gradient(135deg, #e50914 0%, #b81d24 100%)',
            glowBorder: 'rgba(229, 9, 20, 0.3)'
        },
        azure: {
            color: '#1a9cff',
            glow: 'rgba(26, 156, 255, 0.4)',
            gradient: 'linear-gradient(135deg, #1a9cff 0%, #0056b3 100%)',
            glowBorder: 'rgba(26, 156, 255, 0.3)'
        },
        amethyst: {
            color: '#a855f7',
            glow: 'rgba(168, 85, 247, 0.4)',
            gradient: 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)',
            glowBorder: 'rgba(168, 85, 247, 0.3)'
        },
        blossom: {
            color: '#ff8da1',
            glow: 'rgba(255, 141, 161, 0.4)',
            gradient: 'linear-gradient(135deg, #ff8da1 0%, #ff527b 100%)',
            glowBorder: 'rgba(255, 141, 161, 0.3)'
        },
        barbie: {
            color: '#ec4899',
            glow: 'rgba(236, 72, 153, 0.4)',
            gradient: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
            glowBorder: 'rgba(236, 72, 153, 0.3)'
        },
        emerald: {
            color: '#10b981',
            glow: 'rgba(16, 185, 129, 0.4)',
            gradient: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
            glowBorder: 'rgba(16, 185, 129, 0.3)'
        }
    };
    const active = themes[themeName] || themes.gold;
    root.style.setProperty('--primary-color', active.color);
    root.style.setProperty('--primary-glow', active.glow);
    root.style.setProperty('--primary-gradient', active.gradient);
    root.style.setProperty('--border-color-glow', active.glowBorder);
    
    // Update active state in UI dots
    const dots = document.querySelectorAll(".accent-option-dot");
    dots.forEach(dot => {
        if (dot.getAttribute("data-theme") === themeName) {
            dot.classList.add("active");
        } else {
            dot.classList.remove("active");
        }
    });

    localStorage.setItem("filmhouse_theme_accent", themeName);
}

// Loyalty Reward Center & Requests Tracker Logic
let userRequestsUnsubscribe = null;
let currentUserRequests = [];

function startUserRequestsListener() {
    // Load locally stored requests first for instant response
    try {
        const savedReqs = localStorage.getItem("filmhouse_my_requests");
        if (savedReqs) {
            currentUserRequests = JSON.parse(savedReqs);
            renderUserRequests(currentUserRequests);
        }
    } catch (e) {}

    if (typeof firebase === "undefined" || !db || !state.user.id) return;
    
    if (userRequestsUnsubscribe) {
        userRequestsUnsubscribe();
    }
    
    userRequestsUnsubscribe = db.collection("requests")
        .where("requestedById", "==", state.user.id)
        .onSnapshot(snapshot => {
            const requests = [];
            snapshot.forEach(doc => {
                const req = doc.data();
                req.docId = doc.id;
                requests.push(req);
            });
            // Sort client-side by requestedAt descending
            requests.sort((a, b) => {
                const tA = a.requestedAt ? (a.requestedAt.seconds || 0) : 0;
                const tB = b.requestedAt ? (b.requestedAt.seconds || 0) : 0;
                return tB - tA;
            });

            // Merge local unsaved requests with remote snapshot
            currentUserRequests.forEach(localReq => {
                const localClean = getCleanRequestTitle(localReq.title).toLowerCase();
                if (!requests.some(r => r.title && getCleanRequestTitle(r.title).toLowerCase() === localClean)) {
                    requests.push(localReq);
                }
            });

            currentUserRequests = requests;
            try {
                localStorage.setItem("filmhouse_my_requests", JSON.stringify(currentUserRequests));
            } catch (e) {}
            renderUserRequests(requests);
        }, err => {
            console.error("User requests sync issue:", err);
        });
}

function renderUserRequests(requests) {
    const list = document.getElementById("user-requests-list");
    const countBadge = document.getElementById("user-requests-count-badge");
    const headerNotificationDot = document.getElementById("rewards-notification-dot");
    const historyWrapper = document.getElementById("user-requests-history-wrapper");
    const historyList = document.getElementById("user-requests-history");
    const historyCountBadge = document.getElementById("history-count-badge");
    const historyToggle = document.getElementById("user-requests-history-toggle");
    const historyChevron = document.getElementById("history-chevron");
    
    if (!list) return;
    
    if (requests.length === 0) {
        if (countBadge) countBadge.textContent = "0";
        list.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-secondary); font-size: 12px; background: rgba(255,255,255,0.01); border-radius: var(--border-radius-sm); border: 1px dashed var(--border-color);">
                No requests yet. Try requesting a movie that is not in the library!
            </div>
        `;
        if (historyWrapper) historyWrapper.style.display = "none";
        return;
    }
    
    const acknowledgedFulfillments = JSON.parse(localStorage.getItem("acknowledged_fulfillments") || "[]");
    
    // Split into active vs history
    const activeRequests = [];
    const historyRequests = [];
    let hasNewFulfillment = false;
    
    requests.forEach(r => {
        const matchingMovie = state.movies.find(m => {
            const rId = String(r.tmdb_id || r.csv_id || '').split('-')[0].trim();
            const mId = String(m.tmdb_id || m.csv_id || '').split('-')[0].trim();
            if (rId && mId) {
                return rId === mId;
            }
            return (m.title && getCleanRequestTitle(m.title).toLowerCase() === getCleanRequestTitle(r.title).toLowerCase()) || 
                   (m.csv_id && r.csv_id && m.csv_id.toLowerCase() === r.csv_id.toLowerCase());
        });
        const isMatched = matchingMovie && matchingMovie.links && matchingMovie.links.length > 0;
        const isExplicit = (r.status === "fulfilled" || r.status === "claimed") && r.downloadLink;
        const isFulfilled = isMatched || isExplicit;
        const isClaimed = isFulfilled && (r.claimed === true || r.status === "claimed" || acknowledgedFulfillments.includes(r.docId));
        
        if (isClaimed) {
            historyRequests.push({ ...r, _matchingMovie: matchingMovie, _isExplicit: isExplicit });
        } else {
            activeRequests.push({ ...r, _matchingMovie: matchingMovie, _isMatched: isMatched, _isExplicit: isExplicit });
            if (isFulfilled && !(r.claimed === true || r.status === "claimed" || acknowledgedFulfillments.includes(r.docId))) {
                hasNewFulfillment = true;
            }
        }
    });
    
    // Update badge with active count only
    if (countBadge) countBadge.textContent = activeRequests.length;
    
    // Render active requests
    list.innerHTML = "";
    if (activeRequests.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-secondary); font-size: 12px; background: rgba(255,255,255,0.01); border-radius: var(--border-radius-sm); border: 1px dashed var(--border-color);">
                All requests claimed! Check your request history below. 🎬
            </div>
        `;
    } else {
        activeRequests.forEach(r => {
            const item = document.createElement("div");
            item.className = "user-request-item";
            item.style.cssText = "background: rgba(255,255,255,0.025); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); padding: 12px; display: flex; flex-direction: column; gap: 12px;";
            
            let actionBtn = "";
            let step = 1;
            let progressPct = 0;
            let reviewingColor = "rgba(255,255,255,0.1)";
            let readyColor = "rgba(255,255,255,0.1)";
            let activeLineColor = "var(--primary-color)";
            
            if (r._isMatched || r._isExplicit) {
                step = 3;
                progressPct = 100;
                reviewingColor = "var(--primary-color)";
                readyColor = "#4caf50";
                activeLineColor = "#4caf50";
                const rawLink = r._isExplicit ? r.downloadLink : r._matchingMovie.links[0];
                const dlLink = typeof rawLink === 'object' && rawLink !== null ? rawLink.url : rawLink;
                actionBtn = `
                    <button class="btn btn-primary btn-sm user-request-dl-btn" data-link="${escapeHTML(dlLink)}" data-doc-id="${escapeHTML(r.docId)}" style="padding: 6px 12px; font-size: 11px; border-radius: 6px; font-weight: 700; flex-shrink: 0;">
                        Claim 🎁
                    </button>
                `;
            } else if (r.status === "priority") {
                step = 2;
                progressPct = 50;
                reviewingColor = "#ff3b30";
                activeLineColor = "#ff3b30";
                actionBtn = `<span style="font-size: 11px; color: #ff3b30; font-weight: 700; text-shadow: 0 0 6px rgba(255,59,48,0.2);">🔥 Expedited</span>`;
            } else {
                step = 1;
                progressPct = 0;
                actionBtn = `
                    <button class="btn btn-secondary btn-sm user-request-boost-btn" data-doc-id="${escapeHTML(r.docId)}" style="padding: 6px 12px; font-size: 11px; border-radius: 6px; font-weight: 600; flex-shrink: 0; border-color: rgba(255, 188, 0, 0.3); color: #ffbc00;">
                        Boost (1,000 pts)
                    </button>
                `;
            }
            
            const stepperHTML = `
                <div class="request-stepper" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 14px 0 14px; position: relative; width: 100%; box-sizing: border-box; margin-top: 2px;">
                    <!-- Line track background -->
                    <div style="position: absolute; top: 10px; left: 30px; right: 30px; height: 2px; background: rgba(255,255,255,0.06); z-index: 1;"></div>
                    <!-- Active line progress -->
                    <div style="position: absolute; top: 10px; left: 30px; width: calc(${progressPct}% - ${progressPct === 100 ? '0px' : '30px'}); height: 2px; background: ${activeLineColor}; z-index: 2; transition: all 0.3s ease;"></div>
                    
                    <!-- Step 1: Requested -->
                    <div style="z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <div style="width: 20px; height: 20px; border-radius: 50%; background: #1a1a1a; border: 2px solid var(--primary-color); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 8px var(--primary-glow);">
                            <div style="width: 6px; height: 6px; border-radius: 50%; background: var(--primary-color);"></div>
                        </div>
                        <span style="font-size: 9px; font-weight: 700; color: #fff; letter-spacing: 0.3px;">Requested</span>
                    </div>
                    
                    <!-- Step 2: Reviewing -->
                    <div style="z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <div style="width: 20px; height: 20px; border-radius: 50%; background: #1a1a1a; border: 2px solid ${reviewingColor}; display: flex; align-items: center; justify-content: center; box-shadow: ${step >= 2 ? `0 0 8px ${reviewingColor}` : 'none'}; transition: all 0.3s ease;">
                            <div style="width: 6px; height: 6px; border-radius: 50%; background: ${step >= 2 ? reviewingColor : 'transparent'}; transition: all 0.3s ease;"></div>
                        </div>
                        <span style="font-size: 9px; font-weight: 700; color: ${step >= 2 ? '#fff' : 'var(--text-muted)'}; letter-spacing: 0.3px;">${r.status === 'priority' ? '🔥 Priority Review' : 'Reviewing'}</span>
                    </div>
                    
                    <!-- Step 3: Ready -->
                    <div style="z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <div style="width: 20px; height: 20px; border-radius: 50%; background: #1a1a1a; border: 2px solid ${readyColor}; display: flex; align-items: center; justify-content: center; box-shadow: ${step >= 3 ? '0 0 10px rgba(76, 175, 80, 0.4)' : 'none'}; transition: all 0.3s ease;">
                            <div style="width: 6px; height: 6px; border-radius: 50%; background: ${step >= 3 ? '#4caf50' : 'transparent'}; transition: all 0.3s ease;"></div>
                        </div>
                        <span style="font-size: 9px; font-weight: 700; color: ${step >= 3 ? '#4caf50' : 'var(--text-muted)'}; letter-spacing: 0.3px;">Ready 🍿</span>
                    </div>
                </div>
            `;
            
            item.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 12px;">
                    <div>
                        <h5 style="margin: 0 0 2px 0; font-size: 13px; font-weight: 700; color: #fff; font-family: var(--font-heading);">${escapeHTML(r.title)}${r.year ? ` (${r.year})` : ""}</h5>
                        <span style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">${escapeHTML(r.type)}</span>
                    </div>
                    <div style="display: flex; align-items: center;">
                        ${actionBtn}
                    </div>
                </div>
                ${stepperHTML}
            `;
            
            // Event listeners
            const boostBtn = item.querySelector(".user-request-boost-btn");
            if (boostBtn) {
                boostBtn.addEventListener("click", () => {
                    boostRequestToPriority(r.docId);
                });
            }
            
            const dlBtn = item.querySelector(".user-request-dl-btn");
            if (dlBtn) {
                dlBtn.addEventListener("click", () => {
                    const ack = JSON.parse(localStorage.getItem("acknowledged_fulfillments") || "[]");
                    if (!ack.includes(r.docId)) {
                        ack.push(r.docId);
                        localStorage.setItem("acknowledged_fulfillments", JSON.stringify(ack));
                    }
                    updateHeaderNotificationDot();
                    updateHomeFulfillmentBanner();
                    
                    // Mark as claimed in Firestore in the background
                    if (db) {
                        db.collection("requests").doc(r.docId).update({
                            claimed: true,
                            claimedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            status: "claimed"
                        }).catch(err => console.error("Error updating claim in Firestore:", err));
                    }

                    showToast("Claimed! The download links have been sent to your Telegram DMs. 🍿", "success");
                    
                    // Re-render so claimed request moves to history immediately
                    renderUserRequests(currentUserRequests);
                });
            }
            
            list.appendChild(item);
        });
    }
    
    // Render history section
    if (historyWrapper && historyList) {
        if (historyRequests.length > 0) {
            historyWrapper.style.display = "block";
            if (historyCountBadge) historyCountBadge.textContent = historyRequests.length;
            
            historyList.innerHTML = "";
            historyRequests.forEach(r => {
                const item = document.createElement("div");
                item.style.cssText = "background: rgba(255,255,255,0.015); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;";
                item.innerHTML = `
                    <div style="flex: 1;">
                        <h5 style="margin: 0 0 2px 0; font-size: 11px; font-weight: 600; color: var(--text-secondary);">${escapeHTML(r.title)}${r.year ? ` (${r.year})` : ""}</h5>
                        <span style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">${escapeHTML(r.type)}</span>
                    </div>
                    <span style="font-size: 10px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.2); color: #4caf50; padding: 2px 8px; border-radius: 20px; font-weight: 700;">✅ Claimed</span>
                `;
                historyList.appendChild(item);
            });
            
            // Bind toggle (only if not already bound)
            if (historyToggle && !historyToggle._bound) {
                historyToggle._bound = true;
                historyToggle.addEventListener("click", () => {
                    const isOpen = historyList.style.display === "flex";
                    historyList.style.display = isOpen ? "none" : "flex";
                    if (historyChevron) {
                        historyChevron.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
                    }
                });
            }
        } else {
            historyWrapper.style.display = "none";
        }
    }
    
    if (headerNotificationDot) {
        headerNotificationDot.style.display = hasNewFulfillment ? "block" : "none";
    }
    
    updateHomeFulfillmentBanner();
    
    // Notify user once per session if a request is ready
    if (hasNewFulfillment && !state.notifiedOfFulfillment) {
        state.notifiedOfFulfillment = true;
        showToast("Good news! One of your movie requests is ready! 🍿 Check the Reward Center.", "success");
    }
}

function updateHomeFulfillmentBanner() {
    const banner = document.getElementById("fulfilled-requests-banner");
    const bannerText = document.getElementById("fulfilled-banner-text");
    const bannerBtn = document.getElementById("btn-banner-view-requests");
    if (!banner) return;

    const acknowledgedFulfillments = JSON.parse(localStorage.getItem("acknowledged_fulfillments") || "[]");
    
    const unacknowledgedFulfilled = currentUserRequests.filter(r => {
        const matchingMovie = state.movies.find(m => 
            (m.title && getCleanRequestTitle(m.title).toLowerCase() === getCleanRequestTitle(r.title).toLowerCase()) || 
            (m.csv_id && r.csv_id && m.csv_id.toLowerCase() === r.csv_id.toLowerCase())
        );
        const isMatched = matchingMovie && matchingMovie.links && matchingMovie.links.length > 0;
        const isExplicit = (r.status === "fulfilled" || r.status === "claimed") && r.downloadLink;
        const isClaimed = (isMatched || isExplicit) && (r.claimed === true || r.status === "claimed" || acknowledgedFulfillments.includes(r.docId));
        return (isMatched || isExplicit) && !isClaimed;
    });
    
    if (unacknowledgedFulfilled.length > 0) {
        banner.style.display = "flex";
        if (bannerText) {
            const titles = unacknowledgedFulfilled.map(r => `"${r.title}"`).join(", ");
            bannerText.textContent = `${titles} ${unacknowledgedFulfilled.length === 1 ? 'is' : 'are'} ready to download! 🍿`;
        }
        if (bannerBtn) {
            bannerBtn.onclick = () => {
                const rewardsDrawer = document.getElementById("rewards-drawer");
                if (rewardsDrawer) rewardsDrawer.classList.add("active");
                updatePointsUI();
                renderDailyMissions();
                updateHeaderNotificationDot();
            };
        }
    } else {
        banner.style.display = "none";
    }
}

function boostRequestToPriority(docId) {
    if (typeof firebase === "undefined" || !db) return;
    
    if (state.user.points < 1000) {
        showToast("Not enough points! You need 1,000 points to boost requests.", "error");
        return;
    }
    
    db.collection("requests").doc(docId).update({
        status: "priority"
    }).then(() => {
        deductPoints(1000);
        showToast("Request boosted to High Priority! 🚀", "success");
    }).catch(err => {
        console.error("Error boosting request:", err);
        showToast("Failed to boost request.", "error");
    });
}

function checkVipBadgeExpiry() {
    if (state.user && state.user.badge) {
        const expiry = parseInt(state.user.badgeExpiresAt || "0");
        if (expiry > 0 && Date.now() > expiry) {
            state.user.badge = "";
            state.user.badgeExpiresAt = 0;
            
            const saved = localStorage.getItem("filmhouse_user_profile");
            if (saved) {
                try {
                    const profile = JSON.parse(saved);
                    profile.badge = "";
                    profile.badgeExpiresAt = 0;
                    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
                } catch (e) {}
            }
            
            syncUserToFirestore();
            showToast("Your VIP Custom Badge has expired! Earn more points to reclaim it. 🏆", "info");
        }
    }
}

function deductPoints(points) {
    state.user.points = Math.max(0, (state.user.points || 0) - points);
    
    const saved = localStorage.getItem("filmhouse_user_profile");
    let profile = {};
    if (saved) {
        try {
            profile = JSON.parse(saved);
        } catch (e) {}
    }
    profile.points = state.user.points;
    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
    
    syncUserToFirestore();
    updatePointsUI();
    
    const leaderboardScreen = document.getElementById("screen-leaderboard");
    if (leaderboardScreen && leaderboardScreen.classList.contains("active")) {
        renderLeaderboard();
    }
}

function updateHeaderNotificationDot() {
    if (typeof firebase === "undefined" || !db || !state.user.id) return;
    
    db.collection("requests")
        .where("requestedById", "==", state.user.id)
        .get()
        .then(snapshot => {
            const acknowledgedFulfillments = JSON.parse(localStorage.getItem("acknowledged_fulfillments") || "[]");
            let hasNew = false;
            
            snapshot.forEach(doc => {
                const r = doc.data();
                const docId = doc.id;
                
                const matchingMovie = state.movies.find(m => 
                    (m.title && getCleanRequestTitle(m.title).toLowerCase() === getCleanRequestTitle(r.title).toLowerCase()) || 
                    (m.csv_id && r.csv_id && m.csv_id.toLowerCase() === r.csv_id.toLowerCase())
                );
                
                const isMatched = matchingMovie && matchingMovie.links && matchingMovie.links.length > 0;
                const isExplicit = r.status === "fulfilled" && r.downloadLink;
                
                if ((isMatched || isExplicit) && !acknowledgedFulfillments.includes(docId)) {
                    hasNew = true;
                }
            });
            
            const dot = document.getElementById("rewards-notification-dot");
            if (dot) dot.style.display = hasNew ? "block" : "none";
        }).catch(err => console.warn("Error checking header notifications:", err));
}

function logMovieRequestToFirestore(movie, specs = "") {
    if (!movie) return;
    const requestTitle = specs ? `${movie.title || "Unknown Title"} (${specs})` : (movie.title || "Unknown Title");
    
    // 1. Immediately store in local currentUserRequests array and persist to localStorage
    const reqObj = {
        title: requestTitle,
        seasonOrPart: specs || "",
        status: "pending",
        tmdb_id: movie.tmdb_id || null,
        csv_id: movie.csv_id || "",
        type: movie.type || "Movie",
        year: movie.release_date ? movie.release_date.substring(0, 4) : "",
        requestedBy: state.user.username || state.user.fullName || state.user.firstName || `User ${state.user.id || 'Guest'}`,
        requestedById: state.user.id || "",
        fullName: state.user.fullName || state.user.firstName || ""
    };

    if (typeof currentUserRequests !== "undefined" && Array.isArray(currentUserRequests)) {
        const cleanT = getCleanRequestTitle(movie.title).toLowerCase();
        const exists = currentUserRequests.some(r => 
            r.title && getCleanRequestTitle(r.title).toLowerCase() === cleanT
        );
        if (!exists) {
            currentUserRequests.unshift(reqObj);
        }
    }
    
    try {
        localStorage.setItem("filmhouse_my_requests", JSON.stringify(currentUserRequests));
    } catch (e) {}

    // 2. Instantly update active detail modal UI if open on screen for this movie
    const modal = document.getElementById("detail-modal");
    if (modal && modal.classList.contains("active")) {
        const reqBtn = modal.querySelector(".btn-request-premium");
        if (reqBtn) {
            reqBtn.replaceChildren();
            reqBtn.appendChild(createSvgIcon("icon-check"));
            const rText = document.createElement("span");
            rText.textContent = "Requested ⏳";
            reqBtn.appendChild(rText);
            reqBtn.style.background = "rgba(255, 188, 0, 0.15)";
            reqBtn.style.borderColor = "var(--primary-color)";
        }
        
        const infoColumn = modal.querySelector(".detail-info-column");
        if (infoColumn && !infoColumn.querySelector(".requested-status-banner")) {
            const reqBanner = document.createElement("div");
            reqBanner.className = "requested-status-banner";
            reqBanner.style.cssText = "margin-top: 12px; padding: 10px 14px; background: rgba(255, 188, 0, 0.1); border: 1px solid rgba(255, 188, 0, 0.3); border-radius: var(--border-radius-sm); color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px;";
            reqBanner.innerHTML = `
                <span style="display: flex; align-items: center; gap: 6px;">
                    <span>📌</span>
                    <strong>Request Status:</strong> Pending Admin Fulfillment
                </span>
                <span style="font-size: 10px; opacity: 0.8; background: rgba(255,188,0,0.2); padding: 2px 8px; border-radius: 10px;">In Queue</span>
            `;
            infoColumn.appendChild(reqBanner);
        }
    }

    // 3. Refresh grids so card badges display on posters immediately
    renderFeaturedGrid();
    if (typeof renderUserRequests === "function") {
        renderUserRequests(currentUserRequests);
    }

    // 4. Save to Firestore if available
    if (typeof firebase !== "undefined" && db) {
        db.collection("requests").add({
            title: requestTitle,
            seasonOrPart: specs || "",
            tmdb_id: movie.tmdb_id || null,
            csv_id: movie.csv_id || "",
            type: movie.type || "Movie",
            year: movie.release_date ? movie.release_date.substring(0, 4) : "",
            requestedBy: state.user.username || state.user.fullName || state.user.firstName || `User ${state.user.id || 'Guest'}`,
            requestedById: state.user.id || "",
            fullName: state.user.fullName || state.user.firstName || "",
            requestedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then((docRef) => {
            showToast("Movie request registered in database!", "success");
        }).catch(err => {
            console.error("Error logging movie request:", err);
        });
    }
}

function showRequestSpecsDrawer(movie) {
    if (!movie) return;
    logMovieRequestToFirestore(movie);
    showConnectionDrawer("https://t.me/+09ahNmGdB1U2MzFk", ADSGRAM_REQUEST_BLOCK_ID);
}

// Daily Missions / Quests System Helpers
function checkAndResetDailyMissions() {
    const today = new Date().toISOString().split("T")[0];
    if (!state.user.dailyStats || state.user.dailyStats.date !== today) {
        state.user.dailyStats = {
            date: today,
            checkInClaimed: false,
            sharesCount: 0,
            shareClaimed: false,
            adWatchesCount: 0,
            adWatchesClaimed: false,
            downloadsCount: 0,
            downloadsClaimed: false,
            inviteShared: false
        };
        saveDailyStats();
    }
}

function saveDailyStats() {
    const saved = localStorage.getItem("filmhouse_user_profile");
    let profile = {};
    if (saved) {
        try {
            profile = JSON.parse(saved);
        } catch (e) {}
    }
    profile.dailyStats = state.user.dailyStats;
    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
    
    // Sync immediately to Firestore to prevent data resets
    syncUserToFirestore();
}

function renderDailyMissions() {
    const list = document.getElementById("daily-missions-list");
    if (!list) return;
    
    checkAndResetDailyMissions();
    renderStreakCalendar();
    const stats = state.user.dailyStats;
    
    const missions = [
        {
            id: "share",
            title: "Social Promoter 🔗",
            desc: "Share 1 movie link with friends on Telegram.",
            target: 1,
            current: Math.min(1, stats.sharesCount || 0),
            claimed: stats.shareClaimed,
            reward: 10
        },
        {
            id: "ad",
            title: "Ad Explorer 📺",
            desc: "Watch 5 video ads (trailers or downloads).",
            target: 5,
            current: Math.min(5, stats.adWatchesCount || 0),
            claimed: stats.adWatchesClaimed,
            reward: 25
        },
        {
            id: "download",
            title: "Movie Collector 📥",
            desc: "Secure 3 premium connections (downloads).",
            target: 3,
            current: Math.min(3, stats.downloadsCount || 0),
            claimed: stats.downloadsClaimed,
            reward: 15
        }
    ];

    list.innerHTML = "";
    missions.forEach(m => {
        const pct = Math.min(100, (m.current / m.target) * 100);
        let btnHTML = "";
        
        if (m.claimed) {
            btnHTML = `<button class="btn btn-secondary btn-sm" disabled style="padding: 6px 12px; font-size: 11px; border-radius: 6px; opacity: 0.6; pointer-events: none;">Claimed ✓</button>`;
        } else if (m.current >= m.target) {
            btnHTML = `<button class="btn btn-success btn-sm claim-mission-btn" data-mission-id="${m.id}" style="padding: 6px 12px; font-size: 11px; border-radius: 6px; font-weight: 700; background: #4caf50; border-color: #4caf50; color: #fff;">Claim +${m.reward}</button>`;
        } else {
            btnHTML = `<button class="btn btn-secondary btn-sm" disabled style="padding: 6px 12px; font-size: 11px; border-radius: 6px; opacity: 0.7; pointer-events: none;">${m.current}/${m.target}</button>`;
        }

        const item = document.createElement("div");
        item.className = "daily-mission-card";
        item.style.cssText = "background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); padding: 12px; display: flex; flex-direction: column; gap: 8px;";
        item.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div style="flex: 1;">
                    <h5 style="margin: 0 0 2px 0; font-size: 12px; font-weight: 700; color: #fff;">${m.title}</h5>
                    <p style="margin: 0; font-size: 10px; color: var(--text-secondary); line-height: 1.3;">${m.desc}</p>
                </div>
                ${btnHTML}
            </div>
            ${m.target > 1 ? `
                <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 10px; overflow: hidden; margin-top: 4px;">
                    <div style="width: ${pct}%; height: 100%; background: ${m.current >= m.target ? '#4caf50' : 'var(--accent-color)'}; border-radius: 10px; transition: width 0.3s ease;"></div>
                </div>
            ` : ''}
        `;
        
        list.appendChild(item);
    });

    // Add claim button listeners
    list.querySelectorAll(".claim-mission-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-mission-id");
            claimMissionReward(id);
        });
    });
}

function claimMissionReward(missionId) {
    const stats = state.user.dailyStats;
    let pointsToAward = 0;
    
    if (missionId === "login" && !stats.checkInClaimed) {
        stats.checkInClaimed = true;
        pointsToAward = 5;
    } else if (missionId === "share" && !stats.shareClaimed && (stats.sharesCount || 0) >= 1) {
        stats.shareClaimed = true;
        pointsToAward = 10;
    } else if (missionId === "ad" && !stats.adWatchesClaimed && (stats.adWatchesCount || 0) >= 5) {
        stats.adWatchesClaimed = true;
        pointsToAward = 25;
    } else if (missionId === "download" && !stats.downloadsClaimed && (stats.downloadsCount || 0) >= 3) {
        stats.downloadsClaimed = true;
        pointsToAward = 15;
    }
    
    if (pointsToAward > 0) {
        // Award points
        state.user.points = (state.user.points || 0) + pointsToAward;
        saveDailyStats();
        
        // Save overall profile points
        const saved = localStorage.getItem("filmhouse_user_profile");
        if (saved) {
            try {
                const profile = JSON.parse(saved);
                profile.points = state.user.points;
                profile.dailyStats = state.user.dailyStats;
                localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
            } catch (e) {}
        }
        
        syncUserToFirestore();
        updatePointsUI();
        renderDailyMissions();
        showToast(`Mission completed! +${pointsToAward} points earned! 🪙`, "success");
    }
}

function updateMissionProgress(actionType, count = 1) {
    checkAndResetDailyMissions();
    const stats = state.user.dailyStats;
    
    let oldVal = 0;
    let target = 0;
    let title = "";
    let reward = 0;
    
    if (actionType === "share") {
        oldVal = stats.sharesCount || 0;
        stats.sharesCount = oldVal + count;
        target = 1;
        title = "Social Promoter 🔗";
        reward = 10;
    } else if (actionType === "ad") {
        oldVal = stats.adWatchesCount || 0;
        stats.adWatchesCount = oldVal + count;
        target = 5;
        title = "Ad Explorer 📺";
        reward = 25;
    } else if (actionType === "download") {
        oldVal = stats.downloadsCount || 0;
        stats.downloadsCount = oldVal + count;
        target = 3;
        title = "Movie Collector 📥";
        reward = 15;
    }
    
    saveDailyStats();
    renderDailyMissions();

    const newVal = stats[actionType === "share" ? "sharesCount" : (actionType === "ad" ? "adWatchesCount" : "downloadsCount")] || 0;
    if (oldVal < target && newVal >= target) {
        // Send a visual reminder / alert that the mission is completed
        showToast(`🎉 Daily Mission Completed: ${title}! Claim +${reward} points in Reward Center! 🪙`, "success");
        triggerHaptic("success");
        
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.showAlert(`🎉 Daily Mission Completed: ${title}!\n\nOpen the Reward Center to claim your +${reward} points! 🪙`);
        }
    }
}

function startMissionsResetTimer() {
    const timerEl = document.getElementById("missions-reset-timer");
    if (!timerEl) return;
    
    function updateTimer() {
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const diffMs = tomorrow - now;
        
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        timerEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    updateTimer();
    setInterval(updateTimer, 60000); // update every minute
}

// App Kickoff Initializer
document.addEventListener("DOMContentLoaded", async () => {
    try {
    // Force clear old corrupted database & healed caches once
    if (localStorage.getItem("filmhouse_reset_v7") !== "true") {
        localStorage.removeItem("filmhouse_healed_movies");
        localStorage.removeItem("filmhouse_enriched_db_v5");
        localStorage.removeItem("filmhouse_enriched_db_v4");
        localStorage.setItem("filmhouse_reset_v7", "true");
    }

    // 0. Load Theme Accent configuration immediately
    const savedTheme = localStorage.getItem("filmhouse_theme_accent") || "gold";
    applyThemeAccent(savedTheme);

    // Bind Theme dots listeners
    const themeDots = document.querySelectorAll(".accent-option-dot");
    themeDots.forEach(dot => {
        dot.addEventListener("click", () => {
            const selectedTheme = dot.getAttribute("data-theme");
            applyThemeAccent(selectedTheme);
            showToast("Theme accent updated! 🎨", "success");
        });
    });

    // 1. Initial login credentials grab
    handleTelegramAuth();
    updateUserGreeting();

    // Parse Telegram startapp parameter (e.g. startapp=mining or boost_docId)
    let initialScreen = "home";
    let boostRequestDocId = null;
    if (state.isTelegram && window.Telegram && window.Telegram.WebApp) {
        const initData = window.Telegram.WebApp.initDataUnsafe;
        if (initData && initData.start_param) {
            const rawParam = initData.start_param.trim();
            const param = rawParam.toLowerCase();
            if (param === "mining") {
                initialScreen = "mining";
            } else if (param.startsWith("boost_")) {
                boostRequestDocId = rawParam.substring(6);
            }
        }
    }
    
    // Sync latest user points, check-in streak, and ban status from Firestore on startup
    if (typeof firebase !== "undefined" && db && state.user.id) {
        syncUserToFirestore(true);
    }

    // Fetch live list of admins to cache globally on startup
    if (typeof firebase !== "undefined" && db) {
        db.collection("settings").doc("admins").get().then(adminDoc => {
            if (adminDoc.exists && adminDoc.data().ids) {
                const defaultAdmins = ["1329840839", "1175336733"];
                globalAdminIds = Array.from(new Set([...defaultAdmins, ...adminDoc.data().ids]));
            }
            updatePointsUI(); // Refresh UI once admin IDs are loaded
        }).catch(err => console.warn("Error loading admins settings:", err));
    }
    const profileExists = !!localStorage.getItem("filmhouse_user_profile");
    
    // Auto-create profile if inside Telegram
    if (state.isTelegram && !profileExists) {
        const defaultProfile = {
            fullName: state.user.fullName,
            avatar: state.user.avatar,
            favoriteCategories: [],
            notificationsEnabled: true,
            subAnime: true,
            subHollywood: true,
            subRecs: true,
            contactPreference: "telegram",
            points: 0
        };
        localStorage.setItem("filmhouse_user_profile", JSON.stringify(defaultProfile));
        setTimeout(() => {
            showToast("Welcome to Film House! Your Telegram account has been connected.", "success");
        }, 1000);
    }

    // Global Leaderboard renderer
    function fetchAndRenderLeaderboard() {
        const list = document.getElementById("points-leaderboard-list");
        if (!list || typeof firebase === "undefined" || !db) return;
        
        db.collection("users")
            .orderBy("points", "desc")
            .limit(30)
            .get()
            .then(snapshot => {
                list.innerHTML = "";
                let rank = 1;
                
                snapshot.forEach(doc => {
                    const u = doc.data();
                    const userIdStr = u.id ? String(u.id) : "";
                    
                    // Skip admins/staff members in homepage rankings list
                    if (typeof globalAdminIds !== "undefined" && globalAdminIds.includes(userIdStr)) return;
                    if (rank > 10) return; // Limit to top 10
                    
                    const points = parseInt(u.points || 0);
                    const name = escapeHTML(u.fullName || u.username || `User ${doc.id.substring(0, 4)}`);
                    
                    let badge = "";
                    let rankStyle = "color: var(--text-secondary); font-weight: 700;";
                    if (rank === 1) {
                        badge = "🥇";
                        rankStyle = "color: #ffbc00; font-size: 14px; font-weight: 900;";
                    } else if (rank === 2) {
                        badge = "🥈";
                        rankStyle = "color: #e0e0e0; font-size: 14px; font-weight: 900;";
                    } else if (rank === 3) {
                        badge = "🥉";
                        rankStyle = "color: #cd7f32; font-size: 14px; font-weight: 900;";
                    } else {
                        badge = `#${rank}`;
                    }
                    
                    const isMe = state.user && (String(state.user.id) === String(u.id));
                    const itemBg = isMe ? "background: rgba(255, 188, 0, 0.06); border-color: rgba(255, 188, 0, 0.25);" : "background: rgba(255,255,255,0.01); border-color: transparent;";
                    
                    const item = document.createElement("div");
                    item.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: var(--border-radius-sm); border: 1px solid var(--border-color); margin-bottom: 4px; ${itemBg}`;
                    item.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 24px; text-align: center; ${rankStyle}">${badge}</span>
                            <span style="font-size: 12px; font-weight: ${isMe ? '700' : '500'}; color: ${isMe ? 'var(--primary-color)' : '#fff'};">${name} ${isMe ? ' (You)' : ''}</span>
                        </div>
                        <span style="font-size: 11px; font-weight: 700; color: #ffbc00;">${points.toLocaleString()} pts</span>
                    `;
                    list.appendChild(item);
                    rank++;
                });
                
                if (list.children.length === 0) {
                    list.innerHTML = `<div style="text-align: center; padding: 10px; color: var(--text-secondary); font-size: 11px;">Join the game! Claim points to rank here. 🚀</div>`;
                }
            }).catch(err => {
                console.warn("Error rendering leaderboard:", err);
                list.innerHTML = `<div style="text-align: center; padding: 10px; color: var(--text-secondary); font-size: 11px;">Leaderboard offline.</div>`;
            });
    }

    // Reward Center Drawer triggers & listeners
    const btnRewards = document.getElementById("btn-header-rewards");
    const rewardsDrawer = document.getElementById("rewards-drawer");
    const rewardsClose = document.getElementById("rewards-drawer-close");
    
    if (btnRewards && rewardsDrawer) {
        btnRewards.addEventListener("click", () => {
            rewardsDrawer.classList.add("active");
            updatePointsUI();
            renderDailyMissions();
            updateHeaderNotificationDot();
        });
    }
    if (rewardsClose && rewardsDrawer) {
        rewardsClose.addEventListener("click", () => {
            rewardsDrawer.classList.remove("active");
        });
        rewardsDrawer.addEventListener("click", (e) => {
            if (e.target === rewardsDrawer) {
                rewardsDrawer.classList.remove("active");
            }
        });
    }
    
    // Reward redemption actions
    const redeemButtons = document.querySelectorAll("#rewards-drawer .redeem-btn");
    redeemButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const rewardId = btn.getAttribute("data-reward-id");
            if (rewardId === "ad-free") {
                if (state.user.points < 1500) {
                    showToast("Not enough points! You need 1,500 points for Ad-Free pass.", "error");
                    return;
                }
                deductPoints(1500);
                localStorage.setItem("ad_free_until", Date.now() + 24 * 60 * 60 * 1000);
                showToast("24h Ad-Free VIP Pass activated! 🎫 Enjoy ad-free downloads.", "success");
            } else if (rewardId === "vip-badge") {
                if (state.user.points < 2500) {
                    showToast("Not enough points! You need 2,500 points for VIP Badge.", "error");
                    return;
                }
                
                const customBadge = prompt("Enter your custom VIP Badge text (max 15 characters):");
                if (customBadge === null) return;
                
                const cleanBadge = customBadge.trim().substring(0, 15);
                if (!cleanBadge) {
                    showToast("Badge text cannot be empty!", "error");
                    return;
                }
                
                deductPoints(2500);
                
                const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
                state.user.badge = cleanBadge;
                state.user.badgeExpiresAt = expiryTime;
                
                const saved = localStorage.getItem("filmhouse_user_profile");
                let profile = {};
                if (saved) {
                    try {
                        profile = JSON.parse(saved);
                    } catch (e) {}
                }
                profile.badge = cleanBadge;
                profile.badgeExpiresAt = expiryTime;
                localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
                
                syncUserToFirestore();
                showToast(`VIP Badge unlocked: "${cleanBadge}"! Check leaderboard.`, "success");
            }
        });
    });

    loadUserProfile();
    checkDailyVisitPoints();
    renderDailyMissions();
    startMissionsResetTimer();

    // Check if browser visitor needs Telegram login prompt overlay
    if (!state.isTelegram && !profileExists) {
        const loginModal = document.getElementById("telegram-login-modal");
        if (loginModal) {
            loginModal.classList.add("active");
        }
    }


    // 2. Fetch data (JSON files or Client dynamic parser fallback)
    await initializeDatabase();
    generateNotificationAlerts();

    // 3. Populate state lists (Watchlist, History)
    loadWatchlist();
    loadWatchHistory();

    // 4. Fill categories options inside filters
    initializeFilterDropdowns();

    // 5. Populate Carousel Banner
    renderCarouselBanner();

    // 6. Draw Category Filters
    renderCategoriesBar();
    renderGenreChips();

    // 7. Load Editor Picks from Firestore
    if (typeof firebase !== "undefined" && db) {
        try {
            const doc = await db.collection("settings").doc("admin_picks").get();
            if (doc.exists) {
                state.editorPicks = doc.data().ids || [];
                state.editorsChoiceTitle = doc.data().title || "Editor's Choice 🎬";
            }
        } catch (err) {
            console.warn("Error loading editor picks:", err);
        }
    }

    // 7. Load grid results list
    renderFeaturedGrid();

    // 7b. Render Editor's Choice carousel
    renderEditorsChoice();

    // 8. Load FAQs panel answers
    renderFAQAccordion();

    // 9. Initialize Adsgram SDK
    initializeAdsgram();

    // 10. Bind triggers & event click listeners
    bindEvents();

    // 10c. Enable drag to scroll for horizontal sliders on PC
    enableDragToScroll(document.getElementById("categories-bar-slider"));
    enableDragToScroll(document.getElementById("editors-choice-scroll-container"));
    enableDragToScroll(document.getElementById("hero-carousel"));

    // 10b. Handle startup startapp routing parameter redirection
    if (initialScreen === "mining") {
        navigateToScreen("mining");
    }

    if (boostRequestDocId) {
        setTimeout(() => {
            if (typeof firebase !== "undefined" && db) {
                db.collection("requests").doc(boostRequestDocId).get().then(doc => {
                    if (doc.exists) {
                        const req = doc.data();
                        if (req.status === "priority") {
                            showToast(`Request for "${req.title}" is already boosted!`, "info");
                            return;
                        }
                        if (confirm(`Would you like to spend 1,000 points to boost your request for "${req.title}" to High Priority?`)) {
                            boostRequestToPriority(boostRequestDocId);
                        }
                    } else {
                        showToast("Request not found or has been completed.", "error");
                    }
                }).catch(err => console.warn("Error loading boost request details:", err));
            }
        }, 3000);
    }

    // 11. Clear loader splash page with a cinematic 1.5s delay presentation
    const loader = document.getElementById("preloader");
    if (loader) {
        setTimeout(() => {
            loader.classList.add("fade-out");
            // Initialize tour guide overlay
            initWelcomeTourHandlers();
            initPremiumSearchOverlay();
        }, 2500);
    }
    } catch (err) {
        console.error("Initialization error:", err);
        const loader = document.getElementById("preloader");
        if (loader) {
            loader.classList.add("fade-out");
        }
    }
});

// Helper to convert standard t.me links into native tg:// schemes for external redirection
function convertToTelegramScheme(url) {
    if (!url || typeof url !== "string") return url;
    
    // Check if it's a telegram link
    if (url.includes("t.me/")) {
        try {
            // Extract the part after t.me/
            const parts = url.split("t.me/");
            if (parts.length > 1) {
                const path = parts[1];
                
                // Case 1: Private invite link e.g., t.me/+09ahNmGdB1U2MzFk or t.me/joinchat/09ahNmGdB1U2MzFk
                if (path.startsWith("+")) {
                    const code = path.substring(1);
                    return `tg://join?invite=${code}`;
                }
                if (path.startsWith("joinchat/")) {
                    const code = path.substring(9);
                    return `tg://join?invite=${code}`;
                }
                
                // Case 2: Channel post link, e.g., t.me/filmhousedirect/280
                if (path.includes("/")) {
                    const subParts = path.split("/");
                    const domain = subParts[0];
                    const postId = subParts[1];
                    if (postId && !isNaN(postId)) {
                        return `tg://resolve?domain=${domain}&post=${postId}`;
                    }
                }
                
                // Case 3: Bot link with start parameters, e.g., t.me/FilmHouseFilebot?start=xxx or startapp=xxx
                if (path.includes("?")) {
                    const subParts = path.split("?");
                    const domain = subParts[0];
                    const query = subParts[1];
                    const params = new URLSearchParams(query);
                    const startParam = params.get("start") || params.get("startapp");
                    if (startParam) {
                        return `tg://resolve?domain=${domain}&start=${startParam}`;
                    }
                }
                
                // Case 4: Standard user/bot/channel domain name, e.g., t.me/FilmHouseFilebot
                return `tg://resolve?domain=${path}`;
            }
        } catch (e) {
            console.error("Error converting telegram link to scheme:", e);
        }
    }
    return url;
}

// Premium Connection Drawer Loader Transition
function showConnectionDrawer(targetLink, blockId, skipAd = false) {
    if (!targetLink || typeof targetLink !== "string") return;
    targetLink = targetLink.trim();

    const drawer = document.getElementById("connection-drawer");
    const statusEl = document.getElementById("connection-status-text");
    const titleEl = drawer ? drawer.querySelector(".connection-title") : null;
    const downloadModal = document.getElementById("download-modal");

    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
    const closeDrawer = () => {
        if (drawer) {
            drawer.classList.remove("active");
            setTimeout(() => { 
                drawer.style.display = "none"; 
                // Restore spinner and remove dynamic buttons/tasks for next requests
                const spinnerWrapper = drawer.querySelector(".connection-spinner-wrapper");
                if (spinnerWrapper) spinnerWrapper.style.display = "flex";
                const actionBtn = drawer.querySelector(".connection-action-btn");
                if (actionBtn) actionBtn.remove();
                const taskContainer = drawer.querySelector(".adsgram-task-container");
                if (taskContainer) taskContainer.remove();
                const fallbackBtn = drawer.querySelector(".fallback-video-btn");
                if (fallbackBtn) fallbackBtn.remove();
            }, 300);
        }
    };

    const openLink = () => {
        syncUserToFirestore();
        awardPoints(10, "download");

        // Guidance toast reminding them to click "Start" in the bot
        if (targetLink.includes("start=")) {
            showToast("Important: Tap 'START' at the bottom of the bot chat to get your movie!", "info");
        }

        // Close the download modal so the user isn't stuck on it
        if (downloadModal) downloadModal.classList.remove("active");

        // Use Telegram's native link opener for t.me links (avoids popup blocking inside webapp view)
        const tg = window.Telegram?.WebApp;
        const isMobile = tg && (tg.platform === "android" || tg.platform === "ios");
        
        if (tg && tg.openTelegramLink && targetLink.includes("t.me") && isMobile) {
            try {
                tg.openTelegramLink(targetLink);
                return;
            } catch (e) {
                console.warn("tg.openTelegramLink failed:", e);
            }
        }
        // Fallback for non-Telegram links or if openTelegramLink fails/is skipped inside Telegram WebApp
        if (tg && tg.openLink) {
            try {
                tg.openLink(targetLink);
                return;
            } catch (e) {
                console.warn("tg.openLink failed:", e);
            }
        }

        // Convert link to native deep link scheme for external browsers to bypass web preview info page
        const nativeLink = convertToTelegramScheme(targetLink);

        // Try window.open
        const win = window.open(nativeLink, '_blank');
        if (!win) {
            // If popup blocked, redirect directly
            window.location.href = nativeLink;
        }
    };

    if (!drawer) {
        // Fallback if drawer elements are missing
        showAdRewardFlow(null, blockId).then(openLink);
        return;
    }

    // Set up close actions for connection drawer overlay and close button
    const closeBtn = document.getElementById("btn-close-connection-drawer");
    if (closeBtn) {
        closeBtn.onclick = () => {
            closeDrawer();
        };
    }
    drawer.onclick = (e) => {
        if (e.target === drawer) {
            closeDrawer();
        }
    };

    // Reset state & ensure spinner is showing and any old action button is removed
    if (titleEl) {
        titleEl.textContent = blockId === ADSGRAM_REQUEST_BLOCK_ID ? "Securing Request Link…" : "Securing Premium Connection…";
    }
    setStatus("Initializing…");
    const spinnerWrapper = drawer.querySelector(".connection-spinner-wrapper");
    if (spinnerWrapper) spinnerWrapper.style.display = "flex";
    const existingBtn = drawer.querySelector(".connection-action-btn");
    if (existingBtn) existingBtn.remove();

    drawer.style.display = "flex";
    drawer.offsetHeight; // force reflow
    drawer.classList.add("active");

    // Brief premium animation (800 ms), then start ad flow (if not skipped) while drawer is still visible
    setTimeout(async () => {
        if (!skipAd) {
            setStatus("Preparing ad…");
            await showAdRewardFlow((msg) => setStatus(msg), blockId);
        } else {
            setStatus("Verifying claim authorization…");
            await delay(800); // Brief premium transition delay
        }

        // Ad flow finished
        if (titleEl) {
            titleEl.textContent = blockId === ADSGRAM_REQUEST_BLOCK_ID ? "Request Link Ready ✓" : "Connection Secured ✓";
        }
        
        // Show helpful message instructing user what to do in the bot chat
        if (targetLink.includes("start=")) {
            setStatus("Ready! Tap the button below to open Telegram. Make sure to tap 'START' at the bottom of the bot chat to receive your movie!");
        } else if (blockId === ADSGRAM_REQUEST_BLOCK_ID) {
            setStatus("Your request link is ready. Tap below to proceed to the Request Group!");
        } else {
            setStatus("Your connection is secured. Tap below to proceed!");
        }

        // Hide spinner to transition UI to confirmation button
        if (spinnerWrapper) spinnerWrapper.style.display = "none";

        // Create a direct redirect button inside the drawer container
        const container = drawer.querySelector(".connection-drawer-container");
        const actionBtn = document.createElement("button");
        actionBtn.className = "btn btn-primary btn-block connection-action-btn";
        actionBtn.style.marginTop = "16px";
        
        if (targetLink.includes("start=")) {
            actionBtn.textContent = "Start Bot & Get Movie 📥";
        } else if (blockId === ADSGRAM_REQUEST_BLOCK_ID) {
            actionBtn.textContent = "Proceed to Request Group 💬";
        } else if (blockId === ADSGRAM_DOWNLOAD_BLOCK_ID) {
            actionBtn.textContent = "Get Movie File 📥";
        } else if (targetLink.includes("joinchat") || targetLink.includes("/+")) {
            actionBtn.textContent = "Join Telegram Channel 📢";
        } else {
            actionBtn.textContent = "Open Telegram 📥";
        }

        actionBtn.addEventListener("click", () => {
            openLink();
            closeDrawer();
        });

        container.appendChild(actionBtn);

        // Attempt automatic redirect as a convenience fallback (may be blocked by browser popup settings)
        openLink();
    }, 800);
}

function showBannedScreen() {
    // Stop any splash screen timers
    const preloader = document.getElementById("preloader");
    if (preloader) preloader.style.display = "none";
    
    // Check if banned screen already exists
    if (document.getElementById("banned-screen-overlay")) return;
    
    const overlay = document.createElement("div");
    overlay.id = "banned-screen-overlay";
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #07080c;
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        font-family: 'Outfit', sans-serif;
        text-align: center;
        padding: 24px;
        box-sizing: border-box;
    `;
    
    overlay.innerHTML = `
        <div style="background: rgba(255, 59, 48, 0.05); border: 1px solid rgba(255, 59, 48, 0.2); border-radius: 16px; padding: 32px; max-width: 400px; box-shadow: 0 10px 30px rgba(255, 59, 48, 0.05);">
            <div style="font-size: 64px; margin-bottom: 20px;">🚫</div>
            <h2 style="font-size: 22px; margin: 0 0 12px 0; font-weight: 700; color: #ff3b30;">Access Restricted</h2>
            <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6; margin: 0 0 20px 0;">
                Your account access to Film House has been restricted due to a violation of our terms of service or guidelines.
            </p>
            <p style="font-size: 12px; color: var(--text-muted); margin: 0;">
                If you believe this is a mistake, please contact support.
            </p>
        </div>
    `;
    
    document.body.prepend(overlay);
    
    // Disable any scrolls or inputs
    document.body.style.overflow = "hidden";
    document.body.style.pointerEvents = "none";
    overlay.style.pointerEvents = "auto"; // only allow interacting with the overlay itself
}

// Passive Points Farming (Mining) System
const FARMING_DURATION = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
const FARMING_REWARD = 80; // points awarded (10 pts per hour)
const FARMING_RATE = FARMING_REWARD / FARMING_DURATION; // points per millisecond
let farmingInterval = null;

function updateFarmingUI() {
    const btn = document.getElementById("btn-farm-action");
    const statusText = document.getElementById("mining-status-text");
    const timerText = document.getElementById("mining-timer-text");
    const counter = document.getElementById("mining-live-counter");
    const logoBox = document.getElementById("mining-logo-box-el");
    const progressContainer = document.getElementById("mining-progress-container");
    const progressFill = document.getElementById("mining-progress-fill");
    const progressPercent = document.getElementById("mining-progress-percent");

    if (!btn) return;

    const startedAt = state.user.farmingStartedAt || 0;

    if (startedAt === 0) {
        // Inactive mining state
        clearInterval(farmingInterval);
        clearInterval(particleInterval);
        particleInterval = null;
        if (logoBox) {
            logoBox.className = "mining-logo-box";
            logoBox.style.setProperty("--farm-pct", "0%");
            const particles = logoBox.querySelectorAll(".mining-particle");
            particles.forEach(p => p.remove());
        }
        if (progressContainer) progressContainer.style.display = "none";
        statusText.textContent = "Mining Inactive";
        counter.textContent = "+0.000";
        timerText.textContent = "8-hour session • Earn 80 points";
        btn.textContent = "Start Mining ⚡";
        btn.style.background = "var(--primary-gradient)";
        btn.style.color = "#000";
        btn.disabled = false;
    } else {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= FARMING_DURATION) {
            // Completed mining state, wait for claim
            clearInterval(farmingInterval);
            clearInterval(particleInterval);
            particleInterval = null;
            if (logoBox) {
                logoBox.className = "mining-logo-box complete";
                logoBox.style.setProperty("--farm-pct", "100%");
                const particles = logoBox.querySelectorAll(".mining-particle");
                particles.forEach(p => p.remove());
            }
            if (progressContainer) {
                progressContainer.style.display = "block";
                if (progressFill) progressFill.style.width = "100%";
                if (progressPercent) progressPercent.textContent = "100%";
            }
            statusText.textContent = "Session Complete!";
            counter.textContent = `+${FARMING_REWARD.toFixed(3)}`;
            timerText.textContent = "Claim your Loyalty Points now!";
            btn.textContent = "Claim Points 🪙";
            btn.style.background = "linear-gradient(135deg, #00c853 0%, #009624 100%)";
            btn.style.color = "#fff";
            btn.disabled = false;
        } else {
            // Currently active mining state
            if (logoBox) {
                logoBox.className = "mining-logo-box active";
            }
            if (progressContainer) progressContainer.style.display = "block";
            btn.textContent = "Mining... 🔋";
            btn.style.background = "rgba(255,255,255,0.05)";
            btn.style.color = "var(--text-muted)";
            btn.disabled = true;

            const tick = () => {
                const curElapsed = Date.now() - state.user.farmingStartedAt;
                if (curElapsed >= FARMING_DURATION) {
                    updateFarmingUI();
                } else {
                    const pointsMined = curElapsed * FARMING_RATE;
                    counter.textContent = `+${pointsMined.toFixed(3)}`;
                    const pct = (curElapsed / FARMING_DURATION) * 100;
                    if (logoBox) {
                        logoBox.style.setProperty("--farm-pct", `${pct}%`);
                    }
                    if (progressFill) {
                        progressFill.style.width = `${pct}%`;
                    }
                    if (progressPercent) {
                        progressPercent.textContent = `${Math.floor(pct)}%`;
                    }
                    
                    const timeLeftMs = FARMING_DURATION - curElapsed;
                    const hrs = Math.floor(timeLeftMs / (3600 * 1000));
                    const mins = Math.floor((timeLeftMs % (3600 * 1000)) / (60 * 1000));
                    const secs = Math.floor((timeLeftMs % (60 * 1000)) / 1000);
                    timerText.textContent = `Ends in ${hrs}h ${mins}m ${secs}s`;
                    statusText.textContent = "Mining points...";
                }
            };

            tick();
            clearInterval(farmingInterval);
            farmingInterval = setInterval(tick, 1000);
            startFarmingParticles();
        }
    }
}

let particleInterval = null;
function startFarmingParticles() {
    const logoBox = document.getElementById("mining-logo-box-el");
    if (!logoBox) return;

    if (particleInterval) return;

    particleInterval = setInterval(() => {
        if (!logoBox.classList.contains("active")) {
            clearInterval(particleInterval);
            particleInterval = null;
            return;
        }

        const isAvatarParticle = Math.random() < 0.25 && state.user.avatar;
        
        if (isAvatarParticle) {
            const img = document.createElement("img");
            img.src = state.user.avatar;
            img.className = "mining-particle";
            
            const left = Math.random() * 70 + 15;
            const size = Math.random() * 6 + 14; // 14px to 20px
            const duration = Math.random() * 1.5 + 2;
            
            img.style.cssText = `
                position: absolute;
                bottom: 10px;
                left: ${left}%;
                width: ${size}px;
                height: ${size}px;
                border-radius: 50%;
                border: 1px solid rgba(255, 188, 0, 0.6);
                box-shadow: 0 0 6px rgba(255, 188, 0, 0.4);
                opacity: 0;
                z-index: 3;
                pointer-events: none;
                object-fit: cover;
                animation: float-particle ${duration}s ease-in-out forwards;
            `;
            logoBox.appendChild(img);
            setTimeout(() => img.remove(), duration * 1000);
        } else {
            const particle = document.createElement("div");
            particle.className = "mining-particle";
            
            const icons = ["🍿", "🎬", "⭐", "🪙", "🎞️"];
            particle.textContent = icons[Math.floor(Math.random() * icons.length)];
            
            const left = Math.random() * 70 + 15;
            const size = Math.random() * 6 + 10; // 10px to 16px
            const duration = Math.random() * 1.5 + 2;
            
            particle.style.cssText = `
                position: absolute;
                bottom: 10px;
                left: ${left}%;
                font-size: ${size}px;
                opacity: 0;
                z-index: 3;
                pointer-events: none;
                animation: float-particle ${duration}s ease-in-out forwards;
            `;
            logoBox.appendChild(particle);
            setTimeout(() => particle.remove(), duration * 1000);
        }
    }, 450);
}

// 7-Day Daily Check-in Streak Calendar
function renderStreakCalendar() {
    const grid = document.getElementById("streak-days-grid");
    const countText = document.getElementById("streak-count-text");
    if (!grid || !countText) return;

    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    let streak = state.user.checkInStreak || 0;
    let lastDate = state.user.lastCheckInDate || "";

    // Check if streak was broken (missed more than 1 day)
    if (lastDate !== today && lastDate !== yesterday && lastDate !== "") {
        streak = 0;
        state.user.checkInStreak = 0;
        state.user.lastCheckInDate = "";
        saveProfileToLocalStorage();
    }

    const alreadyClaimedToday = (lastDate === today);
    countText.textContent = `${streak} Day${streak === 1 ? "" : "s"} Streak`;

    const dayRewards = [5, 10, 15, 20, 25, 30, 50];

    grid.replaceChildren();

    for (let d = 1; d <= 7; d++) {
        const dayBox = document.createElement("div");
        dayBox.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 8px 4px;
            border-radius: 8px;
            font-size: 10px;
            font-weight: 700;
            transition: all 0.2s ease;
            position: relative;
            min-height: 54px;
        `;

        const isClaimed = d <= streak;
        const isActiveClaim = (!alreadyClaimedToday && d === (streak === 7 ? 1 : streak + 1));

        const reward = dayRewards[d - 1];

        if (isClaimed) {
            dayBox.style.background = "rgba(76, 175, 80, 0.12)";
            dayBox.style.border = "1px solid rgba(76, 175, 80, 0.3)";
            dayBox.style.color = "#4caf50";
            dayBox.innerHTML = `
                <span style="opacity: 0.8; font-size: 8px; margin-bottom: 2px;">Day ${d}</span>
                <span style="font-size: 12px; margin: 2px 0;">✓</span>
                <span style="font-size: 8px;">Claimed</span>
            `;
        } else if (isActiveClaim) {
            dayBox.style.background = "linear-gradient(135deg, #ff9f00 0%, #ffbc00 100%)";
            dayBox.style.color = "#000";
            dayBox.style.boxShadow = "0 0 10px rgba(255, 188, 0, 0.4)";
            dayBox.style.cursor = "pointer";
            dayBox.innerHTML = `
                <span style="font-weight: 800; font-size: 8px; margin-bottom: 2px;">Day ${d}</span>
                <span style="font-size: 11px; font-weight: 900; margin: 1px 0;">+${reward}</span>
                <span style="font-size: 8px; font-weight: 800;">Claim 🪙</span>
            `;
            
            dayBox.addEventListener("click", (e) => {
                claimStreakReward(d, reward, e.currentTarget);
            });
        } else {
            dayBox.style.background = "rgba(255, 255, 255, 0.02)";
            dayBox.style.border = "1px solid rgba(255, 255, 255, 0.05)";
            dayBox.style.color = "var(--text-secondary)";
            dayBox.style.opacity = "0.6";
            dayBox.innerHTML = `
                <span style="font-size: 8px; margin-bottom: 2px;">Day ${d}</span>
                <span style="font-size: 10px; font-weight: 800; margin: 2px 0;">+${reward}</span>
                <span style="font-size: 8px; opacity: 0.6;">${d === 7 ? "🎁 VIP" : "Locked"}</span>
            `;
        }

        grid.appendChild(dayBox);
    }
}

function claimStreakReward(dayNum, rewardAmount, sourceElement) {
    const today = new Date().toISOString().split("T")[0];
    
    let newStreak = state.user.checkInStreak || 0;
    if (newStreak === 7) {
        newStreak = 1;
    } else {
        newStreak += 1;
    }
    
    state.user.checkInStreak = newStreak;
    state.user.lastCheckInDate = today;
    
    triggerHaptic("success");
    
    // Trigger floating coins visual effect
    if (sourceElement) {
        triggerFloatingCoinsAnimation(sourceElement);
    }
    
    awardPoints(rewardAmount, "visit");
    saveProfileToLocalStorage();
    syncUserToFirestore();
    
    renderStreakCalendar();
    renderDailyMissions();
    
    showToast(`Day ${dayNum} check-in claimed! +${rewardAmount} points awarded! 🗓️`, "success");
}

function saveProfileToLocalStorage() {
    const profile = {
        fullName: state.user.fullName,
        avatar: state.user.avatar,
        greetingFontStyle: state.user.greetingFontStyle || "default",
        favoriteCategories: state.user.favoriteCategories || [],
        notificationsEnabled: state.user.notificationsEnabled !== undefined ? state.user.notificationsEnabled : true,
        subAnime: state.user.subAnime !== undefined ? state.user.subAnime : true,
        subHollywood: state.user.subHollywood !== undefined ? state.user.subHollywood : true,
        subRecs: state.user.subRecs !== undefined ? state.user.subRecs : true,
        contactPreference: state.user.contactPreference || "telegram",
        points: state.user.points || 0,
        pointsBreakdown: state.user.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 },
        checkInStreak: state.user.checkInStreak || 0,
        lastCheckInDate: state.user.lastCheckInDate || "",
        farmingStartedAt: state.user.farmingStartedAt || 0,
        badge: state.user.badge || "",
        badgeExpiresAt: state.user.badgeExpiresAt || 0,
        dailyStats: state.user.dailyStats || {}
    };
    localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
}

// Mining Page Booster Task Ad Loader
function loadMiningTaskAd() {
    const box = document.getElementById("mining-task-box");
    const placeholder = document.getElementById("mining-task-placeholder");
    if (!box || !placeholder) return;

    // Only load if running inside real Telegram environment with Adsgram
    const isTelegramEnv = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== "";
    if (!isTelegramEnv || !window.Adsgram || !ADSGRAM_TASK_BLOCK_ID) {
        box.style.display = "none";
        return;
    }

    placeholder.replaceChildren();

    const taskEl = document.createElement("adsgram-task");
    taskEl.setAttribute("block-id", ADSGRAM_TASK_BLOCK_ID);
    taskEl.setAttribute("data-block-id", ADSGRAM_TASK_BLOCK_ID);

    taskEl.style.display = "block";
    taskEl.style.width = "100%";
    taskEl.style.background = "rgba(255, 255, 255, 0.03)";
    taskEl.style.border = "1px solid rgba(255, 255, 255, 0.08)";
    taskEl.style.borderRadius = "16px";
    taskEl.style.padding = "16px 14px";
    taskEl.style.boxSizing = "border-box";
    taskEl.style.setProperty("--adsgram-task-button-width", "95px");
    taskEl.style.setProperty("--adsgram-task-icon-size", "44px");
    taskEl.style.setProperty("--adsgram-task-font-size", "14px");

    // Setup slots matching the app design
    const rewardEl = document.createElement("div");
    rewardEl.setAttribute("slot", "reward");
    rewardEl.style.cssText = "display: flex; flex-direction: column; align-items: flex-start; gap: 2px; margin-top: 6px; width: 100%; text-align: left;";
    
    const rewardTitle = document.createElement("span");
    rewardTitle.textContent = "TASK REWARD";
    rewardTitle.style.cssText = "font-size: 9px; font-weight: 700; color: rgba(255, 255, 255, 0.35); letter-spacing: 1px;";
    
    const rewardValue = document.createElement("span");
    rewardValue.textContent = "+50 Points 🪙";
    rewardValue.style.cssText = "font-size: 13px; font-weight: 700; color: #ffbc00;";
    rewardEl.replaceChildren(rewardTitle, rewardValue);

    const btnEl = document.createElement("div");
    btnEl.setAttribute("slot", "button");
    btnEl.textContent = "Start ⚡";
    btnEl.style.cssText = "background: var(--primary-gradient); color: #000000; padding: 10px 12px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer; text-align: center; width: 100%; box-sizing: border-box; transition: all 0.2s ease; box-shadow: 0 3px 10px var(--primary-glow);";

    const claimEl = document.createElement("div");
    claimEl.setAttribute("slot", "claim");
    claimEl.textContent = "Claim 🎁";
    claimEl.style.cssText = "background: linear-gradient(135deg, #00c853, #009624); color: #fff; padding: 10px 12px; border-radius: 10px; font-weight: 700; font-size: 12px; cursor: pointer; text-align: center; width: 100%; box-sizing: border-box; transition: all 0.2s ease; box-shadow: 0 3px 10px rgba(0, 200, 83, 0.25);";

    const doneEl = document.createElement("div");
    doneEl.setAttribute("slot", "done");
    doneEl.textContent = "Done ✓";
    doneEl.style.cssText = "background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); border: 1px solid var(--border-color); padding: 10px 12px; border-radius: 10px; font-weight: 700; font-size: 12px; text-align: center; width: 100%; box-sizing: border-box;";

    taskEl.replaceChildren(rewardEl, btnEl, claimEl, doneEl);
    placeholder.appendChild(taskEl);

    // Event handlers
    const handleReward = () => {
        showToast("Bonus task completed! +50 Points awarded! 🏆", "success");
        awardPoints(50, "task");
        syncUserToFirestore();
        box.style.display = "none";
    };

    const handleFallback = () => {
        box.style.display = "none";
    };

    taskEl.addEventListener("reward", handleReward);
    taskEl.addEventListener("onReward", handleReward);
    taskEl.addEventListener("onreward", handleReward);

    taskEl.addEventListener("onError", handleFallback);
    taskEl.addEventListener("onerror", handleFallback);
    taskEl.addEventListener("onBannerNotFound", handleFallback);
    taskEl.addEventListener("onbannernotfound", handleFallback);

    box.style.display = "block";
}

// Log analytical/engagement events to Firestore activity_logs
function logAppEvent(type, movieId, movieTitle) {
    if (typeof firebase === "undefined" || !db || !state.user.id) return;
    db.collection("activity_logs").add({
        type: type, // "search", "download", "watchlist", "view"
        movieId: String(movieId || ""),
        movieTitle: String(movieTitle || ""),
        userId: state.user.id,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.warn("Error logging app event:", err));
}

// Drag-to-scroll handler for PC horizontal carousels
function enableDragToScroll(slider) {
    if (!slider) return;
    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        slider.classList.add('dragging');
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });
    slider.addEventListener('mouseleave', () => {
        isDown = false;
        slider.classList.remove('dragging');
    });
    slider.addEventListener('mouseup', () => {
        isDown = false;
        slider.classList.remove('dragging');
    });
    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.5; // scroll speed multiplier
        slider.scrollLeft = scrollLeft - walk;
    });
}

// Update personalized user name greeting on header
function updateUserGreeting() {
    const greetingEl = document.getElementById("header-user-greeting");
    if (greetingEl) {
        const firstName = (state.user.fullName || "Collector").split(" ")[0];
        greetingEl.textContent = `Hi, ${firstName} 👋`;

        // Clear previous classes and apply custom styled font-style font selection
        greetingEl.className = "header-user-greeting";
        const style = state.user.greetingFontStyle || "default";
        greetingEl.classList.add(`font-style-${style}`);
    }
}

// Welcome Tour Controller State
let currentTourStep = 1;

function startWelcomeTour() {
    const tourOverlay = document.getElementById("app-tour-overlay");
    if (!tourOverlay) return;
    
    currentTourStep = 1;
    showTourStep(1);
    tourOverlay.classList.add("active");
}

function showTourStep(stepNum) {
    currentTourStep = stepNum;
    
    // Hide all steps
    const steps = document.querySelectorAll(".tour-step");
    steps.forEach(s => s.classList.remove("active"));
    
    // Show active step
    const activeStep = document.querySelector(`.tour-step[data-step="${stepNum}"]`);
    if (activeStep) activeStep.classList.add("active");
    
    // Update navigation dots
    const dots = document.querySelectorAll(".tour-dot");
    dots.forEach(d => {
        d.classList.toggle("active", parseInt(d.getAttribute("data-step")) === stepNum);
    });
    
    // Handle back button visibility
    const backBtn = document.getElementById("btn-tour-prev");
    if (backBtn) {
        backBtn.style.visibility = stepNum === 1 ? "hidden" : "visible";
    }
    
    // Handle next button label
    const nextBtn = document.getElementById("btn-tour-next");
    if (nextBtn) {
        nextBtn.textContent = stepNum === 6 ? "Finish" : "Next";
    }

    // --- Interactive Walkthrough Tour Navigation ---
    const rewardsDrawer = document.getElementById("rewards-drawer");
    const filterToggle = document.getElementById("search-filter-toggle");
    const filterPanel = document.getElementById("search-filters-panel");
    const searchWrapper = document.querySelector(".search-bar-wrapper");
    const searchInput = document.getElementById("global-search-input");

    // Clean up previous highlights
    const highlighted = document.querySelectorAll(".tour-highlight-target");
    highlighted.forEach(el => el.classList.remove("tour-highlight-target"));

    // Close overlays/drawers by default
    if (rewardsDrawer) rewardsDrawer.classList.remove("active");
    if (filterToggle && filterPanel) {
        filterToggle.classList.remove("active");
        filterPanel.style.display = "none";
    }
    if (searchWrapper) searchWrapper.classList.remove("expanded");

    if (stepNum === 1) {
        // Welcome screen
        navigateToScreen("home");
    } else if (stepNum === 2) {
        // Search & Filters screen
        navigateToScreen("home");
        if (searchWrapper) {
            searchWrapper.classList.add("expanded");
            searchWrapper.classList.add("tour-highlight-target");
        }
        if (searchInput) {
            searchInput.focus();
            // Simulate typing "anime" letter-by-letter for the user
            let searchVal = "";
            const term = "anime";
            let letterIdx = 0;
            searchInput.value = "";
            state.searchQuery = "";
            
            const typeLetter = () => {
                if (currentTourStep !== 2) return; // cancel if user navigated away
                if (letterIdx < term.length) {
                    searchVal += term[letterIdx];
                    searchInput.value = searchVal;
                    state.searchQuery = searchVal;
                    renderAutocomplete(searchVal);
                    letterIdx++;
                    setTimeout(typeLetter, 120);
                } else {
                    renderFeaturedGrid();
                }
            };
            setTimeout(typeLetter, 300);
        }
    } else if (stepNum === 3) {
        // Personalization screen (Profile -> Settings tab)
        navigateToScreen("profile");
        const tabButtons = document.querySelectorAll(".profile-tab-btn");
        tabButtons.forEach(btn => {
            if (btn.getAttribute("data-tab") === "settings") {
                btn.click();
            }
        });
        const profileForm = document.getElementById("profile-page-form");
        if (profileForm) {
            profileForm.classList.add("tour-highlight-target");
        }
    } else if (stepNum === 4) {
        // Mining screen
        navigateToScreen("mining");
        const minerCard = document.querySelector(".miner-card") || document.getElementById("btn-farm-action");
        if (minerCard) {
            minerCard.classList.add("tour-highlight-target");
        }
    } else if (stepNum === 5) {
        // Reward Center, Requests & Missions (open Reward Center drawer)
        navigateToScreen("home");
        if (rewardsDrawer) {
            rewardsDrawer.classList.add("active");
            if (typeof updatePointsUI === "function") updatePointsUI();
            if (typeof renderDailyMissions === "function") renderDailyMissions();
            if (typeof updateHeaderNotificationDot === "function") updateHeaderNotificationDot();
            
            // Highlight the drawer content container
            const drawerContainer = rewardsDrawer.querySelector(".connection-drawer-container");
            if (drawerContainer) {
                drawerContainer.classList.add("tour-highlight-target");
            }
            
            // Animate points display count-up logic
            const pointsDisplay = document.getElementById("rewards-points-display");
            if (pointsDisplay) {
                let counter = 0;
                const targetPoints = parseInt(state.user.points || 0);
                const increment = () => {
                    if (currentTourStep !== 5) return;
                    if (counter < 25) {
                        pointsDisplay.textContent = Math.floor(Math.random() * 2000).toLocaleString();
                        counter++;
                        setTimeout(increment, 20);
                    } else {
                        pointsDisplay.textContent = targetPoints.toLocaleString();
                    }
                };
                increment();
            }
        }
    } else if (stepNum === 6) {
        // User Feedback screen
        navigateToScreen("feedback");
        const feedbackCard = document.querySelector(".feedback-card") || document.getElementById("feedback-form");
        if (feedbackCard) {
            feedbackCard.classList.add("tour-highlight-target");
        }
    }
}

function closeWelcomeTour() {
    const tourOverlay = document.getElementById("app-tour-overlay");
    if (tourOverlay) {
        tourOverlay.classList.remove("active");
    }
    localStorage.setItem("filmhouse_tour_completed", "true");
    
    // Clean up highlights
    const highlighted = document.querySelectorAll(".tour-highlight-target");
    highlighted.forEach(el => el.classList.remove("tour-highlight-target"));
    
    // Close any drawers that were opened during the tour
    const rewardsDrawer = document.getElementById("rewards-drawer");
    if (rewardsDrawer) rewardsDrawer.classList.remove("active");
    
    const filterToggle = document.getElementById("search-filter-toggle");
    const filterPanel = document.getElementById("search-filters-panel");
    if (filterToggle && filterPanel) {
        filterToggle.classList.remove("active");
        filterPanel.style.display = "none";
    }

    const searchWrapper = document.querySelector(".search-bar-wrapper");
    if (searchWrapper) searchWrapper.classList.remove("expanded");

    // Reset search state and search text box to avoid getting stuck in search layout
    const searchInput = document.getElementById("global-search-input");
    if (searchInput) {
        searchInput.value = "";
    }
    state.searchQuery = "";
    state.externalSearchResults = [];
    document.body.classList.remove("search-active");

    const clearBtn = document.getElementById("search-clear-btn");
    if (clearBtn) clearBtn.style.display = "none";

    const dropdown = document.getElementById("search-autocomplete-dropdown");
    if (dropdown) {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
    }

    navigateToScreen("home");
    renderFeaturedGrid();
}

function initWelcomeTourHandlers() {
    const nextBtn = document.getElementById("btn-tour-next");
    const prevBtn = document.getElementById("btn-tour-prev");
    const skipBtn = document.getElementById("btn-tour-skip");
    const tourBtn = document.getElementById("btn-profile-tutorial");
    
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (currentTourStep < 6) {
                showTourStep(currentTourStep + 1);
            } else {
                closeWelcomeTour();
            }
        });
    }
    
    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (currentTourStep > 1) {
                showTourStep(currentTourStep - 1);
            }
        });
    }
    
    if (skipBtn) {
        skipBtn.addEventListener("click", () => {
            closeWelcomeTour();
        });
    }
    
    if (tourBtn) {
        tourBtn.addEventListener("click", () => {
            startWelcomeTour();
        });
    }

    // Auto-start for new visitors
    const completed = localStorage.getItem("filmhouse_tour_completed");
    if (completed !== "true") {
        setTimeout(() => {
            startWelcomeTour();
        }, 1200);
    }
}

// ==========================================
// Premium Glassmorphic Search Overlay Code
// ==========================================
let overlaySearchDebounceTimer = null;

function initPremiumSearchOverlay() {
    const searchInput = document.getElementById("global-search-input");
    const searchWrapper = document.querySelector(".search-bar-wrapper");
    const searchIcon = document.querySelector(".search-icon");
    const overlay = document.getElementById("premium-search-overlay");
    const closeBtn = document.getElementById("btn-close-search-overlay");
    const overlayInput = document.getElementById("overlay-search-input");
    const clearBtn = document.getElementById("overlay-search-clear");
    const scopeSelect = document.getElementById("search-scope-select");

    if (!overlay || !overlayInput) return;

    const openPremiumSearch = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        overlay.classList.add("active");
        document.body.classList.add("search-active");
        document.body.style.overflow = "hidden"; // Prevent background scroll
        overlayInput.value = searchInput?.value || "";
        overlayInput.focus();
        triggerOverlaySearch(overlayInput.value);
    };

    const closePremiumSearch = () => {
        overlay.classList.remove("active");
        document.body.classList.remove("search-active");
        document.body.style.overflow = ""; // Enable background scroll
    };

    // Event listeners to open overlay
    if (searchInput) {
        searchInput.addEventListener("focus", openPremiumSearch);
        searchInput.addEventListener("click", openPremiumSearch);
    }
    if (searchWrapper) {
        searchWrapper.addEventListener("click", openPremiumSearch);
    }
    if (searchIcon) {
        searchIcon.addEventListener("click", openPremiumSearch);
    }

    // Close buttons
    if (closeBtn) {
        closeBtn.addEventListener("click", closePremiumSearch);
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay.classList.contains("active")) {
            closePremiumSearch();
        }
    });

    // Clear input
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            overlayInput.value = "";
            triggerOverlaySearch("");
            overlayInput.focus();
        });
    }

    // Input text listener with 150ms debounce to prevent typing lag
    overlayInput.addEventListener("input", (e) => {
        const query = e.target.value;
        clearTimeout(overlaySearchDebounceTimer);
        overlaySearchDebounceTimer = setTimeout(() => {
            triggerOverlaySearch(query);
        }, 150);
    });

    // Scope select change
    if (scopeSelect) {
        scopeSelect.addEventListener("change", () => {
            triggerOverlaySearch(overlayInput.value);
        });
    }
}

function triggerOverlaySearch(query) {
    const resultsContainer = document.getElementById("search-overlay-results");
    const countText = document.getElementById("search-overlay-results-count");
    const clearBtn = document.getElementById("overlay-search-clear");
    const scope = document.getElementById("search-scope-select")?.value || "all";
    
    if (clearBtn) {
        clearBtn.style.display = query ? "flex" : "none";
    }

    const q = (query || "").toLowerCase().trim();
    if (!q) {
        if (resultsContainer) resultsContainer.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.3); font-size: 14px;">
                🍿 Start typing to search Film House catalog...
            </div>
        `;
        if (countText) countText.textContent = "Type to search...";
        return;
    }

    // Filter local movies
    let filtered = state.movies.filter(m => {
        const titleMatch = (m.title || "").toLowerCase().includes(q);
        const overviewMatch = (m.overview || "").toLowerCase().includes(q);
        const castMatch = m.cast && m.cast.some(c => c && c.toLowerCase().includes(q));
        const directorMatch = m.director && m.director.toLowerCase().includes(q);
        const genresMatch = m.genres && m.genres.some(g => g && g.toLowerCase().includes(q));
        return titleMatch || overviewMatch || castMatch || directorMatch || genresMatch;
    });

    // Apply scope filtering (case-insensitive checks to support capitalized type schemas like "Series" and "Movie")
    if (scope === "movies") {
        filtered = filtered.filter(m => (m.type || "").toLowerCase() === "movie");
    } else if (scope === "series") {
        filtered = filtered.filter(m => {
            const t = (m.type || "").toLowerCase();
            return t === "series" || t === "tv";
        });
    } else if (scope === "anime") {
        filtered = filtered.filter(m => {
            const hasAnimeCategory = m.categories && m.categories.some(cat => (cat || "").toLowerCase() === "anime");
            const hasAnimeGenre = m.genres && m.genres.some(g => (g || "").toLowerCase() === "anime" || (g || "").toLowerCase() === "animation");
            return hasAnimeCategory || hasAnimeGenre;
        });
    }

    // Render local results container and global results container
    if (resultsContainer) {
        resultsContainer.innerHTML = `
            <div id="search-local-container"></div>
            <div id="search-global-container"></div>
        `;
        
        const localContainer = document.getElementById("search-local-container");
        if (filtered.length > 0) {
            filtered.forEach(m => {
                const card = createSearchOverlayCard(m);
                localContainer.appendChild(card);
            });
        }
    }
    
    if (countText) {
        countText.textContent = `Found ${filtered.length} library titles`;
    }

    // If query is >= 3 chars, perform TMDB global search and append
    if (q.length >= 3) {
        const globalContainer = document.getElementById("search-global-container");
        if (globalContainer) {
            globalContainer.innerHTML = `
                <div id="search-global-loading" style="padding: 20px; text-align: center; color: var(--primary-color); font-size: 12px; font-weight: 600;">
                    ⏳ Querying TMDB Cloud Database...
                </div>
            `;
            globalContainer.style.display = "block";
        }

        clearTimeout(overlaySearchDebounceTimer);
        overlaySearchDebounceTimer = setTimeout(async () => {
            const localContainer = document.getElementById("search-local-container");
            const globalContainer = document.getElementById("search-global-container");
            
            try {
                const extResults = await fetchGlobalTmdbSearchResults(query);
                
                // Exclude any TMDB IDs already in our local filtered results
                const localTmdbIds = new Set(filtered.map(m => m.tmdb_id).filter(id => id));
                const uniqueExt = extResults.filter(ext => !localTmdbIds.has(ext.tmdb_id));
                
                if (globalContainer) {
                    if (uniqueExt.length === 0) {
                        globalContainer.innerHTML = "";
                        globalContainer.style.display = "none";
                        
                        // Show "no matches" warning only if both are empty
                        if (filtered.length === 0 && localContainer) {
                            localContainer.innerHTML = `
                                <div style="padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.4); font-size: 14px;">
                                    🔍 No matches found in library or cloud.
                                </div>
                            `;
                        }
                    } else {
                        globalContainer.innerHTML = `
                            <h4 style="margin: 20px 0 12px 0; font-size: 11px; text-transform: uppercase; color: var(--primary-color); letter-spacing: 0.5px; font-weight: 700; padding-left: 8px;">🌐 Global Cloud Results</h4>
                            <div class="external-results-list" style="display: flex; flex-direction: column; gap: 12px;"></div>
                        `;
                        const listDiv = globalContainer.querySelector(".external-results-list");
                        uniqueExt.forEach(m => {
                            const card = createSearchOverlayCard(m);
                            listDiv?.appendChild(card);
                        });
                        globalContainer.style.display = "block";
                        
                        // Clear the local "no matches" placeholder if we have cloud results
                        if (filtered.length === 0 && localContainer) {
                            localContainer.innerHTML = "";
                        }
                    }
                    
                    if (countText) {
                        countText.textContent = `Found ${filtered.length} library & ${uniqueExt.length} cloud titles`;
                    }
                }
            } catch (err) {
                console.error("External search failed:", err);
                if (globalContainer) {
                    globalContainer.innerHTML = "";
                    globalContainer.style.display = "none";
                }
                if (filtered.length === 0 && localContainer) {
                    localContainer.innerHTML = `
                        <div style="padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.4); font-size: 14px;">
                            🔍 No matches found in library.
                        </div>
                    `;
                }
            }
        }, 400);
    } else {
        const globalContainer = document.getElementById("search-global-container");
        if (globalContainer) {
            globalContainer.innerHTML = "";
            globalContainer.style.display = "none";
        }
        if (filtered.length === 0) {
            const localContainer = document.getElementById("search-local-container");
            if (localContainer) {
                localContainer.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.4); font-size: 14px;">
                        🔍 No matches found in your library.
                    </div>
                `;
            }
        }
    }
}

const searchCache = new Map();

async function fetchGlobalTmdbSearchResults(query) {
    const qKey = (query || "").toLowerCase().trim();
    if (!qKey) return [];
    
    if (searchCache.has(qKey)) {
        return searchCache.get(qKey);
    }

    try {
        const apiKey = getTmdbApiKey();
        const url = `${TMDB_BASE_URL}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        
        const data = await res.json();
        if (data.results) {
            const results = data.results.filter(item => item.media_type === 'movie' || item.media_type === 'tv');
            const mapped = results.map(item => {
                const title = item.title || item.name || "";
                const releaseDate = item.release_date || item.first_air_date || "";
                const mType = item.media_type === 'tv' ? 'Series' : 'Movie';
                
                return {
                    csv_id: String(item.id),
                    tmdb_id: item.id,
                    imdb_id: "",
                    title: title,
                    type: mType,
                    categories: [],
                    genres: [],
                    overview: item.overview || "No synopsis available.",
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "img/FilmHouse3_nobg.png",
                    backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : "img/FilmHouse.png",
                    rating: Math.round((item.vote_average || 0) * 10) / 10,
                    release_date: releaseDate,
                    language: item.original_language || "en",
                    cast: [],
                    director: "",
                    trailer: "",
                    runtime: "",
                    links: []
                };
            });
            
            // Set cache and limit size to 50 items
            searchCache.set(qKey, mapped);
            if (searchCache.size > 50) {
                const firstKey = searchCache.keys().next().value;
                searchCache.delete(firstKey);
            }
            return mapped;
        }
    } catch (err) {
        console.error("Error fetching TMDB search:", err);
    }
    return [];
}

function createSearchOverlayCard(m) {
    const badgePrefix = window.location.pathname.includes("/MOVIE/") ? "" : "MOVIE/";
    let posterUrl = m.poster || (badgePrefix + "img/FilmHouse3_nobg.png");
    
    // Optimize TMDB poster size for small search results cards (uses small w92 thumbnail instead of w500)
    if (posterUrl.includes("image.tmdb.org/t/p/w500")) {
        posterUrl = posterUrl.replace("/t/p/w500", "/t/p/w92");
    }
    
    const genreStr = Array.isArray(m.genres) ? m.genres.join(", ") : (m.genre || "Media");
    
    const card = document.createElement("div");
    card.className = "search-result-card";
    
    card.innerHTML = `
        <div class="result-card-main">
            <img src="${posterUrl}" alt="Poster" class="result-card-poster" onerror="this.src='${badgePrefix}img/FilmHouse3_nobg.png'">
            <div class="result-card-info">
                <h4 class="result-card-title">${escapeHTML(m.title)}</h4>
                <div class="result-card-meta">
                    <span class="meta-tag genre-tag">${escapeHTML(genreStr)}</span>
                    <span class="meta-item">${m.release_date ? m.release_date.substring(0, 4) : (m.year || 'N/A')}</span>
                    <span class="meta-item rating-item">⭐ ${m.rating || 'N/A'}</span>
                </div>
            </div>
            <button class="result-card-expand-btn" style="background: none; border: none; cursor: pointer; padding: 4px; display: flex; align-items: center; color: rgba(255,255,255,0.4);" aria-label="Expand description">
                <svg class="result-card-chevron" style="width: 16px; height: 16px; transition: transform 0.25s; fill: currentColor;" viewBox="0 0 24 24">
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                </svg>
            </button>
        </div>
        <div class="result-card-description">
            ${escapeHTML(m.overview || "No synopsis available.")}
        </div>
    `;
    
    const expandBtn = card.querySelector(".result-card-expand-btn");
    const desc = card.querySelector(".result-card-description");
    const chevron = card.querySelector(".result-card-chevron");
    
    expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isExpanded = card.classList.contains("expanded");
        card.classList.toggle("expanded", !isExpanded);
        if (isExpanded) {
            desc.style.display = "none";
            chevron.style.transform = "rotate(0deg)";
        } else {
            desc.style.display = "block";
            chevron.style.transform = "rotate(180deg)";
        }
    });
    
    card.addEventListener("click", () => {
        openDetailModal(m);
        const overlay = document.getElementById("premium-search-overlay");
        if (overlay) {
            overlay.classList.remove("active");
            document.body.style.overflow = "";
        }
    });

    return card;
}

function triggerFloatingCoinsAnimation(sourceElement) {
    if (!sourceElement) return;
    
    // Find target points display element
    let target = document.getElementById("rewards-points-display");
    if (!target || target.getBoundingClientRect().width === 0) {
        target = document.getElementById("stat-profile-points-drawer");
    }
    if (!target || target.getBoundingClientRect().width === 0) {
        target = document.getElementById("profile-loyalty-points");
    }
    
    const sourceRect = sourceElement.getBoundingClientRect();
    
    let targetX, targetY;
    if (target && target.getBoundingClientRect().width > 0) {
        const targetRect = target.getBoundingClientRect();
        targetX = targetRect.left + targetRect.width / 2 - 8;
        targetY = targetRect.top + targetRect.height / 2 - 8;
    } else {
        // Fallback to top right
        targetX = window.innerWidth - 60;
        targetY = 40;
    }
    
    const startX = sourceRect.left + sourceRect.width / 2 - 8;
    const startY = sourceRect.top + sourceRect.height / 2 - 8;
    
    const coinCount = 10;
    
    for (let i = 0; i < coinCount; i++) {
        setTimeout(() => {
            const coin = document.createElement("div");
            coin.className = "floating-coin";
            
            // Random arching paths
            const midX = (startX + targetX) / 2 + (Math.random() - 0.5) * 160;
            const midY = Math.min(startY, targetY) - 80 - Math.random() * 80;
            
            coin.style.setProperty("--start-x", `${startX}px`);
            coin.style.setProperty("--start-y", `${startY}px`);
            coin.style.setProperty("--mid-x", `${midX}px`);
            coin.style.setProperty("--mid-y", `${midY}px`);
            coin.style.setProperty("--end-x", `${targetX}px`);
            coin.style.setProperty("--end-y", `${targetY}px`);
            
            document.body.appendChild(coin);
            
            setTimeout(() => {
                if (target) {
                    target.classList.remove("pulse-bounce");
                    void target.offsetWidth; // force reflow
                    target.classList.add("pulse-bounce");
                }
                coin.remove();
            }, 850);
        }, i * 75);
    }
}

