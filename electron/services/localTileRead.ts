// タイル 1 枚の読み出し。URL は renderer から届くので、ローカルの読み出しは許可ルートの中に閉じる。
import fs from 'fs-extra';
import { fileURLToPath } from 'node:url';
import { appUrlToLocalPath, isLocalAppUrl, resolveLocalReal } from '../utils/appScheme';
import { getFetchTransport, type FetchLike } from './fetchTransport';

export interface ReadTileDeps {
  /** ローカルの読み出しを許すルート（要求ごとに読む。保存フォルダは実行中に変わる） */
  localRoots: () => string[];
  fs?: { readFile: (file: string) => Promise<Buffer> };
  fetch?: FetchLike;
}

async function readLocalTile(url: string, nativePath: string, deps: ReadTileDeps): Promise<Buffer> {
  const resolved = await resolveLocalReal(nativePath, deps.localRoots(), {
    warn: (...args) => console.warn(...args),
  });
  if (!resolved.ok) throw new Error(`tile outside allowed roots: ${url}`);
  // 判定した実体を読む（判定と読み出しの間にリンクを付け替えられる窓を狭める）
  return (deps.fs ?? fs).readFile(resolved.realPath);
}

// merc マスタのタイル URL は file://（旧）または app://bundle/__local で渡ってくる。Node の fetch は
// file: / app: を解決できないので、そのときだけ実ファイルを読む。
export async function readTile(url: string, deps: ReadTileDeps): Promise<Buffer> {
  if (url.startsWith('file://')) {
    return readLocalTile(url, fileURLToPath(url), deps);
  }
  if (isLocalAppUrl(url)) {
    const localPath = appUrlToLocalPath(url);
    if (localPath === null) throw new Error(`invalid local app url: ${url}`);
    return readLocalTile(url, localPath, deps);
  }
  // 製品（Electron main）では transport 経由で Chromium のネットワークスタックに載る。タイル画像が
  // `Content-Encoding: br` で返っても Node 同梱の brotli を通らない。外部取得用の専用 session では
  // http/https 以外（リダイレクト先を含む）が拒否されるため、302 で app:/file: へ飛ばされても
  // 保存フォルダは読めない。
  const res = await (deps.fetch ?? getFetchTransport())(url, {
    signal: AbortSignal.timeout(10000),
    // 専用 session でクッキーも共有しないが、念のため明示する
    credentials: 'omit',
    // 識別可能なUAを明示する(既定のnode UAを拒否するタイルサーバー対策も兼ねる)
    headers: { 'User-Agent': 'MaplatEditor (https://github.com/code4history/MaplatEditor)' },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
