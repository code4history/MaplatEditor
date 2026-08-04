// M5-T9 AC8: 実 UI の「ローカル複製」が動く。
//
// 固定する受け入れ条件:
//   AC8 remote ソースを複製すると <slug>-local の新ソースが作られ、その編集画面へ遷移する
//
// 【なぜ E2E が要るか】
// マイルストーン設計 v1.13 は「既存の clone E2E が回帰になる」として E2E 不要としていたが、
// **その E2E は実在しなかった**（タスク設計 §2.3）。`cloneToLocal` を叩く smoke は4本あるが、
// いずれも slug を明示指定して service を直接呼び、**候補生成を通らない**。
// 採番が view の中にあったため service 層から到達できず、off-by-one が長く残った。
// ∴ view → composable → IPC → service → DB を貫通する経路を1本張る。
//
// remote ソースの用意は m9-t3 smoke で確立済みの手法（使い捨てローカル HTTP サーバで
// fixture GeoJSON を配信）に揃える。clone ボタンは readOnly（mode='remote'）でのみ出る。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const REMOTE_FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'spot',
      geometry: { type: 'Point', coordinates: [141.35, 43.06] },
      properties: { name: 'T9 スポット' },
    },
  ],
});

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

/** fixture GeoJSON を配信する使い捨てサーバ（m9-t3 smoke と同じ手法） */
async function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(REMOTE_FC);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}/pois.geojson` };
}

test.describe('M5-T9: 実 UI からのローカル複製（AC8）', () => {
  test('AC8: remote ソースを複製すると <slug>-local が作られ、その編集画面へ遷移する', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t9-clone-'));
    const { server, url } = await startFixtureServer();
    const { app, page } = await launch(e2eRoot);
    try {
      // remote ソースを登録する（clone ボタンは readOnly のときだけ出る）
      const slug = `t9-remote-${Date.now()}`;
      const registered = await page.evaluate(
        async ({ s, u }) => {
          const r = await window.poiSources.registerRemote({
            slug: s, title: { ja: 'T9 リモート' }, url: u, lang: 'ja',
          });
          if (!r || r.result !== 'Success') throw new Error(`registerRemote: ${JSON.stringify(r)}`);
          return { uid: r.uid as string };
        },
        { s: slug, u: url },
      );

      await page.evaluate((uid) => { location.hash = `#/poisources/${uid}`; }, registered.uid);
      await page.waitForLoadState('domcontentloaded');

      // readOnly の編集画面には複製ボタンが出る
      const cloneButton = page.locator('[data-editor-action="clone"]');
      await expect(cloneButton).toBeVisible({ timeout: 30000 });

      await cloneButton.click();

      // 新 uid の編集画面へ遷移する（router.push('/poisources/<新uid>')）
      await expect
        .poll(() => page.evaluate(() => location.hash), { timeout: 60000 })
        .not.toBe(`#/poisources/${registered.uid}`);
      const clonedUid = await page.evaluate(
        () => location.hash.replace('#/poisources/', ''));
      expect(clonedUid).toBeTruthy();
      expect(clonedUid).not.toBe(registered.uid);

      // 複製先の slug が <元slug>-local であること（採番の実経路を通っている証拠）
      const cloned = await page.evaluate(
        (uid) => window.poiSources.get(uid), clonedUid);
      expect(cloned.slug).toBe(`${slug}-local`);
      expect(cloned.mode).toBe('local');
      // 元ソースは残る（複製であって移動ではない）
      const origin = await page.evaluate(
        (uid) => window.poiSources.get(uid), registered.uid);
      expect(origin.slug).toBe(slug);
      expect(origin.mode).toBe('remote');

      // 2回目の複製は base-local2 へ回る（連番が実 UI 経路でも効く）
      await page.evaluate((uid) => { location.hash = `#/poisources/${uid}`; }, registered.uid);
      await expect(cloneButton).toBeVisible({ timeout: 30000 });
      await cloneButton.click();
      await expect
        .poll(() => page.evaluate(() => location.hash), { timeout: 60000 })
        .not.toBe(`#/poisources/${registered.uid}`);
      const second = await page.evaluate(async () => {
        const uid = location.hash.replace('#/poisources/', '');
        return window.poiSources.get(uid);
      });
      expect(second.slug).toBe(`${slug}-local2`);

      console.log(`  AC8: PASS（複製 → ${slug}-local → 2回目 ${slug}-local2）`);
    } finally {
      await quitElectronApplication(app);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
