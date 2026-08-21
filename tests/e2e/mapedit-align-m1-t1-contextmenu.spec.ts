// m1-t1「コンテキストメニュー3件の是正（折り返し・空メニュー・対応点表示）」E2E。
// 設計: docs/superpowers/specs/2026-08-21-m1-t1-mapedit-contextmenu-fixes-task-design.md v1.0
// 項目構成の正本: マイルストーン設計 §6.1.1 の相別契約表（F1 / F2 / F0 × 4 フィーチャ種別）。
//
// 担当 AC:
//   AC1  長い項目が箱の外へはみ出さず折り返す（英語・日本語）
//   AC2  折り返しても地図ビューポートの右端・下端で切れない
//   AC3  是正が共有ライブラリ側 1 箇所（呼び出し側 2 画面のソース検査は smoke が担当）
//   AC4  フィーチャ命中時の項目集合が §6.1.1 の表と一致する（順序を含む配列そのものを assert）
//   AC5  F2 のキャンセルがどちらの面からでも効く（TypeError を出さない）
//   AC6  対応マーカー表示が F0 でのみ、対応線開始より前に出る
//   AC7  対応マーカー表示で両面が当該 GCP の対応点を中心に表示される
//   AC8  §6.1.1 に無い挙動変化が無い（各セルで項目テキスト配列そのものを assert する）
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

type Face = 'illst' | 'merc';

const MAP_ELEMENT_ID: Record<Face, string> = { illst: 'illstMap', merc: 'mercMap' };

// t11 型の角座標から線形補間で画像座標 → mercator 座標を作る（seed と同じ式）
const toMerc = (x: number, y: number): [number, number] => [
  15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
  4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
];

async function launch(e2eRoot: string, lang: 'ja' | 'en'): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // i18n は起動時に settings の lang を読む（src/i18n.ts:11）∴ 設定後に再読み込みする
  await page.evaluate((next) => window.settings.set('lang', next), lang);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const errors: string[] = [];
  // pageerror は捕捉されない JS 例外（AC5 が禁じる TypeError はここに出る）。
  // console.error のうち "Failed to load resource" はオフラインの e2e 環境で
  // ベースマップタイル等の取得が失敗するときに出るもので、右クリック経路とは無関係である
  // ∴ 除外する（除外しないと本タスクと無縁の環境ノイズで落ちる）。
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('Failed to load resource')) return;
    errors.push(`console.error: ${text}`);
  });
  return { app, page, errors };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

// GCP3点（三角形）+ edge [0,1] 付きの地図を compiled tin 付きで seed する（m12-t1 と同型）
async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `mapedit-align-m1-t1-map-${Date.now()}`;
    const toMercIn = (x: number, y: number): number[] => [
      15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
      4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
    ];
    const mapObject = {
      mapID: slug,
      title: { ja: 'm1-t1 コンテキストメニュー検証地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'm1-t1 attribution' }, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      gcps: [
        [[50, 250], toMercIn(50, 250)],
        [[350, 250], toMercIn(350, 250)],
        [[350, 50], toMercIn(350, 50)],
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

// GCPタブを有効化するため url_ を page 側で設定する（m12-t1 と同型）
async function forceGcpsTabReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).testDebug.mapData.value.url_ =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  });
  await page.evaluate(() => (window as any).testDebug.loadMapTiles());
  await page.waitForFunction(() => !!(window as any).testDebug.illstMapInfo().source, undefined, { timeout: 60000 });
}

async function openGcpsTab(page: Page): Promise<void> {
  await page.getByTestId('map-tab-gcps').click();
  await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 20000 });
  await expect.poll(
    async () => page.evaluate(() => (window as any).testDebug.edges.value.length),
    { timeout: 15000 },
  ).toBe(1);
}

