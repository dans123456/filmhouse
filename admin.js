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

// Global Datasets for local search filter matching (saves Firestore quota reads)
let allUsers = [];
let allRequests = [];

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
    // 1. Real-time Users Listener
    db.collection("users").orderBy("lastSeen", "desc").onSnapshot(snapshot => {
        allUsers = [];
        snapshot.forEach(doc => {
            allUsers.push(doc.data());
        });
        updateStatsCounters();
        renderUsersList();
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

    // Total requests
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

        const joinedDateStr = u.joinedDate ? new Date(u.joinedDate.seconds * 1000).toLocaleDateString() : "Unknown";
        const bd = u.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 };
        
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
                <p style="margin: 0 0 12px 0; font-size: 13px; color: var(--text-secondary);"><strong>Joined Date:</strong> ${joinedDateStr}</p>
                
                <h6 style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600;">Points Breakdown</h6>
                <div class="breakdown-group" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px;">
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">📥 Downloads: ${bd.downloads || 0}</span>
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">🚪 Visits: ${bd.visits || 0}</span>
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">🔗 Shares: ${bd.shares || 0}</span>
                    <span class="breakdown-tag" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 11px; color: var(--text-secondary);">🎬 Watched: ${bd.watched || 0}</span>
                </div>
                
                <button class="btn btn-secondary btn-sm delete-user-btn" style="color: #ff3b30; border-color: rgba(255, 59, 48, 0.25); background: rgba(255, 59, 48, 0.05); padding: 6px 12px; font-size: 12px; border-radius: 6px; width: 100%; cursor: pointer;">Delete User Profile</button>
            </div>
        `;

        const summary = row.querySelector(".user-summary");
        const details = row.querySelector(".user-expanded-details");
        const chevron = row.querySelector(".chevron-icon");
        const deleteBtn = row.querySelector(".delete-user-btn");

        summary.addEventListener("click", () => {
            const isVisible = details.style.display === "block";
            details.style.display = isVisible ? "none" : "block";
            chevron.style.transform = isVisible ? "rotate(0deg)" : "rotate(90deg)";
        });

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

// Render Requests List with Aggregation and Filter Capability
function renderRequestsList() {
    const listContainer = document.getElementById("requests-list");
    if (!listContainer) return;

    listContainer.replaceChildren();

    const searchQuery = (document.getElementById("request-search-input")?.value || "").toLowerCase().trim();
    
    // Aggregate request counts and status
    const counts = {};
    allRequests.forEach(r => {
        const key = r.title.toLowerCase().trim();
        if (!counts[key]) {
            counts[key] = { 
                title: r.title, 
                type: r.type, 
                count: 0, 
                isPriority: false, 
                isFulfilled: true,
                docIds: [] 
            };
        }
        counts[key].count++;
        counts[key].docIds.push(r.docId);
        
        if (r.status === "priority") {
            counts[key].isPriority = true;
        }
        if (r.status !== "fulfilled") {
            counts[key].isFulfilled = false;
        }
    });

    const sortedRequests = Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .filter(r => r.title.toLowerCase().includes(searchQuery));

    const badgeEl = document.getElementById("requests-count-badge");
    if (badgeEl) badgeEl.textContent = `${sortedRequests.length} Unique Titles`;

    if (sortedRequests.length === 0) {
        listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">No matching movie requests found.</div>`;
        return;
    }

    sortedRequests.forEach(req => {
        const row = document.createElement("div");
        row.className = "list-row";
        row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border-color);";

        let badgeMarkup = "";
        if (req.isPriority) {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(255, 59, 48, 0.15); border: 1px solid rgba(255, 59, 48, 0.3); color: #ff3b30; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🔥 High Priority</span>`;
        } else if (req.isFulfilled) {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🟢 Fulfilled</span>`;
        } else {
            badgeMarkup = `<span style="font-size: 10px; background: rgba(255, 188, 0, 0.15); border: 1px solid rgba(255, 188, 0, 0.3); color: #ffbc00; padding: 2px 8px; border-radius: 20px; font-weight: 700; margin-left: 8px;">🟠 Pending</span>`;
        }

        let fulfillBtnMarkup = "";
        if (!req.isFulfilled) {
            fulfillBtnMarkup = `
                <button class="btn-fulfill-request" data-title="${escapeHTML(req.title)}" style="background: var(--primary-gradient); border: none; border-radius: 4px; padding: 6px 12px; color: #000; font-weight: 700; font-size: 11px; cursor: pointer; transition: opacity 0.2s;">
                    Fulfill 📥
                </button>
            `;
        } else {
            fulfillBtnMarkup = `
                <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Resolved</span>
            `;
        }

        row.innerHTML = `
            <div class="user-details" style="flex: 1;">
                <h5 style="margin: 0; display: flex; align-items: center;">
                    ${escapeHTML(req.title)}
                    ${badgeMarkup}
                </h5>
                <p style="text-transform: uppercase; margin: 4px 0 0 0; font-size: 11px; color: var(--text-secondary);">${escapeHTML(req.type)}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 16px;">
                <div class="req-count" style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">
                    ${req.count} ${req.count === 1 ? 'request' : 'requests'}
                </div>
                ${fulfillBtnMarkup}
            </div>
        `;

        const fulfillBtn = row.querySelector(".btn-fulfill-request");
        if (fulfillBtn) {
            fulfillBtn.addEventListener("click", () => {
                fulfillMovieTitleRequests(req.title, req.docIds);
            });
        }

        listContainer.appendChild(row);
    });
}

function fulfillMovieTitleRequests(title, docIds) {
    if (typeof firebase === "undefined" || !db) return;
    
    const downloadLink = prompt(`Enter the direct download link for "${title}":`);
    if (downloadLink === null) return;
    
    const cleanLink = downloadLink.trim();
    if (!cleanLink) {
        alert("Download link cannot be empty!");
        return;
    }
    
    const batch = db.batch();
    docIds.forEach(id => {
        const ref = db.collection("requests").doc(id);
        batch.update(ref, {
            status: "fulfilled",
            downloadLink: cleanLink
        });
    });
    
    batch.commit().then(() => {
        alert(`Successfully fulfilled all requests for "${title}"!`);
    }).catch(err => {
        console.error("Error fulfilling requests:", err);
        alert("Failed to fulfill requests: " + err.message);
    });
}

// Bind search input typing events
const userSearchInput = document.getElementById("user-search-input");
if (userSearchInput) {
    userSearchInput.addEventListener("input", renderUsersList);
}

const requestSearchInput = document.getElementById("request-search-input");
if (requestSearchInput) {
    requestSearchInput.addEventListener("input", renderRequestsList);
}

// --- CATALOG MANAGER LOGIC ---

// Catalog state
let allCatalogMovies = [];
let originalCatalogCount = 0;
let catalogChangesMade = false;
let githubToken = ""; // Global cache for token
const TMDB_API_KEY = localStorage.getItem("filmhouse_tmdb_key") || "a3a9df05cdacd9f23c885f2756466395";
let pendingImportChanges = null;
let newlyAddedIds = [];
let newlyUpdatedIds = [];
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
    }

    // Verify Admin Access
    verifyAdminAccess();
});

// Admin Access Control Verification
async function verifyAdminAccess() {
    const defaultAdmins = ["1329840839", "1175336733"];
    let authorizedIds = [...defaultAdmins];

    if (db) {
        try {
            const adminDoc = await db.collection("settings").doc("admins").get();
            if (adminDoc.exists) {
                const storedIds = adminDoc.data().ids || [];
                authorizedIds = Array.from(new Set([...defaultAdmins, ...storedIds.map(id => String(id).trim())]));
            } else {
                // Seed initial admins doc in Firestore if missing
                await db.collection("settings").doc("admins").set({
                    ids: defaultAdmins,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (e) {
            console.error("Failed to fetch admin list from Firestore, falling back to defaults:", e);
        }
    }

    const adminInput = document.getElementById("admin-tg-ids");
    if (adminInput) {
        adminInput.value = authorizedIds.join(", ");
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
        const adminInput = document.getElementById("admin-tg-ids");
        if (adminInput && db) {
            const rawInput = adminInput.value.trim();
            const defaultAdmins = ["1329840839", "1175336733"];
            
            // Map input and filter empty
            let inputIds = rawInput.split(",")
                .map(id => id.trim())
                .filter(id => id && /^\d+$/.test(id)); // Allow only numeric IDs

            // Merge with master default admins
            const finalIds = Array.from(new Set([...defaultAdmins, ...inputIds]));

            try {
                await db.collection("settings").doc("admins").set({
                    ids: finalIds,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                adminInput.value = finalIds.join(", ");
                alert("Authorized Admin IDs updated successfully in your Firebase database!");
            } catch (e) {
                console.error("Error saving admin list to Firestore:", e);
                alert("Failed to update Admin IDs. Make sure your database rules permit this write.");
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
                    alert("GitHub Personal Access Token saved locally and securely in Firestore!");
                } catch (e) {
                    console.error("Error saving token to Firestore:", e);
                    alert("Token saved locally! (Note: Firestore cloud sync failed - check your database rules).");
                }
            } else {
                alert("GitHub Personal Access Token saved locally!");
            }
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

// Load Catalog
async function loadCatalog() {
    const listContainer = document.getElementById("catalog-list");
    try {
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
    const posterUrl = movie.poster || "MOVIE/img/FilmHouse3_nobg.png";
    const linksList = movie.links || [];
    
    detailsBody.innerHTML = `
        <!-- Read-Only Title Info View -->
        <div id="details-title-info-view" style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px;">
            <img src="${posterUrl}" style="width: 130px; height: 180px; border-radius: 8px; border: 1px solid var(--border-color); object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
            <div style="flex: 1; min-width: 200px; display: flex; flex-direction: column; justify-content: center;">
                <h4 style="margin: 0 0 10px 0; font-size: 18px; font-family: var(--font-heading); color: #fff; line-height: 1.3;">${movie.title}</h4>
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
                    <label style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; font-weight: bold;">TMDB ID / Slug</label>
                    <input type="text" id="edit-movie-id" value="${escapeHTML(movie.csv_id)}" style="padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px; width: 100%;">
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
                        { key: "Erotic Movies", label: "Erotic" }
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
                ${linksList.length ? linksList.map((link, idx) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-size: 12px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 82%;" title="${link}">Link ${idx + 1}: ${link}</span>
                        <a href="${link}" target="_blank" style="font-size: 12px; color: var(--primary-color); text-decoration: none; font-weight: 600; padding: 2px 8px; background: rgba(255, 188, 0, 0.05); border: 1px solid rgba(255, 188, 0, 0.2); border-radius: 4px;">Test 🔗</a>
                    </div>
                `).join('') : '<p style="margin: 0; font-size: 12px; color: var(--text-muted); text-align: center; padding: 10px;">No links added</p>'}
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
    const addLinkBtn = document.getElementById("btn-add-link-input");
    const saveLinksBtn = document.getElementById("btn-save-links-changes");
    
    let currentLinks = [...linksList];

    function renderLinkInputs() {
        inputsWrapper.innerHTML = "";
        currentLinks.forEach((link, idx) => {
            const wrapper = document.createElement("div");
            wrapper.style.display = "flex";
            wrapper.style.gap = "8px";
            wrapper.style.alignItems = "center";
            
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
            input.value = link;
            input.placeholder = `Telegram Link ${idx + 1}...`;
            input.addEventListener("input", (e) => {
                currentLinks[idx] = e.target.value.trim();
            });
            
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
            
            wrapper.appendChild(input);
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

    if (addLinkBtn) {
        addLinkBtn.addEventListener("click", () => {
            currentLinks.push("");
            renderLinkInputs();
        });
    }

    if (saveLinksBtn) {
        saveLinksBtn.addEventListener("click", () => {
            const finalLinks = currentLinks.filter(l => l !== "");
            
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
        
        const posterUrl = m.poster || "MOVIE/img/FilmHouse3_nobg.png";
        const badgeColor = (m.type || "").toLowerCase() === 'series' || (m.type || "").toLowerCase() === 'tv' ? 'var(--primary-color)' : '#00bcd4';
        
        let diffBadge = "";
        if (newlyAddedIds.includes(m.csv_id)) {
            diffBadge = `<span style="font-size: 9px; background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 700;">NEW Addition</span>`;
        } else if (newlyUpdatedIds.includes(m.csv_id)) {
            diffBadge = `<span style="font-size: 9px; background: rgba(33, 150, 243, 0.15); border: 1px solid rgba(33, 150, 243, 0.3); color: #2196f3; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 700;">UPDATED Links</span>`;
        }

        row.innerHTML = `
            <div class="user-info" style="pointer-events: none;">
                <img src="${escapeHTML(posterUrl)}" alt="Poster" class="user-avatar" style="border-radius: 4px; object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                <div class="user-details">
                    <h5>${escapeHTML(m.title)} ${diffBadge}</h5>
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
}

function deleteMovie(csvId) {
    allCatalogMovies = allCatalogMovies.filter(m => m.csv_id !== csvId);
    catalogChangesMade = true;
    updatePublishButtonState();
    renderCatalogList();
}

function updatePublishButtonState() {
    const publishBtn = document.getElementById("btn-publish-catalog");
    if (publishBtn) {
        if (catalogChangesMade) {
            publishBtn.style.display = "inline-flex";
        } else {
            publishBtn.style.display = "none";
        }
    }
}

// Search Catalog Input
const catalogSearchInput = document.getElementById("catalog-search-input");
if (catalogSearchInput) {
    catalogSearchInput.addEventListener("input", renderCatalogList);
}

let addMovieLinksState = [""];

function renderAddMovieLinks() {
    const wrapper = document.getElementById("add-movie-links-inputs-wrapper");
    if (!wrapper) return;
    
    wrapper.innerHTML = addMovieLinksState.map((link, idx) => {
        const escaped = escapeHTML(link);
        return `
            <div style="display: flex; gap: 8px; align-items: center;">
                <span style="font-size: 11px; color: var(--text-secondary); font-weight: 700; width: 55px; flex-shrink: 0;">Link ${idx + 1}:</span>
                <input type="text" class="add-movie-link-input" data-index="${idx}" value="${escaped}" placeholder="Paste Telegram download URL" style="flex: 1; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; font-size: 13px;">
                <button type="button" class="btn-remove-add-movie-link" data-index="${idx}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 6px; display: ${addMovieLinksState.length > 1 ? 'block' : 'none'};">
                    <svg style="width: 14px; height: 14px; fill: currentColor;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
        `;
    }).join('');
    
    // Bind input updates
    wrapper.querySelectorAll(".add-movie-link-input").forEach(input => {
        input.addEventListener("input", (e) => {
            const idx = parseInt(e.target.dataset.index);
            addMovieLinksState[idx] = e.target.value.trim();
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

// Modal Toggle Logic
const addMovieModal = document.getElementById("add-movie-modal");
const openModalBtn = document.getElementById("btn-add-movie-modal");
const closeModalBtn = document.getElementById("btn-close-movie-modal");

if (openModalBtn && addMovieModal) {
    openModalBtn.addEventListener("click", () => {
        addMovieLinksState = [""]; // reset links list
        addMovieModal.classList.add("active");
        renderAddMovieLinks();
        
        const customSection = document.getElementById("add-movie-custom-fields");
        const toggleBtn = document.getElementById("btn-toggle-custom-fields");
        if (customSection) customSection.style.display = "none";
        if (toggleBtn) toggleBtn.textContent = "Show Custom Fields ▾";
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

const addMovieIdInput = document.getElementById("movie-id");
if (addMovieIdInput) {
    addMovieIdInput.addEventListener("input", () => {
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
    });
}

const btnAddMovieLinkInput = document.getElementById("btn-add-movie-link-input");
if (btnAddMovieLinkInput) {
    btnAddMovieLinkInput.addEventListener("click", () => {
        addMovieLinksState.push("");
        renderAddMovieLinks();
    });
}

// Add Movie Form Submit
const addMovieForm = document.getElementById("add-movie-form");
if (addMovieForm) {
    addMovieForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const title = document.getElementById("movie-title").value.trim();
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
        
        const linksList = addMovieLinksState.filter(l => l !== "");
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
        
        if (isTmdb) {
            const mediaType = (type.toLowerCase() === 'tv') ? 'tv' : 'movie';
            const url = `https://api.themoviedb.org/3/${mediaType}/${numericId}?api_key=${TMDB_API_KEY}`;
            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : "";
                    backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : "";
                    rating = Math.round((data.vote_average || 0) * 10) / 10;
                    releaseDate = data.release_date || data.first_air_date || "";
                    genres = data.genres ? data.genres.map(g => g.name) : [];
                    original_language = data.original_language || "en";
                    overview = data.overview || "No synopsis available.";
                    
                    // Categorize title automatically
                    if (type === 'tv') {
                        categories.push("Hollywood/British Series");
                        if (original_language === 'ko') {
                            categories.push("Korean Drama");
                        }
                    } else {
                        categories.push("Hollywood/British Movies");
                        if (original_language === 'ko') {
                            categories.push("Korean Drama");
                        }
                    }
                    if (data.genres && data.genres.some(g => g.name.toLowerCase() === "animation")) {
                        categories.push("Animated Movies");
                        if (original_language === 'ja') {
                            categories.push("Anime");
                        }
                    }
                } else {
                    throw new Error("TMDB fetch returned non-ok status");
                }
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

        // Add to local state
        const newMovie = {
            csv_id: id,
            tmdb_id: isTmdb ? parseInt(numericId) : null,
            imdb_id: "",
            title: title,
            type: type === 'tv' ? 'Series' : 'Movie',
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
            row.push(escapeCSV(linksList[i] || ''));
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
            
            alert("Catalog CSV and enriched JSON database successfully published directly to GitHub! Updates are live instantly.");
            catalogChangesMade = false;
            newlyAddedIds = [];
            newlyUpdatedIds = [];
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
    const url = `https://api.themoviedb.org/3/${mediaType}/${numericId}?api_key=${TMDB_API_KEY}`;
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            return {
                title: data.title || data.name || "",
                poster: data.poster_path ? `https://image.tmdb.org/t/p/w200${data.poster_path}` : "",
                overview: data.overview || "",
                rating: data.vote_average || 0
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

    // Render HTML inside Review Modal
    reviewBody.innerHTML = `
        <div style="margin-bottom: 16px; display: flex; gap: 12px; flex-wrap: wrap;">
            <span style="background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.3); color: #4caf50; padding: 4px 10px; border-radius: 6px; font-weight: 700;">🟢 Added: ${added.length}</span>
            <span style="background: rgba(33, 150, 243, 0.15); border: 1px solid rgba(33, 150, 243, 0.3); color: #2196f3; padding: 4px 10px; border-radius: 6px; font-weight: 700;">🔵 Updated: ${updated.length}</span>
            <span style="background: rgba(244, 67, 54, 0.15); border: 1px solid rgba(244, 67, 54, 0.3); color: #f44336; padding: 4px 10px; border-radius: 6px; font-weight: 700;">🔴 Removed: ${removed.length}</span>
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

            ${removed.length > 0 ? `
                <div>
                    <h4 style="margin: 12px 0 8px 0; color: #f44336; font-size: 14px;">Titles to Remove (${removed.length})</h4>
                    <div style="display: flex; flex-direction: column; gap: 6px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border: 1px solid rgba(244, 67, 54, 0.1);">
                        ${removed.map(m => `
                            <div style="color: #e57373; text-decoration: line-through; padding: 4px 6px;">${m.title}</div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;

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
            m.poster = preview.poster;
            m.rating = preview.rating;
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
            // Build the final catalog by merging imported data with existing rich metadata
            const finalCatalog = pendingImportChanges.importedList.map(imported => {
                const existing = allCatalogMovies.find(ex => ex.csv_id === imported.csv_id);
                if (existing) {
                    // Update only CSV-controlled columns (Title, Type, Links)
                    // Keep all other rich TMDB/custom metadata fields intact!
                    return {
                        ...existing,
                        title: imported.title,
                        type: imported.type,
                        links: imported.links
                    };
                } else {
                    // Set safe default values for new movies if TMDB preview wasn't fetched yet
                    return {
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
                    };
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


