// M12-T15: 512pxアイコン活用 E2E。
// AC5（サムネイル管理 UI: 置換ボタン・チェックボックス・512px→52px 流用）/
// AC6（地図一覧が 512px を優先表示）/ AC7（アプリ一覧が favicon 未設定時に地図 512px を表示）を検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

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

async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const mapSlug = `t15-map-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 't15 map' },
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
    return { uid: mapR.uid, slug: mapSlug };
  });
}

// saveFolder/tmbs/{uid}_512.jpg を直接配置する（512px サムネイルがある状態を作る）
async function placeThumbnails(saveFolder: string, uid: string): Promise<void> {
  const tmbs = path.join(saveFolder, 'tmbs');
  await mkdir(tmbs, { recursive: true });
  await writeFile(path.join(tmbs, `${uid}_512.jpg`), Buffer.from(PNG_B64, 'base64'));
  await writeFile(path.join(tmbs, `${uid}.jpg`), Buffer.from(PNG_B64, 'base64'));
}

test.describe('M12-T15 512pxアイコン活用', () => {
  test('AC5: MapEdit にサムネイル管理セクション（512px/52px プレビュー・置換ボタン・チェックボックス）が表示される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-ac5-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMap(page);
      await placeThumbnails(await saveFolderOf(page), uid);
      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15000 });

      // AC5: サムネイル管理セクションと各要素
      await expect(page.getByText('サムネイル管理')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('thumbnail-replace-512')).toBeVisible();
      await expect(page.getByTestId('thumbnail-replace-52')).toBeVisible();
      await expect(page.getByTestId('thumbnail-derive-52')).toBeChecked();

      // AC5: 512px プレビューが表示（tmbs/{uid}_512.jpg を配置済み）
      const metadataTab = page.getByTestId('map-title').locator('xpath=ancestor::form');
      await expect(metadataTab.locator('img[src*="_512.jpg"]')).toBeVisible({ timeout: 15000 });

      console.log('  AC5: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC6: 地図一覧 grid card が 512px を優先表示する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-ac6-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMap(page);
      await placeThumbnails(await saveFolderOf(page), uid);
      // 初期ルートで MapList が先に読み込まれるため、別画面へ逃がしてから戻って再読み込みさせる
      await openHash(page, '#/basemaps');
      await openHash(page, '#/maplist');
      await expect(page.locator('[data-resource-list="map"]')).toBeVisible({ timeout: 15000 });

      // AC6: 512px がある地図の grid card は _512.jpg を使う
      const card = page.locator(`[data-resource-uid="${uid}"]`);
      await expect(card).toBeVisible({ timeout: 15000 });
      await expect(card.locator('img')).toHaveAttribute('src', /_512\.jpg/);

      console.log('  AC6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC7: アプリ一覧で favicon 未設定のアプリは地図の 512px を表示する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-ac7-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid, slug } = await seedMap(page);
      await placeThumbnails(await saveFolderOf(page), uid);
      const appSlug = await page.evaluate(async (mapSlug) => {
        const slug = `t15-app-${Date.now()}`;
        const uid = crypto.randomUUID();
        const appR = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, lang: 'ja', title: { ja: 't15 app' }, appName: { ja: 't15 app' },
            description: {}, keywords: '', siteUrl: '',
            sources: [{ sourceType: 'maplat', mapUid: mapSlug, mapSlug }],
            startFrom: mapSlug, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!appR || appR.result !== 'Success') throw new Error(JSON.stringify(appR));
        return slug;
      }, slug);

      // 初期ルートで AppList が先に読み込まれるため、別画面へ逃がしてから戻って再読み込みさせる
      await openHash(page, '#/maplist');
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-list="app"]')).toBeVisible({ timeout: 15000 });

      // AC7: favicon 未設定のアプリは地図の 512px を使う
      const appCard = page.locator(`[data-resource-uid]`).filter({ hasText: 't15 app' });
      await expect(appCard).toBeVisible({ timeout: 15000 });
      await expect(appCard.locator('img')).toHaveAttribute('src', /_512\.jpg/);

      console.log('  AC7: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
