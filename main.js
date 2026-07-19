const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database');

app.disableHardwareAcceleration();

function createWindow() {
    const win = new BrowserWindow({ width: 1200, height: 850, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    win.loadFile('index.html');
    win.maximize();
}

const getLocalNow = () => {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
};

// --- الغرف والأجهزة ---
ipcMain.handle('get-rooms', () => { return db.prepare('SELECT * FROM rooms').all(); });
ipcMain.handle('add-room', (e, { name, deviceType, ps4_s, ps4_m, ps5_s, ps5_m, simPrice }) => {
    db.prepare('INSERT INTO rooms (name, device_type, ps4_single, ps4_multi, ps5_single, ps5_multi, sim_price) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, deviceType, ps4_s || 0, ps4_m || 0, ps5_s || 0, ps5_m || 0, simPrice || 0);
    return { success: true };
});
ipcMain.handle('delete-room', (e, id) => { db.prepare('DELETE FROM rooms WHERE id = ?').run(id); return { success: true }; });

ipcMain.handle('switch-mode', (e, { roomId, newMode }) => {
    const session = db.prepare(`SELECT id FROM sessions WHERE room_id = ? AND status = 'active'`).get(roomId);
    if (session) {
        const nowStr = getLocalNow();
        db.prepare(`UPDATE session_intervals SET end_time = ? WHERE session_id = ? AND end_time IS NULL`).run(nowStr, session.id);
        db.prepare(`INSERT INTO session_intervals (session_id, play_mode, start_time) VALUES (?, ?, ?)`).run(session.id, newMode, nowStr);
        return { success: true };
    }
});

ipcMain.handle('toggle-room', (event, { roomId, playMode = 'single', consoleType = 'PS4', targetMinutes = 0 }) => {
    const activeSession = db.prepare(`SELECT * FROM sessions WHERE room_id = ? AND status IN ('active', 'pending_void')`).get(roomId);
    const nowStr = getLocalNow();

    if (activeSession) {
        if (activeSession.status === 'pending_void') return { status: 'error', message: 'الغرفة معلقة في انتظار الإلغاء!' };

        db.prepare(`UPDATE session_intervals SET end_time = ? WHERE session_id = ? AND end_time IS NULL`).run(nowStr, activeSession.id);
        const intervals = db.prepare(`SELECT * FROM session_intervals WHERE session_id = ?`).all(activeSession.id);

        let totalActualMins = 0;
        intervals.forEach(inv => {
            const m = Math.max(1, Math.ceil((new Date(inv.end_time.replace(' ', 'T')) - new Date(inv.start_time.replace(' ', 'T'))) / 60000));
            inv.actualMins = m;
            totalActualMins += m;
        });

        const roomData = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
        let timeCost = 0;
        let intervalsDetails = [];
        let totalBilledMins = 0;

        if (roomData.device_type === 'SIM') {
            totalBilledMins = Math.max(30, Math.ceil((totalActualMins - 5) / 30) * 30);
            if (totalActualMins <= 5) totalBilledMins = 30;
            timeCost = (totalBilledMins / 60) * roomData.sim_price;
            intervalsDetails.push({ mode: 'محاكي قيادة', actualMins: totalActualMins, cost: Math.round(timeCost) });
        } else {
            totalBilledMins = 60;
            if (totalActualMins >= 75) { totalBilledMins = 60 + Math.floor((totalActualMins - 60 + 15) / 30) * 30; }
            intervals.forEach(inv => {
                const ratio = inv.actualMins / totalActualMins;
                const billedForInv = totalBilledMins * ratio;
                let rate = 0;
                if (activeSession.console_type === 'PS4' && inv.play_mode === 'single') rate = roomData.ps4_single;
                if (activeSession.console_type === 'PS4' && inv.play_mode === 'multi') rate = roomData.ps4_multi;
                if (activeSession.console_type === 'PS5' && inv.play_mode === 'single') rate = roomData.ps5_single;
                if (activeSession.console_type === 'PS5' && inv.play_mode === 'multi') rate = roomData.ps5_multi;
                const cost = (billedForInv / 60) * rate;
                timeCost += cost;
                intervalsDetails.push({ mode: inv.play_mode === 'multi' ? 'Multi' : 'فردي', actualMins: inv.actualMins, cost: Math.round(cost) });
            });
        }

        const chargesDetails = db.prepare(`SELECT description, SUM(price) as price, COUNT(*) as qty, type FROM session_charges WHERE session_id = ? AND status = 'active' GROUP BY description, type`).all(activeSession.id);
        const ordersCost = chargesDetails.reduce((sum, charge) => sum + charge.price, 0);
        const finalTotal = timeCost + ordersCost;

        db.prepare(`UPDATE sessions SET total_price = ?, status = 'closed', end_time = ? WHERE id = ?`).run(finalTotal, nowStr, activeSession.id);
        return { status: 'stopped', bill: { roomName: roomData.name, actualMinutes: totalActualMins, billedMinutes: totalBilledMins, timeCost: Math.round(timeCost), ordersCost, total: Math.round(finalTotal), chargesDetails, intervalsDetails } };
    } else {
        db.prepare(`INSERT INTO sessions (room_id, start_time, status, console_type, target_minutes) VALUES (?, ?, 'active', ?, ?)`).run(roomId, nowStr, consoleType, targetMinutes);
        const newSessionId = db.prepare(`SELECT last_insert_rowid() as id`).get().id;
        db.prepare(`INSERT INTO session_intervals (session_id, play_mode, start_time) VALUES (?, ?, ?)`).run(newSessionId, playMode, nowStr);
        const newSession = db.prepare(`SELECT start_time FROM sessions WHERE id = ?`).get(newSessionId);
        return { status: 'started', startTime: newSession.start_time, playMode, consoleType, targetMinutes };
    }
});

ipcMain.handle('get-active-sessions', () => { return db.prepare(`SELECT s.room_id, s.start_time, s.status, s.console_type, s.target_minutes, (SELECT play_mode FROM session_intervals WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as play_mode FROM sessions s WHERE s.status = 'active'`).all(); });

// --- المخزن والطلبات ---
ipcMain.handle('get-products', () => { return db.prepare(`SELECT * FROM products ORDER BY type, name`).all(); });
ipcMain.handle('add-product', (e, { name, price, type, isCountable, stock }) => { try { db.prepare(`INSERT INTO products (name, price, type, is_countable, stock) VALUES (?, ?, ?, ?, ?)`).run(name, price, type, isCountable ? 1 : 0, stock || 0); return { success: true }; } catch (err) { return { success: false, message: 'المنتج موجود بالفعل.' }; } });
ipcMain.handle('delete-product', (e, id) => { db.prepare(`DELETE FROM products WHERE id = ?`).run(id); return { success: true }; });
ipcMain.handle('add-charge', (e, { roomId, description, price, type = 'order', productId = null }) => {
    const activeSession = db.prepare(`SELECT id FROM sessions WHERE room_id = ? AND status = 'active'`).get(roomId);
    if (!activeSession) return { success: false, message: 'الغرفة غير مشغولة.' };
    if (productId) {
        const prod = db.prepare(`SELECT is_countable, stock FROM products WHERE id = ?`).get(productId);
        if (prod && prod.is_countable === 1) {
            if (prod.stock <= 0) return { success: false, message: 'نفذ الرصيد!' };
            db.prepare(`UPDATE products SET stock = stock - 1 WHERE id = ?`).run(productId);
        }
    }
    db.prepare(`INSERT INTO session_charges (session_id, product_id, description, price, type) VALUES (?, ?, ?, ?, ?)`).run(activeSession.id, productId, description, price, type);
    return { success: true };
});
ipcMain.handle('get-room-charges', (e, roomId) => {
    const activeSession = db.prepare(`SELECT id FROM sessions WHERE room_id = ? AND status IN ('active', 'pending_void')`).get(roomId);
    if (!activeSession) return [];
    return db.prepare(`SELECT id, description, price, type, status FROM session_charges WHERE session_id = ? AND status != 'refunded' ORDER BY id DESC`).all(activeSession.id);
});
ipcMain.handle('add-direct-order', (e, { cart }) => {
    const activeShift = db.prepare(`SELECT id FROM shifts WHERE status = 'active'`).get();
    if (!activeShift) return { success: false, message: 'لا يوجد شيفت مفتوح' };
    const nowStr = getLocalNow();
    cart.forEach(item => {
        if (item.productId) {
            const prod = db.prepare(`SELECT is_countable, stock FROM products WHERE id = ?`).get(item.productId);
            if (prod && prod.is_countable === 1) { db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`).run(item.qty, item.productId); }
        }
        for (let i = 0; i < item.qty; i++) { db.prepare(`INSERT INTO direct_orders (shift_id, product_id, description, price, type, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(activeShift.id, item.productId, item.name, item.price, item.type, nowStr); }
    });
    return { success: true };
});

// --- المرتجعات ---
ipcMain.handle('request-refund', (e, { type, id, description, amount }) => {
    const shift = db.prepare(`SELECT id FROM shifts WHERE status = 'active'`).get();
    if (!shift) return { success: false };
    db.prepare(`INSERT INTO refund_requests (shift_id, type, reference_id, description, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(shift.id, type, id, description, amount, getLocalNow());
    if (type === 'charge') db.prepare(`UPDATE session_charges SET status = 'pending_refund' WHERE id = ?`).run(id);
    if (type === 'session') db.prepare(`UPDATE sessions SET status = 'pending_void' WHERE room_id = ? AND status = 'active'`).run(id);
    return { success: true };
});
ipcMain.handle('get-pending-refunds', () => { return db.prepare(`SELECT * FROM refund_requests WHERE status = 'pending'`).all(); });
ipcMain.handle('process-refund', (e, { reqId, action }) => {
    const req = db.prepare(`SELECT * FROM refund_requests WHERE id = ?`).get(reqId);
    if (!req) return;
    db.prepare(`UPDATE refund_requests SET status = ? WHERE id = ?`).run(action === 'approve' ? 'approved' : 'rejected', reqId);
    if (action === 'approve') {
        if (req.type === 'charge') {
            db.prepare(`UPDATE session_charges SET status = 'refunded' WHERE id = ?`).run(req.reference_id);
            const charge = db.prepare(`SELECT product_id FROM session_charges WHERE id = ?`).get(req.reference_id);
            // التأكد من استرجاع المخزن فقط لو كان معدود
            if (charge && charge.product_id) db.prepare(`UPDATE products SET stock = stock + 1 WHERE id = ? AND is_countable = 1`).run(charge.product_id);
        }
        if (req.type === 'session') {
            const sess = db.prepare(`SELECT id FROM sessions WHERE room_id = ? AND status = 'pending_void'`).get(req.reference_id);
            if (sess) db.prepare(`UPDATE sessions SET status = 'voided', total_price = 0, end_time = ? WHERE id = ?`).run(getLocalNow(), sess.id);
        }
    } else {
        if (req.type === 'charge') db.prepare(`UPDATE session_charges SET status = 'active' WHERE id = ?`).run(req.reference_id);
        if (req.type === 'session') db.prepare(`UPDATE sessions SET status = 'active' WHERE room_id = ? AND status = 'pending_void'`).run(req.reference_id);
    }
    return { success: true };
});

ipcMain.handle('void-room', (e, { roomId, voidType }) => {
    const activeSession = db.prepare(`SELECT * FROM sessions WHERE room_id = ? AND status = 'active'`).get(roomId);
    if (!activeSession) return { success: false, message: 'الغرفة غير مشغولة.' };
    const shift = db.prepare(`SELECT id FROM shifts WHERE status = 'active'`).get();
    const nowStr = getLocalNow();

    // حساب تكلفة الوقت
    db.prepare(`UPDATE session_intervals SET end_time = ? WHERE session_id = ? AND end_time IS NULL`).run(nowStr, activeSession.id);
    const intervals = db.prepare(`SELECT * FROM session_intervals WHERE session_id = ?`).all(activeSession.id);
    let totalActualMins = 0;
    intervals.forEach(inv => { totalActualMins += Math.max(1, Math.ceil((new Date(inv.end_time.replace(' ', 'T')) - new Date(inv.start_time.replace(' ', 'T'))) / 60000)); });

    const roomData = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    let timeCost = 0;
    let totalBilledMins = 0;
    if (roomData.device_type === 'SIM') {
        totalBilledMins = Math.max(30, Math.ceil((totalActualMins - 5) / 30) * 30);
        timeCost = Math.round((totalBilledMins / 60) * roomData.sim_price);
    } else {
        totalBilledMins = 60;
        if (totalActualMins >= 75) totalBilledMins = 60 + Math.floor((totalActualMins - 60 + 15) / 30) * 30;
        intervals.forEach(inv => {
            const ratio = inv.actualMins / totalActualMins;
            let rate = 0;
            if (activeSession.console_type === 'PS4' && inv.play_mode === 'single') rate = roomData.ps4_single;
            if (activeSession.console_type === 'PS4' && inv.play_mode === 'multi') rate = roomData.ps4_multi;
            if (activeSession.console_type === 'PS5' && inv.play_mode === 'single') rate = roomData.ps5_single;
            if (activeSession.console_type === 'PS5' && inv.play_mode === 'multi') rate = roomData.ps5_multi;
            timeCost += Math.round(((totalBilledMins * ratio) / 60) * rate);
        });
    }

    const chargesDetails = db.prepare(`SELECT * FROM session_charges WHERE session_id = ? AND status = 'active'`).all(activeSession.id);
    const ordersCost = chargesDetails.reduce((sum, charge) => sum + charge.price, 0);

    if (voidType === 'time') {
        if (timeCost > 0) db.prepare(`INSERT INTO refund_requests (shift_id, type, reference_id, description, amount, created_at) VALUES (?, 'session_time', ?, ?, ?, ?)`).run(shift.id, activeSession.id, `إلغاء وقت: ${roomData.name}`, timeCost, nowStr);
        db.prepare(`UPDATE sessions SET status = 'closed', end_time = ?, total_price = ? WHERE id = ?`).run(nowStr, ordersCost, activeSession.id);
    } else {
        if (timeCost > 0) db.prepare(`INSERT INTO refund_requests (shift_id, type, reference_id, description, amount, created_at) VALUES (?, 'session_time', ?, ?, ?, ?)`).run(shift.id, activeSession.id, `إلغاء وقت: ${roomData.name}`, timeCost, nowStr);
        chargesDetails.forEach(c => {
            db.prepare(`INSERT INTO refund_requests (shift_id, type, reference_id, description, amount, created_at) VALUES (?, 'charge', ?, ?, ?, ?)`).run(shift.id, c.id, `إلغاء طلب: ${c.description}`, c.price, nowStr);
            db.prepare(`UPDATE session_charges SET status = 'pending_refund' WHERE id = ?`).run(c.id);
        });
        db.prepare(`UPDATE sessions SET status = 'pending_void', total_price = 0 WHERE id = ?`).run(activeSession.id);
    }
    return { success: true };
});

ipcMain.handle('check-active-shift', () => { return db.prepare(`SELECT * FROM shifts WHERE status = 'active'`).get(); });
ipcMain.handle('start-shift', (e, name) => { db.prepare(`INSERT INTO shifts (cashier_name, status, start_time) VALUES (?, 'active', ?)`).run(name, getLocalNow()); return db.prepare(`SELECT * FROM shifts WHERE id = last_insert_rowid()`).get(); });

ipcMain.handle('end-shift', () => {
    const shift = db.prepare(`SELECT * FROM shifts WHERE status = 'active'`).get();
    if (!shift) return { success: false };

    const shiftSessions = db.prepare(`SELECT id, room_id FROM sessions WHERE status = 'closed' AND end_time >= ?`).all(shift.start_time);
    let totalMins = 0;
    shiftSessions.forEach(s => {
        const rData = db.prepare(`SELECT device_type FROM rooms WHERE id = ?`).get(s.room_id);
        const invs = db.prepare(`SELECT * FROM session_intervals WHERE session_id = ?`).all(s.id);
        let M = 0;
        invs.forEach(i => { M += Math.max(1, Math.ceil((new Date(i.end_time.replace(' ', 'T')) - new Date(i.start_time.replace(' ', 'T'))) / 60000)); });
        let billed = 60;
        if (rData.device_type == 'SIM') billed = Math.max(30, Math.ceil((M - 5) / 30) * 30);
        else if (M >= 75) billed = 60 + Math.floor((M - 60 + 15) / 30) * 30;
        totalMins += billed;
    });

    const soldItems = db.prepare(`
        SELECT description, COUNT(*) as qty, SUM(price) as total_price FROM (
            SELECT description, price FROM session_charges sc JOIN sessions s ON sc.session_id = s.id WHERE s.status = 'closed' AND s.end_time >= ? AND sc.type = 'order' AND sc.status = 'active'
            UNION ALL
            SELECT description, price FROM direct_orders WHERE shift_id = ? AND type = 'order' AND status = 'active'
        ) GROUP BY description
    `).all(shift.start_time, shift.id);

    const shiftSales = db.prepare(`SELECT SUM(total_price) as total FROM sessions WHERE status = 'closed' AND end_time >= ?`).get(shift.start_time).total || 0;
    const directSales = db.prepare(`SELECT SUM(price) as total FROM direct_orders WHERE shift_id = ? AND status = 'active'`).get(shift.id).total || 0;
    const totalAllSales = shiftSales + directSales;

    const detailsJson = JSON.stringify({ totalHours: (totalMins / 60).toFixed(1), soldItems });
    db.prepare(`UPDATE shifts SET end_time = ?, status = 'closed', shift_details = ? WHERE id = ?`).run(getLocalNow(), detailsJson, shift.id);

    return { success: true, cashierName: shift.cashier_name, totalSales: Math.round(totalAllSales), detailsObj: JSON.parse(detailsJson) };
});

ipcMain.handle('verify-password', (e, pwd) => { const r = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get(); return pwd === (r ? r.value : '1234'); });
ipcMain.handle('update-password', (e, pwd) => { db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password', ?)`).run(pwd.toString()); return { success: true }; });
ipcMain.handle('get-daily-reports', () => {
    // نجيب الشفت المفتوح حالياً عشان نربط بيه
    const activeShift = db.prepare(`SELECT id FROM shifts WHERE status = 'active'`).get();
    if (!activeShift) return { totalSales: 0, totalRefunds: 0 };

    // 1. حساب مبيعات الغرف (Sessions) الخاصة بالشفت المفتوح
    const sSales = db.prepare(`
        SELECT SUM(total_price) as total FROM sessions 
        WHERE status = 'closed' AND start_time >= (SELECT start_time FROM shifts WHERE id = ?)
    `).get(activeShift.id).total || 0;

    // 2. حساب مبيعات الكافيتريا (Direct Orders) الخاصة بنفس الشفت
    const dSales = db.prepare(`
        SELECT SUM(price) as total FROM direct_orders 
        WHERE shift_id = ? AND status = 'active'
    `).get(activeShift.id).total || 0;

    // 3. حساب المرتجعات المعتمدة
    const ref = db.prepare(`
        SELECT SUM(amount) as total FROM refund_requests 
        WHERE status = 'approved' AND shift_id = ?
    `).get(activeShift.id).total || 0;

    console.log("Debug Sales:", { sSales, dSales, ref }); // افتح الـ Terminal عشان تشوف الأرقام دي
    return { totalSales: Math.round(sSales + dSales), totalRefunds: Math.round(ref) };
});
ipcMain.handle('get-shifts-history', () => { return db.prepare(`SELECT * FROM shifts WHERE status = 'closed' ORDER BY start_time DESC`).all().map(s => ({...s, details: s.shift_details ? JSON.parse(s.shift_details) : { totalHours: 0, soldItems: [] } })); });

app.whenReady().then(createWindow);