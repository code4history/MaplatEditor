// 画像アセットの一覧: 保存の後の一覧の読み直しが遅れても、その間に一覧へ戻った利用者を
// 保存した行（編集画面）へ引き戻さない。ベースマップの一覧で直した競合と同じもの。
import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { pickImageToken } from './helpers/pickedImage';
import { takeScreenshot } from './helpers/screenshot';

test('保存の直後に一覧へ戻ると、一覧の読み直しが遅れても編集画面が開き直さない', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-asset-saved-race-'));
  const imagePath = path.join(e2eRoot, 'sample.png');
  const { Jimp } = await import('jimp');
  await new Jimp({ width: 64, height: 48, color: 0x3366ccff }).write(imagePath as `${string}.${string}`);
  const { app, page } = await launch(e2eRoot);
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.reload();
    await page.evaluate(() => { location.hash = '#/assets'; });
    await expect(page.locator('[data-master-detail="image-asset"]')).toBeVisible();

    // 架空のアセットを 1 件用意する
    const token = await pickImageToken(app, page, imagePath);
    const seeded = await page.evaluate(async (pickedToken) => window.imageAssets.add({
      slug: 'saved-race-sample', title: { ja: '試験用アセット' }, lang: 'ja', sourceName: 'sample.png', token: pickedToken,
    }), token);
    expect(seeded.result).toBe('Success');
    await page.reload();
    await page.getByTestId('asset-row-saved-race-sample').click({ timeout: 30_000 });
    const title = page.getByTestId('asset-title');
    await expect(title).toBeVisible();
    await title.fill('試験用アセット（改）');
    await title.press('Tab');

    // 保存の後の一覧の読み直しを遅らせる（遅い CI と同じ順序を確実に作る）
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: unknown[]) => unknown>;
      const original = handlers.get('search:imageAssets');
      if (!original) throw new Error('search:imageAssets の handler がない');
      ipcMain.removeHandler('search:imageAssets');
      ipcMain.handle('search:imageAssets', async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 1500));
        return original(...args);
      });
    });
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i);
    await page.evaluate(() => { location.hash = '/assets'; });
    await expect(title).toHaveCount(0);
    // 遅らせた読み直しが終わった後も、一覧のままである
    await page.waitForTimeout(3000);
    await takeScreenshot(page, testInfo.outputPath('after-leave.png'));
    await expect(title).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('#/assets');
  } finally {
    await quitElectronApplication(app);
  }
});
