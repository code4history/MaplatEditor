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
 *
 * oct26-m4-t6（#120）: 応答に付ける CSP は `createAppSchemeHandler` の 1 分岐（responseHeadersFor）で決める。
 *   - 同梱の HTML（index.html・about.html）には renderer CSP（RENDERER_CSP）だけを付ける
 *   - ローカルリソース（__local・旧 app://local）には sandbox の CSP＋nosniff（localResponseHeaders）だけを付ける
 *   - 2 本を重ねない（重ねると両方が適用され、sandbox 側の意図と別の制約が混ざる）。同梱の非 HTML には付けない
 *
 * nov26-m7-t7（#138）: ローカルリソースの封じ込めの**最終判定を字面から実体へ**移す。許可ルートの**中**に置かれた
 * symlink・ジャンクション（Windows）が外を指している場合、従来は path.resolve の前方一致（isUnderRoot）だけで判定していた
 * ため、その先を配信していた。以後は許可ルートと候補の**両方を同じ関数（fs.realpath）で実体にしてから** isUnderRoot を当てる
 * （resolveLocalReal）。許可ルートそのものがリンクの場合は実体同士で比べるので通る（保存フォルダを OneDrive の下に
 * 置く使い方を壊さない）。外を指すリンクの先は、先が実在しても欠損していても 403 とし、ルートの外の存在の有無を漏らさない。
 * 字面の配下判定（前方一致）は**ローカルの判定から外した**——ルートが 8.3 名・大文字小文字違いで書かれていると実体の
 * 判定に届かないため。ただし**fs に触れる前の形の検査（localPathShape）は必ず前**に置く。これは UNC（`\\host\share`）・
 * `\\?\`・`\\.\`・ルートの無いドライブ・`/net/<host>` 等、**要求者が URL で選べるパス**で realpath が外へ接続しないため。
 * `resolveAppUrl` は同梱物の解決と他の純関数の検査に残す（字面の判定のまま。挙動は変えない）。
 */
import { access, constants as fsConstants, lstat, readlink, realpath, stat } from 'node:fs/promises';
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

/** リンクをたどる上限（resolveLocalReal。自分を指す輪はここで止めて 403 にする） */
const LINK_BUDGET = 40;

/**
 * ローカルリソースの**形の検査**（nov26-m7-t7・#138・MAJ-3）。fs に触れない純関数。
 *
 * `realpath` を呼ぶ前に「要求者が URL で選べるパスが、ネットワークの場所や別のドライブを指していないか」を字面だけで
 * 落とす段。UNC（`\\host\share`＝SMB の接続と NTLM の送出）・`\\?\`・`\\.\`・ルートの無いドライブ（Windows）・
 * `/net/<host>`・`/Volumes/<共有>`（POSIX）への要求で、403 を返す前に外部への接続が起きるのを防ぐ。
 *
 * 見るのは **8.3 名・大文字小文字の影響を受けない段だけ**（Windows はドライブ文字、POSIX は先頭の 2 段。ルートが
 * 1 段しか無ければ 1 段）。∴ ルートが 8.3 名・大文字小文字違いで書かれていても、実体の判定（resolveLocalReal）に届く。
 * 比べるのは大文字小文字を区別しない形にする（macOS の既定の APFS は区別しない。区別する volume でも、ずれたものが
 * `realpath` の段で外れるだけで安全側）。
 *
 * `localRoots` には**ルートの字面と実体の両方**を渡す（macOS は `TMPDIR` の `/var/folders/…` の実体が
 * `/private/var/…` なので、片方だけだと実体側の表記の要求が形で落ちてしまう）。ルートが空なら `reject`。
 */
export function localPathShape(
  nativePath: string,
  localRoots: string[],
  platform: NodeJS.Platform = process.platform,
): 'ok' | 'reject' {
  if (localRoots.length === 0) return 'reject';
  if (platform === 'win32') {
    // ドライブ文字だけを見る（8.3 名を持たず、大文字小文字だけが揺れる段）
    const driveOf = (p: string): string | undefined => path.win32.resolve(p).match(/^([A-Za-z]):\\/)?.[1]?.toLowerCase();
    // 【NOV26-IR-M7-T7-0445 MAJOR-1】候補は、fs に渡す生の文字列そのものが「ドライブ文字＋区切り」で始まることを
    // 必須にする。path.win32.resolve は `/\\host\share\x`（Win32 では UNC）を UNC と見なさず cwd のドライブを
    // 補うので、resolve の後だけを見ると UNC 形が形の検査を抜けて realpath（＝ネットワークへの接続）に届く。
    // 正当な候補は fromUrlPath から常に `C:/…` の形で来るので、これで落ちる正当な要求は無い
    if (!/^[A-Za-z]:[\\/]/.test(nativePath)) return 'reject';
    const drive = driveOf(nativePath);
    if (!drive) return 'reject';
    return localRoots.some((root) => driveOf(root) === drive) ? 'ok' : 'reject';
  }
  // POSIX は先頭の 2 段（ルートが 1 段しか無ければ 1 段）を大文字小文字を区別せずに比べる
  const segmentsOf = (p: string): string[] => path.posix.resolve(p).split('/').filter((s) => s !== '');
  const candidate = segmentsOf(nativePath);
  for (const root of localRoots) {
    const rootSegments = segmentsOf(root);
    const depth = Math.min(2, rootSegments.length);
    if (candidate.length < depth) continue;
    let same = true;
    for (let i = 0; i < depth; i += 1) {
      if (candidate[i].toLowerCase() !== rootSegments[i].toLowerCase()) {
        same = false;
        break;
      }
    }
    if (same) return 'ok';
  }
  return 'reject';
}

/**
 * ローカルリソースの最終判定（nov26-m7-t7・#138）。許可ルートと候補の**両方を `realpath` で実体にしてから**
 * isUnderRoot（境界込み）を当てる。handler から呼ばれ、fs を差し替えられるので smoke で実挙動を測れる。
 *
 * 段（設計 §3.1 の 2 と同じ番号）:
 * 1. ルートの実体。`ENOENT`・`ENOTDIR` のルートは**許可から外す**（存在しないルートは許可しない。字面に落とさない）。
 *    それ以外の errno のルートも外し、記録は `deps.warn` に流す
 * 1.5 形の検査（localPathShape・fs に触れない）。落ちたら 403（`outside`・warn しない）
 * 2. 候補の実体。実体ルートの配下（境界込み）なら `ok`。配下でなければ 403（字面ではルートの配下だった場合だけ
 *    `link-escapes`＝warn）。`ENOENT`・`ENOTDIR`・`ELOOP` は classifyMissing で「存在しない」とリンクを分ける
 * 3. classifyMissing: 最も深い既存の段 `p` を `lstat` で探し、(i) `p` がリンクなら `readlink` の先に形の検査を当てて
 *    から `realpath` をやり直す（1 回たどるごとに上限を 1 減らし、0 で 403）。(ii) リンクでなければ `realpath(p)` が
 *    実体ルートの配下なら 404（ルート内の欠損は正常系）、外なら 403
 *
 * ∴ 外を指すリンクは、先が実在しても（生きたリンク）欠損していても（壊れたリンク）同じ 403 になり、ルートの外の
 * 存在の有無を 404／403 の差で漏らさない。**注**: classifyMissing の形の検査は段 2 の `realpath(候補)` の後なので、
 * 利用者が置いたリンクの先がネットワークの場所を指している場合、その接続は防がない（OS が段 2 で既にたどっている）。
 * 本関数が守るのは**要求者が URL で選べるパス**だけ（設計 §13 の Info）。
 */
export type LocalRealResolution =
  | { ok: true; lexicalPath: string; realPath: string }
  | { ok: false; status: 403 | 404 | 500; reason: 'outside' | 'link-escapes' | 'missing' | 'error'; code?: string };

/** resolveLocalReal が使う fs（既定は node:fs/promises。smoke が呼び出しを数えるために差し込む） */
export interface LocalRealDeps {
  realpath?: (filePath: string) => Promise<string>;
  lstat?: (filePath: string) => Promise<{ isSymbolicLink(): boolean }>;
  readlink?: (filePath: string) => Promise<string>;
  platform?: NodeJS.Platform;
  /** ルートの realpath が ENOENT/ENOTDIR 以外で失敗したときの記録先（省略可） */
  warn?: (...args: unknown[]) => void;
}

export async function resolveLocalReal(
  nativePath: string,
  localRoots: string[],
  deps: LocalRealDeps = {},
): Promise<LocalRealResolution> {
  const realpathOf = deps.realpath ?? realpath;
  const lstatOf = deps.lstat ?? lstat;
  const readlinkOf = deps.readlink ?? readlink;
  const platform = deps.platform ?? process.platform;

  // (1) ルートの実体。存在しない・解決できないルートは許可から外す（字面に落とさない）
  const realRoots: string[] = [];
  const lexicalRoots: string[] = [];
  for (const root of localRoots) {
    try {
      realRoots.push(await realpathOf(root));
      lexicalRoots.push(root);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        deps.warn?.(`[app-scheme] root realpath failed (${code ?? 'unknown'}): ${root}`);
      }
    }
  }
  // (1.5) 形の検査（fs に触れない。ルートが 1 つも解決できなければ空になり reject）
  if (localPathShape(nativePath, [...lexicalRoots, ...realRoots], platform) === 'reject') {
    return { ok: false, status: 403, reason: 'outside' };
  }

  const isLexicallyInside = (): boolean => lexicalRoots.some((root) => isUnderRoot(nativePath, root));
  const isReallyInside = (p: string): boolean => realRoots.some((root) => isUnderRoot(p, root));
  const escapes = (): LocalRealResolution =>
    isLexicallyInside()
      ? { ok: false, status: 403, reason: 'link-escapes' }
      : { ok: false, status: 403, reason: 'outside' };
  const isMissingCode = (code: string | undefined): boolean =>
    code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';

  // (3): 存在しないパスとリンクを段ごとに分ける（外の欠損も 403 にする・MIN-10）
  const classifyMissing = async (target: string, rest: string[], budget: number): Promise<LocalRealResolution> => {
    // 3-1. target から上へ、lstat が成功する最も深い段 p を探す（p より下の段を rest に積む）
    let current = target;
    const below = [...rest];
    let p: string | null = null;
    let pIsLink = false;
    for (;;) {
      try {
        const st = await lstatOf(current);
        p = current;
        pIsLink = st.isSymbolicLink();
        break;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) break;
        below.unshift(path.basename(current));
        current = parent;
      }
    }
    if (p === null) return { ok: false, status: 403, reason: 'outside' };

    // 3-2. p がリンクなら、先に形の検査を当ててから realpath をやり直す（段 2 で OS は既にたどっている）
    if (pIsLink) {
      if (budget <= 0) return { ok: false, status: 403, reason: 'link-escapes', code: 'ELOOP' };
      let linkTarget: string;
      try {
        const raw = await readlinkOf(p);
        const base = await realpathOf(path.dirname(p)).catch(() => path.dirname(p));
        linkTarget = path.resolve(base, raw);
      } catch (e) {
        return { ok: false, status: 403, reason: 'link-escapes', code: (e as NodeJS.ErrnoException)?.code };
      }
      if (localPathShape(linkTarget, [...lexicalRoots, ...realRoots], platform) === 'reject') {
        return { ok: false, status: 403, reason: 'link-escapes' };
      }
      const next = below.length > 0 ? path.join(linkTarget, ...below) : linkTarget;
      try {
        const realPath = await realpathOf(next);
        return isReallyInside(realPath) ? { ok: true, lexicalPath: next, realPath } : escapes();
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (isMissingCode(code)) return classifyMissing(next, [], budget - 1);
        return { ok: false, status: fsErrorStatus(code) as 403 | 404 | 500, reason: 'error', code };
      }
    }

    // 3-3. p がリンクでない: ルートの中の欠損は 404（正常系）、外なら 403（存在の有無を漏らさない）
    try {
      const realP = await realpathOf(p);
      if (isReallyInside(realP)) return { ok: false, status: 404, reason: 'missing' };
    } catch {
      // 実体が取れない段は「外」として扱う（下の 403）
    }
    return { ok: false, status: 403, reason: 'outside' };
  };

  try {
    const realPath = await realpathOf(nativePath);
    return isReallyInside(realPath) ? { ok: true, lexicalPath: nativePath, realPath } : escapes();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (isMissingCode(code)) return classifyMissing(nativePath, [], LINK_BUDGET);
    return isLexicallyInside()
      ? { ok: false, status: fsErrorStatus(code) as 403 | 404 | 500, reason: 'error', code }
      : { ok: false, status: 403, reason: 'outside', code };
  }
}

// ローカルの形（新形 `app://bundle/__local/<abs>`・旧 `app://local/<abs>`・接頭辞そのもの）の URL か。
// resolveAppUrl のローカルの分岐と同じ条件（ローカルの最終判定は resolveLocalReal が行い、resolveAppUrl は同梱物の解決に残す）。
function isLocalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return localPathnameOf(u) !== null || (u.hostname === BUNDLE_HOST && u.pathname === LOCAL_PATH_PREFIX);
  } catch {
    return false;
  }
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
 *
 * nov26-m7-t7（#138）: **ローカルの最終判定は createAppSchemeHandler の `resolveLocalReal`（実体）が行う。**
 * 本関数のローカル判定は字面（前方一致）のままで、同梱の解決と「他の純関数・smoke が使う検査」に残す
 * （挙動は変えない。handler のローカルの分岐は本関数のローカルの判定を通らない）。
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
 * renderer（app://bundle の同梱 HTML）に付ける Content-Security-Policy（oct26-m4-t6・#120）。ポリシーの唯一の定義。
 *
 * - script-src／worker-src は `'self'` を書かずパスで限定する。Chromium の `'self'` は同一 origin の
 *   `app://bundle/__local/…`（保存フォルダ・下書きタイル）まで含むので、書くと保存フォルダ内の任意ファイルを
 *   スクリプト／Worker として実行できてしまう（設計レビュー MAJ-1）。`app://bundle/assets/` は Vite の既定出力
 *   （エントリ・chunk・tinComputeWorker）、`app://bundle/about.js` は about ウィンドウの外出し先。
 *   Vite の出力先がこのパスに収まることは oct26-m4-t6-csp smoke が実ビルド物で断言する
 * - img-src は利用者登録のタイル URL を列挙できないので https:／http: を許す。connect-src の http はプレビュー配信
 *   （http://localhost）だけ。frame-src もプレビュー iframe だけで、__local の HTML を renderer に埋め込ませない
 * - dev 起動の main window（http://localhost の vite）はこの handler を通らないので付かない（about は付く）
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  'script-src app://bundle/assets/ app://bundle/about.js',
  "style-src 'self'",
  "img-src 'self' data: https: http:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:*",
  'worker-src app://bundle/assets/',
  'frame-src http://localhost:*',
  "child-src 'none'",
  "media-src 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** 同梱 HTML（renderer の文書）の応答に付けるヘッダ（oct26-m4-t6）。 */
