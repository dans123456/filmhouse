const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const keyPath = path.resolve(__dirname, '../firebase-key.json');
if (!fs.existsSync(keyPath)) {
    console.error('firebase-key.json not found at:', keyPath);
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function exportUsers() {
    console.log('Fetching users from Firestore collection "users"...');
    const snapshot = await db.collection('users').get();
    console.log(`Fetched ${snapshot.size} user documents.`);

    const userList = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        const id = String(doc.id);
        
        let joinedDate = Date.now();
        if (data.joinedDate) {
            if (typeof data.joinedDate.toMillis === 'function') joinedDate = data.joinedDate.toMillis();
            else if (typeof data.joinedDate.toDate === 'function') joinedDate = data.joinedDate.toDate().getTime();
            else if (data.joinedDate._seconds) joinedDate = data.joinedDate._seconds * 1000;
            else if (typeof data.joinedDate === 'number') joinedDate = data.joinedDate;
        }

        let lastSeen = Date.now();
        if (data.lastSeen) {
            if (typeof data.lastSeen.toMillis === 'function') lastSeen = data.lastSeen.toMillis();
            else if (typeof data.lastSeen.toDate === 'function') lastSeen = data.lastSeen.toDate().getTime();
            else if (data.lastSeen._seconds) lastSeen = data.lastSeen._seconds * 1000;
            else if (typeof data.lastSeen === 'number') lastSeen = data.lastSeen;
        }

        userList.push({
            id: id,
            username: data.username || '',
            fullName: data.fullName || 'Telegram User',
            points: Number(data.points || 0),
            badge: data.badge || '',
            blockedBot: data.blockedBot === true,
            banned: data.banned === true,
            joinedDate: joinedDate,
            lastSeen: lastSeen
        });
    });

    const dataDir = path.resolve(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const targetFile = path.join(dataDir, 'bot_users.json');
    fs.writeFileSync(targetFile, JSON.stringify(userList, null, 2), 'utf8');
    console.log(`Successfully exported ${userList.length} users to ${targetFile}`);
}

exportUsers()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Export failed:', err);
        process.exit(1);
    });
