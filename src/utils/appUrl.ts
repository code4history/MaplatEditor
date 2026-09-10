/**
 * appUrl.ts (#105 / oct26-m4-t2) — renderer 側の app:// URL ビルダー。
 *
 * electron 側の正本は `electron/utils/appScheme.ts`。あちらは node:path に依存し、
 * renderer（vite バンドル）から import できないため、同一のエンコード規約を
 * こちらに小さく複製する。**エンコード規約を変更するときは必ず両方を同期させること**。
 *
 * 規約（electron/utils/appScheme.ts の冒頭コメントと同一）:
 *   - パスは `encodeURIComponent` をセグメント単位で適用。
 *   - Windows ドライブレター `C:`（先頭セグメント直後）だけはエンコードしない。
 *   - URL 経路は先頭 `/` を保証（`C:\...` → `/C:/...`）。
 *   - 復号は encoded 区切り文字（`%2F` / `%5C`）を拒否。
 */

export const APP_SCHEME = 'app';
export const BUNDLE_HOST = 'bundle';
export const LOCAL_HOST = 'local';

function toUrlPath(nativePath: string): string {
  const forward = nativePath.replace(/\\/g, '/');
  return forward.startsWith('/') ? forward : `/${forward}`;
}

function fromUrlPath(urlPath: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(urlPath) ? urlPath.slice(1) : urlPath;
}

/** ネイティブ絶対パス → `app://local/<path>`（表示用ローカルリソース URL）。 */
export function localFileUrl(absPath: string): string {
  const segments = toUrlPath(absPath).split('/');
  const encoded = segments
    .map((s, i) => (i === 1 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)))
    .join('/');
  return `app://${LOCAL_HOST}${encoded}`;
}

/** `app://local/<path>` → ネイティブ絶対パス。非 app://local は null。 */
export function appUrlToLocalPath(appUrl: string): string | null {
  try {
    const u = new URL(appUrl);
    if (u.protocol !== 'app:' || u.hostname !== LOCAL_HOST) return null;
    if (/%2f|%5c/i.test(u.pathname)) return null;
    const segments = u.pathname.split('/').map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return null;
      }
    });
    if (segments.some((s) => s === null)) return null;
    return fromUrlPath(segments.join('/'));
  } catch {
    return null;
  }
}
