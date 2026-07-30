// M1-T3: swiper 12 系への更新 — preview 到達 E2E
// AC13: preview iframe 内で複数画像 POI の swiper が生成され、スライド数が seed の画像数と一致する。
//
// なぜ必要か（設計書 §9.4）:
//   swiper は POI の画像が2枚以上のときだけ生成される。MaplatEditor は Maplat の静的 POI を
//   読む経路を持たず、ローカルに POI source / App を作って preview iframe へ読み込ませる別経路である。
//   したがって「Maplat と同じ POI を preview で見る」ことはできず、ここで seed する必要がある。
//
// 二モード（設計書 §9.4(b)。既存 m18-t1 / m18-t2 / m18-t5 と同じ作法）:
//   非対話（既定）: スライド数まで assert して終了する。停止しない
//   対話（人間確認）: MAPLAT_E2E_PAUSE=1 を与えたときだけ page.pause() する
//
// 起動は必ず task script 経由で行うこと:
//   pnpm --filter maplat-editor run test:e2e:m1-t3-swiper
//   MAPLAT_E2E_PAUSE=1 PWDEBUG=1 pnpm --filter maplat-editor run test:e2e:m1-t3-swiper
//   直接 `pnpm exec playwright test` を叩くと ensure-electron / build を迂回し、
//   依存更新前の bundle を検証してしまう（設計レビュー v1.6 Major-1）。
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const OSM_TILE_FIXTURE_ROOT = path.resolve(import.meta.dirname, 'fixtures/osm-tiles');
const FAKE_TILE_PATH = path.resolve(import.meta.dirname, 'fixtures/fake-osm-tile.png');

// seed する画像。Maplat の実データ（stones_poi.geojson）と同じ {src, caption} 形式・同じ公開 URL。
// 枚数はスライド数 assert の期待値になる。
const IMAGES = [
  { src: 'https://t.tilemap.jp/maplat/img/Tatebayashi/Stones/no260-DSC_7125.JPG', caption: '確認用1枚目' },
  { src: 'https://t.tilemap.jp/maplat/img/Tatebayashi/Stones/no256-DSC_7083.JPG', caption: '確認用2枚目' },
  { src: 'https://t.tilemap.jp/maplat/img/Tatebayashi/Stones/no260-DSC_7125.JPG', caption: '確認用3枚目' },
];
const POI_FEATURE_ID = 'm1-t3-swiper-target';

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash: string) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  // 外部 OSM タイルはローカル fixture へ差し替える（m18-t5 と同じ。実行時ネットワーク非依存）
  const fakeTile = await readFile(FAKE_TILE_PATH);
  await page.route('**/tile.openstreetmap.org/**', async (route) => {
    const m = route.request().url().match(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) {
      const fixturePath = path.join(OSM_TILE_FIXTURE_ROOT, m[1], m[2], `${m[3]}.png`);
      if (existsSync(fixturePath)) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: await readFile(fixturePath) });
      }
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: fakeTile });
  });
  // POI 画像は外部取得を避けて 1x1 PNG を返す（枚数の assert には十分。目視時も枠は出る）
  await page.route('**/t.tilemap.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: fakeTile }));
  return { app, page };
}

async function previewFrame(page: Page): Promise<Frame> {
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 30000 });
  const handle = await page.locator('iframe.preview-map').elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('preview iframe の contentFrame を取得できません');
  return frame;
}

