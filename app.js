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
if (typeof firebase !== "undefined") {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
    } catch (e) {
        console.error("Firebase initialization failed:", e);
    }
}

// TMDB Configuration & Constants
// TMDB API Key retrieval function (prevents hardcoded secrets in source code files)
function getTmdbApiKey() {
    const userKey = localStorage.getItem("filmhouse_tmdb_key");
    if (userKey) return userKey;
    // Log a warning regarding demo key usage for horizontal scaling and security
    console.warn("Using fallback demo TMDB API key. Please set your own key in Profile settings!");
    return "d638f7775bfa1b8d456dfd028ccbef19";
}
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
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
            downloadsClaimed: false
        }
    },
    isTelegram: false,
    filters: {
        genre: "All",
        genre2: "All",
        rating: 0,
        year: "All"
    },
    carouselIndex: 0,
    carouselInterval: null,
    adsgramControllers: {},
    activeWatchlistTab: "watchlist",
    externalSearchResults: [],
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

        enrichedList.push({
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
        });

        // Small spacing delay between fetch calls to avoid API lockups
        await delay(60);
    }

    state.newMovieIds = enrichedList.slice(0, 10).map(m => m.csv_id);
    state.movies = shuffleAndPinNewMovies(enrichedList);
    localStorage.setItem("filmhouse_enriched_db_v5", JSON.stringify(enrichedList));
    statusEl.textContent = "Complete!";
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
            state.user.username = tgUser.username || state.user.username;
            state.user.fullName = [tgUser.first_name, tgUser.last_name].filter(n => n).join(" ") || state.user.fullName;
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
    if (headerName) headerName.textContent = state.user.username;
    if (profileAvatarImg) profileAvatarImg.src = state.user.avatar;
    if (profileFullName) profileFullName.textContent = state.user.fullName;
    if (profileTelegramTag) profileTelegramTag.textContent = `@${state.user.username}`;
    if (profileTelegramId) profileTelegramId.textContent = `ID: ${state.user.id}`;
}
// User Profile Management & Loaders
function loadUserProfile() {
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
    state.user.points = profile.points || 0;
    state.user.badge = profile.badge || null;
    state.user.badgeExpiresAt = profile.badgeExpiresAt || 0;
    state.user.farmingStartedAt = profile.farmingStartedAt || 0;
    state.user.checkInStreak = profile.checkInStreak || 0;
    state.user.lastCheckInDate = profile.lastCheckInDate || "";
    state.user.pointsBreakdown = profile.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 };
    state.user.dailyStats = profile.dailyStats || {
        date: new Date().toISOString().split("T")[0],
        checkInClaimed: false,
        sharesCount: 0,
        shareClaimed: false,
        adWatchesCount: 0,
        adWatchesClaimed: false,
        downloadsCount: 0,
        downloadsClaimed: false
    };
    checkAndResetDailyMissions();
    
    if (profile.avatar) {
        const isStoredDefault = !profile.avatar.startsWith("data:") && !profile.avatar.startsWith("http");
        const hasTelegramPhoto = state.user.avatar && state.user.avatar.startsWith("http");
        if (!hasTelegramPhoto || !isStoredDefault) {
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
    if (displayUsername) displayUsername.textContent = state.user.username ? `@${state.user.username}` : "@guest";

    const pageAvatar = document.getElementById("profile-page-avatar");
    if (pageAvatar) pageAvatar.src = state.user.avatar;

    const pageTgTag = document.getElementById("profile-page-telegram-tag");
    if (pageTgTag) pageTgTag.value = state.user.username ? `@${state.user.username}` : "@guest";

    const pageTgId = document.getElementById("profile-page-telegram-id");
    if (pageTgId) pageTgId.value = state.user.id;

    const pageContactPref = document.getElementById("profile-page-contact-pref");
    if (pageContactPref) pageContactPref.value = state.user.contactPreference;

    // Sync all header/avatar images
    const headerAvatar = document.getElementById("header-user-avatar");
    if (headerAvatar) headerAvatar.src = state.user.avatar;

    const headerName = document.getElementById("header-user-name");
    if (headerName) headerName.textContent = state.user.username;

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
        if (typeof firebase !== "undefined" && db) {
            db.collection("users").where("points", ">", state.user.points || 0).get().then(snap => {
                const rank = snap.size + 1;
                db.collection("users").get().then(totalSnap => {
                    profileRankLabel.textContent = `Global Ranking: #${rank} of ${totalSnap.size}`;
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

function renderLeaderboard() {
    const userRankCard = document.getElementById("leaderboard-user-rank-card");
    const rowsContainer = document.getElementById("leaderboard-rows-container");
    if (!userRankCard || !rowsContainer) return;
    
    // Clear containers and show loading state
    userRankCard.innerHTML = `<div style="padding: 10px; text-align: center; color: var(--text-secondary); width: 100%;">Loading ranking...</div>`;
    rowsContainer.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-secondary);">Loading global leaderboard...</div>`;
    
    const badgePrefix = window.location.pathname.includes("/MOVIE/") ? "" : "MOVIE/";
    
    // If Firebase is available, load live leaderboard
    if (typeof firebase !== "undefined" && db) {
        db.collection("users").orderBy("points", "desc").limit(40).get().then(async (snapshot) => {
            const list = [];
            const seenIds = new Set();
            const seenUsernames = new Set();
            const seenFullNames = new Set();
            
            snapshot.forEach(doc => {
                const u = doc.data();
                
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
                
                // Limit output to top 25 unique users
                if (list.length >= 25) return;
                
                list.push({
                    username: u.username || "guest",
                    fullName: u.fullName || "Guest Collector",
                    points: u.points || 0,
                    avatar: u.avatar || (badgePrefix + "img/FilmHouse3_nobg.png"),
                    badge: getAchievementBadge(u.points || 0, u.badge),
                    isCurrentUser: isMe
                });
            });
            
            // If current user is not in top 25, get their rank
            let userRank = 1;
            try {
                const rankSnapshot = await db.collection("users").where("points", ">", state.user.points || 0).get();
                userRank = rankSnapshot.size + 1;
            } catch (e) {
                console.error("Error fetching user rank:", e);
                const index = list.findIndex(item => item.isCurrentUser);
                userRank = index !== -1 ? index + 1 : list.length + 1;
            }
            
            displayLeaderboardData(list, userRank);
        }).catch(err => {
            console.warn("Failed to load live leaderboard, falling back to demo data:", err);
            renderStaticLeaderboard();
        });
    } else {
        renderStaticLeaderboard();
    }
    
    function renderStaticLeaderboard() {
        const list = getDynamicLeaderboard();
        const userRank = calculateUserRank();
        displayLeaderboardData(list, userRank);
    }
    
    function displayLeaderboardData(list, userRank) {
        userRankCard.replaceChildren();
        rowsContainer.replaceChildren();
        
        const userAvatarPath = state.user.avatar || (badgePrefix + "img/FilmHouse3_nobg.png");
        const userCardHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <img src="${userAvatarPath}" alt="Your Avatar" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid #f5c518;" onerror="this.src='${badgePrefix}img/FilmHouse3_nobg.png'">
                <div>
                    <h4 style="font-size: 13px; font-weight: 700; margin: 0; color: var(--text-primary);">You (${escapeHTML(state.user.fullName)})</h4>
                    <span class="leaderboard-badge">${escapeHTML(getAchievementBadge(state.user.points || 0, state.user.badge))}</span>
                </div>
            </div>
            <div style="text-align: right;">
                <span style="font-size: 16px; font-weight: 800; color: #f5c518; display: block; line-height: 1;">#${userRank}</span>
                <span style="font-size: 10px; color: var(--text-secondary); font-weight: 500;">Rank | ${state.user.points || 0} pts</span>
            </div>
        `;
        userRankCard.innerHTML = userCardHTML;
        
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
        "Classic Movies", "Erotic Movies"
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
        "Erotic Movies": "Romance / Erotic"
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
        "Main", "Hollywood/British Movies", "Hollywood/British Series", 
        "Bollywood", "Korean Drama", "African", "Anime", "Comic", 
        "Animated Movies", "Kids Shows and Movies (Nickelodeon and Disney)", 
        "Classic Movies", "Erotic Movies"
    ];

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
        "Erotic Movies": "Erotic"
    };

    const categoryIcons = {
        "Main": `<svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" fill="currentColor"/></svg>`, // Home icon
        "Hollywood/British Movies": `<svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4zm2 14H4V8h16v10z" fill="currentColor"/></svg>`, // clapperboard
        "Hollywood/British Series": `<svg viewBox="0 0 24 24"><path d="M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 14H3V8h18v12z" fill="currentColor"/></svg>`, // TV
        "Bollywood": `<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" fill="currentColor"/></svg>`, // Music note (bollywood standard)
        "Korean Drama": `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/></svg>`, // Heart
        "African": `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/></svg>`, // Globe outline
        "Anime": `<svg viewBox="0 0 24 24"><path d="M12 2c-5.52 0-10 4.48-10 10s4.48 10 10 10 10-4.48 10-10-4.48-10-10-10zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-3.5-6c.83 1.43 2.45 2.5 4.5 2.5s3.67-1.07 4.5-2.5h-9z" fill="currentColor"/></svg>`, // Smiley/Cartoon face
        "Comic": `<svg viewBox="0 0 24 24"><path d="M21 5c-1.11-.9-3.13-1.86-5-2-1.92-.14-4 .6-5 1.5C10 3.6 7.92 2.86 6 3c-1.87.14-3.89 1.1-5 2v14c0 1.1.9 2 2 2h4c1.78 0 3.61.85 5 1.5 1.39-.65 3.22-1.5 5-1.5h4c1.1 0 2-.9 2-2V5zm-2 13h-3c-1.38 0-2.61.57-3.5 1.5V6c.9-.9 2.12-1.5 3.5-1.5h3v13.5z" fill="currentColor"/></svg>`, // Book
        "Animated Movies": `<svg viewBox="0 0 24 24"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.5c-1.34 1.9-3.53 3-5 3s-3.66-1.1-5-3h10z" fill="currentColor"/></svg>`, // Winking smiley
        "Kids Shows and Movies (Nickelodeon and Disney)": `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" fill="currentColor"/></svg>`, // Teddy/Toy Plus
        "Classic Movies": `<svg viewBox="0 0 24 24"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v3c0 2.44 1.72 4.48 4 4.9V19H5v2h14v-2h-2v-4.1c2.28-.42 4-2.46 4-4.9V7c0-1.1-.9-2-2-2zM5 10V7h2v3H5zm14 0h-2V7h2v3z" fill="currentColor"/></svg>`, // Trophy
        "Erotic Movies": `<svg viewBox="0 0 24 24"><path d="M12.01 21.49L12 21.5c-4.42 0-8-3.58-8-8 0-3.32 2.01-6.17 4.9-7.39l.71-.3 1.41 1.42c-.22.61-.3 1.25-.21 1.89l.1 1.01h1.01c1.38 0 2.63.56 3.54 1.47l.7.71.3.71c1.22 2.89.37 6.3-2.06 8.35-.91.77-2.09 1.18-3.3 1.18zM6 13.5c0 3.31 2.69 6 6 6s6-2.69 6-6c0-.98-.24-1.92-.68-2.76-.55-.38-1.22-.59-1.92-.59h-.94l.21.93c.18.82.02 1.66-.45 2.37l-.54.81-.81.54c-.71.47-1.55.63-2.37.45L8 14.54v.94c0 .7-.21 1.37-.59 1.92-.41-.53-.61-1.17-.61-1.82 0-1.66 1.34-3 3-3V11c-3.31 0-6 2.69-6 6z" fill="currentColor"/></svg>` // Fire
    };

    categoryList.forEach(cat => {
        const button = document.createElement("button");
        button.className = `category-pill ${state.activeCategory === cat ? 'active' : ''}`;
        button.title = categoryLabels[cat] || cat;

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

    const genres = ["All", "Action", "Adventure", "Comedy", "Drama", "Sci-Fi", "Horror", "Thriller", "Romance", "Mystery", "Animation", "Family"];
    
    genres.forEach(genre => {
        const chip = document.createElement("div");
        chip.className = `genre-chip ${state.filters.genre === genre ? "active" : ""}`;
        chip.textContent = genre;
        
        chip.addEventListener("click", () => {
            state.filters.genre = genre;
            state.visibleCount = 24;
            // Sync with filter select element if present
            const genreSelect = document.getElementById("filter-genre");
            if (genreSelect) {
                genreSelect.value = genre;
            }
            
            // Re-render chips to update active styling
            document.querySelectorAll(".genre-chip").forEach(c => {
                if (c.textContent === genre) {
                    c.classList.add("active");
                } else {
                    c.classList.remove("active");
                }
            });
            
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
                "Erotic Movies": "Erotic"
            };
            heading.textContent = categoryLabels[state.activeCategory] || state.activeCategory;
        }
    }

    state.lastDiscoverQuery = null;

    // Filter by active category (or search globally if search term is active)
    let list = state.movies;
    if (!state.searchQuery) {
        list = list.filter(m => m.categories.includes(state.activeCategory));
    }

    // Apply Search Term
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        list = list.filter(m => 
            (m.title && m.title.toLowerCase().includes(query)) ||
            (m.overview && m.overview.toLowerCase().includes(query)) ||
            (m.genres && m.genres.some(g => g && g.toLowerCase().includes(query))) ||
            (m.cast && m.cast.some(c => c && c.toLowerCase().includes(query))) ||
            (m.director && m.director.toLowerCase().includes(query)) ||
            (m.type && m.type.toLowerCase().includes(query)) ||
            (m.categories && m.categories.some(c => c && c.toLowerCase().includes(query)))
        );

        if (state.externalSearchResults && state.externalSearchResults.length > 0) {
            const localTmdbIds = new Set(list.map(m => m.tmdb_id).filter(id => id));
            const filteredExternal = state.externalSearchResults.filter(ext => !localTmdbIds.has(ext.tmdb_id));
            list = [...list, ...filteredExternal];
        }
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

    // Merge external discover results if filters are active and search query is empty
    if (filtersActive && !state.searchQuery && state.activeCategory === "Main" && state.externalSearchResults && state.externalSearchResults.length > 0) {
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
        text.textContent = "No movies match your filters/criteria.";
        text.style.color = "var(--text-secondary)";
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

    const filtersActive = state.filters.genre !== "All" || state.filters.genre2 !== "All" || state.filters.rating > 0 || state.filters.year !== "All";
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
    
    const posterImg = document.createElement("img");
    posterImg.src = movie.poster;
    posterImg.alt = movie.title;
    posterCard.appendChild(posterImg);
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
            // Add to history
            addWatchHistory(movie);
            
            // Award points (+5)
            awardPoints(5, "watched");
            
            // Update UI
            watchedBtn.className = "btn btn-secondary";
            watchedText.textContent = "Watched";
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
        const requestBtn = document.createElement("a");
        requestBtn.className = "btn btn-request-premium";
        requestBtn.href = "https://t.me/+09ahNmGdB1U2MzFk";
        requestBtn.target = "_blank";
        requestBtn.rel = "noopener noreferrer";
        requestBtn.style.textDecoration = "none";
        
        requestBtn.appendChild(createSvgIcon("icon-share"));
        
        const rText = document.createElement("span");
        rText.textContent = movie.type === "Series" ? "Request Series" : "Request Movie";
        requestBtn.appendChild(rText);

        requestBtn.addEventListener("click", (e) => {
            e.preventDefault();
            logMovieRequestToFirestore(movie);
            showConnectionDrawer("https://t.me/+09ahNmGdB1U2MzFk", ADSGRAM_REQUEST_BLOCK_ID);
        });
        
        actionsRow.appendChild(requestBtn);
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

    // Refresh recommendations list dynamically
    renderEditorsChoice();
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

// Open Download Modal listing links
function openDownloadModal(movie) {
    const modal = document.getElementById("download-modal");
    const title = document.getElementById("download-modal-movie-title");
    const grid = document.getElementById("download-links-grid");
    const modalHeading = modal ? modal.querySelector(".download-modal-content > h2") : null;
    const sectionHeading = modal ? modal.querySelector(".download-options-section h3") : null;
    
    if (!modal || !title || !grid) return;

    const isTVShow = movie.type === "Series";
    title.textContent = movie.title;
    grid.replaceChildren();

    // Update modal heading and section heading based on type
    if (modalHeading) {
        modalHeading.textContent = isTVShow ? "Download Series" : "Download Movie";
    }
    if (sectionHeading) {
        sectionHeading.textContent = isTVShow ? "Available Seasons" : "Available Quality";
    }

    // Quality labels for movies
    const qualityLabels = ["720p", "1080p", "4K UHD", "480p", "WEBDL", "BluRay"];
    const qualityIcons = ["🎬", "🎥", "✨", "📱", "🌐", "💿"];

    if (!movie.links || movie.links.length === 0) {
        const fallbackMsg = document.createElement("div");
        fallbackMsg.className = "download-empty-state";
        fallbackMsg.innerHTML = `
            <svg style="width:40px;height:40px;color:var(--text-muted);margin-bottom:10px;"><use href="#icon-download"></use></svg>
            <p style="color:var(--text-muted);font-size:13px;">No links available for this title yet.</p>
            <p style="color:var(--text-secondary);font-size:11px;margin-top:4px;">Check back soon!</p>
        `;
        fallbackMsg.style.cssText = "display:flex;flex-direction:column;align-items:center;padding:24px 0;";
        grid.appendChild(fallbackMsg);
    } else {
        movie.links.forEach((link, idx) => {
            const anchor = document.createElement("div");
            anchor.className = "download-link-item";

            const linkUrl = typeof link === 'object' && link !== null ? link.url : link;
            
            const matchingRequest = currentUserRequests && currentUserRequests.find(r => 
                r.title && r.title.toLowerCase().trim() === movie.title.toLowerCase().trim() &&
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
                const seasonNum = idx + 1;
                const badge = document.createElement("span");
                badge.className = "download-link-badge season-badge";
                badge.textContent = `S${seasonNum}`;
                anchor.appendChild(badge);

                const labelWrap = document.createElement("div");
                labelWrap.className = "download-link-label-wrap";
                const label = document.createElement("span");
                label.className = "download-link-label";
                label.textContent = `Season ${seasonNum}`;
                const sublabel = document.createElement("span");
                sublabel.className = "download-link-sublabel";
                if (matchingRequest) {
                    sublabel.textContent = "Unlock Season • Free Fulfillment (No Ads)";
                } else {
                    sublabel.textContent = "Unlock & Download Season • Ad";
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

        searchInput.addEventListener("input", (e) => {
            const query = e.target.value;
            state.searchQuery = query;
            state.visibleCount = 24;
            if (clearBtn) {
                clearBtn.style.display = query ? "flex" : "none";
            }
            
            renderAutocomplete(query);

            if (query.trim().length < 3) {
                state.externalSearchResults = [];
                renderFeaturedGrid();
            } else {
                renderFeaturedGrid();
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
    const inviteShareUrl = "https://t.me/Filmhouseappbot/filmhouseapp";
    const fullInviteMessage = `${inviteShareText}\nPlay now: ${inviteShareUrl}`;
    
    if (optWhatsapp) {
        optWhatsapp.addEventListener("click", () => {
            const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(fullInviteMessage)}`;
            window.open(whatsappUrl, "_blank");
            if (typeof awardPoints === "function") {
                awardPoints(5, "share");
            }
            if (shareModal) shareModal.classList.remove("active");
        });
    }
    
    if (optTelegram) {
        optTelegram.addEventListener("click", () => {
            const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteShareUrl)}&text=${encodeURIComponent(inviteShareText)}`;
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
            if (typeof awardPoints === "function") {
                awardPoints(5, "share");
            }
            if (shareModal) shareModal.classList.remove("active");
        });
    }
    
    if (optTwitter) {
        optTwitter.addEventListener("click", () => {
            const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(fullInviteMessage)}`;
            window.open(twitterUrl, "_blank");
            if (typeof awardPoints === "function") {
                awardPoints(5, "share");
            }
            if (shareModal) shareModal.classList.remove("active");
        });
    }
    
    if (optCopy) {
        optCopy.addEventListener("click", () => {
            if (typeof copyToClipboard === "function") {
                copyToClipboard(fullInviteMessage);
            }
            if (typeof awardPoints === "function") {
                awardPoints(5, "share");
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
                    if (docData.farmingStartedAt !== undefined) {
                        state.user.farmingStartedAt = docData.farmingStartedAt;
                        data.farmingStartedAt = docData.farmingStartedAt;
                        const saved = localStorage.getItem("filmhouse_user_profile");
                        if (saved) {
                            try {
                                const profile = JSON.parse(saved);
                                profile.farmingStartedAt = docData.farmingStartedAt;
                                localStorage.setItem("filmhouse_user_profile", JSON.stringify(profile));
                            } catch (e) {}
                        }
                    }
                    if (docData.checkInStreak !== undefined) {
                        state.user.checkInStreak = docData.checkInStreak;
                        data.checkInStreak = docData.checkInStreak;
                    }
                    if (docData.lastCheckInDate !== undefined) {
                        state.user.lastCheckInDate = docData.lastCheckInDate;
                        data.lastCheckInDate = docData.lastCheckInDate;
                    }
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
            currentUserRequests = requests;
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
        const matchingMovie = state.movies.find(m => 
            (m.title && m.title.toLowerCase() === r.title.toLowerCase()) || 
            (m.csv_id && r.csv_id && m.csv_id.toLowerCase() === r.csv_id.toLowerCase())
        );
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
                        <h5 style="margin: 0 0 2px 0; font-size: 13px; font-weight: 700; color: #fff; font-family: var(--font-heading);">${escapeHTML(r.title)}</h5>
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
                    
                    showToast("Claimed! Direct links have been sent to your Telegram DM. 🍿", "success");
                    
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
                        <h5 style="margin: 0 0 2px 0; font-size: 11px; font-weight: 600; color: var(--text-secondary);">${escapeHTML(r.title)}</h5>
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
            (m.title && m.title.toLowerCase() === r.title.toLowerCase()) || 
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
                    (m.title && m.title.toLowerCase() === r.title.toLowerCase()) || 
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

function logMovieRequestToFirestore(movie) {
    if (typeof firebase === "undefined" || !db) return;
    db.collection("requests").add({
        title: movie.title || "Unknown Title",
        tmdb_id: movie.tmdb_id || null,
        csv_id: movie.csv_id || "",
        type: movie.type || "Movie",
        requestedBy: state.user.username || "guest",
        requestedById: state.user.id || "",
        requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then((docRef) => {
        const docId = docRef.id;
        showToast("Movie request registered in database!", "success");
        
        // Automated Telegram confirmation message to the requesting user
        if (state.user.id) {
            db.collection("settings").doc("telegram").get().then(tgDoc => {
                if (tgDoc.exists) {
                    const token = tgDoc.data().botToken;
                    if (token) {
                        const canBoost = parseInt(state.user.points || 0) >= 1000;
                        const text = canBoost 
                            ? `🍿 *Request Received!*\n\nYour request for *${movie.title}* (${movie.type}) has been logged in our queue.\n\n💡 *Boost Available!* You can boost this request to *High Priority* for 1,000 points to get it faster! 🚀`
                            : `🍿 *Request Received!*\n\nYour request for *${movie.title}* (${movie.type}) has been logged in our queue.\n\nWe will notify you here as soon as it is fulfilled! 🚀`;

                        const postBody = {
                            chat_id: String(state.user.id),
                            text: text,
                            parse_mode: "Markdown"
                        };

                        if (canBoost) {
                            postBody.reply_markup = {
                                inline_keyboard: [
                                    [
                                        {
                                            text: "Boost Request 🚀 (1,000 pts)",
                                            url: `https://t.me/Filmhouseappbot/filmhouseapp?startapp=boost_${docId}`
                                        }
                                    ]
                                ]
                            };
                        }

                        fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(postBody)
                        }).catch(err => console.warn("Failed to send bot notification for request:", err));
                    }
                }
            }).catch(err => console.warn("Error fetching bot token for request notification:", err));
        }
    }).catch(err => {
        console.error("Error logging movie request:", err);
    });
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
            downloadsClaimed: false
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
    if (actionType === "share") {
        stats.sharesCount = (stats.sharesCount || 0) + count;
    } else if (actionType === "ad") {
        stats.adWatchesCount = (stats.adWatchesCount || 0) + count;
    } else if (actionType === "download") {
        stats.downloadsCount = (stats.downloadsCount || 0) + count;
    }
    saveDailyStats();
    renderDailyMissions();
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
    
    // Check ban status on startup
    if (typeof firebase !== "undefined" && db && state.user.id) {
        db.collection("users").doc(state.user.id).get().then(doc => {
            if (doc.exists && doc.data().banned === true) {
                showBannedScreen();
            }
        }).catch(err => console.warn("Error checking ban status:", err));
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
            .limit(10)
            .get()
            .then(snapshot => {
                list.innerHTML = "";
                let rank = 1;
                
                snapshot.forEach(doc => {
                    const u = doc.data();
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
        }, 2500);
    }
    } catch (err) {
        console.error("Critical initialization error:", err);
        const loader = document.getElementById("preloader");
        if (loader) {
            loader.classList.add("fade-out");
        }
        try {
            showToast("Initialization warning: some features may be loaded offline.", "info");
        } catch (e) {}
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
            
            dayBox.addEventListener("click", () => {
                claimStreakReward(d, reward);
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

function claimStreakReward(dayNum, rewardAmount) {
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
    awardPoints(rewardAmount, "visit");
    saveProfileToLocalStorage();
    syncUserToFirestore();
    
    renderStreakCalendar();
    renderDailyMissions();
    
    showToast(`Day ${dayNum} check-in claimed! +${rewardAmount} points awarded! 🗓️`, "success");
}

function saveProfileToLocalStorage() {
    const saved = localStorage.getItem("filmhouse_user_profile");
    let profile = {};
    if (saved) {
        try { profile = JSON.parse(saved); } catch (e) {}
    }
    profile.checkInStreak = state.user.checkInStreak;
    profile.lastCheckInDate = state.user.lastCheckInDate;
    profile.points = state.user.points;
    profile.pointsBreakdown = state.user.pointsBreakdown;
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
    rewardValue.textContent = "+10 Points 🪙";
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
        showToast("Bonus task completed! +10 Points awarded! 🏆", "success");
        awardPoints(10, "task");
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
