// M12-T1: 対応線上への対応点作成（addMarkerOnEdge 移植）E2E。
// AC4（両 menu 表示）/ AC5（illst 側からの GCP 追加・edge 二分割・内部 node 保持）/
// AC6（mercator 側からも同契約）/ AC7（dirty + Undo/Redo）/ AC8（保存・再読込で保持）/
// AC9（衝突で mutation なし）/ AC10（既存の対応線削除が退行しない）を検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}
async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

// GCP3点（三角形）+ edge [0,1] 付きの地図を compiled tin 付きで seed する（t11 型）。
// 右クリック対象の edge は画像境界の内側に置く（illstMap の beforeopen は
// 画像 bounds 外の contextmenu を抑制するため、境界上の edge では menu が出ない）
async function seedMapWithEdge(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `m12-t1-map-${Date.now()}`;
    // t11 の角座標から線形補間で内側 GCP を作る（x: 0-400 → 15551351.4-15562483.3、
    // y: 300-0 → 4249117.8-4259837.2）
    const toMerc = (x: number, y: number): number[] => [
      15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
      4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
    ];
    const mapObject = {
      mapID: slug,
      title: { ja: 'M12-T1 対応線テスト地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'M12-T1 attribution' }, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      gcps: [
        [[50, 250], toMerc(50, 250)],
        [[350, 250], toMerc(350, 250)],
        [[350, 50], toMerc(350, 50)],
      ],
      edges: [[[], [], [0, 1]]],
      sub_maps: [],
      strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    const r1 = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`Map seed failed: ${JSON.stringify(r1)}`);
    const tinResult = await window.mapedit.updateTin(
      mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
      mapObject.strictMode, mapObject.vertexMode,
    );
    if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
      throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
    }
    const r2 = await window.mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tinResult[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`Compiled map save failed: ${JSON.stringify(r2)}`);
    return { uid: r2.uid, slug };
  });
}

// 地図上の xy 座標（illst 画像座標）を page 座標へ変換して右クリックする
async function rightClickOnIllstMap(page: Page, xy: [number, number]): Promise<void> {
  const point = await page.evaluate((target) => {
    const info = (window as any).testDebug.illstMapInfo();
    const pixel = info.map.getPixelFromCoordinate(info.source.xy2SysCoord(target));
    const rect = document.getElementById('illstMap')!.getBoundingClientRect();
    return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
  }, xy);
  await page.mouse.click(point.x, point.y, { button: 'right' });
}

// GCPタブを有効化するため url_ を page 側で設定する（backend の load 経路は url_ を
// json.url / tile thumbnail から再導出するため、seed 時の url_ は保持されない。t11 と同型）
async function forceGcpsTabReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).testDebug.mapData.value.url_ =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  });
  // mount 時点では url_ 未設定のため loadMapTiles が走っていない。明示的に起動して illstSource を初期化する
  await page.evaluate(() => (window as any).testDebug.loadMapTiles());
  await page.waitForFunction(() => !!(window as any).testDebug.illstMapInfo().source, undefined, { timeout: 60000 });
}

// context menu（ol-contextmenu）の表示項目テキストを取得する
async function contextMenuTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.ol-ctx-menu-container li')).map((el) => (el as HTMLElement).innerText.trim()),
  );
}

async function debugState(page: Page): Promise<{ gcpCount: number; edges: any[] }> {
  return page.evaluate(() => ({
    gcpCount: (window as any).testDebug.gcps.value.length,
    edges: JSON.parse(JSON.stringify((window as any).testDebug.edges.value)),
  }));
}

