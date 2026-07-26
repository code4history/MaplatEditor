// M3-T6: inline POI の保全パネル完成と GeoJSON 変換 E2E (設計 §11.1)。
// 手順: seed → 表示(項目数 AC6-1) → 制約(AC6-3) → 変換(AC6-4/6-8(b)) → ドラフト編集保存(AC6-4後半)
//       → 削除確認(AC6-6)+再有効化(AC6-3後半) → zip インポートアラート(AC6-2, dialog stub)
//       → heal 警告 UI 面(AC6-9)
// dialog stub 基盤は m11-t10-dedup-import.spec.ts の実績文法 (app.evaluate で main 側 dialog 差し替え)。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 1x1 透明 PNG (タイル/サムネイルのダミー実体)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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

// seed: pois に 旧 POI オブジェクト 2 件 (lat/lng + 任意キー) + 生 FC 1 件 (feature 2 件) を直接保存
async function seedMapWithInlinePois(page: Page): Promise<{ uid: string; slug: string; pois: unknown[] }> {
  return page.evaluate(async () => {
    const slug = `t6-map-${Date.now()}`;
    const pois = [
      { name: '旧POI甲', lat: 39.7052, lng: 141.1592, start: 1599, image: 'mitsuishi_jinja.jpg' },
      { name: '旧POI乙', lat: 39.7060, lng: 141.1600, memo: '任意キー' },
      {
        type: 'FeatureCollection', name: '生FCレイヤ',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [141.15, 39.70] }, properties: { name: 'F1' } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [141.16, 39.71] }, properties: { name: 'F2' } },
        ],
      },
    ];
    const result = await window.mapedit.save({ slug, mapObject: {
      mapID: slug, title: { ja: 'T6 地図' }, officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'T6 attribution' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [
        [[100, 100], [15550000, 4160000]],
        [[300, 100], [15560000, 4160000]],
        [[200, 250], [15555000, 4150000]],
      ],
      edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      pois,
    }, tins: [] });
    if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return { uid: result.uid as string, slug, pois };
  });
}

async function seedPoiSource(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `t6-src-${Date.now()}`;
    const r = await window.poiSources.createLocal({ slug, title: { ja: 'T6 参照用' }, lang: 'ja' });
    if (!r || r.result !== 'Success') throw new Error(`createLocal: ${JSON.stringify(r)}`);
    // 座標は seed 地図の GCP 範囲 (merc ≈ [15550000-15560000, 4150000-4160000] ≈ lng 139.7 / lat 34.9)
    // 近傍に置く — MapEdit の POI selector は GCP 由来の範囲フィルタが自動有効のため、圏外だと一覧に出ない
    await window.poiSources.save(r.uid, {
      slug, title: { ja: 'T6 参照用' },
      fc: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.72, 34.95] }, properties: { name: { ja: 'T6F' } } }] },
    });
    return { uid: r.uid, slug };
  });
}

// main 側 dialog.showMessageBox を記録 stub に差し替える (OK 自動応答 + message 記録)
async function stubMessageBoxRecording(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    (globalThis as any).__t6MessageBoxLog = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length >= 2 ? args[1] : args[0]) as { message?: string };
      (globalThis as any).__t6MessageBoxLog.push(options?.message ?? '');
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

async function recordedMessages(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(async () => ((globalThis as any).__t6MessageBoxLog ?? []) as string[]);
}

async function clearRecordedMessages(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => { (globalThis as any).__t6MessageBoxLog = []; });
}

// fixture zip (maps/<slug>.json + tiles/<slug>/0/0/0.png + tmbs/<slug>.jpg) をテスト内生成
async function buildMapZip(dir: string, slug: string, pois: unknown[] | undefined): Promise<string> {
  const store: Record<string, unknown> = {
    title: { ja: `${slug} タイトル` }, attr: { ja: 'attr' }, officialTitle: {}, dataAttr: {},
    author: {}, createdAt: {}, era: {}, license: 'PD', dataLicense: 'CC BY-SA', contributor: {}, mapper: {},
    reference: '', description: {}, url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
    gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain',
    homePosition: [141.15, 39.70], mercZoom: 15,
  };
  if (pois) store.pois = pois;
  const zip = new AdmZip();
  zip.addFile(`maps/${slug}.json`, Buffer.from(JSON.stringify(store)));
  zip.addFile(`tiles/${slug}/0/0/0.png`, TINY_PNG);
  zip.addFile(`tmbs/${slug}.jpg`, TINY_PNG);
  const zipPath = path.join(dir, `${slug}.zip`);
  await writeFile(zipPath, zip.toBuffer());
  return zipPath;
}

