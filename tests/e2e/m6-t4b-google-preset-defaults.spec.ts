// m6-t4b: Google プリセット選択時の帰属・ライセンス・ズーム自動入力 E2E
// AC5: プリセット選択後に attr/license/zoom が入る
// AC6: 手編集 attr は別プリセット切替後も維持
// AC7: undo 1 ステップで maptype+defaults がまとめて戻る
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { seedE2EProviderKeys } from './helpers/providerKeys';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

test('Google preset defaults: autofill attr/license/zoom, preserve custom attr, undo once', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t4b-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    // m6-t6 (§3.6): basemap-kind-google は BaseMapEdit.vue のエディタ用キー gate 対象
    await seedE2EProviderKeys(page);
    await page.evaluate(() => {
      location.hash = '/basemaps?page=3';
    });
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-editor')).toBeVisible();
    await page.getByTestId('basemap-kind-google').click();
    await expect(page.getByTestId('basemap-google-preset-group')).toBeVisible();

    // AC5: プリセット選択 → 既定値
    await page.getByTestId('basemap-google-preset-roadmap').click();
    await expect(page.getByTestId('basemap-google-preset-roadmap')).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('basemap-attr')).toHaveValue('© Google');
    await expect(page.getByTestId('basemap-license')).toHaveValue('All right reserved');
    await expect(page.getByTestId('basemap-data-license')).toHaveValue('All right reserved');
    await expect(page.getByTestId('basemap-min-zoom')).toHaveValue('0');
    await expect(page.getByTestId('basemap-max-zoom')).toHaveValue('22');

    // AC7: undo 1 回で maptype 選択前（defaults も戻る）
    await page.getByTestId('editor-undo').click();
    // maptype 未選択に戻ると primary が外れる
    await expect(page.getByTestId('basemap-google-preset-roadmap')).not.toHaveClass(/btn-primary/);
    // attr も空へ（defaults と maptype が同一 undo）
    await expect(page.getByTestId('basemap-attr')).toHaveValue('');

    // 再選択
    await page.getByTestId('basemap-google-preset-roadmap').click();
    await expect(page.getByTestId('basemap-attr')).toHaveValue('© Google');

    // AC6: 手編集 attr → 別プリセットでも維持
    await fillAndCommit(page.getByTestId('basemap-attr'), 'My Custom Google Attr');
    await page.getByTestId('basemap-google-preset-satellite').click();
    await expect(page.getByTestId('basemap-google-preset-satellite')).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('basemap-attr')).toHaveValue('My Custom Google Attr');
    // zoom は既に 0/22 が入っているので維持
    await expect(page.getByTestId('basemap-min-zoom')).toHaveValue('0');
    await expect(page.getByTestId('basemap-max-zoom')).toHaveValue('22');

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
