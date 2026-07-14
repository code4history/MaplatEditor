import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, imagePath);
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

test('Base Map and Image Asset master-detail editors preserve checkpoint, draft, language, and isolation', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t4-'));
  const imagePath = path.join(e2eRoot, 'e2e-input.png');
  await copyFile(path.join(projectRoot, 'src/assets/img/no_image.png'), imagePath);
  const { app, page } = await launch(e2eRoot);

  try {
    await installDialogHarness(app, imagePath);

    await openHash(page, '#/basemaps?page=3', '[data-master-detail="base-map"]');
    await expect(page.getByTestId('basemap-new')).toHaveClass(/btn-outline-primary/);
    await expect(page.getByTestId('basemap-new')).toHaveText(/新規追加|New/);
    await page.getByTestId('basemap-search').fill('GSI Ortho');
    await expect(page.getByTestId('basemap-row-gsi_ortho')).toBeVisible();
    await expect(page.getByTestId('basemap-row-osm')).toHaveCount(0);
    await expect(page).toHaveURL(/q=GSI(?:\+|%20)Ortho/);
    await page.reload();
    await expect(page.getByTestId('basemap-search')).toHaveValue('GSI Ortho');
    await expect(page.getByTestId('basemap-row-gsi_ortho')).toBeVisible();
    await page.getByTestId('basemap-search').fill('e2e');
    await page.getByTestId('basemap-new').click();
    await expect(page).toHaveURL(/uid=.*new=1/);
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-user-basemap');
    await fillAndCommit(page.getByTestId('basemap-title'), 'テストベースマップ');
    await fillAndCommit(page.getByTestId('basemap-url'), 'https://example.test/{z}/{x}/{y}.png');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/);
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i);
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await expect(page.getByTestId('editor-undo')).toBeEnabled();
    await expect(page).toHaveURL(/q=e2e/);
    await expect(page).toHaveURL(/page=3/);

    await fillAndCommit(page.getByTestId('basemap-title'), '下書きタイトル');
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('basemap-draft-badge')).toBeVisible();
    await page.getByTestId('basemap-row-e2e-user-basemap').click();
    await page.reload();
    await expect(page.getByTestId('basemap-title')).toHaveValue('下書きタイトル');
    await expect(page.getByTestId('editor-discard-draft')).toBeVisible();
    await page.getByTestId('editor-discard-draft').click();
    await expect(page.getByTestId('basemap-title')).toHaveValue('テストベースマップ');

    await fillAndCommit(page.getByTestId('basemap-title'), '一時変更');
    await page.getByTestId('editor-undo').click();
    await expect(page.getByTestId('basemap-title')).toHaveValue('テストベースマップ');
    await expect(page.getByTestId('editor-redo')).toBeEnabled();
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('basemap-draft-badge')).toHaveCount(0);

    await page.getByTestId('basemap-search').fill('');
    await page.getByTestId('basemap-range-filter').click();
    await expect(page.locator('.envelope-modal')).toBeVisible();
    await page.locator('.envelope-modal').getByRole('button', { name: /キャンセル|Cancel/i }).click();
    await page.evaluate(() => { location.hash = '/basemaps?bbox=134.5,34.5,135,35'; });
    await expect(page).toHaveURL(/bbox=134\.5(?:%2C|,)34\.5(?:%2C|,)135(?:%2C|,)35/);
    await expect(page.getByTestId('basemap-row-osm')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('basemap-row-osm')).toBeVisible();
    await expect(page.getByTestId('basemap-range-clear')).toBeVisible();
    await page.getByTestId('basemap-range-clear').click();
    await expect(page).not.toHaveURL(/bbox=/);

    await page.getByTestId('basemap-row-osm').click();
    await expect(page.getByTestId('basemap-editor-readonly')).toBeVisible();
    await expect(page.getByTestId('basemap-title').locator('xpath=..').locator('.lang-value-chip')).toHaveCount(10);
    await page.getByTestId('basemap-row-e2e-user-basemap').click();
    await page.getByTestId('editor-language').selectOption('en');
    await expect(page.getByTestId('basemap-url')).toBeDisabled();
    await expect(page.getByTestId('basemap-title')).toBeEnabled();
    const directBaseMapUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(directBaseMapUrl);
    await expect(page.getByTestId('basemap-slug')).toHaveValue('e2e-user-basemap');

    await openHash(page, '#/assets?q=&page=2', '[data-master-detail="image-asset"]');
    await expect(page.getByTestId('asset-new')).toHaveClass(/btn-outline-primary/);
    await expect(page.getByTestId('asset-new')).toHaveText(/新規追加|New/);
    await page.getByTestId('asset-new').click();
    await page.getByTestId('asset-pick-file').click();
    await fillAndCommit(page.getByTestId('asset-slug'), 'e2e-image-asset');
    await fillAndCommit(page.getByTestId('asset-title'), 'テスト画像');
    await page.evaluate(() => {
      const original = window.imageAssets.add.bind(window.imageAssets);
      window.imageAssets.add = async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        return original(input);
      };
    });
    await page.getByTestId('editor-save').click();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeVisible();
    await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden();
    await expect(page).not.toHaveURL(/new=1/);
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i);
    await expect(page.getByTestId('editor-undo')).toBeEnabled();
    await expect(page).toHaveURL(/page=2/);

    await fillAndCommit(page.getByTestId('asset-title'), '下書き画像');
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('asset-draft-badge')).toBeVisible();
    await page.getByTestId('asset-row-e2e-image-asset').click();
    await page.reload();
    await expect(page.getByTestId('asset-title')).toHaveValue('下書き画像');
    await page.getByTestId('editor-discard-draft').click();
    await expect(page.getByTestId('asset-title')).toHaveValue('テスト画像');

    await page.getByTestId('editor-back').click();
    await page.getByTestId('asset-new').click();
    await page.getByTestId('asset-pick-file').click();
    await fillAndCommit(page.getByTestId('asset-title'), '再選択テスト');
    await page.reload();
    await expect(page.getByTestId('asset-source-repick-warning')).toBeVisible();
    await expect(page.getByTestId('editor-save')).toBeDisabled();
    await page.getByTestId('asset-pick-file').click();
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/);
  } finally {
    await app.close();
  }
});
