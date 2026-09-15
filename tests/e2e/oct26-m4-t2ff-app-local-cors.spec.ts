// oct26-m4-t2ff（第 2 版）: app:// 移行（oct26-m4-t2）でタイルが CORS 拒否され地図が表示されない退行の回帰 E2E と、
// その是正が「renderer 以外の origin にローカルデータを読ませない」という m4-t2 の目的を壊していないことの否定テスト。
//
// 背景: m4-t2 の renderer は app://bundle、タイル等は app://local（host が違う ∴ 別 origin）。MaplatCore は
// タイル画像を crossOrigin="Anonymous" で読み canvas に描いて toDataURL する（@maplat/core src/source/mixin.ts）
// ので、別 origin のタイルは CORS 拒否 → 対応点編集の左ペインが真っ白になる。第 1 版は app: に corsEnabled を
// 付けて直したが、corsEnabled の app:// は Chromium が ACAO を検査せず、任意 origin から読めた（IR1 Major-1）。
// 第 2 版はローカルデータを renderer と同じ origin（app://bundle/__local/<abs>）で配信し、corsEnabled を使わない。
//
// AC（どれも crossOrigin="anonymous" の <img> で読み、canvas へ描いて toDataURL が taint で落ちないこと・
// naturalWidth > 0・CORS 拒否のコンソール 0 件）:
//   AC-FF-1 (i)   画像アップロード直後（保存前）の下書きタイル（draftTileRoot 配下）
//   AC-FF-2 (ii)  保存後のタイル（saveFolder/tiles）・サムネイル（saveFolder/tmbs）・merc タイル（saveFolder/merc）
//   AC-FF-3 (iii) 旧 file:// タイル参照（公開版の既存データ）と旧 app://local 参照（m4-t2 期のデータ）を補正したタイル
//   AC-FF-4       対応点編集タブを開いたときの CORS 拒否コンソールが 0 件（MaplatCore の実経路）
//   AC-FF-5       欠損ファイルは 404・許可外は 403 のまま・renderer から status を読める
//   AC-FF-6       他 origin 拒否: http://127.0.0.1:<port>（プレビュー配信と同種）と data:（origin null）のページから、
//                 タイル・maplat.sqlite・symlink 先を fetch でも crossOrigin <img> でも読めない（新旧両形の URL）
//   AC-FF-7       renderer と同一 origin で開いたローカル HTML が、renderer（親）の DOM に触れない。
//                 oct26-m4-t6（renderer CSP）以降は 2 層に分けて測る（t6 設計 v3 §3.3・AC5）:
//                 7a renderer の iframe への埋め込みは renderer CSP の frame-src で拒否される（違反行 ≥1・親 title 不変）
//                 7b renderer CSP の無い文書（トップレベルの非表示 BrowserWindow）で開いても、__local の sandbox CSP で
//                    スクリプトが走らない（renderer CSP が iframe を拒否するので、7a だけでは sandbox の退行を検出できない）
//   AC-FF-8       欠損以外の失敗を 404 に畳まない（権限 000 → 403・ディレクトリ → 403）
//
// URL は spec 内で組み立てる（electron/utils/appScheme.ts の localFileUrl を import すると、変更前の版で
// 「変更前の URL 形」を測ってしまい、AC-FF-6〜8 が変更前 FAIL を示せなくなるため）。
//
// ハーネスは m12-t20-draft-tile-durability.spec.ts（dialog harness / testDebug）と
// m6-t8-merc-tile-set.spec.ts（merc 生成）の様式に従う。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const CORS_BLOCKED = /blocked by CORS policy/;

// 第 2 版の URL 形（renderer と同一 origin）と、m4-t2 期の旧形。エンコード規約は appScheme.ts と同じ
// （セグメント単位 encodeURIComponent・先頭 '/' 保証。本 spec は POSIX の e2eRoot だけを扱う）。
const encodePath = (abs: string): string => abs.split('/').map((s) => encodeURIComponent(s)).join('/');
const sameOriginLocalUrl = (abs: string): string => `app://bundle/__local${encodePath(abs)}`;
const legacyLocalUrl = (abs: string): string => `app://local${encodePath(abs)}`;
const SAME_ORIGIN_PREFIX = 'app://bundle/__local/';

