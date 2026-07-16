// M11-T10: 複製・削除action・Import統合 E2E Test
// AC1/AC2/AC3/AC5/AC6/AC7/AC8/AC9/AC10/AC11/AC12 を実効検証する。
// AC4(copyFromUidのタイル複製)・AC13/AC14(失敗経路)はコード検査+人間検証(設計v3.2)。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

async function seedApp(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `t10-app-${Date.now()}`;
    const uid = crypto.randomUUID();
    const r = await window.appedit.save({
      uid, slug, create: true,
      document: { appID: slug, appName: { ja: 'T10 App' }, title: { ja: 'T10 App' }, description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [], pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {} },
    });
    if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
    return { uid, slug };
  });
}

async function seedPoi(page: Page, withFeature = false): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async (wf) => {
    const slug = `t10-poi-${Date.now()}`;
    const r = await window.poiSources.createLocal({ slug, title: { ja: 'T10 POI' }, lang: 'ja' });
    if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
    const features = wf
      ? [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: { name: { ja: 'T10F' } } }]
      : [];
    await window.poiSources.save(r.uid, { slug, title: { ja: 'T10 POI' }, fc: { type: 'FeatureCollection', features } });
    return { uid: r.uid, slug };
  }, withFeature);
}

async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `t10-map-${Date.now()}`;
    const result = await window.mapedit.save({ slug, mapObject: {
      mapID: slug, title: { ja: 'T10 地図' }, officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'T10 attribution' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
    }, tins: [] });
    if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return { uid: result.uid as string, slug };
  });
}

// カードの ⋮ メニューから action を実行する
async function clickCardAction(page: Page, uid: string, label: string): Promise<void> {
  const card = page.locator(`[data-resource-uid="${uid}"]`);
  await card.locator('[data-resource-action-trigger]').click();
  await page.locator(`[role="menuitem"]:has-text("${label}")`).click();
}

