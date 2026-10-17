// nov26-m7-t6（#141 決めること 1・6）: 自動更新の形。
//   起動の少し後に 1 回だけ確かめ、新しい正式版があれば main のネイティブのダイアログで知らせる。
//   ダウンロードは「更新する」を選んだときだけ、入れ替えは「今すぐ再起動して更新」を選んだときだけ。
//   Linux（AppImage）は知らせて Release のページを開くだけ（ダウンロードの経路を持たない）。
//   起動時の確認は設定 updateCheckEnabled（既定オン）で切れる。
//
// renderer の UI・新しい IPC・preload の口は作らない（C-6・t6/AC7）。文言は updateMessages.ts、
// 方針（どの OS で何をするか）は updatePolicy.ts の 1 か所。更新器の操作は UpdateService だけが持つ。
import { app, BrowserWindow, dialog, shell, type MessageBoxOptions } from 'electron'
import SettingsService from './SettingsService'
import { updateText } from './updateMessages'
import { releasePageUrl, updateActionFor, WINDOWS_NOTIFY_ONLY } from '../utils/updatePolicy'
import { resolveStartupDelayMs } from '../utils/updateFeed'
import * as UpdateService from './UpdateService'

/** 起動時の確認を走らせるか（設定が明示の false のときだけ止める。既定はオン） */
export function isUpdateCheckEnabled(): boolean {
  return SettingsService.get('updateCheckEnabled') !== false
}

function currentLang(): string {
  return SettingsService.get('lang') || 'en'
}

function currentVersion(): string {
  return app.getVersion()
}

/** 主窓（起動時に startAutomaticCheck が渡す。無ければ最初の窓）。macOS で全窓を閉じた後は null */
let mainWindow: (() => BrowserWindow | null) | null = null
function getMainWindow(): BrowserWindow | null {
  return mainWindow?.() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/** ダイアログを出す。主窓が無いとき（macOS で全窓を閉じた後）は親なしで出す */
async function ask(options: MessageBoxOptions): Promise<number> {
  const win = getMainWindow()
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return result.response
}

let checking = false
let installing = false

/**
 * 更新を確かめる。manual はメニューの「更新を確認…」から（自動の確認は manual: false）。
 * 同時に 2 つ走らせない（走っている間の 2 回目は何もしない）。
 */
export async function check({ manual }: { manual: boolean }): Promise<void> {
  if (checking) return
  checking = true
  ensureErrorListener()
  const lang = currentLang()
  try {
    const result = await UpdateService.checkForUpdates()
    // 開発時（製品でない）で試験用の更新元が無いときは null。自動なら黙る
    if (result == null || !result.isUpdateAvailable) {
      if (manual) {
        await ask({
          type: 'info',
          message: updateText(lang, 'dialog.up_to_date.message', { version: currentVersion() }),
          buttons: [updateText(lang, 'button.later')],
          defaultId: 0,
          cancelId: 0,
        })
      }
      return
    }

    const version = result.updateInfo.version
    const action = updateActionFor(process.platform, { windowsNotifyOnly: WINDOWS_NOTIFY_ONLY })
    if (action === 'open-releases') {
      const response = await ask({
        type: 'info',
        message: updateText(lang, 'dialog.update_available.message', { version }),
        detail: updateText(lang, 'dialog.update_available.detail', { current: currentVersion() }),
        buttons: [updateText(lang, 'button.open_releases'), updateText(lang, 'button.later')],
        defaultId: 0,
        cancelId: 1,
      })
      if (response === 0) await shell.openExternal(releasePageUrl(version))
      return
    }

    const response = await ask({
      type: 'info',
      message: updateText(lang, 'dialog.update_available.message', { version }),
      detail: updateText(lang, 'dialog.update_available.detail', { current: currentVersion() }),
      buttons: [updateText(lang, 'button.update'), updateText(lang, 'button.later')],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) return

    const win = getMainWindow()
    const unsubscribe = UpdateService.onUpdateEvent((event, ...args) => {
      if (event !== 'download-progress') return
      const progress = args[0] as { percent?: unknown } | undefined
      const percent = typeof progress?.percent === 'number' ? progress.percent : null
      if (percent != null) win?.setProgressBar(Math.max(0, Math.min(1, percent / 100)))
    })
    try {
      await UpdateService.downloadUpdate()
    } catch (error) {
      console.warn('[update] download failed', error)
      await ask({
        type: 'error',
        message: updateText(lang, 'dialog.download_failed.message'),
        buttons: [updateText(lang, 'button.later')],
        defaultId: 0,
        cancelId: 0,
      })
      return
    } finally {
      unsubscribe()
      win?.setProgressBar(-1)
    }

    // 閉じる経路に未保存の確認が無い（実測: main.ts の close は下書きの flush のみ）∴ 設計 §3.2 の
    // 代替に従い、詳細に「保存していない変更は失われる」を出し、既定を「後で」にする
    const restart = await ask({
      type: 'info',
      message: updateText(lang, 'dialog.downloaded.message', { version }),
      detail: updateText(lang, 'dialog.downloaded.detail'),
      buttons: [updateText(lang, 'button.restart_now'), updateText(lang, 'button.later')],
      defaultId: 1,
      cancelId: 1,
    })
    if (restart !== 0) return
    installing = true
    UpdateService.quitAndInstall()
  } catch (error) {
    // 自動の確認で起動のたびに失敗のダイアログを出さない（設計 §3.2）
    console.warn('[update] check failed', error)
    if (manual) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
      await ask({
        type: 'error',
        message: updateText(lang, 'dialog.check_failed.message'),
        detail,
        buttons: [updateText(lang, 'button.later')],
        defaultId: 0,
        cancelId: 0,
      })
    }
  } finally {
    checking = false
  }
}

/**
 * 起動の少し後に 1 回だけ確かめる。設定がオフなら要求を出さない（t6/AC1 (iv)）。
 * 定期の確認はしない（設計 §3.2）。
 */
export function startAutomaticCheck(getWindow: () => BrowserWindow | null): void {
  mainWindow = getWindow
  if (!isUpdateCheckEnabled()) return
  ensureErrorListener()
  const delay = resolveStartupDelayMs({ isPackaged: app.isPackaged, env: process.env })
  setTimeout(() => {
    if (!isUpdateCheckEnabled()) return
    if (getWindow() == null) return
    void check({ manual: false })
  }, delay)
}

let errorListenerInstalled = false

/**
 * 更新器の error の扱い（MIN-9）。Squirrel の error は入れ替え（UpdateService の入れ替えの関数）の後にしか来ない。
 * それより前の error（確認・ダウンロードの Promise の reject と二重に来るもの）は console.warn だけ。
 * 購読は更新の機能を初めて使うときに 1 回だけ張る（import しただけで更新器を作らない）。
 * 購読は UpdateService の口 1 本だけにする（electron の autoUpdater と二重に張ると、同じ error で
 * ダイアログが 2 回出る）。
 */
function ensureErrorListener(): void {
  if (errorListenerInstalled) return
  errorListenerInstalled = true
  UpdateService.onUpdateEvent((event, ...args) => {
    if (event !== 'error') return
    if (!installing) {
      console.warn('[update] updater error (before install)', ...args)
      return
    }
    installing = false
    void ask({
      type: 'error',
      message: updateText(currentLang(), 'dialog.download_failed.message'),
      buttons: [updateText(currentLang(), 'button.later')],
      defaultId: 0,
      cancelId: 0,
    })
  })
}