test.describe('M12-T1 edge split (addMarkerOnEdge)', () => {
  test('AC4+AC5+AC7+AC8+AC10: illst 側から対応点作成・edge 分割・Undo/Redo・保存保持・既存削除の退行なし', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t1-illst-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      const seeded = await seedMapWithEdge(page);
      await openHash(page, `#/mapedit?uid=${seeded.uid}`);
      await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
      await forceGcpsTabReady(page);
      await page.getByTestId('map-tab-gcps').click();
      await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 20000 });
      // エッジ描画とビュー確定を待つ（edge feature が hit 判定できる状態）
      await expect.poll(async () => (await debugState(page)).edges.length, { timeout: 15000 }).toBe(1);

      // AC4: edge 中点 [200,300] を右クリック → 対応線削除 + 対応線上にマーカー追加 の両 menu
      await rightClickOnIllstMap(page, [200, 250]);
      await expect.poll(async () => (await contextMenuTexts(page)).join('|'), { timeout: 10000 })
        .toContain('対応線上にマーカー追加');
      const texts = await contextMenuTexts(page);
      expect(texts.some((text) => text.includes('対応線削除'))).toBe(true);
      expect(texts.some((text) => text.includes('対応線上にマーカー追加'))).toBe(true);

      // AC5: 対応線上にマーカー追加 → GCP 追加・edge 二分割
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.ol-ctx-menu-container li')) as HTMLElement[];
        items.find((el) => el.innerText.includes('対応線上にマーカー追加'))?.click();
      });
      await expect.poll(async () => (await debugState(page)).gcpCount, { timeout: 10000 }).toBe(4);
      let state = await debugState(page);
      expect(state.edges.length).toBe(2);
      // 新 GCP は edge 中点 [200,300]（illst xy、丸め2桁）と mercator 側補間値
      const newGcp = await page.evaluate(() =>
        JSON.parse(JSON.stringify((window as any).testDebug.gcps.value[3])));
      expect(Math.abs(newGcp[0][0] - 200)).toBeLessThan(1.5);
      expect(Math.abs(newGcp[0][1] - 250)).toBeLessThan(1.5);
      // 分割 edge の startEnd 契約: [0,3] と [3,1]（内部 node 保持 = 空 node 列のまま分配）
      const startEnds = state.edges.map((edge: any) => edge[2]);
      expect(startEnds).toContainEqual([0, 3]);
      expect(startEnds).toContainEqual([3, 1]);
      // layer 付きの3要素契約
      expect(newGcp.length).toBe(3);
      expect(newGcp[2]).toBe(0);

      // AC7: dirty → Undo で完全復元 → Redo で再適用
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      await page.keyboard.press('Meta+z');
      await expect.poll(async () => (await debugState(page)).gcpCount, { timeout: 10000 }).toBe(3);
      await expect.poll(async () => (await debugState(page)).edges.length, { timeout: 10000 }).toBe(1);
      await page.keyboard.press('Meta+Shift+z');
      await expect.poll(async () => (await debugState(page)).gcpCount, { timeout: 10000 }).toBe(4);
      await expect.poll(async () => (await debugState(page)).edges.length, { timeout: 10000 }).toBe(2);

      // AC8: 保存 → 再読込で新 GCP と分割 edge が保持される
      await page.getByTestId('editor-save').click();
      await expect.poll(async () =>
        page.evaluate(() => (window as any).testDebug.mapData.value.status), { timeout: 20000 }).toBe('Update');
      await page.reload();
      await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
      await forceGcpsTabReady(page);
      await page.getByTestId('map-tab-gcps').click();
      await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 20000 });
      await expect.poll(async () => (await debugState(page)).gcpCount, { timeout: 15000 }).toBe(4);
      state = await debugState(page);
      expect(state.edges.length).toBe(2);

      // AC10: 既存の対応線削除が退行しない（分割後の edge [0,3] を右クリック → 対応線削除）
      await rightClickOnIllstMap(page, [125, 250]);
      await expect.poll(async () => (await contextMenuTexts(page)).join('|'), { timeout: 10000 })
        .toContain('対応線削除');
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.ol-ctx-menu-container li')) as HTMLElement[];
        items.find((el) => el.innerText.includes('対応線削除'))?.click();
      });
      await expect.poll(async () => (await debugState(page)).edges.length, { timeout: 10000 }).toBe(1);

      console.log('  AC4+AC5+AC7+AC8+AC10 (illst): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC6: mercator 側からも同じ契約で対応点作成ができる', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t1-merc-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      const seeded = await seedMapWithEdge(page);
      await openHash(page, `#/mapedit?uid=${seeded.uid}`);
      await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
      await forceGcpsTabReady(page);
      await page.getByTestId('map-tab-gcps').click();
      await expect(page.locator('#mercMap canvas')).toBeVisible({ timeout: 20000 });
      await expect.poll(async () => (await debugState(page)).edges.length, { timeout: 15000 }).toBe(1);

      // mercator 側 edge 中点を右クリック（merc 座標の中点を OL の getPixelFromCoordinate で page 座標化）
      const point = await page.evaluate(() => {
        const gcps = (window as any).testDebug.gcps.value;
        const mid: [number, number] = [(gcps[0][1][0] + gcps[1][1][0]) / 2, (gcps[0][1][1] + gcps[1][1][1]) / 2];
        const info = (window as any).testDebug.mercMapInfo();
        const pixel = info.map.getPixelFromCoordinate(mid);
        const rect = document.getElementById('mercMap')!.getBoundingClientRect();
        return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
      });
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await expect.poll(async () => (await contextMenuTexts(page)).join('|'), { timeout: 10000 })
        .toContain('対応線上にマーカー追加');
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.ol-ctx-menu-container li')) as HTMLElement[];
        items.find((el) => el.innerText.includes('対応線上にマーカー追加'))?.click();
      });
      await expect.poll(async () => (await debugState(page)).gcpCount, { timeout: 10000 }).toBe(4);
      const state = await debugState(page);
      expect(state.edges.length).toBe(2);
      const startEnds = state.edges.map((edge: any) => edge[2]);
      expect(startEnds).toContainEqual([0, 3]);
      expect(startEnds).toContainEqual([3, 1]);

      console.log('  AC6 (mercator): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC9: 座標丸め衝突・edge 未検出では mutation せず診断のみ', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t1-collision-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      const seeded = await seedMapWithEdge(page);
      await openHash(page, `#/mapedit?uid=${seeded.uid}`);
      await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
      await forceGcpsTabReady(page);
      await page.getByTestId('map-tab-gcps').click();
      await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 20000 });
      await expect.poll(async () => (await debugState(page)).edges.length, { timeout: 15000 }).toBe(1);

      // 衝突経路は marker が edge hit を遮るため UI 右クリックでは到達不能（旧版も同じ構造）。
      // 実関数を直接駆動して検証する（テスト内でロジック再現はしない。失敗事例ルール準拠）
      // (a) GCP_COLLISION: gcp0 の座標 [50,250] 直上を指定 → 新 GCP が既存 GCP と同座標
      const consoleWarnings: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'warning') consoleWarnings.push(msg.text());
      });
      await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        const edgeFeature = info.map.getSource('edges').getFeatures()[0];
        (window as any).testDebug.addMarkerOnEdge(
          { data: { edge: edgeFeature }, coordinate: info.source.xy2SysCoord([50, 250]) },
          info.map,
        );
      });
      let state = await debugState(page);
      expect(state.gcpCount).toBe(3); // mutation なし
      expect(state.edges.length).toBe(1);
      expect(consoleWarnings.some((text) => text.includes('GCP_COLLISION'))).toBe(true);

      // (b) EDGE_NOT_FOUND: edges.value に存在しない startEnd を持つ偽 feature → 診断表示のみ
      await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        const edgeFeature = info.map.getSource('edges').getFeatures()[0];
        const fakeFeature = {
          getGeometry: () => edgeFeature.getGeometry(),
          get: (key: string) => (key === 'startEnd' ? [1, 2] : undefined),
        };
        (window as any).testDebug.addMarkerOnEdge(
          { data: { edge: fakeFeature }, coordinate: info.source.xy2SysCoord([200, 250]) },
          info.map,
        );
      });
      // Vue の再描画（nextTick）を待ってから operation 診断を確認する
      await expect.poll(async () =>
        page.evaluate(() => document.querySelector('[data-diagnostic-scope="operation"]')?.textContent ?? ''),
      { timeout: 10000 }).toContain('対応線が見つかりません');
      state = await debugState(page);
      expect(state.gcpCount).toBe(3); // mutation なし
      expect(state.edges.length).toBe(1);

      console.log('  AC9 (collision + not-found): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

});
