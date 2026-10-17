// nov26-m7-t6（#141 決めること 1・6）: 更新のお知らせの方針を決める純関数。electron を import しない
// （smoke が node で直接読む。前例: updateFeed.ts・releaseChannel.ts）。

export type UpdateAction = 'download' | 'open-releases';

/**
 * Windows でもダウンロードの経路を閉じて「Releases を開く」だけにするか。
 * マイルストーン設計 §8.1 (イ)（#130 を 12 月へ送る）に落ちたときだけ、orchestrator の指示でこの 1 行を true にする
 */
export const WINDOWS_NOTIFY_ONLY = false;

/**
 * 更新があったときに利用者へ出す選択肢の形（設計 §3.2）。
 * linux → open-releases、win32 で windowsNotifyOnly → open-releases、それ以外 → download。
 */
export function updateActionFor(platform: NodeJS.Platform, flags: { windowsNotifyOnly: boolean }): UpdateAction {
  if (platform === 'linux') return 'open-releases';
  if (platform === 'win32' && flags.windowsNotifyOnly) return 'open-releases';
  return 'download';
}

const RELEASES = 'https://github.com/code4history/MaplatEditor/releases';
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * 開く Release のページ。固定の接頭辞だけを返し、更新元から来た文字列は x.y.z の形に合うときだけ版として足す
 * （合わなければ「最新のリリース」のページ）。
 */
export function releasePageUrl(version: unknown): string {
  if (typeof version === 'string' && PLAIN_VERSION.test(version)) return `${RELEASES}/tag/v${version}`;
  return `${RELEASES}/latest`;
}

/**
 * 設定 updateCheckEnabled の正規化（読み書きの両方）。electron-store の実体は利用者が編集できる JSON なので、
 * 明示の false（と文字列の 'false'）だけを「切る」、それ以外（未設定を含む）は既定の「確かめる」にする。
 */
export function normalizeUpdateCheckEnabled(value: unknown): boolean {
  return !(value === false || value === 'false');
}
