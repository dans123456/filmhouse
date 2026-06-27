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
        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px;">
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

        ${movie.overview ? `
        <div style="margin-bottom: 20px;">
            <h5 style="margin: 0 0 6px 0; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Synopsis</h5>
            <p style="margin: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.6;">${movie.overview}</p>
        </div>
        ` : ''}

        <div style="margin-bottom: 24px;">
            <h5 style="margin: 0 0 8px 0; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Telegram Download Links (${linksList.length})</h5>
            <div style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
                ${linksList.length ? linksList.map((link, idx) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-size: 12px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 82%;" title="${link}">Link ${idx + 1}: ${link}</span>
                        <a href="${link}" target="_blank" style="font-size: 12px; color: var(--primary-color); text-decoration: none; font-weight: 600; padding: 2px 8px; background: rgba(255, 188, 0, 0.05); border: 1px solid rgba(255, 188, 0, 0.2); border-radius: 4px;">Test ↗</a>
                    </div>
                `).join('') : '<p style="margin: 0; font-size: 12px; color: var(--text-muted); text-align: center; padding: 10px;">No links added</p>'}
            </div>
        </div>

        <div style="display: flex; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 10px;">
            <button class="btn btn-secondary btn-block" id="btn-details-delete-movie" data-csv-id="${movie.csv_id}" style="border-color: rgba(255, 59, 48, 0.4); color: #ff3b30; background: rgba(255, 59, 48, 0.05); cursor: pointer; padding: 12px; font-weight: 600; transition: all 0.3s;">
                Delete Title 🗑️
            </button>
        </div>
    `;
    
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
        
        row.innerHTML = `
            <div class="user-info" style="pointer-events: none;">
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
                    allCatalogMovies = importedMovies;
                    catalogChangesMade = true;
                    updatePublishButtonState();
                    renderCatalogList();
                    alert(`Successfully imported ${importedMovies.length} catalog items from CSV! Click "Publish Changes 🚀" to save them to your app.`);
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
