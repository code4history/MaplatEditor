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

console.log("m19-t4a settings/menu/about smoke: PASS (partial — releaseChannel only)");
