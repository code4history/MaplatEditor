// M18-T5: layer metadata 交換形の properties 正本化 — viewer 到達 E2E
// AC5-12: preview 経由で layer icon / hide が viewer に届く（§8.4 の検証ギャップを塞ぐ本丸）
// 設計書 §6.2 + レビュー Major-2: レイヤA（表示・icon指定）とレイヤB（hide:true）を API シード →
// preview → page.pause() で同一画面のAマーカー画像表示・B非表示を目視確認。
//
// 検証戦略:
// 1. 自動 assert: preview 配信 JSON で FC.properties.icon/hide を検証
// 2. 人間確認: page.pause() でブラウザを開き、Aのマーカー画像表示・Bの非表示を目視
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
      // 1. POI ソースA（表示・icon指定）作成
      const { poiUidA } = await page.evaluate(async () => {
        const slug = `m18-t5-poi-a-${Date.now()}`;
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
      });

      // 2. POI ソースB（hide:true）作成
      const { poiUidB } = await page.evaluate(async () => {
        const slug = `m18-t5-poi-b-${Date.now()}`;
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
      });

      // 3. App 作成: pois に A（icon上書き）と B（hide:true）を配置
      const appSlug = await page.evaluate(async ({ poiUidA, poiUidB }: { poiUidA: string; poiUidB: string }) => {
        const slug = `m18-t5-app-${Date.now()}`;
        const savedApp = await window.appedit.save({ slug, document: {
          appID: slug, appName: { ja: 'M18-T5 App' }, title: { ja: 'M18-T5 App' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources: [{ sourceType: 'tms', tileURL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 18, label: { ja: 'OSM' } }],
          homePosition: [141.35, 43.06], defaultZoom: 14,
          pois: [
            { poiUid: poiUidA, icon: 'builtin:defaultpin' },
            { poiUid: poiUidB, hide: true },
          ],
          httpSettings: {}, appSettings: {}, manifestSettings: {},
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

      // preview タブをクリック（状態ベース待機・Minor-1）
      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 30000 });

      // 5. 自動 assert: preview 配信 JSON で FC.properties.icon/hide を検証
      const previewSrc = await page.locator('iframe.preview-map').getAttribute('src');
      expect(previewSrc).toBeTruthy();
      const tokenMatch = previewSrc!.match(/\/preview\/([^/]+)\//);
      expect(tokenMatch).toBeTruthy();
      const token = tokenMatch![1];
      const appJsonUrl = previewSrc!.replace(/\/$/, '') + '/apps/' + token + '.json';

      const appJson = await page.evaluate(async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
        return await resp.json();
      }, appJsonUrl);

      // レイヤA: icon が FC.properties.icon に出力され imgs/ へ解決される
      const poisA = appJson.pois.find((p: any) => p.id && p.id.includes('poi-a'));
      // レイヤB: hide が FC.properties.hide に出力される
      const poisB = appJson.pois.find((p: any) => p.id && p.id.includes('poi-b'));
      // ※ id が slug 由来のため、find で安全に検索
      const poisWithIcon = appJson.pois.filter((p: any) => p.properties?.icon);
      const poisWithHide = appJson.pois.filter((p: any) => p.properties?.hide === true);
      expect(poisWithIcon.length).toBeGreaterThan(0);
      expect(poisWithHide.length).toBeGreaterThan(0);
      // FC トップレベルに icon/hide が出ない
      for (const p of appJson.pois) {
        expect(p.icon).toBeUndefined();
        expect(p.hide).toBeUndefined();
      }

      // 6. 人間確認: page.pause() で同一画面のAマーカー画像表示・B非表示を目視
      // 実行者: PWDEBUG=1 pnpm test:e2e:m18-t5 でブラウザが一時停止する
      await page.pause();
    } finally {
      await quitElectronApplication(app, page);
    }
  });
});
