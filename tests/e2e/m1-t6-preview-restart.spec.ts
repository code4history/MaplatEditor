// M1-T6: プレビューサーバの停止配線 E2E（設計 v1.3 §4.2）
//
// 目的は「プレビューがまた表示される」ことの確認ではない。それだけなら stopPreview() を
// 実装し忘れてサーバを常駐させても通ってしまう（設計レビュー v1.2 Major-1）。
// そこで **Playwright テストプロセス（Node 側）から実 HTTP を投げて**サーバの生死を観測する。
// Node の http.request は Host: 127.0.0.1:<port> を自動付与し Origin を送らないため、
// AppPreviewService の Host/Origin 検査を正当に通過する。
//
//   AC25 段[1] 起動      : iframe src から port / token1 を取得し viewer 到達
//        段[2] 言語切替  : token2 へ更新。旧 token1 は **404**（ECONNREFUSED ではない）
//                          = 「止めてはいけない場所で止めていない」ことの証明
//        段[3] タブ離脱  : 旧 port が **ECONNREFUSED**
//                          = stopPreview() → shutdown() が実際に呼ばれたことの証明（本 spec の中核）
//        段[4] タブ復帰  : preferred port を再取得し、新 token / viewer が到達可能
//   AC26 レンダラ直 fetch: main.ts の webSecurity:false 下で file:// / Vite dev オリジンからの
//                          fetch が Origin 検査に弾かれないこと（m18-t5:163-169 の経路の非退行）
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const OSM_TILE_FIXTURE_ROOT = path.resolve(import.meta.dirname, 'fixtures/osm-tiles');
const FAKE_TILE_PATH = path.resolve(import.meta.dirname, 'fixtures/fake-osm-tile.png');

// 開発者が実行中の Editor（既定 41781）とも smoke（45781）とも衝突しない固定ポート。
// 段[4] の「preferred port を再取得」判定はこの値との一致で行う
const PREVIEW_PORT = 45782;

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

// Node 側の実 HTTP。agent:false は必須（Node 19+ の globalAgent は keepAlive:true が既定で、
// プールされた socket を再利用すると停止判定が ECONNREFUSED ではなく ECONNRESET になる）
function probe(port: number, urlPath: string): Promise<number | string> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET', agent: false, timeout: 5000 },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e: NodeJS.ErrnoException) => resolve(`ERR:${e.code || e.message}`));
    req.end();
  });
}

// 段[3]は単発判定にしない。watch(activeTab) の await stopPreview() は IPC 往復を挟むため
// クリック直後は未完了であり得る。未配線ならここがタイムアウトして FAIL する（= RED の根拠）
async function waitForRefused(port: number, urlPath: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: number | string = '(未実行)';
  while (Date.now() < deadline) {
    last = await probe(port, urlPath);
    if (last === 'ERR:ECONNREFUSED') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `プレビューサーバが停止していない（${timeoutMs}ms 待機。最後の応答: ${last}）。` +
    'AppEdit.vue の watch(activeTab) の else 枝から stopPreview() が呼ばれていない可能性が高い',
  );
}

async function previewFrame(page: Page): Promise<Frame> {
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 30000 });
  const handle = await page.locator('iframe.preview-map').elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('preview iframe の contentFrame を取得できません');
  return frame;
}

