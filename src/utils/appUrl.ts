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

const LEGACY_LOCAL_URL_PREFIX = `${APP_SCHEME}://${LOCAL_HOST}`;
const TILE_TEMPLATE_SUFFIX = /^(.*)\/(\{z\}\/\{x\}\/\{y\}\.[^./\\]+)$/;

/**
 * タイル源に渡す URL を、renderer が読める現行形へ変換する（oct26-m4-t2s2）。**表示専用で、url_ 自体は書き換えない。**
 *
 * 更新前の版で作った未保存下書きは url_ が旧形のまま復元される:
 *   - v1.0.0（公開版）: `file:///<userData>/draft-tiles/<uid>/{z}/{x}/{y}.<ext>`（webSecurity 下の renderer は file:// を読めない）
 *   - m4-t2 期（未公開ビルド）: `app://local/<abs>/…`（renderer と別 origin のため CORS 拒否）
 * そのままタイル源に渡すと保存するまで対応点編集の左ペインが真っ白になる（IR2 Minor-2）。保存時の正規化は main の
 * `normalizeLegacyTileUrl`（oct26-m4-t2s）が担うので、ここでは表示のときだけ同じ形へ写す。
 *
 * 規則は main の `migrateLegacyFileUrl`（electron/utils/appScheme.ts）と同じ出力になるよう複製する
 * （renderer は node:url の fileURLToPath を使えない。一致は scripts/oct26-m4-t2ff-app-scheme-same-origin-smoke.mjs [6] が固定する）:
 *   - 旧 `app://local/…` → `app://bundle/__local/…`（経路部分は無加工）
 *   - `file://…/{z}/{x}/{y}.<ext>` → テンプレート手前を実パスへ復号し `localFileUrl` で再符号化（テンプレートは literal のまま）
 *   - それ以外（新形・http(s)・テンプレートの無い file:// 等）と文字列以外はそのまま
 * main（POSIX の fileURLToPath）が例外にする形はそのまま返す: host 付き・`%2F`・不正な percent-encoding。
 * `%5C` も変換しない（renderer は `\` を区切りとして扱うため。main の出力も `appUrlToLocalPath` が拒否して配信されない）。
 * 許可の判定はしない。配信してよいかは main の resolveAppUrl（許可ルートの境界込み判定）が従来どおり決める。
 */
export function displayTileUrl<T>(url: T): T {
  if (typeof url !== 'string') return url;
  if (url.startsWith(LEGACY_LOCAL_URL_PREFIX + '/')) {
    return `${LOCAL_URL_PREFIX}${url.slice(LEGACY_LOCAL_URL_PREFIX.length)}` as T;
  }
  if (!url.startsWith('file://')) return url;
  const m = url.match(TILE_TEMPLATE_SUFFIX);
  if (!m) return url;
  let u: URL;
  try {
    u = new URL(m[1]);
  } catch {
    return url;
  }
  if (u.protocol !== 'file:' || u.hostname !== '') return url;
  if (/%2f|%5c/i.test(u.pathname)) return url;
  const segments = u.pathname.split('/').map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  });
  if (segments.some((s) => s === null)) return url;
  return `${localFileUrl(fromUrlPath(segments.join('/')))}/${m[2]}` as T;
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
