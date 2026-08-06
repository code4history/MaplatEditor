// m6-t9 §3.4 第2段階: MapLibre ちらつきの人間検証環境準備。
// 恒久テストではない（AC5 は人間検証 + task-state 記録が検証手段。設計 §7）。
// maplibre kind のベースマップを含むアプリのプレビューを起動し、URL を stdout へ出力した後、
// page.pause() で一時停止する。nayuta-implementer スキル「E2Eテスト実施後のモード」の手順どおり、
// PWDEBUG=1 pnpm run test:e2e:m6-t9-ac5-verify で実行すると、Playwright Inspector が
// 開いた状態で一時停止するので、人間は Resume を押す前に別ウィンドウで stdout に出力される
// M6T9_AC5_PREVIEW_URL を開き、実際の描画を目視確認できる。
//
// 実装レビュー round2 Minor m-1 対応: bare な `playwright test`（引数なし）に本ファイルが
// 巻き込まれると test.setTimeout(0) + page.pause() のため終了しないテストになる。
// `.harness.ts` へのリネーム・testIgnore への追加はいずれも Playwright の
// testMatch/testIgnore がファイル検出段階で効くため、CLI で明示的にこのファイルを指定した
// 場合も収集自体から除外され harness として使えなくなることを実装時に実測確認した
// （`playwright test <このファイル>.harness.ts` も `playwright test <このファイル> --list`
// も「No tests found」になる）。そのため round2 m-1 の指摘が併記していた第3の選択肢
// 「環境変数がなければ test.skip()」を採用する: bare 実行時は test.skip() で即座に終了し、
// 明示的に M6T9_AC5_INTERACTIVE=1 を渡した場合のみ実際に起動・一時停止する。
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedE2EProviderKeys } from './helpers/providerKeys';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PREVIEW_PORT = 45786; // 他 spec (45782/45784) と衝突しない固定ポート
// 既定はデモスタイル（osm-bright）。実装レビュー round2 で「デモでは解消したが
// MapTiler v3-openmaptiles 等の実運用スタイルでは未解消」と判明したため、
// M6T9_AC5_STYLE_URL で実運用スタイルへ差し替えられるようにする
// （例: M6T9_AC5_STYLE_URL='https://api.maptiler.com/maps/streets-v2/style.json?key=...'）
const MAPLIBRE_STYLE = process.env.M6T9_AC5_STYLE_URL
  || 'https://tile.openstreetmap.jp/styles/osm-bright/style.json';

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

test('m6-t9 AC5 第2段階: maplibre プレビューを人間検証用に起動して一時停止する', async () => {
  test.skip(
    process.env.M6T9_AC5_INTERACTIVE !== '1',
    'AC5 人間検証用 harness。既定ではスキップする（page.pause() で無期限停止するため）。'
      + ' M6T9_AC5_INTERACTIVE=1 を指定して明示的に起動すること（package.json の'
      + ' test:e2e:m6-t9-ac5-verify スクリプト経由が既定）。',
  );
  test.setTimeout(0); // page.pause() は人間操作待ちのため無制限
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t9-ac5-'));
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await seedE2EProviderKeys(page);

  // ---- maplibre マスタを UI で作成・保存（m6-t5-mapbox-maplibre.spec.ts と同型） ----
  await page.evaluate(() => { location.hash = '/basemaps'; });
  await page.getByTestId('basemap-new').click();
  await expect(page.getByTestId('basemap-kind-prompt')).toBeVisible();
  await page.getByTestId('basemap-kind-maplibre').click();
  await fillAndCommit(page.getByTestId('basemap-slug'), 'ac5-verify-maplibre');
  await fillAndCommit(page.getByTestId('basemap-title'), 'AC5 検証用 MapLibre');
  await fillAndCommit(page.getByTestId('basemap-attr'), '(C) OSM');
  await fillAndCommit(page.getByTestId('basemap-style-url'), MAPLIBRE_STYLE);
  await expect(page.getByTestId('editor-save')).toBeEnabled();
  await page.getByTestId('editor-save').click();
  await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });

  const master = await page.evaluate(async () => {
    const list = await (window as any).baseMaps.list();
    const items = Array.isArray(list) ? list : list?.items || list?.result || [];
    return (items as any[]).find((m) => (m.mapID || m.slug) === 'ac5-verify-maplibre');
  });
  expect(master).toBeTruthy();

  // ---- アプリを1件シードしてプレビュー ----
  const slug = 'ac5-verify-app';
  await page.evaluate(async ({ slug, sources, previewPort }) => {
    const saved = await (window as any).appedit.save({ slug, document: {
      appID: slug, appName: { ja: slug }, title: { ja: slug },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources,
      appSettings: { homeLng: 139.767, homeLat: 35.681, defaultZoom: 12 },
      pois: [],
      httpSettings: { previewPort }, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
  }, {
    slug,
    sources: [{
      // 実装レビュー round2 Minor m-2: SourceKind は maplat|builtin|tms の3値のみ。
      // 'base-map' は m6-t5-mapbox-maplibre.spec.ts の既存パターンを踏襲していたが不正確だった
      // （normalizeAppSource が結果的に tms 分岐へ落とすため動作はする。他タスクのファイル側は
      // 対象外のため触らない）
      sourceType: 'tms',
      mapID: 'ac5-verify-maplibre',
      role: 'base',
      data: { ...(master.data || master), kind: 'maplibre', maptype: 'maplibre', style: MAPLIBRE_STYLE },
    }],
    previewPort: PREVIEW_PORT,
  });

  await page.evaluate(() => { location.hash = '/applist'; });
  await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15000 });
  await page.locator('[data-resource-uid] a').filter({ hasText: slug }).first().click();
  await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60000 });
  const src = (await page.locator('iframe.preview-map').getAttribute('src'))!;

  /* eslint-disable no-console */
  console.log(`M6T9_AC5_PREVIEW_URL=${src}`);
  console.log(`M6T9_AC5_STYLE_URL=${MAPLIBRE_STYLE}`);
  console.log('実装レビュー round2 H-AC5-2 で根本原因を特定・修正済み: layer_maplibre.ts の');
  console.log('render()（OpenLayers のレンダーフレームごとに呼ばれる）が mlMap.setStyle(source.style)');
  console.log('を直前値との比較なしに無条件で呼んでいたため、差分適用が効かない実運用スタイル');
  console.log('（MapTiler v3-openmaptiles 等）でスタイル再構築（スプライト再取得含む）が繰り返され、');
  console.log('視覚的にちらつきとして現れていた。直前 style をキャッシュし変更時のみ setStyle を');
  console.log('呼ぶガードを追加済み（回帰: spec/m6-t9-h-ac5-2-setstyle-guard.spec.ts、MaplatCore）。');
  console.log('');
  console.log('本 harness は既定でデモスタイル（osm-bright）を使う。デモスタイルは元々ちらつかない');
  console.log('ため、修正の確証を得るには M6T9_AC5_STYLE_URL に実運用スタイル（MapTiler v3 等、');
  console.log('ちらつきが実際に再現していたもの）を指定して再実行すること。上記 URL を開き、初回');
  console.log('表示時・パン/ズーム操作時にちらつきが解消していることを目視確認してください。');
  /* eslint-enable no-console */

  await page.pause();
  await app.close();
});