async function previewSrc(page: Page): Promise<{ src: string; port: number; token: string }> {
  const src = (await page.locator('iframe.preview-map').getAttribute('src'))!;
  return { src, port: Number(new URL(src).port), token: src.match(/\/preview\/([^/]+)\//)![1] };
}

async function openPreviewTab(page: Page): Promise<void> {
  await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
}

test.describe('M1-T6 プレビューサーバの停止ライフサイクル', () => {
  test('AC25/AC26: 停止配線が実際に働き、言語切替では停止しない', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m1-t6-preview-restart-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // ---- seed: ビルトイン OSM ソース1件だけのアプリ（sources が空だと renderPreview が中断する） ----
      await page.evaluate(async (previewPort: number) => {
        const slug = `m1-t6-app-${Date.now()}`;
        const saved = await window.appedit.save({ slug, document: {
          appID: slug, appName: { ja: 'M1-T6 App' }, title: { ja: 'M1-T6 App' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources: ['osm'],
          appSettings: { homeLng: 141.35, homeLat: 43.06, defaultZoom: 14 },
          pois: [],
          httpSettings: { previewPort }, manifestSettings: {},
        } });
        if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
      }, PREVIEW_PORT);

      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15000 });
      await page.locator('[data-resource-uid] a').first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15000 });

      // ================= 段[1] 起動 =================
      await openPreviewTab(page);
      const frame1 = await previewFrame(page);
      await frame1.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 90000 });
      const s1 = await previewSrc(page);
      expect(s1.port, 'preferred port で listen していない').toBe(PREVIEW_PORT);
      expect(await probe(s1.port, `/preview/${s1.token}/`), '段[1]: 起動直後の token が 200 にならない').toBe(200);

      // ---- AC26: レンダラ本体からの直 fetch（webSecurity:false 下の実在経路）----
      // Origin をポート一致で縛ると file:// の Origin: null / Vite dev の localhost:<vite> が
      // 弾かれ、m18-t5:163-169 が 403 で落ちる。その回帰をここで検出する
      const appJsonStatus = await page.evaluate(async (url: string) => {
        const resp = await fetch(url);
        return resp.status;
      }, `${s1.src.replace(/\/$/, '')}/apps/${s1.token}.json`);
      expect(appJsonStatus, 'AC26: レンダラ直 fetch が Origin 検査で弾かれている').toBe(200);

      // ================= 段[2] 言語切替（停止しない契約）=================
      const langValues = await page.locator('#previewLang option').evaluateAll(
        (opts) => opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''),
      );
      expect(langValues.length, 'プレビュー言語の選択肢が無い').toBeGreaterThan(0);
      await page.selectOption('#previewLang', langValues[0]);
      // renderPreview の完了を iframe src の変化で待つ（token が入れ替わるまで）
      await expect
        .poll(async () => (await page.locator('iframe.preview-map').getAttribute('src')) ?? '', { timeout: 90000 })
        .not.toContain(s1.token);
      const s2 = await previewSrc(page);
      expect(s2.port, '段[2]: 言語切替でポートが変わった').toBe(PREVIEW_PORT);
      expect(s2.token, '段[2]: 言語切替で token が更新されていない').not.toBe(s1.token);
      expect(await probe(s2.port, `/preview/${s2.token}/`), '段[2]: 新 token が 200 にならない').toBe(200);
      // ★ 404 であって ECONNREFUSED ではないこと。destroyPreview() から誤って停止すると
      //   ここが ECONNREFUSED になり FAIL する（「止めてはいけない場所で止めていない」の証明）
      expect(
        await probe(s2.port, `/preview/${s1.token}/`),
        '段[2]: 言語切替でサーバごと止まっている（destroyPreview から停止していないか）',
      ).toBe(404);

      // ================= 段[3] タブ離脱（停止配線の実証・本 spec の中核）=================
      await page.locator('[role="tab"]').filter({ hasText: /メタデータ編集/ }).click();
      await waitForRefused(PREVIEW_PORT, `/preview/${s2.token}/`);

      // ================= 段[4] タブ復帰 =================
      await openPreviewTab(page);
      const frame4 = await previewFrame(page);
      await frame4.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 90000 });
      const s4 = await previewSrc(page);
      expect(s4.port, '段[4]: preferred port を再取得できていない（漂流した）').toBe(PREVIEW_PORT);
      expect(s4.token, '段[4]: token が使い回されている').not.toBe(s1.token);
      expect(s4.token, '段[4]: token が使い回されている').not.toBe(s2.token);
      expect(await probe(s4.port, `/preview/${s4.token}/`), '段[4]: 復帰後の token が 200 にならない').toBe(200);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
