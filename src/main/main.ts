import {app, BrowserWindow, ipcMain, session, Menu} from 'electron';
import path from 'path';
import fs from 'fs-extra';
import openAboutWindow from 'about-window';
import Settings from './settings'; 

const isDev = isExistFile('.env');

let settings;
let menuTemplate;

const menuList = [
  'menu.quit',
  'menu.about',
  'menu.edit',
  'menu.undo',
  'menu.redo',
  'menu.cut',
  'menu.copy',
  'menu.paste',
  'menu.select_all'
];

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
app.disableHardwareAcceleration();

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  if (process.env.NODE_ENV === 'development') {
    const rendererPort = process.argv[2];
    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  }
  else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
  }
}

app.whenReady().then(async () => {
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

app.on('ready', async () => { 
  settings = await Settings.asyncInit();
  const menu = setupMenu();
  Menu.setApplicationMenu(menu);
  settings.on('changeLang', () => {
    menulabelChange();
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
  });
});

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

function setupMenu() {
  const t = settings.t;
  // メニュー情報の作成
  menuTemplate = [
    {
      label: 'MaplatEditor',
      submenu: [
        {
          id: 'menu.quit',
          label: t('menu.quit'),
          accelerator: 'CmdOrCtrl+Q',
          click() {
            app.quit();
          }
        },
        {
          type: 'separator',
        },
        {
          id: 'menu.about',
          label: t('menu.about'),
          click() {
            openAboutWindow({
              icon_path: path.resolve(__dirname, '../../img/icon.png'), // eslint-disable-line no-undef
              product_name: 'MaplatEditor',
              copyright: 'Copyright (c) 2015-2022 Code for History',
              use_version_info: true,
              win_options: {
                title: settings.t('menu.about')
              }
            });
          }
        },
      ]
    },
    {
      id: 'menu.edit',
      label: t('menu.edit'),
      submenu: [
        {
          id: 'menu.undo',
          label: t('menu.undo'),
          accelerator: 'CmdOrCtrl+Z',
          enabled: false,
          click(menuItem, focusedWin) { // eslint-disable-line no-unused-vars
            // Undo.
            // focusedWin.webContents.undo();

            // Run some custom code.
          }
        },
        {
          id: 'menu.redo',
          label: t('menu.redo'),
          accelerator: 'Shift+CmdOrCtrl+Z',
          enabled: false,
          click(menuItem, focusedWin) { // eslint-disable-line no-unused-vars
            // Undo.
            // focusedWin.webContents.undo();

            // Run some custom code.
          }
        },
        { type: "separator" },
        {
          id: 'menu.cut',
          label: t('menu.cut'),
          accelerator: 'CmdOrCtrl+X',
          selector: 'cut:'
        },
        {
          id: 'menu.copy',
          label: t('menu.copy'),
          accelerator: 'CmdOrCtrl+C',
          selector: 'copy:'
        },
        {
          id: 'menu.paste',
          label: t('menu.paste'),
          accelerator: 'CmdOrCtrl+V',
          selector: 'paste:'
        },
        {
          id: 'menu.select_all',
          label: t('menu.select_all'),
          accelerator: 'CmdOrCtrl+A',
          selector: 'selectAll:'
        }
      ]
    }, /*{



    label: 'File',
    submenu: [
      {label: 'Open', accelerator: 'Command+O', click() {
        // 「ファイルを開く」ダイアログの呼び出し
        const {dialog} = require('electron'); // eslint-disable-line no-undef
        dialog.showOpenDialog({ properties: ['openDirectory']}, (baseDir) => {
          if(baseDir && baseDir[0]) {
            openWindow(baseDir[0]); // eslint-disable-line no-undef
          }
        });
      }}
    ]
  }, */
  ];

  const devMenu = {
    id: 'menu.dev',
    label: t('menu.dev'),
    submenu: [
      {
        id: 'menu.reload',
        label: t('menu.reload'),
        accelerator: 'Command+R',
        click() {
          BrowserWindow.getFocusedWindow()!.reload();
        }
      },
      {
        id: 'menu.tools',
        label: t('menu.tools'),
        accelerator: 'Alt+Command+I',
        click() {
          BrowserWindow.getFocusedWindow()!.webContents.toggleDevTools();
        }
      }
    ]
  };

  if (isDev || 1) { // eslint-disable-line no-constant-condition
    menuTemplate.push(devMenu);
    menuList.push('menu.dev', 'menu.reload', 'menu.tools');
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  return menu;
}

function menulabelChange(list?) {
  if (!list) {
    list = menuList.reduce((prev, curr) => {
      prev[curr] = settings.t(curr);
      return prev;
    }, {});
  }
  menuTemplate.map((menu) => {
    if (list[menu.id]) menu.label = list[menu.id];
    if (menu.submenu) {
      menu.submenu.map((submenu) => {
        if (list[submenu.id]) submenu.label = list[submenu.id];
      });
    }
  });
}