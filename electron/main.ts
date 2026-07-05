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

// バックエンドのエラー/警告をレンダラのコンソールへ転送する (#18)
import { installBackendErrorForwarding } from './utils/backendErrorForwarder'
installBackendErrorForwarding()

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
import { registerAppDraftHandlers } from './ipc/appdraft'
import { registerAppHandlers } from './ipc/apps'
import { registerPoisourceHandlers } from './ipc/poisource'
import { registerAppAssetHandlers } from './ipc/appassets'

import { ipcMain } from 'electron'

app.whenReady().then(() => {
  // HMR時の「2重登録」エラーを防ぐため、既存ハンドラを事前に解除する
  ipcMain.removeHandler('settings:get')
  ipcMain.removeHandler('settings:set')
  ipcMain.removeHandler('settings:select-folder')
  ipcMain.removeHandler('maplist:request')
  ipcMain.removeHandler('maplist:delete')
  ipcMain.removeHandler('mapedit:request')
  ipcMain.removeHandler('mapedit:preview-source')
  ipcMain.removeHandler('mapedit:get-tms-list')
  ipcMain.removeHandler('mapedit:get-base-map-visibility')
  ipcMain.removeHandler('mapedit:set-base-map-visibility')
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
  ipcMain.removeHandler('appdraft:save')
  ipcMain.removeHandler('appdraft:load')
  ipcMain.removeHandler('applist:request')
  ipcMain.removeHandler('applist:delete')
  ipcMain.removeHandler('appedit:request')
  ipcMain.removeHandler('appedit:save')
  ipcMain.removeHandler('appedit:checkID')
  ipcMain.removeHandler('appedit:prepare-preview')
  ipcMain.removeHandler('poisource:list')
  ipcMain.removeHandler('poisource:get')
  ipcMain.removeHandler('poisource:createLocal')
  ipcMain.removeHandler('poisource:registerRemote')
  ipcMain.removeHandler('poisource:validateRemote')
  ipcMain.removeHandler('poisource:saveLocal')
  ipcMain.removeHandler('poisource:delete')

  ipcMain.handle('dialog:showMessageBox', async (event, options) => {
    return await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender)!, options)
  })

  registerSettingsHandlers()
  registerMapHandlers()
  registerMapEditHandlers()
  registerMapUploadHandlers()
  registerDataUploadHandlers()
  registerWmtsHandlers()
  registerAppDraftHandlers()
  registerAppHandlers()
  registerPoisourceHandlers()
  registerAppAssetHandlers()
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
  },
  de: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'MaplatEditor beenden',
    'menu.about': 'Über MaplatEditor',
    'menu.edit': 'Bearbeiten',
    'menu.undo': 'Rückgängig',
    'menu.redo': 'Wiederholen',
    'menu.cut': 'Ausschneiden',
    'menu.copy': 'Kopieren',
    'menu.paste': 'Einfügen',
    'menu.selectAll': 'Alles auswählen',
    'menu.development': 'Entwicklung',
    'menu.reload': 'Neu laden',
    'menu.toggleDevTools': 'Entwicklertools'
  },
  fr: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'Quitter MaplatEditor',
    'menu.about': 'À propos de MaplatEditor',
    'menu.edit': 'Édition',
    'menu.undo': 'Annuler',
    'menu.redo': 'Rétablir',
    'menu.cut': 'Couper',
    'menu.copy': 'Copier',
    'menu.paste': 'Coller',
    'menu.selectAll': 'Tout sélectionner',
    'menu.development': 'Développement',
    'menu.reload': 'Recharger',
    'menu.toggleDevTools': 'Outils de développement'
  },
  es: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'Salir de MaplatEditor',
    'menu.about': 'Acerca de MaplatEditor',
    'menu.edit': 'Edición',
    'menu.undo': 'Deshacer',
    'menu.redo': 'Rehacer',
    'menu.cut': 'Cortar',
    'menu.copy': 'Copiar',
    'menu.paste': 'Pegar',
    'menu.selectAll': 'Seleccionar todo',
    'menu.development': 'Desarrollo',
    'menu.reload': 'Recargar',
    'menu.toggleDevTools': 'Herramientas de desarrollo'
  },
  ko: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'MaplatEditor 종료',
    'menu.about': 'MaplatEditor 정보',
    'menu.edit': '편집',
    'menu.undo': '실행 취소',
    'menu.redo': '다시 실행',
    'menu.cut': '잘라내기',
    'menu.copy': '복사',
    'menu.paste': '붙여넣기',
    'menu.selectAll': '모두 선택',
    'menu.development': '개발',
    'menu.reload': '새로 고침',
    'menu.toggleDevTools': '개발자 도구'
  },
  zh: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': '退出 MaplatEditor',
    'menu.about': '关于 MaplatEditor',
    'menu.edit': '编辑',
    'menu.undo': '撤销',
    'menu.redo': '重做',
    'menu.cut': '剪切',
    'menu.copy': '复制',
    'menu.paste': '粘贴',
    'menu.selectAll': '全选',
    'menu.development': '开发',
    'menu.reload': '重新加载',
    'menu.toggleDevTools': '开发者工具'
  },
  'zh-TW': {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': '結束 MaplatEditor',
    'menu.about': '關於 MaplatEditor',
    'menu.edit': '編輯',
    'menu.undo': '復原',
    'menu.redo': '重做',
    'menu.cut': '剪下',
    'menu.copy': '複製',
    'menu.paste': '貼上',
    'menu.selectAll': '全選',
    'menu.development': '開發',
    'menu.reload': '重新載入',
    'menu.toggleDevTools': '開發人員工具'
  },
  vi: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'Thoát MaplatEditor',
    'menu.about': 'Giới thiệu MaplatEditor',
    'menu.edit': 'Chỉnh sửa',
    'menu.undo': 'Hoàn tác',
    'menu.redo': 'Làm lại',
    'menu.cut': 'Cắt',
    'menu.copy': 'Sao chép',
    'menu.paste': 'Dán',
    'menu.selectAll': 'Chọn tất cả',
    'menu.development': 'Phát triển',
    'menu.reload': 'Tải lại',
    'menu.toggleDevTools': 'Công cụ nhà phát triển'
  },
  th: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'ออกจาก MaplatEditor',
    'menu.about': 'เกี่ยวกับ MaplatEditor',
    'menu.edit': 'แก้ไข',
    'menu.undo': 'เลิกทำ',
    'menu.redo': 'ทำซ้ำ',
    'menu.cut': 'ตัด',
    'menu.copy': 'คัดลอก',
    'menu.paste': 'วาง',
    'menu.selectAll': 'เลือกทั้งหมด',
    'menu.development': 'การพัฒนา',
    'menu.reload': 'โหลดใหม่',
    'menu.toggleDevTools': 'เครื่องมือนักพัฒนา'
  },
  id: {
    'menu.maplateditor': 'MaplatEditor',
    'menu.quit': 'Keluar dari MaplatEditor',
    'menu.about': 'Tentang MaplatEditor',
    'menu.edit': 'Edit',
    'menu.undo': 'Urungkan',
    'menu.redo': 'Ulangi',
    'menu.cut': 'Potong',
    'menu.copy': 'Salin',
    'menu.paste': 'Tempel',
    'menu.selectAll': 'Pilih semua',
    'menu.development': 'Pengembangan',
    'menu.reload': 'Muat ulang',
    'menu.toggleDevTools': 'Alat pengembang'
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
        {
          label: t('menu.undo'),
          accelerator: 'CmdOrCtrl+Z',
          click: () => win?.webContents.send('main-process-message', 'menu:undo')
        },
        {
          label: t('menu.redo'),
          accelerator: process.platform === 'darwin' ? 'Shift+Cmd+Z' : 'Ctrl+Y',
          click: () => win?.webContents.send('main-process-message', 'menu:redo')
        },
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
