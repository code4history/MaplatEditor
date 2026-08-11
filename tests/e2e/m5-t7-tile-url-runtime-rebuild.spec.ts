// M5-T7: 編集済みタイルURLのランタイムタイル源再構築 E2E。
//
// 検証する受け入れ条件（設計 §9.2）:
//   AC8   空 → 外部URL の確定で exchangeCount が 1 増える
//   AC9   外部URL → 空 で 1 増え、url_ が内部タイルの file:// 形式へ戻る
//   AC10  Enter でも確定する
//   AC11  値が変わらない blur では発火しない
//   AC12  キー入力ごとには発火しない
//   AC13  Undo/Redo で url と url_ が両方戻り、タイル源も戻る
//   AC14  url_ が保存要求に混ざらない（DB に url_ キーが無く url は入力値のまま）
//   AC15  width/height 未確定なら何もしない
//   AC15b 同じ値を再入力しても不整合にならない（lastDerivedUrl 是正の直接検証）
//   AC15c url 空 + タイル実体なしでもフォールバックへ合流する
//
// 「発火しないこと」（AC11 / AC12 / AC15）を条件に含めるのは、発火することだけを
// 確かめると**キー入力ごとの再読込を作り込んでも通ってしまう**ため（設計 §8）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const EXT_URL = 'https://example.com/tiles/{z}/{x}/{y}.png';

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

async function openHash(page: Page, hash: string, waitFor?: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
  if (waitFor) await expect(page.locator(waitFor)).toBeVisible({ timeout: 15_000 });
}

/** m12-t17 / m1-t6-hotfix-2 と同型のダイアログ差し替えハーネス */
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, imagePath);
}

/** m1-t6-hotfix-2 が使う診断口。タイル源の交換回数と現在のキー */
async function tileDebug(page: Page): Promise<{ exchangeCount: number; key: string | null }> {
  return page.evaluate(() => (window as any).testDebug.tileSourceDebug());
}

async function mapUrlPair(page: Page): Promise<{ url: string | undefined; url_: string | undefined }> {
  return page.evaluate(() => {
    const md = (window as any).testDebug?.mapData?.value ?? {};
    return { url: md.url, url_: md.url_ };
  });
}

// MapEdit の onHistoryKeydown は INPUT/TEXTAREA 上のグローバル undo を抑止する。
// 実利用者と同じくフォーカスを外してから押す（m1-t6-hotfix-2 / m18-t1 と同型）
const UNDO_KEY = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_KEY = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

async function historyDebug(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).testDebug?.historyDebug?.() ?? null);
}

/**
 * 履歴スタックが静止する（＝デバウンス中のスナップショットが出揃う）まで待つ。
 * m1-t6-hotfix-2 の waitHistoryQuiet と同型。これを挟まずに undo すると、直前の編集の
 * push が未着地のまま pointer を動かすことになり、復元先が意図した状態と変わる。
 */
async function waitHistoryQuiet(page: Page, quietMs = 700, timeoutMs = 30_000): Promise<number> {
  const start = Date.now();
  let last = -1;
  let lastChangedAt = Date.now();
  for (;;) {
    const len = (await historyDebug(page))?.length ?? -1;
    if (len !== last) { last = len; lastChangedAt = Date.now(); }
    else if (Date.now() - lastChangedAt >= quietMs) return len;
    if (Date.now() - start > timeoutMs) throw new Error(`履歴長が ${timeoutMs}ms 以内に静止しませんでした (last=${last})`);
    await page.waitForTimeout(100);
  }
}

async function pressUndo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(UNDO_KEY);
}

async function pressRedo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(REDO_KEY);
}

const urlInput = (page: Page) => page.getByTestId('map-tile-url');

/** 既存の保存済み地図を IPC で seed する（m12-t17 / m1-t6-hotfix-2 の seedBareMap と同型） */
async function seedSavedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const mapSlug = `m5t7-existing-${Date.now()}`;
    const mapR = await (window as any).mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 'm5t7 existing map' },
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

