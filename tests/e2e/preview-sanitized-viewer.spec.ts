// preview viewer bundle 同期後のサニタイズされた POI 描画の E2E 検証
//
// 実プレビューで viewer が動作し、POI の HTML が無害化された状態で
//      描画されること（POI の HTML の無害化の是正がプレビューへ届いていることの
//      動作面の到達確認）
//
// 判定項目:
//   (a) <img src=x onerror=…> を含む POI html/desc を設定した場合、
//       当該 img タグが生成されないこと（サニタイズでイベントハンドラ除去）
//   (b) onerror などのスクリプトが実行されないこと
//   (c) POI html が iframe ではなく Shadow DOM で描画されること
//      （新しい viewer の動作面の到達確認。旧実装は srcdoc 経由の iframe）
//      @maplat/ui 1.3 では、POI の窓（<maplat-ui> の Shadow DOM の中の part="poi-body"）の中に
//      part="poi-html" の入れ物があり、その入れ子の Shadow DOM（open）に無害化した html が入る
//      （1.2 までは文書の直下の .poi_html_host だった）
//   (d) viewer 本体が到達・描画されること
//
// 起動は必ず task script 経由で行うこと:
//   pnpm --filter maplat-editor run test:e2e:preview-sanitized-viewer
//   直接 `pnpm exec playwright test` を叩くと ensure-electron / build を
//   迂回し、依存更新前の bundle を検証してしまう。
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { VIEWER_HOST, viewerPart, waitViewerSplashHidden } from './helpers/viewerDom';

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
  // 外部 OSM タイルはローカル fixture へ差し替える（properties-viewer-reach と同じ。実行時ネットワーク非依存）
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

test.describe('preview bundle 同期後のサニタイズされた POI 描画', () => {
  test('POI の html に <img src=x onerror=…> を含めてもサニタイズされ Shadow DOM に描画される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-preview-sanitized-viewer-sanitized-'));
    const { app, page } = await launch(e2eRoot);
    const slug = `preview-sanitized-viewer-poi-${Date.now()}`;
    const POI_FEATURE_ID = 'preview-sanitized-viewer-sanitized-target';

    try {
      // 1. POI ソース作成。html に onerror 付きの img を直接埋め込む（無害化の是正の対象）
      const poiUid = await page.evaluate(async ({ slug, featureId }: any) => {
        const created = await window.poiSources.createLocal({ slug, title: { ja: 'サニタイズ確認用' }, lang: 'ja' });
        if (!created || created.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(created)}`);
        await window.poiSources.save(created.uid, {
          slug, title: { ja: 'サニタイズ確認用' },
          fc: {
            type: 'FeatureCollection', lang: 'ja',
            features: [{
              type: 'Feature', id: featureId,
              geometry: { type: 'Point', coordinates: [141.35, 43.06] },
              properties: {
                _maplatUid: crypto.randomUUID(),
                name: { ja: 'テスト POI' },
                html: '<img src="x" onerror="window.__fx_onerror_fired=true" />',
                desc: '<img src="x" onerror="window.__fx_onerror_desc_fired=true" />',
              },
            }],
          },
        });
        return created.uid as string;
      }, { slug, featureId: POI_FEATURE_ID });

      // 2. App 作成（ビルトイン OSM。homeLng/homeLat を POI に合わせる）
      await page.evaluate(async (poiUid: string) => {
        const s = `preview-sanitized-viewer-app-${Date.now()}`;
        const saved = await window.appedit.save({ slug: s, document: {
          appID: s, appName: { ja: 'サニタイズ確認用' }, title: { ja: 'サニタイズ確認用' },
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
      await waitViewerSplashHidden(frame);

      // 5. POI を開く（swiper-viewer-reach と同じ手法で datum を取得して clickMarkers を発火）
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

      // 5b. POI の窓が開き、html の入れ物が描かれるまで待つ（描かれる前に 6 を見ると、何も確かめずに通る）
      const poiHtmlHost = viewerPart(frame, 'poi-body').locator('[part~="poi-html"]');
      await expect(viewerPart(frame, 'poi-modal'), 'POI の窓が開くこと').toBeVisible({ timeout: 30000 });
      await expect(poiHtmlHost, 'POI の html の入れ物が描かれること').toHaveCount(1, { timeout: 30000 });
      // 壊れた画像の error は描いた後の拍で来るので、描画の反映を rAF 2 回分待ってから発火の有無を見る
      await frame.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
      }));
      await page.waitForTimeout(500);

      // 6. (a) onerror が発火していないこと（img タグが生成されていない / サニタイズされている）
      const onerrorFired = await frame.evaluate(() => !!(window as any).__fx_onerror_fired);
      expect(onerrorFired, 'onerror が発火していないこと（img タグがサニタイズで除去されている）').toBe(false);

      // 6b. (b) desc の onerror も発火していないこと
      const onerrorDescFired = await frame.evaluate(() => !!(window as any).__fx_onerror_desc_fired);
      expect(onerrorDescFired, 'desc の onerror が発火していないこと').toBe(false);

      // 7. (c) POI html が Shadow DOM で描画されていること（iframe srcdoc ではない）
      //    新しい viewer では POI html は Shadow DOM に描画される（旧実装は iframe srcdoc）
      const poiHtml = await frame.evaluate((host: string) => {
        const body = document.querySelector(host)?.shadowRoot?.querySelector('[part~="poi-body"]');
        if (!body) return { found: false as const };
        const hosts = Array.from(body.querySelectorAll('[part~="poi-html"]'));
        const shadows = hosts.map((h) => (h as HTMLElement).shadowRoot);
        const inner = shadows.flatMap((s) => (s ? Array.from(s.querySelectorAll('*')) : []));
        return {
          found: true as const,
          hosts: hosts.length,
          // Shadow DOM が open mode で存在することを確認
          openShadows: shadows.filter((s) => s !== null && s.mode === 'open').length,
          // 入れ子の Shadow DOM の中に、イベント属性の付いた要素が残っていないこと
          handlerAttrs: inner.flatMap((el) => el.getAttributeNames().filter((n) => n.toLowerCase().startsWith('on'))),
          scripts: inner.filter((el) => el.tagName === 'SCRIPT').length,
          // 旧実装の iframe（srcdoc）で描いていないこと
          iframes: body.querySelectorAll('iframe').length,
        };
      }, VIEWER_HOST);
      expect(poiHtml.found, 'POI の窓の本文（part="poi-body"）があること').toBe(true);
      if (!poiHtml.found) throw new Error('unreachable');
      expect(poiHtml.hosts, 'POI html の入れ物（part="poi-html"）が 1 つあること').toBe(1);
      expect(poiHtml.openShadows, 'POI html が Shadow DOM（open mode）で描画されていること').toBe(1);
      expect(poiHtml.handlerAttrs, 'POI html の中にイベント属性が残っていないこと').toEqual([]);
      expect(poiHtml.scripts, 'POI html の中に script が残っていないこと').toBe(0);
      expect(poiHtml.iframes, 'POI html を iframe で描いていないこと').toBe(0);

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
