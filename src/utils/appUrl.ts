/**
 * appUrl.ts (#105 / oct26-m4-t2) — renderer 側の app:// URL ビルダー。
 *
 * electron 側の正本は `electron/utils/appScheme.ts`。あちらは node:path に依存し、
 * renderer（vite バンドル）から import できないため、同一のエンコード規約を
 * こちらに小さく複製する。**エンコード規約を変更するときは必ず両方を同期させること**。
 *
 * oct26-m4-t2ff: ローカルリソースは renderer と同一 origin の `app://bundle/__local/<abs>` で表す
 * （別 origin の `app://local` は MaplatCore の crossOrigin 読込が CORS 拒否される。理由の詳細は appScheme.ts）。
 * 旧 `app://local` は既存データ互換のため復号だけ受理する。
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
export const LOCAL_PATH_PREFIX = '/__local';
export const LOCAL_URL_PREFIX = `${APP_SCHEME}://${BUNDLE_HOST}${LOCAL_PATH_PREFIX}`;

function toUrlPath(nativePath: string): string {
  const forward = nativePath.replace(/\\/g, '/');
  return forward.startsWith('/') ? forward : `/${forward}`;
}

function fromUrlPath(urlPath: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(urlPath) ? urlPath.slice(1) : urlPath;
}

/** ネイティブ絶対パス → `app://bundle/__local/<path>`（表示用ローカルリソース URL・renderer と同一 origin）。 */
export function localFileUrl(absPath: string): string {
  const segments = toUrlPath(absPath).split('/');
  const encoded = segments
    .map((s, i) => (i === 1 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)))
    .join('/');
  return `${LOCAL_URL_PREFIX}${encoded}`;
}

/** ローカルリソース URL（新形 `app://bundle/__local/`・旧 `app://local/`）→ ネイティブ絶対パス。それ以外は null。 */
export function appUrlToLocalPath(appUrl: string): string | null {
  try {
    const u = new URL(appUrl);
    if (u.protocol !== 'app:') return null;
    let pathname: string;
    if (u.hostname === BUNDLE_HOST && u.pathname.startsWith(LOCAL_PATH_PREFIX + '/')) {
      pathname = u.pathname.slice(LOCAL_PATH_PREFIX.length);
    } else if (u.hostname === LOCAL_HOST) {
      pathname = u.pathname;
    } else {
      return null;
    }
    if (/%2f|%5c/i.test(pathname)) return null;
    const segments = pathname.split('/').map((s) => {
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
