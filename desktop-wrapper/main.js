// Electron Main Process Template (desktop-wrapper/main.js)
// Wraps TeamDesk (https://teamdesk.vartexengg.com) + automatically starts the local Desktop Agent
// with a visible system tray icon and explicit Quit option (no PowerShell needed).

const { app, BrowserWindow, Tray, Menu, desktopCapturer, session } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'TeamDesk',
    icon: path.join(__dirname, 'assets', 'Square150x150Logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Automatically authorize getDisplayMedia screen picker when user starts Share Screen
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0] });
    });
  });

  mainWindow.loadURL('https://teamdesk.vartexengg.com');

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'Square44x44Logo.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Open TeamDesk', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    {
      label: 'Exit TeamDesk (Stop Agent)',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('TeamDesk — Remote Support');
  tray.setContextMenu(menu);
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Start your bundled native local input agent here (e.g., startLocalInputBridge())
  // ensuring it only executes OS input when the user has clicked Allow Control.
});
