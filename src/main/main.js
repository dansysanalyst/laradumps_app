import {
    app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, shell,
} from 'electron';
import { format } from 'url';
import { join, resolve } from 'path';
import updater from 'electron-updater';
import storage from 'electron-json-storage';
import * as os from 'os';
import initIpcMain from './ipc.js';
import fixPath from './fix-path.js';
import { registerShortcuts, showShortcutsWindow } from './shortcuts';

const { autoUpdater } = updater;
const contextMenu = require('electron-context-menu');

let mainWindow;
let shortcutsWindow;

const isDev = process.env.NODE_ENV === 'development';

if (isDev) {
    contextMenu({
        showInspectElement: true,
    });
}

fixPath();

const dispatch = (data) => {
    mainWindow.webContents.send('main:message', data);
};

function createWindow() {
    const mainWindowOptions = {
        width: 700,
        height: 680,
        resizable: true,
        alwaysOnTop: true,
        center: true,
        webPreferences: {
            spellcheck: true,
            preload: resolve(join(__dirname, 'index.js')),
            nodeIntegration: true,
            contextIsolation: false,
        },
        show: false,
    };

    const savedDumpsWindowOptions = {
        width: 600,
        height: 580,
        show: false,
        webPreferences: {
            spellcheck: true,
            nodeIntegration: true,
            contextIsolation: false,
        },
    };

    if ((process.platform === 'linux' && !isDev) || isDev) {
        mainWindowOptions.icon = resolve(__dirname, 'icon.png');
        savedDumpsWindowOptions.icon = resolve(__dirname, 'icon.png');
    }

    const mainWindow = new BrowserWindow(mainWindowOptions);

    const savedDumpsWindow = new BrowserWindow(savedDumpsWindowOptions);

    savedDumpsWindow.setMenu(null);

    ipcMain.on('main:open-saved-dumps', (event, arg) => {
        savedDumpsWindow.show();
        savedDumpsWindow.webContents.send('app:load-all-saved-payload', arg);
        savedDumpsWindow.setAlwaysOnTop(true);
    });

    savedDumpsWindow.on('close', (evt) => {
        evt.preventDefault();
        savedDumpsWindow.hide();
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:4999');
        savedDumpsWindow.loadURL('http://localhost:4999');
    } else {
        mainWindow.loadURL(
            format({
                pathname: join(__dirname, 'app', 'index.html'),
                protocol: 'file:',
                slashes: true,
            }),
        );
        savedDumpsWindow.loadURL(
            format({
                pathname: join(__dirname, 'app', 'index.html'),
                protocol: 'file:',
                slashes: true,
            }),
        );
    }

    autoUpdater.autoDownload = false;

    autoUpdater.on('update-available', async (info) => {
        setTimeout(async () => {
            if (process.platform === 'darwin') {
                await dialog.showMessageBox({
                    type: 'info',
                    title: 'LaraDumps update available!',
                    message: 'There are updates available for LaraDumps App.\n\n Download the latest version at:\n\nhttps://github.com/laradumps/app',
                    buttons: ['Ok'],
                });
            } else {
                const result = await dialog.showMessageBox({
                    type: 'info',
                    title: 'LaraDumps update available!',
                    message: 'There are updates available for LaraDumps App. Would you like to update it now?',
                    buttons: ['Yes', 'No'],
                });

                if (result.response === 0) {
                    await autoUpdater.downloadUpdate();
                }
            }
        }, 5000);

        dispatch({
            status: 'Update available.',
            info,
        });
    });

    autoUpdater.on('update-not-available', async () => {
        dispatch({ updater: 'update-not-available' });
    });

    autoUpdater.on('download-progress', async () => {
        dispatch({ updater: 'downloading' });
    });

    autoUpdater.on('update-downloaded', async () => {
        dispatch({ updater: 'Update downloaded' });

        mainWindow.show();

        await dialog.showMessageBox(new BrowserWindow({
            show: false,
            alwaysOnTop: true,
        }), {
            title: 'Install Updates',
            message: 'Update completed! Restarting the application...',
        });
        setImmediate(() => autoUpdater.quitAndInstall());
    });

    return mainWindow;
}

function createMenu() {
    const menuTemplate = [{
        label: 'Menu',
        submenu: [{
            label: 'About LaraDumps',
            click: async () => {
                const {
                    shell,
                } = require('electron');
                await shell.openExternal('https://github.com/laradumps/app');
            },
        },
        {
            type: 'separator',
        },
        {
            label: 'Edit Shortcuts',
            click() {
                shortcutsWindow.show();
            },
        },
        {
            label: 'Quit LaraDumps',
            click() {
                app.quit();
            },
        },
        ],
    },
    {
        label: 'Help',
        submenu: [{
            label: 'Documentation',
            click: async () => {
                const {
                    shell,
                } = require('electron');
                await shell.openExternal('https://laradumps.dev');
            },
        },
        {
            type: 'separator',
        },
        {
            label: 'Releases',
            click: async () => {
                const {
                    shell,
                } = require('electron');
                await shell.openExternal('https://github.com/laradumps/app/releases');
            },
        },
        ],
    },
    ];

    if (process.platform === 'darwin') {
        // Add shortcut to Quit in macOs
        menuTemplate[0].submenu[3].accelerator = 'CmdOrCtrl+Q';
    
        // Enables copy to clipboard in macOS
        menuTemplate.splice(1, 0, {
            label: 'Edit',
            submenu: [{
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:',
            }],
        });
    }

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

app.on('browser-window-focus', () => {
    registerShortcuts();
});

app.whenReady().then(async () => {
    createMenu();

    mainWindow = createWindow();

    shortcutsWindow = showShortcutsWindow();

    mainWindow.on('minimize', (event) => {
        event.preventDefault();
    });

    mainWindow.on('restore', () => {
        mainWindow.show();
    });

    mainWindow.on('close', function (event) {
        const choice = require('electron').dialog.showMessageBoxSync(
            this,
            {
                type: 'question',
                buttons: ['Yes', 'No'],
                title: 'Confirm',
                message: 'Are you sure you want to quit?',
            },
        );

        if (choice === 1) {
            event.preventDefault();
            return;
        }

        mainWindow.webContents.send('server:close', {});
    });

    mainWindow.on('closed', () => {
        app.exit(0);
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
        if (isDev) {
            mainWindow.webContents.openDevTools();
        }
    });

    mainWindow.webContents.send('message', { version: app.getVersion() });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    if (!isDev) {
        try {
            setTimeout(async () => {
                await autoUpdater.checkForUpdates();
            }, 10000);
        } catch (e) {
            mainWindow.webContents.send('main:update-failed', {
                dialogTitle: 'Update',
                dialogDescription: 'Failed to update. Please try again later.',
            });
        }
    }
});

initIpcMain();

app.on('window-all-closed', async () => {
    app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregister('CommandOrControl+Shift+X');
    globalShortcut.unregisterAll();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.on('main:toggle-always-on-top', (event, arg) => {
    setTimeout(() => mainWindow.setAlwaysOnTop(arg), 200);
});

ipcMain.on('main:is-always-on-top', () => {
    mainWindow.webContents.send('main:is-always-on-top', { is_always_on_top: mainWindow.isAlwaysOnTop() });
});

ipcMain.on('main:get-app-version', () => {
    mainWindow.webContents.send('main:app-version', { version: app.getVersion() });
});

ipcMain.on('main:show', () => {
    mainWindow.show();
});

ipcMain.on('main:save-dumps', (event, arg) => {
    storage.setDataPath(os.tmpdir());
    storage.set(arg.id, arg, (error) => {
        if (error) throw error;
    });
});

ipcMain.on('main:close-shortcut-window', (event, data) => {
    shortcutsWindow.hide();
});

ipcMain.on('main:set-shortcut', (event, data) => {
    storage.setDataPath(os.tmpdir());

    console.log(`Received shortcut request for: ${data.shortcut} with: ${data.keys}`);

    storage.set(data.shortcut, { shortcut: data.shortcut, keys: data.keys }, (error) => {
        if (error) throw error;
        registerShortcuts();
    });
});
