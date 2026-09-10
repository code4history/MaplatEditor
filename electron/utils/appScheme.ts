/**
 * appScheme.ts (#105 / oct26-m4-t2)
 *
 * renderer を file:// ではなく app:// カスタムスキームで配信し、webSecurity:true の下で
 * ローカルリソース（saveFolder 配下のタイル・サムネイル等）と同梱リソース（dist/public）を
 * 許可経路の allowlist に限定して配信するための、経路解決の純関数と URL ビルダー。
 *
 * 本モジュールは electron を import しない。AC-1 の smoke が
 * `node --experimental-strip-types` で直接 import できることが前提
 * （前例: electron/utils/releaseChannel.ts）。
 *
 * エンコード規約（renderer 側 src/utils/appUrl.ts と必ず同期させること）:
 *   - パスは `encodeURIComponent` をセグメント単位で適用（`#` / `?` / `%` / 空白 / 非 ASCII も安全）。
 *   - Windows ドライブレター `C:`（先頭セグメント直後）だけはエンコードせず残す。
 *   - URL 経路は先頭 `/` を保証（`C:\...` → `/C:/...`）。
 *   - 復号は `fileURLToPath` と同じく encoded 区切り文字（`%2F` / `%5C`）を拒否して迂回を防ぐ。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_SCHEME = 'app';
export const BUNDLE_HOST = 'bundle';
export const LOCAL_HOST = 'local';

// ネイティブ絶対パス → URL 経路部分。先頭 `/` を保証（Windows 'C:\x' → '/C:/x'）。
function toUrlPath(nativePath: string, sep: string = path.sep): string {
  const forward = nativePath.split(sep).join('/');
  return forward.startsWith('/') ? forward : `/${forward}`;
}

// URL 経路部分 → ネイティブ絶対パス。'/C:/x' → 'C:/x'（Windows ドライブレターのみ先頭 `/` を剥がす）。
function fromUrlPath(urlPath: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(urlPath) ? urlPath.slice(1) : urlPath;
}

/**
 * ネイティブ絶対パス → `app://local/<path>`。
 * saveFolder 配下のローカルリソース（タイル・サムネイル・merc・画像アセット等）の表示用 URL。
 */
export function localFileUrl(absPath: string): string {
  const segments = toUrlPath(absPath).split('/');
  const encoded = segments
    .map((s, i) => (i === 1 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)))
    .join('/');
  return `app://${LOCAL_HOST}${encoded}`;
}

/**
 * `app://local/<path>` → ネイティブ絶対パス。scheme / host が一致しない場合は null。
 * encoded 区切り文字（%2F / %5C）は fileURLToPath と同じく拒否する（迂回防止）。
 */
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

/**
 * 同梱リソース（public / dist の相対パス）→ `app://bundle/<relPath>`。
 */
export function bundleFileUrl(relPath: string): string {
  const forward = relPath.split(/[\\/]+/).join('/').replace(/^\/+/, '');
  return `app://${BUNDLE_HOST}/${forward}`;
}

/**
 * 旧 `file://` のタイル URL テンプレートを `app://local` へ補正する（#105 / oct26-m4-t2 MIN-2）。
 *
 * 旧実装（file-url ライブラリ + 手組み `/{z}/{x}/{y}.<ext>`）が生成した交換形 url は
 * `file:///abs/path/{z}/{x}/{y}.<ext>` の形で永続データに残り得る。webSecurity:true の下では
 * renderer が file:// を読めないため、プレフィックスの実パス部分だけを再符号化して
 * `app://local/<encoded>/abs/path/{z}/{x}/{y}.<ext>` へ写す。
 *
 * テンプレートサフィックスの `{z}/{x}/{y}` は literal のまま残す。`localFileUrl` をそのまま
 * 当てると `%7Bz%7D` に符号化されてタイルテンプレートが壊れるため、サフィックスを分離して
 * プレフィックス（実パス）だけを対象にする（`fileURLToPath` で旧 file URL を実パスへ復号）。
 *
 * 是正の範囲は「実際に旧実装が生成した形」に限る:
 * - `file://` 以外（http/https/app:// 等）はそのまま返す（リモートタイル・既に app://local の URL を壊さない）
 * - `/{z}/{x}/{y}.<ext>` サフィックスを持たない独自形式はそのまま返す（壊すより旧 URL のまま残す）
 */
