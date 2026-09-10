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

import { resolveAppUrl, localFileUrl, migrateLegacyFileUrl } from "../electron/utils/appScheme.ts";

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
  // MAJ-1 是正（実装レビュー Round 1）: localFileUrl() が URL 化する置き場所は saveFolder だけでなく
  //   - draftTileRoot（userData/draft-tiles。下書き staging タイル）
  //   - tmpFolder/tiles（OS 一時ディレクトリ MaplatEditor 配下の tiles。後方互換 tmp タイル）
  // も含む。これらを正規の配信ルートとして許可し、それ以外は引き続き拒否する。
  // allowlist を広げすぎないため、tmpFolder 直下は「tiles サブディレクトリのみ」を許可する。
  const saveFolder = "/tmp/oct26-m4-t2/save";
  const draftTileRoot = "/tmp/oct26-m4-t2/userData/draft-tiles";
  const tmpFolder = "/tmp/oct26-m4-t2/temp/MaplatEditor";
  const tmpTilesRoot = path.join(tmpFolder, "tiles");
  const localRoots = [saveFolder, draftTileRoot, tmpTilesRoot];
  const roots = { bundleRoots, localRoots };

  // (a) 許可経路: bundle 配下の renderer（先勝ちで最初の bundleRoot へ解決）
  const idx = resolveAppUrl("app://bundle/index.html", roots);
  assert.ok(idx, "app://bundle/index.html は解決されるべき");
  assert.equal(idx.filePath, path.join(bundleRoots[0], "index.html"));
  assert.equal(idx.mimeType, "text/html");

  // (a) 許可経路: local（saveFolder）配下のローカルリソース
  const tileUrl = localFileUrl(path.join(saveFolder, "tiles", "abc", "0", "0.png"));
  const tile = resolveAppUrl(tileUrl, roots);
  assert.ok(tile, `${tileUrl} は解決されるべき`);
  assert.equal(tile.filePath, path.join(saveFolder, "tiles", "abc", "0", "0.png"));
  assert.equal(tile.mimeType, "image/png");

  // (a) 許可経路（MAJ-1 是正）: draftTileRoot 配下の下書きタイル
  const draftUrl = localFileUrl(path.join(draftTileRoot, "map-uid-1", "0", "0", "0.png"));
  const draft = resolveAppUrl(draftUrl, roots);
  assert.ok(draft, `${draftUrl} は解決されるべき（draftTileRoot 配下の下書きタイル）`);
  assert.equal(draft.filePath, path.join(draftTileRoot, "map-uid-1", "0", "0", "0.png"));
  assert.equal(draft.mimeType, "image/png");

  // (a) 許可経路（MAJ-1 是正）: tmpFolder/tiles 配下の後方互換 tmp タイル
  const tmpUrl = localFileUrl(path.join(tmpTilesRoot, "0", "0", "0.png"));
  const tmp = resolveAppUrl(tmpUrl, roots);
  assert.ok(tmp, `${tmpUrl} は解決されるべき（tmpFolder/tiles 配下の tmp タイル）`);
  assert.equal(tmp.filePath, path.join(tmpTilesRoot, "0", "0", "0.png"));
  assert.equal(tmp.mimeType, "image/png");

  // (b) 任意 file:// 絶対パスは拒否
  assert.equal(resolveAppUrl("file:///etc/passwd", roots), null, "file:// 絶対パスは拒否されるべき");

  // (c) 無許可 origin（未知 host / 他 scheme）は拒否
  assert.equal(resolveAppUrl("app://evil/index.html", roots), null, "未知 host（無許可 origin）は拒否されるべき");
  assert.equal(resolveAppUrl("http://127.0.0.1/index.html", roots), null, "http: scheme は拒否されるべき");

  // 許可ルート外（どの localRoot 配下でもない）app://local は拒否
  assert.equal(resolveAppUrl(localFileUrl("/etc/passwd"), roots), null, "localRoot 外の app://local は拒否されるべき");

  // それ以外の場所は引き続き拒否（MAJ-1 是正）: allowlist を広げすぎないことの assert
  //   - tmpFolder 直下の tiles 以外は許可しない（実際に localFileUrl で URL 化されるのは tmpFolder/tiles のみ）
  assert.equal(
    resolveAppUrl(localFileUrl(path.join(tmpFolder, "not-tiles", "x.png")), roots),
    null,
    "tmpFolder の tiles サブディレクトリ以外は拒否されるべき",
  );
  //   - draftTileRoot の兄弟 dir（境界判定）は許可しない
  assert.equal(
    resolveAppUrl(localFileUrl("/tmp/oct26-m4-t2/userData/draft-tiles-evil/x.png"), roots),
    null,
    "draftTileRoot の兄弟 dir（draft-tiles-evil）は拒否されるべき",
  );
  //   - saveFolder の兄弟 dir（境界判定）は許可しない
  assert.equal(
    resolveAppUrl(localFileUrl("/tmp/oct26-m4-t2/save-evil/x.png"), roots),
    null,
    "saveFolder の兄弟 dir（save-evil）は拒否されるべき",
  );

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

// --- AC-1 assert 4（MIN-2 是正）: 旧 file:// タイルURLテンプレート → app://local 補正 ---
{
  // 旧実装（file-url ライブラリ + 手組み `/{z}/{x}/{y}.<ext>`）が生成した交換形 url の
  // file:// テンプレートを app://local へ補正する。テンプレートサフィックス {z}/{x}/{y} は
  // literal のまま残る（%7B に符号化されない）ことを assert する。
  const legacy = migrateLegacyFileUrl("file:///tmp/oct26-m4-t2/save/tiles/a/{z}/{x}/{y}.png");
  assert.equal(
    legacy,
    "app://local/tmp/oct26-m4-t2/save/tiles/a/{z}/{x}/{y}.png",
    "旧 file:// テンプレートは app://local へ補正されるべき（{z}/{x}/{y} は literal のまま）",
  );

  // 補正後の app://local URL は resolveAppUrl で許可ルートとして解決できること
  const migrated = resolveAppUrl(legacy.replace("/{z}/{x}/{y}.png", "/0/0/0.png"), {
    bundleRoots: ["/tmp/oct26-m4-t2/dist", "/tmp/oct26-m4-t2/public"],
    localRoots: ["/tmp/oct26-m4-t2/save", "/tmp/oct26-m4-t2/userData/draft-tiles", "/tmp/oct26-m4-t2/temp/MaplatEditor/tiles"],
  });
  assert.ok(migrated, "補正後の app://local タイル URL は許可ルートとして解決されるべき");
  assert.equal(migrated.filePath, "/tmp/oct26-m4-t2/save/tiles/a/0/0/0.png");

  // http/https / app:// はそのまま（リモートタイル・既に app://local の URL を壊さない）
  assert.equal(migrateLegacyFileUrl("https://example.com/{z}/{x}/{y}.png"), "https://example.com/{z}/{x}/{y}.png");
  assert.equal(migrateLegacyFileUrl("app://local/tmp/x/tiles/a/{z}/{x}/{y}.png"), "app://local/tmp/x/tiles/a/{z}/{x}/{y}.png");

  // 認識できないテンプレート（独自形式）は変更しない（壊すより旧 URL のまま残す）
  assert.equal(migrateLegacyFileUrl("file:///tmp/x/custom_{z}_{x}_{y}.png"), "file:///tmp/x/custom_{z}_{x}_{y}.png");

  console.log("  [4/4] migrateLegacyFileUrl（旧 file:// → app://local 補正）: PASS");
}

console.log("=== 主判定 AC-1: PASS ===");