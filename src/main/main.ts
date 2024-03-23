import {app, BrowserWindow, ipcMain, session} from 'electron';
import {join} from 'path';
import fs from 'fs-extra';
import openAboutWindow from 'about-window';
import Settings from './settings'; 

const isDev = isExistFile('.env');

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
app.disableHardwareAcceleration();

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  if (process.env.NODE_ENV === 'development') {
    const rendererPort = process.argv[2];
    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  }
  else {
    mainWindow.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ['script-src \'self\'']
      }
    })
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
});


const menu = setupMenu();

ipcMain.on('message', (event, message) => {
  console.log(message);
})

function isExistFile(file: string) {
  try {
    fs.statSync(file);
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') return false;
  }
}