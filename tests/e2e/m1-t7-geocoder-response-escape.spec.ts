// m1-t7: ジオコーダ応答（Nominatim の display_name）が innerHTML へ生で流れる欠陥の回帰 E2E。
// 設計 `docs/superpowers/specs/2026-08-01-m1-t7-geocoder-escape-and-path-containment-design.md` v1.0 §7。
//
//   AC1: display_name に HTML（<img src=x onerror=…>）が含まれても要素として解釈されず、
//        テキストとして表示される
//   AC2: 通常の display_name は従来どおり表示され、結果クリックで addresschosen 経路
//        （ビュー fit）が動く（非退行）
//
// 応答は page.route で差し替える。src/libs/ol-geocoder/helpers/ajax.js の json() は
// jsonp 指定が無ければ fetch を使い、providers/osm.js は callbackName を返さないため
// OSM プロバイダは常に fetch 経路である（＝ route で捕捉できる）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 攻撃ペイロード: 実行されれば window.__m1t7Xss が立つ
const XSS_PAYLOAD = '<img src=x onerror="window.__m1t7Xss=1">Tokyo Station';
const BENIGN_NAME = '東京駅, 丸の内, 千代田区, 東京都, 日本';

const LON = 139.7671;
const LAT = 35.6812;

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

// Nominatim 応答を差し替える。実際に route が発火したかを数えて返す
// （差し替えに失敗したまま「結果が出ないので素通り」になることを防ぐ）
async function stubNominatim(page: Page, displayName: string): Promise<{ hits: () => number }> {
  let hits = 0;
  await page.route('**://nominatim.openstreetmap.org/**', async (route) => {
    hits += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          lon: String(LON),
          lat: String(LAT),
          boundingbox: [String(LAT - 0.01), String(LAT + 0.01), String(LON - 0.01), String(LON + 0.01)],
          display_name: displayName,
          address: {
            road: '', house_number: '', postcode: '100-0005',
            city: '千代田区', state: '東京都', country: '日本',
          },
        },
      ]),
    });
  });
  return { hits: () => hits };
}

async function createMapWithGcps(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m1-t7-map-${Date.now()}`;
    const mapObject = {
      mapID: slug,
      title: { ja: 'ジオコーダエスケープ検証地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: {}, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      gcps: [
        [[0, 300], [15551351.4, 4249117.8]],
        [[400, 300], [15562483.3, 4249117.8]],
        [[400, 0], [15562483.3, 4259837.2]],
        [[0, 0], [15551351.4, 4259837.2]],
      ],
      edges: [], sub_maps: [],
      strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    const r = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r || r.result !== 'Success') throw new Error(`Map seed failed: ${JSON.stringify(r)}`);
    return r.uid;
  });
}

// MapEdit の GCP タブを開き、mercMap 側のジオコーダを操作できる状態にする
async function openGeocoder(page: Page, uid: string): Promise<void> {
  await page.evaluate((nextUid) => { location.hash = `#/mapedit?uid=${nextUid}`; }, uid);
  await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    (window as any).testDebug.mapData.value.url_ =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  });
  await page.locator('[data-testid="map-tab-gcps"]').click();
  await expect(page.locator('#mercMap canvas')).toBeVisible({ timeout: 20_000 });

  // glass タイプのコントロールは折りたたまれている場合がある。実利用者と同じくボタンで開く
  const input = page.locator('#mercMap #gcd-input-query');
  if (!(await input.isVisible())) {
    await page.locator('#mercMap .gcd-gl-btn').click();
  }
  await expect(input).toBeVisible({ timeout: 10_000 });
}

async function search(page: Page, query: string): Promise<void> {
  const input = page.locator('#mercMap #gcd-input-query');
  await input.fill(query);
  await input.press('Enter');
}

const resultItems = (page: Page) => page.locator('#mercMap .gcd-gl-result li');

test.describe('m1-t7 ジオコーダ応答のエスケープ', () => {
  test('AC1: display_name の HTML は要素として解釈されずテキストとして表示される', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m1-t7-xss-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const stub = await stubNominatim(page, XSS_PAYLOAD);
      const uid = await createMapWithGcps(page);
      await openGeocoder(page, uid);

      await search(page, 'tokyo');
      await expect(resultItems(page)).toHaveCount(1, { timeout: 30_000 });
      expect(stub.hits(), '応答の差し替えが実際に発火していること').toBeGreaterThan(0);

      // (a) 応答由来の値から要素が生成されていないこと
      await expect(
        page.locator('#mercMap .gcd-gl-result li img'),
        'AC1: 応答由来の値から img 要素が生成されてはならない',
      ).toHaveCount(0);

      // (b) onerror が発火していないこと（生成されなければ発火しようがないが、直接確認する）
      const xssFlag = await page.evaluate(() => (window as any).__m1t7Xss ?? null);
      expect(xssFlag, 'AC1: 応答由来のスクリプトが実行されてはならない').toBeNull();

      // (c) テキストとしてはそのまま表示されること（黙って握り潰していない）
      const text = await resultItems(page).first().innerText();
      expect(text, 'AC1: ペイロードはリテラルなテキストとして表示される').toContain('<img src=x onerror=');
      expect(text).toContain('Tokyo Station');

      console.log('  AC1 (response escape): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC2: 通常の display_name は表示され、結果クリックでビューが移動する（非退行）', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m1-t7-benign-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const stub = await stubNominatim(page, BENIGN_NAME);
      const uid = await createMapWithGcps(page);
      await openGeocoder(page, uid);

      const centerBefore = await page.evaluate(
        () => (window as any).testDebug.mercMapInfo().map.getView().getCenter(),
      );

      await search(page, 'tokyo');
      await expect(resultItems(page)).toHaveCount(1, { timeout: 30_000 });
      expect(stub.hits(), '応答の差し替えが実際に発火していること').toBeGreaterThan(0);

      const text = await resultItems(page).first().innerText();
      expect(text, 'AC2: 通常の住所文字列がそのまま表示される').toContain('東京駅');

      // クリック → chosen() → ビュー fit（preventDefault:false の既定経路）
      await resultItems(page).first().click();

      // EPSG:3857 → 経度（x / 半周長 * 180）。テスト側の期待値算出であり実装の再現ではない
      await expect
        .poll(
          async () => {
            const center = await page.evaluate(
              () => (window as any).testDebug.mercMapInfo().map.getView().getCenter(),
            );
            return (center[0] / 20037508.342789244) * 180;
          },
          { timeout: 30_000 },
        )
        .toBeCloseTo(LON, 1);

      const centerAfter = await page.evaluate(
        () => (window as any).testDebug.mercMapInfo().map.getView().getCenter(),
      );
      expect(centerAfter[0], 'AC2: 結果選択でビューが動いていること').not.toBe(centerBefore[0]);

      // keepOpen:false のため結果リストは閉じる（chosen() が最後まで走った証跡）
      await expect(resultItems(page)).toHaveCount(0, { timeout: 10_000 });

      console.log('  AC2 (benign non-regression): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
