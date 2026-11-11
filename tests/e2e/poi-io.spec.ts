// POI のエクスポート (GeoJSON・zip・CSV・JSON) と取り込みの E2E (実 Electron)。
// ネイティブの保存ダイアログ・メッセージボックスは差し替え、書き出されたファイルを期待値と比べる。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests/fixtures/poi-io');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

// 画面の言語を ja に固定する。i18next は起動時に一度だけ settings の lang を読むので、
// 設定を書いた後に再読み込みして初期化し直す (settings.set だけでは起動中の画面の言語は変わらない)。
// これが無いと、OS の言語が en の環境で ja の語の検査が空振りしたり、ja の文言との比較が落ちたりする
async function useJapaneseUi(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.evaluate(() => document.documentElement.innerText.length)).toBeGreaterThan(0);
}

async function stubDialogs(app: ElectronApplication, savePath: string): Promise<void> {
  await app.evaluate(({ dialog }, out) => {
    (globalThis as any).__poiIoMessages = [];
    (globalThis as any).__poiIoSaveCalls = [];
    dialog.showSaveDialog = (async (...args: any[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) ?? {};
      (globalThis as any).__poiIoSaveCalls.push({ filters: options.filters });
      return { canceled: false, filePath: out };
    }) as typeof dialog.showSaveDialog;
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) ?? {};
      (globalThis as any).__poiIoMessages.push({ message: options.message, detail: options.detail });
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, savePath);
}

async function seedRoundtripSource(page: Page, fc: unknown): Promise<string> {
  return page.evaluate(async (source) => {
    const slug = `poi-io-${Date.now()}`;
    const created = await window.poiSources.createLocal({ slug, title: { ja: '書き出し試験' }, lang: 'ja' });
    if (!created || created.result !== 'Success') throw new Error(`create failed: ${JSON.stringify(created)}`);
    const saved = await window.poiSources.save(created.uid, { slug, title: { ja: '書き出し試験' }, fc: source });
    if (!saved || saved.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saved)}`);
    return created.uid;
  }, fc);
}

async function openSource(page: Page, uid: string): Promise<void> {
  await page.evaluate((hash) => { location.hash = hash; }, `#/poisources/${uid}`);
  await page.waitForSelector('.editor-action-header', { timeout: 15000 });
  await expect(page.locator('[data-editor-action="export"]')).toBeEnabled({ timeout: 15000 });
}

type PoiExportFormat = 'geojson' | 'csv' | 'json';

// ヘッダの「エクスポート」→ 選択ダイアログで形式 (と画像) を選ぶ → 確定。完了の通知まで待つ
async function runExport(
  _app: ElectronApplication,
  page: Page,
  format: PoiExportFormat,
  images?: { includeImages: boolean },
) {
  const previous = page.getByTestId('operation-notice');
  if (await previous.isVisible()) await previous.locator('[data-diagnostic-dismiss]').click();
  await page.locator('[data-editor-action="export"]').click();
  await expect(page.getByTestId('poi-export-options')).toBeVisible();
  await page.getByTestId(`poi-export-format-${format}`).check();
  if (images) await page.getByTestId('poi-export-option-images').setChecked(images.includeImages);
  await page.getByTestId('poi-export-options-confirm').click();
  await expect(page.getByTestId('poi-export-options')).toBeHidden();
  const notice = page.getByTestId('operation-notice');
  // 本文が書き出しの完了になるまで待つ（未保存から保存して書き出すときの「保存できました」と取り違えない）
  await expect(notice.locator('.editor-diagnostic__message').first()).toContainText('エクスポートしました', { timeout: 30_000 });
  await expect(notice).toHaveAttribute('data-diagnostic-severity', 'success');
  const messages = await notice.locator('.editor-diagnostic__message').allTextContents();
  return [{ message: messages[0], detail: messages.slice(1).join('\n') }];
}

async function saveCalls(app: ElectronApplication): Promise<{ filters: { name: string; extensions: string[] }[] }[]> {
  return app.evaluate(() => (globalThis as any).__poiIoSaveCalls);
}

// アイコンセットの参照 (どの環境でも実体がある) を持つ POI 1 件
const ICON_SOURCE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', id: 'icon-1', geometry: { type: 'Point', coordinates: [139.7, 35.7] },
    properties: { name: 'アイコンの POI', icon: 'builtin:defaultpin-blue' },
  }],
};

