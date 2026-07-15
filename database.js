const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(app.getPath('userData'), 'ps_system.db');
const db = new Database(dbPath);

db.exec(`
    -- جدول الغرف بقى فيه السعر الخاص بكل غرفة
    CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        hourly_rate REAL DEFAULT 30
    );
    
    CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cashier_name TEXT,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        status TEXT DEFAULT 'active'
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
        type TEXT DEFAULT 'order',
        FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    -- جدول المنتجات اتضاف فيه نوع المنتج (معدود) والكمية
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        price REAL,
        type TEXT DEFAULT 'order',
        is_countable INTEGER DEFAULT 0,
        stock INTEGER DEFAULT 0
    );
`);

// كلمة سر المدير الافتراضية
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', '1234')`).run();

// إنشاء غرفة افتراضية لو البرنامج لسه جديد
const countRooms = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
if (countRooms === 0) {
    db.prepare('INSERT INTO rooms (name, hourly_rate) VALUES (?, ?)').run('غرفة 1', 30);
}

module.exports = db;