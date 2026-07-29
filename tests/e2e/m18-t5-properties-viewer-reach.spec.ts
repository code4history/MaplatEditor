// M18-T5: layer metadata 交換形の properties 正本化 — viewer 到達 E2E
// AC5-12: preview 経由で layer icon / hide が viewer に届く（§8.4 の検証ギャップを塞ぐ本丸）
// 設計書 §6.2 + レビュー Major-2/v2 Major-1: レイヤA（表示・icon指定）とレイヤB（hide:true）を API シード →
// preview → iframe 内 viewer の ready・marker layer 生成を状態ベースで待機 →
// Aマーカー画像表示・B非表示を viewer 内部状態で assert し、page.pause() で人間目視。
//
// 検証戦略:
// 1. 外部 OSM タイルは page.route で 1x1 PNG を返しローカル完結（v2 Major-1: 外部依存で spinner 停止していた）
// 2. 自動 assert（配信 JSON）: poisA.properties.icon が imgs/ 解決済み・poisA は非表示でない・poisB.properties.hide === true
// 3. 自動 assert（viewer 内部）: marker feature 数・A の style 画像 src・cluster の icon/hide 到達
// 4. 人間確認: ready 到達後に page.pause() で同一画面のAマーカー画像表示・B非表示を目視
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 外部 OSM タイルのローカル fixture（tests/e2e/fixtures/osm-tiles/{z}/{x}/{y}.png）。
// 札幌中心 zoom14 周辺の実タイルを事前取得して同梱（© OpenStreetMap contributors。
// テスト用途の1回限り取得物で、実行時ネットワーク非依存・OSM サーバへの負荷も発生しない）。
// 範囲外（パン等）のタイル要求は地図風ダミータイル（fake-osm-tile.png）へフォールバック。
const OSM_TILE_FIXTURE_ROOT = path.resolve(import.meta.dirname, 'fixtures/osm-tiles');
const FAKE_TILE_PATH = path.resolve(import.meta.dirname, 'fixtures/fake-osm-tile.png');

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
  // 外部 OSM タイルをローカル fixture へ差し替え（iframe 内からの要求も page.route で捕捉される。
  // {z}/{x}/{y} が fixture にあれば実タイル、なければダミータイルを返す）
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
  return { app, page };
}

async function previewFrame(page: Page): Promise<Frame> {
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 30000 });
  const handle = await page.locator('iframe.preview-map').elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('preview iframe の contentFrame を取得できません');
  return frame;
}