test.describe('POI のエクスポート', () => {
  test('CSV: 期待値とバイト単位で一致し、省かれた項目が報告される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-csv-'));
    const out = path.join(e2eRoot, 'out.csv');
    const { app, page } = await launch(e2eRoot);
    try {
      await useJapaneseUi(page);
      const fc = JSON.parse(await readFile(path.join(fixtureDir, 'roundtrip-source.json'), 'utf8'));
      const uid = await seedRoundtripSource(page, fc);
      await stubDialogs(app, out);
      await openSource(page, uid);
      const messages = await runExport(app, page, 'csv');
      const expected = await readFile(path.join(fixtureDir, 'expected-export.csv'));
      expect(Buffer.compare(await readFile(out), expected)).toBe(0);
      // 省かれた項目 (html・その他の項目) の報告。画像の項目は選ぶ時点で分かるので挙げない
      const detail = messages.at(-1)?.detail ?? '';
      expect(detail).toContain('HTML');
      expect(detail).toContain('GeoJSON');
      for (const word of ['資産', 'アセット', 'アイコン', 'Asset', 'Icon']) expect(detail).not.toContain(word);
      expect((await saveCalls(app)).map((call) => call.filters[0].extensions)).toEqual([['csv']]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('JSON: POI の配列で、HTML・独自の項目・アセットの参照が保たれる', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-json-'));
    const out = path.join(e2eRoot, 'out.json');
    const { app, page } = await launch(e2eRoot);
    try {
      const fc = JSON.parse(await readFile(path.join(fixtureDir, 'roundtrip-source.json'), 'utf8'));
      const uid = await seedRoundtripSource(page, fc);
      await stubDialogs(app, out);
      await openSource(page, uid);
      const messages = await runExport(app, page, 'json');
      const expected = JSON.parse(await readFile(path.join(fixtureDir, 'expected-export.json'), 'utf8'));
      expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(expected);
      // JSON の完了の通知に注意は付かない
      expect(messages.at(-1)?.detail ?? '').toBe('');
      expect((await saveCalls(app)).map((call) => call.filters[0].extensions)).toEqual([['json']]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('GeoJSON: 既定 (画像を含める) は zip に画像のアイコンを同梱し、含めないと参照が残る GeoJSON', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-geojson-'));
    const outZip = path.join(e2eRoot, 'out.zip');
    const outGeo = path.join(e2eRoot, 'out.geojson');
    const { app, page } = await launch(e2eRoot);
    try {
      const uid = await seedRoundtripSource(page, ICON_SOURCE);
      await openSource(page, uid);

      // (a) 既定のまま確定 → zip
      await stubDialogs(app, outZip);
      await runExport(app, page, 'geojson');
      expect((await saveCalls(app)).map((call) => call.filters[0].extensions)).toEqual([['zip']]);
      const entries = new AdmZip(outZip).getEntries().map((entry) => entry.entryName).sort();
      expect(entries).toHaveLength(2);
      expect(entries).toContain('imgs/icons/builtin/defaultpin-blue.svg');
      expect(entries.filter((name) => /^pois\/[^/]+\.geojson$/.test(name))).toHaveLength(1);

      // (b) 画像を含めない → GeoJSON。アイコンセットの参照は値のまま
      await stubDialogs(app, outGeo);
      await runExport(app, page, 'geojson', { includeImages: false });
      expect((await saveCalls(app)).map((call) => call.filters[0].extensions)).toEqual([['geojson', 'json']]);
      const geo = JSON.parse(await readFile(outGeo, 'utf8'));
      expect(geo.type).toBe('FeatureCollection');
      expect(geo.features[0].properties.icon).toBe('builtin:defaultpin-blue');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('選択ダイアログ: 画像は GeoJSON だけ・選択を覚えない・キャンセルで保存しない・未保存の確認が先', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-options-'));
    const out = path.join(e2eRoot, 'out.geojson');
    const { app, page } = await launch(e2eRoot);
    try {
      await useJapaneseUi(page);
      const uid = await seedRoundtripSource(page, ICON_SOURCE);
      await stubDialogs(app, out);
      await openSource(page, uid);
      const dialog = page.getByTestId('poi-export-options');
      const images = page.getByTestId('poi-export-option-images');

      // (a) CSV・JSON では画像を選べずオフ。GeoJSON に戻すと有効でオン
      await page.locator('[data-editor-action="export"]').click();
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('poi-export-format-geojson')).toBeChecked();
      await expect(images).toBeEnabled();
      await expect(images).toBeChecked();
      for (const format of ['csv', 'json'] as const) {
        await page.getByTestId(`poi-export-format-${format}`).check();
        await expect(images).toBeDisabled();
        await expect(images).not.toBeChecked();
      }
      await page.getByTestId('poi-export-format-geojson').check();
      await expect(images).toBeEnabled();
      await expect(images).toBeChecked();

      // (b) オフにして取り消し、開き直すと既定 (GeoJSON・オン) に戻る
      await images.uncheck();
      await page.getByTestId('poi-export-format-csv').check();
      // (c) キャンセルでは保存ダイアログを呼ばない
      await page.getByTestId('poi-export-options-cancel').click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('[data-editor-action="export"]')).toBeEnabled();
      expect(await saveCalls(app)).toHaveLength(0);
      await page.locator('[data-editor-action="export"]').click();
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('poi-export-format-geojson')).toBeChecked();
      await expect(images).toBeChecked();
      await page.getByTestId('poi-export-options-cancel').click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('[data-editor-action="export"]')).toBeEnabled();
      expect(await saveCalls(app)).toHaveLength(0);
      expect(await app.evaluate(() => (globalThis as any).__poiIoMessages.length)).toBe(0);

      // (d) 未保存の変更があると、選択ダイアログより先に「保存してエクスポート」の確認が出る
      await page.getByTestId('poi-title').locator('input').fill('未保存の題');
      await page.locator('[data-editor-action="export"]').click();
      await expect(dialog).toBeVisible({ timeout: 15000 });
      // 選択ダイアログが見えた時点で、確認 (と、それを受けた保存の通知) は出終わり、保存ダイアログはまだ
      const before = await app.evaluate(() => (globalThis as any).__poiIoMessages as { message: string }[]);
      expect(before[0]?.message).toBe('未保存の変更があります。エクスポートの方法を選んでください。');
      expect(await saveCalls(app)).toHaveLength(0);
      await page.getByTestId('poi-export-options-confirm').click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('operation-notice')).toContainText('エクスポートしました。');
      expect(await saveCalls(app)).toHaveLength(1);
      const after = await app.evaluate(() => (globalThis as any).__poiIoMessages as { message: string }[]);
      expect(after).toEqual(before); // 通知はネイティブ確認を増やさない
    } finally {
      await quitElectronApplication(app);
    }
  });
});

