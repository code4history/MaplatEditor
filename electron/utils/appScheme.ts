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
 * oct26-m4-t2ff（第 2 版）: ローカルリソースは renderer と**同一 origin** の `app://bundle/__local/<abs>` で
 * 配信する。m4-t2 の `app://local/<abs>` は renderer（app://bundle）と別 origin で、MaplatCore の
 * crossOrigin="Anonymous" のタイル読込が CORS 拒否された。別 origin のまま app: に corsEnabled を付けると
 * Chromium は応答の Access-Control-Allow-Origin を検査せず、プレビュー配信（http://127.0.0.1）や data: 等
 * 任意の origin のページから中身を読めてしまう（実装レビュー IR1 Major-1 で実測）。同一 origin 化すれば
 * corsEnabled が不要になり、corsEnabled の無い app:// は他 origin からの CORS 読込（fetch・crossOrigin 画像）を
 * 受け付けないので、renderer 以外は読めない。旧 `app://local` は既存データ互換のため受理して新形へ正規化する。
 *
 * エンコード規約（renderer 側 src/utils/appUrl.ts と必ず同期させること）:
 *   - パスは `encodeURIComponent` をセグメント単位で適用（`#` / `?` / `%` / 空白 / 非 ASCII も安全）。
 *   - Windows ドライブレター `C:`（先頭セグメント直後）だけはエンコードせず残す。
 *   - URL 経路は先頭 `/` を保証（`C:\...` → `/C:/...`）。
 *   - 復号は `fileURLToPath` と同じく encoded 区切り文字（`%2F` / `%5C`）を拒否して迂回を防ぐ。
 */
import { access, constants as fsConstants, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_SCHEME = 'app';
export const BUNDLE_HOST = 'bundle';
/** m4-t2 期の旧ローカル host（受理と正規化のみ。新規には生成しない） */
export const LOCAL_HOST = 'local';
/** 同一 origin のローカルリソース経路の接頭辞（oct26-m4-t2ff） */
export const LOCAL_PATH_PREFIX = '/__local';
/** ローカルリソース URL の接頭辞（renderer と同一 origin） */
export const LOCAL_URL_PREFIX = `${APP_SCHEME}://${BUNDLE_HOST}${LOCAL_PATH_PREFIX}`;
const LEGACY_LOCAL_URL_PREFIX = `${APP_SCHEME}://${LOCAL_HOST}`;

/**
 * app: スキームの privileges（oct26-m4-t2ff）。main.ts の registerSchemesAsPrivileged はここから作る。
 *
 * 本番（dev server URL なし・空文字）では corsEnabled を**付けない**。付けると任意 origin のページから
 * app:// の中身を読めるようになる（IR1 Major-1）。ローカルリソースは同一 origin 配信なので不要。
 * 開発起動（VITE_DEV_SERVER_URL あり）だけは renderer が http://localhost:<port> になり同一 origin にならないため
 * 付ける。dev server URL を与えられる主体は main window に任意 URL を読ませられるので、新しい攻撃面ではない。
 */
export function appSchemePrivileges(devServerUrl?: string | null): {
  standard: true;
  secure: true;
  supportFetchAPI: true;
  stream: true;
  corsEnabled?: true;
} {
  const base = { standard: true, secure: true, supportFetchAPI: true, stream: true } as const;
  return devServerUrl ? { ...base, corsEnabled: true } : { ...base };
}

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
 * ネイティブ絶対パス → `app://bundle/__local/<path>`（oct26-m4-t2ff: renderer と同一 origin）。
 * saveFolder 配下のローカルリソース（タイル・サムネイル・merc・画像アセット等）の表示用 URL。
 */
export function localFileUrl(absPath: string): string {
  const segments = toUrlPath(absPath).split('/');
  const encoded = segments
    .map((s, i) => (i === 1 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)))
    .join('/');
  return `${LOCAL_URL_PREFIX}${encoded}`;
}

/** URL からローカルリソースの経路部分（先頭 `/` 付き）を取り出す。新形・旧 app://local 以外は null。 */
function localPathnameOf(u: URL): string | null {
  if (u.protocol !== 'app:') return null;
  if (u.hostname === BUNDLE_HOST) {
    if (!u.pathname.startsWith(LOCAL_PATH_PREFIX + '/')) return null;
    return u.pathname.slice(LOCAL_PATH_PREFIX.length);
  }
  if (u.hostname === LOCAL_HOST) return u.pathname;
  return null;
}

