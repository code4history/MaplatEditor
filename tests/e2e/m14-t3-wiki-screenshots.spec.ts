// m14-t3: Wiki（MaplatEditor.wiki）掲載用スクリーンショット取得スクリプト（S1〜S4）。
// 機能テストではなく、Wiki 用の静的画像資産を決定的に生成する補助スクリプトが目的
// （タスク設計書 `docs/superpowers/specs/2026-07-25-m14-t3-wiki-catchup-design.md` §3.5 参照）。
// assertion は「実ユーザーデータ非接触ガード」（launch() 内蔵）と各画面の到達確認に限定する。
//
// launch() は m11-t5-shell-tokens.spec.ts のヘルパーを env（MAPLAT_E2E_ROOT・
// --user-data-dir）含め丸ごと import して再利用する（設計書 §3.5.2。env の付け忘れを
// 構造的に防ぐため。m11-t5 側で `export` を追加した以外の変更はしていない）。
//
// フィクスチャは tests/fixtures/m13-t5-migration-pipeline/ 配下の実データ由来コピー
// （takabatake_kozu1/2、人間承認済み・権利クリア確認済み）を再利用する
// （tests/e2e/m13-t5-migration-pipeline-e2e.spec.ts が先例。設計書 §3.5.2 準拠）。
//
// 【v1.2.2 設計変更】S5（MapEdit の Data IO タブ）は実 UI から到達不能な dead code と
// 判明したため撮影対象から除外し、4枚（S1〜S4）構成とした。地図の Export ボタンは
// S2 のヘッダーに、地図の Import ボタンは S1 の MapList ツールバーに、
// POI/App の Export ボタンはそれぞれ S3/S4 のヘッダーに、既に写り込む。
import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './m11-t5-shell-tokens.spec';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixturesRoot = path.join(projectRoot, 'tests/fixtures/m13-t5-migration-pipeline');
const artifactDir = path.join(projectRoot, 'test-results', 'm14-t3-screenshots');

// takabatake_kozu1 の legacy-nedb-lines.ndjson `compiled.points` をそのまま modern
// gcps 形式（[[px,py],[geoX,geoY]]）として再利用する。migration が top-level gcps を
// 復元するかどうかに依存せず、S2（GCP を1点以上設定した状態）を決定的に満たすための
// 手当て（既存の実データ由来座標をそのまま使うため、新規の座標をでっち上げてはいない）。
const TAKABATAKE_KOZU1_GCPS: [[number, number], [number, number]][] = [
  [[1142.94, 3795.38], [15122235.247061, 4119834.354722]],
  [[3690.03, 891.09], [15122359.242774, 4119976.024325]],
  [[3570.03, 1035.09], [15122353.569714, 4119972.739921]],
  [[3433.12, 3372.15], [15122354.085613, 4119858.349678]],
];

