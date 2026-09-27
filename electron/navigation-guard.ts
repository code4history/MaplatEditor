// oct26-m16-t2（セキュリティレビュー C の F-C1）: BrowserWindow の遷移ガード。
//
// main window は preload（IPC 88 チャネル）を持つ。main frame が外部ページへ遷移すると preload は遷移先にも
// 読み込まれ、第三者のページが IPC を握る。プレビュー iframe 内の POI の `<a target="_top">` はユーザー操作の
// クリックなので、cross-origin の iframe からでも Chromium は top の遷移を許す。そこで main process 側で
//   - will-navigate: 許可したオリジン以外への main frame の遷移を止める（will-navigate は main frame にしか
//     発火しない ∴ プレビュー iframe の中の遷移は妨げない。hash 遷移・history API も発火しない ∴ vue-router は無影響）
//   - setWindowOpenHandler: 新しいウィンドウは一切開かない（editor に外部リンクを開く正当な需要は無い）
// を掛ける。About ウィンドウ（preload なし）にも同じガードを掛ける。
import type { WebContents } from 'electron'
import { APP_SCHEME, BUNDLE_HOST, LOCAL_URL_PREFIX } from './utils/appScheme'

/** 同梱物（renderer 本体・about.html）の URL 接頭辞 `app://bundle/`。 */
const BUNDLE_URL_PREFIX = `${APP_SCHEME}://${BUNDLE_HOST}/`

/**
 * main frame の遷移先として許すか。許すのは次の 2 つだけ:
 * - `app://bundle/`（同梱物）。ただし `app://bundle/__local/`（保存フォルダ等のローカルリソース）は文書として載せない
 * - 開発時の `VITE_DEV_SERVER_URL` と同じオリジン
 */
export function isAllowedNavigationUrl(url: string, devServerUrl?: string | null): boolean {
  if (url.startsWith(BUNDLE_URL_PREFIX)) {
    return !url.startsWith(`${LOCAL_URL_PREFIX}/`)
  }
  if (!devServerUrl) return false
  try {
    const target = new URL(url)
    const dev = new URL(devServerUrl)
    return (target.protocol === 'http:' || target.protocol === 'https:') && target.origin === dev.origin
  } catch {
    return false
  }
}

/** webContents に遷移ガード（will-navigate）と新規ウィンドウの拒否（setWindowOpenHandler）を掛ける。 */
export function installNavigationGuard(contents: WebContents, devServerUrl?: string | null): void {
  contents.on('will-navigate', (event) => {
    if (isAllowedNavigationUrl(event.url, devServerUrl)) return
    event.preventDefault()
    console.warn(`[navigation-guard] blocked main-frame navigation to ${JSON.stringify(event.url)}`)
  })
  contents.setWindowOpenHandler(({ url }) => {
    console.warn(`[navigation-guard] blocked window.open to ${JSON.stringify(url)}`)
    return { action: 'deny' }
  })
}