/** marker ソースから当該 gcpIndex のフィーチャ座標（地図座標系）を取り出す */
async function markerCoord(page: Page, face: Face, gcpIndex: string): Promise<number[] | null> {
  return page.evaluate(({ face: f, gcpIndex: idx }) => {
    const debug = (window as any).testDebug;
    const info = f === 'illst' ? debug.illstMapInfo() : debug.mercMapInfo();
    const src = info.map?.getSource('marker');
    if (!src) return null;
    const feature = src.getFeatures().find((ft: any) => String(ft.get('gcpIndex')) === idx);
    return feature ? (feature.getGeometry().getCoordinates() as number[]) : null;
  }, { face, gcpIndex });
}

/**
 * ビューを対象座標へ寄せて必ず画面内に入るようにする（テスト前提の整備であり検証対象ではない）。
 * 再描画の完了を待つ: forEachFeatureAtPixel は直前の frameState を使うため、setCenter 直後に
 * 右クリックすると新しい画面座標を古い描画へ当てることになり、マーカーに命中しない。
 */
async function centerOn(page: Page, face: Face, coord: number[]): Promise<void> {
  await page.evaluate(({ face: f, coord: c }) => new Promise<void>((resolve) => {
    const debug = (window as any).testDebug;
    const info = f === 'illst' ? debug.illstMapInfo() : debug.mercMapInfo();
    const map = info.map;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    map.once('rendercomplete', finish);
    map.getView().setCenter(c);
    map.render();
    setTimeout(finish, 3000);
  }), { face, coord });
}

/** 地図座標を画面座標へ変換して右クリックする。dyPx はアイコン本体（アンカーの上）を狙うための補正 */
async function rightClickCoord(page: Page, face: Face, coord: number[], dyPx = 0): Promise<void> {
  const point = await page.evaluate(({ face: f, coord: c, dyPx: dy, elementId }) => {
    const debug = (window as any).testDebug;
    const info = f === 'illst' ? debug.illstMapInfo() : debug.mercMapInfo();
    const pixel = info.map.getPixelFromCoordinate(c);
    const rect = document.getElementById(elementId)!.getBoundingClientRect();
    return { x: rect.left + pixel[0], y: rect.top + pixel[1] + dy };
  }, { face, coord, dyPx, elementId: MAP_ELEMENT_ID[face] });
  await page.mouse.click(point.x, point.y, { button: 'right' });
}

/** 画像座標（illst のみ）で右クリックする */
async function rightClickIllstXy(page: Page, xy: [number, number], dyPx = 0): Promise<void> {
  const coord = await page.evaluate((target) => {
    const info = (window as any).testDebug.illstMapInfo();
    return info.source.xy2SysCoord(target) as number[];
  }, xy);
  await rightClickCoord(page, 'illst', coord, dyPx);
}

const visibleMenuSelector = (face: Face) =>
  `#${MAP_ELEMENT_ID[face]} .ol-ctx-menu-container:not(.ol-ctx-menu-hidden) > ul > li`;

async function menuTexts(page: Page, face: Face): Promise<string[]> {
  return page.evaluate((selector) =>
    Array.from(document.querySelectorAll(selector)).map((el) => (el as HTMLElement).innerText.trim()),
    visibleMenuSelector(face),
  );
}

/** 期待する項目配列（順序を含む）になるまで待って照合する */
async function expectMenu(page: Page, face: Face, expected: string[]): Promise<void> {
  await expect.poll(async () => (await menuTexts(page, face)).join('|'), { timeout: 10000 })
    .toBe(expected.join('|'));
}

async function clickMenuItem(page: Page, face: Face, text: string): Promise<void> {
  const clicked = await page.evaluate(({ selector, label }) => {
    const items = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    const target = items.find((el) => el.innerText.trim() === label);
    if (!target) return false;
    target.click();
    return true;
  }, { selector: visibleMenuSelector(face), label: text });
  expect(clicked, `メニュー項目「${text}」が ${face} 面に見つからない`).toBe(true);
}

