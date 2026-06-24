const Database = require('better-sqlite3');
const path = require('path');

// إنشاء أو فتح قاعدة البيانات
const db = new Database(path.join(__dirname, 'ps_system.db'));

// إنشاء الجداول الأساسية
db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY,
        name TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER,
        start_time DATETIME,
        end_time DATETIME,
        status TEXT DEFAULT 'active',
        total_price REAL DEFAULT 0,
        FOREIGN KEY(room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS session_charges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        description TEXT,
        price REAL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
`);

// إدخال الـ 6 غرف لو لم تكن موجودة
const count = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
if (count === 0) {
    const insert = db.prepare('INSERT INTO rooms (id, name) VALUES (?, ?)');
    for (let i = 1; i <= 6; i++) {
        insert.run(i, `Room ${i}`);
    }
}

module.exports = db;