const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database');

app.disableHardwareAcceleration();

function createWindow() {
    const win = new BrowserWindow({ width: 1200, height: 850, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    win.loadFile('index.html');
}

// --------------------------------------------------------
// 1. إدارة الغرف وحساب الوقت الجديد
// --------------------------------------------------------
ipcMain.handle('get-rooms', () => {
    return db.prepare('SELECT * FROM rooms').all();
});

ipcMain.handle('add-room', (event, { name, rate }) => {
    db.prepare('INSERT INTO rooms (name, hourly_rate) VALUES (?, ?)').run(name, rate);
    return { success: true };
});

ipcMain.handle('delete-room', (event, id) => {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    return { success: true };
});

ipcMain.handle('toggle-room', (event, roomId) => {
    const activeSession = db.prepare(`SELECT * FROM sessions WHERE room_id = ? AND status = 'active'`).get(roomId);

    if (activeSession) {
        db.prepare(`UPDATE sessions SET end_time = datetime('now', 'localtime'), status = 'closed' WHERE id = ?`).run(activeSession.id);
        const sessionData = db.prepare(`SELECT start_time, end_time FROM sessions WHERE id = ?`).get(activeSession.id);

        const start = new Date(sessionData.start_time.replace(' ', 'T'));
        const end = new Date(sessionData.end_time.replace(' ', 'T'));
        const diffMinutes = Math.max(1, Math.ceil((end - start) / 60000));

        // خوارزمية الوقت الجديدة: أقل حاجة ساعة، وبعدها بيقرب لكل نص ساعة
        let billedMinutes = 60; // الحد الأدنى
        if (diffMinutes > 60) {
            billedMinutes = 60 + Math.ceil((diffMinutes - 60) / 30) * 30;
        }

        // جلب سعر الساعة الخاص بالغرفة دي تحديداً
        const roomData = db.prepare(`SELECT hourly_rate, name FROM rooms WHERE id = ?`).get(roomId);
        const hourlyRate = roomData ? roomData.hourly_rate : 30;
        const roomName = roomData ? roomData.name : roomId;

        const timeCost = (billedMinutes / 60) * hourlyRate;
        const chargesDetails = db.prepare(`SELECT description, price, type FROM session_charges WHERE session_id = ?`).all(activeSession.id);
        const ordersCost = chargesDetails.reduce((sum, charge) => sum + charge.price, 0);

        const finalTotal = timeCost + ordersCost;
        db.prepare(`UPDATE sessions SET total_price = ? WHERE id = ?`).run(finalTotal, activeSession.id);

        return {
            status: 'stopped',
            bill: { roomName, actualMinutes: diffMinutes, billedMinutes: billedMinutes, timeCost: Math.round(timeCost), ordersCost: ordersCost, total: Math.round(finalTotal), chargesDetails: chargesDetails }
        };
    } else {
        db.prepare(`INSERT INTO sessions (room_id, start_time, status) VALUES (?, datetime('now', 'localtime'), 'active')`).run(roomId);
        const newSession = db.prepare(`SELECT start_time FROM sessions WHERE id = last_insert_rowid()`).get();
        return { status: 'started', startTime: newSession.start_time };
    }
});

ipcMain.handle('get-active-sessions', () => {
    return db.prepare(`SELECT room_id, start_time FROM sessions WHERE status = 'active'`).all();
});

// --------------------------------------------------------
// 2. المخزن والمنتجات
// --------------------------------------------------------
ipcMain.handle('get-products', () => { return db.prepare(`SELECT * FROM products ORDER BY type, name`).all(); });

ipcMain.handle('add-product', (event, { name, price, type, isCountable, stock }) => {
    try {
        db.prepare(`INSERT INTO products (name, price, type, is_countable, stock) VALUES (?, ?, ?, ?, ?)`).run(name, price, type, isCountable ? 1 : 0, stock || 0);
        return { success: true };
    } catch (err) { return { success: false, message: 'هذا المنتج موجود بالفعل أو حدث خطأ.' }; }
});

ipcMain.handle('delete-product', (event, id) => {
    db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
    return { success: true };
});

ipcMain.handle('add-charge', (event, { roomId, description, price, type = 'order', productId = null }) => {
    const activeSession = db.prepare(`SELECT id FROM sessions WHERE room_id = ? AND status = 'active'`).get(roomId);
    if (!activeSession) return { success: false, message: 'الغرفة غير مشغولة حالياً.' };

    // لو المنتج معدود، نخصم من المخزن
    if (productId) {
        const prod = db.prepare(`SELECT is_countable, stock FROM products WHERE id = ?`).get(productId);
        if (prod && prod.is_countable === 1) {
            if (prod.stock <= 0) return { success: false, message: 'عفواً! رصيد هذا الصنف نفذ من المخزن.' };
            db.prepare(`UPDATE products SET stock = stock - 1 WHERE id = ?`).run(productId);
        }
    }

    db.prepare(`INSERT INTO session_charges (session_id, description, price, type) VALUES (?, ?, ?, ?)`).run(activeSession.id, description, price, type);
    return { success: true };
});

ipcMain.handle('get-room-charges', (event, roomId) => {
    const activeSession = db.prepare(`SELECT id FROM sessions WHERE room_id = ? AND status = 'active'`).get(roomId);
    if (!activeSession) return [];
    return db.prepare(`SELECT * FROM session_charges WHERE session_id = ?`).all(activeSession.id);
});

// --------------------------------------------------------
// 3. الورديات، المدير، وتقارير الشفتات (بدون تعديل)
// --------------------------------------------------------
ipcMain.handle('check-active-shift', () => { return db.prepare(`SELECT * FROM shifts WHERE status = 'active'`).get(); });
ipcMain.handle('start-shift', (event, cashierName) => {
    db.prepare(`INSERT INTO shifts (cashier_name, start_time, status) VALUES (?, datetime('now', 'localtime'), 'active')`).run(cashierName);
    return db.prepare(`SELECT * FROM shifts WHERE id = last_insert_rowid()`).get();
});
ipcMain.handle('end-shift', () => {
    const activeShift = db.prepare(`SELECT * FROM shifts WHERE status = 'active'`).get();
    if (!activeShift) return { success: false, message: 'لا يوجد شيفت مفتوح حالياً' };

    const shiftSales = db.prepare(`SELECT SUM(total_price) as total FROM sessions WHERE status = 'closed' AND end_time >= ?`).get(activeShift.start_time).total || 0;
    const shiftOrdersOnly = db.prepare(`SELECT SUM(sc.price) as total FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND s.end_time >= ? AND sc.type = 'order'`).get(activeShift.start_time).total || 0;
    const shiftPenaltiesOnly = db.prepare(`SELECT SUM(sc.price) as total FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND s.end_time >= ? AND sc.type = 'penalty'`).get(activeShift.start_time).total || 0;
    const shiftTime = shiftSales - shiftOrdersOnly - shiftPenaltiesOnly;

    const penaltiesList = db.prepare(`SELECT sc.description, sc.price, s.room_id FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND s.end_time >= ? AND sc.type = 'penalty'`).all(activeShift.start_time);
    db.prepare(`UPDATE shifts SET end_time = datetime('now', 'localtime'), status = 'closed' WHERE id = ?`).run(activeShift.id);

    return { success: true, cashierName: activeShift.cashier_name, startTime: activeShift.start_time, totalSales: Math.round(shiftSales), totalTime: Math.round(shiftTime), totalOrders: Math.round(shiftOrdersOnly), totalPenalties: Math.round(shiftPenaltiesOnly), penaltiesDetails: penaltiesList };
});

ipcMain.handle('verify-password', (event, pwd) => {
    const stored = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get();
    return pwd === (stored ? stored.value : '1234');
});
ipcMain.handle('update-password', (event, newPwd) => {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password', ?)`).run(newPwd.toString());
    return { success: true };
});
ipcMain.handle('get-daily-reports', () => {
    const totalSales = db.prepare(`SELECT SUM(total_price) as total FROM sessions WHERE status = 'closed' AND date(end_time) = date('now', 'localtime')`).get().total || 0;
    const totalCharges = db.prepare(`SELECT SUM(sc.price) as total FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND date(s.end_time) = date('now', 'localtime') AND sc.type = 'order'`).get().total || 0;
    const totalPenalties = db.prepare(`SELECT SUM(sc.price) as total FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND date(s.end_time) = date('now', 'localtime') AND sc.type = 'penalty'`).get().total || 0;
    return { totalSales: Math.round(totalSales), totalTime: Math.round(totalSales - totalCharges - totalPenalties), totalCharges: Math.round(totalCharges), totalPenalties: Math.round(totalPenalties) };
});
ipcMain.handle('get-shifts-history', () => {
    return db.prepare(`SELECT * FROM shifts WHERE status = 'closed' ORDER BY start_time DESC`).all().map(shift => {
        const shiftSales = db.prepare(`SELECT SUM(total_price) as total FROM sessions WHERE status = 'closed' AND end_time >= ? AND end_time <= ?`).get(shift.start_time, shift.end_time).total || 0;
        const shiftOrders = db.prepare(`SELECT SUM(sc.price) as total FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND s.end_time >= ? AND s.end_time <= ? AND sc.type = 'order'`).get(shift.start_time, shift.end_time).total || 0;
        const shiftPenalties = db.prepare(`SELECT SUM(sc.price) as total FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND s.end_time >= ? AND s.end_time <= ? AND sc.type = 'penalty'`).get(shift.start_time, shift.end_time).total || 0;
        return {...shift, totalSales: Math.round(shiftSales), totalOrders: Math.round(shiftOrders), totalPenalties: Math.round(shiftPenalties), totalTime: Math.round(shiftSales - shiftOrders - shiftPenalties) };
    });
});
ipcMain.handle('get-penalties-log', () => {
    return db.prepare(`SELECT sc.description, sc.price, s.room_id, s.end_time FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE sc.type = 'penalty' AND s.status = 'closed' ORDER BY s.end_time DESC LIMIT 100`).all();
});

app.whenReady().then(createWindow);