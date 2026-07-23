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

// M13-T2 (SI-6/§5.9): 同一 userData profile からの複数 Electron process による
// DB/filesystem mutation を防ぐ。ロックを取得できなければ即座に quit する。
// 【既知の限界(タスク設計 §6.5)】 app.requestSingleInstanceLock() は userData path 単位の
// ロックであり、--user-data-dir を分離した複数プロセス(= 複数マシンから OneDrive 等で
// クラウド同期された同一 saveFolder に同時アクセスする運用)は防げない。saveFolder 内
// ロックファイル方式等の追加対策要否は人間判断待ち(マイルストーン再レビュー要の scope 超過)
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

function createWindow() {
  let draftFlushReady = false
  let draftFlushInProgress = false
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    // 最小サイズ緩和 (ユーザー決定 2026-07-12): 旧実装の 1200x800 は可視領域が狭い環境で
    // 画面からはみ出したまま縮められなかった。1000x640 = 2カラム UI (右ペイン 340px + 地図)
    // が破綻しない下限
    minWidth: 1000,
    minHeight: 640,
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
    const closingWindow = win
    if (!draftFlushReady && closingWindow && !closingWindow.webContents.isDestroyed()) {
      e.preventDefault()
      if (draftFlushInProgress) return
      draftFlushInProgress = true
      void closingWindow.webContents
        .executeJavaScript("window.dispatchEvent(new Event('maplat:flush-drafts'))")
        .catch((error) => console.warn('[asset-draft] renderer close flush failed:', error))
        .finally(() => {
          draftFlushInProgress = false
          draftFlushReady = true
          if (forceQuit) app.quit()
          else closingWindow.close()
        })
      return
    }
    draftFlushReady = false
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
import { registerAssetDraftHandlers } from './ipc/assetDrafts'
import { registerAppHandlers } from './ipc/apps'
import { registerPoisourceHandlers } from './ipc/poisource'
import { registerAppAssetHandlers } from './ipc/appassets'
import { registerAssetHandlers } from './ipc/assets'
import { registerImageAssetHandlers } from './ipc/assets-images'
import { registerSlugReservationHandlers } from './ipc/slugReservations'
import { registerSearchHandlers } from './ipc/search'

import { ipcMain } from 'electron'

// M13-T3: 明示 migration 実行の起動面(menu item)から SqliteDataService.getDb() / runManual() を呼ぶ
import SqliteDataService from './services/SqliteDataService'
import { runManual } from './services/OriginalsMigrationService'

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
  ipcMain.removeHandler('mapedit:checkExtentMap')
  ipcMain.removeHandler('mapupload:showMapSelectDialog')
  ipcMain.removeHandler('mapedit:getWmtsFolder')
  ipcMain.removeHandler('mapedit:download')
  ipcMain.removeHandler('mapedit:download-saved')
  ipcMain.removeHandler('mapedit:uploadCsv')
  ipcMain.removeHandler('dataupload:showDataSelectDialog')
  ipcMain.removeHandler('wmtsGen:generate')
  ipcMain.removeHandler('dialog:showMessageBox')
  ipcMain.removeHandler('asset-drafts:put')
  ipcMain.removeHandler('asset-drafts:get')
  ipcMain.removeHandler('asset-drafts:remove')
  ipcMain.removeHandler('asset-drafts:list')
  ipcMain.removeAllListeners('asset-drafts:flush-sync')
  ipcMain.removeHandler('applist:request')
  ipcMain.removeHandler('applist:delete')
  ipcMain.removeHandler('appedit:request')
  ipcMain.removeHandler('appedit:save')
  ipcMain.removeHandler('appedit:prepare-preview')
  ipcMain.removeHandler('poisource:list')
  ipcMain.removeHandler('poisource:get')
  ipcMain.removeHandler('poisource:createLocal')
  ipcMain.removeHandler('poisource:save')
  ipcMain.removeHandler('poisource:importFile')
  ipcMain.removeHandler('poisource:registerRemote')
  ipcMain.removeHandler('poisource:refreshRemote')
  ipcMain.removeHandler('poisource:cloneToLocal')
  ipcMain.removeHandler('poisource:findReferences')
  ipcMain.removeHandler('poisource:delete')
  ipcMain.removeHandler('poisource:exportFile')
  ipcMain.removeHandler('asset:checkSlug')
  ipcMain.removeHandler('imageassets:add')
  ipcMain.removeHandler('imageassets:list')
  ipcMain.removeHandler('imageassets:search')
  ipcMain.removeHandler('imageassets:get')
  ipcMain.removeHandler('imageassets:update-metadata')
  ipcMain.removeHandler('imageassets:delete')
  ipcMain.removeHandler('imageassets:getFilePath')
  // Minor-2 (M11-T7): slug reservation channels の HMR cleanup
  ipcMain.removeHandler('slug-reservations:reserve')
  ipcMain.removeHandler('slug-reservations:move')
  ipcMain.removeHandler('slug-reservations:release')
  ipcMain.removeHandler('slug-reservations:check')
  ipcMain.removeHandler('search:maps')
  ipcMain.removeHandler('search:apps')
  ipcMain.removeHandler('search:poiSources')
  ipcMain.removeHandler('search:baseMaps')
  ipcMain.removeHandler('search:imageAssets')
  ipcMain.removeHandler('search:extent')
  ipcMain.removeHandler('search:appCoverage')
  ipcMain.removeHandler('search:resourceBbox')

  ipcMain.handle('dialog:showMessageBox', async (event, options) => {
    return await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender)!, options)
  })

  registerSettingsHandlers()
  registerMapHandlers()
  registerMapEditHandlers()
  registerMapUploadHandlers()
  registerDataUploadHandlers()
  registerWmtsHandlers()
  registerAssetDraftHandlers()
  registerAppHandlers()
  registerPoisourceHandlers()
  registerAppAssetHandlers()
  registerAssetHandlers()
  registerImageAssetHandlers()
  registerSlugReservationHandlers()
  registerSearchHandlers()
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
    'menu.toggleDevTools': 'Toggle Developer Tools',
    'menu.run_originals_migration': 'Migrate Originals to UUID Filenames',
    'menu.originals_migration_done': 'Originals migration completed ({count} entries processed).',
    'menu.originals_migration_warnings_hint': 'See migration-report-v2.json in the data folder for entries that were skipped and require manual review.',
    'menu.originals_migration_failed': 'Originals migration failed. See the application log for details.'
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
    'menu.toggleDevTools': '開発者ツール',
    'menu.run_originals_migration': '原本をUUIDファイル名へ移行',
    'menu.originals_migration_done': '原本の移行が完了しました（{count}件処理）。',
    'menu.originals_migration_warnings_hint': '手動確認が必要な項目は、保存先データフォルダの migration-report-v2.json をご確認ください。',
    'menu.originals_migration_failed': '原本の移行に失敗しました。詳細はアプリケーションログを確認してください。'
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
      { role: 'toggleDevTools', label: t('menu.toggleDevTools') },
      { type: 'separator' },
      {
        label: t('menu.run_originals_migration'),
        click: async () => {
          try {
            const db = await SqliteDataService.getDb(); // ここでは既に resolve 済み(app起動後のmenu click)
            const result = await runManual(db);
            const total = Object.values(result.summary).reduce((a: number, b: number) => a + b, 0);
            const lines = Object.entries(result.summary).map(([kind, count]) => `  ${kind}: ${count}`);
            const doneMessage = t('menu.originals_migration_done').replace('{count}', String(total));
            const message = `${doneMessage}\n${lines.join('\n')}\n\n${t('menu.originals_migration_warnings_hint')}`;
            const options = { type: 'info' as const, title: t('menu.run_originals_migration'), message };
            // v1.1 (レビュー v1 Minor 6): forceQuit パターン(main.ts 33-34行)により
            // macOS では全ウィンドウ閉鎖後もアプリ/メニューが生存し win は null になり得る。
            // win が null の場合は BrowserWindow 引数なしの showMessageBox へフォールバックする
            if (win) {
              await dialog.showMessageBox(win, options);
            } else {
              await dialog.showMessageBox(options);
            }
          } catch (e: any) {
            // v1.1: runManual() 自体は per-map failure を吸収するが(§5.1)、
            // getDb() や dialog 自体の予期しない失敗にも click ハンドラとして防御的に備える
            console.error('[main] manual originals migration failed', e);
            const errorOptions = { type: 'error' as const, title: t('menu.run_originals_migration'), message: t('menu.originals_migration_failed') };
            if (win) {
              await dialog.showMessageBox(win, errorOptions);
            } else {
              await dialog.showMessageBox(errorOptions);
            }
          }
        }
      }
    ]
  })

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
