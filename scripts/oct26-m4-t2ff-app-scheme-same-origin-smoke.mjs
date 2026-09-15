// oct26-m4-t2ff（第 2 版）: ローカルデータの同一 origin 配信の smoke（Electron を起動しない）。
//
// 実画面と origin 境界は tests/e2e/oct26-m4-t2ff-app-local-cors.spec.ts が実行時に測る（AC-FF-1〜8）。
// 本 smoke は e2e を回さない場面でも、是正の要が外されたら落ちるように固定する:
//   [1] URL 形: ローカルデータは renderer と同じ origin（app://bundle/__local/<abs>）で表す。旧 app://local は受理・正規化
//   [2] resolveAppUrl: __local と旧 app://local を localRoots で判定し kind:'local' を返す（同梱物へ落とさない）
//   [3] privileges: 本番（dev server URL なし）は corsEnabled を持たない。dev のときだけ付く
//   [4] handler（createAppSchemeHandler）の実挙動: 403/404/403(EACCES・ディレクトリ)/配信・local 応答の防御ヘッダ・
//       ENOENT 以外の失敗は warn を残す（IR1 Minor-2）
//   [5] main.ts の配線: privileges と handler を上記の関数から作る・corsEnabled / ACAO をリテラルで持たない（IR1 Minor-1）
//   [6] renderer 複製（src/utils/appUrl.ts）が electron 側と同じ URL を作る。表示時の変換 displayTileUrl（oct26-m4-t2s2）は
//       旧 file://・旧 app://local の入力で main の migrateLegacyFileUrl と同じ URL を作る
//
// appScheme.ts / appUrl.ts は electron を import しないので `node --experimental-strip-types` で読める。
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  APP_SCHEME,
  LOCAL_URL_PREFIX,
  appSchemePrivileges,
  appUrlToLocalPath,
  createAppSchemeHandler,
  fsErrorStatus,
  isLocalAppUrl,
  localFileUrl,
  localResponseHeaders,
  migrateLegacyFileUrl,
  normalizeLocalAppUrl,
  resolveAppUrl,
} from "../electron/utils/appScheme.ts";
import * as rendererAppUrl from "../src/utils/appUrl.ts";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// --- [1] URL 形 ---
{
  assert.equal(APP_SCHEME, "app");
  assert.equal(LOCAL_URL_PREFIX, "app://bundle/__local");
  assert.equal(localFileUrl("/Users/a b/地図/tiles/0.png"), "app://bundle/__local/Users/a%20b/%E5%9C%B0%E5%9B%B3/tiles/0.png");
  assert.equal(appUrlToLocalPath("app://bundle/__local/Users/a%20b/t.png"), "/Users/a b/t.png");
  assert.equal(appUrlToLocalPath("app://local/Users/a%20b/t.png"), "/Users/a b/t.png", "旧 app://local も復号する（既存データ互換）");
  assert.equal(appUrlToLocalPath("app://bundle/__local/C:/Users/x/t.png"), "C:/Users/x/t.png", "Windows ドライブレター");
  assert.equal(appUrlToLocalPath("app://bundle/index.html"), null, "同梱物の URL はローカルパスではない");
  assert.equal(appUrlToLocalPath("app://bundle/__localx/t.png"), null, "接頭辞の境界込みで判定する");
  assert.equal(appUrlToLocalPath("app://bundle/__local/a%2Fb.png"), null, "encoded 区切り文字は拒否");
  assert.equal(isLocalAppUrl("app://bundle/__local/x.png"), true);
  assert.equal(isLocalAppUrl("app://local/x.png"), true);
  assert.equal(isLocalAppUrl("app://bundle/index.html"), false);
  assert.equal(isLocalAppUrl("https://example.com/x.png"), false);
  assert.equal(normalizeLocalAppUrl("app://local/tmp/t/{z}/{x}/{y}.png"), "app://bundle/__local/tmp/t/{z}/{x}/{y}.png");
  assert.equal(normalizeLocalAppUrl("app://bundle/__local/tmp/t.png"), "app://bundle/__local/tmp/t.png");
  assert.equal(normalizeLocalAppUrl("https://example.com/{z}/{x}/{y}.png"), "https://example.com/{z}/{x}/{y}.png");
  assert.equal(normalizeLocalAppUrl(undefined), undefined);
  assert.equal(migrateLegacyFileUrl("file:///tmp/s/tiles/a/{z}/{x}/{y}.png"), "app://bundle/__local/tmp/s/tiles/a/{z}/{x}/{y}.png");
  assert.equal(migrateLegacyFileUrl("app://local/tmp/s/tiles/a/{z}/{x}/{y}.png"), "app://bundle/__local/tmp/s/tiles/a/{z}/{x}/{y}.png");
  console.log("  [1/6] URL 形（同一 origin の __local・旧 app://local の受理と正規化）: PASS");
}

