import { app, BrowserWindow, Menu } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200, // Enforce minimum size like legacy
    minHeight: 800,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false // Allow loading local resources like file://
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

import { registerSettingsHandlers } from './ipc/settings'
import { registerMapHandlers } from './ipc/maps'

app.whenReady().then(() => {
  registerSettingsHandlers()
  registerMapHandlers()
  createWindow()
  setupMenu()
})

import SettingsService from './services/SettingsService'

// Menu Translations
const messages: Record<string, Record<string, string>> = {
  en: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'Quit',
    'menu.about': 'About MaplatEditor',
    'menu.edit': 'Edit',
    'menu.undo': 'Undo',
    'menu.redo': 'Redo',
    'menu.cut': 'Cut',
    'menu.copy': 'Copy',
    'menu.paste': 'Paste',
    'menu.selectAll': 'Select All',
    'menu.development': 'Development',
    'menu.reload': 'Reload',
    'menu.toggleDevTools': 'Toggle Developer Tools'
  },
  ja: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'MaplatEditorを終了',
    'menu.about': 'MaplatEditorについて',
    'menu.edit': '編集',
    'menu.undo': '元に戻す',
    'menu.redo': 'やり直す',
    'menu.cut': '切り取り',
    'menu.copy': 'コピー',
    'menu.paste': '貼り付け',
    'menu.selectAll': 'すべて選択',
    'menu.development': '開発',
    'menu.reload': '再読み込み',
    'menu.toggleDevTools': '開発者ツール'
  }
};

let aboutWin: BrowserWindow | null = null;
function createAboutWindow() {
  if (aboutWin) {
    aboutWin.focus();
    return;
  }
  aboutWin = new BrowserWindow({
    width: 400,
    height: 450, // Increased height to ensure all content fits
    resizable: true, // Allow resizing to debug layout issues if they persist
    minimizable: false,
    maximizable: false,
    title: 'About MaplatEditor',
    autoHideMenuBar: true,
    webPreferences: { 
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  aboutWin.setMenu(null);
  
  // Load about.html from public folder
  const aboutPath = path.join(process.env.VITE_PUBLIC as string, 'about.html');
  aboutWin.loadFile(aboutPath);
  
  // aboutWin.webContents.openDevTools({ mode: 'detach' }); // Uncomment to debug if needed
  aboutWin.on('closed', () => { aboutWin = null; });
}

function setupMenu() {
  const lang = SettingsService.get('lang') || 'en';
  const t = (key: string) => messages[lang]?.[key] || messages['en'][key] || key;

  const template: any[] = [
    {
      label: t('menu.maplateditor'),
      submenu: [
        { 
          label: t('menu.quit'),
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        },
        { type: 'separator' },
        { 
          label: t('menu.about'),
          click: createAboutWindow
        }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') }
      ]
    }
  ]
  
  // Add Dev menu if in development
  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    template.push({
      label: t('menu.development'),
      submenu: [
        { role: 'reload', label: t('menu.reload') },
        { role: 'toggleDevTools', label: t('menu.toggleDevTools') }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  registerSettingsHandlers()
  registerMapHandlers()
  createWindow()
  setupMenu()
  
  // Rebuild menu on language change
  SettingsService.on('changeLang', () => {
      setupMenu();
  });
})
