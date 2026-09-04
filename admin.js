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

// Bind Live Snapshot Listeners
if (db) {
    // 1. Real-time Users Listener (without query sorting to prevent Firestore from excluding documents missing 'lastSeen')
    db.collection("users").onSnapshot(snapshot => {
        allUsers = [];
        snapshot.forEach(doc => {
            const u = doc.data();
            u.id = u.id || doc.id;
            allUsers.push(u);
        });
        
        // Sort locally by lastSeen (descending) safely
        allUsers.sort((a, b) => {
            const timeA = a.lastSeen ? (a.lastSeen.toMillis ? a.lastSeen.toMillis() : new Date(a.lastSeen).getTime()) : 0;
            const timeB = b.lastSeen ? (b.lastSeen.toMillis ? b.lastSeen.toMillis() : new Date(b.lastSeen).getTime()) : 0;
            return timeB - timeA;
        });
        db.collection("settings").doc("admins").get().then(adminDoc => {
            const adminIds = adminDoc.exists ? adminDoc.data().ids || [] : [];
            const defaultAdmins = ["1329840839", "1175336733"];
            adminIdsList = Array.from(new Set([...defaultAdmins, ...adminIds]));
            
            updateStatsCounters();
            renderUsersList();
            populateAllocatorDropdowns();
        }).catch(err => {
            console.warn("Admins list fetch fail:", err);
            updateStatsCounters();
            renderUsersList();
            populateAllocatorDropdowns();
        });
    }, err => {
        console.error("Users sync issue:", err);
    });

    // 2. Real-time Movie Requests Listener
    db.collection("requests").orderBy("requestedAt", "desc").onSnapshot(snapshot => {
        allRequests = [];
        snapshot.forEach(doc => {
            const req = doc.data();
            req.docId = doc.id;
            allRequests.push(req);
        });
        updateStatsCounters();
        renderRequestsList();
    }, err => {
        console.error("Requests sync issue:", err);
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
    const fulfilledReqCount = allRequests.filter(r => {
        const inCatalog = allCatalogMovies && allCatalogMovies.some(m => {
            const rId = String(r.tmdb_id || r.csv_id || '').split('-')[0].trim();
            const mId = String(m.tmdb_id || m.csv_id || '').split('-')[0].trim();
            if (rId && mId) {
                return rId === mId;
            }
            return m.title && m.title.toLowerCase().trim() === r.title.toLowerCase().trim();
        });
        return r.status === "fulfilled" || r.status === "claimed" || r.claimed === true || inCatalog;
    }).length;
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
                "Korean Drama": "Korean Drama (K-Drama) 🇰🇷",
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

        const joinedDateStr = u.joinedDate ? new Date(u.joinedDate.seconds * 1000).toLocaleDateString() : "Unknown";
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

// Render Requests List with Aggregation, Tab Filtering, and Sorting
function renderRequestsList() {
    const listContainer = document.getElementById("requests-list");
    if (!listContainer) return;

    listContainer.replaceChildren();

    const counts = {};
    const searchQuery = document.getElementById("requests-search") ? document.getElementById("requests-search").value.toLowerCase().trim() : "";
    allRequests.forEach(r => {
        const key = r.title.toLowerCase().trim();
        if (!counts[key]) {
            counts[key] = { 
                title: r.title, 
                type: r.type, 
                year: r.year || "",
                count: 0, 
                isPriority: false, 
                isFulfilled: true,
                docIds: [],
                requesters: [],
                requesterDetails: [],
                adminClaimId: null,
                adminClaimName: null
            };
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
            notificationStatus: r.notificationStatus || null,
            notificationError: r.notificationError || null,
            isBlockedUser: r.isBlockedUser || false
        });
        
        if (r.status === "priority") {
            counts[key].isPriority = true;
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
        
        const inCatalog = allCatalogMovies && allCatalogMovies.some(m => {
            const rId = String(r.tmdb_id || r.csv_id || '').split('-')[0].trim();
            const mId = String(m.tmdb_id || m.csv_id || '').split('-')[0].trim();
            if (rId && mId) {
                if (r.seasonOrPart) {
                    const cleanReqSeason = r.seasonOrPart.toLowerCase().trim();
                    return rId === mId && m.links && m.links.some(link => {
                        const sLabel = typeof link === 'object' && link !== null ? (link.season || link.quality || "") : "";
                        return sLabel.toLowerCase().trim() === cleanReqSeason;
                    });
                }
                return rId === mId;
            }
            
            const cleanReqTitle = r.title.toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "").trim();
            const cleanCatalogTitle = m.title.toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "").trim();
            if (cleanCatalogTitle !== cleanReqTitle) return false;
            if (r.seasonOrPart) {
                const cleanReqSeason = r.seasonOrPart.toLowerCase().trim();
                return m.links && m.links.some(link => {
                    const sLabel = typeof link === 'object' && link !== null ? (link.season || link.quality || "") : "";
                    const lUrl = typeof link === 'object' && link !== null ? link.url : link;
                    return sLabel.toLowerCase().trim() === cleanReqSeason && lUrl && String(lUrl).trim() !== "";
                });
            }
            return true;
        });
        const fulfilled = r.status === "fulfilled" || r.status === "claimed" || inCatalog;
        
        if (!fulfilled) {
            counts[key].isFulfilled = false;
        }
    });

    let filteredRequests = Object.values(counts)
        .filter(r => r.title.toLowerCase().includes(searchQuery));
    
    // Apply tab filter
    const fulfilledCount = filteredRequests.filter(r => r.isFulfilled).length;
    switch (requestFilterTab) {
        case "actionable":
            filteredRequests = filteredRequests.filter(r => !r.isFulfilled);
            break;
        case "priority":
            filteredRequests = filteredRequests.filter(r => r.isPriority);
            break;
        case "pending":
            filteredRequests = filteredRequests.filter(r => !r.isPriority && !r.isFulfilled);
            break;
        case "fulfilled":
            filteredRequests = filteredRequests.filter(r => r.isFulfilled);
            break;
        // "all" = no filter
    }
    
    // Sort: Priority first, then by request count descending
    filteredRequests.sort((a, b) => {
        if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
        return b.count - a.count;
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

        if (req.isPriority) {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(255, 59, 48, 0.15); border: 1px solid rgba(255, 59, 48, 0.3); color: #ff3b30; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🔥 High Priority</span>`;
        } else if (req.isFulfilled) {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🟢 Fulfilled</span>`;
        } else {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(255, 188, 0, 0.15); border: 1px solid rgba(255, 188, 0, 0.3); color: #ffbc00; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🟠 Pending</span>`;
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
            fulfillBtnMarkup = `
                <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Resolved</span>
            `;
        }

        const deleteBtnMarkup = isCurrentUserSlaveAdmin ? "" : `
            <button class="btn-delete-requests" style="background: rgba(255, 59, 48, 0.1); border: 1px solid rgba(255, 59, 48, 0.3); border-radius: 4px; padding: 6px 12px; color: #ff3b30; font-weight: 700; font-size: 11px; cursor: pointer; transition: background 0.2s;">
                Delete 🗑️
            </button>
        `;

        let detailsHtml = "";
        if (req.requesterDetails && req.requesterDetails.length > 0) {
            req.requesterDetails.forEach(detail => {
                let statusBadge = "";
                if (detail.status === "fulfilled" || detail.status === "claimed") {
                    if (detail.notificationStatus === "delivered") {
                        statusBadge = `<span style="color: #4caf50; font-weight: bold; background: rgba(76, 175, 80, 0.1); padding: 1px 6px; border-radius: 4px;">🟢 Delivered</span>`;
                    } else if (detail.notificationStatus === "failed") {
                        const errMsg = detail.notificationError || "Unknown error";
                        statusBadge = `<span style="color: #ff3b30; font-weight: bold; background: rgba(255, 59, 48, 0.1); padding: 1px 6px; border-radius: 4px;" title="${escapeHTML(errMsg)}">🔴 Failed</span>`;
                    } else {
                        statusBadge = `<span style="color: #ffbc00; font-weight: bold; background: rgba(255, 188, 0, 0.1); padding: 1px 6px; border-radius: 4px;">⚪ Pending Send</span>`;
                    }
                } else if (detail.status === "priority") {
                    statusBadge = `<span style="color: #ff3b30; font-weight: bold; background: rgba(255, 59, 48, 0.1); padding: 1px 6px; border-radius: 4px;">🔥 Priority</span>`;
                } else {
                    statusBadge = `<span style="color: #ffbc00; font-weight: bold; background: rgba(255, 188, 0, 0.1); padding: 1px 6px; border-radius: 4px;">🟠 Pending</span>`;
                }
                
                detailsHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px; padding: 4px 6px; background: rgba(255,255,255,0.01); border-radius: 4px;">
                        <span>👤 @${escapeHTML(detail.username)} (ID: <code>${escapeHTML(detail.userId)}</code>)</span>
                        <span>${statusBadge}</span>
                    </div>
                `;
            });
        }

        const toggleId = `toggle-${req.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${req.docIds[0]}`;

        row.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div class="user-details" style="flex: 1;">
                    <h5 style="margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                        ${escapeHTML(req.title)}${req.year ? ` (${req.year})` : ""}
                        ${badgeMarkup}
                        ${claimBadgeMarkup}
                    </h5>
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
                fulfillMovieTitleRequests(req.title, req.docIds);
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

function fulfillMovieTitleRequests(title, docIds) {
    if (typeof firebase === "undefined" || !db) return;
    
    // Check if already claimed by another admin
    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    const currentAdminId = String(tgUser ? tgUser.id : (new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || "test-admin"));
    const currentAdminName = tgUser ? (tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name || 'Admin'}`) : "Admin";

    // Query Firestore for these request documents to check for active claims by other admins
    db.collection("requests").where("title", "==", title).get().then(snapshot => {
        let alreadyClaimed = false;
        let claimerName = "";

        snapshot.forEach(doc => {
            const data = doc.data();
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
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.status !== "fulfilled" && data.status !== "claimed") {
                batch.update(doc.ref, {
                    adminClaimId: currentAdminId,
                    adminClaimName: currentAdminName,
                    adminClaimTime: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;
            }
        });

        if (count > 0) {
            batch.commit().then(() => {
                const modal = document.getElementById("fulfill-request-modal");
                const titleEl = document.getElementById("fulfill-modal-title");
                
                if (!modal || !titleEl) return;
                
                currentFulfillTitle = title;
                currentFulfillDocIds = docIds;
                
                titleEl.textContent = `Fulfill Request: "${title}"`;
                
                const cleanTitle = title.replace(/\s*\([^)]+\)\s*$/g, "").trim().toLowerCase();
                const existingMovie = allCatalogMovies.find(m => m.title.toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "").trim() === cleanTitle);
                const matchedReq = allRequests.find(r => r.title.toLowerCase().trim() === title.toLowerCase().trim()) ||
                                   allRequests.find(r => docIds.includes(r.docId)) ||
                                   allRequests.find(r => r.title.toLowerCase().trim().startsWith(cleanTitle));
                const isSeries = matchedReq ? (matchedReq.type.toLowerCase() === 'series' || matchedReq.type.toLowerCase() === 'tv') : (existingMovie ? (existingMovie.type || "").toLowerCase() === 'series' : false);
                
                let reqSpec = matchedReq ? (matchedReq.seasonOrPart || "") : "";
                if (!reqSpec && title) {
                    const qMatch = title.match(/\(([^)]+)\)$/);
                    if (qMatch) {
                        reqSpec = qMatch[1].trim();
                    }
                }
                renderFulfillLinksInputs(existingMovie, isSeries, reqSpec);
                modal.classList.add("active");
            }).catch(err => {
                console.error("Error setting claim lock batch:", err);
                showToast("Failed to lock request for processing.", "error");
            });
        } else {
            // Already fulfilled
            showToast("This request has already been resolved.", "info");
        }
    }).catch(err => {
        console.error("Error checking claim lock status:", err);
        showToast("Error checking request status.", "error");
    });
}

function releaseClaimLock(title) {
    if (typeof firebase === "undefined" || !db || !title) return;
    
    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    const currentAdminId = String(tgUser ? tgUser.id : (new URLSearchParams(window.location.search).get("tg_id") || new URLSearchParams(window.location.search).get("admin_id") || "test-admin"));
    
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

    const masterInput = document.getElementById("admin-master-tg-ids");
    if (masterInput) {
        masterInput.value = masters.join(", ");
    }
    const slaveInput = document.getElementById("admin-slave-tg-ids");
    if (slaveInput) {
        slaveInput.value = slaves.join(", ");
    }

    // Context & Bypass checks
    const isLocal = window.location.hostname === "localhost" || 
                    window.location.hostname === "127.0.0.1" || 
                    window.location.protocol === "file:";

    const urlParams = new URLSearchParams(window.location.search);
    const queryTgId = urlParams.get("tg_id") || urlParams.get("admin_id");

    const tgUser = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initDataUnsafe?.user : null;
    const currentTgId = tgUser ? String(tgUser.id) : (queryTgId ? String(queryTgId).trim() : null);

    const idBox = document.getElementById("your-tg-id-box");
    if (idBox) {
        idBox.textContent = currentTgId ? `Your Telegram User ID: ${currentTgId}` : "Not running inside Telegram WebApp";
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

        const testMsg = `🤖 *Film House Bot Diagnostic*\n\nConnection successful! This bot is correctly configured and ready to broadcast and notify users. 🚀`;

        try {
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    chat_id: testChatId.trim(),
                    text: testMsg,
                    parse_mode: "Markdown"
                })
            });

            const result = await response.json();
            if (response.ok && result.ok) {
                showToast("Success! Check your bot chat for the diagnostic test message. 💌", "success");
            } else {
                console.error("Telegram API Error response:", result);
                showToast(`Failed: ${result.description || "Unknown error"}. Start chat with bot first!`, "error");
            }
        } catch (err) {
            console.error("Telegram connection error:", err);
            showToast(`Network error testing Telegram Bot: ${err.message}`, "error");
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

function showMovieDetails(movie) {
    const detailsBody = document.getElementById("details-modal-body");
    if (!detailsBody || !movieDetailsModal) return;
    
    const badgeColor = (movie.type || "").toLowerCase() === 'series' || (movie.type || "").toLowerCase() === 'tv' ? 'var(--primary-color)' : '#00bcd4';
    const posterUrl = getPosterUrl(movie.poster);
    const linksList = movie.links || [];

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
            <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
                <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">Categories</label>
                <div id="edit-movie-categories-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; max-height: 110px; overflow-y: auto; box-sizing: border-box;">
                    ${[
                        { key: "Main", label: "Main (Home)" },
                        { key: "Hollywood/British Movies", label: "Hollywood Movies" },
                        { key: "Hollywood/British Series", label: "Hollywood Series" },
                        { key: "Bollywood", label: "Bollywood" },
                        { key: "Korean Drama", label: "Korean Drama" },
                        { key: "African", label: "African" },
                        { key: "Anime", label: "Anime" },
                        { key: "Comic", label: "Comic" },
                        { key: "Animated Movies", label: "Animated" },
                        { key: "Kids Shows and Movies (Nickelodeon and Disney)", label: "Kids" },
                        { key: "Classic Movies", label: "Classics" },
                        { key: "Erotic Movies", label: "Erotic" },
                        { key: "Teen/High-School", label: "Teen / High-School" },
                        { key: "Christian Movies", label: "Christian" }
                    ].map(cat => {
                        const checked = movie.categories && movie.categories.includes(cat.key) ? 'checked' : '';
                        return `
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; color: #fff;">
                                <input type="checkbox" class="edit-cat-checkbox" value="${cat.key}" ${checked}> ${cat.label}
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

        <div style="margin-bottom: 24px;">
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
                <div style="display: flex; justify-content: space-between; gap: 10px;">
                    <button class="btn btn-secondary btn-sm" id="btn-add-link-input" style="font-size: 11px; padding: 6px 10px; border-radius: 4px; cursor: pointer;">+ Add Link</button>
                    <button class="btn btn-primary btn-sm" id="btn-save-links-changes" style="font-size: 11px; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Save Changes</button>
                </div>
            </div>
        </div>

        <div style="display: flex; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 10px;">
            <button class="btn btn-secondary btn-block" id="btn-details-delete-movie" data-csv-id="${movie.csv_id}" style="border-color: rgba(255, 59, 48, 0.4); color: #ff3b30; background: rgba(255, 59, 48, 0.05); cursor: pointer; padding: 12px; font-weight: 600; transition: all 0.3s;">
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

    const editTypeSelect = document.getElementById("edit-movie-type");
    if (editTypeSelect) {
        editTypeSelect.addEventListener("change", () => {
            renderLinkInputs();
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
    
    movieDetailsModal.classList.add("active");
}

function renderCatalogList() {
    const listContainer = document.getElementById("catalog-list");
    if (!listContainer) return;

    listContainer.replaceChildren();

    const searchQuery = (document.getElementById("catalog-search-input")?.value || "").toLowerCase().trim();
    const filtered = allCatalogMovies.filter(m => {
        const title = (m.title || "").toLowerCase();
        const id = (m.csv_id || "").toLowerCase();
        const type = (m.type || "").toLowerCase();
        return title.includes(searchQuery) || id.includes(searchQuery) || type.includes(searchQuery);
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

        row.innerHTML = `
            <div class="user-info" style="pointer-events: none;">
                <img src="${escapeHTML(posterUrl)}" alt="Poster" class="user-avatar" style="border-radius: 4px; object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                <div class="user-details">
                    <h5>${escapeHTML(m.title)} ${diffBadge} ${cinemaCutBadge}</h5>
                    <p>ID: ${escapeHTML(m.csv_id)} | Type: <span style="text-transform: uppercase; font-weight: 600; color: ${badgeColor};">${escapeHTML(m.type)}</span></p>
                    <div class="breakdown-group">
                        <span class="breakdown-tag">🔗 Links: ${m.links ? m.links.length : 0}</span>
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
            // Save draft locally
            localStorage.setItem("filmhouse_unpublished_catalog", JSON.stringify({
                allCatalogMovies,
                newlyAddedIds,
                newlyUpdatedIds,
                newlyDeletedIds
            }));
        } else {
            publishBtn.style.display = "none";
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

    // 2. Korean (Korean Drama for Series, Korean Movies for Movies - live action only, never anime)
    const isKoreanCountry = data && ((data.origin_country && data.origin_country.includes("KR")) ||
                            (data.production_countries && data.production_countries.some(c => c.iso_3166_1 === "KR")));
    const koreanKeywords = ["korean", "kdrama", "squid game", "boys over flowers", "queen of tears", "all of us are dead", "glory", "vincenzo", "crash landing on you"];
    if (!isAnimeMatch && !isAnimation && (origLang === 'ko' || isKoreanCountry || koreanKeywords.some(k => titleLower.includes(k) || overviewLower.includes(k)))) {
        if (isSeries) {
            categories.push("Korean Drama");
        } else {
            categories.push("Korean Movies");
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
    const isRegional = categories.some(cat => ["Korean Drama", "Korean Movies", "Bollywood", "African", "Anime Series", "Anime Movies"].includes(cat));
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

// Automatically check matching checkboxes in the Add Movie modal
function autoCheckCategoriesUI(selectedCategories) {
    const checkboxes = document.querySelectorAll(".add-cat-checkbox");
    if (!checkboxes || checkboxes.length === 0) return;
    
    const catSet = new Set(selectedCategories || ["Main"]);
    catSet.add("Main"); // Always ensure Main is included
    
    checkboxes.forEach(cb => {
        // Keep Christian Movies checked ONLY if user manually checked it
        if (cb.value === "Christian Movies") {
            return;
        }
        cb.checked = catSet.has(cb.value);
    });
}

let autoCategoryFetchController = null;

// Real-time metadata fetch to automatically check categories in UI
async function autoFetchAndCheckCategories(rawId, mediaType, fallbackTitle) {
    if (!rawId) return;
    const numericId = String(rawId).trim().split("-")[0];
    if (!numericId || !/^\d+$/.test(numericId)) return;
    
    if (autoCategoryFetchController) {
        autoCategoryFetchController.abort();
    }
    autoCategoryFetchController = new AbortController();
    const signal = autoCategoryFetchController.signal;

    try {
        const type = (mediaType || "").toLowerCase();
        const isTv = (type === "tv" || type === "series");
        const tmdbType = isTv ? "tv" : "movie";
        let res = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${numericId}?api_key=${TMDB_API_KEY}`, { signal });
        let data = null;
        let finalType = isTv ? "Series" : "Movie";
        
        if (res.ok) {
            data = await res.json();
        } else {
            const fallbackType = isTv ? "movie" : "tv";
            const fallbackRes = await fetch(`https://api.themoviedb.org/3/${fallbackType}/${numericId}?api_key=${TMDB_API_KEY}`, { signal });
            if (fallbackRes.ok) {
                data = await fallbackRes.json();
                finalType = isTv ? "Movie" : "Series";
                const typeSelect = document.getElementById("movie-type");
                if (typeSelect) {
                    typeSelect.value = (finalType === "Series") ? "tv" : "movie";
                    typeSelect.dispatchEvent(new Event("change"));
                }
            }
        }
        
        if (data) {
            const title = data.title || data.name || fallbackTitle || "";
            const autoCats = determineAutoCategories(data, title, finalType);
            autoCheckCategoriesUI(autoCats);
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

const addMovieTypeSelect = document.getElementById("movie-type");
if (addMovieTypeSelect) {
    addMovieTypeSelect.addEventListener("change", () => {
        renderAddMovieLinks();
        const rawId = document.getElementById("movie-id")?.value.trim().split("-")[0];
        if (rawId && /^\d+$/.test(rawId)) {
            const currentTitle = document.getElementById("movie-title")?.value || "";
            autoFetchAndCheckCategories(rawId, addMovieTypeSelect.value, currentTitle);
        }
    });
}

// Modal Reset Logic for Add Movie Form
function resetAddMovieModalState() {
    addMovieLinksState = [{ url: "", quality: "720p" }];
    renderAddMovieLinks();

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
            const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
            const response = await fetch(searchUrl);
            if (!response.ok) throw new Error("Search failed");
            
            const data = await response.json();
            const filteredResults = (data.results || []).filter(item => item.media_type === "movie" || item.media_type === "tv");
            
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
        
        // Get selected categories
        const checkedCategories = Array.from(document.querySelectorAll(".add-cat-checkbox:checked")).map(cb => cb.value);
        
        const isInitialSeries = (type.toLowerCase() === 'tv' || type.toLowerCase() === 'series');
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
            links: linksList
        };
        
        allCatalogMovies.unshift(newMovie);
        newlyAddedIds.push(id); // Show new addition badge!
        catalogChangesMade = true;
        
        updatePublishButtonState();
        renderCatalogList();
        
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
                throw new Error(`Failed to fetch datafile.csv details from GitHub: ${getCSVResponse.statusText}`);
            }
            if (!getJSONResponse.ok) {
                throw new Error(`Failed to fetch movies_metadata.json details from GitHub: ${getJSONResponse.statusText}`);
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
            const putCSVResponse = await fetch(apiCSVUrl, {
                method: "PUT",
                headers: {
                    "Authorization": `token ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json"
                },
                body: JSON.stringify({
                    message: "Update catalog (datafile.csv) from Film House Admin Panel",
                    content: base64CSV,
                    sha: shaCSV
                })
            });

            if (!putCSVResponse.ok) {
                const errData = await putCSVResponse.json();
                throw new Error(`CSV update failed: ${errData.message || putCSVResponse.statusText}`);
            }

            // Upload movies_metadata.json second
            const putJSONResponse = await fetch(apiJSONUrl, {
                method: "PUT",
                headers: {
                    "Authorization": `token ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json"
                },
                body: JSON.stringify({
                    message: "Update catalog metadata (movies_metadata.json) from Film House Admin Panel",
                    content: base64JSON,
                    sha: shaJSON
                })
            });

            if (!putJSONResponse.ok) {
                const errData = await putJSONResponse.json();
                throw new Error(`JSON update failed: ${errData.message || putJSONResponse.statusText}`);
            }
            
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
            if (error.message && (error.message.includes("Failed to fetch") || error.message.includes("fetch failed"))) {
                alert("Network Connection Error: Could not reach GitHub. Please check your mobile signal/internet connection and try again.");
            } else {
                alert(`Failed to publish changes: ${error.message}`);
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

const fulfillForm = document.getElementById("fulfill-request-form");
const fulfillRequestModal = document.getElementById("fulfill-request-modal");
const closeFulfillModalBtn = document.getElementById("btn-close-fulfill-modal");

if (closeFulfillModalBtn && fulfillRequestModal) {
    closeFulfillModalBtn.addEventListener("click", () => {
        releaseClaimLock(currentFulfillTitle);
        fulfillRequestModal.classList.remove("active");
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

        const downloadLink = primaryNotificationLink;
        
        // Disable form buttons during async operations
        const submitBtn = fulfillForm.querySelector("button[type='submit']");
        const cancelBtn = document.getElementById("btn-close-fulfill-modal");
        if (submitBtn) submitBtn.disabled = true;
        
        // 1. Sync to local CSV catalog
        const matchTitle = currentFulfillTitle.toLowerCase().trim();
        const matchedReq = allRequests.find(r => r.title.toLowerCase().trim() === matchTitle);
        const reqTmdbId = matchedReq ? matchedReq.tmdb_id : null;
        const isSeries = matchedReq ? (matchedReq.type.toLowerCase() === 'series' || matchedReq.type.toLowerCase() === 'tv') : true;

        const cleanTitle = currentFulfillTitle.replace(/\s*\([^)]+\)\s*$/g, "").trim();
        const cleanMatchTitle = cleanTitle.toLowerCase();
        
        const existingMovie = allCatalogMovies.find(m => {
            if (reqTmdbId && m.tmdb_id && String(reqTmdbId) === String(m.tmdb_id)) {
                return true;
            }
            const cleanCatalogTitle = m.title.toLowerCase().trim().replace(/\s*\([^)]+\)\s*$/g, "").trim();
            return cleanCatalogTitle === cleanMatchTitle;
        });

        let movieToSync = null;

        if (existingMovie) {
            if (!existingMovie.links) existingMovie.links = [];
            
            linksToSave.forEach(item => {
                const formattedLink = isSeries ? { url: item.url, season: item.seasonLabel } : { url: item.url, quality: item.quality };
                const targetIdx = item.index;
                while (existingMovie.links.length < targetIdx + 1) {
                    const currentIdx = existingMovie.links.length;
                    existingMovie.links.push({ season: `Season ${currentIdx + 1}`, url: "" });
                }
                existingMovie.links[targetIdx] = formattedLink;
            });

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
                    formattedLinksArray.push({ season: `Season ${currentIdx + 1}`, url: "" });
                }
                formattedLinksArray[targetIdx] = formattedLink;
            });

            const mediaType = isSeries ? 'tv' : 'movie';
            const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`;
            
            let tmdbData = null;
            try {
                const searchRes = await fetch(searchUrl);
                if (searchRes.ok) {
                    const searchObj = await searchRes.json();
                    if (searchObj.results && searchObj.results.length > 0) {
                        const firstMatch = searchObj.results[0];
                        const detailsUrl = `https://api.themoviedb.org/3/${firstMatch.media_type || mediaType}/${firstMatch.id}?api_key=${TMDB_API_KEY}&append_to_response=videos`;
                        const detailsRes = await fetch(detailsUrl);
                        if (detailsRes.ok) {
                            tmdbData = await detailsRes.json();
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
                    links: formattedLinksArray
                };
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
                    links: formattedLinksArray
                };
                allCatalogMovies.unshift(newMovie);
                newlyAddedIds.push(csvId);
                catalogChangesMade = true;
                movieToSync = newMovie;
            }
        }
        
        // 2. Commit Firestore batch update (chunked into groups of 450 to avoid Firestore limits)
        const requestChunks = [];
        for (let i = 0; i < currentFulfillDocIds.length; i += 450) {
            requestChunks.push(currentFulfillDocIds.slice(i, i + 450));
        }
 
        const fulfillPromises = requestChunks.map((chunk, chunkIdx) => {
            const batch = db.batch();
            chunk.forEach(id => {
                const ref = db.collection("requests").doc(id);
                batch.update(ref, {
                    status: "fulfilled",
                    downloadLink: downloadLink,
                    adminClaimId: firebase.firestore.FieldValue.delete(),
                    adminClaimName: firebase.firestore.FieldValue.delete(),
                    adminClaimTime: firebase.firestore.FieldValue.delete()
                });
            });
            if (chunkIdx === 0 && movieToSync) {
                const movieRef = db.collection("movies").doc(movieToSync.csv_id);
                batch.set(movieRef, movieToSync, { merge: true });
            }
            return batch.commit();
        });
 
        Promise.all(fulfillPromises).then(async () => {
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
                    
                    if (getCSVResponse.ok && getJSONResponse.ok) {
                        const csvData = await getCSVResponse.json();
                        const jsonData = await getJSONResponse.json();
                        const shaCSV = csvData.sha;
                        const shaJSON = jsonData.sha;
                        
                        const csvContent = generateCSVContent();
                        const jsonContent = JSON.stringify(allCatalogMovies, null, 2);
                        
                        const base64CSV = btoa(unescape(encodeURIComponent(csvContent)));
                        const base64JSON = btoa(unescape(encodeURIComponent(jsonContent)));
                        
                        // Push CSV
                        const putCSVResponse = await fetch(apiCSVUrl, {
                            method: "PUT",
                            headers: {
                                "Authorization": `token ${token}`,
                                "Content-Type": "application/json",
                                "Accept": "application/vnd.github.v3+json"
                            },
                            body: JSON.stringify({
                                message: `Auto-update catalog (datafile.csv) on request fulfill: ${currentFulfillTitle}`,
                                content: base64CSV,
                                sha: shaCSV
                            })
                        });
                        
                        // Push JSON
                        if (putCSVResponse.ok) {
                            const putJSONResponse = await fetch(apiJSONUrl, {
                                method: "PUT",
                                headers: {
                                    "Authorization": `token ${token}`,
                                    "Content-Type": "application/json",
                                    "Accept": "application/vnd.github.v3+json"
                                },
                                body: JSON.stringify({
                                    message: `Auto-update metadata (movies_metadata.json) on request fulfill: ${currentFulfillTitle}`,
                                    content: base64JSON,
                                    sha: shaJSON
                                })
                            });
                            
                            if (putJSONResponse.ok) {
                                const jsonResData = await putJSONResponse.json();
                                if (jsonResData && jsonResData.content) {
                                    lastKnownJsonSha = jsonResData.content.sha;
                                }
                                catalogChangesMade = false;
                                newlyAddedIds = [];
                                newlyUpdatedIds = [];
                                localStorage.removeItem("filmhouse_unpublished_catalog");
                                
                                if (submitBtn) {
                                    submitBtn.disabled = false;
                                    submitBtn.textContent = "Fulfill Request";
                                }
                                
                                renderCatalogList();
                                updatePublishButtonState();
                                fulfillRequestModal.classList.remove("active");
                                showToast(`Successfully fulfilled requests and published "${currentFulfillTitle}" directly live to GitHub! 🚀`, "success");
                                return;
                            }
                        }
                    }
                    throw new Error("GitHub API transaction failed");
                } catch (publishErr) {
                    console.error("Auto-publishing failed:", publishErr);
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Fulfill Request";
                    }
                    renderCatalogList();
                    updatePublishButtonState();
                    fulfillRequestModal.classList.remove("active");
                    showToast(`Firestore updated! Note: GitHub publish failed. Use 'Publish Changes' in the header to retry.`, "warning");
                }
            } else {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Fulfill Request";
                }
                renderCatalogList();
                updatePublishButtonState();
                fulfillRequestModal.classList.remove("active");
                showToast(`Successfully fulfilled requests for "${currentFulfillTitle}" in Firestore! Click 'Publish Changes' in the header to push live.`, "info");
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
    
    // UI elements update on user profile list sync to show target count
    const updateTargetCountLabel = () => {
        const target = broadcastTarget ? broadcastTarget.value : "all";
        const countLabel = document.getElementById("broadcast-recipient-count");
        if (!countLabel) return;
        
        if (target === "all") {
            const count = (typeof allUsers !== 'undefined' && allUsers) ? allUsers.length : 0;
            countLabel.textContent = `Target: ${count} Registered Users`;
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
    
    // Start Broadcast click listener
    if (btnStartBroadcast) {
        btnStartBroadcast.addEventListener("click", async () => {
            if (isBroadcasting) return;
            
            const message = broadcastMessage.value.trim();
            if (!message) {
                alert("Please enter a message to broadcast!");
                return;
            }
            
            if (!telegramBotToken) {
                alert("Please configure and save your Telegram Bot Token in Settings first!");
                return;
            }
            
            const targetType = broadcastTarget.value;
            let targetUsers = [];
            
            if (targetType === "channel") {
                targetUsers = [{ id: "-1002098683402" }];
            } else if (targetType === "single") {
                const rawIds = broadcastUserid.value.trim();
                if (!rawIds) {
                    alert("Please enter target Telegram User ID(s)!");
                    return;
                }
                const parsedIds = rawIds.split(",")
                    .map(id => id.trim())
                    .filter(id => id.length > 0);
                if (parsedIds.length === 0) {
                    alert("Please enter valid Telegram User ID(s)!");
                    return;
                }
                targetUsers = parsedIds.map(id => ({ id: id }));
            } else {
                // Get all users from Firestore or state
                if (typeof allUsers !== 'undefined' && allUsers && allUsers.length > 0) {
                    targetUsers = allUsers
                        .filter(u => u.blockedBot !== true)
                        .map(u => ({
                            id: String(u.id),
                            username: u.username || ""
                        }));
                } else {
                    if (typeof firebase === 'undefined' || !db) {
                        alert("Firestore is not connected!");
                        return;
                    }
                    btnStartBroadcast.disabled = true;
                    btnStartBroadcast.textContent = "Fetching users... ⏳";
                    try {
                        const snapshot = await db.collection("users").get();
                        snapshot.forEach(doc => {
                            const u = doc.data();
                            if (u.id && u.blockedBot !== true) {
                                targetUsers.push({
                                    id: String(u.id),
                                    username: u.username || ""
                                });
                            }
                        });
                    } catch (e) {
                        console.error("Error fetching users for broadcast:", e);
                        alert("Failed to fetch user list from database: " + e.message);
                        btnStartBroadcast.disabled = false;
                        btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                        return;
                    }
                }
            }
            
            if (targetUsers.length === 0) {
                alert("No registered users found to receive this message.");
                btnStartBroadcast.disabled = false;
                btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                return;
            }
            
            if (!confirm(`Are you sure you want to send this broadcast to ${targetUsers.length} recipient(s)?`)) {
                btnStartBroadcast.disabled = false;
                btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
                return;
            }
            
            // Start Broadcasting loop
            isBroadcasting = true;
            shouldCancelBroadcast = false;
            btnStartBroadcast.disabled = true;
            btnStartBroadcast.textContent = "Broadcasting... ✈️";
            
            const cancelBtn = document.getElementById("btn-cancel-broadcast");
            if (cancelBtn) cancelBtn.style.display = "block";
            
            // Show progress panel
            const progressContainer = document.getElementById("broadcast-progress-container");
            const statusLabel = document.getElementById("broadcast-status-label");
            const progressRatio = document.getElementById("broadcast-progress-ratio");
            const progressBar = document.getElementById("broadcast-progress-bar");
            const successEl = document.getElementById("broadcast-success-count");
            const failedEl = document.getElementById("broadcast-failed-count");
            
            if (progressContainer) progressContainer.style.display = "block";
            if (statusLabel) statusLabel.textContent = "Broadcasting messages...";
            if (successEl) successEl.textContent = "0";
            if (failedEl) failedEl.textContent = "0";
            
            let successCount = 0;
            let failedCount = 0;
            let lastErrorDescription = "";
            const total = targetUsers.length;
            const blockedUserIds = [];
            
            for (let i = 0; i < total; i++) {
                if (shouldCancelBroadcast) {
                    if (statusLabel) statusLabel.textContent = "Broadcast cancelled.";
                    break;
                }
                
                const user = targetUsers[i];
                
                // Update UI progress
                if (progressRatio) progressRatio.textContent = `${i + 1} / ${total}`;
                if (progressBar) progressBar.style.width = `${Math.round(((i + 1) / total) * 100)}%`;
                
                try {
                    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: user.id.trim(),
                            text: message,
                            parse_mode: "Markdown"
                        })
                    });
                    
                    const result = await response.json();
                    if (response.ok && result.ok) {
                        successCount++;
                        if (successEl) successEl.textContent = successCount;
                    } else if (response.status === 429 || result.error_code === 429) {
                        const retryAfter = (result.parameters && result.parameters.retry_after) ? (result.parameters.retry_after * 1000) : 5000;
                        console.warn(`Rate limited by Telegram. Waiting ${retryAfter}ms before retrying user ${user.id}...`);
                        if (statusLabel) statusLabel.textContent = `Rate limited. Waiting ${Math.round(retryAfter / 1000)}s... ⏳`;
                        await new Promise(r => setTimeout(r, retryAfter));
                        if (statusLabel) statusLabel.textContent = "Broadcasting messages...";
                        i--; // Decrement to retry this user
                    } else if (result.description && result.description.includes("can't parse entities")) {
                        console.warn(`Markdown parsing failed for user ${user.id}. Retrying with plain text.`);
                        const retryRes = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                chat_id: user.id.trim(),
                                text: message
                            })
                        });
                        const retryResult = await retryRes.json();
                        if (retryRes.ok && retryResult.ok) {
                            successCount++;
                            if (successEl) successEl.textContent = successCount;
                        } else {
                            lastErrorDescription = retryResult.description || "Plain text fallback retry failed";
                            failedCount++;
                            if (failedEl) failedEl.textContent = failedCount;
                        }
                    } else {
                        lastErrorDescription = result.description || "Telegram API rejected message";
                        const isBlocked = result.description && (result.description.includes("blocked") || result.description.includes("chat not found") || result.description.includes("deactivated"));
                        if (isBlocked) {
                            blockedUserIds.push(user.id);
                        }
                        console.warn(`Failed to send to ${user.id}:`, result);
                        failedCount++;
                        if (failedEl) failedEl.textContent = failedCount;
                    }
                } catch (err) {
                    lastErrorDescription = err.message || "Network request failed";
                    console.warn(`Network error sending to ${user.id}:`, err);
                    failedCount++;
                    if (failedEl) failedEl.textContent = failedCount;
                }
                
                // Delay 50ms to respect Telegram rate limit (max 30 msgs/sec)
                await new Promise(r => setTimeout(r, 50));
            }
            
            // Batch update blocked users in Firestore
            if (blockedUserIds.length > 0 && typeof firebase !== 'undefined' && db) {
                if (statusLabel) statusLabel.textContent = `Saving ${blockedUserIds.length} blocked status updates... ⏳`;
                try {
                    const batchSize = 400;
                    const chunks = [];
                    for (let j = 0; j < blockedUserIds.length; j += batchSize) {
                        chunks.push(blockedUserIds.slice(j, j + batchSize));
                    }
                    const batchPromises = chunks.map(chunk => {
                        const batch = db.batch();
                        chunk.forEach(uid => {
                            batch.set(db.collection("users").doc(String(uid).trim()), { blockedBot: true }, { merge: true });
                        });
                        return batch.commit();
                    });
                    await Promise.all(batchPromises);
                    console.log(`Successfully batch updated ${blockedUserIds.length} blocked users.`);
                } catch (batchErr) {
                    console.error("Failed to commit blocked users batch:", batchErr);
                }
            }
            
            // Broadcast completed
            isBroadcasting = false;
            btnStartBroadcast.disabled = false;
            btnStartBroadcast.textContent = "Send Broadcast Message ✈️";
            
            if (cancelBtn) cancelBtn.style.display = "none";
            
            if (statusLabel) {
                let statusText = shouldCancelBroadcast 
                    ? `Broadcast Cancelled. Sent to ${successCount}/${total} users successfully.` 
                    : `Completed! Sent to ${successCount}/${total} users successfully.`;
                if (failedCount > 0 && lastErrorDescription) {
                    statusText += `\n⚠️ Error details: ${lastErrorDescription}`;
                }
                statusLabel.innerText = statusText;
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
                
                // Notify recipient via Telegram DM
                db.collection("settings").doc("telegram").get().then(tgDoc => {
                    if (tgDoc.exists) {
                        const token = tgDoc.data().botToken;
                        if (token) {
                            const text = `🎁 *Points Reward Allocated!*\n\nAn administrator has allocated *+${amount} Points* to your Film House account balance! Thank you for using our app! 🍿`;
                            fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    chat_id: String(recipientId),
                                    text: text,
                                    parse_mode: "Markdown"
                                })
                            }).catch(err => console.warn("Failed to notify recipient of points allocation:", err));
                        }
                    }
                });
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


