// 書き出しの ZIP の中身: IIIF のまま配る地図（地図データに delivery を持つ地図）は
// タイルを同梱しない。書誌だけ IIIF から写した地図（delivery を持たない）は今のまま
// タイルを同梱する。目録（export-manifest.json）があるときは、目録の tiles の真偽が
// ZIP の中に tiles/ があるかと一致する。
//
// 見る書き出しの道は 2 つ:
//   1. アプリの書き出し（AppExportService.exportApp）
//      - タイルを同梱しない・maps/<slug>.json に delivery と iiif が入り url_ が無い
//      - 進捗の事前計上が、同梱しない地図のタイルを数えていない（分母が狂わない）
//   2. 地図 1 枚の ZIP（buildAndWriteMapZip）
//      - tiles/ の項目が無く、目録があれば tiles:false
//
// アプリの書き出しは electron を代役にし、一時フォルダを保存先にして回す。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'iiif-app-export-'));
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

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import nodePath from 'node:path';
    import nodeFs from 'node:fs';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { default: SqliteDataService } = await import(${p('electron/services/SqliteDataService.ts')});
    const { default: AppExportService } = await import(${p('electron/services/AppExportService.ts')});
    const { buildAndWriteMapZip } = await import(${p('electron/utils/mapDownloadZip.ts')});
    const { parseExportManifest, EXPORT_MANIFEST_NAME } = await import(${p('src/utils/exportOptions.ts')});

    const put = (rel: string, data: string | Buffer) => {
      const abs = nodePath.join(dataDir, rel);
      nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
      nodeFs.writeFileSync(abs, data);
    };

    // 地図 2 枚:
    //   A … IIIF のまま配る地図（delivery と iiif を持つ）。タイルの実体を 1 枚だけ置き、
    //       置いてあっても書き出さないことを確かめる
    //   B … 書誌だけ IIIF から写した地図（delivery を持たず iiif を持つ）。タイルの実体を 2 枚置く
    const SLUG_A = 'iiifdeliverymap';
    const SLUG_B = 'iiifbookonlymap';
    const deliveryA = { type: 'iiifImage', url: 'https://iiif.example.org/iiif/2/A/info.json' };
    const iiifA = {
      manifest: 'https://iiif.example.org/iiif/2/A/manifest',
      canvas: 'https://iiif.example.org/iiif/2/A/canvas/1',
      bindings: { title: ['label'] },
    };
    const iiifB = {
      manifest: 'https://iiif.example.org/iiif/2/B/manifest',
      canvas: 'https://iiif.example.org/iiif/2/B/canvas/1',
      bindings: { title: ['label'] },
    };
    const { uid: uidA } = await SqliteDataService.createMap(SLUG_A, {
      title: { ja: 'IIIF のまま配る地図' }, attr: { ja: 'a' }, lang: 'ja', url: '',
      width: 400, height: 300, gcps: [], edges: [],
      delivery: deliveryA, iiif: iiifA,
    });
    const { uid: uidB } = await SqliteDataService.createMap(SLUG_B, {
      title: { ja: '書誌だけ IIIF からの地図' }, attr: { ja: 'b' }, lang: 'ja', url: '',
      width: 400, height: 300, gcps: [], edges: [], iiif: iiifB,
    });
    put('tiles/' + uidA + '/0/0/0.jpg', 'A-TILE-MUST-NOT-BE-EXPORTED');
    put('tiles/' + uidB + '/0/0/0.jpg', 'B-TILE-0');
    put('tiles/' + uidB + '/1/1/1.jpg', 'B-TILE-1');
    put('tmbs/' + uidA + '.jpg', 'A-THUMB');
    put('tmbs/' + uidB + '.jpg', 'B-THUMB');

    const doc = {
      appID: 'iiif_export_app', title: { ja: 'アプリ' }, lang: 'ja',
      sources: [
        { sourceType: 'maplat', mapID: SLUG_A, role: 'maplat', startFrom: true,
          data: { mapID: SLUG_A, maptype: 'maplat', noload: true } },
        { sourceType: 'maplat', mapID: SLUG_B, role: 'maplat',
          data: { mapID: SLUG_B, maptype: 'maplat', noload: true } },
      ],
      startFrom: SLUG_A,
    };

    const fakeWin = (sent: any[]) => ({
      webContents: { send(channel: string, payload: any) { if (channel === 'app:taskProgress') sent.push(payload); } },
    });
    let zipSeq = 0;

    const readZip = (zipPath: string) => {
      const zip = new AdmZip(zipPath);
      const names = zip.getEntries().filter((e: any) => !e.isDirectory).map((e: any) => e.entryName).sort();
      const text = (n: string) => zip.getEntry(n)!.getData().toString('utf8');
      const json = (n: string) => JSON.parse(text(n));
      const has = (prefix: string) => names.some((n: string) => n.startsWith(prefix));
      const manifest = names.includes(EXPORT_MANIFEST_NAME)
        ? parseExportManifest(text(EXPORT_MANIFEST_NAME)).contents
        : null;
      return { names, text, json, has, manifest };
    };

    // 目録があるなら tiles の真偽が ZIP の中の tiles/ の有無と一致する（どの書き出しでも同じ）
    const assertManifestMatchesTiles = (label: string, zip: any) => {
      if (!zip.manifest) return;
      assert.equal(zip.manifest.tiles, zip.has('tiles/'),
        label + ': 目録の tiles が ZIP の tiles/ の有無と一致する（目録=' + JSON.stringify(zip.manifest) + '）');
    };

    // =====================================================================
    // 1. アプリの書き出し
    // =====================================================================
    {
      const sent: any[] = [];
      const out = nodePath.join(workDir, 'app-' + (zipSeq++) + '.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: out };
      const r = await (AppExportService.exportApp as any)(fakeWin(sent), doc, undefined, undefined);
      assert.equal(r.result, 'Success', 'アプリの書き出しが成功する: ' + JSON.stringify(r));
      const zip = readZip(out);

      // A（IIIF のまま配る地図）: タイルを置いてあっても同梱しない
      // 是正の見分け: 直す前は tiles/<slugA>/ が入るので、この 1 行で落ちる
      assert.equal(zip.has('tiles/' + SLUG_A + '/'), false,
        'タイルを同梱しない地図の tiles/ が無い（実際の項目: ' + JSON.stringify(zip.names) + '）');
      assert.ok(zip.names.includes('tmbs/' + SLUG_A + '.jpg'),
        'タイルを同梱しなくても通常のサムネイルは入る');
      const mapA = zip.json('maps/' + SLUG_A + '.json');
      assert.deepEqual(mapA.delivery, deliveryA, 'maps/<slug>.json に delivery が入る');
      assert.ok(mapA.iiif, 'maps/<slug>.json に iiif が入る');
      assert.equal(mapA.url_, undefined, 'maps/<slug>.json に url_ が入らない');

      // B（書誌だけ IIIF から）: 今のままタイルを同梱する
      assert.ok(zip.has('tiles/' + SLUG_B + '/'), 'タイルを同梱する地図の tiles/ がある');
      assert.ok(zip.names.includes('tiles/' + SLUG_B + '/0/0/0.jpg'), 'タイルの実体が入る');
      const mapB = zip.json('maps/' + SLUG_B + '.json');
      assert.equal(mapB.delivery, undefined, 'delivery を持たない地図の maps/<slug>.json に delivery が無い');
      assert.ok(mapB.iiif, 'delivery を持たない地図にも iiif が入る');
      // アプリの書き出しには目録が無い
      assert.equal(zip.names.includes(EXPORT_MANIFEST_NAME), false, 'アプリの書き出しに目録は無い');

      // 進捗: 同梱しない地図のタイルを事前計上で数えていない
      // 是正の見分け: 直す前は分母に A の 1 枚が入り (0/1) になる（この 1 行で落ちる）
      const progressTexts = sent.map((s: any) => String(s.progress ?? ''));
      assert.ok(progressTexts.includes(SLUG_A + ' (0/0)'),
        '同梱しない地図のタイルを数えていない（進捗の内訳: ' + JSON.stringify(progressTexts.slice(0, 6)) + '）');
      assert.ok(progressTexts.includes(SLUG_B + ' (0/2)'),
        'タイルを同梱する地図はタイルを数えている（進捗の内訳: ' + JSON.stringify(progressTexts.slice(0, 6)) + '）');
      const percents = sent.map((s: any) => s.percent);
      assert.equal(percents[percents.length - 1], 100,
        '進捗が最後まで届く（分母に数え漏らしが無い。実際: ' + JSON.stringify(percents) + '）');
      assert.ok(percents.every((v: number) => v >= 0 && v <= 100), '進捗が 0〜100 に収まる');

      console.log('ok: app-zip-layout');
    }

    // =====================================================================
    // 2. 地図 1 枚の ZIP
    // =====================================================================
    {
      const mapObjectA = {
        mapID: SLUG_A, title: 'IIIF のまま配る地図', attr: 'a', lang: 'ja',
        gcps: [], edges: [], pois: [], delivery: deliveryA, iiif: iiifA,
      };
      const zipA = nodePath.join(workDir, 'map-a-' + (zipSeq++) + '.zip');
      await buildAndWriteMapZip(fakeWin([]), mapObjectA, [], SLUG_A, uidA, zipA);
      const a = readZip(zipA);
      // 是正の見分け: 直す前は tiles/<slugA>/… が入るので、この 1 行で落ちる
      assert.equal(a.has('tiles/'), false,
        'タイルを同梱しない地図の ZIP に tiles/ の項目が無い（実際の項目: ' + JSON.stringify(a.names) + '）');
      assert.ok(a.names.includes('tmbs/' + SLUG_A + '.jpg'), 'サムネイルは入る');
      assert.ok(a.manifest, 'タイルを外したので目録がある');
      assert.equal(a.manifest.tiles, false, '目録が tiles:false を言う');
      const mapJsonA = a.json('maps/' + SLUG_A + '.json');
      assert.deepEqual(mapJsonA.delivery, deliveryA, '地図の JSON に delivery が入る');
      assert.ok(mapJsonA.iiif, '地図の JSON に iiif が入る');
      assertManifestMatchesTiles('地図 A', a);

      const mapObjectB = {
        mapID: SLUG_B, title: '書誌だけ IIIF からの地図', attr: 'b', lang: 'ja',
        gcps: [], edges: [], pois: [], iiif: iiifB,
      };
      const zipB = nodePath.join(workDir, 'map-b-' + (zipSeq++) + '.zip');
      await buildAndWriteMapZip(fakeWin([]), mapObjectB, [], SLUG_B, uidB, zipB);
      const b = readZip(zipB);
      assert.ok(b.has('tiles/'), 'タイルを同梱する地図の ZIP に tiles/ の項目がある');
      assert.ok(b.names.includes('tiles/' + SLUG_B + '/0/0/0.jpg'), 'タイルの実体が入る');
      assert.ok(b.names.includes('tiles/' + SLUG_B + '/1/1/1.jpg'), 'タイルの実体が入る');
      assert.equal(b.manifest, null, '中身が既定と同じ書き出しには目録が入らない（今のまま）');
      const mapJsonB = b.json('maps/' + SLUG_B + '.json');
      assert.equal(mapJsonB.delivery, undefined, '地図の JSON に delivery が無い');
      assert.ok(mapJsonB.iiif, '地図の JSON に iiif が入る');
      assertManifestMatchesTiles('地図 B', b);

      console.log('ok: map-zip-layout');
    }

    console.log('ok: export-zip-layout');
  `);

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
  process.stdout.write(stdout);
  console.log('iiif app export smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
