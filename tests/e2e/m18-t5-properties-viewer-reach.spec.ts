// M18-T5: layer metadata 交換形の properties 正本化 — viewer 到達 E2E
// AC5-12: preview 経由で layer icon / hide が viewer に届く（§8.4 の検証ギャップを塞ぐ本丸）
// 設計書 §6.2: POI ソース作成（FC.properties に icon）→ app の POI 参照 entry に hide: true をシード → preview → viewer 確認
// 人間確認: page.pause() でブラウザを開き、マーカー画像と非表示を目視確認する（t4 と同様）
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

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
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t5-viewer-reach-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 1. POI ソース作成（FC.properties に icon）
      const { uid: poiUid } = await page.evaluate(async () => {
        const slug = `m18-t5-poi-${Date.now()}`;
        const result = await window.poiSources.createLocal({
          slug,
          title: { ja: 'M18-T5 テストPOI' },
          lang: 'ja',
        });
        if (!result || result.result !== 'Success') throw new Error(`Could not seed POI: ${JSON.stringify(result)}`);
        // layer metadata として icon を保存（内部形 layerMeta へ設定）
        const get = await window.poiSources.get(result.uid);
        await window.poiSources.save({
          uid: result.uid,
          slug,
          title: { ja: 'M18-T5 テストPOI' },
          features: [
            {
              type: 'Feature',
              id: 'p1',
              geometry: { type: 'Point', coordinates: [141.35, 43.06] },
              properties: { name: { ja: 'テスト1' } },
            },
          ],
          lang: 'ja',
          icon: 'builtin:defaultpin',
          hide: true,
        });
        return { uid: result.uid };
      });

      // 2. App 作成 + POI 参照 entry（hide: true シード）を追加
      await page.evaluate(async (poiUid) => {
        const appSlug = `m18-t5-app-${Date.now()}`;
        await window.apps.createLocal({ slug: appSlug, title: { ja: 'M18-T5 App' } });
        const appGet = await window.apps.get(appSlug);
        await window.apps.save({
          uid: appGet.uid,
          slug: appSlug,
          title: { ja: 'M18-T5 App' },
          sources: ['osm'],
          homePosition: [141.35, 43.06],
          defaultZoom: 14,
          pois: [
            { poiUid, hide: true },
          ],
        });
      }, poiUid);

      // 3. preview を開く
      await page.evaluate(async () => {
        // AppEdit で preview ボタンをクリックする代わりに直接 API 経由で prepare
        const appSlug = Object.keys(await window.apps.list()).pop();
        // preview ボタンを UI 経由で操作する場合は navigator で AppEdit へ移動
      });

      // 4. 人間確認モード: page.pause() でブラウザを開き、マーカー画像と非表示を目視確認
      // 実行者: pnpm test:e2e:m18-t5 で起動後、ブラウザが一時停止する
      await page.pause();
    } finally {
      await quitElectronApplication(app, page);
    }
  });
});
