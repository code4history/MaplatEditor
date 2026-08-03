// M5-T8: 取り込み上限の自動化と機械限界の事前ブロック E2E。
//
// 検証する受け入れ条件（設計 §8.2 / §8.4 / §8.6）:
//   AC7   アプリ実機の main process baseline heapUsed を記録し、安全率 25% に収まる
//   AC13  jpeg_machine_limit の3数値（MP / 必要量 / 利用可能量）が実際に描画される
//   AC19  確認 Cancel でモーダルが閉じ、エラー表示が出ない
//   AC18e 確認 OK でファイル選択ダイアログが再表示されない（E2E 実経路での裏取り）
//
// 実起動を要する理由: main の構造化エラー → IPC → renderer の分岐 → ProgressModal の
// textParams → i18n 補間、および OS ダイアログの往復が全部繋がって初めて成立する。
// smoke（main 側サンドボックス）では「契約が返ること」までしか確かめられない。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

async function openHash(page: Page, hash: string, waitFor?: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
  if (waitFor) await expect(page.locator(waitFor)).toBeVisible({ timeout: 15_000 });
}

/**
 * ファイル選択と確認ダイアログの両方を差し替える。
 * 呼び出し回数を main 側に貯め、AC18e で「再表示していない」ことを数で示す。
 * `messageBoxResponse` は `dialog.showMessageBox` が返す response（0 = OK / 1 = Cancel）。
 */