/** 未確定マーカー（gcpIndex === 'new'）の総数（両面合計） */
async function pendingNewMarkerCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const debug = (window as any).testDebug;
    const count = (map: any) => {
      const src = map?.getSource('marker');
      return src ? src.getFeatures().filter((ft: any) => ft.get('gcpIndex') === 'new').length : 0;
    };
    return count(debug.illstMapInfo().map) + count(debug.mercMapInfo().map);
  });
}

async function setupHomePosition(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).testDebug.estimateHomeFromGcps());
  await expect.poll(async () => (await markerCoord(page, 'merc', 'home')) !== null, { timeout: 10000 }).toBe(true);
}

async function bootstrap(
  lang: 'ja' | 'en',
  prefix: string,
): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const { app, page, errors } = await launch(e2eRoot, lang);
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  const seeded = await seedMap(page);
  await openHash(page, `#/mapedit?uid=${seeded.uid}`);
  await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60000 });
  await forceGcpsTabReady(page);
  await openGcpsTab(page);
  return { app, page, errors };
}

test.describe('m1-t1 右クリックメニューの相別契約と折り返し', () => {
  test('AC4/AC6/AC7/AC8: F0（通常）と F1（対応線作図中）の全セル', async () => {
    test.setTimeout(240_000);
    const { app, page, errors } = await bootstrap('ja', 'maplat-m1t1-f0f1-');
    try {
      await setupHomePosition(page);

      // --- F0 × 確定済みマーカー（§6.1.1: 対応マーカー表示 → 対応線開始 → マーカー削除） ---
      const gcp2 = (await markerCoord(page, 'illst', '2'))!;
      expect(gcp2).not.toBeNull();
      await centerOn(page, 'illst', gcp2);
      await rightClickCoord(page, 'illst', gcp2, -8);
      await expectMenu(page, 'illst', ['対応マーカー表示', '対応線開始マーカー指定', 'マーカー削除']);

      // --- AC7: 対応マーカー表示で両面がその GCP を中心に表示される ---
      // まず両面のビューを対象からずらしてから実行する（何もしなくても通る形にしない）
      const expected = await page.evaluate(() => {
        const debug = (window as any).testDebug;
        const illst = debug.illstMapInfo();
        const merc = debug.mercMapInfo();
        const gcp = debug.gcps.value[2];
        // 期待値を先に取る
        const want = {
          illstCenter: illst.source.xy2SysCoord(gcp[0]) as number[],
          illstZoom: illst.source.maxZoom - 1,
          mercCenter: gcp[1] as number[],
          mercZoom: 17,
        };
        // ビューをずらす
        illst.map.getView().setCenter([want.illstCenter[0] + 500, want.illstCenter[1] + 500]);
        illst.map.getView().setZoom(0);
        merc.map.getView().setCenter([want.mercCenter[0] + 50000, want.mercCenter[1] + 50000]);
        merc.map.getView().setZoom(5);
        return want;
      });
      // ビューを動かしたので座標は取り直す
      const gcp2Again = (await markerCoord(page, 'illst', '2'))!;
      await centerOn(page, 'illst', gcp2Again);
      await rightClickCoord(page, 'illst', gcp2Again, -8);
      await expectMenu(page, 'illst', ['対応マーカー表示', '対応線開始マーカー指定', 'マーカー削除']);
      await clickMenuItem(page, 'illst', '対応マーカー表示');
      await expect.poll(async () => page.evaluate((want) => {
        const debug = (window as any).testDebug;
        const illstView = debug.illstMapInfo().map.getView();
        const mercView = debug.mercMapInfo().map.getView();
        const ic = illstView.getCenter() as number[];
        const mc = mercView.getCenter() as number[];
        const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
        return {
          illstCenter: near(ic[0], want.illstCenter[0], 1e-6) && near(ic[1], want.illstCenter[1], 1e-6),
          illstZoom: near(illstView.getZoom(), want.illstZoom, 1e-6),
          mercCenter: near(mc[0], want.mercCenter[0], 1e-6) && near(mc[1], want.mercCenter[1], 1e-6),
          mercZoom: near(mercView.getZoom(), want.mercZoom, 1e-6),
        };
      }, expected), { timeout: 10000 })
        .toEqual({ illstCenter: true, illstZoom: true, mercCenter: true, mercZoom: true });

      // --- F0 × 対応線 ---
      const edgeCoord = await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        return info.source.xy2SysCoord([200, 250]) as number[];
      });
      await centerOn(page, 'illst', edgeCoord);
      await rightClickCoord(page, 'illst', edgeCoord);
      await expectMenu(page, 'illst', ['対応線削除', '対応線上にマーカー追加']);

      // --- F0 × home マーカー ---
      const homeCoord = (await markerCoord(page, 'merc', 'home'))!;
      expect(homeCoord).not.toBeNull();
      await centerOn(page, 'merc', homeCoord);
      await rightClickCoord(page, 'merc', homeCoord, -8);
      await expectMenu(page, 'merc', ['ホーム位置削除', 'ホーム位置表示']);

      // --- F1 へ移行（対応線開始マーカー指定を GCP0 で選ぶ） ---
      const gcp0 = (await markerCoord(page, 'illst', '0'))!;
      await centerOn(page, 'illst', gcp0);
      await rightClickCoord(page, 'illst', gcp0, -8);
      await expectMenu(page, 'illst', ['対応マーカー表示', '対応線開始マーカー指定', 'マーカー削除']);
      await clickMenuItem(page, 'illst', '対応線開始マーカー指定');

      // F1 × 確定済みマーカー（起点以外）→ 対応線終了 1 項目
      const gcp2F1 = (await markerCoord(page, 'illst', '2'))!;
      await centerOn(page, 'illst', gcp2F1);
      await rightClickCoord(page, 'illst', gcp2F1, -8);
      await expectMenu(page, 'illst', ['対応線終了マーカー指定']);

      // F1 × 起点マーカー自身 → 対応線キャンセル 1 項目
      const gcp0F1 = (await markerCoord(page, 'illst', '0'))!;
      await centerOn(page, 'illst', gcp0F1);
      await rightClickCoord(page, 'illst', gcp0F1, -8);
      await expectMenu(page, 'illst', ['対応線指定キャンセル']);

      // F1 × home マーカー → 対応線キャンセル 1 項目（従来はホーム 2 項目が出ていた）
      const homeF1 = (await markerCoord(page, 'merc', 'home'))!;
      await centerOn(page, 'merc', homeF1);
      await rightClickCoord(page, 'merc', homeF1, -8);
      await expectMenu(page, 'merc', ['対応線指定キャンセル']);

      // F1 × 対応線 → 対応線キャンセル 1 項目（従来は対応線 2 項目が出ていた）
      const edgeF1 = await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        return info.source.xy2SysCoord([200, 250]) as number[];
      });
      await centerOn(page, 'illst', edgeF1);
      await rightClickCoord(page, 'illst', edgeF1);
      await expectMenu(page, 'illst', ['対応線指定キャンセル']);

      // F1 × 空き部分 → 従来どおり マーカー追加 ＋ 対応線キャンセル（§6.1.2 は変更しない）
      const emptyF1 = await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        return info.source.xy2SysCoord([120, 90]) as number[];
      });
      await centerOn(page, 'illst', emptyF1);
      await rightClickCoord(page, 'illst', emptyF1);
      await expectMenu(page, 'illst', ['マーカー追加', '対応線指定キャンセル']);

      // F1 × 未確定マーカー → 対応線キャンセル 1 項目
      // （空き部分でマーカー追加を選ぶと newlyAddEdge と newGcp が同時に立つ。F1 が優先する）
      await clickMenuItem(page, 'illst', 'マーカー追加');
      await expect.poll(async () => pendingNewMarkerCount(page), { timeout: 10000 }).toBe(1);
      const newMarker = (await markerCoord(page, 'illst', 'new'))!;
      expect(newMarker).not.toBeNull();
      await centerOn(page, 'illst', newMarker);
      await rightClickCoord(page, 'illst', newMarker, -8);
      await expectMenu(page, 'illst', ['対応線指定キャンセル']);

      expect(errors, `console/page error が出た: ${errors.join(' / ')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4/AC5/AC5a/AC8: F2（対応点待機中）の全セルと両面からのキャンセル', async () => {
    test.setTimeout(240_000);
    const { app, page, errors } = await bootstrap('ja', 'maplat-m1t1-f2-');
    try {
      await setupHomePosition(page);

      // illst 面の空き部分で「マーカー追加」→ merc 面の指定待ち（F2）
      const empty = await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        return info.source.xy2SysCoord([120, 90]) as number[];
      });
      await centerOn(page, 'illst', empty);
      await rightClickCoord(page, 'illst', empty);
      await expectMenu(page, 'illst', ['マーカー追加']);
      await clickMenuItem(page, 'illst', 'マーカー追加');
      await expect.poll(async () => pendingNewMarkerCount(page), { timeout: 10000 }).toBe(1);

      // F2 × 未確定マーカー（HR-2 の空メニュー。現行は空になっていた）
      const newMarker = (await markerCoord(page, 'illst', 'new'))!;
      expect(newMarker).not.toBeNull();
      await centerOn(page, 'illst', newMarker);
      await rightClickCoord(page, 'illst', newMarker, -8);
      await expectMenu(page, 'illst', ['マーカー追加キャンセル']);

      // F2 × 確定済みマーカー（Q3 parity: 対応線開始もマーカー削除も出ない）
      const gcp2 = (await markerCoord(page, 'illst', '2'))!;
      await centerOn(page, 'illst', gcp2);
      await rightClickCoord(page, 'illst', gcp2, -8);
      await expectMenu(page, 'illst', ['マーカー追加キャンセル']);

      // F2 × 対応線
      const edgeCoord = await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        return info.source.xy2SysCoord([200, 250]) as number[];
      });
      await centerOn(page, 'illst', edgeCoord);
      await rightClickCoord(page, 'illst', edgeCoord);
      await expectMenu(page, 'illst', ['マーカー追加キャンセル']);

      // F2 × home マーカー
      const homeIllst = (await markerCoord(page, 'illst', 'home'))!;
      expect(homeIllst, 'illst 面に home マーカーが無い（TIN 未成立）').not.toBeNull();
      await centerOn(page, 'illst', homeIllst);
      await rightClickCoord(page, 'illst', homeIllst, -8);
      await expectMenu(page, 'illst', ['マーカー追加キャンセル']);

      // --- AC5: 待っている側の面（merc）の確定済みマーカーからキャンセルする ---
      // 旧実装ではここで map.getSource('marker') から 'new' が引けず TypeError になっていた
      const gcp2Merc = (await markerCoord(page, 'merc', '2'))!;
      expect(gcp2Merc).not.toBeNull();
      await centerOn(page, 'merc', gcp2Merc);
      await rightClickCoord(page, 'merc', gcp2Merc, -8);
      await expectMenu(page, 'merc', ['マーカー追加キャンセル']);
      await clickMenuItem(page, 'merc', 'マーカー追加キャンセル');
      await expect.poll(async () => pendingNewMarkerCount(page), { timeout: 10000 }).toBe(0);
      expect(errors, `待っている側の面からのキャンセルでエラーが出た: ${errors.join(' / ')}`).toEqual([]);

      // --- AC5: マーカーが在る側の面（illst）の空き部分からもキャンセルできる ---
      await centerOn(page, 'illst', empty);
      await rightClickCoord(page, 'illst', empty);
      await expectMenu(page, 'illst', ['マーカー追加']);
      await clickMenuItem(page, 'illst', 'マーカー追加');
      await expect.poll(async () => pendingNewMarkerCount(page), { timeout: 10000 }).toBe(1);
      const empty2 = await page.evaluate(() => {
        const info = (window as any).testDebug.illstMapInfo();
        return info.source.xy2SysCoord([300, 120]) as number[];
      });
      await centerOn(page, 'illst', empty2);
      await rightClickCoord(page, 'illst', empty2);
      await expectMenu(page, 'illst', ['マーカー追加キャンセル']);
      await clickMenuItem(page, 'illst', 'マーカー追加キャンセル');
      await expect.poll(async () => pendingNewMarkerCount(page), { timeout: 10000 }).toBe(0);

      // F0 へ戻っていること（GCP は増えていない）
      expect(await page.evaluate(() => (window as any).testDebug.gcps.value.length)).toBe(3);
      expect(errors, `console/page error が出た: ${errors.join(' / ')}`).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC1/AC2/AC3: 英語・日本語ともメニューが折り返し、箱と地図からはみ出さない', async () => {
    test.setTimeout(240_000);
    for (const lang of ['en', 'ja'] as const) {
      const { app, page, errors } = await bootstrap(lang, `maplat-m1t1-wrap-${lang}-`);
      try {
        // 最長級の項目（en: Corresponding Line Start From This Marker）が出る F0 × 確定済みマーカー
        const gcp2 = (await markerCoord(page, 'illst', '2'))!;
        await centerOn(page, 'illst', gcp2);
        await rightClickCoord(page, 'illst', gcp2, -8);
        await expect.poll(async () => (await menuTexts(page, 'illst')).length, { timeout: 10000 }).toBe(3);

        const geom = await page.evaluate((selector) => {
          const li = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
          const container = li[0].closest('.ol-ctx-menu-container') as HTMLElement;
          const mapRect = document.getElementById('illstMap')!.getBoundingClientRect();
          const boxRect = container.getBoundingClientRect();
          return {
            items: li.map((el) => ({
              text: el.innerText.trim(),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              offsetWidth: el.offsetWidth,
              offsetHeight: el.offsetHeight,
            })),
            containerClientWidth: container.clientWidth,
            box: { left: boxRect.left, top: boxRect.top, right: boxRect.right, bottom: boxRect.bottom },
            map: { left: mapRect.left, top: mapRect.top, right: mapRect.right, bottom: mapRect.bottom },
          };
        }, visibleMenuSelector('illst'));

        for (const item of geom.items) {
          // AC1: 箱の外へはみ出さない（横スクロールが生じない・箱幅を超えない）
          expect(item.scrollWidth, `${lang}: 「${item.text}」が横にはみ出している`)
            .toBeLessThanOrEqual(item.clientWidth);
          expect(item.offsetWidth, `${lang}: 「${item.text}」が箱幅を超えている`)
            .toBeLessThanOrEqual(geom.containerClientWidth);
        }
        // en では最長項目が実際に 2 行以上へ折り返していること（折り返しが効いている証拠）
        if (lang === 'en') {
          const longest = geom.items.reduce((a, b) => (a.text.length >= b.text.length ? a : b));
          expect(longest.offsetHeight, `en: 「${longest.text}」が折り返していない`).toBeGreaterThan(24);
        }
        // AC2: 折り返しても地図ビューポートの右端・下端で切れない
        expect(geom.box.right, `${lang}: メニューが地図の右端からはみ出す`).toBeLessThanOrEqual(geom.map.right + 0.5);
        expect(geom.box.bottom, `${lang}: メニューが地図の下端からはみ出す`).toBeLessThanOrEqual(geom.map.bottom + 0.5);
        expect(geom.box.left, `${lang}: メニューが地図の左端からはみ出す`).toBeGreaterThanOrEqual(geom.map.left - 0.5);
        expect(geom.box.top, `${lang}: メニューが地図の上端からはみ出す`).toBeGreaterThanOrEqual(geom.map.top - 0.5);

        expect(errors, `console/page error が出た: ${errors.join(' / ')}`).toEqual([]);
      } finally {
        await quitElectronApplication(app);
      }
    }
  });
});
