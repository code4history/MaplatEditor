// M12-T11: 説明事項・エラー出力 UI 文法統一 E2E。
// AC1（説明が (i) ボタン ContextHelp 化・form-text 説明なし）/ AC3（エラーが DF 表示）/
// AC5（not found が ResourceEmptyState）を検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function seedMapAndOpenEdit(page: Page): Promise<string> {
  const uid = await page.evaluate(async () => {
    const mapSlug = `t11-map-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 't11 map' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'attr' }, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [[[0, 0], [15550000, 4160000]], [[400, 0], [15560000, 4160000]], [[400, 300], [15560000, 4150000]]],
        edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return mapR.uid;
  });
  await openHash(page, `#/mapedit?uid=${uid}`);
  await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15000 });
  return uid;
}

test.describe('M12-T11 説明事項・エラー出力 UI 文法統一', () => {
  test('AC1: 説明が (i) ボタン ContextHelp で表示され、form-text 説明が存在しない', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t11-ac1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await seedMapAndOpenEdit(page);

      // AC1: メタデータタブの説明は (i) ボタン（data-editor-help）で提供される
      const titleLabel = page.getByTestId('map-title').locator('..');
      await expect(titleLabel.locator('[data-editor-help]').first()).toBeVisible();

      // AC1: 表示用タイトル直下の説明 form-text（map_name_repr_desc）は存在しない
      const metadataFormText = page.locator('.form-text.small', { hasText: '地図の表示用名称を15文字' });
      await expect(metadataFormText).toHaveCount(0);

      // AC1: (i) ボタンをクリックすると Popover で説明が表示される
      await titleLabel.locator('[data-editor-help]').first().click();
      await expect(page.locator('.popover')).toContainText('地図の表示用名称を15文字', { timeout: 5000 });
      await page.keyboard.press('Escape');

      // AC1: ベースマップ設定タブの見出しにも (i) ボタン（追加要件: エディタ設定の説明）
      await page.getByTestId('map-tab-settings').click();
      await expect(page.getByTestId('map-base-map-selector')).toBeVisible({ timeout: 15000 });
      const selectedPane = page.getByTestId('map-base-map-selector').locator('.selected-pane');
      await expect(selectedPane.locator('h5 [data-editor-help]')).toBeVisible();
      await selectedPane.locator('h5 [data-editor-help]').click();
      await expect(page.locator('.popover')).toContainText('エディタの表示設定', { timeout: 5000 });

      console.log('  AC1: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC3: エラーが DiagnosticFeedback で表示される（inline text-danger でない）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t11-ac3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // BaseMapEdit で slug 形式エラーを起こし、DF field（editor-diagnostic）で表示されることを検証
      await openHash(page, '#/basemaps');
      await expect(page.getByTestId('basemap-new')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('basemap-new').click();
      await expect(page.getByTestId('basemap-slug')).toBeVisible({ timeout: 15000 });

      // 形式不正の slug を入力してフォーカスアウト
      await page.getByTestId('basemap-slug').fill('invalid slug!!');
      await page.getByTestId('basemap-slug').press('Tab');

      // AC3: エラーは DiagnosticFeedback（editor-diagnostic）で表示（inline text-danger ではない）
      await expect(page.locator('.editor-diagnostic').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.editor-diagnostic[data-diagnostic-scope="field"]').first()).toBeVisible();

      console.log('  AC3: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5: not found が ResourceEmptyState（アイコン+文言+戻るボタン）で表示される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t11-ac5-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 存在しない asset uid の詳細を直接開く
      await openHash(page, '#/assets?uid=00000000-0000-0000-0000-000000000000');
      await page.waitForLoadState('domcontentloaded');

      // AC5: ResourceEmptyState（中央揃えアイコン + not found 文言 + 戻るボタン）
      const emptyState = page.locator('.resource-empty-state');
      await expect(emptyState).toBeVisible({ timeout: 15000 });
      await expect(emptyState.locator('i.bi')).toBeVisible();
      await expect(emptyState).toContainText('選択されたアセットが見つかりません');
      await expect(emptyState.locator('button')).toBeVisible();

      console.log('  AC5: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