export function bundleDocumentHeaders(): Record<string, string> {
  return { 'content-security-policy': RENDERER_CSP };
}

/**
 * ローカルリソース応答に付ける防御ヘッダ（oct26-m4-t2ff）。
 * 同一 origin 配信にしたことで、saveFolder 内の HTML/SVG を renderer と同じ origin で開けるようになる。
 * CSP `sandbox` でその文書を不透明 origin として開き、スクリプトを走らせない（renderer の DOM・preload API に届かない。
 * 外すと同一 origin の iframe から親の DOM を書き換えられることを e2e AC-FF-7 の変異で実測）。
 * CORP `same-origin` は app:// では効かなかった（付けても他 origin の crossOrigin 無し <img> が表示できた・実測）ので付けない。
 * oct26-m4-t6: nosniff を付ける。効きの経路は renderer からの `<script src>`／`new Worker`（同一 origin なので
 * renderer CSP の origin 単位の許可では止まらない）で、未知拡張子（octet-stream）・.json をスクリプトとして拒否させる
 * （t6 AC7 の e2e で実測）。renderer CSP はここに重ねない。
 */
export function localResponseHeaders(): Record<string, string> {
  return {
    'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
  };
}

/**
 * 応答に付ける防御ヘッダを 1 か所で決める（oct26-m4-t6）。kind で排他に分け、ローカルと同梱 HTML に 2 本の CSP を重ねない。
 */
