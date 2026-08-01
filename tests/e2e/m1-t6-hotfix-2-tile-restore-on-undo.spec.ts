// m1-t6-hotfix-2: undo で地図タイルが元の地図へ戻らない不具合の回帰 E2E。
// 設計 `docs/superpowers/specs/2026-08-01-m1-t6-hotfix-2-tile-restore-on-undo-design.md` v1.1 §7 準拠。
//
//   AC1: 既存地図 A に画像 B をアップロードした後、undo でタイル表示が A に戻り redo で B に戻る。
//        判定は DOM 目視ではなく illstMapInfo().source の実体（OL XYZ の urls）で行う（設計 §7 AC1）。
//   AC2: タイル同一性キーが変わらない undo/redo（GCP 追加の undo）では exchangeTileSource() が
//        呼ばれない＝ tileSourceDebug().exchangeCount の増分が 0（設計 §5.4a・§7 AC2）。
//        あわせて AC1 側でタイル切替時の増分が 1 であることを確認し、カウンタ自体が
//        動いていること（増分0が「カウンタが死んでいるだけ」ではないこと）を担保する。
//
// 【測定区間の注意】保存成功ハンドラ（`src/views/MapEdit.vue:189`）も exchangeTileSource() を
// 呼ぶため、AC2 の増分測定区間に保存操作を入れてはならない。AC2 のテストは保存を一切行わない。
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

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

// ダイアログ差し替え（m12-t17 / m12-t15 と同型のアップロードハーネス）
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
  }, imagePath);
}

async function stubMessageBoxOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

// 実 imageCutter を走らせる画像アップロード操作（m12-t17 の同名ヘルパと同型）
async function uploadImageViaUi(page: Page, app: ElectronApplication, imagePath: string): Promise<void> {
  await installDialogHarness(app, imagePath);
  await page.getByRole('button', { name: '地図画像登録' }).click();
  const okButton = page.getByRole('button', { name: 'OK' });
  await expect(okButton).toBeEnabled({ timeout: 60_000 });
  await okButton.click();
}

// ---- 診断口（testDebug）------------------------------------------------------

async function tileSourceDebug(page: Page): Promise<{ exchangeCount: number; key: string | null }> {
  return page.evaluate(() => (window as any).testDebug.tileSourceDebug());
}

// illstMapInfo().source の実体から現在のタイル URL テンプレートを取り出す。
// source は MaplatCore の HistMap_tin（ol/source/XYZ 派生）で、mapSourceFactory へ渡した
// options.url が UrlTile#setUrl 経由で urls[0] に入る（node_modules/ol/source/UrlTile.js:84）。
async function sourceTileUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const source = (window as any).testDebug?.illstMapInfo?.().source;
    if (!source) return null;
    const urls = typeof source.getUrls === 'function' ? source.getUrls() : source.urls;
    return Array.isArray(urls) && urls.length > 0 ? urls[0] : null;
  });
}

// source オブジェクトそのものの同一性（再構築されたかどうか）を page 内の WeakMap で番号化する
async function sourceIdentity(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as any;
    const source = w.testDebug?.illstMapInfo?.().source;
    if (!source) return -1;
    if (!w.__hf2SourceIds) w.__hf2SourceIds = new WeakMap();
    if (!w.__hf2SourceIds.has(source)) {
      w.__hf2SourceIds.set(source, (w.__hf2SourceCounter = (w.__hf2SourceCounter || 0) + 1));
    }
    return w.__hf2SourceIds.get(source);
  });
}

async function mapUrl(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_);
}

async function historyDebug(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).testDebug?.historyDebug?.() ?? null);
}

async function historyJournal(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).testDebug?.historyJournal?.() ?? []);
}

/**
 * 履歴スタックが静止する（＝デバウンス中のスナップショットが出揃う）まで待つ。
 *
 * 固定スリープではなく「履歴長が quietMs の間変化しない」という状態条件で待つ。
 * これを挟まずに undo すると、直前の編集の push が未着地のまま pointer を動かすことになり、
 * 復元先が意図した状態と変わってしまう（m18-t1 で同種の待ちを入れているのと同じ理由）。
 */
async function waitHistoryQuiet(page: Page, quietMs = 700, timeoutMs = 30_000): Promise<number> {
  const start = Date.now();
  let last = -1;
  let lastChangedAt = Date.now();
  for (;;) {
    const len = (await historyDebug(page))?.length ?? -1;
    if (len !== last) {
      last = len;
      lastChangedAt = Date.now();
    } else if (Date.now() - lastChangedAt >= quietMs) {
      return len;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`履歴長が ${timeoutMs}ms 以内に静止しませんでした (last=${last})`);
    }
    await page.waitForTimeout(100);
  }
}

// MapEdit の onHistoryKeydown は isEditableElement（nativeTextUndo.ts）で INPUT/TEXTAREA 上の
// グローバル undo を抑止する。実利用者と同じくフォーカスを外してから押す（m18-t1 と同型）
const UNDO_KEY = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_KEY = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

async function pressUndo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(UNDO_KEY);
}

async function pressRedo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(REDO_KEY);
}

// ---- seed --------------------------------------------------------------------