async function installDialogHarness(
  app: ElectronApplication,
  imagePath: string | null,
  messageBoxResponse: number,
): Promise<void> {
  await app.evaluate(async ({ dialog }, { selectedImage, response }) => {
    const g = globalThis as any;
    g.__m5t8OpenDialogCalls = 0;
    g.__m5t8MessageBoxMessages = [];
    dialog.showOpenDialog = (async () => {
      g.__m5t8OpenDialogCalls += 1;
      return selectedImage === null
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [selectedImage] };
    }) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async (...args: any[]) => {
      const opts = args.length > 1 ? args[1] : args[0];
      g.__m5t8MessageBoxMessages.push(String(opts?.message ?? ''));
      return { response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, { selectedImage: imagePath, response: messageBoxResponse });
}

const readHarness = (app: ElectronApplication) =>
  app.evaluate(() => ({
    openDialogCalls: (globalThis as any).__m5t8OpenDialogCalls as number,
    messages: (globalThis as any).__m5t8MessageBoxMessages as string[],
  }));

/** ProgressModal のルート（m5-t6 spec と同一。v-if で出し入れする） */
const MODAL = '.modal.d-block';
const modalText = async (page: Page): Promise<string> =>
  (await page.locator(MODAL).innerText()).replace(/\s+/g, ' ');

/**
 * SOF ヘッダだけを持つ「JPEG のふり」をするファイルを書く。
 * 事前判定はヘッダしか読まないため、**巨大画像を実際に作らずに**判定経路へ入れる
 * （実体を作ると数分〜数十分かかり、E2E に載せられない）。
 */
async function writeSofOnlyJpeg(filePath: string, w: number, h: number): Promise<void> {
  const comps = [{ h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 }];
  const segLen = 8 + comps.length * 3;
  const buf = Buffer.alloc(2 + 2 + segLen);
  buf.writeUInt16BE(0xffd8, 0);
  buf.writeUInt16BE(0xffc0, 2);
  buf.writeUInt16BE(segLen, 4);
  buf.writeUInt8(8, 6);
  buf.writeUInt16BE(h, 7);
  buf.writeUInt16BE(w, 9);
  buf.writeUInt8(comps.length, 11);
  comps.forEach((c, i) => {
    const o = 12 + i * 3;
    buf.writeUInt8(i + 1, o);
    buf.writeUInt8((c.h << 4) | c.v, o + 1);
    buf.writeUInt8(0, o + 2);
  });
  await writeFile(filePath, buf);
}

/**
 * main の V8 ヒープ統計。Electron の `process.getHeapStatistics()` を使う
 * （`app.evaluate` の中では動的 import が main のバンドルへ解決されてしまい使えない。実測）。
 * 単位はキロバイト。
 */
const readHeapStats = (app: ElectronApplication) =>
  app.evaluate(() => {
    const s = (process as any).getHeapStatistics();
    return {
      heapSizeLimitMB: s.heapSizeLimit / 1024,
      heapUsedMB: process.memoryUsage().heapUsed / 1024 / 1024,
    };
  });

/**
 * 機械安全枠を確実に超える寸法。
 * V8 のヒープ上限は Electron のポインタ圧縮ビルドにより **4 GiB が天井**であり
 * （m5-t8 設計 §3.1(c)）、その 75% から 128 MiB を引いた枠でも 4:4:4 で 700 MP 前後が限界である。
 * ∴ 3600 MP は物理メモリの大小によらず必ず超える。**式を再実装せずに済む寸法**を選ぶ。
 */
const OVER_MACHINE_LIMIT_SIDE = 60000;   // 60000 x 60000 = 3600 MP

test.describe('M5-T8 取り込み上限の自動化と機械限界の事前ブロック', () => {
  test('AC7: アプリ実機 main の baseline heapUsed が安全率 25% に収まる', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t8-baseline-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 地図編集画面まで開いてサービス層を一通り起こしてから測る
      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      const observed = await readHeapStats(app);
      // decodeSafety は heap_size_limit の 25% をアプリ自身のぶんとして残している。
      // その見込みが実機で成り立っているかを記録し、成り立たなければ落とす
      const reservedMB = observed.heapSizeLimitMB * 0.25;
      console.log(
        `AC7 実測: main baseline heapUsed = ${observed.heapUsedMB.toFixed(1)} MiB / `
        + `heap_size_limit = ${observed.heapSizeLimitMB.toFixed(1)} MiB / `
        + `安全率で確保している枠 = ${reservedMB.toFixed(1)} MiB`,
      );
      expect(observed.heapUsedMB).toBeLessThan(reservedMB);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC13: 機械限界のとき MP・必要量・利用可能量の3数値が実際に描画される', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t8-machine-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 実体は無い（＝デコードには到達し得ない）。寸法は機体によらず安全枠を超える値を選ぶ
      const side = OVER_MACHINE_LIMIT_SIDE;
      const imagePath = path.join(e2eRoot, 'machine-limit.jpg');
      await writeSofOnlyJpeg(imagePath, side, side);

      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      await installDialogHarness(app, imagePath, 0);
      await page.getByRole('button', { name: '地図画像登録' }).click();

      const okButton = page.getByRole('button', { name: 'OK' });
      await expect(okButton).toBeEnabled({ timeout: 60_000 });

      const text = await modalText(page);
      // 汎用文言ではなく、機械限界の具体文言が出ていること
      expect(text).not.toContain('地図画像登録でエラーが発生しました');
      expect(text).toContain('画像を縮小してから取り込んでください');
      expect(text).toContain(String(Math.round((side * side) / 1e6)));   // MP（投入寸法から決まる）

      // 必要量と利用可能量が**両方**描画され、必要量のほうが大きいこと。
      // 個々の期待値を式で再現すると製品実装の写経になるため、関係だけを検査する
      const numbers = [...text.matchAll(/約 ([\d,]+) MB/g)].map((m) => Number(m[1].replace(/,/g, '')));
      expect(numbers).toHaveLength(2);
      expect(numbers[0]).toBeGreaterThan(numbers[1]);   // 必要量 > 利用可能量

      // ハードブロックなので確認ダイアログは出していない（人間指示: 確認で通す価値がない）
      const harness = await readHarness(app);
      expect(harness.messages).toEqual([]);
      await okButton.click();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC19: 所要時間の確認を Cancel するとモーダルが閉じ、エラーも出ない', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t8-cancel-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 100 MP 超・かつ機械安全枠内（確認だけが発火する帯）
      const imagePath = path.join(e2eRoot, 'long-import.jpg');
      await writeSofOnlyJpeg(imagePath, 12000, 10000);   // 120 MP

      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      await installDialogHarness(app, imagePath, 1);     // 1 = Cancel
      await page.getByRole('button', { name: '地図画像登録' }).click();

      // モーダルが閉じ、エラー文言も出ていない
      await expect(page.locator(MODAL)).toBeHidden({ timeout: 30_000 });
      expect(await page.locator('body').innerText()).not.toContain('エラーが発生しました');

      // 確認は「出た」うえで Cancel したのであること（出ていないのに閉じた、ではない）
      const harness = await readHarness(app);
      expect(harness.messages).toHaveLength(1);
      expect(harness.messages[0]).toContain('120');
      expect(harness.messages[0]).toContain('取り込みに長い時間がかかります');
      expect(harness.openDialogCalls).toBe(1);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC18e: 確認 OK でファイル選択ダイアログが再表示されない', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t8-confirm-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const imagePath = path.join(e2eRoot, 'long-import.jpg');
      await writeSofOnlyJpeg(imagePath, 12000, 10000);   // 120 MP

      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      await installDialogHarness(app, imagePath, 0);     // 0 = OK
      await page.getByRole('button', { name: '地図画像登録' }).click();

      // SOF だけのファイルなのでデコードは失敗する。ここで見るのは
      // 「確認 OK のあと、ファイル選択を出し直さずにデコードまで進んだ」ことである
      const okButton = page.getByRole('button', { name: 'OK' });
      await expect(okButton).toBeEnabled({ timeout: 60_000 });

      const harness = await readHarness(app);
      expect(harness.messages).toHaveLength(1);          // 確認は1回だけ
      expect(harness.openDialogCalls).toBe(1);           // ★ 再表示していない
      // 確認要求が UI へ再度返ってきていない（往復が1周で終わっている）
      expect(await modalText(page)).not.toContain('取り込みに長い時間がかかります');
      await okButton.click();
    } finally {
      await quitElectronApplication(app);
    }
  });
});
