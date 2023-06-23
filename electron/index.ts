import path from 'path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import isDev from 'electron-is-dev';
import { downloadStatus, getNetworkInterfaces, setMainWindow, startDownload, stopDownload } from './download';

const APP_TITLE = 'Multi Proxy Parallel Downloader';

const createWindow = () => {
    // Create the browser window.
    const win = new BrowserWindow({
        width: 1920,
        height: 1080,
        webPreferences: {
            nodeIntegration: true,
            preload: path.join(__dirname, 'preload.js')
        },
    });

    setMainWindow(win);

    // and load the index.html of the app.
    // win.loadFile("index.html");
    win.loadURL(
        isDev
            ? 'http://localhost:3000'
            : `file://${path.join(__dirname, '../build/index.html')}`
    );
    win.maximize();
    win.setTitle(APP_TITLE);
    // Open the DevTools.
    if (isDev) {
        win.webContents.openDevTools({ mode: 'right' });
    } else {
        win.removeMenu();
    }

    return win;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    const win = createWindow();

    ipcMain.handle('download:start', (_e, urls, location) => startDownload(urls, location));
    ipcMain.handle('download:status', () => downloadStatus());
    ipcMain.on('msg:error', (_e, msg) => dialog.showMessageBox(win, {
        title: APP_TITLE,
        message: msg,
        type: 'error'
    }));
    ipcMain.on('msg:info', (_e, msg) => dialog.showMessageBox(win, {
        title: APP_TITLE,
        message: msg,
        type: 'info'
    }));
    ipcMain.on('progress', (_e, p) => win.setProgressBar(p / 100));
    ipcMain.handle('network_interfaces', () => getNetworkInterfaces());
    ipcMain.on('download:stop', () => stopDownload());
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    setMainWindow();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