type Launched = { app: ElectronApplication; page: Page; consoleTexts: string[] };

async function launch(e2eRoot: string): Promise<Launched> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  const consoleTexts: string[] = [];
  page.on('console', (m) => consoleTexts.push(m.text()));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page, consoleTexts };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function makeImage(imagePath: string, width: number, height: number): Promise<void> {
  const { Jimp } = await import('jimp');
  const img = new Jimp({ width, height, color: 0xffffffff });
  // 真っ白だと「描けたか」を見分けにくいので、斜めの帯を描いておく
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (((x + y) >> 4) % 2 === 0) img.setPixelColor(0x3366ccff, x, y);
    }
  }
  await img.write(imagePath as `${string}.${string}`);
}

// m6-t8 seedStrictMap と同じ GCP（400x300 画像の境界内側・strict で TIN が組める）
function strictGcps(): number[][][] {
  const toMerc = (x: number, y: number): number[] => [
    15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
    4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
  ];
  return [
    [[50, 250], toMerc(50, 250)],
    [[350, 250], toMerc(350, 250)],
    [[350, 50], toMerc(350, 50)],
  ];
}

async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  const slug = `oct26-m4-t2ff-${Date.now()}`;
  return page.evaluate(async ({ slug, gcps }) => {
    const mapObject = {
      mapID: slug, title: { ja: 'oct26-m4-t2ff CORS 回帰' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'oct26-m4-t2ff attribution' }, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      gcps, edges: [] as unknown[], sub_maps: [] as unknown[],
      strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    const r1 = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`seed failed: ${JSON.stringify(r1)}`);
    const tin = await window.mapedit.updateTin(mapObject.gcps, mapObject.edges, 0, [400, 300], 'strict', 'plain');
    if (!Array.isArray(tin) || !tin[1]) throw new Error(`TIN compile failed: ${JSON.stringify(tin)}`);
    const r2 = await window.mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tin[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`compiled save failed: ${JSON.stringify(r2)}`);
    return { uid: r1.uid as string, slug };
  }, { slug, gcps: strictGcps() });
}

// dir/{z}/{x}/{y}.ext の 1 枚（最大ズーム）を返す
async function findFirstTile(dir: string): Promise<{ z: string; x: string; y: string; ext: string } | null> {
  const exists = await stat(dir).then(() => true).catch(() => false);
  if (!exists) return null;
  const zs = (await readdir(dir)).filter((z) => /^\d+$/.test(z)).sort((a, b) => Number(b) - Number(a));
  for (const z of zs) {
    for (const x of (await readdir(path.join(dir, z))).filter((v) => /^\d+$/.test(v))) {
      const ys = (await readdir(path.join(dir, z, x))).filter((v) => /^\d+\.(jpg|jpeg|png)$/.test(v));
      if (ys.length) {
        const [y, ext] = ys[0].split('.');
        return { z, x, y, ext };
      }
    }
  }
  return null;
}

const fillTemplate = (tpl: string, t: { z: string; x: string; y: string }): string =>
  tpl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);

type CorsLoad = { ok: boolean; width?: number; reason?: string; plainOk?: boolean };

// MaplatCore と同じ条件（crossOrigin="anonymous" で読み、canvas に描いて toDataURL）で読めるか。
// 対照として crossOrigin 無しの読込（plainOk）も採る: plainOk=true かつ ok=false なら、
// 実体は配信できていて CORS だけで落ちている（403/欠損とは区別できる）。
async function loadAsCorsImage(page: Page, url: string): Promise<CorsLoad> {
  const plainOk = await page.evaluate(async (u) => new Promise<boolean>((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 15_000);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = u;
  }), url);
  const cors = await page.evaluate(async (u) => new Promise<CorsLoad>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 15_000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        canvas.toDataURL(); // taint されていれば SecurityError
        resolve({ ok: true, width: img.naturalWidth });
      } catch (e) {
        resolve({ ok: false, width: img.naturalWidth, reason: String(e) });
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve({ ok: false, reason: 'error' }); };
    img.src = u;
  }), url);
  return { ...cors, plainOk };
}