test.describe('M18-T5: properties 正本化 — viewer 到達', () => {
  test('AC5-12: preview 経由で layer icon / hide が viewer に届く', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t5-viewer-reach-'));
    const { app, page } = await launch(e2eRoot);
    const slugA = `m18-t5-poi-a-${Date.now()}`;
    const slugB = `m18-t5-poi-b-${Date.now()}`;
    try {
      // 1. POI ソースA（表示・icon指定）作成
      const { poiUidA } = await page.evaluate(async (slug: string) => {
        const result = await window.poiSources.createLocal({ slug, title: { ja: 'レイヤA（表示・icon）' }, lang: 'ja' });
        if (!result || result.result !== 'Success') throw new Error(`poi A create failed: ${JSON.stringify(result)}`);
        await window.poiSources.save(result.uid, {
          slug, title: { ja: 'レイヤA（表示・icon）' },
          fc: {
            type: 'FeatureCollection', lang: 'ja', icon: 'builtin:defaultpin',
            features: [{
              type: 'Feature', id: 'a1',
              geometry: { type: 'Point', coordinates: [141.35, 43.06] },
              properties: { _maplatUid: crypto.randomUUID(), name: { ja: 'レイヤA POI' } },
            }],
          },
        });
        return { poiUidA: result.uid };
      }, slugA);

      // 2. POI ソースB（hide:true 参照対象）作成
      const { poiUidB } = await page.evaluate(async (slug: string) => {
        const result = await window.poiSources.createLocal({ slug, title: { ja: 'レイヤB（hide）' }, lang: 'ja' });
        if (!result || result.result !== 'Success') throw new Error(`poi B create failed: ${JSON.stringify(result)}`);
        await window.poiSources.save(result.uid, {
          slug, title: { ja: 'レイヤB（hide）' },
          fc: {
            type: 'FeatureCollection', lang: 'ja',
            features: [{
              type: 'Feature', id: 'b1',
              geometry: { type: 'Point', coordinates: [141.36, 43.06] },
              properties: { _maplatUid: crypto.randomUUID(), name: { ja: 'レイヤB POI' } },
            }],
          },
        });
        return { poiUidB: result.uid };
      }, slugB);

      // 3. App 作成: pois に A（icon上書き）と B（hide:true）を配置
      const appSlug = await page.evaluate(async ({ poiUidA, poiUidB }: { poiUidA: string; poiUidB: string }) => {
        const slug = `m18-t5-app-${Date.now()}`;
        const savedApp = await window.appedit.save({ slug, document: {
          appID: slug, appName: { ja: 'M18-T5 App' }, title: { ja: 'M18-T5 App' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          // ビルトイン OSM（viewer 内蔵辞書）。自作の tms ソース（tileURL キー）は viewer が
          // `url` しか読まないため URL なしソースになりタイル要求が一度も発火しない（実測で特定。
          // 人間指摘どおりビルトインを使うのが正）
          sources: ['osm'],
          // viewer 向け homePosition は AppExportService が appSettings.homeLng/homeLat から組成する
          // （トップレベルの homePosition キーでは届かない → viewer が既定（東京 zoom 17）へ落ちる。
          //   v2 人間確認で「マーカーが見えない」となった根本原因。view assert で固定する）
          appSettings: { homeLng: 141.35, homeLat: 43.06, defaultZoom: 14 },
          pois: [
            { poiUid: poiUidA, icon: 'builtin:defaultpin' },
            { poiUid: poiUidB, hide: true },
          ],
          httpSettings: {}, manifestSettings: {},
        } });
        if (!savedApp || savedApp.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(savedApp)}`);
        return slug;
      }, { poiUidA, poiUidB });

      // 4. AppEdit へ遷移して preview タブを開く
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15000 });
      const appCard = page.locator(`[data-resource-uid] a`).first();
      await appCard.click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });

      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      const frame = await previewFrame(page);

      // 5. iframe 内 viewer の ready を状態ベースで待機（v2 Major-1）
      //    __maplatPreview は AppPreviewService の preview HTML が createObject 解決時に公開する
      await frame.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 90000 });
      // marker layer（OL VectorSource 'marker'）生成と A のマーカー描画を待機
      await frame.waitForFunction(() => {
        const core = (window as any).__maplatPreview?.core;
        const src = core?.mapObject?.getSource?.('marker');
        return !!src && src.getFeatures().length >= 1;
      }, undefined, { timeout: 60000 });

      // ロードモーダル（アプリロード中です...）の消失を待機（modalBase が bootstrap で hide になる）。
      // createObject 解決直後はモーダルが残っていることがあるため、画面系 assert/目視の前に必ず挟む
      await frame.locator('.modalBase').waitFor({ state: 'hidden', timeout: 30000 });
      // タイル描画の反映を rAF 2 回分で確定（ローカル fixture 配信のため実待ちはごく短い）
      await frame.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
      }));

      // 6. 自動 assert（配信 JSON）: poisA/poisB を直接 assert（v2 Major-1 で指摘された未使用変数の解消）
      const previewSrc = await page.locator('iframe.preview-map').getAttribute('src');
      const appJsonUrl = previewSrc!.replace(/\/$/, '') + '/apps/' + previewSrc!.match(/\/preview\/([^/]+)\//)![1] + '.json';
      const appJson = await page.evaluate(async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
        return await resp.json();
      }, appJsonUrl);

      const poisA = appJson.pois.find((p: any) => p.id && String(p.id).includes('poi-a'));
      const poisB = appJson.pois.find((p: any) => p.id && String(p.id).includes('poi-b'));
      expect(poisA, '配信 JSON にレイヤAの FC が存在する').toBeTruthy();
      expect(poisB, '配信 JSON にレイヤBの FC が存在する').toBeTruthy();
      // レイヤA: 参照 icon 上書きが FC.properties.icon に出力され imgs/ へ解決される
      expect(typeof poisA.properties.icon).toBe('string');
      expect(poisA.properties.icon).toMatch(/^imgs\//);
      // レイヤA: 非表示でない（hide が true でない）
      expect(poisA.properties.hide).not.toBe(true);
      // レイヤB: 参照 hide:true 上書きが FC.properties.hide === true に出力される
      expect(poisB.properties.hide).toBe(true);
      // FC トップレベルに icon/hide が出ない（properties 正本化）
      for (const p of appJson.pois) {
        expect(p.icon).toBeUndefined();
        expect(p.hide).toBeUndefined();
      }

      // 7. 自動 assert（viewer 内部状態）: view 位置 + cluster 到達 + marker layer の実描画
      const viewerState = await frame.evaluate(({ slugA, slugB }: { slugA: string; slugB: string }) => {
        const core = (window as any).__maplatPreview.core;
        const features = core.mapObject.getSource('marker').getFeatures();
        const srcOf = (f: any) => {
          const style = f.getStyle && f.getStyle();
          const image = style && style.getImage ? style.getImage() : null;
          return image && image.getSrc ? image.getSrc() : null;
        };
        const view = core.mapObject.getView();
        const f0 = features[0];
        return {
          viewCenter: view.getCenter(),
          viewZoom: view.getZoom(),
          markerPixel: f0 ? core.mapObject.getPixelFromCoordinate(f0.getGeometry().getCoordinates()) : null,
          clusterAIcon: core.pois?.[slugA]?.icon ?? null,
          clusterAHide: core.pois?.[slugA]?.hide ?? null,
          clusterBHide: core.pois?.[slugB]?.hide ?? null,
          markerCount: features.length,
          markerSrcs: features.map(srcOf),
          hiddenLayerKeys: core.listPoiLayers(true).map((l: any) => l.namespaceID),
        };
      }, { slugA, slugB });

      // view は seed した homePosition（札幌）/ zoom 14 を使う（東京既定へ落ちないことを固定。
      // これがあれば「テストは green だが画面にマーカーが見えない」を防げた）
      const sapporo3857x = 141.35 * 20037508.34 / 180;
      const sapporo3857y = 5321108.9; // 43.06N の実測値相当
      expect(Math.abs(viewerState.viewCenter[0] - sapporo3857x)).toBeLessThan(30000);
      expect(Math.abs(viewerState.viewCenter[1] - sapporo3857y)).toBeLessThan(30000);
      expect(Math.abs(viewerState.viewZoom - 14)).toBeLessThan(0.5);
      // マーカーは画面内（viewport 1200x620 前後の範囲）
      expect(viewerState.markerPixel[0]).toBeGreaterThan(0);
      expect(viewerState.markerPixel[0]).toBeLessThan(1600);
      expect(viewerState.markerPixel[1]).toBeGreaterThan(0);
      expect(viewerState.markerPixel[1]).toBeLessThan(1200);

      // cluster 到達: A の icon は imgs/ 解決値、A は非表示でない、B は hide === true
      expect(viewerState.clusterAIcon).toBe(appJson.pois.find((p: any) => String(p.id).includes('poi-a')).properties.icon);
      expect(viewerState.clusterAHide).not.toBe(true);
      expect(viewerState.clusterBHide).toBe(true);
      // B は listPoiLayers(true)（非表示レイヤ）に含まれる
      expect(viewerState.hiddenLayerKeys.some((k: string) => k.includes('poi-b'))).toBe(true);
      // marker layer: A の 1 POI のみ描画（B の 1 POI は非表示）
      expect(viewerState.markerCount).toBe(1);
      // A マーカーの style 画像が上書き icon（builtin:defaultpin 解決値）である
      expect(viewerState.markerSrcs.length).toBe(1);
      expect(viewerState.markerSrcs[0]).toContain('imgs/icons/builtin/defaultpin.png');

      // 8. 人間確認: ready 到達後の画面（Aマーカー画像表示・B非表示・実 OSM タイル）は
      // 2026-07-29 に人間が目視確認済み（task-state 記録）。page.pause は人間確認の完了に伴い
      // 環境変数 opt-in 化 — 通常実行・CI は有限時間で終了する。
      // 再確認したい場合: MAPLAT_E2E_PAUSE=1 PWDEBUG=1 pnpm test:e2e:m18-t5
      if (process.env.MAPLAT_E2E_PAUSE === '1') await page.pause();
    } finally {
      await quitElectronApplication(app, page);
    }
  });
});
