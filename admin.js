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

// --- CATALOG MANAGER LOGIC ---

// Catalog state
let allCatalogMovies = [];
let originalCatalogCount = 0;
let catalogChangesMade = false;
let githubToken = ""; // Global cache for token

// Load GitHub token on startup from Firestore
document.addEventListener("DOMContentLoaded", async () => {
    loadCatalog();
    
    // Fetch token from Firestore
    if (db) {
        try {
            const doc = await db.collection("settings").doc("github").get();
            if (doc.exists) {
                githubToken = doc.data().token || "";
                const tokenInput = document.getElementById("github-token");
                if (tokenInput) {
                    tokenInput.value = githubToken;
                }
            }
        } catch (e) {
            console.error("Error loading GitHub token from Firestore:", e);
        }
    }
});

// Save GitHub token to Firestore
const saveTokenBtn = document.getElementById("btn-save-github-token");
if (saveTokenBtn) {
    saveTokenBtn.addEventListener("click", async () => {
        const tokenInput = document.getElementById("github-token");
        if (tokenInput && db) {
            const token = tokenInput.value.trim();
            try {
                await db.collection("settings").doc("github").set({
                    token: token,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                githubToken = token;
                alert("GitHub Personal Access Token saved securely in your Firebase database!");
            } catch (e) {
                console.error("Error saving token to Firestore:", e);
                alert("Failed to save token to database. Make sure your database rules permit this write.");
            }
        }
    });
}

// Load Catalog
async function loadCatalog() {
    const listContainer = document.getElementById("catalog-list");
    try {
        const response = await fetch("./MOVIE/Data/movies_metadata.json");
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        allCatalogMovies = await response.json();
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
        
        const posterUrl = m.poster || "MOVIE/img/FilmHouse3_nobg.png";
        const badgeColor = (m.type || "").toLowerCase() === 'series' || (m.type || "").toLowerCase() === 'tv' ? 'var(--primary-color)' : '#00bcd4';
        
        row.innerHTML = `
            <div class="user-info">
                <img src="${posterUrl}" alt="Poster" class="user-avatar" style="border-radius: 4px; object-fit: cover;" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                <div class="user-details">
                    <h5>${m.title}</h5>
                    <p>ID: ${m.csv_id} | Type: <span style="text-transform: uppercase; font-weight: 600; color: ${badgeColor};">${m.type}</span></p>
                    <div class="breakdown-group">
                        <span class="breakdown-tag">🔗 Links: ${m.links ? m.links.length : 0}</span>
                        ${m.rating ? `<span class="breakdown-tag">⭐ ${m.rating}</span>` : ''}
                        ${m.release_date ? `<span class="breakdown-tag">📅 ${m.release_date}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="user-stats">
                <button class="btn btn-secondary btn-sm btn-delete-movie" data-csv-id="${m.csv_id}" style="border-color: rgba(255, 59, 48, 0.3); color: #ff3b30; background: rgba(255, 59, 48, 0.05); padding: 6px 12px; font-size: 11px; cursor: pointer;">
                    Delete
                </button>
            </div>
        `;
        listContainer.appendChild(row);
    });

    // Bind delete buttons with confirmation delay to prevent accidental clicks on mobile
    listContainer.querySelectorAll(".btn-delete-movie").forEach(btn => {
        let resetTimeout = null;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const button = e.currentTarget;
            const csvId = button.getAttribute("data-csv-id");
            
            if (button.classList.contains("confirming")) {
                if (resetTimeout) clearTimeout(resetTimeout);
                deleteMovie(csvId);
            } else {
                // Reset any other active confirming delete buttons
                listContainer.querySelectorAll(".btn-delete-movie.confirming").forEach(otherBtn => {
                    otherBtn.classList.remove("confirming");
                    otherBtn.textContent = "Delete";
                    otherBtn.style.backgroundColor = "rgba(255, 59, 48, 0.05)";
                    otherBtn.style.color = "#ff3b30";
                });
                
                // Transition this button to confirming state
                button.classList.add("confirming");
                button.textContent = "Confirm?";
                button.style.backgroundColor = "#ff3b30";
                button.style.color = "#ffffff";
                
                // Auto revert back to normal state after 3 seconds of inactivity
                resetTimeout = setTimeout(() => {
                    button.classList.remove("confirming");
                    button.textContent = "Delete";
                    button.style.backgroundColor = "rgba(255, 59, 48, 0.05)";
                    button.style.color = "#ff3b30";
                }, 3000);
            }
        });
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

// Modal Toggle Logic
const addMovieModal = document.getElementById("add-movie-modal");
const openModalBtn = document.getElementById("btn-add-movie-modal");
const closeModalBtn = document.getElementById("btn-close-movie-modal");

if (openModalBtn && addMovieModal) {
    openModalBtn.addEventListener("click", () => {
        addMovieModal.classList.add("active");
    });
}

if (closeModalBtn && addMovieModal) {
    closeModalBtn.addEventListener("click", () => {
        addMovieModal.classList.remove("active");
    });
}

// Add Movie Form Submit
const addMovieForm = document.getElementById("add-movie-form");
if (addMovieForm) {
    addMovieForm.addEventListener("submit", (e) => {
        e.preventDefault();
        
        const title = document.getElementById("movie-title").value.trim();
        const id = document.getElementById("movie-id").value.trim();
        const type = document.getElementById("movie-type").value;
        const linksVal = document.getElementById("movie-links").value.trim();
        
        const linksList = linksVal.split(",").map(l => l.trim()).filter(l => l);
        
        // Add to local state
        const newMovie = {
            csv_id: id,
            title: title,
            type: type === 'tv' ? 'Series' : 'Movie',
            links: linksList,
            poster: '',
            rating: 0,
            release_date: ''
        };
        
        // Prevent duplicate IDs locally
        if (allCatalogMovies.some(m => m.csv_id === id)) {
            alert("A title with this ID already exists in the catalog!");
            return;
        }
        
        allCatalogMovies.unshift(newMovie); // Add to beginning of catalog list
        catalogChangesMade = true;
        
        updatePublishButtonState();
        renderCatalogList();
        
        // Reset and close modal
        addMovieForm.reset();
        addMovieModal.classList.remove("active");
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
        const token = (document.getElementById("github-token")?.value.trim()) || githubToken;
        if (!token) {
            alert("Error: Please set your GitHub Personal Access Token (PAT) first in the Settings panel.");
            return;
        }
        
        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing... ⏳";
        
        const owner = "dans123456";
        const repo = "filmhouse";
        const path = "MOVIE/Data/datafile.csv";
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        
        try {
            // 1. Fetch current file to get SHA hash
            const getResponse = await fetch(apiUrl, {
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/vnd.github.v3+json"
                }
            });
            
            if (!getResponse.ok) {
                throw new Error(`Failed to fetch datafile.csv details from GitHub API: ${getResponse.statusText}`);
            }
            
            const fileData = await getResponse.json();
            const sha = fileData.sha;
            
            // 2. Generate CSV contents
            const csvContent = generateCSVContent();
            
            // 3. Base64 encode using Unicode safe logic
            const base64Content = btoa(unescape(encodeURIComponent(csvContent)));
            
            // 4. Commit file to GitHub
            const putResponse = await fetch(apiUrl, {
                method: "PUT",
                headers: {
                    "Authorization": `token ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json"
                },
                body: JSON.stringify({
                    message: "Update catalog (datafile.csv) from Film House Admin Panel",
                    content: base64Content,
                    sha: sha
                })
            });
            
            if (!putResponse.ok) {
                const errData = await putResponse.json();
                throw new Error(errData.message || `Failed to update file on GitHub: ${putResponse.statusText}`);
            }
            
            alert("Catalog successfully updated! GitHub Actions is now rebuilding the metadata. Wait 1-2 minutes for changes to reflect on the website.");
            catalogChangesMade = false;
            updatePublishButtonState();
        } catch (error) {
            console.error("Publishing error:", error);
            alert(`Failed to publish changes: ${error.message}`);
        } finally {
            publishBtn.disabled = false;
            publishBtn.textContent = "Publish Changes 🚀";
        }
    });
}