export function migrateLegacyFileUrl(url: string): string {
  if (!url.startsWith('file://')) return url;
  const m = url.match(/^(.*)\/(\{z\}\/\{x\}\/\{y\}\.[^./\\]+)$/);
  if (!m) return url;
  try {
    const nativePrefix = fileURLToPath(m[1]);
    return `${localFileUrl(nativePrefix)}/${m[2]}`;
  } catch {
    return url;
  }
}

export interface AppSchemeRoots {
  /** renderer 同梱リソースの探索ルート（先勝ち。例: [dist, public]） */
  bundleRoots: string[];
  /**
   * ローカルリソースの許可ルート（複数）。`localFileUrl()` で実際に URL 化される置き場所だけを
   * 列挙する（saveFolder / draftTileRoot / tmpFolder 配下の tiles）。この配下だけ配信を許可する。
   */
  localRoots: string[];
}

export interface AppUrlResolution {
  filePath: string;
  mimeType: string;
}

// ルート直下（root 自身または root + 区切り境界込みの配下）だけを許可する。
// 素朴な startsWith(root) は兄弟 dir `{root}-x` を通すため境界込みで判定する
// （resourceAssets.isUnderFolder / AppPreviewService の封じ込めと同じ規約）。
function isUnderRoot(candidate: string, root: string): boolean {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === base || resolved.startsWith(base + path.sep);
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * app:// URL を許可経路の allowlist に照らして実ファイルパスへ解決する純関数。
 *
 * - `app://bundle/<rel>` … bundleRoots 配下の相対パス（renderer / 同梱リソース）
 * - `app://local/<abs>`  … localRoots（saveFolder / draftTileRoot / tmpFolder 配下 tiles）の
 *                           いずれかに含まれる絶対パス（ローカルリソース）
 * - それ以外（file:// / http(s):// / 未知 host）は null（拒否）
 *
 * 実体の存在確認は行わない（handler 側が net.fetch で 404 を返す）。ここでは
 * 「解決が許可されるか」と解決先パス・MIME だけを返す。
 */
export function resolveAppUrl(rawUrl: string, roots: AppSchemeRoots): AppUrlResolution | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  // file:// / http(s):// 等、app: 以外の scheme は一律拒否
  if (u.protocol !== 'app:') return null;

  if (u.hostname === BUNDLE_HOST) {
    const rel = decodePathname(u.pathname).replace(/^\/+/, '');
    if (!rel || rel.split('/').some((s) => s === '..')) return null;
    for (const root of roots.bundleRoots) {
      const candidate = path.resolve(root, rel);
      if (isUnderRoot(candidate, root)) {
        return { filePath: candidate, mimeType: mimeFor(candidate) };
      }
    }
    return null;
  }

  if (u.hostname === LOCAL_HOST) {
    const nativePath = appUrlToLocalPath(rawUrl);
    if (nativePath === null) return null;
    // MAJ-1 是正: localRoots のいずれかの許可ルート配下かを判定する（旧実装は localRoot 単一で、
    // draftTileRoot / tmpFolder 配下 tiles の下書き・一時タイルが 403 になっていた）。
    if (!roots.localRoots.some((root) => isUnderRoot(nativePath, root))) return null;
    return { filePath: nativePath, mimeType: mimeFor(nativePath) };
  }

  // 未知 host（無許可 origin）
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
};

/** 拡張子から MIME を導出する（配信ヘッダ用）。未知は octet-stream。 */
export function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}
