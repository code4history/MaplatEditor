// nov26-m6-t4（NayutaProducts#26）: AppSourceEditor の書き込み経路の挙動固定 E2E。
//
// #26 は AppSourceEditor.vue が prop（source）を直接書き換えていた 3 箇所（computed の副作用・
// writeOverride・clearOverride）を `update:source` の emit へ置き換える。置き換えは挙動を
// 変えてはならないので、**直す前の master で本 spec を緑にしてから**直す（設計 §6-2・AC1）。
//
// 断言するのは「保存した apps.data_json の該当ソース」（window.appedit.request で読み戻す）と
// 画面の表示。操作は書き込み経路の呼び出し元を全部通す:
//   (a) ベースマップのラベルの上書き・空にする（setLangResource → writeOverride / clearOverride）
//   (b) 数値の上書きと消去（setNumber。mercator シフト。m19-t3 で minZoom 等は撤去済みのため、
//       setNumber の唯一の利用者である overlay の mercatorXShift で通す）
//   (c) 範囲の bbox の入力（setBboxPart）と消去（clearEnvelope）
//   (d) 「存在範囲からコピー」（copyCoverageToEnvelope）
//   (e) Maplat 地図のラベルの設定・空にする
//   (f) 元に戻す（undo）で直前の値に戻る（@change → recordHistory の記録）
// overrides が空になったときの形（{} を残す）も保存結果で固定する（設計 R2）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const COVERAGE_LNG_LATS: [number, number][] = [
  [130.25, 32.5],
  [131.75, 32.5],
  [131.75, 33.25],
  [130.9, 33.8],
  [130.25, 33.25],
];
const COVERAGE_BBOX = ['130.25', '32.5', '131.75', '33.8'];

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  // 外部タイルへ出ない（中身は断言しない）
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('https://example.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  // AppEdit の保存は main 側の確認ダイアログを挟む（m6-t10・m18-t2 と同一の stub）
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

// Maplat 地図 1 件（label を持つ）と、その地図だけをソースに持つアプリを IPC で作る
async function seedMapAndApp(page: Page, suffix: string): Promise<{ mapUid: string; appUid: string; appSlug: string }> {
  return await page.evaluate(async (sfx: string) => {
    const mapSlug = `t4-map-${sfx}`;
    const mapObject = {
      mapID: mapSlug,
      title: { ja: 'T4 地図表題' },
      label: { ja: 'T4 地図ラベル' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
      gcps: [], edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
    };
    const map = await window.mapedit.save({ slug: mapSlug, mapObject, tins: [] });
    if (!map || map.result !== 'Success') throw new Error(`map create failed: ${JSON.stringify(map)}`);
    const appSlug = `t4-app-${sfx}`;
    const saved = await window.appedit.save({ slug: appSlug, document: {
      appID: appSlug, appName: { ja: 'T4 App' }, title: { ja: 'T4 App' },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: [{ sourceType: 'maplat', mapUid: map.uid, mapSlug, role: 'maplat', startFrom: true }],
      pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
    return { mapUid: map.uid as string, appUid: saved.uid as string, appSlug };
  }, suffix);
}

async function saveNow(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
}

// 保存済みの文書から該当ソースを読み戻す
async function savedSource(page: Page, appUid: string, match: { sourceType?: string; mapUid: string }): Promise<any> {
  const doc = await page.evaluate(async (uid: string) => await window.appedit.request(uid), appUid);
  const found = (doc?.sources ?? []).find((s: any) =>
    s.mapUid === match.mapUid && (match.sourceType ? s.sourceType === match.sourceType : true));
  expect(found, `保存した文書に ${match.mapUid} のソースがある`).toBeTruthy();
  return found;
}

test('nov26-m6-t4 AC1: AppSourceEditor の書き込み経路（ラベル・数値・範囲・コピー・Maplat ラベル・undo）の挙動', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-nov26-m6-t4-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const suffix = `${Date.now()}`;
    const masterSlug = `t4-base-${suffix}`;
    // AppEdit へ入る前に seed する（baseMapMasters は onMounted で 1 回読むだけ）
    await seedBaseMap(page, masterSlug, baseMapMasterDoc({
      kind: 'tms',
      maptype: null,
      url: 'https://example.com/{z}/{x}/{y}.png',
      title: { ja: 'T4 マスタ表題' },
      label: { ja: 'T4 マスタラベル' },
      coverageLngLats: COVERAGE_LNG_LATS,
    }));
    const { mapUid, appUid } = await seedMapAndApp(page, suffix);

    await page.evaluate((uid: string) => { location.hash = `#/appedit?uid=${uid}`; }, appUid);
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-sources-tab').click();

    // ベースマップのソースを UI で足す（addBaseMapSource の経路）
    await page.getByTestId('app-basemap-mode').click();
    await page.getByTestId('app-basemap-search').fill(masterSlug);
    await expect(page.getByTestId(`app-basemap-row-${masterSlug}`)).toBeVisible({ timeout: 30000 });
    await page.getByTestId(`app-basemap-row-${masterSlug}`).click();
    const baseCard = page.getByTestId(`app-selected-source-${masterSlug}`);
    await expect(baseCard).toBeVisible();
    const mapCard = page.getByTestId(`app-selected-source-${mapUid}`);
    await expect(mapCard).toBeVisible();

    await saveNow(page);
    let base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.overrides, '追加直後の overrides は空のオブジェクト').toEqual({});
    expect('label' in base, '追加直後は label を持たない').toBe(false);

    // ---- (a) ベースマップのラベルの上書き → 空にする（マスタへ戻る）----
    const baseLabel = baseCard.getByTestId('app-source-override-label');
    await expect(baseLabel).toHaveValue('');
    await expect(baseLabel).toHaveAttribute('placeholder', 'T4 マスタラベル');
    await baseLabel.fill('上書きラベル');
    await baseLabel.press('Tab');
    await expect(baseLabel).toHaveValue('上書きラベル');
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.label, '(a) label は言語オブジェクトでトップレベルに保存される').toEqual({ ja: '上書きラベル' });
    expect(base.overrides).toEqual({});

    await baseLabel.fill('');
    await baseLabel.press('Tab');
    await expect(baseLabel).toHaveValue('');
    await expect(baseLabel).toHaveAttribute('placeholder', 'T4 マスタラベル');
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect('label' in base, '(a) 空にすると label のキーごと消える').toBe(false);
    expect(base.overrides).toEqual({});

    // ---- (b) 数値の上書きと消去（overlay の mercatorXShift）----
    await baseCard.locator('select.form-select-sm').first().selectOption('overlay');
    const xShift = baseCard.getByTestId('app-source-override-mercatorXShift');
    await expect(xShift).toBeVisible();
    await xShift.fill('1.25');
    await xShift.press('Tab');
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.role).toBe('overlay');
    expect(base.overrides, '(b) 数値は overrides に数値で入る').toEqual({ mercatorXShift: 1.25 });

    await xShift.fill('');
    await xShift.press('Tab');
    await expect(xShift).toHaveValue('');
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.overrides, '(b) 消去するとキーが消え、空の {} が残る').toEqual({});

    // ---- (c) 範囲の bbox の入力と消去 ----
    const envelopeInputs = baseCard.getByTestId('app-source-override-envelopeLngLats').locator('.envelope-input input');
    await expect(envelopeInputs).toHaveCount(4);
    // 東（index 2）から入れる: 初期の bbox は [0,0,0,0] なので、西を先に入れると
    // 外接矩形の正規化で欄が入れ替わる。ここでは入れ替わらない順で通す
    await envelopeInputs.nth(2).fill('140');
    await envelopeInputs.nth(2).press('Tab');
    await expect(envelopeInputs.nth(2)).toHaveValue('140');
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.overrides, '(c) 1 欄の入力で残りは 0 の bbox（4 隅）が入る').toEqual({
      envelopeLngLats: [[0, 0], [140, 0], [140, 0], [0, 0]],
    });
    const bboxAfterOne = await Promise.all([0, 1, 2, 3].map((i) => envelopeInputs.nth(i).inputValue()));
    expect(bboxAfterOne).toEqual(['0', '0', '140', '0']);

    await envelopeInputs.nth(3).fill('36');
    await envelopeInputs.nth(3).press('Tab');
    await expect(envelopeInputs.nth(3)).toHaveValue('36');
    const clearEnv = baseCard.getByTestId('app-source-clear-envelopeLngLats');
    await expect(clearEnv).toBeVisible();
    await clearEnv.click();
    for (let i = 0; i < 4; i += 1) await expect(envelopeInputs.nth(i)).toHaveValue('');
    await expect(clearEnv).toHaveCount(0);
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.overrides, '(c) 消去で envelopeLngLats が消え、{} が残る').toEqual({});

    // ---- (d) 存在範囲からコピー ----
    await baseCard.getByTestId('app-source-copy-coverage-envelopeLngLats').click();
    for (let i = 0; i < 4; i += 1) await expect(envelopeInputs.nth(i)).toHaveValue(COVERAGE_BBOX[i]);
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.overrides, '(d) 存在範囲の生の点列がそのまま写る').toEqual({ envelopeLngLats: COVERAGE_LNG_LATS });

    // ---- (f) 元に戻す: コピーの前（範囲なし）へ戻る ----
    await page.getByTestId('editor-undo').click();
    for (let i = 0; i < 4; i += 1) await expect(envelopeInputs.nth(i), '(f) undo でコピー前に戻る').toHaveValue('');
    await saveNow(page);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect(base.overrides, '(f) undo 後の保存結果はコピー前と同じ').toEqual({});

    // ---- (e) Maplat 地図のラベルの設定・空にする ----
    const mapLabel = mapCard.getByTestId('app-source-maplat-label');
    await expect(mapLabel).toBeVisible();
    await expect(mapLabel).toHaveValue('');
    await mapLabel.fill('アプリでの地図ラベル');
    await mapLabel.press('Tab');
    await expect(mapLabel).toHaveValue('アプリでの地図ラベル');
    await saveNow(page);
    let mapSource = await savedSource(page, appUid, { sourceType: 'maplat', mapUid });
    expect(mapSource.label, '(e) Maplat のラベルは言語オブジェクトで保存される').toEqual({ ja: 'アプリでの地図ラベル' });
    expect('overrides' in mapSource, '(e) Maplat のソースには overrides が生えない').toBe(false);

    // (f) undo で設定前（ラベルなし）へ、redo で設定後へ戻る
    await page.getByTestId('editor-undo').click();
    await expect(mapLabel, '(f) undo で Maplat のラベルが設定前に戻る').toHaveValue('');
    await page.getByTestId('editor-redo').click();
    await expect(mapLabel, '(f) redo で戻る').toHaveValue('アプリでの地図ラベル');

    // (f) ベースマップのラベルの undo: 入力 → undo で空欄へ戻る
    // （最後を保存で終える: 未保存の編集を残したまま終了すると、終了時の下書きの書き出しを
    //   挟み、高負荷時に Electron の終了が 30 秒を超えることがあった）
    await baseLabel.fill('二度目のラベル');
    await baseLabel.press('Tab');
    await expect(baseLabel).toHaveValue('二度目のラベル');
    await page.getByTestId('editor-undo').click();
    await expect(baseLabel, '(f) undo でベースマップのラベルが空欄（マスタ）へ戻る').toHaveValue('');
    await expect(baseLabel).toHaveAttribute('placeholder', 'T4 マスタラベル');

    await mapLabel.fill('');
    await mapLabel.press('Tab');
    await expect(mapLabel).toHaveValue('');
    await saveNow(page);
    mapSource = await savedSource(page, appUid, { sourceType: 'maplat', mapUid });
    expect('label' in mapSource, '(e) 空にすると label のキーごと消える').toBe(false);
    expect('overrides' in mapSource).toBe(false);
    base = await savedSource(page, appUid, { sourceType: 'tms', mapUid: masterSlug });
    expect('label' in base, '(f) undo したベースマップのラベルは保存されない').toBe(false);
    expect(base.overrides).toEqual({});

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
