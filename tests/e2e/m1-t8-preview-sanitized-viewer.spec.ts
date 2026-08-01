// M1-T8: preview viewer bundle 同期後のサニタイズされた POI 描画の E2E 検証
//
// AC5: 実プレビューで viewer が動作し、POI の HTML が無害化された状態で
//      描画されること（t3/t4/t5 の是正がプレビューへ届いていることの
//      動作面の到達確認）
//
// 判定項目:
//   (a) <img src=x onerror=…> を含む POI html/desc を設定した場合、
//       当該 img タグが生成されないこと（サニタイズでイベントハンドラ除去）
//   (b) onerror などのスクリプトが実行されないこと
//   (c) POI html が iframe ではなく Shadow DOM で描画されること
//      （t5 の動作面の到達確認。旧実装は srcdoc 経由の iframe）
//   (d) viewer 本体が到達・描画されること
//
// 起動は必ず task script 経由で行うこと:
//   pnpm --filter maplat-editor run test:e2e:m1-t8
//   直接 `pnpm exec playwright test` を叩くと ensure-electron / build を
//   迂回し、依存更新前の bundle を検証してしまう（設計レビュー v1.6 Major-1）。
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
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
  // POI 画像は外部取得を避けて 1x1 PNG を返す
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

test.describe('M1-T8: preview bundle 同期後のサニタイズされた POI 描画', () => {
  test('AC5: POI の html に <img src=x onerror=…> を含めてもサニタイズされ Shadow DOM に描画される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m1-t8-sanitized-'));
    const { app, page } = await launch(e2eRoot);
    const slug = `m1-t8-poi-${Date.now()}`;
    const POI_FEATURE_ID = 'm1-t8-sanitized-target';

    try {
      // 1. POI ソース作成。html に onerror 付きの img を直接埋め込む（t4/t5 の是正対象）
      const poiUid = await page.evaluate(async ({ slug, featureId }: any) => {
        const created = await window.poiSources.createLocal({ slug, title: { ja: 'm1-t8 サニタイズ確認用' }, lang: 'ja' });
        if (!created || created.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(created)}`);
        await window.poiSources.save(created.uid, {
          slug, title: { ja: 'm1-t8 サニタイズ確認用' },
          fc: {
            type: 'FeatureCollection', lang: 'ja',
            features: [{
              type: 'Feature', id: featureId,
              geometry: { type: 'Point', coordinates: [141.35, 43.06] },
              properties: {
                _maplatUid: crypto.randomUUID(),
                name: { ja: 'm1-t8 テスト POI' },
                html: '<img src="x" onerror="window.__m1t8_onerror_fired=true" />',
                desc: '<img src="x" onerror="window.__m1t8_onerror_desc_fired=true" />',
              },
            }],
          },
        });
        return created.uid as string;
      }, { slug, featureId: POI_FEATURE_ID });

      // 2. App 作成（ビルトイン OSM。homeLng/homeLat を POI に合わせる）
      await page.evaluate(async (poiUid: string) => {
        const s = `m1-t8-app-${Date.now()}`;
        const saved = await window.appedit.save({ slug: s, document: {
          appID: s, appName: { ja: 'M1-T8 サニタイズ確認用' }, title: { ja: 'M1-T8 サニタイズ確認用' },
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

      // 4. viewer の ready を待機
      await frame.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 90000 });
      await frame.waitForFunction(() => {
        const src = (window as any).__maplatPreview?.core?.mapObject?.getSource?.('marker');
        return !!src && src.getFeatures().length >= 1;
      }, undefined, { timeout: 60000 });
      await frame.locator('.modalBase').waitFor({ state: 'hidden', timeout: 30000 });

      // 5. POI を開く（m1-t3-swiper と同じ手法で datum を取得して clickMarkers を発火）
      const dispatched = await frame.evaluate((featureId: string) => {
        const core = (window as any).__maplatPreview?.core;
        const src = core?.mapObject?.getSource?.('marker');
        const feats = src?.getFeatures?.() ?? [];
        const datumOf = (f: any) => f.get?.('datum') ?? f.getProperties?.()?.datum ?? f.getProperties?.();
        const target =
          feats.map(datumOf).find((d: any) => JSON.stringify(d ?? '').includes(featureId)) ??
          feats.map(datumOf).find((d: any) => d?.properties?.html?.includes('onerror'));
        if (!target) return { ok: false, reason: 'onerror を含む POI datum が見つかりません' };
        core.dispatchEvent({ type: 'clickMarkers', detail: [target] });
        return { ok: true };
      }, POI_FEATURE_ID);
      expect(dispatched.ok, `clickMarkers を発火できること（${dispatched.reason ?? ''}）`).toBe(true);

      // 6. (a) onerror が発火していないこと（img タグが生成されていない / サニタイズされている）
      const onerrorFired = await frame.evaluate(() => !!(window as any).__m1t8_onerror_fired);
      expect(onerrorFired, 'onerror が発火していないこと（img タグがサニタイズで除去されている）').toBe(false);

      // 6b. (b) desc の onerror も発火していないこと
      const onerrorDescFired = await frame.evaluate(() => !!(window as any).__m1t8_onerror_desc_fired);
      expect(onerrorDescFired, 'desc の onerror が発火していないこと').toBe(false);

      // 7. (c) POI html が Shadow DOM で描画されていること（iframe srcdoc ではない）
      //    t5 では POI html は Shadow DOM に描画される（旧実装は iframe srcdoc）
      const hasShadowDomPoi = await frame.evaluate(() => {
        const hosts = document.querySelectorAll('.poi_html_host');
        if (hosts.length === 0) return false;
        // Shadow DOM が open mode で存在することを確認
        return Array.from(hosts).some((h) => {
          const shadow = (h as HTMLElement).shadowRoot;
          return shadow !== null && shadow.mode === 'open';
        });
      });
      expect(hasShadowDomPoi, 'POI html が Shadow DOM（open mode）で描画されていること').toBe(true);

      // 8. (d) viewer 本体が到達・描画されていること
      await frame.waitForFunction(() => {
        const core = (window as any).__maplatPreview?.core;
        return !!(core?.mapObject);
      }, undefined, { timeout: 30000 });
    } finally {
      await quitElectronApplication(app);
    }
  });
});
