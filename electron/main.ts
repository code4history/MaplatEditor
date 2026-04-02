import { app, BrowserWindow, Menu, dialog } from 'electron'
// import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ビルド後のディレクトリ構造:
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 ['ENV_NAME'] 形式で参照: vite:define プラグインの誤変換を回避（Vite@2.x 起因）
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// 旧実装 main.js L.88-93 に準拠: macOS で Cmd+Q が押されるまで force_quit を false に保つ
let forceQuit = false

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200, // 旧実装に合わせた最小サイズ
    minHeight: 800,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false // file:// などローカルリソース読み込みを許可
    },
  })

  // レンダラープロセスへのメッセージ送信テスト
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // 旧実装 main.js L.79-85 に準拠:
  // macOS では×ボタンでウィンドウを隠すだけにする（アプリ状態を保持）
  win.on('close', (e) => {
    if (process.platform === 'darwin' && !forceQuit) {
      e.preventDefault()
      win?.hide()
    }
  })
}

// 旧実装 main.js L.88-93 に準拠: Cmd+Q 等でアプリ終了する場合のみ force_quit を立てる
app.on('before-quit', () => {
  forceQuit = true
})

// 全ウィンドウが閉じられたときにアプリを終了する（macOSを除く）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // 旧実装 main.js L.95-97 に準拠: macOS で Dock クリック時は既存ウィンドウを表示
  if (win) {
    win.show()
  } else {
    createWindow()
  }
})

import { registerSettingsHandlers } from './ipc/settings'
import { registerMapHandlers } from './ipc/maps'
import { registerMapEditHandlers } from './ipc/mapedit'
import { registerMapUploadHandlers } from './ipc/mapupload'
import { registerDataUploadHandlers } from './ipc/dataupload'
import { registerWmtsHandlers } from './ipc/wmts'

import { ipcMain } from 'electron'

app.whenReady().then(() => {
  // HMR時の「2重登録」エラーを防ぐため、既存ハンドラを事前に解除する
  ipcMain.removeHandler('settings:get')
  ipcMain.removeHandler('settings:set')
  ipcMain.removeHandler('settings:select-folder')
  ipcMain.removeHandler('maplist:request')
  ipcMain.removeHandler('maplist:delete')
  ipcMain.removeHandler('mapedit:request')
  ipcMain.removeHandler('mapedit:get-tms-list')
  ipcMain.removeHandler('mapedit:updateTin')
  ipcMain.removeHandler('mapedit:save')
  ipcMain.removeHandler('mapedit:checkID')
  ipcMain.removeHandler('mapedit:checkExtentMap')
  ipcMain.removeHandler('mapupload:showMapSelectDialog')
  ipcMain.removeHandler('mapedit:getWmtsFolder')
  ipcMain.removeHandler('mapedit:download')
  ipcMain.removeHandler('mapedit:uploadCsv')
  ipcMain.removeHandler('dataupload:showDataSelectDialog')
  ipcMain.removeHandler('wmtsGen:generate')
  ipcMain.removeHandler('dialog:showMessageBox')

  ipcMain.handle('dialog:showMessageBox', async (event, options) => {
    return await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender)!, options)
  })

  registerSettingsHandlers()
  registerMapHandlers()
  registerMapEditHandlers()
  registerMapUploadHandlers()
  registerDataUploadHandlers()
  registerWmtsHandlers()
  createWindow()
  setupMenu()

  // 言語変更時にメニューを再構築する
  SettingsService.on('changeLang', () => {
    setupMenu();
  });
})

import SettingsService from './services/SettingsService'

// メニュー翻訳定義
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
    height: 450,
    resizable: true,
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
  
  // publicフォルダからabout.htmlを読み込む
  const aboutPath = path.join(process.env.VITE_PUBLIC as string, 'about.html');
  aboutWin.loadFile(aboutPath);
  
  // aboutWin.webContents.openDevTools({ mode: 'detach' }); // デバッグ時はコメント解除
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
  
  // 開発メニューを追加
  template.push({
    label: t('menu.development'),
    submenu: [
      { role: 'reload', label: t('menu.reload') },
      { role: 'toggleDevTools', label: t('menu.toggleDevTools') }
    ]
  })

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

