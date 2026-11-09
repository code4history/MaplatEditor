// POI の CSV・JSON 書き出し E2E (実 Electron)。
// ネイティブの保存ダイアログ・メッセージボックスは差し替え、書き出されたファイルを期待値と比べる。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
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

async function stubDialogs(app: ElectronApplication, savePath: string): Promise<void> {
  await app.evaluate(({ dialog }, out) => {
    (globalThis as any).__poiIoMessages = [];
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
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
  await expect(page.locator('[data-editor-action="poi-export-table"]')).toBeEnabled({ timeout: 15000 });
}

async function runExport(app: ElectronApplication, page: Page, format: 'csv' | 'json') {
  await page.locator('[data-editor-action="poi-export-table"]').click();
  await expect(page.getByTestId('poi-export-table-dialog')).toBeVisible();
  await page.getByTestId(`poi-export-format-${format}`).check();
  await page.getByTestId('poi-export-table-confirm').click();
  await expect(page.getByTestId('poi-export-table-dialog')).toBeHidden();
  await expect.poll(() => app.evaluate(() => (globalThis as any).__poiIoMessages.length)).toBeGreaterThan(0);
  return app.evaluate(() => (globalThis as any).__poiIoMessages as { message: string; detail?: string }[]);
}

test.describe('POI の CSV・JSON 書き出し', () => {
  test('CSV: 期待値とバイト単位で一致し、省かれた項目が報告される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-csv-'));
    const out = path.join(e2eRoot, 'out.csv');
    const { app, page } = await launch(e2eRoot);
    try {
      const fc = JSON.parse(await readFile(path.join(fixtureDir, 'roundtrip-source.json'), 'utf8'));
      const uid = await seedRoundtripSource(page, fc);
      await stubDialogs(app, out);
      await openSource(page, uid);
      const messages = await runExport(app, page, 'csv');
      const expected = await readFile(path.join(fixtureDir, 'expected-export.csv'));
      expect(Buffer.compare(await readFile(out), expected)).toBe(0);
      // 省かれた項目 (html・その他の項目・資産の画像) の報告
      expect(messages.at(-1)?.detail ?? '').toContain('HTML');
      expect(messages.at(-1)?.detail ?? '').toContain('GeoJSON');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('JSON: POI の配列で、HTML・独自の項目・資産の参照が保たれる', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-json-'));
    const out = path.join(e2eRoot, 'out.json');
    const { app, page } = await launch(e2eRoot);
    try {
      const fc = JSON.parse(await readFile(path.join(fixtureDir, 'roundtrip-source.json'), 'utf8'));
      const uid = await seedRoundtripSource(page, fc);
      await stubDialogs(app, out);
      await openSource(page, uid);
      await runExport(app, page, 'json');
      const expected = JSON.parse(await readFile(path.join(fixtureDir, 'expected-export.json'), 'utf8'));
      expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(expected);
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
      // 書き出しは読み取り専用でも有効
      await expect(page.locator('[data-editor-action="poi-export-table"]')).toBeEnabled();
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