// --- [2] resolveAppUrl の kind ---
{
  const roots = { bundleRoots: ["/tmp/oct26-ff/dist"], localRoots: ["/tmp/oct26-ff/save", "/tmp/oct26-ff/draft-tiles"] };
  const b = resolveAppUrl("app://bundle/index.html", roots);
  assert.equal(b?.kind, "bundle");
  const l = resolveAppUrl(localFileUrl("/tmp/oct26-ff/save/tiles/0.png"), roots);
  assert.equal(l?.kind, "local");
  assert.equal(l?.filePath, "/tmp/oct26-ff/save/tiles/0.png");
  const legacy = resolveAppUrl("app://local/tmp/oct26-ff/draft-tiles/u/0/0/0.png", roots);
  assert.equal(legacy?.kind, "local", "旧 app://local も localRoots で判定する");
  assert.equal(resolveAppUrl(localFileUrl("/etc/hosts"), roots), null, "許可ルート外の __local は拒否（同梱物へ落とさない）");
  assert.equal(resolveAppUrl("app://bundle/__local", roots), null);
  // '..' は WHATWG URL 正規化で __local の外（app://bundle/etc/hosts）へ出る。その場合も「同梱物ルート内」の
  // 解決にしかならず、ローカルとして許可ルート外を返すことはない
  for (const raw of [
    "app://bundle/__local/tmp/oct26-ff/save/../../../etc/hosts",
    "app://bundle/__local/tmp/oct26-ff/save/%2e%2e/%2e%2e/%2e%2e/etc/hosts",
  ]) {
    const r = resolveAppUrl(raw, roots);
    assert.ok(
      r === null || (r.kind === "bundle" && r.filePath.startsWith("/tmp/oct26-ff/dist/")),
      `${raw} が許可ルート外のローカルとして解決された: ${JSON.stringify(r)}`,
    );
  }
  console.log("  [2/6] resolveAppUrl（__local / 旧 app://local は kind:local・許可外は null）: PASS");
}

// --- [3] privileges ---
{
  const prod = appSchemePrivileges(undefined);
  assert.equal(prod.standard, true);
  assert.equal(prod.secure, true);
  assert.equal(prod.supportFetchAPI, true);
  assert.equal(prod.stream, true);
  assert.equal("corsEnabled" in prod, false, "本番の app: は corsEnabled を持たない（持つと任意 origin から読める: IR1 Major-1）");
  assert.equal("corsEnabled" in appSchemePrivileges(""), false, "空文字（e2e・配布物の既定）は本番扱い");
  assert.equal(appSchemePrivileges("http://localhost:5173/").corsEnabled, true, "dev は renderer が http origin のため付ける");
  console.log("  [3/6] privileges（本番は corsEnabled なし・dev のみ付与）: PASS");
}

