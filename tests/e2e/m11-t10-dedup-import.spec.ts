// M11-T10: 複製・削除action・Import統合 E2E Test
// AC1/AC2/AC3/AC5/AC6/AC7/AC8/AC9/AC10/AC11/AC12 を実効検証する。
// AC4(copyFromUidのタイル複製)・AC13/AC14(失敗経路)はコード検査+人間検証(設計v3.2)。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
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
    // gcps を持つが compiled は持たない(素体) map。複製保存が TIN 計算を待って
    // compiled を生成できることの検証素材になる
    const result = await window.mapedit.save({ slug, mapObject: {
      mapID: slug, title: { ja: 'T10 地図' }, officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'T10 attribution' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [
        [[100, 100], [15550000, 4160000]],
        [[300, 100], [15560000, 4160000]],
        [[200, 250], [15555000, 4150000]],
      ],
      edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
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
      await expect(page.getByTestId('editor-save-state')).toHaveText(/未保存|下書きから復元/, { timeout: 10_000 });
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

  test('AC1+AC2: POI新規追加は未作成モードで開き、保存するまで行が作られず、保存で作成される', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-new-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 保存成功ダイアログを自動承認
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });

      // AC1: 新規追加 → 未作成モード（/poisources/new）。行も下書きもまだ作られない
      await page.locator('[data-resource-new]').click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      const hashAfterCreate = await page.evaluate(() => location.hash);
      expect(hashAfterCreate).toMatch(/#\/poisources\/new/);
      await expect.poll(async () =>
        page.evaluate(async () => (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).total),
      { timeout: 10000 }).toBe(0);

      // AC2: slug 入力（blur で commit）→ 保存ボタンが enabled（draftDirty）→ 保存で行作成 + ルート正準化
      await page.getByTestId('poi-slug').fill('t10b-new-poi');
      await page.getByTestId('poi-slug').press('Tab');
      const saveButton = page.getByTestId('editor-save');
      await expect(saveButton).toBeEnabled({ timeout: 10000 });
      await saveButton.click();
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 })
        .toMatch(/#\/poisources\/[0-9a-f-]{36}$/);
      await expect.poll(async () =>
        page.evaluate(async () => (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).total),
      { timeout: 15000 }).toBe(1);
      // slug 重複（Exist）の operation 診断が出ていない（予約 promote 成立）
      await expect(page.locator('[data-diagnostic-scope="operation"]')).toHaveCount(0);

      console.log('  AC1+AC2: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC6: POI Importは未作成モード経由でfile picker→内容作成。キャンセルでは何も作られない', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-imp-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // まずキャンセル経路: picker がキャンセルを返すと未作成モードのまま何も作られない
      await app.evaluate(async ({ dialog }) => {
        dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
      });
      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-import]')).toBeVisible({ timeout: 15000 });
      await page.locator('[data-resource-import]').click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      expect(await page.evaluate(() => location.hash)).toMatch(/#\/poisources\/new\?import=1/);
      await expect.poll(async () =>
        page.evaluate(async () => (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).total),
      { timeout: 10000 }).toBe(0);

      // 成功経路: file picker(stub) → importFile(preset uid) → エディタに feature が読み込まれ正準化される
      const geojsonPath = path.join(e2eRoot, 't10b-import.geojson');
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
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 15000 });
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 })
        .toMatch(/#\/poisources\/[0-9a-f-]{36}$/);

      console.log('  AC6: PASS');
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
      // Search Layer 初期化/マイグレーションで遅延することがあるため、一覧遷移前に
      // backend 側に slug が反映されるまで待つ。これで maplist 初回ロード時に行が描画される。
      await expect.poll(async () =>
        (await page.evaluate(async () => (await window.maplist.request('', 1)).docs.map((d: any) => d.mapID))),
      { timeout: 30000 }).toContain(seeded.slug);
      // 初期ルートが #/maplist のため、同一hashでは再マウントされない。別ルート経由で再入する
      await openHash(page, '#/applist');
      await openHash(page, '#/maplist');
      await expect(page.locator(`[data-resource-uid="${seeded.uid}"]`)).toBeVisible({ timeout: 15000 });

      // 複製 → MapEdit が予約slug(-copy)で dirty オープン
      await clickCardAction(page, seeded.uid, '複製');
      await expect(page.getByTestId('map-slug')).toHaveValue(`${seeded.slug}-copy`, { timeout: 15000 });
      const saveButton = page.getByTestId('editor-save');
      await expect(saveButton).toBeEnabled({ timeout: 15000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/未保存|下書きから復元/, { timeout: 10_000 });

      // 無変更のまま保存 → 予約(asset_uid=draftUid)と create uid が一致し Exist にならない
      await saveButton.click();
      await expect.poll(async () => page.evaluate(async () => {
        const r = await window.maplist.request('', 1);
        return r.docs.map((d: any) => d.mapID).sort().join(',');
      }), { timeout: 20000 }).toBe(`${seeded.slug},${seeded.slug}-copy`);

      // slug 重複エラーが出ていない
      await expect(page.locator('[data-diagnostic-scope="operation"]')).toHaveCount(0);

      // R6: compiled を持つ地図(いま保存した複製)を複製→即保存。request が添付する
      // compiled tins の種付けにより、再計算なしで compiled が引き継がれる
      // 一覧遷移前に backend 反映を確認し、maplist 初回ロードで行が描画されるようにする
      await expect.poll(async () =>
        (await page.evaluate(async () => (await window.maplist.request('', 1)).docs.map((d: any) => d.mapID))),
      { timeout: 30000 }).toContain(`${seeded.slug}-copy`);
      await openHash(page, '#/applist');
      await openHash(page, '#/maplist');
      const copyUid = await page.evaluate(async (slug) =>
        (await window.maplist.request('', 1)).docs.find((d: any) => d.mapID === slug)?.uid, `${seeded.slug}-copy`);
      expect(copyUid).toBeTruthy();
      await expect(page.locator(`[data-resource-uid="${copyUid}"]`)).toBeVisible({ timeout: 15000 });
      await clickCardAction(page, copyUid!, '複製');
      await expect(page.getByTestId('map-slug')).toHaveValue(`${seeded.slug}-copy-copy`, { timeout: 15000 });
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/未保存|下書きから復元/, { timeout: 10_000 });
      await page.getByTestId('editor-save').click();
      await expect.poll(async () => page.evaluate(async () =>
        (await window.maplist.request('', 1)).docs.length), { timeout: 20000 }).toBe(3);

      // R5/R6: 保存された複製が compiled を持つことを sqlite 直接検査で確認
      // (待たない/種付けしないと gcps 素体へ劣化し store2HistMap が compiledRequired 警告を出す)
      const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      await quitElectronApplication(app);
      const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
      try {
        for (const slug of [`${seeded.slug}-copy`, `${seeded.slug}-copy-copy`]) {
          const row = db.prepare('SELECT data_json FROM maps WHERE slug = ?').get(slug) as { data_json: string } | undefined;
          expect(row).toBeTruthy();
          expect(String(row!.data_json)).toContain('"compiled"');
        }
      } finally {
        db.close();
      }
      console.log('  Map複製保存: PASS');
    } finally {
      await quitElectronApplication(app).catch(() => { /* 既に終了済み */ });
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
      await page.getByTestId('basemap-kind-tms').click(); // m6-t1: 新規ベースマップは種別選択が最初の編集
      await page.getByTestId('basemap-slug').fill('t10-md-base');
      await page.getByTestId('basemap-slug').press('Tab');
      await page.getByTestId('basemap-title').fill('T10 MD Base');
      await page.getByTestId('basemap-title').press('Tab');
      await page.getByTestId('basemap-url').fill('https://example.test/{z}/{x}/{y}.png');
      await page.getByTestId('basemap-url').press('Tab');
      // 非同期 validation/dirty state が確定するまで待ってから保存（並列負荷時に click が無視されるのを防ぐ）
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10_000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/未保存|下書きから復元/, { timeout: 10_000 });
      await page.getByTestId('editor-save').click();
      await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });

      // 複製 → -copy の複製エディタが開く（duplicateFrom/slug ワンショットクエリ付き）
      const row = page.getByTestId('basemap-row-t10-md-base');
      await row.locator('[data-resource-action-trigger]').click();
      await page.locator('[role="menuitem"]:has-text("複製")').click();
      await expect(page.getByTestId('basemap-slug')).toHaveValue('t10-md-base-copy', { timeout: 10000 });

      // 新規追加 → 複製内容・presetSlug を引きずらず空で開く
      await page.getByTestId('basemap-new').click();
      await page.getByTestId('basemap-kind-tms').click(); // m6-t1: 新規ベースマップは種別選択が最初の編集
      await expect(page.getByTestId('basemap-slug')).toHaveValue('', { timeout: 10000 });
      await expect(page.getByTestId('basemap-title')).toHaveValue('');
      const hash = await page.evaluate(() => location.hash);
      expect(hash).not.toContain('duplicateFrom');

      console.log('  master-detail新規クリーン: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('新規追加は既存の新規下書きを引き継ぐ / アプリ名必須で保存が塞がる (人間検証R4)', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10-draft-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 新規 App エディタで slug のみ入力 → dirty + slug予約成功で初期draftが永続される
      await openHash(page, '#/appedit');
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('app-id').fill('t10-draft-app');
      // R4: アプリ名が空の間は保存不可(タイトル必須)
      await expect(page.getByTestId('editor-save')).toBeDisabled();
      const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      expect(draftUid).not.toBeNull();
      // 初期draft永続(useInitialDraftPersist)を待つ
      await expect.poll(async () => page.evaluate(async (uid) =>
        (await window.assetDrafts.get('app', uid!)) != null, draftUid), { timeout: 15000 }).toBe(true);

      // 一覧へ戻り「新規追加」→ 既存の新規下書きを引き継いで開く(master-detailと同文法)
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await page.locator('[data-resource-new]').click();
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10000 }).toContain(`draftUid=${draftUid}`);
      await expect(page.getByTestId('app-id')).toHaveValue('t10-draft-app', { timeout: 10000 });

      console.log('  新規追加draft引継ぎ+アプリ名必須: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC3+AC11: POI複製は未作成モードでdirtyに開き保存で作成、MapListにImportボタン', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-dup-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // AC11: MapList toolbar にインポートボタン
      await openHash(page, '#/maplist');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-resource-import]')).toBeVisible({ timeout: 5000 });

      // AC3: POI複製 → 未作成モード（/poisources/new?duplicateFrom=...）で dirty に開き、保存まで行は増えない
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      const poi = await seedPoi(page, true);
      await openHash(page, '#/poisources');
      await expect(page.locator(`[data-resource-uid="${poi.uid}"]`)).toBeVisible({ timeout: 15000 });
      await clickCardAction(page, poi.uid, '複製');

      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      const hash = await page.evaluate(() => location.hash);
      expect(hash).toContain('#/poisources/new');
      expect(hash).toContain('duplicateFrom=');
      await expect(page.getByTestId('poi-slug')).toHaveValue(`${poi.slug}-copy`, { timeout: 10000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 10000 });
      // dirty オープン（無変更でも保存可能）
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/未保存|下書きから復元/, { timeout: 10_000 });
      // 保存前に行は増えない
      await expect.poll(async () =>
        page.evaluate(async () => (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).total),
      { timeout: 10000 }).toBe(1);

      // 保存 → 内容ごと作成（予約=self のため Exist にならない）
      await page.getByTestId('editor-save').click();
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 })
        .toMatch(/#\/poisources\/[0-9a-f-]{36}$/);
      await expect.poll(async () =>
        page.evaluate(async () => (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).total),
      { timeout: 15000 }).toBe(2);
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 10000 });

      console.log('  AC3+AC11: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4+AC5: 複製を放棄すると下書きカードが現れ、復元・削除で予約ごと解放される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-draft-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      // removeNewDraft の native confirm は protocol dialog より renderer 側 stub が確実
      await page.evaluate(() => { (window as any).confirm = () => true; });

      const poi = await seedPoi(page, true);
      await openHash(page, '#/poisources');
      await expect(page.locator(`[data-resource-uid="${poi.uid}"]`)).toBeVisible({ timeout: 15000 });
      await clickCardAction(page, poi.uid, '複製');
      await expect(page.getByTestId('poi-slug')).toHaveValue(`${poi.slug}-copy`, { timeout: 10000 });
      const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      expect(draftUid).not.toBeNull();

      // AC4: 保存せず戻る（hot-exit flush）→ 一覧に下書きカード
      await page.getByTestId('editor-back').click();
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      const draftCard = page.locator(`[data-resource-uid="${draftUid}"]`);
      await expect(draftCard).toBeVisible({ timeout: 15000 });
      await expect(draftCard).toContainText(`${poi.slug}-copy`, { timeout: 5000 });
      // 行は増えていない
      await expect.poll(async () =>
        page.evaluate(async () => (await (window as any).search.poiSources({ page: 1, pageSize: 50 })).total),
      { timeout: 10000 }).toBe(1);

      // 下書きカードを開く → slug・内容が dirty(draft-restored) で復元
      await draftCard.click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('poi-slug')).toHaveValue(`${poi.slug}-copy`, { timeout: 10000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 10000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/下書きから復元/, { timeout: 10_000 });

      // AC5: 下書きカードを削除 → 予約ごと解放され、再複製で -copy が再採番される
      await page.getByTestId('editor-back').click();
      await expect(page.locator(`[data-resource-uid="${draftUid}"]`)).toBeVisible({ timeout: 15000 });
      await clickCardAction(page, draftUid!, '下書きを削除');
      await expect(page.locator(`[data-resource-uid="${draftUid}"]`)).toHaveCount(0, { timeout: 10000 });
      await expect.poll(async () =>
        page.evaluate(async (slug) => window.slugReservations.check({ slug }), `${poi.slug}-copy`),
      { timeout: 10000 }).toBe('available');
      await clickCardAction(page, poi.uid, '複製');
      await expect(page.getByTestId('poi-slug')).toHaveValue(`${poi.slug}-copy`, { timeout: 10000 });

      console.log('  AC4+AC5: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC7: POI新規下書きは「新規追加」で引き継がれる', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-takeover-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 新規で slug のみ入力 → 予約成立 + 初期draft永続（draftDirty=live diverged で実 persist）
      await openHash(page, '#/poisources/new');
      await expect(page.getByTestId('poi-slug')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('poi-slug').fill('t10b-takeover');
      await page.getByTestId('poi-slug').press('Tab');
      const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      expect(draftUid).not.toBeNull();
      await expect.poll(async () => page.evaluate(async (uid) =>
        (await window.assetDrafts.get('poi', uid!)) != null, draftUid), { timeout: 15000 }).toBe(true);

      // 一覧へ戻り「新規追加」→ 同じ draftUid の未作成モードが開く
      await openHash(page, '#/poisources');
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await page.locator('[data-resource-new]').click();
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10000 }).toContain(`draftUid=${draftUid}`);
      await expect(page.getByTestId('poi-slug')).toHaveValue('t10b-takeover', { timeout: 10000 });

      console.log('  AC7: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC13+AC14: blur前の保存とflushはlive slugを使う', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-live-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });

      // AC13: blur 前の Cmd+S が live slug で作成する（古い session slug を送らない）
      await openHash(page, '#/poisources/new');
      await expect(page.getByTestId('poi-slug')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('poi-slug').click();
      await page.getByTestId('poi-slug').pressSequentially('t10b-live-save', { delay: 20 });
      // blur させないまま Cmd+S（draftDirty で gate が開く → flush commit → 最新 slug で作成）
      await page.keyboard.press('Meta+s');
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 })
        .toMatch(/#\/poisources\/[0-9a-f-]{36}$/);
      const savedSlugs = await page.evaluate(async () =>
        ((await (window as any).search.poiSources({ page: 1, pageSize: 50 })).docs as Array<{ slug: string }>).map((d) => d.slug));
      expect(savedSlugs).toContain('t10b-live-save');
      console.log('  AC13: PASS');

      // AC14: blur 前に focus を維持したまま flush → live slug 入りの下書きが残り復元される
      await openHash(page, '#/poisources/new');
      await expect(page.getByTestId('poi-slug')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('poi-slug').click();
      await page.getByTestId('poi-slug').pressSequentially('t10b-live-draft', { delay: 20 });
      // diverged 状態（保存ボタンが enabled）を DOM 観測で確認
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      expect(draftUid).not.toBeNull();
      // focus を移動させず hot-exit 相当の flushSync を発火
      await page.evaluate(() => window.dispatchEvent(new Event('maplat:flush-drafts')));
      await expect.poll(async () => page.evaluate(async (uid) => {
        const draft = await window.assetDrafts.get('poi', uid!) as { payload?: { slug?: string } } | null;
        return draft?.payload?.slug ?? null;
      }, draftUid), { timeout: 15000 }).toBe('t10b-live-draft');
      await openHash(page, '#/poisources');
      const draftCard = page.locator(`[data-resource-uid="${draftUid}"]`);
      await expect(draftCard).toBeVisible({ timeout: 15000 });
      await draftCard.click();
      await expect(page.getByTestId('poi-slug')).toHaveValue('t10b-live-draft', { timeout: 10000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/下書きから復元/, { timeout: 10_000 });
      console.log('  AC14: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC15+AC16: 未作成下書きの画面内破棄と空欄復帰で予約が即時解放される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-release-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });

      // AC16: slug 入力（予約成立）→ 空欄へ戻す → 同じ slug が即時 available
      await openHash(page, '#/poisources/new');
      await expect(page.getByTestId('poi-slug')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('poi-slug').fill('t10b-revert');
      await page.getByTestId('poi-slug').press('Tab');
      // 予約成立を待つ（自 uid 帰属の予約は excludeUid なしの check では reserved-by-other に見える）
      await expect.poll(async () =>
        page.evaluate(async (slug) => window.slugReservations.check({ slug }), 't10b-revert'),
      { timeout: 15000 }).toBe('reserved-by-other');
      await page.getByTestId('poi-slug').fill('');
      await page.getByTestId('poi-slug').press('Tab');
      await expect.poll(async () =>
        page.evaluate(async (slug) => window.slugReservations.check({ slug }), 't10b-revert'),
      { timeout: 15000 }).toBe('available');
      console.log('  AC16: PASS');

      // AC15: 下書き復元状態から画面内破棄 → 下書きと予約が解放される
      await page.getByTestId('poi-slug').fill('t10b-discard');
      await page.getByTestId('poi-slug').press('Tab');
      const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      expect(draftUid).not.toBeNull();
      await expect.poll(async () => page.evaluate(async (uid) =>
        (await window.assetDrafts.get('poi', uid!)) != null, draftUid), { timeout: 15000 }).toBe(true);
      // リロードして下書き復元状態にする
      await page.reload();
      await expect(page.getByTestId('poi-slug')).toHaveValue('t10b-discard', { timeout: 15000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/下書きから復元/, { timeout: 10_000 });
      await page.getByTestId('editor-discard-draft').click();
      // 破棄後は一覧へ戻り、slug は即時 available
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 }).toBe('#/poisources');
      await expect.poll(async () => page.evaluate(async (uid) =>
        (await window.assetDrafts.get('poi', uid!)) != null, draftUid), { timeout: 15000 }).toBe(false);
      await expect.poll(async () =>
        page.evaluate(async (slug) => window.slugReservations.check({ slug }), 't10b-discard'),
      { timeout: 15000 }).toBe('available');
      console.log('  AC15: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC10: 未作成編集はリロード後もdraftUid経由で復元される', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-reload-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      // 複製で開き、feature を1件追加してからリロード（復元競合なく dirty 復元されること）
      const poi = await seedPoi(page, true);
      await openHash(page, '#/poisources');
      await expect(page.locator(`[data-resource-uid="${poi.uid}"]`)).toBeVisible({ timeout: 15000 });
      await clickCardAction(page, poi.uid, '複製');
      await expect(page.getByTestId('poi-slug')).toHaveValue(`${poi.slug}-copy`, { timeout: 10000 });
      await page.getByTestId('poi-slug').press('Tab');
      // 一覧の「新規作成」で feature を1件追加（編集を加える）
      await page.locator('.poi-feature-list [data-resource-new]').click();
      await expect(page.locator('.poi-feature-row')).toHaveCount(2, { timeout: 10000 });
      // draft 永続を待ってからリロード
      const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      await expect.poll(async () => page.evaluate(async (uid) =>
        (await window.assetDrafts.get('poi', uid!)) != null, draftUid), { timeout: 15000 }).toBe(true);
      await page.reload();
      // 復元競合ダイアログではなく auto-apply で内容が戻る
      await expect(page.getByTestId('poi-slug')).toHaveValue(`${poi.slug}-copy`, { timeout: 15000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(2, { timeout: 10000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/下書きから復元/, { timeout: 10_000 });

      console.log('  AC10: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC17: 初回保存後の追加編集は保存済み行の下書きとして扱われ、新規カード化・復元 conflict しない', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-postsave-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      // 新規作成 → slug 入力 → 保存（行作成 + draft lifecycle が保存済み行 identity へ再構成される）
      await openHash(page, '#/poisources/new');
      await expect(page.getByTestId('poi-slug')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('poi-slug').fill('t10b-postsave');
      await page.getByTestId('poi-slug').press('Tab');
      await page.getByTestId('editor-save').click();
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 })
        .toMatch(/#\/poisources\/[0-9a-f-]{36}$/);
      const savedUid = (await page.evaluate(() => location.hash.match(/#\/poisources\/([0-9a-f-]{36})/)?.[1]))!;
      expect(savedUid).toBeTruthy();

      // リロードせず追加編集（feature を1件追加）→ 戻る（hot-exit flush）
      await page.locator('.poi-feature-list [data-resource-new]').click();
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 10000 });
      await page.getByTestId('editor-back').click();
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });

      // 新規下書きカードは現れず（baseRevision=null の下書きが残らない）、保存済み行に badge
      await expect(page.locator('[data-resource-uid]')).toHaveCount(1, { timeout: 10000 });
      const savedCard = page.locator(`[data-resource-uid="${savedUid}"]`);
      await expect(savedCard).toBeVisible({ timeout: 10000 });
      await expect(savedCard.locator('.badge', { hasText: '下書き' })).toBeVisible({ timeout: 5000 });

      // 行を開く → conflict dialog なしで auto-apply 復元（feature 1件 + draft-restored）
      await savedCard.click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('poi-slug')).toHaveValue('t10b-postsave', { timeout: 10000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(1, { timeout: 10000 });
      await expect(page.getByTestId('editor-save-state')).toHaveText(/下書きから復元/, { timeout: 10_000 });
      await expect(page.locator('text=revision').or(page.locator('[data-diagnostic-scope="operation"]', { hasText: /conflict|競合/ }))).toHaveCount(0);

      console.log('  AC17: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC18: 復元下書きの保存後は draft-restored 表示と破棄操作が消える', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t10b-restored-save-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      // 下書きを作成（新規で slug 入力 → focus 維持 flush）
      await openHash(page, '#/poisources/new');
      await expect(page.getByTestId('poi-slug')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('poi-slug').fill('t10b-restored-save');
      await page.getByTestId('poi-slug').press('Tab');
      const draftUid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
      await page.evaluate(() => window.dispatchEvent(new Event('maplat:flush-drafts')));
      await expect.poll(async () => page.evaluate(async (uid) =>
        (await window.assetDrafts.get('poi', uid!)) != null, draftUid), { timeout: 15000 }).toBe(true);

      // 下書きカードから復元 → draft-restored 表示 + 破棄ボタンが見える
      await openHash(page, '#/poisources');
      await page.locator(`[data-resource-uid="${draftUid}"]`).click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/下書きから復元/, { timeout: 15000 });
      await expect(page.getByTestId('editor-discard-draft')).toBeVisible({ timeout: 5000 });

      // 保存 → draft-restored 表示と破棄ボタンが消え、保存済み表示になる
      await page.getByTestId('editor-save').click();
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 15000 })
        .toMatch(/#\/poisources\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み/, { timeout: 10_000 });
      await expect(page.getByTestId('editor-discard-draft')).toHaveCount(0);

      // 一覧へ戻る → 下書きカードなし・保存済み行に badge なし
      await page.getByTestId('editor-back').click();
      await expect(page.locator('[data-resource-new]')).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => page.evaluate(async (uid) =>
        (await window.assetDrafts.get('poi', uid!)) != null, draftUid), { timeout: 15000 }).toBe(false);

      console.log('  AC18: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