async function forceEnglish(page: Page): Promise<void> {
  // 【設計書 §3.5.4】英語 UI で単一撮影する（英日両ページから共有）。
  await page.evaluate(() => window.settings.set('lang', 'en'));
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('#langSwitcher')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#langSwitcher')).toHaveValue('en');
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible({ timeout: 20000 });
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

test('m14-t3: capture current-1..4 wiki screenshots (MapList / MapEdit-GCP / PoiEdit / AppEdit-preview)', async () => {
  test.setTimeout(240_000);

  // --- フィクスチャ配置（tests/e2e/m13-t5-migration-pipeline-e2e.spec.ts §5.6 手順2と同一パターン） ---
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m14-t3-screenshots-'));
  const saveFolder = path.join(e2eRoot, 'save-folder');
  await mkdir(saveFolder, { recursive: true });
  await cp(path.join(fixturesRoot, 'legacy-nedb-lines.ndjson'), path.join(saveFolder, 'nedb.db'));
  await mkdir(path.join(saveFolder, 'originals'), { recursive: true });
  await cp(
    path.join(fixturesRoot, 'originals/takabatake_kozu1.jpg'),
    path.join(saveFolder, 'originals/takabatake_kozu1.jpg'),
  );
  await cp(
    path.join(fixturesRoot, 'originals/takabatake_kozu2.jpg'),
    path.join(saveFolder, 'originals/takabatake_kozu2.jpg'),
  );
  await mkdir(path.join(saveFolder, 'tiles/takabatake_kozu1/2/0'), { recursive: true });
  await mkdir(path.join(saveFolder, 'tiles/takabatake_kozu2/2/0'), { recursive: true });
  await cp(
    path.join(fixturesRoot, 'tiles/takabatake_kozu1/2/0/0.jpg'),
    path.join(saveFolder, 'tiles/takabatake_kozu1/2/0/0.jpg'),
  );
  await cp(
    path.join(fixturesRoot, 'tiles/takabatake_kozu2/2/0/0.jpg'),
    path.join(saveFolder, 'tiles/takabatake_kozu2/2/0/0.jpg'),
  );
  await mkdir(artifactDir, { recursive: true });

  const { app, page } = await launch(e2eRoot);
  const shot = (name: string) => page.screenshot({ path: path.join(artifactDir, `${name}.png`) });

  try {
    await forceEnglish(page);

    // --- migration 完了の同期点（m13-t5-migration-pipeline-e2e.spec.ts と同一の待ち方） ---
    const listResult: any = await page.evaluate(() => (window as any).maplist.request('', 1, 50));
    const byMapID: Record<string, string> = Object.fromEntries(
      (listResult.docs as any[]).map((d: any) => [d.mapID, d.uid]),
    );
    const uid1 = byMapID['takabatake_kozu1'];
    const uid2 = byMapID['takabatake_kozu2'];
    expect(uid1, 'takabatake_kozu1 は migration により uid を持つはず').toBeTruthy();
    expect(uid2, 'takabatake_kozu2 は migration により uid を持つはず').toBeTruthy();

    // --- S2 の前提: takabatake_kozu1 に GCP が設定済みであることを決定的に保証する ---
    await page.evaluate(async ({ uid, gcps }) => {
      const existing: any = await (window as any).mapedit.request(uid);
      if (!existing) throw new Error(`map not found: ${uid}`);
      const width = existing.width || 4800;
      const height = existing.height || 6480;
      const strictMode = existing.strictMode || 'strict';
      const vertexMode = existing.vertexMode || 'plain';
      const tinResult = await (window as any).mapedit.updateTin(
        gcps, existing.edges || [], 0, [width, height], strictMode, vertexMode,
      );
      if (!Array.isArray(tinResult) || !tinResult[1]) {
        throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
      }
      const merged = { ...existing, gcps, width, height, strictMode, vertexMode };
      const saveResult = await (window as any).mapedit.save({
        slug: existing.mapID, uid, mapObject: merged, tins: [tinResult[1]],
      });
      if (!saveResult || saveResult.result !== 'Success') {
        throw new Error(`GCP seed save failed: ${JSON.stringify(saveResult)}`);
      }
    }, { uid: uid1, gcps: TAKABATAKE_KOZU1_GCPS });

    // ================= S1: 地図一覧（フィクスチャ地図2件 + 下書き1件） =================
    // 新規地図の下書きを1件作る。draftUid は最初の mount で router.replace により URL へ
    // 付与されるため、reload 後も同一 draft を指し続ける(MapEdit.vue:1980 相当)。
    await openHash(page, '#/mapedit?new=1', '[data-testid="map-title"]');
    await fillAndCommit(page.getByTestId('map-title'), 'Draft Map for Screenshot');
    await page.reload(); // beforeunload flushSync で draft を永続化する（m11-t5 の base map draft 検証と同じパターン）
    await page.waitForLoadState('domcontentloaded');
    await openHash(page, '#/maplist', '.main-content');
    await expect(page.locator('.resource-grid-card')).toHaveCount(3, { timeout: 20000 }); // フィクスチャ地図2件 + 下書き1件
    await page.waitForTimeout(500); // サムネイル描画の安定待ち
    await shot('current-1-map-list');

    // ================= S2: 地図編集（GCP設定タブ） =================
    await openHash(page, `#/mapedit?uid=${uid1}`, '#mapDocumentLanguage');
    await page.getByTestId('map-tab-gcps').click();
    await expect(page.locator('#mercMap')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800); // OL 地図・GCP マーカー描画の安定待ち
    await shot('current-2-map-edit-gcp');

    // ================= S3: POI エディタ（コンテンツモード選択状態） =================
    const poiUid: string = await page.evaluate(async () => {
      const slug = `m14-t3-poi-${Date.now()}`;
      const createResult: any = await (window as any).poiSources.createLocal({
        slug, title: { en: 'Screenshot POI Source' }, lang: 'en',
      });
      if (!createResult || createResult.result !== 'Success') {
        throw new Error(`POI source seed failed: ${JSON.stringify(createResult)}`);
      }
      const uid = createResult.uid;
      const saveResult: any = await (window as any).poiSources.save(uid, {
        slug, title: { en: 'Screenshot POI Source' },
        fc: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
            properties: {
              name: { en: 'Sample POI' },
              desc: { en: 'Sample description for the wiki screenshot.' },
              html: { en: '<p>Sample HTML content</p>' },
              url: { en: 'https://example.com' },
              address: { en: 'Sample address' },
            },
          }],
        },
      });
      if (!saveResult || saveResult.result !== 'Success') {
        throw new Error(`POI source save failed: ${JSON.stringify(saveResult)}`);
      }
      return uid;
    });
    await openHash(page, `#/poisources/${poiUid}`, '.poi-side-pane');
    await page.locator('.poi-feature-row').first().click();
    await expect(page.getByTestId('poi-content-mode-tab-standard')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(300);
    await shot('current-3-poi-editor');

    // ================= S4: アプリ編集（ベースマップ/POIソース選択 + プレビュー） =================
    const baseMapSlug = `m14-t3-basemap-${Date.now()}`;
    await page.evaluate(async (slug: string) => {
      const result: any = await (window as any).baseMaps.saveUser({
        slug,
        tms: {
          lang: 'en', title: { en: 'Screenshot Base Map' }, label: { en: 'Screenshot Base Map' },
          attr: {}, url: 'https://example.com/tiles/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 18, thumbnail: '',
          coverageLngLats: [[139.60, 35.60], [139.90, 35.60], [139.90, 35.80], [139.60, 35.80]],
        },
        create: true,
      });
      if (!result || result.result !== 'Success') {
        throw new Error(`Base map seed failed: ${JSON.stringify(result)}`);
      }
    }, baseMapSlug);

    const appUid: string = await page.evaluate(async () => {
      const slug = `m14-t3-app-${Date.now()}`;
      const result: any = await (window as any).appedit.save({
        slug,
        document: {
          appID: slug, appName: { en: 'Screenshot App' }, title: { en: 'Screenshot App' }, description: {},
          keywords: '', siteUrl: '', lang: 'en', sources: [], pois: [],
          httpSettings: {}, appSettings: {}, manifestSettings: {},
        },
      });
      if (!result || result.result !== 'Success') throw new Error(`App seed failed: ${JSON.stringify(result)}`);
      return result.uid;
    });

    await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
    await page.getByTestId('app-sources-tab').click();
    await page.getByTestId('app-basemap-mode').click();
    // 330件超のビルトインベースマップが既定表示され、検索しないと自作ベースマップが
    // 最初のページに現れないため、スラッグで絞り込む
    await page.getByTestId('app-basemap-search').fill(baseMapSlug);
    await page.locator(`[data-testid="app-basemap-row-${baseMapSlug}"]`).click({ timeout: 15000 });
    await page.locator('.editor-ui-tabs .nav-link', { hasText: 'Select POIs' }).click();
    await page.locator(`[data-resource-uid="${poiUid}"]`).click();
    await page.locator('.editor-ui-tabs .nav-link', { hasText: 'Preview' }).click();
    await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(1000); // iframe 内地図描画の安定待ち
    await shot('current-4-app-editor-preview');
  } finally {
    await quitElectronApplication(app);
  }
});