function responseHeadersFor(resolution: AppUrlResolution): Record<string, string> {
  if (resolution.kind === 'local') return localResponseHeaders();
  if (resolution.mimeType === 'text/html') return bundleDocumentHeaders();
  return {};
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
  /**
   * ローカルの実体判定（resolveLocalReal）に使う fs（省略時は node:fs/promises）。
   * smoke が呼び出しを数えて「形で落ちる要求は fs に触れない」を断言するための口。main は渡さない。
   */
  fs?: Pick<LocalRealDeps, 'realpath' | 'lstat' | 'readlink'>;
}

/**
 * protocol.handle(APP_SCHEME, …) に渡す handler を作る（oct26-m4-t2ff）。electron に依存しないので smoke で実挙動を測れる。
 * - ローカルの形の要求は **resolveLocalReal（実体）** で判定する（nov26-m7-t7・#138）。resolveAppUrl の字面の配下判定は
 *   使わない（ルートが 8.3 名・大文字小文字違いで書かれていると前方一致で 403 になり、実体の判定に届かないため）。
 *   ただし fs に触れる前の形の検査（localPathShape）は必ず前にある（要求者が URL で選べるパスで外部へ接続しない）
 * - 許可経路外 → 403。ルートの外の欠損・外を指すリンクの先も 403（存在の有無を漏らさない）。ルート内の欠損のみ 404
 * - MIME は**要求側（字面）のパス**から決める（実体が .html でも要求が .png なら image/png）
 * - スクリプト系 MIME（.js/.mjs）は**字面と実体の両方**で拒否する（oct26-m4-t6・MAJ-1 の案 B を実体側にも広げる）
 * - stat / 読取権限の確認 / fetchFile は**実体のパス**に対して行う（判定と読み出しの間の付け替えの窓を狭める。閉じはしない）
 * - stat / 読取権限の確認に失敗 → fsErrorStatus（ENOENT/ENOTDIR 以外は warn）・ディレクトリ → 403＋warn・読込例外 → 500＋warn
 * - Content-Type は mimeFor が導出した値を明示（MIN-1）
 * - ローカルリソースの応答（失敗応答を含む）には localResponseHeaders を付ける。ACAO は付けない
 * - 同梱 HTML の応答には renderer CSP（bundleDocumentHeaders）を付ける（oct26-m4-t6）。同梱（app://bundle/<rel>）の分岐は変えない
 */
