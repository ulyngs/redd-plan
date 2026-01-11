const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

// Window state persistence
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        if (fs.existsSync(windowStateFile)) {
            const data = fs.readFileSync(windowStateFile, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        log.warn('Failed to load window state:', e.message);
    }
    return null;
}

function saveWindowState(win) {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized() || win.isFullScreen()) return;

    try {
        const bounds = win.getBounds();
        const isMaximized = win.isMaximized();
        const state = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized
        };
        fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2));
    } catch (e) {
        log.warn('Failed to save window state:', e.message);
    }
}

let mainWindow;

// Ensure logs go to a file
log.transports.file.level = 'info';

function createMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: 'File',
            submenu: [
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                ...(isMac ? [
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' }
                ] : [
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' }
                ])
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front' }
                ] : [
                    { role: 'close' }
                ])
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function createMainWindow() {
    // Load saved window state or use defaults
    const savedState = loadWindowState();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // Default to nearly full screen
    const defaultWidth = Math.round(screenWidth * 0.95);
    const defaultHeight = Math.round(screenHeight * 0.9);

    mainWindow = new BrowserWindow({
        width: savedState?.width || defaultWidth,
        height: savedState?.height || defaultHeight,
        x: savedState?.x,
        y: savedState?.y,
        minWidth: 800,
        minHeight: 500,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        frame: false,
        resizable: true,
        minimizable: true,
        maximizable: true,
        closable: true,
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, 'assets/icon.png')
    });

    // Maximize if was previously maximized or on first run
    if (savedState?.isMaximized || !savedState) {
        mainWindow.maximize();
    }

    mainWindow.loadFile('src/index.html');

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    // Save window state when resized or moved
    mainWindow.on('resize', () => saveWindowState(mainWindow));
    mainWindow.on('move', () => saveWindowState(mainWindow));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// IPC handlers
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

// Window control IPC handlers
ipcMain.on('window-minimize', () => {
    if (mainWindow) {
        mainWindow.minimize();
    }
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) {
        mainWindow.close();
    }
});

app.on('ready', () => {
    createMainWindow();
    createMenu();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createMainWindow();
    }
});
