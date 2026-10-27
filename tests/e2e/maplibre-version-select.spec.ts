// アプリごとの MapLibre GL JS の版（5 系・6 系）の選択と、ベースマップのスタイルの判定の E2E。
//
// S1 新しいアプリは 5 系で保存される
// S2 版の値の無い既存のアプリを開いて保存すると 5 が書かれる
// S3 6 系へはラジオでも確認の窓を通る（取り消すと 5 のまま）。6 → 5 は確認しない
// S4 6 系の機能を使うスタイルのベースマップ（値の無い既存のアプリ）:
//    版の項目の下とプレビューの上に警告 → 5 系のままでは描かれない → 警告のままでも保存・書き出しできる（書き出しの前に確認の窓）
//    → 警告の「6 系に切り替える」→ 確認の窓 → 保存の前のプレビューで描かれ、警告が消える → 保存 → 書き出しても描かれる
//    ベースマップの編集の画面にも同じ判定（6 系が要る）が出る
// S5 判定の IPC: 引数の検査・取得の失敗・大きさの上限・時間切れ・判定の結果。相手の誤りの文は返さない
//
// WebGL 2 の段は provider-gl-render.spec.ts と同じ（helpers/glRender.ts）。描画を見る S4 だけが WebGL 2 を要する。
import { expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';
import {
  COLOR_HITS_MIN, FIXTURE_STYLE, OSM_BRIGHT_STYLE, STYLE_ERROR, launchWithWebGlStage, sampleWindow, saveShot,
  serveStatic, stageNote, type Stage,
} from './helpers/glRender';

// 他の spec と衝突しない固定ポート
const PREVIEW_PORT = 45793;

type DialogCall = { message: string; detail: string; buttons: string[]; type: string };

let app: ElectronApplication;
let page: Page;
let stage: Stage;
let e2eRoot: string;
let styleServer: { origin: string; close: () => Promise<void> };

/** main の dialog.showMessageBox を差し替え、引数を記録して、responses の順に答える（尽きたら 0） */
async function stubDialogs(responses: number[] = []): Promise<void> {
  await app.evaluate(async ({ dialog }, rs) => {
    const g = globalThis as Record<string, unknown>;
    g.__mvDialogLog = [];
    g.__mvDialogResponses = [...rs];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const o = (args.length >= 2 ? args[1] : args[0]) as { message?: string; detail?: string; buttons?: string[]; type?: string };
      (g.__mvDialogLog as unknown[]).push({ message: o?.message ?? '', detail: o?.detail ?? '', buttons: o?.buttons ?? [], type: o?.type ?? '' });
      const queue = g.__mvDialogResponses as number[];
      return { response: queue.length ? queue.shift()! : 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, responses);
}

async function dialogLog(): Promise<DialogCall[]> {
  return app.evaluate(() => ((globalThis as Record<string, unknown>).__mvDialogLog as DialogCall[]) ?? []);
}

async function saveFolder(): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

/** 版の値の無い既存のアプリを作る（保存の入口は 5 を補うので、保存した後に DB の行から値を外す） */
async function seedLegacyApp(slug: string, sources: unknown[]): Promise<string> {
  const uid = await page.evaluate(async ({ slug: s, sources: src, previewPort }) => {
    const id = crypto.randomUUID();
    const saved = await (window as any).appedit.save({ uid: id, slug: s, create: true, document: {
      appID: s, appName: { ja: s }, title: { ja: s }, description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: src, pois: [], appSettings: { homeLng: 139.767, homeLat: 35.681, defaultZoom: 15 },
      httpSettings: { previewPort }, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app save failed: ${JSON.stringify(saved)}`);
    return id;
  }, { slug, sources, previewPort: PREVIEW_PORT });
  const db = new DatabaseSync(path.join(await saveFolder(), 'maplat.sqlite'));
  try {
    // apps の更新のトリガ（検索の索引の更新）は製品が登録する関数を呼ぶので、この接続からは走らせられない。
    // 版の値を外しても索引の中身（範囲・検索の文字列）は変わらないので、1 つのトランザクションの中で
    // apps の UPDATE のトリガを外して更新し、同じ定義で戻す（製品は起動のたびにトリガを作り直す）
    db.exec('BEGIN IMMEDIATE');
    const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'apps' AND sql LIKE '%AFTER UPDATE%'").all() as Array<{ name: string; sql: string }>;
    for (const t of triggers) db.exec(`DROP TRIGGER "${t.name}"`);
    db.prepare("UPDATE apps SET data_json = json_remove(data_json, '$.maplibreMajorVersion') WHERE uid = ?").run(uid);
    for (const t of triggers) db.exec(t.sql);
    db.exec('COMMIT');
    const row = db.prepare('SELECT data_json FROM apps WHERE uid = ?').get(uid) as { data_json: string };
    expect('maplibreMajorVersion' in JSON.parse(row.data_json)).toBe(false);
  } finally {
    db.close();
  }
  return uid;
}

async function storedDoc(uid: string): Promise<any> {
  return page.evaluate(async (u) => (window as any).appedit.request(u), uid);
}

async function openApp(uid: string): Promise<void> {
  await page.evaluate(() => { location.hash = '/applist'; });
  await expect(page.locator('iframe.preview-map')).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate((u) => { location.hash = `/appedit?uid=${u}`; }, uid);
  await expect(page.getByTestId('app-maplibre-version-5')).toBeVisible({ timeout: 30_000 });
}

async function clickTab(name: RegExp): Promise<void> {
  await page.locator('[role="tab"]').filter({ hasText: name }).click();
}

async function previewFrame(): Promise<Frame> {
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60_000 });
  const src = (await page.locator('iframe.preview-map').getAttribute('src'))!;
  await expect.poll(() => page.frames().some((f) => f.url() === src), { timeout: 30_000 }).toBe(true);
  return page.frames().find((f) => f.url() === src)!;
}

async function waitViewer(frame: Frame): Promise<void> {
  await expect.poll(() => frame.evaluate(() => Boolean((window as any).__maplatPreview)).catch(() => false), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(3_000);
}

async function sampleIframe(): Promise<Awaited<ReturnType<typeof sampleWindow>>> {
  const box = await page.locator('iframe.preview-map').boundingBox();
  if (!box) throw new Error('プレビューの iframe の矩形が取れない');
  return sampleWindow(app, page, box);
}

async function save(): Promise<void> {
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save')).toBeDisabled({ timeout: 30_000 });
}

/** 画面の書き出しのボタンから書き出す（書き出しの小窓は「書き出す」で閉じる）。zip を展開したディレクトリを返す */
async function exportFromUi(label: string): Promise<string> {
  const zip = path.join(e2eRoot, `${label}.zip`);
  await app.evaluate(async ({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
  }, zip);
  await page.locator('[data-editor-action="export"]').click();
  await expect(page.getByTestId('app-export-options')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('app-export-options-confirm').click();
  await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120_000 });
  for (let i = 0; i < 5; i++) {
    const modal = page.locator('.modal.d-block');
    if (await modal.count() === 0) break;
    await modal.locator('button', { hasText: 'OK' }).first().click({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.modal.d-block')).toHaveCount(0, { timeout: 20_000 });
  const dir = path.join(e2eRoot, `${label}-extract`);
  new AdmZip(zip).extractAllTo(dir, true);
  return dir;
}

test.describe.configure({ timeout: 300_000 });

test.describe('MapLibre GL JS の版の選択とスタイルの判定', () => {
  test.beforeAll(async () => {
    e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-maplibre-version-'));
    ({ app, page, stage } = await launchWithWebGlStage(e2eRoot));
    console.log(stageNote(stage));
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    styleServer = await serveStatic(path.dirname(FIXTURE_STYLE), { cors: true });
  });

  test.afterAll(async () => {
    if (app) await quitElectronApplication(app);
    if (styleServer) await styleServer.close();
  });

  test('S1 新しいアプリは 5 系で保存される', async () => {
    await stubDialogs();
    await page.evaluate(() => { location.hash = '#/appedit'; });
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('app-maplibre-version-5')).toBeChecked();
    await expect(page.getByTestId('app-maplibre-version-6')).not.toBeChecked();
    await page.getByTestId('app-id').fill('mv-new-app');
    await page.getByTestId('app-title').fill('新しいアプリ');
    await save();
    const uid = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('uid'));
    expect(uid).toBeTruthy();
    const doc = await storedDoc(uid!);
    expect(doc.maplibreMajorVersion).toBe(5);
  });

  test('S2 版の値の無い既存のアプリを開いて保存すると 5 が書かれる', async () => {
    await stubDialogs();
    const uid = await seedLegacyApp('mv-legacy-save', ['osm']);
    expect('maplibreMajorVersion' in (await storedDoc(uid))).toBe(false);
    await openApp(uid);
    await expect(page.getByTestId('app-maplibre-version-5')).toBeChecked();
    await page.getByTestId('app-title').fill('mv-legacy-save 2');
    await save();
    expect((await storedDoc(uid)).maplibreMajorVersion).toBe(5);
  });

  test('S3 6 系へはラジオでも確認の窓を通る。取り消すと 5 のまま。6 → 5 は確認しない', async () => {
    const uid = await seedLegacyApp('mv-radio', ['osm']);
    await openApp(uid);

    // 取り消す（2 つ目のボタン）
    await stubDialogs([1]);
    await page.getByTestId('app-maplibre-version-6').click();
    await expect.poll(async () => (await dialogLog()).length).toBe(1);
    const [confirm] = await dialogLog();
    expect(confirm.detail).toContain('import map');
    expect(confirm.detail).toContain('WebGL 2');
    expect(confirm.detail).toContain('worker-src blob:');
    expect(confirm.detail).toMatch(/Safari 16\.3/);
    expect(confirm.buttons).toHaveLength(2);
    await expect(page.getByTestId('app-maplibre-version-5')).toBeChecked();
    await expect(page.getByTestId('app-maplibre-version-6')).not.toBeChecked();
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    // 切り替える
    await stubDialogs([0]);
    await page.getByTestId('app-maplibre-version-6').click();
    await expect(page.getByTestId('app-maplibre-version-6')).toBeChecked();
    expect((await dialogLog()).length).toBe(1);
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await save();
    expect((await storedDoc(uid)).maplibreMajorVersion).toBe(6);

    // 6 → 5 は確認しない
    await stubDialogs([1]);
    await page.getByTestId('app-maplibre-version-5').click();
    await expect(page.getByTestId('app-maplibre-version-5')).toBeChecked();
    expect(await dialogLog()).toEqual([]);
    await save();
    expect((await storedDoc(uid)).maplibreMajorVersion).toBe(5);
  });

  test('S4 6 系の機能を使うスタイル: 警告 → 5 系では描かれない → 警告から 6 系へ切り替えると描かれる', async () => {
    test.info().annotations.push({ type: 'webgl-stage', description: stageNote(stage) });
    test.skip(stage.n === 3, stageNote(stage));
    const styleUrl = `${styleServer.origin}/${path.basename(FIXTURE_STYLE)}`;
    // ベースマップの style は IPC（baseMaps.saveUser）で入れる（画面の検査は maplibre に https しか許さない）
    const baseMapUid = await seedBaseMap(page, 'mv-lopacity-base', baseMapMasterDoc({ kind: 'maplibre', maptype: 'maplibre', style: styleUrl, url: '' }));
    const uid = await seedLegacyApp('mv-lopacity', [{ sourceType: 'tms', mapUid: 'mv-lopacity-base', baseMapUid, role: 'base', startFrom: true, overrides: {} }]);
    await stubDialogs();
    await openApp(uid);

    // 版の項目の直下の警告（5 系のまま・値は変わらない）
    const warning = page.getByTestId('app-maplibre-version-warning');
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(warning).toContainText('line-layer-opacity');
    await expect(page.getByTestId('app-maplibre-version-5')).toBeChecked();

    // 5 系のままのプレビュー: 警告が出て、ベースマップは描かれない
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(m.text()));
    await clickTab(/プレビュー/);
    await expect(page.getByTestId('app-preview-maplibre-version-warning')).toBeVisible({ timeout: 30_000 });
    await waitViewer(await previewFrame());
    const white = await sampleIframe();
    await saveShot('S4-1-v5-preview-warning', white.png);
    console.log(`S4 v5: bgHits=${white.bgHits} fillHits=${white.fillHits}`);
    expect(white.bgHits, '5 系なのに fixture の背景色が描かれている').toBeLessThan(COLOR_HITS_MIN);
    expect(consoleLines.some((l) => STYLE_ERROR.test(l)), '5 系の検証の誤りがコンソールに出ていない').toBe(true);

    // 警告のままでも保存・書き出しできる（版は変わらない）。書き出しの前に確認の窓が出る
    await clickTab(/メタデータ/);
    await page.getByTestId('app-title').fill('mv-lopacity 2');
    await save();
    expect((await storedDoc(uid)).maplibreMajorVersion).toBe(5);
    await stubDialogs([0]);
    const v5Dir = await exportFromUi('mv-lopacity-v5');
    const exportWarning = (await dialogLog()).find((d) => d.message.includes('6 系'));
    expect(exportWarning, '書き出しの前の確認の窓が出ていない').toBeTruthy();
    expect(exportWarning!.detail).toContain('line-layer-opacity');
    const v5Html = await readFile(path.join(v5Dir, 'index.html'), 'utf8');
    expect(v5Html).toContain('maplibre-gl@5.6.2/dist/maplibre-gl.js');
    expect((await storedDoc(uid)).maplibreMajorVersion).toBe(5);

    // プレビューの上の警告の「6 系に切り替える」→ 確認の窓 → 保存の前のプレビューで描かれる
    await clickTab(/プレビュー/);
    await expect(page.getByTestId('app-preview-maplibre-version-warning')).toBeVisible({ timeout: 30_000 });
    await stubDialogs([0]);
    await page.getByTestId('app-preview-maplibre-version-warning').getByTestId('app-maplibre-version-switch-6').click();
    await expect.poll(async () => (await dialogLog()).filter((d) => d.detail.includes('worker-src blob:')).length).toBe(1);
    await expect(page.getByTestId('app-preview-maplibre-version-warning')).toHaveCount(0, { timeout: 30_000 });
    await waitViewer(await previewFrame());
    let drawn = await sampleIframe();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && (drawn.bgHits < COLOR_HITS_MIN || drawn.fillHits < COLOR_HITS_MIN)) {
      await page.waitForTimeout(1_000);
      drawn = await sampleIframe();
    }
    await saveShot('S4-2-v6-preview-drawn', drawn.png);
    console.log(`S4 v6 (保存の前): bgHits=${drawn.bgHits} fillHits=${drawn.fillHits}`);
    expect(drawn.bgHits).toBeGreaterThanOrEqual(COLOR_HITS_MIN);
    expect(drawn.fillHits).toBeGreaterThanOrEqual(COLOR_HITS_MIN);
    await expect(page.getByTestId('editor-save')).toBeEnabled();

    // 保存 → 版の項目の警告も消えている → 書き出しても 6 系の形
    await clickTab(/メタデータ/);
    await expect(page.getByTestId('app-maplibre-version-warning')).toHaveCount(0);
    await expect(page.getByTestId('app-maplibre-version-6')).toBeChecked();
    await save();
    expect((await storedDoc(uid)).maplibreMajorVersion).toBe(6);
    await stubDialogs([0]);
    const v6Dir = await exportFromUi('mv-lopacity-v6');
    expect((await dialogLog()).some((d) => d.message.includes('6 系')), '6 系なのに書き出しの前の確認の窓が出た').toBe(false);
    const v6Html = await readFile(path.join(v6Dir, 'index.html'), 'utf8');
    expect(v6Html).toContain('<script type="importmap">');
    const server = await serveStatic(v6Dir);
    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 1000, height: 700, show: true });
      void w.loadURL('about:blank');
    });
    const win = await windowPromise;
    try {
      await win.goto(`${server.origin}/`);
      await expect(win.locator('canvas.maplibregl-canvas')).toHaveCount(1, { timeout: 60_000 });
      let exp = await sampleWindow(app, win, { x: 0, y: 0, width: 1000, height: 700 });
      const until = Date.now() + 30_000;
      while (Date.now() < until && (exp.bgHits < COLOR_HITS_MIN || exp.fillHits < COLOR_HITS_MIN)) {
        await win.waitForTimeout(1_000);
        exp = await sampleWindow(app, win, { x: 0, y: 0, width: 1000, height: 700 });
      }
      await saveShot('S4-3-v6-export-drawn', exp.png);
      expect(exp.bgHits).toBeGreaterThanOrEqual(COLOR_HITS_MIN);
      expect(exp.fillHits).toBeGreaterThanOrEqual(COLOR_HITS_MIN);
    } finally {
      await win.close().catch(() => {});
      await server.close();
    }

    // ベースマップの編集の画面にも同じ判定が出る
    await page.evaluate((u) => { location.hash = `/basemaps?uid=${u}`; }, baseMapUid);
    const check = page.getByTestId('basemap-style-gl-check');
    await expect(check).toBeVisible({ timeout: 30_000 });
    await expect(check).toContainText('6 系が要ります', { timeout: 30_000 });
    await expect(check).toContainText('line-layer-opacity');
    // 画面の写しは人が見る対比の記録用（PROVIDER_GL_SHOT_DIR を指定したときだけ撮る。窓の大きさに依らない要素の写し）
    if (process.env.PROVIDER_GL_SHOT_DIR) await saveShot('S4-4-basemap-check-needs-v6', await check.screenshot());
  });

  test('S5 判定の IPC: 引数の検査・取得の失敗・大きさの上限・時間切れ・判定の結果', async () => {
    const check = (arg: unknown) => page.evaluate(async (a) => (window as any).baseMaps.checkMaplibreStyle(a), arg as any);
    // 引数
    expect(await check(123)).toEqual({ result: 'unknown', reasons: [{ kind: 'invalid-argument' }] });
    expect(await check(`https://example.test/${'x'.repeat(2048)}`)).toEqual({ result: 'unknown', reasons: [{ kind: 'invalid-argument' }] });
    expect(await check('file:///etc/passwd')).toEqual({ result: 'unknown', reasons: [{ kind: 'unsupported-scheme' }] });

    // テストの中のサーバ: 大きすぎる本文・遅い応答・JSON でない・404
    const server = http.createServer((req, res) => {
      if (req.url === '/big.json') { res.end(Buffer.alloc(6 * 1024 * 1024, 0x20)); return; }
      if (req.url === '/slow.json') { setTimeout(() => res.end('{}'), 15_000); return; }
      if (req.url === '/notjson.json') { res.end('<html>'); return; }
      if (req.url === '/v7.json') { res.end(JSON.stringify({ version: 7, sources: {}, layers: [] })); return; }
      if (req.url === '/proto.json') { res.end(JSON.stringify({ version: 8, sources: { s: { type: 'constructor' } }, layers: [] })); return; }
      if (req.url === '/deep.json') {
        // JSON.stringify は深い入れ子で呼び出しの深さが尽きるので、文字列で組み立てる
        const depth = 100000;
        const deep = `${'["to-string",'.repeat(depth)}["get","x"]${']'.repeat(depth)}`;
        res.end(`{"version":8,"sources":{},"layers":[{"id":"l","type":"background","paint":{"background-opacity":${deep}}}]}`);
        return;
      }
      res.statusCode = 404;
      res.end('secret body text');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect(await check(`${origin}/big.json`)).toEqual({ result: 'unknown', reasons: [{ kind: 'too-large' }] });
      expect(await check(`${origin}/notjson.json`)).toEqual({ result: 'unknown', reasons: [{ kind: 'invalid-json' }] });
      expect(await check(`${origin}/v7.json`)).toEqual({ result: 'unknown', reasons: [{ kind: 'not-v8' }] });
      // 判定の関数の中で例外になりうる style でも、取得の失敗（network）にならず、正しい理由で「判定できない」
      expect(await check(`${origin}/proto.json`)).toEqual({ result: 'unknown', reasons: [{ kind: 'unknown-to-6', source: 's', key: 'type' }] });
      const deep = await check(`${origin}/deep.json`);
      expect(deep.result).toBe('unknown');
      expect(deep.reasons.map((r: { kind: string }) => r.kind)).not.toContain('network');
      const missing = await check(`${origin}/missing.json`);
      expect(missing).toEqual({ result: 'unknown', reasons: [{ kind: 'http-status' }] });
      expect(JSON.stringify(missing)).not.toContain('secret');
      const started = Date.now();
      expect(await check(`${origin}/slow.json`)).toEqual({ result: 'unknown', reasons: [{ kind: 'network' }] });
      expect(Date.now() - started).toBeLessThan(14_000);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
    // 届かない宛先
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    expect(await check(`http://127.0.0.1:${closedPort}/style.json`)).toEqual({ result: 'unknown', reasons: [{ kind: 'network' }] });

    // 判定の結果
    const fixture = await check(`${styleServer.origin}/${path.basename(FIXTURE_STYLE)}`);
    expect(fixture.result).toBe('needs-v6');
    expect(fixture.reasons).toContainEqual(expect.objectContaining({ kind: 'unknown-to-5', layer: 2, layerId: 'west-line', key: 'paint.line-layer-opacity' }));
    const bright = await check(`${styleServer.origin}/${path.basename(OSM_BRIGHT_STYLE)}`);
    expect(bright).toEqual({ result: 'v5-ok', reasons: [] });
  });
});
