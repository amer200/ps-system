const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'ps_system.db'));

db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY,
        name TEXT
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
        type TEXT DEFAULT 'order', -- 'order' للمشاريب، 'penalty' للغرامات
        FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    -- جدول المنتجات الديناميكي
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        price REAL,
        type TEXT DEFAULT 'order'
    );
`);

// إعداد الغرف
const countRooms = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
if (countRooms === 0) {
    const insert = db.prepare('INSERT INTO rooms (id, name) VALUES (?, ?)');
    for (let i = 1; i <= 6; i++) {
        insert.run(i, `Room ${i}`);
    }
}

// السعر الافتراضي للساعة
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('hourly_rate', '30')`).run();

// منتجات افتراضية للتجربة
const countProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
if (countProducts === 0) {
    const insertProd = db.prepare('INSERT INTO products (name, price, type) VALUES (?, ?, ?)');
    insertProd.run('شاي', 10, 'order');
    insertProd.run('قهوة', 15, 'order');
    insertProd.run('كانز', 20, 'order');
}

module.exports = db;