// ---------------------------------------------------------------------------
// 取り込み（CSV）: 追記・上書き・文字コード・誤りの表・読み取り専用・新しいソースを作る取り込み
// ---------------------------------------------------------------------------

async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
  }, filePath);
}

async function seedMergeSource(page: Page): Promise<{ uid: string; slug: string }> {
  const fc = JSON.parse(await readFile(path.join(fixtureDir, 'merge-existing.json'), 'utf8'));
  return page.evaluate(async (source) => {
    const slug = `poi-merge-${Date.now()}`;
    const created = await window.poiSources.createLocal({ slug, title: { ja: '取り込み試験' }, lang: 'ja' });
    if (!created || created.result !== 'Success') throw new Error(`create failed: ${JSON.stringify(created)}`);
    const saved = await window.poiSources.save(created.uid, { slug, title: { ja: '取り込み試験' }, fc: source });
    if (!saved || saved.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saved)}`);
    return { uid: created.uid, slug };
  }, fc);
}

async function openForImport(page: Page, uid: string): Promise<void> {
  await page.evaluate((hash) => { location.hash = hash; }, `#/poisources/${uid}`);
  await page.waitForSelector('.editor-action-header', { timeout: 15000 });
  await expect(page.locator('[data-editor-action="poi-merge-import"]')).toBeEnabled({ timeout: 15000 });
}

async function pickCsv(app: ElectronApplication, page: Page, csvPath: string): Promise<void> {
  await stubOpenDialog(app, csvPath);
  await page.locator('[data-editor-action="poi-merge-import"]').click();
  await expect(page.getByTestId('poi-merge-import-dialog')).toBeVisible({ timeout: 15000 });
}

async function summaryOf(page: Page): Promise<Record<string, string | null>> {
  const el = page.getByTestId('poi-merge-summary');
  const keys = ['added', 'updated', 'unchanged', 'kept', 'renamed', 'skipped'];
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = await el.getAttribute(`data-${k}`);
  return out;
}

async function saveAndRead(page: Page, uid: string) {
  await page.getByTestId('editor-save').click();
  await expect.poll(async () => page.evaluate(async (u) => (await window.poiSources.get(u))?.featureCount ?? -1, uid)).toBeGreaterThan(-1);
  return page.evaluate(async (u) => window.poiSources.get(u), uid);
}

test.describe('POI の CSV 取り込み', () => {
  test('追記: プレビューが 追加 3・名前変更 1・除く 1 で、取り込むと 6 件。Undo で 3 件に戻る', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-append-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMergeSource(page);
      await openForImport(page, uid);
      await expect(page.locator('.poi-feature-row')).toHaveCount(3);
      await pickCsv(app, page, path.join(fixtureDir, 'demo-merge.csv'));
      await expect(page.getByTestId('poi-merge-mode-append')).toBeChecked();
      expect(await summaryOf(page)).toMatchObject({ added: '3', renamed: '1', skipped: '1' });
      await page.getByTestId('poi-merge-confirm').click();
      await expect(page.getByTestId('poi-merge-import-dialog')).toBeHidden();
      await expect(page.locator('.poi-feature-row')).toHaveCount(6);
      await expect(page.getByTestId('poi-merge-result')).toBeVisible();
      // 取り消し (1 回で 3 件に戻る)
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await expect(page.locator('.poi-feature-row')).toHaveCount(3);
      // 取り込み結果の表示は Undo の後に残らない
      await expect(page.getByTestId('poi-merge-result')).toBeHidden();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('上書き: 追加 2・更新 2・残る 1。取り込むと 5 件で shrine-2 の名前が変わり address は東京都のまま', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-overwrite-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMergeSource(page);
      await openForImport(page, uid);
      await pickCsv(app, page, path.join(fixtureDir, 'demo-merge.csv'));
      await page.getByTestId('poi-merge-mode-overwrite').check();
      expect(await summaryOf(page)).toMatchObject({ added: '2', updated: '2', kept: '1' });
      await page.getByTestId('poi-merge-confirm').click();
      await expect(page.locator('.poi-feature-row')).toHaveCount(5);
      const detail = await saveAndRead(page, uid);
      const byId = new Map<string, any>(detail.fc.features.map((f: any) => [f.id, f]));
      expect(detail.fc.features).toHaveLength(5);
      expect(byId.get('shrine-2').properties.name).toEqual({ ja: '稲荷神社(改)', en: 'Inari Shrine' });
      expect(byId.get('shrine-2').properties.address).toEqual({ ja: '東京都' });
      expect(byId.get('temple-1').properties.name).toEqual({ ja: '東光寺' });
      expect(byId.has('p1')).toBe(true);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('Shift_JIS の CSV で名前が化けない（実 Electron の TextDecoder）', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-sjis-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMergeSource(page);
      await openForImport(page, uid);
      await pickCsv(app, page, path.join(fixtureDir, 'names-sjis.csv'));
      await expect(page.getByTestId('poi-merge-encoding')).toHaveAttribute('data-encoding', 'shift_jis');
      await expect(page.getByTestId('poi-merge-preview')).toContainText('日本橋');
      await page.getByTestId('poi-merge-confirm').click();
      const detail = await saveAndRead(page, uid);
      const added = detail.fc.features.find((f: any) => f.id === 'j-1');
      expect(added.properties.name).toEqual({ ja: '日本橋' });
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('誤りの CSV: issue の表に行 3〜8 が出て（行 7 は警告）、取り込むと 2 件', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-errors-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMergeSource(page);
      await openForImport(page, uid);
      await pickCsv(app, page, path.join(fixtureDir, 'demo-errors.csv'));
      const rows = page.getByTestId('poi-merge-issue-row');
      const seen = await rows.evaluateAll((nodes) => nodes.map((n) => `${n.getAttribute('data-line')}:${n.getAttribute('data-code')}:${n.getAttribute('data-level')}`));
      for (const key of ['3:coord-range:error', '4:coord-missing:error', '5:file-duplicate-id:error', '6:display-id-charset:error', '7:image-dropped:warning', '8:name-required:error']) {
        expect(seen).toContain(key);
      }
      const lines = new Set(seen.map((k) => Number(k.split(':')[0])));
      for (const line of [3, 4, 5, 6, 7, 8]) expect(lines.has(line)).toBe(true);
      await expect(page.getByTestId('poi-merge-confirm')).toBeEnabled();
      await page.getByTestId('poi-merge-confirm').click();
      await expect(page.locator('.poi-feature-row')).toHaveCount(3 + 2);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('読み取り専用（remote）のソースでは取り込みのボタンが無効。翻訳モードでも無効', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-readonly-'));
    const remoteFc = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'spot', geometry: { type: 'Point', coordinates: [141.35, 43.06] }, properties: { name: 'リモートのスポット' } }],
    });
    const server: Server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(remoteFc); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/pois.geojson`;
    const { app, page } = await launch(e2eRoot);
    try {
      const remoteUid = await page.evaluate(async (u) => {
        const r = await window.poiSources.registerRemote({ slug: `poi-io-remote-${Date.now()}`, title: { ja: 'リモート' }, url: u, lang: 'ja' });
        if (!r || r.result !== 'Success') throw new Error(`registerRemote: ${JSON.stringify(r)}`);
        return r.uid as string;
      }, url);
      await page.evaluate((hash) => { location.hash = hash; }, `#/poisources/${remoteUid}`);
      await page.waitForSelector('.editor-action-header', { timeout: 15000 });
      await expect(page.locator('[data-editor-action="clone"]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-editor-action="poi-merge-import"]')).toBeDisabled();
      // エクスポートは読み取り専用でもヘッダに出て有効。表の書き出しのボタンは無い
      await expect(page.locator('[data-editor-action="export"]')).toBeVisible();
      await expect(page.locator('[data-editor-action="export"]')).toBeEnabled();
      await expect(page.locator('[data-editor-action="poi-export-table"]')).toHaveCount(0);
      // 翻訳モード (既定言語以外の編集) でも構造の編集は禁止
      const { uid } = await seedMergeSource(page);
      await openForImport(page, uid);
      await page.locator('[data-editor-action="language"]').selectOption('en');
      await expect(page.locator('[data-editor-action="poi-merge-import"]')).toBeDisabled();
      await page.locator('[data-editor-action="language"]').selectOption('ja');
      await expect(page.locator('[data-editor-action="poi-merge-import"]')).toBeEnabled();
    } finally {
      await quitElectronApplication(app);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('KML: 2 件取り込め、除く行と警告の表が出る。取り込むと 5 件。保存すると結果の表示が消える', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-kml-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMergeSource(page);
      await openForImport(page, uid);
      await pickCsv(app, page, path.join(fixtureDir, 'demo.kml'));
      await expect(page.getByTestId('poi-merge-encoding')).toHaveAttribute('data-encoding', 'utf-8');
      // 取り込む 2 件・除く 3 件（線・面・経緯度が逆の点）
      expect(await summaryOf(page)).toMatchObject({ added: '2', skipped: '3' });
      const seen = await page.getByTestId('poi-merge-issue-row').evaluateAll((nodes) => nodes.map((n) => `${n.getAttribute('data-line')}:${n.getAttribute('data-code')}:${n.getAttribute('data-level')}`));
      for (const key of ['12:coord-range:error', '10:kml-non-point-skipped:warning', '11:kml-non-point-skipped:warning']) expect(seen).toContain(key);
      expect(seen.some((k) => k.includes('kml-description-html-flattened'))).toBe(true);
      await expect(page.getByTestId('poi-merge-preview')).toContainText('浅草寺');
      await page.getByTestId('poi-merge-confirm').click();
      await expect(page.locator('.poi-feature-row')).toHaveCount(5);
      await expect(page.getByTestId('poi-merge-result')).toBeVisible();
      const detail = await saveAndRead(page, uid);
      const added = new Map<string, any>(detail.fc.features.map((f: any) => [f.id, f]));
      expect(added.get('kml-1').properties.name).toEqual({ ja: '浅草寺', en: 'Sensoji' });
      expect(added.get('kml-1').properties.desc).toEqual({ ja: '本堂\n雷門から徒歩' });
      // 保存の後に結果の表示は残らない
      await expect(page.getByTestId('poi-merge-result')).toBeHidden();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('一覧の取り込み: CSV を選ぶと detectImportLanguage が落ちず新しいソースができる', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-newsource-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const csv = path.join(e2eRoot, 'tokyo-spots.csv');
      await writeFile(csv, await readFile(path.join(fixtureDir, 'names-utf8bom.csv')));
      await stubOpenDialog(app, csv);
      await page.evaluate(() => { location.hash = '#/poisources/new?import=1'; });
      await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 30000 }).toMatch(/#\/poisources\/[0-9a-f-]{36}/);
      const list = await page.evaluate(async () => window.poiSources.list({ query: '', page: 1, pageSize: 50 }));
      const slugs = JSON.stringify(list);
      expect(slugs).toContain('tokyo-spots');
      await expect(page.locator('.poi-feature-row')).toHaveCount(1);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
