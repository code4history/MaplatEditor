// oct26-m4-t2 主判定 AC-1: #105 webSecurity 是正 smoke。
// 設計書 docs/superpowers/specs/2026-09-10-oct26-m4-t2-design.md §7 AC-1。
//
// assert 内容:
//   1. electron/main.ts の全 webPreferences から webSecurity:false が除去されている
//      （コメント行・ブロックコメントを剥がして実設定のみ判定）。
//   2. electron/ 配下に protocol.handle('app', …)（+ registerSchemesAsPrivileged）が実在する。
//   3. 経路解決の純関数 resolveAppUrl が許可経路（app://bundle / app://local）を解決し、
//      任意 file:// 絶対パスと無許可 origin を拒否する。
//
// appScheme.ts は electron を import しない純関数なので、`node --experimental-strip-types` で
// 直接 import できる（先例: smoke:m19-t4a-settings-menu-about）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");

import { resolveAppUrl, localFileUrl } from "../electron/utils/appScheme.ts";

// --- AC-1 assert 1: webSecurity:false の実設定除去（コメント除く） ---
{
  const mainTs = await readSrc("electron/main.ts");
  const noComments = mainTs
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const realSettings = (noComments.match(/webSecurity\s*:\s*false/g) || []).length;
  assert.equal(
    realSettings,
    0,
    `electron/main.ts に webSecurity:false の実設定が ${realSettings} 件残存（コメント除く）。` +
    ` #105 はこれを 0 件に是正する`,
  );
  console.log(`  [1/3] webSecurity:false の実設定 ${realSettings} 件（コメント除く）: PASS`);
}

// --- AC-1 assert 2: app:// スキーム登録が実在する ---
{
  const mainTs = await readSrc("electron/main.ts");
  assert.ok(
    /protocol\.handle\(\s*APP_SCHEME\b|protocol\.handle\(\s*['"]app['"]/.test(mainTs),
    "electron/main.ts に protocol.handle(APP_SCHEME, …)（app:// の request handler）が必要",
  );
  assert.ok(
    /registerSchemesAsPrivileged/.test(mainTs),
    "electron/main.ts に registerSchemesAsPrivileged（app: scheme の privileges）が必要",
  );
  console.log("  [2/3] protocol.handle('app', …) + registerSchemesAsPrivileged: PASS");
}

// --- AC-1 assert 3: 経路解決純関数の許可 / 拒否 ---
{
  const bundleRoots = ["/tmp/oct26-m4-t2/dist", "/tmp/oct26-m4-t2/public"];
  const localRoot = "/tmp/oct26-m4-t2/save";
  const roots = { bundleRoots, localRoot };

  // (a) 許可経路: bundle 配下の renderer（先勝ちで最初の bundleRoot へ解決）
  const idx = resolveAppUrl("app://bundle/index.html", roots);
  assert.ok(idx, "app://bundle/index.html は解決されるべき");
  assert.equal(idx.filePath, path.join(bundleRoots[0], "index.html"));
  assert.equal(idx.mimeType, "text/html");

  // (a) 許可経路: local（saveFolder）配下のローカルリソース
  const tileUrl = localFileUrl("/tmp/oct26-m4-t2/save/tiles/abc/0/0.png");
  const tile = resolveAppUrl(tileUrl, roots);
  assert.ok(tile, `${tileUrl} は解決されるべき`);
  assert.equal(tile.filePath, "/tmp/oct26-m4-t2/save/tiles/abc/0/0.png");
  assert.equal(tile.mimeType, "image/png");

  // (b) 任意 file:// 絶対パスは拒否
  assert.equal(resolveAppUrl("file:///etc/passwd", roots), null, "file:// 絶対パスは拒否されるべき");

  // (c) 無許可 origin（未知 host / 他 scheme）は拒否
  assert.equal(resolveAppUrl("app://evil/index.html", roots), null, "未知 host（無許可 origin）は拒否されるべき");
  assert.equal(resolveAppUrl("http://127.0.0.1/index.html", roots), null, "http: scheme は拒否されるべき");

  // 許可ルート外（localRoot 配下でない）app://local は拒否
  assert.equal(resolveAppUrl(localFileUrl("/etc/passwd"), roots), null, "localRoot 外の app://local は拒否されるべき");

  // 経路トラバーサル試行（リテラル '..' / percent-encoded '%2e%2e'）も許可ルート内へ封じ込める。
  // WHATWG URL 正規化と resolveAppUrl の isUnderRoot により、ルート外へ脱出する解決結果は返らない。
  // （AC-1 の要求は file:// 絶対パスと無許可 origin の拒否。本 assert は補強）
  for (const raw of ["app://bundle/../secret.txt", "app://bundle/%2e%2e/secret.txt"]) {
    const res = resolveAppUrl(raw, roots);
    if (res !== null) {
      const inside = bundleRoots.some((r) => {
        const base = path.resolve(r);
        return res.filePath === base || res.filePath.startsWith(base + path.sep);
      });
      assert.ok(inside, `${raw} の解決先が bundleRoots 外へ脱出している（${res.filePath}）`);
    }
  }

  console.log("  [3/3] resolveAppUrl 純関数（許可経路解決 / file:// 拒否 / 無許可 origin 拒否）: PASS");
}

console.log("=== 主判定 AC-1: PASS ===");