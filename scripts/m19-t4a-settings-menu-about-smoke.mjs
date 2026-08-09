// m19-t4a: 設定画面・アプリケーションメニュー・About ウィンドウの整理。
// 設計書 docs/superpowers/specs/2026-08-09-m19-t4a-settings-and-menu-cleanup-design.md
//
// AC4 相当: releaseChannel の純関数を版数 × isPackaged のマトリクスで検証する
// （§12 AC4）。electron を import しないモジュールなので node で直接 import できる。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");

import { shouldShowDevelopmentMenu, isRcOrLater } from "../electron/utils/releaseChannel.ts";

// --- AC4: shouldShowDevelopmentMenu の版数 × isPackaged マトリクス ---
{
  const cases = [
    ["1.0.0-rc1", true, false],
    ["1.0.0", true, false],
    ["1.1.0", true, false],
    ["1.0.0-rc1", false, true],
    ["0.7.0", true, true],
    ["1.0.0-dev.3", true, true],
    ["1.0.0-beta.2", true, true],
  ];
  for (const [version, isPackaged, expected] of cases) {
    const actual = shouldShowDevelopmentMenu(version, isPackaged);
    assert.equal(
      actual,
      expected,
      `shouldShowDevelopmentMenu(${JSON.stringify(version)}, ${isPackaged}) => expected ${expected}, got ${actual}`,
    );
  }
  console.log(`  [1/6] shouldShowDevelopmentMenu マトリクス（${cases.length}件）: PASS`);
}

// --- isRcOrLater の個別ケース（§6 の契約表） ---
{
  const cases = [
    ["1.0.0-rc1", true],
    ["1.0.0", true],
    ["1.1.0", true],
    ["0.7.0", false],
    ["1.0.0-dev.3", false],
    ["1.0.0-alpha.1", false],
    ["1.0.0-beta.2", false],
  ];
  for (const [version, expected] of cases) {
    const actual = isRcOrLater(version);
    assert.equal(
      actual,
      expected,
      `isRcOrLater(${JSON.stringify(version)}) => expected ${expected}, got ${actual}`,
    );
  }
  console.log(`  [2/6] isRcOrLater 個別ケース（${cases.length}件）: PASS`);
}

// --- AC4 続き: ソーステキスト assert（main.ts が releaseChannel を使って開発メニューを
// 条件付きにしていること）。§3.1 regions: 541-582 行の template.push ブロックを包む ---
{
  const mainTs = await readSrc("electron/main.ts");
  assert.ok(
    /import\s*\{\s*shouldShowDevelopmentMenu\s*\}\s*from\s*['"]\.\/utils\/releaseChannel['"]/.test(mainTs),
    "electron/main.ts must import shouldShowDevelopmentMenu from ./utils/releaseChannel",
  );
  const devMenuBlock = mainTs.match(/if\s*\(shouldShowDevelopmentMenu\(.*?\)\)\s*\{\s*template\.push\(\{[\s\S]*?\n {2,6}\}\)\s*\n\s*\}/);
  assert.ok(
    devMenuBlock,
    "electron/main.ts must wrap the development menu template.push(...) block in an `if (shouldShowDevelopmentMenu(...))` guard",
  );
  assert.match(
    devMenuBlock[0],
    /menu\.run_originals_migration/,
    "the guarded block must still contain the nested t7 menu item (menu.run_originals_migration) — t4a wraps, does not remove, t7's item",
  );
  console.log("  [3/6] main.ts: 開発メニューが shouldShowDevelopmentMenu で条件付き: PASS");
}

// --- AC6: About ウィンドウの createAboutWindow() 関数本体だけを取り出して判定する。
// レビュー Minor 申し送り: 単純 grep だと main.ts:17 のコメントや :69 のメインウィンドウの
// webPreferences（preload: path.join(...) を持つ）が誤ってヒットする。関数本体へスコープを絞る ---
{
  const mainTs = await readSrc("electron/main.ts");
  const fnMatch = mainTs.match(/function createAboutWindow\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "electron/main.ts must contain a createAboutWindow() function");
  const fnBody = fnMatch[0];

  assert.ok(
    !/nodeIntegration\s*:\s*true/.test(fnBody),
    "createAboutWindow() must not set nodeIntegration: true",
  );
  assert.ok(
    !/contextIsolation\s*:\s*false/.test(fnBody),
    "createAboutWindow() must not set contextIsolation: false",
  );
  const webPreferencesMatch = fnBody.match(/webPreferences\s*:\s*\{[\s\S]*?\}/);
  assert.ok(webPreferencesMatch, "createAboutWindow() must have a webPreferences block");
  assert.ok(
    !/preload\s*:/.test(webPreferencesMatch[0]),
    "createAboutWindow()'s webPreferences must not have a preload key (zero exposure surface — §7.4 案2)",
  );
  assert.ok(
    /webSecurity\s*:\s*false/.test(fnBody),
    "createAboutWindow()'s webSecurity: false must stay in place (§1.2 — deferred alongside the main window)",
  );
  assert.ok(
    /loadFile\([^)]*,\s*\{\s*query\s*:/.test(fnBody),
    "createAboutWindow() must pass appVersion/electron/chrome/node/v8 via loadFile's query option (§6/§7.4)",
  );
  console.log("  [4/6] main.ts createAboutWindow(): nodeIntegration/contextIsolation/preload/query 硬化: PASS");
}

// --- AC10 / AC8 / AC9: about.html のインラインscript・バージョン・著作権表記 ---
{
  const aboutHtml = await readSrc("public/about.html");
  assert.equal(
    (aboutHtml.match(/process\.versions/g) || []).length,
    0,
    "public/about.html must not reference process.versions directly (AC10)",
  );
  assert.equal(
    (aboutHtml.match(/Version 0\.7\.0/g) || []).length,
    0,
    "public/about.html must not hardcode 'Version 0.7.0' (AC8)",
  );
  assert.ok(
    aboutHtml.includes("Copyright 2019-2026 Kohei Otsuka, Code for History / Nayuta, Inc."),
    "public/about.html must contain the ADR-0011 canonical copyright string (AC9)",
  );
  assert.ok(
    /new URLSearchParams\(location\.search\)/.test(aboutHtml),
    "public/about.html must read the received values via new URLSearchParams(location.search) (§6 受信形式)",
  );
  console.log("  [5/6] about.html: process.versions除去 / バージョン最新化 / ADR-0011著作権 / query受信: PASS");
}

console.log("m19-t4a settings/menu/about smoke: PASS (partial — S3/S4/S5 wiring)");