test.describe('M3-T6 inline POI 保全・変換', () => {
  test('手順1-6: 項目数表示・制約・変換・ドラフト編集保存・削除確認・再有効化', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-main-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxRecording(app);
      const seeded = await seedMapWithInlinePois(page);
      const source = await seedPoiSource(page);

      // --- 手順2: POIデータタブで外部データバッジ + 項目数 (AC6-1) ---
      await openHash(page, `#/mapedit?uid=${seeded.uid}`);
      await expect(page.getByTestId('map-slug')).toHaveValue(seeded.slug, { timeout: 30000 });
      await page.getByTestId('map-tab-pois').click();
      // ベースマップタブ等の別 ResourceSelector が v-show で DOM 共存するため、POI タブペインへスコープする
      const poisPane = page.getByTestId('map-pois-tab-pane');
      const cards = poisPane.locator('.selected-source');
      await expect(cards).toHaveCount(3, { timeout: 15000 });
      await expect(poisPane.locator('.selected-source .badge', { hasText: '外部データ' })).toHaveCount(3);
      const counts = poisPane.getByTestId('poiref-item-count');
      await expect(counts).toHaveCount(3);
      await expect(counts.nth(0)).toHaveText(/1 項目/); // 旧オブジェクト = 1
      await expect(counts.nth(1)).toHaveText(/1 項目/);
      await expect(counts.nth(2)).toHaveText(/2 項目/); // 生 FC = features 数
      // 中身確認 UI (フォーム等) は追加されていない: 非参照カードに上書きフォームが無い
      await expect(cards.first().locator('input')).toHaveCount(0);

      // --- 手順3: 相互排他制約 (AC6-3 前半) ---
      const selectorPane = poisPane.locator('.source-pane-body');
      await expect(selectorPane).toHaveClass(/poi-selector-disabled/);
      await expect(selectorPane).toHaveAttribute('aria-disabled', 'true');
      // ContextHelp (i) ボタンが見出し脇に出る (理由 = add_blocked_note)
      await expect(poisPane.locator(`[aria-label*="GeoJSON POIを追加できません"]`).first()).toBeVisible();

      // --- 手順4: 変換 (AC6-4, AC6-8(b)) ---
      // 群変換 (旧オブジェクト 2 件): ボタンラベルに件数
      const groupButton = poisPane.getByTestId('poiref-convert-group');
      await expect(groupButton).toHaveText(/旧POI 2 件/);
      await groupButton.click();
      await expect(poisPane.locator('.editor-diagnostic__message', { hasText: `POIドラフト「${seeded.slug}-poi」を作成しました` }))
        .toBeVisible({ timeout: 15000 });
      // document (pois 配列) は不変: カード 3 枚のまま + DB 上も seed と同一
      await expect(cards).toHaveCount(3);
      const storedPois = await page.evaluate(async (uid) => (await (window as any).mapedit.request(uid)).pois, seeded.uid);
      expect(storedPois).toEqual(seeded.pois);
      // ドラフト出現 (kind 'poi' / baseRevision null / slug 自動採番 — slug 入力 UI なし)
      const draftsAfterGroup = await page.evaluate(async () => window.assetDrafts.list('poi'));
      expect(draftsAfterGroup.length).toBe(1);
      expect(draftsAfterGroup[0].slug).toBe(`${seeded.slug}-poi`);
      expect(draftsAfterGroup[0].baseRevision).toBeNull();
      // FC カードの「変換」→ 2 件目ドラフト <slug>-poi2 (衝突時連番)
      await poisPane.getByTestId('poiref-convert-fc').click();
      await expect(poisPane.locator('.editor-diagnostic__message', { hasText: `POIドラフト「${seeded.slug}-poi2」を作成しました` }))
        .toBeVisible({ timeout: 15000 });
      const draftsAfterFc = await page.evaluate(async () => window.assetDrafts.list('poi'));
      expect(draftsAfterFc.map((d) => d.slug).sort()).toEqual([`${seeded.slug}-poi`, `${seeded.slug}-poi2`]);
      // FC 変換ドラフトの title は FC.name 優先 (POI-114 整合)
      expect(draftsAfterFc.find((d) => d.slug === `${seeded.slug}-poi2`)?.label).toBe('生FCレイヤ');

      // --- 手順5: POI 一覧のドラフトカード → PoiEdit 復元 → 保存 (AC6-4 後半) ---
      const groupDraftUid = draftsAfterGroup[0].assetUid;
      await openHash(page, '#/poisources');
      await expect(page.locator(`[data-resource-uid="${groupDraftUid}"]`)).toBeVisible({ timeout: 15000 });
      await page.locator(`[data-resource-uid="${groupDraftUid}"] a`).click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(2, { timeout: 15000 }); // 旧POI 2 件が復元される
      const saveButton = page.getByTestId('editor-save');
      await expect(saveButton).toBeEnabled({ timeout: 10000 });
      await saveButton.click();
      // 保存済みソース化 (createLocal promote — 予約 slug がそのまま採用される)
      await expect.poll(async () => page.evaluate(async (slug) => {
        const r = await (window as any).search.poiSources({ page: 1, pageSize: 50 });
        return (r.docs ?? []).some((doc: any) => doc.slug === slug);
      }, `${seeded.slug}-poi`), { timeout: 20000 }).toBe(true);

      // --- 手順6: 削除確認 (AC6-6) + 再有効化 (AC6-3 後半) ---
      await openHash(page, '#/maplist');
      await openHash(page, `#/mapedit?uid=${seeded.uid}`);
      await expect(page.getByTestId('map-slug')).toHaveValue(seeded.slug, { timeout: 30000 });
      await page.getByTestId('map-tab-pois').click();
      await expect(cards).toHaveCount(3, { timeout: 15000 });
      // × → 確認 dialog (body = 変換導線つき Undo 可能文言) → cancel で残存
      await cards.nth(0).locator('.btn-outline-danger').click();
      const dialogBody = page.locator('.modal-body p', { hasText: 'この外部データを一覧から削除します' });
      await expect(dialogBody).toBeVisible();
      await expect(dialogBody).toHaveText(/Undoで取り消せます/);
      await expect(dialogBody).toHaveText(/GeoJSONへの変換/);
      // 確認 title に項目数が併記される
      await expect(page.locator('.modal-title')).toHaveText(/旧POI甲（1 項目）/);
      await page.locator('.modal-footer .btn-outline-secondary').click(); // cancel
      await expect(cards).toHaveCount(3);
      // confirm で削除 ×3 (全非参照要素の削除)
      for (let remaining = 3; remaining > 0; remaining--) {
        await cards.nth(0).locator('.btn-outline-danger').click();
        await page.getByTestId('delete-confirm-button').click();
        await expect(cards).toHaveCount(remaining - 1);
      }
      // 追加が自動で再有効化される → 参照を追加できる
      await expect(selectorPane).not.toHaveClass(/poi-selector-disabled/);
      await selectorPane.locator(`[data-resource-uid="${source.uid}"]`).click();
      await expect(cards).toHaveCount(1, { timeout: 10000 });
      await expect(poisPane.locator('.selected-source .badge', { hasText: '外部データ' })).toHaveCount(0);

      console.log('  手順1-6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('手順7: map zip インポート時アラート (AC6-2)', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-zip-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxRecording(app);
      const fixtureDir = path.join(e2eRoot, 'fixtures');
      await mkdir(fixtureDir, { recursive: true });
      const inlineZip = await buildMapZip(fixtureDir, `t6-zip-a-${Date.now()}`, [
        { name: '旧POI', lat: 39.7, lng: 141.15, start: 1599 },
        'https://example.com/pois.json',
      ]);
      const plainZip = await buildMapZip(fixtureDir, `t6-zip-b-${Date.now()}`, undefined);

      // inline pois 入り zip → 成功後にアラートが出る
      await app.evaluate(async ({ dialog }, filePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
      }, inlineZip);
      await openHash(page, '#/mapedit?import=1');
      await expect.poll(async () => (await recordedMessages(app)).some((m) => m.includes('地図内定義型のPOI指定は編集に対応していません')),
        { timeout: 60000 }).toBe(true);

      // pois 無し zip → アラート非呼出
      await clearRecordedMessages(app);
      await app.evaluate(async ({ dialog }, filePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
      }, plainZip);
      await openHash(page, '#/maplist');
      await openHash(page, '#/mapedit?import=1');
      // インポート完了 (地図一覧に 2 件目が載る) まで待ってから、アラートが出ていないことを確認
      await expect.poll(async () => page.evaluate(async () => (await window.maplist.request('', 1)).docs.length),
        { timeout: 60000 }).toBe(2);
      expect((await recordedMessages(app)).some((m) => m.includes('地図内定義型のPOI指定は編集に対応していません'))).toBe(false);

      console.log('  手順7: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('手順8: app heal 失敗時の警告表示 + タブ read-only (AC6-9 UI面)', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-heal-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 破損 pois (heal 復元不能な生値) を持つ app を seed
      const seeded = await page.evaluate(async () => {
        const slug = `t6-heal-${Date.now()}`;
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: { appID: slug, appName: { ja: 'T6 Heal' }, title: { ja: 'T6 Heal' }, description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [], pois: 'https://example.com/legacy-pois.json', httpSettings: {}, appSettings: {}, manifestSettings: {} },
        });
        if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
        return { uid, slug };
      });
      await openHash(page, `#/appedit?uid=${seeded.uid}`);
      await expect(page.getByTestId('app-id')).toHaveValue(seeded.slug, { timeout: 30000 });
      await page.locator('[role="tab"]', { hasText: 'POI選択' }).click();
      const appPoisPane = page.getByTestId('app-pois-tab-pane');
      // 警告 (更新後文言: 保存で失われない・編集無効化・preview/export 非反映)
      await expect(appPoisPane.locator('.editor-diagnostic__message', { hasText: 'POIデータを復元できませんでした' })).toBeVisible({ timeout: 15000 });
      // タブ read-only (selector 無効化)
      await expect(appPoisPane.locator('.source-pane-body')).toHaveClass(/poi-selector-disabled/);

      console.log('  手順8: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