test.describe('M11-T10 Dedup/Import', () => {
  test('AC1+AC2+AC3+AC12: App複製 — メニュー表示・予約slug採用・内容コピー・未保存・-copy2採番', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-dup-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const seeded = await seedApp(page);
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });

      // AC1: ⋮ メニューに「複製」
      const card = page.locator(`[data-resource-uid="${seeded.uid}"]`);
      await card.locator('[data-resource-action-trigger]').click();
      await expect(page.locator('[role="menuitem"]:has-text("複製")')).toBeVisible({ timeout: 3000 });

      // AC2+AC12: 複製 → エディタが予約slug(-copy)と複製内容で開き、DB行は増えない
      await page.locator('[role="menuitem"]:has-text("複製")').click();
      await expect(page.getByTestId('app-id')).toHaveValue(`${seeded.slug}-copy`, { timeout: 10000 });
      await expect(page.getByTestId('app-title')).toHaveValue('T10 App');
      const countAfterDup = await page.evaluate(async () => (await (window as any).search.apps({ page: 1, pageSize: 50 })).total);
      expect(countAfterDup).toBe(1); // 元の1件のみ(複製は未保存)

      // 複製オープンは dirty (人間検証指摘): 無変更でも保存でき、保存後に一覧へ現れる
      const saveButton = page.getByTestId('editor-save');
      await expect(saveButton).toBeEnabled({ timeout: 10000 });
      await saveButton.click();
      await expect.poll(async () =>
        (await page.evaluate(async () => (await (window as any).search.apps({ page: 1, pageSize: 50 })).total)),
      { timeout: 15000 }).toBe(2);

      // AC3: 同じ元からもう一度複製 → -copy は保存済み(registry taken)なので -copy2 が採番される
      // (check 前置がないと registry を見ずに -copy を再予約してしまう回帰の検出を兼ねる)
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await clickCardAction(page, seeded.uid, '複製');
      await expect(page.getByTestId('app-id')).toHaveValue(`${seeded.slug}-copy2`, { timeout: 10000 });

      console.log('  AC1+AC2+AC3+AC12: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC7+AC8: PoiSourceList モーダル不存在・Importボタン表示', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-poi-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.modal-title:has-text("POI")')).toHaveCount(0);
      await expect(page.locator('[data-resource-import]')).toBeVisible({ timeout: 5000 });
      console.log('  AC7+AC8: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5+AC6: 共通確認dialogで削除され、listとdraftが更新される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-del-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const poi = await seedPoi(page);
      await openHash(page, '#/poisources');
      await expect(page.locator(`[data-resource-uid="${poi.uid}"]`)).toBeVisible({ timeout: 15000 });

      await clickCardAction(page, poi.uid, '削除');

      // AC5: 共通確認 dialog
      const dialog = page.locator('.modal.show, .modal.d-block');
      await expect(dialog).toBeVisible({ timeout: 3000 });
      await expect(dialog.getByText('この操作は取り消せません。')).toBeVisible();
      await expect(dialog.getByText(poi.slug.length ? 'T10 POI' : '')).toBeVisible();

      // AC6: 承認 → 行が消える
      await page.getByTestId('delete-confirm-button').click();
      await expect(page.locator(`[data-resource-uid="${poi.uid}"]`)).toHaveCount(0, { timeout: 10000 });
      const total = await page.evaluate(async () => (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).total);
      expect(total).toBe(0);

      console.log('  AC5+AC6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC9+AC10: POI 新規追加が即エディタ遷移、Importがfile picker経由でエディタ遷移', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-imp-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });

      // AC9: 新規追加 → POIエディタへ遷移(モーダルなし)
      await page.locator('[data-resource-new]').click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      const hashAfterCreate = await page.evaluate(() => location.hash);
      expect(hashAfterCreate).toMatch(/#\/poisources\/[0-9a-f-]{36}\?new=1/);

      // AC10: Import — file picker(stub) → import → エディタ遷移、featureが読み込まれる
      const geojsonPath = path.join(e2eRoot, 't10-import.geojson');
      await writeFile(geojsonPath, JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: { name: 'Imported POI' } }],
      }));
      await app.evaluate(async ({ dialog }, filePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      }, geojsonPath);

      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-import]')).toBeVisible({ timeout: 15000 });
      await page.locator('[data-resource-import]').click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 10000 });

      console.log('  AC9+AC10: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('Map複製: dirtyで開き無変更保存が成功し一覧に複製行が現れる(予約自己衝突の回帰検出)', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-mapdup-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // MapEdit の保存は確認ダイアログ(main process)を経由するため stub で承認する
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      const seeded = await seedMap(page);
      // 初期ルートが #/maplist のため、同一hashでは再マウントされない。別ルート経由で再入する
      await openHash(page, '#/applist');
      await openHash(page, '#/maplist');
      await expect(page.locator(`[data-resource-uid="${seeded.uid}"]`)).toBeVisible({ timeout: 15000 });

      // 複製 → MapEdit が予約slug(-copy)で dirty オープン
      await clickCardAction(page, seeded.uid, '複製');
      await expect(page.getByTestId('map-slug')).toHaveValue(`${seeded.slug}-copy`, { timeout: 15000 });
      const saveButton = page.getByTestId('editor-save');
      await expect(saveButton).toBeEnabled({ timeout: 15000 });

      // 無変更のまま保存 → 予約(asset_uid=draftUid)と create uid が一致し Exist にならない
      await saveButton.click();
      await expect.poll(async () => page.evaluate(async () => {
        const r = await window.maplist.request('', 1);
        return r.docs.map((d: any) => d.mapID).sort().join(',');
      }), { timeout: 20000 }).toBe(`${seeded.slug},${seeded.slug}-copy`);

      // slug 重複エラーが出ていない
      await expect(page.locator('[data-diagnostic-scope="operation"]')).toHaveCount(0);
      console.log('  Map複製保存: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('master-detail複製後の新規追加が複製クエリを引きずらない (人間検証R2指摘)', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-mdnew-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // user 基図を UI で1件作成
      await openHash(page, '#/basemaps');
      await expect(page.getByTestId('basemap-new')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('basemap-new').click();
      await page.getByTestId('basemap-slug').fill('t10-md-base');
      await page.getByTestId('basemap-slug').press('Tab');
      await page.getByTestId('basemap-title').fill('T10 MD Base');
      await page.getByTestId('basemap-title').press('Tab');
      await page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
      await page.getByTestId('basemap-url').press('Tab');
      await page.getByTestId('editor-save').click();
      await expect(page).not.toHaveURL(/new=1/);

      // 複製 → -copy の複製エディタが開く（duplicateFrom/slug ワンショットクエリ付き）
      const row = page.getByTestId('basemap-row-t10-md-base');
      await row.locator('[data-resource-action-trigger]').click();
      await page.locator('[role="menuitem"]:has-text("複製")').click();
      await expect(page.getByTestId('basemap-slug')).toHaveValue('t10-md-base-copy', { timeout: 10000 });

      // 新規追加 → 複製内容・presetSlug を引きずらず空で開く
      await page.getByTestId('basemap-new').click();
      await expect(page.getByTestId('basemap-slug')).toHaveValue('', { timeout: 10000 });
      await expect(page.getByTestId('basemap-title')).toHaveValue('');
      const hash = await page.evaluate(() => location.hash);
      expect(hash).not.toContain('duplicateFrom');

      console.log('  master-detail新規クリーン: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC11+POI複製: MapListにImportボタン、POI複製は行作成方式で内容ごと複製される', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-misc-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // AC11: MapList toolbar にインポートボタン
      await openHash(page, '#/maplist');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-resource-import]')).toBeVisible({ timeout: 5000 });

      // POI複製(行作成方式): feature付きソースを複製 → 新uidのエディタ、slug=-copy、feature 1件
      const poi = await seedPoi(page, true);
      await openHash(page, '#/poisources');
      await expect(page.locator(`[data-resource-uid="${poi.uid}"]`)).toBeVisible({ timeout: 15000 });
      await clickCardAction(page, poi.uid, '複製');

      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('poi-slug')).toHaveValue(`${poi.slug}-copy`, { timeout: 10000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 10000 });
      const hash = await page.evaluate(() => location.hash);
      expect(hash).not.toContain(poi.uid); // 新uidの行で開いている

      console.log('  AC11+POI複製: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