/** ローカルリソース URL（新形 `app://bundle/__local/` または旧 `app://local/`）か。 */
export function isLocalAppUrl(url: unknown): boolean {
  return typeof url === 'string' && (url.startsWith(LOCAL_URL_PREFIX + '/') || url.startsWith(LEGACY_LOCAL_URL_PREFIX + '/'));
}

/**
 * 旧 `app://local/<path>` を新形 `app://bundle/__local/<path>` へ文字列のまま写す（oct26-m4-t2ff）。
 * 経路部分（percent-encoding・`{z}/{x}/{y}` テンプレート）は無加工で残す。それ以外の値はそのまま返す。
 */
export function normalizeLocalAppUrl<T>(url: T): T {
  if (typeof url === 'string' && url.startsWith(LEGACY_LOCAL_URL_PREFIX + '/')) {
    return `${LOCAL_URL_PREFIX}${url.slice(LEGACY_LOCAL_URL_PREFIX.length)}` as T;
  }
  return url;
}

/**
 * ローカルリソース URL（新形・旧 app://local）→ ネイティブ絶対パス。それ以外は null。
 * encoded 区切り文字（%2F / %5C）は fileURLToPath と同じく拒否する（迂回防止）。
 */
export function appUrlToLocalPath(appUrl: string): string | null {
  try {
    const u = new URL(appUrl);
    const pathname = localPathnameOf(u);
    if (pathname === null) return null;
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
  // oct26-m4-t2ff: m4-t2 期の旧 app://local も同一 origin の新形へ写す
  if (url.startsWith(LEGACY_LOCAL_URL_PREFIX + '/')) return normalizeLocalAppUrl(url);
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

/**
 * 保存・staging 判定の入口で url_ を現行形へ正規化する（oct26-m4-t2s 第 2 版・MAJ-1）。
 *
 * 公開済み v1.0.0 で画像を取り込み未保存で終了した hot-exit 下書きは、mapData を丸ごと electron-store に残すため、
 * url_ が `file:///<userData>/draft-tiles/<uid>/{z}/{x}/{y}.<ext>`（v1.0.0 の imageCutter の形）のまま復元される。
 * 正規化が `normalizeLocalAppUrl`（旧 app://local だけ）だと file:// は staging とも tmp とも判定されず、
 * 保存が Success を返しながらタイル・原本を恒久領域へ移さず、下書き削除で staging ごと画像が消えた。
 *
 * 規則は保存済み `json.url` 用の `migrateLegacyFileUrl` と同一（旧 app://local → 新形 / `file://…/{z}/{x}/{y}.<ext>` →
 * 新形 / それ以外は無加工）。正規化は URL の形を揃えるだけで許可の判定はしない。staging・tmp・複製元のどれに当たるかは
 * 呼び出し側が従来どおり「許可ルートから組んだ接頭辞（境界込み）」と `resolveDraftTileDir` の包含検証で決めるので、
 * 許可ルート外・境界外の file:// を正規化しても移動元にはならない（`resolveAppUrl` の localRoots 判定と同じ境界規約）。
 * 文字列以外（undefined 等）はそのまま返す。
 */
export function normalizeLegacyTileUrl<T>(url: T): T {
  return (typeof url === 'string' ? migrateLegacyFileUrl(url) : url) as T;
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
  /** bundle = 同梱リソース（renderer 本体） / local = ローカルリソース（防御ヘッダを付けて配信する） */
  kind: 'bundle' | 'local';
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

  // oct26-m4-t2ff: ローカルリソース（新形 app://bundle/__local/ と旧 app://local/）は localRoots で判定する。
  // bundle host でも __local 接頭辞なら同梱物側へは落とさない（許可外は null）。
  if (localPathnameOf(u) !== null || (u.hostname === BUNDLE_HOST && u.pathname === LOCAL_PATH_PREFIX)) {
    const nativePath = appUrlToLocalPath(rawUrl);
    if (nativePath === null) return null;
    // MAJ-1 是正: localRoots のいずれかの許可ルート配下かを判定する（旧実装は localRoot 単一で、
    // draftTileRoot / tmpFolder 配下 tiles の下書き・一時タイルが 403 になっていた）。
    if (!roots.localRoots.some((root) => isUnderRoot(nativePath, root))) return null;
    return { filePath: nativePath, mimeType: mimeFor(nativePath), kind: 'local' };
  }

  if (u.hostname === BUNDLE_HOST) {
    const rel = decodePathname(u.pathname).replace(/^\/+/, '');
    if (!rel || rel.split('/').some((s) => s === '..')) return null;
    for (const root of roots.bundleRoots) {
      const candidate = path.resolve(root, rel);
      if (isUnderRoot(candidate, root)) {
        return { filePath: candidate, mimeType: mimeFor(candidate), kind: 'bundle' };
      }
    }
    return null;
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

/**
 * ローカルリソース応答に付ける防御ヘッダ（oct26-m4-t2ff）。
 * 同一 origin 配信にしたことで、saveFolder 内の HTML/SVG を renderer と同じ origin で開けるようになる。
 * CSP `sandbox` でその文書を不透明 origin として開き、スクリプトを走らせない（renderer の DOM・preload API に届かない。
 * 外すと同一 origin の iframe から親の DOM を書き換えられることを e2e AC-FF-7 の変異で実測）。
 * CORP `same-origin` は app:// では効かなかった（付けても他 origin の crossOrigin 無し <img> が表示できた・実測）ので付けない。
 * nosniff は Content-Type を mimeFor で明示しており、効きを確かめた経路が無いので付けない。
 */
export function localResponseHeaders(): Record<string, string> {
  return {
    'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
  };
}

/**
 * ファイル読込失敗の errno → HTTP status（oct26-m4-t2ff・IR1 Minor-2）。
 * 404 は「存在しない」（ENOENT・途中がファイルの ENOTDIR）に限る。MaplatCore は範囲外タイルも要求するので
 * 欠損は正常系。権限・ディレクトリ等は 403、それ以外は 500 とし、404 に畳んで原因を隠さない。
 */
export function fsErrorStatus(code: string | undefined): number {
  if (code === 'ENOENT' || code === 'ENOTDIR') return 404;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR') return 403;
  return 500;
}

export interface AppSchemeHandlerDeps {
  /** 要求ごとの許可ルート（saveFolder 等は設定で変わるため要求ごとに引く） */
  getRoots: () => AppSchemeRoots;
  /** 解決済みの実ファイルを読む（main では net.fetch(file://…)） */
  fetchFile: (filePath: string) => Promise<Response>;
  /** 欠損以外の失敗の記録先（main では console.warn） */
  warn: (...args: unknown[]) => void;
}

/**
 * protocol.handle(APP_SCHEME, …) に渡す handler を作る（oct26-m4-t2ff）。electron に依存しないので smoke で実挙動を測れる。
 * - 許可経路外 → 403
 * - stat / 読取権限の確認に失敗 → fsErrorStatus（ENOENT/ENOTDIR 以外は warn）・ディレクトリ → 403＋warn・読込例外 → 500＋warn
 * - Content-Type は mimeFor が導出した値を明示（MIN-1）
 * - ローカルリソースの応答（失敗応答を含む）には localResponseHeaders を付ける。ACAO は付けない
 */
export function createAppSchemeHandler(deps: AppSchemeHandlerDeps): (request: Request) => Promise<Response> {
  const text = (status: number, body: string, extra: Record<string, string>) =>
    new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...extra } });
  return async (request: Request): Promise<Response> => {
    const resolution = resolveAppUrl(request.url, deps.getRoots());
    if (!resolution) return text(403, 'Forbidden', {});
    const extra = resolution.kind === 'local' ? localResponseHeaders() : {};
    try {
      const st = await stat(resolution.filePath);
      if (st.isDirectory()) {
        deps.warn(`[app-scheme] directory request refused (403): ${request.url}`);
        return text(403, 'Forbidden', extra);
      }
      // stat は読取権限が無くても成功するので、読めるかを先に確かめて EACCES を 403 として区別する
      await access(resolution.filePath, fsConstants.R_OK);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      const status = fsErrorStatus(code);
      if (status !== 404) deps.warn(`[app-scheme] ${code ?? 'unknown'} (${status}): ${request.url}`);
      return text(status, status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : 'Internal Server Error', extra);
    }
    let res: Response;
    try {
      res = await deps.fetchFile(resolution.filePath);
    } catch (e) {
      deps.warn(`[app-scheme] read failed (500): ${request.url}: ${String(e)}`);
      return text(500, 'Internal Server Error', extra);
    }
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': resolution.mimeType, ...extra },
    });
  };
}