/** 画像をアップロード済みの新規地図を用意する（width/height と内部タイルが揃った状態） */
async function prepareMapWithImage(app: ElectronApplication, page: Page, e2eRoot: string, slug: string): Promise<void> {
  const imagePath = path.join(e2eRoot, `${slug}.png`);
  const { Jimp } = await import('jimp');
  await new Jimp({ width: 400, height: 300, color: 0xff0000ff }).write(imagePath as `${string}.${string}`);

  await openHash(page, '#/mapedit', '[data-testid="map-title"]');
  await page.getByTestId('map-title').fill(slug);
  await page.getByTestId('map-slug').fill(slug);
  await installDialogHarness(app, imagePath);
  await page.getByRole('button', { name: '地図画像登録' }).click();
  const okButton = page.getByRole('button', { name: 'OK' });
  await expect(okButton).toBeEnabled({ timeout: 60_000 });
  await okButton.click();
  await expect.poll(async () => (await mapUrlPair(page)).url_, { timeout: 30_000 }).toBeTruthy();
}

test.describe('M5-T7 編集済みタイルURLのランタイムタイル源再構築', () => {
  test('AC8/AC9/AC11/AC12: 確定で切り替わり、未確定・同値では発火しない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t7-toggle-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await prepareMapWithImage(app, page, e2eRoot, `m5t7-toggle-${Date.now()}`);
      const localUrl_ = (await mapUrlPair(page)).url_;
      expect(localUrl_).toContain('file:');

      const before = (await tileDebug(page)).exchangeCount;

      // AC12: キー入力だけでは発火しない（fill は input を出すが change は出さない）
      await urlInput(page).fill(EXT_URL);
      await page.waitForTimeout(500);
      expect((await tileDebug(page)).exchangeCount).toBe(before);

      // AC8: blur で確定 → 1 増える
      await urlInput(page).blur();
      await expect.poll(async () => (await tileDebug(page)).exchangeCount, { timeout: 15_000 }).toBe(before + 1);
      expect((await mapUrlPair(page)).url_).toBe(EXT_URL);

      // AC11: 値を変えない blur では発火しない
      await urlInput(page).click();
      await urlInput(page).blur();
      await page.waitForTimeout(500);
      expect((await tileDebug(page)).exchangeCount).toBe(before + 1);

      // AC9: 空へ戻すと 1 増え、url_ が内部タイルへ戻る
      await urlInput(page).fill('');
      await urlInput(page).blur();
      await expect.poll(async () => (await tileDebug(page)).exchangeCount, { timeout: 15_000 }).toBe(before + 2);
      expect((await mapUrlPair(page)).url_).toBe(localUrl_);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC10: Enter でも確定する', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t7-enter-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await prepareMapWithImage(app, page, e2eRoot, `m5t7-enter-${Date.now()}`);
      const before = (await tileDebug(page)).exchangeCount;

      await urlInput(page).fill(EXT_URL);
      await urlInput(page).press('Enter');
      await expect.poll(async () => (await tileDebug(page)).exchangeCount, { timeout: 15_000 }).toBe(before + 1);
      expect((await mapUrlPair(page)).url_).toBe(EXT_URL);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC13/AC15b: Undo/Redo で url と url_ が揃って戻り、同値再入力でも不整合にならない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t7-undo-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await prepareMapWithImage(app, page, e2eRoot, `m5t7-undo-${Date.now()}`);
      const localUrl_ = (await mapUrlPair(page)).url_;

      // 外部URLを確定
      await urlInput(page).fill(EXT_URL);
      await urlInput(page).blur();
      await expect.poll(async () => (await mapUrlPair(page)).url_, { timeout: 15_000 }).toBe(EXT_URL);

      // AC13: Undo → url と url_ が両方とも編集前へ戻る
      await waitHistoryQuiet(page);
      await pressUndo(page);
      await expect.poll(async () => (await mapUrlPair(page)).url, { timeout: 15_000 }).toBe('');
      expect((await mapUrlPair(page)).url_).toBe(localUrl_);

      // AC13: Redo で外部URLへ戻る
      await waitHistoryQuiet(page);
      await pressRedo(page);
      await expect.poll(async () => (await mapUrlPair(page)).url, { timeout: 15_000 }).toBe(EXT_URL);
      expect((await mapUrlPair(page)).url_).toBe(EXT_URL);

      // AC15b: もう一度 Undo してから同じ値を再入力する。
      // v1.0 の「入力欄の直前値」設計ではここで早期 return し、url=EXT_URL / url_=ローカル
      // という不整合になった（本タスクが直すはずの症状そのもの）。
      await waitHistoryQuiet(page);
      await pressUndo(page);
      await expect.poll(async () => (await mapUrlPair(page)).url, { timeout: 15_000 }).toBe('');

      await urlInput(page).fill(EXT_URL);
      await urlInput(page).blur();
      await expect.poll(async () => (await mapUrlPair(page)).url_, { timeout: 15_000 }).toBe(EXT_URL);
      expect((await mapUrlPair(page)).url).toBe(EXT_URL);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC14: url_ が保存要求に混ざらない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t7-save-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 既存の保存済み地図を開いて編集する（新規地図の保存は本 AC の関心ではない）
      const { uid } = await seedSavedMap(page);
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      await openHash(page, `#/mapedit?uid=${uid}`, '[data-testid="map-title"]');
      await expect.poll(async () => (await mapUrlPair(page)).url, { timeout: 15_000 }).toBe('');

      await urlInput(page).fill(EXT_URL);
      await urlInput(page).blur();
      await expect.poll(async () => (await mapUrlPair(page)).url, { timeout: 15_000 }).toBe(EXT_URL);

      await page.getByTestId('editor-save').click();
      // 保存完了は「isDirty が落ちて保存ボタンが再び無効になる」ことで判定する
      await expect(page.getByTestId('editor-save')).toBeDisabled({ timeout: 30_000 });

      // 保存後に DB から読み直す。url は入力値のまま、url_ は main が導出した値であり
      // DB 由来ではない（外部URLなので両者が同値になる）
      const doc = await page.evaluate((u) => (window as any).mapedit.request(u), uid);
      expect(doc.url).toBe(EXT_URL);
      expect(doc.url_).toBe(EXT_URL);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC15c: url 空 + タイル実体なしでもフォールバックへ合流する', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t7-fallback-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 寸法は確定しているがタイル実体が無い地図（seedSavedMap は width/height だけ入れ、
      // タイルは生成しない）。§6.1 が扱う「url 空 + タイル実体なし」の状態そのもの。
      const { uid } = await seedSavedMap(page);

      // (1) 開き直し経路の挙動を記録する。main の deriveRuntimeTileUrl は
      //     タイルが無いので undefined を返し、MaplatCore の addCommonOptions が
      //     相対 URL を合成して構築は成功する（設計 §6.1）。
      await openHash(page, `#/mapedit?uid=${uid}`, '[data-testid="map-title"]');
      await expect.poll(async () => (await mapUrlPair(page)).url, { timeout: 15_000 }).toBe('');
      const onLoad = await mapUrlPair(page);
      expect(onLoad.url_).toBeUndefined();

      // (2) 編集経路で同じ状態へ到達させる: 外部URLを入れて確定 → 空へ戻して確定
      await urlInput(page).fill(EXT_URL);
      await urlInput(page).blur();
      await expect.poll(async () => (await mapUrlPair(page)).url_, { timeout: 15_000 }).toBe(EXT_URL);
      const afterExternal = (await tileDebug(page)).exchangeCount;

      await urlInput(page).fill('');
      await urlInput(page).blur();
      await expect.poll(async () => (await mapUrlPair(page)).url, { timeout: 15_000 }).toBe('');

      // 設計 §6.1 の判断: (A) 交換する（フォールバック表示を受容）。
      // ∴ url_ は開き直し経路と同じ undefined になり、交換も実際に行われる。
      const afterCleared = await mapUrlPair(page);
      expect(afterCleared.url_).toBe(onLoad.url_);
      expect((await tileDebug(page)).exchangeCount).toBe(afterExternal + 1);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC15: width/height 未確定なら何もしない', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t7-nowh-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 画像をアップロードしていない新規地図（width/height 未確定）
      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      const before = (await tileDebug(page)).exchangeCount;

      await urlInput(page).fill(EXT_URL);
      await urlInput(page).blur();
      await page.waitForTimeout(1000);

      expect((await tileDebug(page)).exchangeCount).toBe(before);
      // 例外でページが壊れていないこと
      await expect(page.getByTestId('map-title')).toBeVisible();
    } finally {
      await quitElectronApplication(app);
    }
  });
});
