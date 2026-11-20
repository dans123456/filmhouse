const fs = require("fs");
const path = require("path");

class LocalUserStore {
    constructor(filePath) {
        this.filePath = filePath || path.join(__dirname, "data", "bot_users.json");
        this.users = new Map();
        this.saveTimeout = null;
        this.init();
    }

    init() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, "utf8");
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    data.forEach(u => {
                        if (u && u.id) this.users.set(String(u.id), u);
                    });
                } else if (typeof data === "object" && data !== null) {
                    Object.values(data).forEach(u => {
                        if (u && u.id) this.users.set(String(u.id), u);
                    });
                }
                console.log(`[LocalUserStore] Loaded ${this.users.size} bot users from local storage.`);
            } else {
                console.log("[LocalUserStore] Initialized new empty bot users store.");
            }
        } catch (err) {
            console.error("[LocalUserStore] Failed to load local users file:", err.message);
        }
    }

    scheduleSave() {
        if (this.saveTimeout) return;
        this.saveTimeout = setTimeout(() => {
            this.saveTimeout = null;
            this.flushToDisk();
        }, 1000); // 1-second debounce
    }

    flushToDisk() {
        const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            const arr = Array.from(this.users.values());
            fs.writeFileSync(tempPath, JSON.stringify(arr, null, 2), "utf8");
            fs.renameSync(tempPath, this.filePath);
        } catch (err) {
            console.error("[LocalUserStore] Error writing users to disk:", err.message);
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        }
    }

    getUser(userId) {
        if (!userId) return null;
        return this.users.get(String(userId)) || null;
    }

    upsertUser(user) {
        if (!user || !user.id) return;
        const id = String(user.id);
        const existing = this.users.get(id) || {};
        const updated = {
            ...existing,
            ...user,
            id: id,
            lastSeen: user.lastSeen || Date.now()
        };
        this.users.set(id, updated);
        this.scheduleSave();
        return updated;
    }

    setBlocked(userId, isBlocked) {
        if (!userId) return;
        const id = String(userId);
        let user = this.users.get(id);
        if (!user) {
            user = {
                id: id,
                username: "",
                fullName: "Telegram User",
                points: 0,
                badge: "",
                blockedBot: Boolean(isBlocked),
                banned: false,
                joinedDate: Date.now(),
                lastSeen: Date.now()
            };
            this.users.set(id, user);
        } else {
            user.blockedBot = Boolean(isBlocked);
        }
        this.scheduleSave();
    }

    setBanned(userId, isBanned) {
        if (!userId) return;
        const id = String(userId);
        let user = this.users.get(id);
        if (!user) {
            user = {
                id: id,
                username: "",
                fullName: "Telegram User",
                points: 0,
                badge: "",
                blockedBot: false,
                banned: Boolean(isBanned),
                joinedDate: Date.now(),
                lastSeen: Date.now()
            };
            this.users.set(id, user);
        } else {
            user.banned = Boolean(isBanned);
        }
        this.scheduleSave();
    }

    getAllUsers() {
        return Array.from(this.users.values());
    }

    getActiveSubscribers() {
        return Array.from(this.users.values()).filter(u => u.blockedBot !== true && u.banned !== true);
    }

    getCount() {
        return this.users.size;
    }

    // Background sync from Firestore (runs once or periodically without crashing on quota error)
    async syncFromFirestore(db) {
        if (!db) return;
        try {
            console.log("[LocalUserStore] Attempting one-time background sync from Firestore users collection...");
            const snapshot = await db.collection("users").get();
            let addedCount = 0;
            const parseTs = (val) => {
                if (!val) return Date.now();
                if (typeof val === "number") return val;
                if (typeof val.toMillis === "function") return val.toMillis();
                if (typeof val.toDate === "function") return val.toDate().getTime();
                if (typeof val._seconds === "number") return val._seconds * 1000;
                if (typeof val.seconds === "number") return val.seconds * 1000;
                const d = new Date(val).getTime();
                return isNaN(d) ? Date.now() : d;
            };
            snapshot.forEach(doc => {
                const data = doc.data();
                const id = String(doc.id);
                const existing = this.users.get(id);
                if (!existing) {
                    this.users.set(id, {
                        id: id,
                        username: data.username || "",
                        fullName: data.fullName || "Telegram User",
                        points: data.points || 0,
                        badge: data.badge || "",
                        blockedBot: data.blockedBot === true,
                        banned: data.banned === true,
                        joinedDate: parseTs(data.joinedDate),
                        lastSeen: parseTs(data.lastSeen)
                    });
                    addedCount++;
                } else {
                    let changed = false;
                    if (data.blockedBot !== undefined && existing.blockedBot !== (data.blockedBot === true)) {
                        existing.blockedBot = (data.blockedBot === true);
                        changed = true;
                    }
                    if (data.banned !== undefined && existing.banned !== (data.banned === true)) {
                        existing.banned = (data.banned === true);
                        changed = true;
                    }
                    if (data.username && existing.username !== data.username) {
                        existing.username = data.username;
                        changed = true;
                    }
                    if (data.points !== undefined && existing.points !== data.points) {
                        existing.points = data.points;
                        changed = true;
                    }
                    if (changed) addedCount++;
                }
            });
            if (addedCount > 0) {
                this.flushToDisk();
                console.log(`[LocalUserStore] Successfully synced ${addedCount} new users from Firestore. Total users: ${this.users.size}`);
            } else {
                console.log(`[LocalUserStore] Sync complete. All Firestore users already present in local store.`);
            }
        } catch (err) {
            console.warn(`[LocalUserStore] Background Firestore sync postponed (${err.message || 'quota exceeded'}). Local store operating independently.`);
        }
    }
}

module.exports = LocalUserStore;