function findAppLocalThumbnail(value: unknown): string | null {
  if (typeof value === 'string') return /^app:\/\/(bundle\/__local|local)\/.*\/tmbs\//.test(value) ? value : null;
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findAppLocalThumbnail(v);
      if (hit) return hit;
    }
  }
  return null;
}

async function openGcpsTabAndCountCors(page: Page, consoleTexts: string[]): Promise<number> {
  const before = consoleTexts.length;
  await page.getByTestId('map-tab-gcps').click();
  // MaplatCore がタイルを要求し終えるまで待つ（probe の実測で 9 枚の拒否は数秒以内に出揃う）
  await page.waitForTimeout(8_000);
  return consoleTexts.slice(before).filter((t) => CORS_BLOCKED.test(t)).length;
}

// アプリ終了中に maps.data_json.url を書き換える（既存データの URL 形を再現する）。
// maps の更新トリガが呼ぶ SQL 関数は接続ごとの登録が要る（SqliteDataService の実装を写す）。
function rewriteMapUrl(saveFolder: string, uid: string, url: string): void {
  const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
  const seg = new Intl.Segmenter('ja', { granularity: 'word' });
  const tokenize = (t: string) => [...seg.segment(t)].filter((s) => s.isWordLike).map((s) => s.segment).join(' ');
  const collect = (v: unknown): string[] => (typeof v === 'string' ? (v.trim() ? [v] : [])
    : v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
  db.function('maplat_tokenize', { deterministic: true }, (t) => tokenize(String(t ?? '')));
  db.function('maplat_map_fts_raw', { deterministic: true }, (d) => {
    try {
      const doc = JSON.parse(String(d ?? ''));
      return ['title', 'label', 'description'].flatMap((f) => collect(f.split('.').reduce((c: any, k) => c?.[k], doc))).join('\n');
    } catch { return ''; }
  });
  db.function('maplat_map_bbox', { deterministic: true }, (d) => {
    try {
      const pts = JSON.parse(String(d ?? ''))?.compiled?.vertices_points;
      if (!Array.isArray(pts) || pts.length === 0) return null;
      let b: number[] | null = null;
      for (const v of pts) {
        const m = v?.[1];
        if (!Array.isArray(m) || typeof m[0] !== 'number' || typeof m[1] !== 'number') continue;
        b = b ? [Math.min(b[0], m[0]), Math.min(b[1], m[1]), Math.max(b[2], m[0]), Math.max(b[3], m[1])] : [m[0], m[1], m[0], m[1]];
      }
      return b ? JSON.stringify(b) : null;
    } catch { return null; }
  });
  const row = db.prepare('SELECT data_json FROM maps WHERE uid = ?').get(uid) as { data_json: string };
  const data = JSON.parse(row.data_json);
  data.url = url;
  db.prepare('UPDATE maps SET data_json = ? WHERE uid = ?').run(JSON.stringify(data), uid);
  db.close();
}

test.describe('oct26-m4-t2ff ローカルデータの同一 origin 配信', () => {
  test('AC-FF-1〜5: 下書き・保存後（タイル/サムネイル/merc）・旧 file:// / app://local 補正のタイルが crossOrigin で読める', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-oct26-m4-t2ff-'));
    const imagePath = path.join(e2eRoot, 'cors-src.png');
    await makeImage(imagePath, 400, 300);

    let launched = await launch(e2eRoot);
    let uid = '';
    let saveFolder = '';
    let savedTilesDir = '';
    let savedTile: Awaited<ReturnType<typeof findFirstTile>> = null;
    try {
      const { app, page, consoleTexts } = launched;
      saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      ({ uid } = await seedMap(page));
      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30_000 });

      // ---- AC-FF-1 (i): 画像アップロード直後（保存前）の下書きタイル ----
      await app.evaluate(async ({ dialog }, selected) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selected] })) as typeof dialog.showOpenDialog;
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      }, imagePath);
      await page.getByRole('button', { name: '地図画像登録' }).click();
      const okButton = page.getByRole('button', { name: 'OK' });
      await expect(okButton).toBeEnabled({ timeout: 120_000 });
      await okButton.click();
      await expect.poll(async () => page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_ ?? ''), { timeout: 30_000 })
        .toContain('draft-tiles');
      const draftUrl: string = await page.evaluate(() => (window as any).testDebug.mapData.value.url_);
      expect.soft(draftUrl.startsWith(SAME_ORIGIN_PREFIX), `下書き url_ が同一 origin 形でない: ${draftUrl}`).toBe(true);
      const draftTile = await findFirstTile(path.join(e2eRoot, 'draft-tiles', uid));
      expect(draftTile, '下書きタイルがディスクに無い').not.toBeNull();
      const draftLoad = await loadAsCorsImage(page, fillTemplate(draftUrl, draftTile!));
      console.log('[AC-FF-1] draft tile', JSON.stringify(draftLoad));
      expect(draftLoad.plainOk, `配信層で読めない（CORS 以前の失敗）: ${JSON.stringify(draftLoad)}`).toBe(true);
      expect.soft(draftLoad.ok, `下書きタイルを crossOrigin で読めない: ${JSON.stringify(draftLoad)}`).toBe(true);
      expect.soft(draftLoad.width ?? 0).toBeGreaterThan(0);

      // ---- AC-FF-4（下書き）: 対応点編集タブで MaplatCore が読むときの CORS 拒否 0 件 ----
      const draftCors = await openGcpsTabAndCountCors(page, consoleTexts);
      console.log('[AC-FF-4] draft gcps-tab CORS blocked =', draftCors);
      expect.soft(draftCors, '下書きタイル表示で CORS 拒否が出た').toBe(0);

      // ---- AC-FF-2 (ii): 保存後のタイル・サムネイル・merc タイル ----
      await page.getByTestId('editor-save').click();
      await expect.poll(async () => page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_ ?? ''), { timeout: 60_000 })
        .not.toContain('draft-tiles');
      const savedUrl: string = await page.evaluate(() => (window as any).testDebug.mapData.value.url_);
      savedTilesDir = path.join(saveFolder, 'tiles', uid);
      savedTile = await findFirstTile(savedTilesDir);
      expect(savedTile, '保存後タイルがディスクに無い').not.toBeNull();
      const savedLoad = await loadAsCorsImage(page, fillTemplate(savedUrl, savedTile!));
      console.log('[AC-FF-2] saved tile', JSON.stringify(savedLoad));
      expect(savedLoad.plainOk, `配信層で読めない（CORS 以前の失敗）: ${JSON.stringify(savedLoad)}`).toBe(true);
      expect.soft(savedLoad.ok, `保存後タイルを crossOrigin で読めない: ${JSON.stringify(savedLoad)}`).toBe(true);

      const list = await page.evaluate(() => window.maplist.request('', 1));
      const thumbUrl = findAppLocalThumbnail(list);
      expect(thumbUrl, `一覧にサムネイルの app:// URL が無い: ${JSON.stringify(list).slice(0, 500)}`).not.toBeNull();
      expect.soft(thumbUrl!.startsWith(SAME_ORIGIN_PREFIX), `サムネイル URL が同一 origin 形でない: ${thumbUrl}`).toBe(true);
      const thumbLoad = await loadAsCorsImage(page, thumbUrl!);
      console.log('[AC-FF-2] thumbnail', thumbUrl, JSON.stringify(thumbLoad));
      expect(thumbLoad.plainOk, `配信層で読めない（CORS 以前の失敗）: ${JSON.stringify(thumbLoad)}`).toBe(true);
      expect.soft(thumbLoad.ok, `サムネイルを crossOrigin で読めない: ${JSON.stringify(thumbLoad)}`).toBe(true);

      await page.getByTestId('map-tab-merc').click();
      const generateButton = page.getByTestId('merc-generate-button');
      await expect(generateButton).toBeEnabled({ timeout: 30_000 });
      await generateButton.click();
      const mercOk = page.getByRole('button', { name: 'OK' });
      await expect(mercOk).toBeEnabled({ timeout: 120_000 });
      await mercOk.click();
      const baseMaps = await page.evaluate(() => window.baseMaps.list());
      const merc = baseMaps.find((b: any) => b.data?.kind === 'merc' && b.data?.sourceMapUid === uid);
      expect(merc, 'merc ベースマップが作られていない').toBeTruthy();
      const mercDir = path.join(saveFolder, 'merc', merc.uid);
      const mercTile = await findFirstTile(mercDir);
      expect(mercTile, 'merc タイルがディスクに無い').not.toBeNull();
      // basemaps:list が返す実行時 URL（mercBaseMapTileUrl.ts の deriveMercBaseMapTileUrl）をそのまま使う
      const mercTemplate: string = merc.url_ ?? '';
      expect.soft(mercTemplate.startsWith(SAME_ORIGIN_PREFIX), `merc url_ が同一 origin 形でない: ${mercTemplate}`).toBe(true);
      const mercUrl = fillTemplate(mercTemplate, mercTile!);
      const mercLoad = await loadAsCorsImage(page, mercUrl);
      console.log('[AC-FF-2] merc tile', JSON.stringify(mercLoad));
      expect(mercLoad.plainOk, `配信層で読めない（CORS 以前の失敗）: ${JSON.stringify(mercLoad)}`).toBe(true);
      expect.soft(mercLoad.ok, `merc タイルを crossOrigin で読めない: ${JSON.stringify(mercLoad)}`).toBe(true);
    } finally {
      await quitElectronApplication(launched.app);
    }

    // ---- AC-FF-3 (iii-a): 旧 file:// タイル参照（公開版の既存データ）→ 同一 origin 形へ補正したタイル ----
    rewriteMapUrl(saveFolder, uid, `${pathToFileURL(savedTilesDir).href}/{z}/{x}/{y}.${savedTile!.ext}`);
    launched = await launch(e2eRoot);
    try {
      const { page, consoleTexts } = launched;
      const req = await page.evaluate(async (u) => {
        const r = await window.mapedit.request(u);
        const m = Array.isArray(r) ? r[0] : r;
        return { url: m?.url as string, url_: m?.url_ as string };
      }, uid);
      expect(req.url.startsWith('file://'), `旧 file:// 参照に書き換わっていない: ${req.url}`).toBe(true);
      expect.soft(req.url_.startsWith(SAME_ORIGIN_PREFIX), `旧 file:// 参照が同一 origin 形へ補正されていない: ${req.url_}`).toBe(true);
      const legacyLoad = await loadAsCorsImage(page, fillTemplate(req.url_, savedTile!));
      console.log('[AC-FF-3] legacy tile', JSON.stringify(legacyLoad));
      expect(legacyLoad.plainOk, `配信層で読めない（CORS 以前の失敗）: ${JSON.stringify(legacyLoad)}`).toBe(true);
      expect.soft(legacyLoad.ok, `補正後タイルを crossOrigin で読めない: ${JSON.stringify(legacyLoad)}`).toBe(true);

      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2_000);
      const legacyCors = await openGcpsTabAndCountCors(page, consoleTexts);
      console.log('[AC-FF-4] legacy gcps-tab CORS blocked =', legacyCors);
      expect.soft(legacyCors, '既存データのタイル表示で CORS 拒否が出た').toBe(0);

    } finally {
      await quitElectronApplication(launched.app);
    }

    // ---- AC-FF-3 (iii-b): 旧 app://local 参照（m4-t2 期のビルドで永続化され得る形）→ 同一 origin 形へ補正したタイル ----
    rewriteMapUrl(saveFolder, uid, `${legacyLocalUrl(savedTilesDir)}/{z}/{x}/{y}.${savedTile!.ext}`);
    launched = await launch(e2eRoot);
    try {
      const { page, consoleTexts } = launched;
      const req = await page.evaluate(async (u) => {
        const r = await window.mapedit.request(u);
        const m = Array.isArray(r) ? r[0] : r;
        return { url: m?.url as string, url_: m?.url_ as string };
      }, uid);
      expect(req.url.startsWith('app://local/'), `旧 app://local 参照に書き換わっていない: ${req.url}`).toBe(true);
      expect.soft(req.url_.startsWith(SAME_ORIGIN_PREFIX), `旧 app://local 参照が同一 origin 形へ補正されていない: ${req.url_}`).toBe(true);
      const legacyAppLoad = await loadAsCorsImage(page, fillTemplate(req.url_, savedTile!));
      console.log('[AC-FF-3] legacy app://local tile', JSON.stringify(legacyAppLoad));
      expect(legacyAppLoad.plainOk, `配信層で読めない（CORS 以前の失敗）: ${JSON.stringify(legacyAppLoad)}`).toBe(true);
      expect.soft(legacyAppLoad.ok, `旧 app://local 補正後タイルを crossOrigin で読めない: ${JSON.stringify(legacyAppLoad)}`).toBe(true);
      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2_000);
      const legacyAppCors = await openGcpsTabAndCountCors(page, consoleTexts);
      console.log('[AC-FF-4] legacy app://local gcps-tab CORS blocked =', legacyAppCors);
      expect.soft(legacyAppCors, '旧 app://local データのタイル表示で CORS 拒否が出た').toBe(0);

      // ---- AC-FF-5: 存在しないファイルは例外（net::ERR_UNEXPECTED）ではなく 404 で返り、
      //      許可 origin からは CORS 越しに status を読める（許可外は従来どおり 403）----
      const missingLocal = sameOriginLocalUrl(path.join(savedTilesDir, '99', '0', '0.jpg'));
      const mainStatus = await launched.app.evaluate(async ({ net }, urls) => {
        const one = async (u: string) => {
          try { return (await net.fetch(u)).status; } catch (e) { return String(e); }
        };
        return { local: await one(urls[0]), bundle: await one(urls[1]), outside: await one(urls[2]) };
      }, [missingLocal, 'app://bundle/oct26-m4-t2ff-missing.js', sameOriginLocalUrl('/etc/hosts')]);
      const rendererStatus = await page.evaluate(async (u) => {
        try { return (await fetch(u)).status; } catch (e) { return String(e); }
      }, missingLocal);
      console.log('[AC-FF-5] missing', JSON.stringify({ mainStatus, rendererStatus }));
      expect.soft(mainStatus.local, '許可ルート内の欠損ローカル URL が 404 にならない').toBe(404);
      expect.soft(mainStatus.bundle, '欠損 app://bundle が 404 にならない').toBe(404);
      expect.soft(mainStatus.outside, '許可ルート外のローカル URL が 403 のままでない').toBe(403);
      expect.soft(rendererStatus, 'renderer（app://bundle）から欠損タイルの status を読めない').toBe(404);
    } finally {
      await quitElectronApplication(launched.app);
    }
  });
  test('AC-FF-6〜8: renderer 以外の origin はローカルデータを読めない・同一 origin の HTML は親に触れない・欠損以外を 404 に畳まない', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-oct26-m4-t2ff-origin-'));
    const launched = await launch(e2eRoot);
    const saveFolder: string = await launched.page.evaluate(() => window.settings.get('saveFolder'));
    const nopermPath = path.join(saveFolder, 'oct26-m4-t2ff-noperm.png');
    try {
      const { app, page, consoleTexts } = launched;
      // 素材: 有効な PNG タイル・saveFolder の外の秘密ファイルと、それを指す saveFolder 内 symlink・
      // 権限 000 のファイル・スクリプトを含む HTML。maplat.sqlite は起動時に saveFolder へ作られる。
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      const tileDir = path.join(saveFolder, 'tiles', 'oct26-m4-t2ff-origin', '0', '0');
      await mkdir(tileDir, { recursive: true });
      await writeFile(path.join(tileDir, '0.png'), png);
      const outside = path.join(e2eRoot, 'outside-of-roots');
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE');
      await symlink(outside, path.join(saveFolder, 'oct26-m4-t2ff-link'));
      await writeFile(nopermPath, png);
      await chmod(nopermPath, 0o000);
      await writeFile(path.join(saveFolder, 'oct26-m4-t2ff-evil.html'),
        '<!doctype html><script>try{parent.document.title="PWNED-BY-LOCAL-HTML"}catch(e){}</script>');
      await writeFile(path.join(saveFolder, 'oct26-m4-t6-evil-top.html'),
        '<!doctype html><title>LOCAL-HTML-TOP</title><script>document.title="PWNED-BY-LOCAL-HTML-TOP"</script>');
      await expect.poll(async () => stat(path.join(saveFolder, 'maplat.sqlite')).then(() => true).catch(() => false)).toBe(true);

      const targets: Record<string, string> = {};
      for (const [name, abs] of [
        ['tile', path.join(tileDir, '0.png')],
        ['sqlite', path.join(saveFolder, 'maplat.sqlite')],
        ['symlinkSecret', path.join(saveFolder, 'oct26-m4-t2ff-link', 'secret.txt')],
      ] as const) {
        targets[`${name}@sameOrigin`] = sameOriginLocalUrl(abs);
        targets[`${name}@legacyLocal`] = legacyLocalUrl(abs);
      }

      // ---- AC-FF-6: 他 origin のページ（非表示 BrowserWindow）から fetch / crossOrigin <img> で読めない ----
      const otherOrigins = await app.evaluate(async ({ BrowserWindow }, urls) => {
        const http = process.getBuiltinModule('node:http') as typeof import('node:http');
        const server = http.createServer((_req, res) => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<!doctype html><title>other-origin</title>');
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as { port: number }).port;
        const probe = async (pageUrl: string) => {
          const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
          try {
            await w.loadURL(pageUrl);
            return await w.webContents.executeJavaScript(`(async () => {
              const urls = ${JSON.stringify(urls)};
              const f = async (x) => { try { const r = await fetch(x); const t = await r.text(); return { status: r.status, len: t.length }; } catch (e) { return 'fetch-error:' + e.name; } };
              const img = (x) => new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; const t = setTimeout(() => res('timeout'), 8000);
                i.onload = () => { clearTimeout(t); try { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); c.toDataURL(); res('load+readable'); } catch (e) { res('load+tainted'); } };
                i.onerror = () => { clearTimeout(t); res('error'); }; i.src = x; });
              const out = { origin: location.origin };
              for (const [k, x] of Object.entries(urls)) out[k] = { fetch: await f(x), imgCors: await img(x) };
              return out;
            })()`);
          } finally {
            w.destroy();
          }
        };
        try {
          return { http: await probe(`http://127.0.0.1:${port}/`), data: await probe('data:text/html,<title>null-origin</title>') };
        } finally {
          server.close();
        }
      }, targets);
      console.log('[AC-FF-6] other origins', JSON.stringify(otherOrigins));
      for (const originKey of ['http', 'data'] as const) {
        const r = otherOrigins[originKey] as Record<string, any>;
        for (const key of Object.keys(targets)) {
          expect.soft(typeof r[key].fetch === 'string' && r[key].fetch.startsWith('fetch-error:'),
            `[${originKey} ${r.origin}] ${key} を fetch で読めてはならない: ${JSON.stringify(r[key])}`).toBe(true);
          expect.soft(r[key].imgCors, `[${originKey} ${r.origin}] ${key} を crossOrigin <img> で読めてはならない`).not.toBe('load+readable');
        }
      }

      // ---- AC-FF-7a（oct26-m4-t6 AC5(a)）: 同一 origin のローカル HTML を renderer の iframe に埋め込めない
      //      （renderer CSP の frame-src で拒否）・renderer（親）の DOM に触れない ----
      const titleBefore = await page.title();
      const consoleBefore = consoleTexts.length;
      const htmlUrl = sameOriginLocalUrl(path.join(saveFolder, 'oct26-m4-t2ff-evil.html'));
      const iframeResult = await page.evaluate(async (u) => new Promise<{ loaded: boolean; title: string }>((resolve) => {
        const f = document.createElement('iframe');
        f.style.display = 'none';
        const timer = setTimeout(() => { f.remove(); resolve({ loaded: false, title: document.title }); }, 8000);
        f.onload = () => setTimeout(() => { clearTimeout(timer); const title = document.title; f.remove(); resolve({ loaded: true, title }); }, 1000);
        f.src = u;
        document.body.appendChild(f);
      }), htmlUrl);
      const frameSrcViolations = consoleTexts.slice(consoleBefore).filter((t) => /Content Security Policy/.test(t) && /frame-src/.test(t));
      console.log('[AC-FF-7a] same-origin local html in renderer iframe', JSON.stringify({ titleBefore, iframeResult, frameSrcViolations: frameSrcViolations.length }));
      expect.soft(iframeResult.title, 'ローカル HTML のスクリプトが renderer の DOM を書き換えた').not.toBe('PWNED-BY-LOCAL-HTML');
      expect.soft(frameSrcViolations.length, 'renderer の iframe への __local HTML の埋め込みが frame-src で拒否されない').toBeGreaterThan(0);
      if (iframeResult.title === 'PWNED-BY-LOCAL-HTML') await page.evaluate((t) => { document.title = t; }, titleBefore);

      // ---- AC-FF-7b（oct26-m4-t6 AC5(b)）: renderer CSP の無い文書（トップレベル）で開いたローカル HTML のスクリプトが走らない
      //      （__local の sandbox CSP の効き。renderer CSP の frame-src に隠れないよう iframe を使わない）----
      const topLevel = await app.evaluate(async ({ BrowserWindow }, u) => {
        const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
        try {
          await w.loadURL(u);
          await new Promise((r) => setTimeout(r, 1000));
          return { title: w.webContents.getTitle() };
        } finally {
          w.destroy();
        }
      }, sameOriginLocalUrl(path.join(saveFolder, 'oct26-m4-t6-evil-top.html')));
      console.log('[AC-FF-7b] same-origin local html top-level', JSON.stringify(topLevel));
      expect.soft(topLevel.title, 'トップレベルで開いたローカル HTML のスクリプトが走った（sandbox CSP が効いていない）／文書が読めていない').toBe('LOCAL-HTML-TOP');

      // ---- AC-FF-8: 欠損以外の失敗（権限 000・ディレクトリ）を 404 に畳まない ----
      const nopermUrl = sameOriginLocalUrl(nopermPath);
      const dirUrl = sameOriginLocalUrl(path.join(saveFolder, 'tiles')) + '/';
      const failStatus = await page.evaluate(async (urls) => {
        const one = async (u: string) => { try { return (await fetch(u)).status; } catch (e) { return String(e); } };
        return { noperm: await one(urls[0]), dir: await one(urls[1]) };
      }, [nopermUrl, dirUrl]);
      console.log('[AC-FF-8] non-ENOENT failures', JSON.stringify(failStatus));
      expect.soft(failStatus.noperm, '権限 000 のファイルは 403（404 に畳まない）').toBe(403);
      expect.soft(failStatus.dir, 'ディレクトリ URL は 403（404 に畳まない）').toBe(403);
    } finally {
      await chmod(nopermPath, 0o644).catch(() => {});
      await quitElectronApplication(launched.app);
    }
  });
});
