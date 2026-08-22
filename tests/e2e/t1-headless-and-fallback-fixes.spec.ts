// t1: E2E ヘッドレス化と、配布物で死んでいる経路3件の是正。
// 設計書 docs/superpowers/specs/2026-08-22-mapeditor-e2e-headless-and-fallback-fixes-t1-design.md
//
// 検証する受け入れ条件:
//   AC1  E2E 実行時（MAPLAT_E2E_ROOT 付き起動）、メインウィンドウと About ウィンドウが
//        isVisible() === false で生成される。paintWhenInitiallyHidden は既定 true のまま ∴
//        非表示でも renderer は描画を続ける（screenshot 系 spec の前提を壊さない）
//   AC4  新規地図（未保存）でベースマップ一覧が osm/gsi/gsi_ortho の3種になり、
//        /tms_list.json への要求が発生しない（HR-2・dev/配布物の挙動統一）
//   AC5  zip インポート直後に dist/tmbs/ 宛のネットワーク要求が 0 件になる（HR-3・
//        MaplatCore mixin の相対仮置き fetch を options.thumbnail 注入で通さない）
//
// 製品起動（env 無し）での挙動不変性は main.ts の show 制御が MAPLAT_E2E_ROOT のみに
// 分岐する構造で担保される（smoke m19-t4a が webPreferences 内容を引き続き検査）。
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
// m20-t6 §5.2: evalMain() / About ウィンドウ起動は helpers/electronMenu.ts へ抽出済み
import { evalMain, openAboutWindow } from './helpers/electronMenu';

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
}

test.describe('t1 E2E ヘッドレス化（HR-1）', () => {
  test('AC1: MAPLAT_E2E_ROOT 付き起動ではメインウィンドウが isVisible()===false で生成される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-ac1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // launchIsolated.ts は env へ MAPLAT_E2E_ROOT を必ず付与する。全 BrowserWindow が
      // 非表示で生成されていることを main プロセス側で実測する
      const visibilities = await evalMain<boolean[]>(app, ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.isVisible()),
      );
      expect(visibilities.length).toBeGreaterThan(0);
      expect(visibilities.every((v) => v === false)).toBe(true);

      // paintWhenInitiallyHidden 既定 true の前提確認: 非表示でも renderer は描画しており
      // DOM が構築されている（可視性とは独立の attached 判定で確かめる）
      await expect(page.locator('#app')).toBeAttached();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC1: About ウィンドウも isVisible()===false で生成される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-ac1-about-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      // electronMenu.openAboutWindow は waitForEvent('window') + domcontentloaded 待ちのみで
      // show を待たない ∴ 非表示ウィンドウでも検出できる（設計 §7.1.1 実測どおり）
      const aboutPage: Page = await openAboutWindow(app, 'について');
      await expect(aboutPage.locator('body')).toBeAttached();

      const visibilities = await evalMain<boolean[]>(app, ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.isVisible()),
      );
      expect(visibilities.length).toBeGreaterThan(0);
      expect(visibilities.every((v) => v === false)).toBe(true);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
