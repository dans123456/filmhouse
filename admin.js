// Film House - Standalone Admin Command Center Logic
const firebaseConfig = {
    apiKey: "AIzaSyCXs2tNgG07tAlsCkR96PNNIVIDyDkJD78",
    authDomain: "film-house-2.firebaseapp.com",
    projectId: "film-house-2",
    storageBucket: "film-house-2.firebasestorage.app",
    messagingSenderId: "698060918982",
    appId: "1:698060918982:web:cf5fd73cc71aef002907c7"
};

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
        statusTextTextEl.parentElement.style.borderColor = "rgba(255, 59, 48, 0.3)";
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
            allRequests.push(doc.data());
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

        const joinedDateStr = u.joinedDate ? new Date(u.joinedDate.seconds * 1000).toLocaleDateString() : "Unknown";
        
        // Compile points breakdown layout
        const bd = u.pointsBreakdown || { downloads: 0, visits: 0, shares: 0, watched: 0 };
        
        row.innerHTML = `
            <div class="user-info">
                <img src="${u.avatar || 'MOVIE/img/FilmHouse3_nobg.png'}" alt="Avatar" class="user-avatar" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                <div class="user-details">
                    <h5>${u.fullName || 'Guest User'}</h5>
                    <p>@${u.username || 'guest'} | ID: ${u.id}</p>
                    <div class="breakdown-group">
                        <span class="breakdown-tag">📥 Downloads: ${bd.downloads || 0}</span>
                        <span class="breakdown-tag">🗓 Visits: ${bd.visits || 0}</span>
                        <span class="breakdown-tag">🔗 Shares: ${bd.shares || 0}</span>
                        <span class="breakdown-tag">👁 Watched: ${bd.watched || 0}</span>
                    </div>
                </div>
            </div>
            <div class="user-stats">
                <div class="points-badge">${u.points || 0} pts</div>
                <div class="date-label">Joined: ${joinedDateStr}</div>
            </div>
        `;
        listContainer.appendChild(row);
    });
}

// Render Requests List with Aggregation and Filter Capability
function renderRequestsList() {
    const listContainer = document.getElementById("requests-list");
    if (!listContainer) return;

    listContainer.replaceChildren();

    const searchQuery = (document.getElementById("request-search-input")?.value || "").toLowerCase().trim();
    
    // Aggregate request counts
    const counts = {};
    allRequests.forEach(r => {
        const key = r.title;
        if (!counts[key]) {
            counts[key] = { title: r.title, type: r.type, count: 0 };
        }
        counts[key].count++;
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

        row.innerHTML = `
            <div class="user-details">
                <h5>${req.title}</h5>
                <p style="text-transform: uppercase;">${req.type}</p>
            </div>
            <div class="req-count">
                ${req.count} ${req.count === 1 ? 'request' : 'requests'}
            </div>
        `;
        listContainer.appendChild(row);
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