export function createAppSchemeHandler(deps: AppSchemeHandlerDeps): (request: Request) => Promise<Response> {
  const text = (status: number, body: string, extra: Record<string, string>) =>
    new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...extra } });
  const bodyFor = (status: number): string =>
    status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : 'Internal Server Error';
  return async (request: Request): Promise<Response> => {
    const roots = deps.getRoots();

    // ---- ローカルリソース（新形 app://bundle/__local/・旧 app://local/）: 実体で判定する（#138） ----
    if (isLocalUrl(request.url)) {
      const extra = localResponseHeaders();
      const lexicalPath = appUrlToLocalPath(request.url);
      if (lexicalPath === null) return text(403, 'Forbidden', extra);
      const resolved = await resolveLocalReal(lexicalPath, roots.localRoots, { ...deps.fs, warn: deps.warn });
      if (!resolved.ok) {
        if (resolved.reason === 'link-escapes') {
          deps.warn(`[app-scheme] link-escapes (${resolved.status}): ${request.url}`);
        } else if (resolved.reason === 'error') {
          deps.warn(`[app-scheme] ${resolved.code ?? 'unknown'} (${resolved.status}): ${request.url}`);
        }
        return text(resolved.status, bodyFor(resolved.status), extra);
      }
      // MIME は要求側（字面）で決める。スクリプトの拒否は字面と実体の両側に当てる
      const mimeType = mimeFor(resolved.lexicalPath);
      if (mimeType === 'text/javascript' || mimeFor(resolved.realPath) === 'text/javascript') {
        deps.warn(`[app-scheme] script from local resource refused (403): ${request.url}`);
        return text(403, 'Forbidden', extra);
      }
      try {
        const st = await stat(resolved.realPath);
        if (st.isDirectory()) {
          deps.warn(`[app-scheme] directory request refused (403): ${request.url}`);
          return text(403, 'Forbidden', extra);
        }
        // stat は読取権限が無くても成功するので、読めるかを先に確かめて EACCES を 403 として区別する
        await access(resolved.realPath, fsConstants.R_OK);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        const status = fsErrorStatus(code);
        if (status !== 404) deps.warn(`[app-scheme] ${code ?? 'unknown'} (${status}): ${request.url}`);
        return text(status, bodyFor(status), extra);
      }
      let res: Response;
      try {
        res = await deps.fetchFile(resolved.realPath);
      } catch (e) {
        deps.warn(`[app-scheme] read failed (500): ${request.url}: ${String(e)}`);
        return text(500, 'Internal Server Error', extra);
      }
      return new Response(res.body, { status: res.status, headers: { 'content-type': mimeType, ...extra } });
    }

    // ---- 同梱リソース（app://bundle/<rel>）: 従来どおり resolveAppUrl（字面）で解決する ----
    const resolution = resolveAppUrl(request.url, roots);
    if (!resolution) return text(403, 'Forbidden', {});
    const extra = responseHeadersFor(resolution);
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
      return text(status, bodyFor(status), extra);
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