test.describe('M1-T3: swiper 12 — preview 到達', () => {
  test('AC13: 複数画像 POI の swiper が preview で生成され、スライド数が画像数と一致する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m1-t3-swiper-'));
    const { app, page } = await launch(e2eRoot);
    const slug = `m1-t3-poi-${Date.now()}`;
    try {
      // 1. POI ソース作成（画像を複数枚持たせる。これが swiper 生成の条件）
      const poiUid = await page.evaluate(async ({ slug, images, featureId }: any) => {
        const created = await window.poiSources.createLocal({ slug, title: { ja: 'swiper 確認用' }, lang: 'ja' });
        if (!created || created.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(created)}`);
        await window.poiSources.save(created.uid, {
          slug, title: { ja: 'swiper 確認用' },
          fc: {
            type: 'FeatureCollection', lang: 'ja',
            features: [{
              type: 'Feature', id: featureId,
              geometry: { type: 'Point', coordinates: [141.35, 43.06] },
              properties: {
                _maplatUid: crypto.randomUUID(),
                name: { ja: 'swiper 確認用 POI' },
                image: images,
              },
            }],
          },
        });
        return created.uid as string;
      }, { slug, images: IMAGES, featureId: POI_FEATURE_ID });

      // 2. App 作成（ビルトイン OSM。homeLng/homeLat を POI に合わせないとマーカーが画面外になる）
      await page.evaluate(async (poiUid: string) => {
        const s = `m1-t3-app-${Date.now()}`;
        const saved = await window.appedit.save({ slug: s, document: {
          appID: s, appName: { ja: 'M1-T3 Swiper App' }, title: { ja: 'M1-T3 Swiper App' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources: ['osm'],
          appSettings: { homeLng: 141.35, homeLat: 43.06, defaultZoom: 14 },
          pois: [{ poiUid }],
          httpSettings: {}, manifestSettings: {},
        } });
        if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
      }, poiUid);

      // 3. AppEdit へ遷移して preview タブを開く
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15000 });
      await page.locator('[data-resource-uid] a').first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });
      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      const frame = await previewFrame(page);

      // 4. viewer の ready と marker 生成を状態ベースで待機（m18-t5 と同じ作法）
      await frame.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 90000 });
      await frame.waitForFunction(() => {
        const src = (window as any).__maplatPreview?.core?.mapObject?.getSource?.('marker');
        return !!src && src.getFeatures().length >= 1;
      }, undefined, { timeout: 60000 });
      await frame.locator('.modalBase').waitFor({ state: 'hidden', timeout: 30000 });

      // 5. POI を開く。
      //    ピクセル座標クリックは地図のパン状態に依存して不安定なため、実経路のイベントを直接発火する。
      //    Maplat/src/ui_init.ts:616 が core の "clickMarkers" を購読し、detail が1件のとき
      //    ui.handleMarkerAction(data[0]) を呼ぶ。その中で ui_marker.ts:130 が cc-swiper を組む。
      //    detail には OL feature ではなく POI の datum（image 配列を持つ）を渡す必要がある。
      const dispatched = await frame.evaluate((featureId: string) => {
        const core = (window as any).__maplatPreview?.core;
        const src = core?.mapObject?.getSource?.('marker');
        const feats = src?.getFeatures?.() ?? [];
        const datumOf = (f: any) => f.get?.('datum') ?? f.getProperties?.()?.datum ?? f.getProperties?.();
        const target =
          feats.map(datumOf).find((d: any) => JSON.stringify(d ?? '').includes(featureId)) ??
          feats.map(datumOf).find((d: any) => Array.isArray(d?.image) && d.image.length > 1);
        if (!target) return { ok: false, reason: 'image を持つ marker datum が見つかりません' };
        // core は OpenLayers の Observable であり、dispatchEvent は DOM CustomEvent ではなく
        // { type, ... } のプレーンオブジェクトを取る（CustomEvent を渡すと OL が target を
        // 代入しようとして 'Cannot set property target of #<Event>' になる。実測）。
        // 購読側（Maplat/src/ui_init.ts:616）は evt.detail を読むだけなので detail を載せれば足りる。
        core.dispatchEvent({ type: 'clickMarkers', detail: [target] });
        return { ok: true, images: Array.isArray(target.image) ? target.image.length : 0 };
      }, POI_FEATURE_ID);
      expect(dispatched.ok, `clickMarkers を発火できること（${dispatched.reason ?? ''}）`).toBe(true);
      expect(dispatched.images, 'viewer に届いた datum が seed した画像数を保っていること').toBe(IMAGES.length);

      // 6. swiper の生成とスライド数を assert（AC13 の本体）
      const swiper = frame.locator('cc-swiper').first();
      await expect(swiper).toBeAttached({ timeout: 30000 });
      const slideCount = await frame.evaluate(() =>
        document.querySelectorAll('cc-swiper cc-swiper-slide').length);
      expect(slideCount, 'swiper のスライド数が seed した画像数と一致すること').toBe(IMAGES.length);

      // 7. 人間確認用の一時停止（MAPLAT_E2E_PAUSE=1 のときだけ有効。既存 m18-t2 と同じ作法）
      //    判定項目（設計書 §9.1）: (i) 全枚数表示 (ii) スワイプ送り
      //    (iii) ページネーションが枚数と一致し現在位置を示す (iv) 先頭でさらに戻る / 末尾でさらに送る
      if (process.env.MAPLAT_E2E_PAUSE === '1') {
        await page.pause();
      }
    } finally {
      await quitElectronApplication(app);
    }
  });
});
