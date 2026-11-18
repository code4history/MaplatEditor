// 設定画面・アプリケーションメニュー・About ウィンドウの整理。
//
//
// 相当: releaseChannel の純関数を版数 × isPackaged のマトリクスで検証する
// （）。electron を import しないモジュールなので node で直接 import できる。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");

import { shouldShowDevelopmentMenu, isRcOrLater } from "../electron/utils/releaseChannel.ts";

// --- shouldShowDevelopmentMenu の版数 × isPackaged マトリクス ---
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

// --- isRcOrLater の個別ケース（契約表） ---
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

// --- 続き: ソーステキスト assert（main.ts が releaseChannel を使って開発メニューを
// 条件付きにしていること）。regions: 541-582 行の template.push ブロックを包む ---
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

// --- About ウィンドウの createAboutWindow() 関数本体だけを取り出して判定する。
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
    "createAboutWindow()'s webPreferences must not have a preload key (zero exposure surface — 案2)",
  );
  // 判定対象からコメント行を除去してから test する。
  // #105 / webSecurity:false 据え置き assert を撤廃し、実設定として
  // webSecurity: false が存在しないこと（webSecurity は既定 true へ戻ったこと）を assert する。
  // （renderer は file:// 直読みから app:// カスタムスキームへ移行した）
  const fnBodyNoComments = fnBody.replace(/^[ \t]*\/\/.*$/gm, "");
  assert.ok(
    !/webSecurity\s*:\s*false/.test(fnBodyNoComments),
    "createAboutWindow() must not set webSecurity: false (是正後、webSecurity は既定 true)",
  );
  // 自己検査: コメント除去が効いていること（除外ヘルパー自体の劣化を smoke が自分で検出する）。
  assert.ok(
    !/^[ \t]*\/\/[^\n]*webSecurity/m.test(fnBodyNoComments),
    "comment stripping must remove comment lines mentioning webSecurity (self-check of the stripper since t1)",
  );
  // #105: About ウィンドウは app:// カスタムスキーム経由で配信し、バージョン値を query で渡す
  // （旧 loadFile(...query:{...}) から loadURL('app://bundle/about.html?…') へ移行）
  assert.ok(
    /loadURL\(["'`]app:\/\/bundle\/about\.html\?/.test(fnBody),
    "createAboutWindow() must load via app://bundle/about.html with a query (app:// 移行)",
  );
  console.log("  [4/6] main.ts createAboutWindow(): nodeIntegration/contextIsolation/preload/webSecurity/app:// 硬化: PASS");
}

// --- about.html のインラインscript・バージョン・著作権表記 ---
{
  const aboutHtml = await readSrc("public/about.html");
  assert.equal(
    (aboutHtml.match(/process\.versions/g) || []).length,
    0,
    "public/about.html must not reference process.versions directly ",
  );
  assert.equal(
    (aboutHtml.match(/Version 0\.7\.0/g) || []).length,
    0,
    "public/about.html must not hardcode 'Version 0.7.0' ",
  );
  assert.ok(
    aboutHtml.includes("Copyright 2019-2026 Kohei Otsuka, Code for History / Nayuta, Inc."),
    "public/about.html must contain the the rule that the patent-related packages use Apache 2.0 with the joint copyright notice canonical copyright string ",
  );
  // about のインライン script は CSP のため public/about.js へ外出しした。受信形式の断言は about.js を読む
  const aboutJs = await readSrc("public/about.js");
  assert.ok(
    /new URLSearchParams\(location\.search\)/.test(aboutJs),
    "public/about.js must read the received values via new URLSearchParams(location.search) (受信形式)",
  );
  console.log("  [5/6] about.html: process.versions除去 / バージョン最新化 / 特許に関わる本体系は Apache 2.0 とし、著作権表示を併記する決まりの著作権 / query受信: PASS");
}

// --- Settings.vue と 11 言語 translation.json ---
{
  const settingsVue = await readSrc("src/views/Settings.vue");

  // 「オリジナル地図設定」タブ（settings.original_map）が Settings.vue から消えている
  assert.equal(
    (settingsVue.match(/settings\.original_map/g) || []).length,
    0,
    "src/views/Settings.vue must not reference settings.original_map (expected 0)",
  );
  // タブは3→2枚になる。第3タブの id="original" tab-pane も消える
  assert.equal(
    (settingsVue.match(/id="original"/g) || []).length,
    0,
    "src/views/Settings.vue must not contain the id=\"original\" tab-pane",
  );

  // ContextHelp タグ数が 2 → 3、form-text の jpeg_decode_desc が 0 件
  // 設定画面の「起動時に更新を確認する」の説明に ContextHelp を 1 つ足した ∴ 3 → 4
  // UI 文法（docs/ui-grammar.md §7.1 #14）: MCP の「127.0.0.1 で登録する」注意を ContextHelp へ ∴ 5
  const contextHelpCount = (settingsVue.match(/<ContextHelp/g) || []).length;
  assert.equal(contextHelpCount, 5, `src/views/Settings.vue must have 5 <ContextHelp> tags (UI grammar: got ${contextHelpCount})`);
  assert.ok(
    !/<div class="form-text">\{\{\s*t\("settings\.jpeg_decode_desc"\)\s*\}\}<\/div>/.test(settingsVue),
    "src/views/Settings.vue must not render jpeg_decode_desc as a plain form-text div anymore",
  );
  assert.ok(
    /data-testid="settings-jpeg-decode-help"/.test(settingsVue),
    "src/views/Settings.vue must add the settings-jpeg-decode-help ContextHelp",
  );
  console.log("  [6/6a] Settings.vue: オリジナル地図設定タブ削除 / ContextHelp化: PASS");
}

// settings.original_map が 11 言語すべてから消えている
{
  const { readdir } = await import("node:fs/promises");
  const localesDir = path.join(projectRoot, "public/locales");
  const langs = (await readdir(localesDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.equal(langs.length, 11, `expected 11 locale directories, found ${langs.length}: ${langs.join(",")}`);
  let stillHasKey = 0;
  for (const lang of langs) {
    const raw = await readSrc(`public/locales/${lang}/translation.json`);
    if (/"original_map"\s*:/.test(raw)) stillHasKey++;
  }
  assert.equal(stillHasKey, 0, `settings.original_map must be removed from all 11 locale files (still present in ${stillHasKey})`);
  console.log("  [6/6b] 11言語 translation.json から settings.original_map 削除: PASS");
}

console.log("settings/menu/about smoke: PASS (full)");
