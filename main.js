const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database');

// لتعطيل تسريع كارت الشاشة وإخفاء خطأ لينكس
app.disableHardwareAcceleration();

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    win.loadFile('index.html');
}

// تعديل دالة toggle-room (استخدام 'localtime' للحصول على التوقيت الصحيح)
ipcMain.handle('toggle-room', (event, roomId) => {
    const activeSession = db.prepare(`SELECT * FROM sessions WHERE room_id = ? AND status = 'active'`).get(roomId);

    if (activeSession) {
        db.prepare(`UPDATE sessions SET end_time = datetime('now', 'localtime'), status = 'closed' WHERE id = ?`).run(activeSession.id);
        return { status: 'stopped', message: 'تم إيقاف الغرفة' };
    } else {
        db.prepare(`INSERT INTO sessions (room_id, start_time, status) VALUES (?, datetime('now', 'localtime'), 'active')`).run(roomId);
        // نجلب وقت البداية الفعلي لارساله للواجهة
        const newSession = db.prepare(`SELECT start_time FROM sessions WHERE id = last_insert_rowid()`).get();
        return { status: 'started', message: 'تم بدء الجلسة', startTime: newSession.start_time };
    }
});

// إضافة دالة جديدة لاسترجاع الغرف الشغالة عند فتح البرنامج
ipcMain.handle('get-active-sessions', () => {
    return db.prepare(`SELECT room_id, start_time FROM sessions WHERE status = 'active'`).all();
});

app.whenReady().then(createWindow);