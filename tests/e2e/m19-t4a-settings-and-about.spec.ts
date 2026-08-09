// m19-t4a: 設定画面・アプリケーションメニュー・About ウィンドウの整理。
// 設計書 docs/superpowers/specs/2026-08-09-m19-t4a-settings-and-menu-cleanup-design.md §12
//
// 検証する受け入れ条件:
//   AC1  設定タブが「基本設定」「ベースマップ」の2個で「オリジナル地図設定」が無い
//   AC3  JPEG解像度上限の説明がContextHelpの「？」ポップアップで出る
//   AC5  開発実行（未パッケージ）では開発メニューが従来どおり出る
//   AC7  Aboutのバージョン4値（electron/chrome/node/v8）が表示され赤字エラーにならない
//   AC8  Aboutのバージョン表記がアプリの実バージョンと一致する
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
}

// ElectronApplication.evaluate() は稀に「Resulting promise was garbage collected」で失敗する
// （Playwright 側の既知の不安定挙動。ラウンドトリップの参照が早期に解放される競合で、
// 起動直後の呼び出しで観測されやすい。実測: 3回に1回程度）。テスト対象のロジックとは無関係の
// ハーネス側の揺らぎなので、その1エラーメッセージに限定して1回だけ再試行する。
async function evalMain<T>(app: ElectronApplication, fn: Parameters<ElectronApplication['evaluate']>[0]): Promise<T> {
  try {
    return await app.evaluate(fn as any);
  } catch (error) {
    if (error instanceof Error && error.message.includes('garbage collected')) {
      return await app.evaluate(fn as any);
    }
    throw error;
  }
}

test.describe('m19-t4a 設定画面・アプリケーションメニュー・About ウィンドウの整理', () => {
  test('AC1: 設定タブは「基本設定」「ベースマップ」の2個で、「オリジナル地図設定」が存在しない', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t4a-ac1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      await openHash(page, '#/settings', '#langSwitcher');

      const tabs = page.locator('.nav-tabs .nav-item');
      await expect(tabs).toHaveCount(2);
      expect(await page.locator('.nav-tabs').innerText()).not.toContain('オリジナル地図設定');
      expect(await page.locator('body').innerText()).not.toContain('オリジナル地図設定');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC3: JPEG 解像度上限 (MP) の説明が ContextHelp の「？」ポップアップで出る', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t4a-ac3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      await openHash(page, '#/settings', '#langSwitcher');

      const help = page.locator('[data-testid="settings-jpeg-decode-help"]');
      await expect(help).toBeVisible();
      // S2 で削除した form-text はもう画面上に無い（常時表示ではなくポップアップに変わったこと）
      expect(await page.locator('form').first().innerText()).not.toContain('通常は空欄');

      await help.hover();
      const popover = page.locator('.popover');
      await expect(popover).toBeVisible({ timeout: 5_000 });
      expect(await popover.innerText()).toContain('通常は空欄');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5: 開発実行（未パッケージ）では開発メニューが従来どおり出る', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t4a-ac5-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      // launchIsolated の launch() は projectRoot を args に渡す未パッケージ起動のため isPackaged=false
      const labels = await evalMain<string[]>(app, ({ Menu }) =>
        (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
      );
      expect(labels).toContain('開発');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC7/AC8: About のバージョン4値が表示され赤字エラーにならず、実バージョンと一致する', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t4a-ac7-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);

      const appVersion = await evalMain<string>(app, ({ app: electronApp }) => electronApp.getVersion());

      const aboutWindowPromise = app.waitForEvent('window');
      await evalMain(app, ({ Menu }) => {
        const appMenu = (Menu.getApplicationMenu()?.items ?? [])[0];
        const aboutItem = appMenu?.submenu?.items.find((item) => item.label?.includes('について'));
        if (!aboutItem) throw new Error('About menu item not found');
        aboutItem.click();
      });
      const aboutPage: Page = await aboutWindowPromise;
      await aboutPage.waitForLoadState('domcontentloaded');

      const versionsText = await aboutPage.locator('#versions').innerText();
      expect(versionsText).not.toContain('Error:');
      expect(versionsText).toMatch(/electron/);
      expect(versionsText).toMatch(/chrome/);
      expect(versionsText).toMatch(/node/);
      expect(versionsText).toMatch(/v8/);
      // 各値が空文字・'-'・undefined でないこと（AC7）
      expect(versionsText).not.toMatch(/:\s*-\s*$/m);
      expect(versionsText).not.toContain('undefined');
      const redNodeCount = await aboutPage.locator('[style*="color:red"], [style*="color: red"]').count();
      expect(redNodeCount).toBe(0);

      // AC8: バージョン表記がアプリの実バージョンと一致する（Version 0.7.0 ハードコードが無い）
      const appVersionText = await aboutPage.locator('#appVersion').innerText();
      expect(appVersionText).toBe(`Version ${appVersion}`);

      await aboutPage.close();
    } finally {
      await quitElectronApplication(app);
    }
  });
});