// 画像未アップロードの既存地図を IPC 直叩きで seed する（m12-t17 の seedBareMap と同型）
async function seedBareMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const mapSlug = `hf2-existing-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 'hf2 existing map' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'attr' }, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return { uid: mapR.uid, slug: mapSlug };
  });
}

// GCP3点 + edge 1本 + compiled tin 付きの地図を seed する（m12-t1-edge-split の seedMapWithEdge と同型）。
// AC2 では保存を一切行わないため、タイルは data URL のままで足りる
async function seedMapWithEdge(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `hf2-gcp-${Date.now()}`;
    const toMerc = (x: number, y: number): number[] => [
      15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
      4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
    ];
    const mapObject = {
      mapID: slug,
      title: { ja: 'hf2 GCP undo 用地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'hf2 attribution' }, dataAttr: {}, description: {},
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

// backend の load 経路は url_ を再導出するため seed 時の url_ は保持されない。
// GCP タブを使える状態にするため page 側で url_ を設定して loadMapTiles を起動する（m12-t1 と同型）
async function forceGcpsTabReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).testDebug.mapData.value.url_ =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  });
  await page.evaluate(() => (window as any).testDebug.loadMapTiles());
  await page.waitForFunction(() => !!(window as any).testDebug.illstMapInfo().source, undefined, { timeout: 60000 });
}

async function rightClickOnIllstMap(page: Page, xy: [number, number]): Promise<void> {
  const point = await page.evaluate((target) => {
    const info = (window as any).testDebug.illstMapInfo();
    const pixel = info.map.getPixelFromCoordinate(info.source.xy2SysCoord(target));
    const rect = document.getElementById('illstMap')!.getBoundingClientRect();
    return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
  }, xy);
  await page.mouse.click(point.x, point.y, { button: 'right' });
}

async function contextMenuTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.ol-ctx-menu-container li')).map((el) => (el as HTMLElement).innerText.trim()),
  );
}

async function gcpCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).testDebug.gcps.value.length);
}

test.describe('m1-t6-hotfix-2 undo/redo でのタイルソース復元', () => {
  test('AC1: 画像差し替え後の undo でタイルソースが元の地図へ戻り、redo で新画像へ戻る（切替時の増分は 1）', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-hf2-tile-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxOk(app);
      const { uid } = await seedBareMap(page);

      const { Jimp } = await import('jimp');
      const imageA = path.join(e2eRoot, 'image-a.png');
      const imageB = path.join(e2eRoot, 'image-b.png');
      await new Jimp({ width: 400, height: 300, color: 0xff0000ff }).write(imageA);
      await new Jimp({ width: 500, height: 250, color: 0x00ff00ff }).write(imageB);

      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });

      // --- 地図 A を確定させる（画像 A をアップロードして保存し、恒久タイルにする）---
      //
      // 恒久パス判定は「`tiles/<uid>` を含むこと」で行ってはならない。既存地図の
      // アップロード staging は `draft-tiles/<uid>/…`（M12-T20）で、これは `tiles/<uid>` を
      // 部分文字列として含むため、staging のまま条件が成立してしまう。
      // staging root を含まないことを直接見る（m12-t17 と同じ判定）。
      const draftTileRoot = path.join(e2eRoot, 'draft-tiles');
      await uploadImageViaUi(page, app, imageA);
      const stagingUrlA = await mapUrl(page);
      expect(stagingUrlA, 'アップロード直後は staging パスを指すこと').toContain(draftTileRoot);
      await page.getByTestId('editor-save').click();
      await expect
        .poll(async () => await mapUrl(page), { timeout: 120_000 })
        .not.toContain(draftTileRoot);
      const saveFolder: string = await page.evaluate(() => window.settings.get('saveFolder'));
      expect((await mapUrl(page))!.replace(/\\/g, '/'), '保存後は恒久タイルパスを指すこと')
        .toContain(encodeURI(path.join(saveFolder, 'tiles', uid).replace(/\\/g, '/')));
      // 保存成功ハンドラ（MapEdit.vue:189）による恒久 URL へのソース差し替えが着地するまで待つ
      await expect
        .poll(async () => await sourceTileUrl(page), { timeout: 30_000 })
        .toBe(await mapUrl(page));

      const urlA = (await mapUrl(page))!;
      const sourceUrlA = await sourceTileUrl(page);
      const keyA = (await tileSourceDebug(page)).key;
      const identityA = await sourceIdentity(page);
      expect(sourceUrlA, 'A のタイル source URL が取得できること').toBeTruthy();
      await waitHistoryQuiet(page);

      // --- 画像 B へ差し替える（保存はしない）---
      await uploadImageViaUi(page, app, imageB);
      await expect.poll(async () => await mapUrl(page), { timeout: 60_000 }).not.toBe(urlA);
      await expect
        .poll(async () => await sourceTileUrl(page), { timeout: 30_000 })
        .toBe(await mapUrl(page));
      const urlB = (await mapUrl(page))!;
      const sourceUrlB = await sourceTileUrl(page);
      const keyB = (await tileSourceDebug(page)).key;
      expect(urlB, 'B の url_ が A と異なること').not.toBe(urlA);
      expect(keyB, 'B のタイル同一性キーが A と異なること').not.toBe(keyA);
      await waitHistoryQuiet(page);

      // --- AC1 前半: undo でタイルが A へ戻る ---
      const countBeforeUndo = (await tileSourceDebug(page)).exchangeCount;
      const historyBeforeUndo = await historyDebug(page);
      await pressUndo(page);
      try {
        await expect
          .poll(async () => await sourceTileUrl(page), { timeout: 30_000 })
          .toBe(sourceUrlA);
      } catch (e) {
        console.log('[m1-t6-hotfix-2] UNDO FAILED historyBeforeUndo=' + JSON.stringify(historyBeforeUndo));
        console.log('[m1-t6-hotfix-2] mapData.url_=' + (await mapUrl(page)));
        console.log('[m1-t6-hotfix-2] tileSourceDebug=' + JSON.stringify(await tileSourceDebug(page)));
        console.log('[m1-t6-hotfix-2] JOURNAL=' + JSON.stringify(await historyJournal(page)));
        throw e;
      }
      expect(await mapUrl(page), 'undo で url_ が A へ戻ること').toBe(urlA);
      expect((await tileSourceDebug(page)).key, 'undo 後の同一性キーが A のもの').toBe(keyA);
      const identityAfterUndo = await sourceIdentity(page);
      expect(identityAfterUndo, 'source は再構築された別インスタンスであること').not.toBe(identityA);
      // AC2 の裏面: タイル切替が起きる undo では exchangeCount がちょうど 1 増える
      const countAfterUndo = (await tileSourceDebug(page)).exchangeCount;
      expect(countAfterUndo - countBeforeUndo, 'タイル切替を伴う undo の exchangeCount 増分は 1').toBe(1);

      // --- AC1 後半: redo でタイルが B へ戻る ---
      await pressRedo(page);
      await expect
        .poll(async () => await sourceTileUrl(page), { timeout: 30_000 })
        .toBe(sourceUrlB);
      expect(await mapUrl(page), 'redo で url_ が B へ戻ること').toBe(urlB);
      expect((await tileSourceDebug(page)).key, 'redo 後の同一性キーが B のもの').toBe(keyB);
      const countAfterRedo = (await tileSourceDebug(page)).exchangeCount;
      expect(countAfterRedo - countAfterUndo, 'タイル切替を伴う redo の exchangeCount 増分は 1').toBe(1);

      console.log('  AC1 (tile restore on undo/redo): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC2: タイル同一性キーが変わらない undo/redo（GCP 追加）では exchangeTileSource が呼ばれない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-hf2-gcp-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxOk(app);
      const seeded = await seedMapWithEdge(page);
      await openHash(page, `#/mapedit?uid=${seeded.uid}`);
      await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID, undefined, { timeout: 60_000 });
      await forceGcpsTabReady(page);
      await page.getByTestId('map-tab-gcps').click();
      await expect(page.locator('#illstMap canvas')).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => page.evaluate(() => (window as any).testDebug.edges.value.length), { timeout: 15_000 })
        .toBe(1);

      // GCP を実 UI 操作で1点追加する（対応線上にマーカー追加。m12-t1 の実績経路）
      await rightClickOnIllstMap(page, [200, 250]);
      await expect.poll(async () => (await contextMenuTexts(page)).join('|'), { timeout: 10_000 })
        .toContain('対応線上にマーカー追加');
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.ol-ctx-menu-container li')) as HTMLElement[];
        items.find((el) => el.innerText.includes('対応線上にマーカー追加'))?.click();
      });
      await expect.poll(async () => await gcpCount(page), { timeout: 10_000 }).toBe(4);
      await waitHistoryQuiet(page);

      // 測定区間の開始。ここから redo 完了までの間に保存操作を一切挟まない
      // （保存成功ハンドラ MapEdit.vue:189 も exchangeTileSource を呼ぶため）
      const before = await tileSourceDebug(page);
      const keyBefore = before.key;
      expect(keyBefore, 'タイル同一性キーが確立していること').toBeTruthy();

      await pressUndo(page);
      await expect.poll(async () => await gcpCount(page), { timeout: 15_000 }).toBe(3);
      await expect
        .poll(async () => page.evaluate(() => (window as any).testDebug.edges.value.length), { timeout: 15_000 })
        .toBe(1);
      const afterUndo = await tileSourceDebug(page);
      expect(afterUndo.exchangeCount - before.exchangeCount, 'GCP undo で exchangeCount は増えない').toBe(0);
      expect(afterUndo.key, 'GCP undo でタイル同一性キーは変わらない').toBe(keyBefore);

      await pressRedo(page);
      await expect.poll(async () => await gcpCount(page), { timeout: 15_000 }).toBe(4);
      const afterRedo = await tileSourceDebug(page);
      expect(afterRedo.exchangeCount - before.exchangeCount, 'GCP redo でも exchangeCount は増えない').toBe(0);
      expect(afterRedo.key, 'GCP redo でもタイル同一性キーは変わらない').toBe(keyBefore);

      console.log('  AC2 (no rebuild without identity change): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