// --- [4] handler の実挙動（実ファイル・node の Response） ---
{
  const work = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "oct26-m4-t2ff-smoke-"));
  const save = path.join(work, "save");
  const dist = path.join(work, "dist");
  await mkdir(path.join(save, "tiles"), { recursive: true });
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, "index.html"), "<!doctype html>");
  await writeFile(path.join(save, "tiles", "0.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(save, "noperm.png"), "x");
  await chmod(path.join(save, "noperm.png"), 0o000);
  await symlink(path.join(save, "nowhere"), path.join(save, "dangling.png"));
  const warns = [];
  const handler = createAppSchemeHandler({
    getRoots: () => ({ bundleRoots: [dist], localRoots: [save] }),
    fetchFile: async (p) => new Response(await readFile(p)),
    warn: (...args) => warns.push(args.join(" ")),
  });
  const get = (u) => handler(new Request(u));
  const expectedLocalHeaders = localResponseHeaders();
  assert.match(expectedLocalHeaders["content-security-policy"], /(^|;\s*)sandbox(;|$)/);
  const hasLocalHeaders = (res) => Object.entries(expectedLocalHeaders).every(([k, v]) => res.headers.get(k) === v);
  try {
    const ok = await get(localFileUrl(path.join(save, "tiles", "0.png")));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.ok(hasLocalHeaders(ok), "local の配信応答に防御ヘッダ");
    assert.equal(ok.headers.get("access-control-allow-origin"), null, "ACAO は付けない");

    const bundle = await get("app://bundle/index.html");
    assert.equal(bundle.status, 200);
    assert.equal(bundle.headers.get("content-security-policy"), null, "同梱物（renderer 本体）には sandbox を付けない");

    const outside = await get(localFileUrl("/etc/hosts"));
    assert.equal(outside.status, 403);

    warns.length = 0;
    const missing = await get(localFileUrl(path.join(save, "tiles", "9", "9.png")));
    assert.equal(missing.status, 404, "ENOENT は 404");
    assert.ok(hasLocalHeaders(missing), "local の 404 にも防御ヘッダ");
    assert.equal(warns.length, 0, "欠損（正常系: MaplatCore は範囲外タイルも要求する）は warn しない");

    const notDir = await get(localFileUrl(path.join(save, "tiles", "0.png", "x.png")));
    assert.equal(notDir.status, 404, "ENOTDIR（途中がファイル）も存在しないパスとして 404");

    const dangling = await get(localFileUrl(path.join(save, "dangling.png")));
    assert.equal(dangling.status, 404, "リンク切れ symlink は ENOENT");

    warns.length = 0;
    const noperm = await get(localFileUrl(path.join(save, "noperm.png")));
    assert.equal(noperm.status, 403, "EACCES は 404 に畳まず 403");
    assert.ok(hasLocalHeaders(noperm));
    assert.equal(warns.length, 1, "EACCES は warn を残す");
    assert.match(warns[0], /EACCES/);

    warns.length = 0;
    const dir = await get(localFileUrl(path.join(save, "tiles")) + "/");
    assert.equal(dir.status, 403, "ディレクトリは 404 に畳まず 403");
    assert.equal(warns.length, 1, "ディレクトリ要求は warn を残す");

    warns.length = 0;
    const failing = createAppSchemeHandler({
      getRoots: () => ({ bundleRoots: [dist], localRoots: [save] }),
      fetchFile: async () => { throw new Error("net::ERR_FAILED"); },
      warn: (...args) => warns.push(args.join(" ")),
    });
    const broken = await failing(new Request(localFileUrl(path.join(save, "tiles", "0.png"))));
    assert.equal(broken.status, 500, "stat 後の読込失敗は 500");
    assert.equal(warns.length, 1, "読込失敗は warn を残す");

    assert.equal(fsErrorStatus("ENOENT"), 404);
    assert.equal(fsErrorStatus("ENOTDIR"), 404);
    assert.equal(fsErrorStatus("EACCES"), 403);
    assert.equal(fsErrorStatus("EPERM"), 403);
    assert.equal(fsErrorStatus("EISDIR"), 403);
    assert.equal(fsErrorStatus("EIO"), 500);
    assert.equal(fsErrorStatus(undefined), 500);
  } finally {
    // 作業領域は削除しない（TMPDIR 配下に残す。権限だけ戻して後から読めるようにする）
    await chmod(path.join(save, "noperm.png"), 0o644).catch(() => {});
  }
  console.log("  [4/6] handler（200/403/404/403(EACCES・dir)/500・防御ヘッダ・warn）: PASS");
}

// --- [5] main.ts の配線 ---
{
  const mainTs = stripComments(await readFile(path.join(projectRoot, "electron/main.ts"), "utf8"));
  const m = mainTs.match(/registerSchemesAsPrivileged\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, "registerSchemesAsPrivileged([...]) が必要");
  assert.match(m[1], /scheme\s*:\s*APP_SCHEME/);
  assert.match(
    m[1],
    /privileges\s*:\s*appSchemePrivileges\(\s*VITE_DEV_SERVER_URL\s*\)/,
    "privileges は appSchemePrivileges(VITE_DEV_SERVER_URL) から作る（本番で corsEnabled を付けない単一の決定点）",
  );
  assert.doesNotMatch(mainTs, /corsEnabled/, "main.ts に corsEnabled を直書きしない");
  assert.doesNotMatch(mainTs, /access-control-allow-origin/i, "ACAO で絞る方式は実行時に効かない（IR1 Major-1）ので使わない");
  assert.match(mainTs, /protocol\.handle\(\s*APP_SCHEME\s*,\s*createAppSchemeHandler\(/, "handler は createAppSchemeHandler で作る");
  const appScheme = stripComments(await readFile(path.join(projectRoot, "electron/utils/appScheme.ts"), "utf8"));
  assert.doesNotMatch(appScheme, /access-control-allow-origin/i);
  console.log("  [5/6] main.ts の配線（appSchemePrivileges(VITE_DEV_SERVER_URL)・createAppSchemeHandler・corsEnabled/ACAO 直書きなし）: PASS");
}

// --- [6] renderer 複製の同期 ---
{
  for (const abs of ["/Users/a b/地図/merc/u", "/tmp/x#y?z%/t.png", "C:/Users/x/t.png"]) {
    assert.equal(rendererAppUrl.localFileUrl(abs), localFileUrl(abs), `renderer と electron の localFileUrl が一致しない: ${abs}`);
    assert.equal(rendererAppUrl.appUrlToLocalPath(localFileUrl(abs)), appUrlToLocalPath(localFileUrl(abs)));
  }
  assert.equal(rendererAppUrl.appUrlToLocalPath("app://local/tmp/t.png"), "/tmp/t.png", "renderer も旧 app://local を復号する");

  // oct26-m4-t2s2: 表示時の変換（renderer の displayTileUrl）は、保存経路の正規化（main の migrateLegacyFileUrl）と
  // 同じ URL を作る。v1.0.0 の未保存下書き（file://…/draft-tiles/<uid>/{z}/{x}/{y}.<ext>）と m4-t2 期の app://local を、
  // 保存前でも対応点編集の左ペインに表示するため。規則が 2 か所にあるので、入力群で出力一致を固定する。
  assert.equal(typeof rendererAppUrl.displayTileUrl, "function", "src/utils/appUrl.ts に displayTileUrl が必要（oct26-m4-t2s2）");
  // v1.0.0 の file-url 4.0.0 と同じ符号化（依存を import せずに書く）
  const fileUrlV1 = (abs) => encodeURI("file://" + abs).replace(/[?#]/g, encodeURIComponent);
  const T = "/{z}/{x}/{y}.jpg";
  const sameAsMain = [
    // 通常の v1.0.0 形（空白・非 ASCII・# ? % を含むパス）
    fileUrlV1("/Users/a b/Library/Application Support/MaplatEditor/draft-tiles/d1111111-1111-4111-8111-111111111111") + T,
    fileUrlV1("/Users/山田/下書き 地図/draft-tiles/u") + "/{z}/{x}/{y}.png",
    fileUrlV1("/tmp/x#y?z%w/draft-tiles/u") + T,
    // Windows ドライブレター（3 本スラッシュ・2 本スラッシュ・小文字・符号化されたコロン）
    "file:///C:/Users/x/AppData/Roaming/MaplatEditor/draft-tiles/u" + T,
    "file://C:/Users/x/draft-tiles/u" + T,
    "file:///c%3A/Users/x/draft-tiles/u" + T,
    // localhost host（WHATWG 解析で空 host になる）・.. と %2e%2e（解析で解決される）・# ? の後ろは経路ではない
    "file://localhost/tmp/draft-tiles/u" + T,
    "file:///tmp/draft-tiles/a/../b" + T,
    "file:///tmp/draft-tiles/%2e%2e/%2E%2E/etc" + T,
    "file:///tmp/a#frag/b" + T,
    "file:///tmp/a?q=1/b" + T,
    "file:///tmp/a%25b%00c" + T,
    "file://" + T,
    // main が変換しない形（renderer もそのまま返す）
    "file:///tmp/a%2Fb/u" + T,
    "file:///tmp/a%2fb/u" + T,
    "file://server/share/draft-tiles/u" + T,
    "file:///tmp/%E3/u" + T,
    "file:///tmp/draft-tiles/u",
    "file:///tmp/draft-tiles/u/{z}/{x}/{y}.jpg.bak",
    "file:///tmp/draft-tiles/u/{z}/{x}/{y}",
    "FILE:///tmp/draft-tiles/u" + T,
    // m4-t2 期の旧 app://local（未公開ビルドの下書き）
    "app://local/Users/a%20b/draft-tiles/u" + T,
    "app://local/C:/Users/x/draft-tiles/u" + T,
    // 変換しない形（新形・リモート・同梱物）
    "app://bundle/__local/Users/a%20b/draft-tiles/u" + T,
    "https://example.com/tiles" + T,
    "app://bundle/assets/x.png",
    "",
  ];
  for (const input of sameAsMain) {
    assert.equal(rendererAppUrl.displayTileUrl(input), migrateLegacyFileUrl(input), `renderer の displayTileUrl と main の migrateLegacyFileUrl が一致しない: ${input}`);
  }
  // 変換される形は同一 origin の新形になり、実パスへ復号できる（配信の許可は main の resolveAppUrl が決める）
  {
    const abs = "/Users/a b/Library/Application Support/MaplatEditor/draft-tiles/d1111111-1111-4111-8111-111111111111";
    const out = rendererAppUrl.displayTileUrl(fileUrlV1(abs) + T);
    assert.ok(out.startsWith("app://bundle/__local/"), out);
    assert.ok(out.endsWith(T), `テンプレートは literal のまま残す: ${out}`);
    assert.equal(appUrlToLocalPath(out.slice(0, -T.length)), abs, out);
    assert.equal(rendererAppUrl.displayTileUrl("app://local/tmp/d" + T), "app://bundle/__local/tmp/d" + T);
  }
  // 意図的な差（設計メモ §3.3）: %5C を含む file:// は、POSIX の main は %5C を含む app URL に写すが、その URL は
  // appUrlToLocalPath が拒否して配信されない。renderer は `\` を区切りとして扱うため変換せずに返す（どちらも表示されない）
  {
    const input = "file:///tmp/a%5Cb/u" + T;
    assert.equal(rendererAppUrl.displayTileUrl(input), input, "renderer は %5C を含む file:// を変換しない");
    const mainOut = migrateLegacyFileUrl(input);
    assert.equal(appUrlToLocalPath(mainOut.slice(0, -T.length)), null, `main の出力も配信できない形であること: ${mainOut}`);
  }
  // 文字列以外はそのまま（mapData.url_ が未設定のとき）
  assert.equal(rendererAppUrl.displayTileUrl(undefined), undefined);
  assert.equal(rendererAppUrl.displayTileUrl(null), null);
  console.log("  [6/6] renderer 複製（src/utils/appUrl.ts）と同じ URL・displayTileUrl と migrateLegacyFileUrl の一致: PASS");
}

console.log("=== oct26-m4-t2ff app-scheme same-origin smoke: PASS ===");
