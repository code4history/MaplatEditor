// nov26-m6-t8（#113・HR-19）: 書き出す中身の選択（タスク設計 v2 §6・AC1〜AC4・AC6）。
//
// 固定する受け入れ条件:
//   (a)  地図の書き出しを選択の 7 通り（3 つの部分集合から空を除く）で行い、エントリの一覧が §3.1 の割り当てどおり（AC1）
//   (b)  既定（引数の省略と DEFAULT_MAP_EXPORT_OPTIONS の両方）の一覧と各エントリの SHA-256 が、
//        変更前の master（57e8540）で作ったものと完全に同じ（AC2。目録も originals/ も入らない）
//   (c)  3 つとも選ぶと「現行の一覧＋originals/{slug}.{ext}＋export-manifest.json」。原画像の実体が無い地図では (b) と同じ
//   (c2) 既定以外の 6 通りで目録があり、contents が実際の中身と一致する
//   (c3) 申し送り T8-R2-MIN-1: タイルの無い地図を既定で書き出すと、目録が tiles:false を言い、その zip は取り込める
//   (d)  取り込み: 目録 tiles:false は取り込める／目録なしでタイル・サムネイルが欠けると NoTile・NoTmb／
//        目録と中身の食い違い・壊れた目録・未知の version は Corrupt／JSON 無しは NoJson。どれも 30 秒以内に settle。
//        原画像入りは originals/<新しい uid>.<ext> に置かれる（AC3）
//   (e)  アプリの書き出しで includeTiles:false のとき tiles/・merc/ のタイルの実体が無く、
//        app JSON と maps/*.json の中身（タイルの URL を含む）は includeTiles:true と同じ（AC4）。進捗は 100% を超えない
//   (f)  11 言語に 8 キーがある（AC6）
//
// 基準（b）の作り方: 変更前の master で `node scripts/nov26-m6-t8-export-options-smoke.mjs --write-baseline` を走らせ、
// scripts/fixtures/nov26-m6-t8-default-map-export.json に保存した（このファイルを手で書き換えない）。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const baselineFile = path.join(projectRoot, 'scripts/fixtures/nov26-m6-t8-default-map-export.json');
const writeBaseline = process.argv.includes('--write-baseline');

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t8-export-options-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');
const p = (rel) => JSON.stringify(path.join(projectRoot, rel));

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = {
      getPath() { return ${JSON.stringify(workDir)}; },
      getAppPath() { return ${JSON.stringify(projectRoot)}; },
      getName() { return 'MaplatEditor'; },
      isPackaged: false,
      whenReady() { return Promise.resolve(); }, exit() {},
    };
    export const dialog = {
      async showSaveDialog() { return (globalThis as any).__nextDialogResult || { canceled: true }; },
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showMessageBox() { return { response: 0 }; },
    };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
    export const BrowserWindow = class {
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
  `);
  await writeFile(storeStub, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  // ---------------------------------------------------------------------------
  // 共通の前置き（基準を書くときも検査するときも同じ fixture を作る）
  // ---------------------------------------------------------------------------
  const prelude = `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import nodeFs from 'node:fs';
    import crypto from 'node:crypto';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};

    const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    const { buildAndWriteMapZip } = await import(${p('electron/utils/mapDownloadZip.ts')});

    const win = { webContents: { send() {} }, isDestroyed() { return false; } } as any;
    const put = (rel: string, data: string | Buffer) => {
      const abs = nodePath.join(dataDir, rel);
      nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
      nodeFs.writeFileSync(abs, data);
    };

    // 地図 1 件: タイル（2 枚）・通常／512px サムネイル・原画像（png）・インライン POI（icon つき）
    const UID = '8a8a8a8a-1111-4111-8111-111111111111';
    const SLUG = 'm6t8map';
    put('tiles/' + UID + '/0/0/0.jpg', 'TILE-000');
    put('tiles/' + UID + '/1/0/1.jpg', 'TILE-101');
    put('tmbs/' + UID + '.jpg', 'THUMB');
    put('tmbs/' + UID + '_512.webp', 'THUMB512');
    put('originals/' + UID + '.png', 'ORIGINAL-PNG-BYTES');
    const mapObject = {
      mapID: SLUG, title: 'M6T8 地図', attr: 'test', lang: 'ja', gcps: [], edges: [],
      imageExtension: 'png', width: 400, height: 300,
      pois: [{
        type: 'FeatureCollection', icon: 'builtin:defaultpin',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [134.69, 34.84] }, properties: { name: '天守' } }],
      }],
    };

    const listZip = (zipPath: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const e of new AdmZip(zipPath).getEntries()) {
        if (e.isDirectory) continue;
        out[e.entryName] = crypto.createHash('sha256').update(e.getData()).digest('hex');
      }
      return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
    };
    let zipSeq = 0;
    const exportMap = async (obj: any, slug: string, uid: string, ...rest: any[]) => {
      const out = nodePath.join(workDir, 'out-' + (zipSeq++) + '.zip');
      await (buildAndWriteMapZip as any)(win, obj, [], slug, uid, out, ...rest);
      return out;
    };
  `;

  const baselineBody = `
    const out = await exportMap(mapObject, SLUG, UID);
    const entries = listZip(out);
    console.log('BASELINE_JSON=' + JSON.stringify({ entries }));
  `;

  const checkBody = `
    const {
      DEFAULT_MAP_EXPORT_OPTIONS, normalizeMapExportOptions, normalizeAppExportOptions,
      buildExportManifest, parseExportManifest, EXPORT_MANIFEST_NAME,
      InvalidExportOptionsError, CorruptExportManifestError,
    } = await import(${p('src/utils/exportOptions.ts')});
    const baseline = ${JSON.stringify(writeBaseline ? null : JSON.parse(await readFile(baselineFile, 'utf8')))};
    const baseEntries: Record<string, string> = baseline.entries;
    const baseNames = Object.keys(baseEntries);

    // ===================================================================
    // 前提: 正規化と目録の単体
    // ===================================================================
    assert.deepEqual(normalizeMapExportOptions(undefined), { tiles: true, json: true, originals: false }, '省略は既定');
    assert.deepEqual(normalizeMapExportOptions({ tiles: false }), { tiles: false, json: true, originals: false }, '欠けたキーは既定で埋める');
    assert.deepEqual(normalizeMapExportOptions({ originals: 'yes' }), { tiles: true, json: true, originals: false }, 'boolean でない値は既定');
    assert.throws(() => normalizeMapExportOptions({ tiles: false, json: false, originals: false }), InvalidExportOptionsError, '3 つとも false は不正');
    assert.deepEqual(normalizeAppExportOptions(undefined), { includeTiles: true });
    assert.deepEqual(normalizeAppExportOptions({ includeTiles: false }), { includeTiles: false });
    const sample = { tiles: false, json: true, originals: true };
    assert.deepEqual(parseExportManifest(buildExportManifest(sample)).contents, sample, '目録の往復');
    assert.throws(() => parseExportManifest('{broken'), CorruptExportManifestError);
    assert.throws(() => parseExportManifest(JSON.stringify({ format: 'maplat-map-export', version: 2, contents: sample })), CorruptExportManifestError);
    assert.throws(() => parseExportManifest(JSON.stringify({ format: 'maplat-map-export', version: 1, contents: { tiles: 1 } })), CorruptExportManifestError);
    console.log('ok 前提: 正規化と目録の単体');

    // 区分の割り当て（§3.1）
    const categoryOf = (name: string): 'json' | 'tiles' | 'originals' | 'manifest' => {
      if (name === EXPORT_MANIFEST_NAME) return 'manifest';
      if (/^(maps|pois|imgs)\\//.test(name)) return 'json';
      if (/^(tiles|tmbs)\\//.test(name)) return 'tiles';
      if (/^originals\\//.test(name)) return 'originals';
      throw new Error('区分の分からないエントリ: ' + name);
    };
    // 基準の一覧が 3 区分のどれかに必ず入り、json・tiles の両方を含む（fixture の網羅の確認）
    const baseCats = new Set(baseNames.map(categoryOf));
    assert.ok(baseCats.has('json') && baseCats.has('tiles'), '基準は json と tiles を含む: ' + JSON.stringify(baseNames));
    assert.ok(baseNames.some((n) => n.startsWith('imgs/')), 'fixture は imgs/（POI のアイコン）を含む: ' + JSON.stringify(baseNames));
    assert.ok(baseNames.some((n) => n.startsWith('pois/')), 'fixture は pois/ を含む');
    assert.ok(!baseNames.some((n) => n.startsWith('originals/') || n === EXPORT_MANIFEST_NAME), '基準（変更前）に原画像・目録は無い');

    // ===================================================================
    // (b) 既定は変更前と完全に同じ
    // ===================================================================
    {
      const omitted = listZip(await exportMap(mapObject, SLUG, UID));
      assert.deepEqual(omitted, baseEntries, '(b) 引数を省略した既定の書き出しが変更前と同じ（一覧と SHA-256）');
      const explicit = listZip(await exportMap(mapObject, SLUG, UID, { ...DEFAULT_MAP_EXPORT_OPTIONS }));
      assert.deepEqual(explicit, baseEntries, '(b) DEFAULT_MAP_EXPORT_OPTIONS を渡した書き出しが変更前と同じ');
      console.log('ok (b): 既定の書き出し物は変更前と一覧・中身とも同じ（' + baseNames.length + ' エントリ）');
    }

    // ===================================================================
    // (a)(c)(c2) 7 通り
    // ===================================================================
    const ORIGINAL_NAME = 'originals/' + SLUG + '.png';
    const ORIGINAL_SHA = crypto.createHash('sha256').update('ORIGINAL-PNG-BYTES').digest('hex');
    const zipsBySubset: Record<string, string> = {};
    for (const tiles of [true, false]) for (const json of [true, false]) for (const originals of [true, false]) {
      if (!tiles && !json && !originals) continue;
      const opts = { tiles, json, originals };
      const key = JSON.stringify(opts);
      const zipPath = await exportMap(mapObject, SLUG, UID, opts);
      zipsBySubset[key] = zipPath;
      const got = listZip(zipPath);
      const isDefault = tiles && json && !originals;
      const expected: Record<string, string> = {};
      for (const name of baseNames) {
        const c = categoryOf(name);
        if ((c === 'json' && json) || (c === 'tiles' && tiles)) expected[name] = baseEntries[name];
      }
      if (originals) expected[ORIGINAL_NAME] = ORIGINAL_SHA;
      const gotWithoutManifest = Object.fromEntries(Object.entries(got).filter(([n]) => n !== EXPORT_MANIFEST_NAME));
      assert.deepEqual(gotWithoutManifest, Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b))),
        '(a) ' + key + ' の一覧と中身が割り当てどおり');
      if (isDefault) {
        assert.equal(EXPORT_MANIFEST_NAME in got, false, '(c2) 既定には目録が無い');
      } else {
        assert.ok(EXPORT_MANIFEST_NAME in got, '(c2) ' + key + ' には目録がある');
        const text = new AdmZip(zipPath).getEntry(EXPORT_MANIFEST_NAME)!.getData().toString('utf8');
        assert.deepEqual(parseExportManifest(text).contents, opts, '(c2) ' + key + ' の目録が実際の中身と一致');
      }
    }
    {
      const all = listZip(zipsBySubset[JSON.stringify({ tiles: true, json: true, originals: true })]);
      assert.deepEqual(Object.keys(all).sort(), [...baseNames, ORIGINAL_NAME, EXPORT_MANIFEST_NAME].sort(),
        '(c) 3 つとも選ぶと 現行の一覧＋原画像＋目録');
      for (const n of baseNames) assert.equal(all[n], baseEntries[n], '(c) 共通のエントリの中身は既定と同じ: ' + n);
    }
    console.log('ok (a)(c2): 7 通りの一覧が割り当てどおりで、既定以外の 6 通りは目録が中身と一致');

    // 原画像の実体が無い地図で 3 つとも選ぶ → 既定と同じ一覧（目録も入らない）
    const UID2 = '8a8a8a8a-2222-4222-8222-222222222222';
    const SLUG2 = 'm6t8noorig';
    put('tiles/' + UID2 + '/0/0/0.jpg', 'TILE2');
    put('tmbs/' + UID2 + '.jpg', 'THUMB2');
    const map2 = { ...mapObject, mapID: SLUG2, pois: [] };
    {
      const def2 = listZip(await exportMap(map2, SLUG2, UID2));
      const all2 = listZip(await exportMap(map2, SLUG2, UID2, { tiles: true, json: true, originals: true }));
      assert.deepEqual(all2, def2, '(c) 原画像の無い地図で 3 つとも選ぶと既定と同じ一覧（目録も無い）');
      assert.equal(EXPORT_MANIFEST_NAME in all2, false);
      console.log('ok (c): 原画像の実体が無ければ黙って省き、目録も入らない');
    }

    // (c3) T8-R2-MIN-1: タイルの無い地図を既定で書き出す → 目録 tiles:false
    const UID3 = '8a8a8a8a-3333-4333-8333-333333333333';
    const SLUG3 = 'm6t8notile';
    const map3 = { ...mapObject, mapID: SLUG3, pois: [] };
    const noTileDefaultZip = await exportMap(map3, SLUG3, UID3);
    {
      const got = listZip(noTileDefaultZip);
      assert.ok(EXPORT_MANIFEST_NAME in got, '(c3) タイルの無い地図の既定の書き出しには目録がある: ' + JSON.stringify(Object.keys(got)));
      const text = new AdmZip(noTileDefaultZip).getEntry(EXPORT_MANIFEST_NAME)!.getData().toString('utf8');
      assert.deepEqual(parseExportManifest(text).contents, { tiles: false, json: true, originals: false },
        '(c3) タイルが積まれなかったので tiles:false');
      // タイルはあるがサムネイルが無い地図も tiles:false（tiles と tmbs の両方が積まれたときだけ true）
      const UID4 = '8a8a8a8a-4444-4444-8444-444444444444';
      put('tiles/' + UID4 + '/0/0/0.jpg', 'TILE4');
      const z4 = await exportMap({ ...mapObject, mapID: 'm6t8nothumb', pois: [] }, 'm6t8nothumb', UID4);
      const t4 = new AdmZip(z4).getEntry(EXPORT_MANIFEST_NAME);
      assert.ok(t4, '(c3) サムネイルが無い地図の既定の書き出しにも目録がある');
      assert.equal(parseExportManifest(t4!.getData().toString('utf8')).contents.tiles, false, '(c3) サムネイルが無ければ tiles:false');
      console.log('ok (c3): タイルかサムネイルが積まれなかった書き出しは目録で tiles:false を言う');
    }

    // ===================================================================
    // (d) 取り込み
    // ===================================================================
    const { default: SqliteDataService } = await import(${p('electron/services/SqliteDataService.ts')});
    await SqliteDataService.getDb();
    const { default: dataUploadService } = await import(${p('electron/services/DataUploadService.ts')});
    const settle = async (zipPath: string) => {
      let timer: any;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('30 秒以内に settle しない: ' + zipPath)), 30000); });
      try {
        return await Promise.race([dataUploadService.extractZip(zipPath), timeout]) as any;
      } finally { clearTimeout(timer); }
    };
    const rewrite = (src: string, edit: (zip: any) => void) => {
      const zip = new AdmZip(src);
      edit(zip);
      const out = nodePath.join(workDir, 'edited-' + (zipSeq++) + '.zip');
      zip.writeZip(out);
      return out;
    };
    const originalsDir = nodePath.join(dataDir, 'originals');
    const tilesDir = nodePath.join(dataDir, 'tiles');
    const tmbsDir = nodePath.join(dataDir, 'tmbs');

    {
      // タイルを外した zip（目録 tiles:false）は取り込める
      const r = await settle(zipsBySubset[JSON.stringify({ tiles: false, json: true, originals: false })]);
      assert.equal(r.err, undefined, '(d) 目録 tiles:false は取り込める: ' + JSON.stringify(r).slice(0, 300));
      assert.ok(r.mapData?.uid, '(d) 地図ができる');
      assert.equal(nodeFs.existsSync(nodePath.join(tilesDir, r.mapData.uid)), false, '(d) タイルは置かれない');
      assert.equal(nodeFs.existsSync(nodePath.join(tmbsDir, r.mapData.uid + '.jpg')), false, '(d) サムネイルは置かれない');
      assert.equal(r.mapData.url_, undefined, '(d) タイルの無い地図は url_ を持たない');

      // (c3) の zip（タイルの無い地図の既定の書き出し）も取り込める
      const r3 = await settle(noTileDefaultZip);
      assert.equal(r3.err, undefined, '(c3) タイルの無い地図の既定の書き出しは取り込める: ' + JSON.stringify(r3).slice(0, 300));
      assert.ok(r3.mapData?.uid);
    }
    {
      // 目録の無い zip からタイル・サムネイルを消したもの（途中で切れた書き出し物の代わり）は従来どおり
      const defZip = await exportMap(mapObject, SLUG, UID);
      const noTiles = rewrite(defZip, (zip) => {
        for (const e of [...zip.getEntries()]) if (e.entryName.startsWith('tiles/')) zip.deleteFile(e.entryName);
      });
      assert.equal((await settle(noTiles)).err, 'NoTile', '(d) 目録なし・タイル欠け → NoTile');
      const noTmb = rewrite(defZip, (zip) => zip.deleteFile('tmbs/' + SLUG + '.jpg'));
      assert.equal((await settle(noTmb)).err, 'NoTmb', '(d) 目録なし・サムネイル欠け → NoTmb');
    }
    {
      const allZip = zipsBySubset[JSON.stringify({ tiles: true, json: true, originals: true })];
      // 目録が originals:true なのに原画像が無い → Corrupt
      const missingOriginal = rewrite(allZip, (zip) => zip.deleteFile(ORIGINAL_NAME));
      assert.equal((await settle(missingOriginal)).err, 'Corrupt', '(d) 目録と中身の食い違い → Corrupt');
      // 目録が tiles:true（明示）なのにタイルが無い → 従来どおり NoTile（目録が「入れた」と言う中身の欠け）
      const tilesClaimed = rewrite(allZip, (zip) => {
        for (const e of [...zip.getEntries()]) if (e.entryName.startsWith('tiles/')) zip.deleteFile(e.entryName);
      });
      assert.equal((await settle(tilesClaimed)).err, 'NoTile', '(d) 目録 tiles:true でタイル欠け → NoTile');
      // 壊れた目録・未知の version → Corrupt
      const broken = rewrite(allZip, (zip) => zip.updateFile(EXPORT_MANIFEST_NAME, Buffer.from('{not json')));
      assert.equal((await settle(broken)).err, 'Corrupt', '(d) 壊れた目録 → Corrupt');
      const future = rewrite(allZip, (zip) => zip.updateFile(EXPORT_MANIFEST_NAME, Buffer.from(JSON.stringify({
        format: 'maplat-map-export', version: 99, contents: { tiles: true, json: true, originals: true } }))));
      assert.equal((await settle(future)).err, 'Corrupt', '(d) 未知の version → Corrupt');
    }
    {
      // JSON の無い zip → NoJson（目録あり・目録なしの両方）
      const noJson = zipsBySubset[JSON.stringify({ tiles: true, json: false, originals: false })];
      assert.equal((await settle(noJson)).err, 'NoJson', '(d) JSON 無し（目録あり）→ NoJson');
      const defZip = await exportMap(mapObject, SLUG, UID);
      const noJsonNoManifest = rewrite(defZip, (zip) => zip.deleteFile('maps/' + SLUG + '.json'));
      assert.equal((await settle(noJsonNoManifest)).err, 'NoJson', '(d) JSON 無し（目録なし）→ NoJson');
    }
    {
      // 原画像入りは originals/<新しい uid>.<ext> へ置かれる
      const r = await settle(zipsBySubset[JSON.stringify({ tiles: true, json: true, originals: true })]);
      assert.equal(r.err, undefined, '(d) 3 つとも入った zip は取り込める: ' + JSON.stringify(r).slice(0, 300));
      const placed = nodePath.join(originalsDir, r.mapData.uid + '.png');
      assert.ok(nodeFs.existsSync(placed), '(d) 原画像が originals/<新しい uid>.png に置かれる');
      assert.equal(nodeFs.readFileSync(placed, 'utf8'), 'ORIGINAL-PNG-BYTES', '(d) 原画像の中身が同じ');
      assert.equal(nodeFs.existsSync(nodePath.join(tilesDir, r.mapData.uid, '0', '0', '0.jpg')), true, '(d) タイルも置かれる');
      // 原画像だけの zip（タイル・JSON 無し）は JSON が無いので NoJson、原画像は残さない
      const before = nodeFs.readdirSync(originalsDir).length;
      const onlyOrig = await settle(zipsBySubset[JSON.stringify({ tiles: false, json: false, originals: true })]);
      assert.equal(onlyOrig.err, 'NoJson', '(d) 原画像だけ → NoJson');
      assert.equal(nodeFs.readdirSync(originalsDir).length, before, '(d) 失敗した取り込みは原画像を残さない');
    }
    console.log('ok (d): 取り込みは目録が外した中身だけを無いものとして扱い、失敗はコードで settle する');

    // ===================================================================
    // (e) アプリの書き出しの includeTiles
    // ===================================================================
    {
      const { default: AppExportService } = await import(${p('electron/services/AppExportService.ts')});
      const { uid: appMapUid } = await SqliteDataService.createMap('m6t8-app-map', {
        title: { ja: 'アプリの地図' }, attr: { ja: 'a' }, lang: 'ja', width: 400, height: 300,
        gcps: [], edges: [], url: '',
      });
      put('tiles/' + appMapUid + '/0/0/0.jpg', 'APPTILE');
      put('tiles/' + appMapUid + '/1/1/1.jpg', 'APPTILE2');
      put('tmbs/' + appMapUid + '.jpg', 'APPTHUMB');
      const MERC_UID = '8a8a8a8a-5555-4555-8555-555555555555';
      await SqliteDataService.saveUserBaseMap({
        uid: MERC_UID, slug: 'm6t8-merc', create: true,
        tms: {
          kind: 'merc', lang: 'ja', title: { ja: 'M' }, label: { ja: 'M' }, attr: { ja: 'm' }, dataAttr: {},
          license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {}, url: '', minZoom: 0, maxZoom: 1,
          thumbnail: '', coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null,
        },
      });
      put('merc/' + MERC_UID + '/0/0/0.png', 'MERCTILE');
      put('merc/' + MERC_UID + '/tilejson.json', JSON.stringify({ tilejson: '3.0.0', tiles: ['x/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 1 }));
      const doc = {
        appID: 'm6t8_app', title: { ja: 'アプリ' }, lang: 'ja',
        sources: [
          { sourceType: 'maplat', mapID: 'm6t8-app-map', role: 'maplat', startFrom: true,
            data: { mapID: 'm6t8-app-map', maptype: 'maplat', noload: true } },
          { sourceType: 'tms', mapUid: 'm6t8-merc', baseMapUid: MERC_UID, role: 'base', overrides: {} },
        ],
        startFrom: 'm6t8-app-map',
      };
      const runExport = async (options: any) => {
        const sent: any[] = [];
        const fakeWin = { webContents: { send(channel: string, payload: any) { if (channel === 'app:taskProgress') sent.push(payload); } } };
        const out = nodePath.join(workDir, 'app-' + (zipSeq++) + '.zip');
        (globalThis as any).__nextDialogResult = { canceled: false, filePath: out };
        const r = await (AppExportService.exportApp as any)(fakeWin, doc, undefined, options);
        assert.equal(r.result, 'Success', '(e) 書き出しが成功する: ' + JSON.stringify(r));
        const zip = new AdmZip(out);
        const names = zip.getEntries().filter((e: any) => !e.isDirectory).map((e: any) => e.entryName).sort();
        const text = (n: string) => zip.getEntry(n)!.getData().toString('utf8');
        return { names, text, sent };
      };
      const withTiles = await runExport(undefined);
      const explicitTrue = await runExport({ includeTiles: true });
      const noTiles = await runExport({ includeTiles: false });
      assert.deepEqual(explicitTrue.names, withTiles.names, '(e) includeTiles:true は省略と同じ一覧');
      assert.ok(withTiles.names.some((n) => n.startsWith('tiles/m6t8-app-map/')), '(e) 前提: 既定ではタイルが入る: ' + JSON.stringify(withTiles.names));
      assert.ok(withTiles.names.includes('merc/m6t8-merc/0/0/0.png'), '(e) 前提: 既定では merc のタイルが入る');
      assert.deepEqual(noTiles.names.filter((n) => n.startsWith('tiles/')), [], '(e) includeTiles:false で tiles/ が無い: ' + JSON.stringify(noTiles.names));
      assert.deepEqual(noTiles.names.filter((n) => n.startsWith('merc/') && !n.endsWith('/tilejson.json')), [],
        '(e) includeTiles:false で merc/ のタイルの実体が無い');
      // タイル以外のエントリは同じ
      const nonTile = (names: string[]) => names.filter((n) => !n.startsWith('tiles/') && !(n.startsWith('merc/') && !n.endsWith('/tilejson.json')));
      assert.deepEqual(noTiles.names, nonTile(withTiles.names), '(e) タイル以外のエントリは includeTiles:true と同じ');
      for (const n of withTiles.names.filter((x) => /^(apps|maps)\\/.*\\.json$/.test(x) || x.endsWith('/tilejson.json'))) {
        assert.equal(noTiles.text(n), withTiles.text(n), '(e) ' + n + ' の中身（タイルの URL を含む）が同じ');
      }
      for (const run of [withTiles, noTiles]) {
        const percents = run.sent.map((s: any) => s.percent);
        assert.ok(percents.every((v: number) => v >= 0 && v <= 100), '(e) 進捗が 0〜100 に収まる: ' + JSON.stringify(percents));
        assert.equal(percents[percents.length - 1], 100, '(e) 進捗は最後に 100 へ届く');
      }
      console.log('ok (e): アプリの「タイルを含めない」で tiles/・merc/ の実体が無く、JSON とタイルの URL は同じ');
    }

    // ===================================================================
    // (f) 11 言語に 8 キー
    // ===================================================================
    {
      const KEYS = [
        'mapedit.export_options_title', 'mapedit.export_option_tiles', 'mapedit.export_option_json',
        'mapedit.export_option_originals', 'mapedit.export_option_originals_note', 'mapedit.export_option_none_selected',
        'appedit.export_exclude_tiles', 'dataupload.error_no_json',
      ];
      const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
      const localesDir = ${p('public/locales')};
      assert.deepEqual(nodeFs.readdirSync(localesDir).filter((d) => !d.startsWith('.')).sort(), [...LANGS].sort(), '(f) 言語は 11');
      for (const lang of LANGS) {
        const json = JSON.parse(nodeFs.readFileSync(nodePath.join(localesDir, lang, 'translation.json'), 'utf8'));
        for (const key of KEYS) {
          const value = key.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), json);
          assert.equal(typeof value, 'string', '(f) ' + lang + ' に ' + key + ' がある');
          assert.ok(value.trim().length > 0, '(f) ' + lang + ' の ' + key + ' が空でない');
        }
      }
      console.log('ok (f): 11 言語に 8 キーがある');
    }

    console.log('nov26-m6-t8 export options OK');
    process.exit(0);
  `;

  await writeFile(entryFile, prelude + (writeBaseline ? baselineBody : checkBody));

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [
      { find: 'electron', replacement: electronStub },
      { find: 'electron-store', replacement: storeStub },
    ]},
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: {
        external: ['jimp', 'adm-zip', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 300000, maxBuffer: 1024 * 1024 * 16,
  });
  if (writeBaseline) {
    const line = stdout.split('\n').find((l) => l.startsWith('BASELINE_JSON='));
    assert.ok(line, '基準の出力が無い');
    const data = JSON.parse(line.slice('BASELINE_JSON='.length));
    await mkdir(path.dirname(baselineFile), { recursive: true });
    await writeFile(baselineFile, JSON.stringify({
      note: 'nov26-m6-t8 (b): 変更前の master で --write-baseline により生成した、既定の地図の書き出し物のエントリと SHA-256。手で書き換えない',
      entries: data.entries,
    }, null, 2) + '\n');
    console.log('baseline written: ' + path.relative(projectRoot, baselineFile) + ' (' + Object.keys(data.entries).length + ' entries)');
  } else {
    process.stdout.write(stdout);
    console.log('nov26-m6-t8 export options smoke passed');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
