// M18-T5: layer metadata 交換形の properties 正本化 — viewer 到達 E2E
// AC5-12: preview 経由で layer icon / hide が viewer に届く（§8.4 の検証ギャップを塞ぐ本丸）
// 設計書 §6.2: POI ソース作成（icon 設定）→ app の POI 参照 entry に hide: true をシード → preview → 配信 JSON を assert
//
// 検証戦略: preview が配信する app JSON の pois 配列を fetch し、FC.properties.icon と
// FC.properties.hide が正しく出力されていることを自動 assert する。
// viewer の描画（OL marker）は t4（MaplatCore e2e）で検証済みのため、t5 では
// 「Editor が正しい JSON を出力するか」を検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

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
  return { app, page };
}

test.describe('M18-T5: properties 正本化 — viewer 到達', () => {
  test('AC5-12: preview 経由で layer icon / hide が viewer に届く', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t5-viewer-reach-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 1. POI ソース作成（layerMeta に icon を設定）
      const { poiUid } = await page.evaluate(async () => {
        const slug = `m18-t5-poi-${Date.now()}`;
        const result = await window.poiSources.createLocal({ slug, title: { ja: 'M18-T5 POI' }, lang: 'ja' });
        if (!result || result.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(result)}`);
        const poiSave = await window.poiSources.save(result.uid, {
          slug,
          title: { ja: 'M18-T5 POI' },
          fc: {
            type: 'FeatureCollection', lang: 'ja', icon: 'builtin:defaultpin',
            features: [{
              type: 'Feature', id: 'p1',
              geometry: { type: 'Point', coordinates: [141.35, 43.06] },
              properties: { _maplatUid: crypto.randomUUID(), name: { ja: 'テスト1' } },
            }],
          },
        });
        if (!poiSave || poiSave.result !== 'Success') throw new Error(`poi save failed: ${JSON.stringify(poiSave)}`);
        return { poiUid: result.uid };
      });

      // 2. App 作成 + POI 参照 entry（hide: true シード）
      const appSlug = await page.evaluate(async (poiUid: string) => {
        const slug = `m18-t5-app-${Date.now()}`;
        const savedApp = await window.appedit.save({ slug, document: {
          appID: slug, appName: { ja: 'M18-T5 App' }, title: { ja: 'M18-T5 App' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources: [{ sourceType: 'tms', tileURL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 18, label: { ja: 'OSM' } }],
          homePosition: [141.35, 43.06], defaultZoom: 14,
          pois: [{ poiUid, hide: true }],
          httpSettings: {}, appSettings: {}, manifestSettings: {},
        } });
        if (!savedApp || savedApp.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(savedApp)}`);
        return slug;
      }, poiUid);

      // 3. AppEdit へ遷移して preview タブを開く
      await openHash(page, '#/applist');
      await page.waitForTimeout(500);
      // アプリカードをクリックして AppEdit へ
      const appCard = page.locator(`[data-resource-uid] a`).first();
      await appCard.click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });

      // preview タブをクリック（EditorTabs の role="tab"）
      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      await page.waitForTimeout(2000);

      // 4. preview iframe が表示されるまで待つ
      const iframe = page.locator('iframe.preview-map');
      await expect(iframe).toBeVisible({ timeout: 30000 });

      // 5. preview URL から app JSON を fetch
      const previewSrc = await iframe.getAttribute('src');
      expect(previewSrc).toBeTruthy();
      // preview URL は http://127.0.0.1:{port}/preview/{token}/ 形式
      // app JSON は http://127.0.0.1:{port}/preview/{token}/apps/{token}.json で配信される
      const tokenMatch = previewSrc!.match(/\/preview\/([^/]+)\//);
      expect(tokenMatch).toBeTruthy();
      const token = tokenMatch![1];
      const appJsonUrl = previewSrc!.replace(/\/$/, '') + '/apps/' + token + '.json';

      const appJson = await page.evaluate(async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
        return await resp.json();
      }, appJsonUrl);

      // 6. AC5-12: layer icon が FC.properties.icon に出力されている
      expect(appJson.pois).toBeDefined();
      expect(appJson.pois.length).toBeGreaterThan(0);
      const pois0 = appJson.pois[0];
      expect(pois0.type).toBe('FeatureCollection');
      expect(pois0.properties).toBeDefined();
      expect(pois0.properties.icon).toBeDefined();
      expect(String(pois0.properties.icon)).toContain('imgs/');

      // 7. AC5-12: hide が FC.properties.hide に出力されている
      expect(pois0.properties.hide).toBe(true);

      // 8. FC トップレベルに icon/hide が出ない
      expect(pois0.icon).toBeUndefined();
      expect(pois0.hide).toBeUndefined();
    } finally {
      await quitElectronApplication(app, page);
    }
  });
});
