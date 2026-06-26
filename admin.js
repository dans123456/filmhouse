// Film House - Standalone Admin Panel Logic
const firebaseConfig = {
    apiKey: "AIzaSyCXs2tNgG07tAlsCkR96PNNIVIDyDkJD78",
    authDomain: "film-house-2.firebaseapp.com",
    projectId: "film-house-2",
    storageBucket: "film-house-2.firebasestorage.app",
    messagingSenderId: "698060918982",
    appId: "1:698060918982:web:cf5fd73cc71aef002907c7"
};

// Initialize Firebase & Firestore
let db = null;
const statusEl = document.getElementById("status-connection");

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    if (statusEl) {
        statusEl.textContent = "Connected to Firestore Database";
        statusEl.style.color = "#4cd964"; // Green success color
    }
} catch (e) {
    console.error("Firebase initialization failed:", e);
    if (statusEl) {
        statusEl.textContent = "Connection Failed";
        statusEl.style.color = "#ff3b30"; // Red error color
    }
}

// Fetch and Render Data on Load
if (db) {
    loadUsers();
    loadRequests();
}

function loadUsers() {
    db.collection("users").orderBy("lastSeen", "desc").get().then(querySnapshot => {
        const totalUsersEl = document.getElementById("stat-users");
        if (totalUsersEl) totalUsersEl.textContent = querySnapshot.size;
        
        const listContainer = document.getElementById("users-list");
        if (listContainer) {
            listContainer.replaceChildren();
            
            if (querySnapshot.empty) {
                listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">No registered users yet.</div>`;
                return;
            }
            
            querySnapshot.forEach(doc => {
                const u = doc.data();
                const row = document.createElement("div");
                row.className = "list-row";
                
                const joinedDateStr = u.joinedDate ? new Date(u.joinedDate.seconds * 1000).toLocaleDateString() : "Unknown";
                
                row.innerHTML = `
                    <div class="user-info">
                        <img src="${u.avatar || 'MOVIE/img/FilmHouse3_nobg.png'}" alt="Avatar" class="user-avatar" onerror="this.src='MOVIE/img/FilmHouse3_nobg.png'">
                        <div class="user-details">
                            <h5>${u.fullName || 'Guest User'}</h5>
                            <p>@${u.username || 'guest'} | ID: ${u.id}</p>
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
    }).catch(err => {
        console.error("Error loading users:", err);
        const listContainer = document.getElementById("users-list");
        if (listContainer) {
            listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--accent-red);">Error loading users list. Check console.</div>`;
        }
    });
}

function loadRequests() {
    db.collection("requests").orderBy("requestedAt", "desc").get().then(querySnapshot => {
        const totalRequestsEl = document.getElementById("stat-requests");
        if (totalRequestsEl) totalRequestsEl.textContent = querySnapshot.size;
        
        const listContainer = document.getElementById("requests-list");
        if (listContainer) {
            listContainer.replaceChildren();
            
            if (querySnapshot.empty) {
                listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">No movie requests yet.</div>`;
                return;
            }
            
            // Aggregate requests by title/type to find popular requests
            const counts = {};
            querySnapshot.forEach(doc => {
                const r = doc.data();
                const key = r.title;
                if (!counts[key]) {
                    counts[key] = { title: r.title, type: r.type, count: 0 };
                }
                counts[key].count++;
            });
            
            const sortedRequests = Object.values(counts).sort((a, b) => b.count - a.count);
            
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
    }).catch(err => {
        console.error("Error loading requests:", err);
        const listContainer = document.getElementById("requests-list");
        if (listContainer) {
            listContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--accent-red);">Error loading requests list. Check console.</div>`;
        }
    });
}
