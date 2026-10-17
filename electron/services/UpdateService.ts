// nov26-m7-t5（#141 決めること 2〜5）: 自動更新の器（electron-updater）。
//
// 製品のコードからは呼ばない（確認の起動・知らせる UI・設定の項目は nov26-m7-t6）。ここは
//   - 更新器を 1 回だけ設定する configureUpdater()
//   - 確認・ダウンロード・入れ替えの関数と、イベントの購読
//   - e2e のときだけ置く試験用の口（globalThis.__maplatUpdateTest）
// を持つ。renderer に更新元の URL・パスを渡す IPC は作らない（C-6）。
//
// 設定（updaterSettings・t5/AC1）: autoDownload・autoInstallOnAppQuit・allowPrerelease・allowDowngrade・fullChangelog
// はすべて偽。allowPrerelease が偽なので GitHub の更新元は「最新のリリース」（prerelease を含まない）だけを見る
// ＝ RC と win-signed-cache を拾わない。allowDowngrade が偽なので古い版へは戻さない。
//
// macOS（MIN-9・electron-updater 6.8.10 で確かめた）: autoInstallOnAppQuit が偽なので、downloadUpdate() の後に
// Squirrel.Mac（nativeUpdater.checkForUpdates）は動かない（MacUpdater.js 220〜227 行）。Squirrel が取得と入れ替えを
// 始めるのは quitAndInstall() の中（同 240〜257 行）∴ Squirrel の error（同 18〜21 行で autoUpdater の error に流れる）は
// quitAndInstall() の後にしか出ない。t6 は downloadUpdate() の reject と quitAndInstall() の後の error を分けて扱う。
import { app } from 'electron'
import path from 'node:path'
// electron-updater は CJS で、autoUpdater は getter（初回の参照で更新器を作る）。ESM の名前つき import では
// 取り出せないので default で受け、configureUpdater() の中で初めて参照する
import electronUpdater from 'electron-updater'
import type { AppUpdater, UpdateCheckResult } from 'electron-updater'
import { applyUpdaterSettings, resolveUpdateFeed } from '../utils/updateFeed'

export type UpdateEventName =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error'

const UPDATE_EVENTS: readonly UpdateEventName[] = [
  'checking-for-update',
  'update-available',
  'update-not-available',
  'download-progress',
  'update-downloaded',
  'error',
]

let configured: AppUpdater | null = null

/** 更新器を 1 回だけ設定して返す（2 回目以降は同じものを返す） */
export function configureUpdater(): AppUpdater {
  if (configured) return configured
  const updater = electronUpdater.autoUpdater
  updater.logger = console
  applyUpdaterSettings(updater)
  const feed = resolveUpdateFeed({ isPackaged: app.isPackaged, env: process.env })
  if (feed.kind === 'test') {
    // 試験用の更新元（C-5）: 開発時かつ e2e のときだけ resolveUpdateFeed が返す。
    // ダウンロードのキャッシュの置き場（updaterCacheDirName）は e2e の root の下の dev-app-update.yml から読む
    // （既定は app.getAppPath() の下＝リポジトリを汚す）。updateConfigPath の設定は更新元を消すので setFeedURL より先
    updater.forceDevUpdateConfig = true
    updater.updateConfigPath = path.join(String(process.env['MAPLAT_E2E_ROOT']), 'dev-app-update.yml')
    updater.setFeedURL(feed.options as Parameters<AppUpdater['setFeedURL']>[0])
  }
  configured = updater
  return updater
}

/** 更新を確かめる（開発時で試験用の更新元が無いときは null） */
export function checkForUpdates(): Promise<UpdateCheckResult | null> {
  return configureUpdater().checkForUpdates()
}

/** 確かめた更新をダウンロードする（sha512 が合わなければ reject） */
export function downloadUpdate(): Promise<string[]> {
  return configureUpdater().downloadUpdate()
}

/** ダウンロード済みの更新で入れ替えて再起動する */
export function quitAndInstall(): void {
  configureUpdater().quitAndInstall()
}

/** 更新器のイベントを購読する。戻り値で購読をやめる */
export function onUpdateEvent(listener: (event: UpdateEventName, ...args: unknown[]) => void): () => void {
  const updater = configureUpdater()
  const handlers = UPDATE_EVENTS.map((name) => {
    const handler = (...args: unknown[]) => listener(name, ...args)
    updater.on(name as never, handler as never)
    return [name, handler] as const
  })
  return () => {
    for (const [name, handler] of handlers) updater.removeListener(name as never, handler as never)
  }
}

/**
 * e2e の口（既存の testDebug 系と同じ条件: 開発時かつ MAPLAT_E2E_ROOT）。製品では置かない。
 * 確認とダウンロードだけを渡し、入れ替え（quitAndInstall）は渡さない
 */
export function installUpdateTestHook(): void {
  if (!(!app.isPackaged && process.env['MAPLAT_E2E_ROOT'])) return
  ;(globalThis as Record<string, unknown>).__maplatUpdateTest = {
    checkForUpdates,
    downloadUpdate,
    inspect() {
      const u = configureUpdater()
      return {
        autoDownload: u.autoDownload,
        autoInstallOnAppQuit: u.autoInstallOnAppQuit,
        allowPrerelease: u.allowPrerelease,
        allowDowngrade: u.allowDowngrade,
        fullChangelog: u.fullChangelog,
        forceDevUpdateConfig: u.forceDevUpdateConfig,
        channel: u.channel,
        currentVersion: u.currentVersion.version,
      }
    },
  }
}
