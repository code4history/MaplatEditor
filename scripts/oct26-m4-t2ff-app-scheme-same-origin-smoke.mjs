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
//   [6] renderer 複製（src/utils/appUrl.ts）が electron 側と同じ URL を作る
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
  assert.equal(expectedLocalHeaders["x-content-type-options"], "nosniff");
  assert.equal(expectedLocalHeaders["cross-origin-resource-policy"], "same-origin");
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
  console.log("  [6/6] renderer 複製（src/utils/appUrl.ts）と同じ URL: PASS");
}

console.log("=== oct26-m4-t2ff app-scheme same-origin smoke: PASS ===");
