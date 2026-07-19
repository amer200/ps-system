const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(app.getPath('userData'), 'ps_system.db');
const db = new Database(dbPath);

db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, device_type TEXT DEFAULT 'PS',
        ps4_single REAL DEFAULT 20, ps4_multi REAL DEFAULT 30, ps5_single REAL DEFAULT 40, ps5_multi REAL DEFAULT 50,
        sim_price REAL DEFAULT 50
    );
    CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, cashier_name TEXT, start_time DATETIME DEFAULT CURRENT_TIMESTAMP, end_time DATETIME, status TEXT DEFAULT 'active', shift_details TEXT 
    );
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER, start_time DATETIME, end_time DATETIME, status TEXT DEFAULT 'active', console_type TEXT DEFAULT 'PS4', target_minutes INTEGER DEFAULT 0, total_price REAL DEFAULT 0,
        FOREIGN KEY(room_id) REFERENCES rooms(id)
    );
    CREATE TABLE IF NOT EXISTS session_intervals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, play_mode TEXT, start_time DATETIME DEFAULT CURRENT_TIMESTAMP, end_time DATETIME
    );
    CREATE TABLE IF NOT EXISTS session_charges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, product_id INTEGER, description TEXT, price REAL, type TEXT DEFAULT 'order', status TEXT DEFAULT 'active',
        FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, price REAL, type TEXT DEFAULT 'order', is_countable INTEGER DEFAULT 0, stock INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS direct_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER, product_id INTEGER, description TEXT, price REAL, type TEXT DEFAULT 'order', status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS refund_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER, type TEXT, reference_id INTEGER, description TEXT, amount REAL, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', '1234')`).run();
const countRooms = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
if (countRooms === 0) {
    db.prepare('INSERT INTO rooms (name, device_type, ps4_single, ps4_multi, ps5_single, ps5_multi) VALUES (?, ?, ?, ?, ?, ?)').run('غرفة 1', 'PS', 20, 30, 40, 50);
    db.prepare('INSERT INTO rooms (name, device_type, sim_price) VALUES (?, ?, ?)').run('محاكي سيارات 1', 'SIM', 60);
}

module.exports = db;