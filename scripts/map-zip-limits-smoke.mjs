// スモーク: 地図 ZIP を展開する前の上限と、ZIP の構造の検査。
//
// 固定すること:
//   (i)   件数の上限を超えた ZIP は 'TooLarge' で返り、展開先に何も書かれない
//   (ii)  宣言の総量の上限・圧縮率の上限（床以上のときだけ）。床の下では比を見ない
//   (iii) 展開後サイズを小さく偽った DEFLATED の ZIP は 'Corrupt' で返り、原文が出ない
//   (iv)  書き出しと同じ名前の ZIP・STORE で書かれた大きな entry を含む ZIP は今までどおり取り込める
//   (v)   上限の境界（純関数）と、検査の呼び忘れの見張り
//   (vi)  STORED の偽り・中央ディレクトリの重なりの 5 通りが、地図と POI のどの経路でも展開前に止まる
//   (vii) 大小だけ違う名前の ZIP が地図でも POI でも取り込まれない
//
// 実行方法: node scripts/map-zip-limits-smoke.mjs。ZIP は小さく作り、上限は extractZip の第 2 引数で小さく渡す。
// 失敗しても途中で止めず、全部の結果を出してから exit 1 にする。
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'map-zip-limits-'));
const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'map-zip-limits-fixtures-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');
const MARKER = 'map zip limits smoke passed';
const baselineNames = Object.keys(JSON.parse(
  await readFile(path.join(projectRoot, 'scripts/fixtures/nov26-m6-t8-default-map-export.json'), 'utf8'),
).entries);

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); } };
    export const ipcMain = { handle() {} };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
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
    import nodeFs from 'node:fs';
    import nodePath from 'node:path';
    import zlib from 'node:zlib';
    import AdmZip from 'adm-zip';

    const projectRoot = ${JSON.stringify(projectRoot)};
    const workDir = ${JSON.stringify(workDir)};
    const fixtureDir = ${JSON.stringify(fixtureDir)};
    const baselineNames = ${JSON.stringify(baselineNames)};
    const MiB = 1024 * 1024;
    const GiB = 1024 * MiB;

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { default: poiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
    const poiPackageService = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiPackageService.ts'))});
    const guard = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/zipImportGuard.ts'))});
    const poiPackage = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/poiPackage.ts'))});
    const { writeZipStreaming } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/zipWriter.ts'))});
    await SqliteDataService.getDb();

    const failures = [];
    const check = async (label, fn) => {
      try {
        const note = await fn();
        console.log('ok ' + label + (note ? ': ' + note : ''));
      } catch (e) {
        failures.push(label);
        console.log('NG ' + label + ': ' + String(e?.message ?? e).split('\\n')[0].slice(0, 300));
      }
    };

    // ---- 測る道具 ----
    const treeBytes = (dir) => {
      let bytes = 0, files = 0;
      if (!nodeFs.existsSync(dir)) return { bytes, files };
      for (const x of nodeFs.readdirSync(dir, { withFileTypes: true })) {
        const p = nodePath.join(dir, x.name);
        if (x.isDirectory()) {
          const sub = treeBytes(p);
          bytes += sub.bytes; files += sub.files;
        } else {
          bytes += nodeFs.statSync(p).size; files += 1;
        }
      }
      return { bytes, files };
    };
    const extractDir = () => nodePath.join(SettingsService.get('tmpFolder'), 'zip');
    const forbidden = (label, value) => {
      const s = JSON.stringify(value);
      for (const needle of ['ADM-ZIP', '{0}', 'ERR_', 'Cannot create', 'inflate', fixtureDir, workDir]) {
        assert.equal(s.includes(needle), false, label + ' の戻り値に ' + JSON.stringify(needle) + ' が含まれる: ' + s);
      }
    };
    let serial = 0;
    const writeFixture = (name, buf) => {
      const p = nodePath.join(fixtureDir, (++serial) + '-' + name);
      nodeFs.writeFileSync(p, buf);
      return p;
    };

    // ---- ZIP を組み立てる道具 ----
    const mapZip = (slug, extra = {}) => {
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: 'limits ' + slug, attr: 'test', lang: 'ja',
        width: 400, height: 300, gcps: [], edges: [],
      })));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB:' + slug));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE:' + slug));
      for (const [name, body] of Object.entries(extra)) zip.addFile(name, body);
      return zip.toBuffer();
    };
    // adm-zip では作れない形（中央ディレクトリの宣言の偽り・同じデータを指す複数の entry）を直に組む。
    // n 件の中央ディレクトリが、すべて先頭のローカルヘッダの同じデータを指す。
    const craftedZip = ({ payload, n, declared, method = 0 }) => {
      const data = method === 8 ? zlib.deflateRawSync(payload) : payload;
      const crc = zlib.crc32(payload) >>> 0;
      const firstName = Buffer.from('tiles/b0.bin');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(declared, 22);
      local.writeUInt16LE(firstName.length, 26);
      const central = [];
      for (let i = 0; i < n; i++) {
        const name = Buffer.from('tiles/b' + i + '.bin');
        const head = Buffer.alloc(46);
        head.writeUInt32LE(0x02014b50, 0);
        head.writeUInt16LE(20, 4);
        head.writeUInt16LE(20, 6);
        head.writeUInt16LE(method, 10);
        head.writeUInt32LE(crc, 16);
        head.writeUInt32LE(data.length, 20);
        head.writeUInt32LE(declared, 24);
        head.writeUInt16LE(name.length, 28);
        central.push(head, name);
      }
      const centralBytes = Buffer.concat(central);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(n, 8);
      end.writeUInt16LE(n, 10);
      end.writeUInt32LE(centralBytes.length, 12);
      end.writeUInt32LE(local.length + firstName.length + data.length, 16);
      return Buffer.concat([local, firstName, data, centralBytes, end]);
    };

    // ---- (i) 件数 ----
    await check('(i) 51 entry に上限 50 → TooLarge・展開先は空', async () => {
      const zip = new AdmZip();
      for (let i = 0; i < 51; i++) zip.addFile('tiles/e/' + i + '.jpg', Buffer.alloc(0));
      const result = await dataUploadService.extractZip(writeFixture('entries.zip', zip.toBuffer()), { limits: { maxEntries: 50 } });
      assert.equal(result.err, 'TooLarge', JSON.stringify(result).slice(0, 200));
      forbidden('(i)', result);
      assert.equal(treeBytes(extractDir()).files, 0, '展開先にファイルが書かれた');
    });

    // ---- (ii) 総量と比 ----
    const zeros = Buffer.alloc(4 * MiB);
    await check('(ii) 総量の上限 1 MiB → TooLarge・展開先は空', async () => {
      const file = writeFixture('total.zip', mapZip('limitstotal', { 'docs/zeros.bin': zeros }));
      const result = await dataUploadService.extractZip(file, { limits: { maxDeclaredBytes: MiB } });
      assert.equal(result.err, 'TooLarge', JSON.stringify(result).slice(0, 200));
      assert.equal(treeBytes(extractDir()).files, 0, '展開先にファイルが書かれた');
    });
    await check('(ii) 床 1 MiB・比 80 → TooLarge（比）', async () => {
      const file = writeFixture('ratio.zip', mapZip('limitsratio', { 'docs/zeros.bin': zeros }));
      const result = await dataUploadService.extractZip(file, { limits: { ratioFloorBytes: MiB, maxRatio: 80 } });
      assert.equal(result.err, 'TooLarge', JSON.stringify(result).slice(0, 200));
    });
    await check('(ii) 床 8 MiB の下は比を見ず通る', async () => {
      const file = writeFixture('floor.zip', mapZip('limitsfloor', { 'docs/zeros.bin': zeros }));
      const result = await dataUploadService.extractZip(file, { limits: { ratioFloorBytes: 8 * MiB } });
      assert.ok(result.mapData, JSON.stringify(result).slice(0, 200));
    });

    // ---- (iii) DEFLATED の展開後サイズの偽り ----
    await check('(iii) 展開後サイズを 1,000 に偽った DEFLATED → Corrupt・書かれた量 ≤ 宣言', async () => {
      const file = writeFixture('forged.zip', craftedZip({ payload: Buffer.alloc(8 * MiB), n: 1, declared: 1000, method: 8 }));
      const result = await dataUploadService.extractZip(file);
      assert.equal(result.err, 'Corrupt', JSON.stringify(result).slice(0, 200));
      forbidden('(iii)', result);
      const written = treeBytes(extractDir());
      assert.ok(written.bytes <= 1000, '書かれた量 ' + written.bytes);
      return '書かれた量 ' + written.bytes + ' / 宣言 1000';
    });

    // ---- (iv) 正当な ZIP ----
    await check('(iv) 既定の書き出しと同じ名前の ZIP が既定の上限で取り込める', async () => {
      const zip = new AdmZip();
      const slug = baselineNames.find((n) => n.startsWith('maps/')).slice('maps/'.length, -'.json'.length);
      for (const name of baselineNames) {
        const body = name.startsWith('maps/')
          ? JSON.stringify({ mapID: slug, title: 'baseline', attr: 'test', lang: 'ja', width: 400, height: 300, gcps: [], edges: [] })
          : name.endsWith('.geojson') ? JSON.stringify({ type: 'FeatureCollection', features: [] }) : 'x';
        zip.addFile(name, Buffer.from(body));
      }
      const result = await dataUploadService.extractZip(writeFixture('baseline.zip', zip.toBuffer()));
      assert.ok(result.mapData, JSON.stringify(result).slice(0, 200));
      return baselineNames.length + ' 件';
    });
    await check('(iv) 8 MiB 超を STORE で書いた ZIP が取り込める', async () => {
      const slug = 'limitsstore';
      const sources = [
        ['maps/' + slug + '.json', JSON.stringify({ mapID: slug, title: 'store', attr: 'test', lang: 'ja', width: 400, height: 300, gcps: [], edges: [] })],
        ['tmbs/' + slug + '.jpg', 'THUMB'],
        ['tiles/' + slug + '/0/0/0.jpg', Buffer.alloc(8 * MiB + 1, 0x41)],
      ].map(([entryName, body]) => {
        const localPath = writeFixture('store-src.bin', body);
        return { entryName, localPath };
      });
      const target = nodePath.join(fixtureDir, 'store.zip');
      await writeZipStreaming(target, sources);
      const stored = new AdmZip(target).getEntries().filter((e) => e.header.method === 0);
      assert.ok(stored.length >= 1, 'STORE の entry が無い');
      const result = await dataUploadService.extractZip(target);
      assert.ok(result.mapData, JSON.stringify(result).slice(0, 200));
    });

    // ---- (v) 境界（純関数） ----
    const limits = guard.MAP_ARCHIVE_LIMITS;
    const assertLimits = guard.assertMapArchiveLimits;
    const kindOf = (fn) => {
      try { fn(); return null; } catch (e) { return e.kind ?? String(e?.message ?? e); }
    };
    await check('(v) 上限の値', () => {
      assert.deepEqual({ ...limits }, {
        maxEntries: 50000, maxDeclaredBytes: 12 * GiB, ratioFloorBytes: GiB, maxRatio: 80, maxEntryBytes: 2 * GiB - 1,
      });
    });
    await check('(v) 件数の境界', () => {
      const entries = Array.from({ length: 50000 }, () => ({ size: 0 }));
      assert.equal(kindOf(() => assertLimits(entries, 1000)), null);
      assert.equal(kindOf(() => assertLimits([...entries, { size: 0 }], 1000)), 'too-many-entries');
    });
    await check('(v) 1 entry の境界', () => {
      assert.equal(kindOf(() => assertLimits([{ size: 2 * GiB - 1 }], GiB)), null);
      assert.equal(kindOf(() => assertLimits([{ size: 2 * GiB }], GiB)), 'expands-too-large');
    });
    await check('(v) 総量の境界', () => {
      const entries = Array.from({ length: 6 }, () => ({ size: 2 * GiB - 1 }));
      const exact = [...entries, { size: 6 }];
      assert.equal(kindOf(() => assertLimits(exact, 2 * GiB)), null);
      assert.equal(kindOf(() => assertLimits([...exact, { size: 1 }], 2 * GiB)), 'expands-too-large');
    });
    await check('(v) 比の境界（床以上）と床の下', () => {
      const archive = 16 * MiB;
      assert.equal(kindOf(() => assertLimits([{ size: 80 * archive }], archive)), null);
      assert.equal(kindOf(() => assertLimits([{ size: 80 * archive + 1 }], archive)), 'expands-too-large');
      assert.equal(kindOf(() => assertLimits([{ size: GiB - 1 }], 1024)), null);
      assert.equal(kindOf(() => assertLimits([{ size: GiB }], 1024)), 'expands-too-large');
    });
    await check('(v) ERR_BUFFER_TOO_LARGE は corrupt・名前つきの重複は duplicate-entry', () => {
      const tooBig = Object.assign(new Error('Cannot create a Buffer larger than 1000 bytes'), { code: 'ERR_BUFFER_TOO_LARGE' });
      assert.equal(guard.classifyZipReadError(tooBig)?.kind, 'corrupt');
      assert.equal(guard.classifyZipReadError(new Error('Duplicate POI package entry: a.png'))?.kind, 'duplicate-entry');
    });
    await check('(v) assertArchiveStructure の入力の検査', () => {
      const ok = { name: 'a', size: 1, compressedSize: 1, method: 0 };
      assert.doesNotThrow(() => poiPackage.assertArchiveStructure([ok], 100, 'map package'));
      assert.throws(() => poiPackage.assertArchiveStructure([{ ...ok, compressedSize: -1 }], 100, 'map package'), /^Error: Invalid map package entry size: a$/);
      assert.throws(() => poiPackage.assertArchiveStructure([{ ...ok, method: Number.NaN }], 100, 'map package'), /^Error: Invalid map package entry size: a$/);
      for (const bytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
        assert.throws(() => poiPackage.assertArchiveStructure([ok], bytes, 'map package'), /Invalid map package archive size/);
      }
    });
    await check('(v) 呼び忘れの見張り', () => {
      const dir = nodePath.join(projectRoot, 'electron/services');
      const count = (needle) => {
        const hits = {};
        for (const name of nodeFs.readdirSync(dir)) {
          if (!name.endsWith('.ts')) continue;
          const n = nodeFs.readFileSync(nodePath.join(dir, name), 'utf8').split(needle).length - 1;
          if (n > 0) hits[name] = n;
        }
        return hits;
      };
      const structure = count('assertArchiveStructure(');
      const adm = count('new AdmZip(');
      assert.deepEqual(structure, { 'DataUploadService.ts': 1, 'PoiPackageService.ts': 2 });
      assert.deepEqual(adm, { 'DataUploadService.ts': 2, 'PoiPackageService.ts': 2 });
      return 'assertArchiveStructure( ' + JSON.stringify(structure) + ' / new AdmZip( ' + JSON.stringify(adm) + '（DataUploadService の 1 件は名前の列挙だけ）';
    });

    // ---- (vi) STORED の偽りと中央ディレクトリの重なり ----
    const payload = Buffer.alloc(MiB, 0x41);
    const N = 20;
    const crafted = [
      ['STORED・宣言 0・1 件', { payload, n: 1, declared: 0 }],
      ['STORED・宣言 0・重なり 20 件', { payload, n: N, declared: 0 }],
      ['STORED・宣言 1・重なり 20 件', { payload, n: N, declared: 1 }],
      ['STORED・宣言が正直・重なり 20 件', { payload, n: N, declared: MiB }],
      ['DEFLATED・宣言が正直・重なり 20 件', { payload: Buffer.alloc(MiB), n: N, declared: MiB, method: 8 }],
    ];
    for (const [label, spec] of crafted) {
      const buf = craftedZip(spec);
      const file = writeFixture('crafted.zip', buf);
      const declaredTotal = spec.n * spec.declared;
      await check('(vi) 地図 ' + label, async () => {
        const result = await dataUploadService.extractZip(file);
        const written = treeBytes(extractDir());
        console.log('  測定 ' + JSON.stringify({ label, zipBytes: buf.length, declaredTotal, written: written.bytes, files: written.files, err: result.err }));
        assert.match(String(result.err), /^Unsafe map package (entry: |archive: entries overlap$)/, JSON.stringify(result).slice(0, 200));
        forbidden('(vi) ' + label, result);
        assert.ok(written.bytes <= declaredTotal, '書かれた量 ' + written.bytes + ' > 宣言 ' + declaredTotal);
      });
      for (const [route, call] of [
        ['importPoiZip', () => poiPackageService.importPoiZip(file)],
        ['importManagedPoiDocuments', () => poiPackageService.importManagedPoiDocuments(file, ['pois/x.geojson'])],
      ]) {
        await check('(vi) POI ' + route + ' ' + label, async () => {
          const before = treeBytes(SettingsService.get('saveFolder')).bytes;
          let message = '';
          try { await call(); } catch (e) { message = String(e?.message ?? e); }
          assert.match(message, /^Unsafe POI package (entry: |archive: entries overlap$)/, '例外: ' + message.slice(0, 200));
          assert.equal(treeBytes(SettingsService.get('saveFolder')).bytes, before, '保存フォルダが増えた');
        });
      }
    }

    // ---- (vii) 大小だけ違う名前 ----
    await check('(vii) 地図: 大小だけ違う名前 → Duplicate・展開先は空', async () => {
      const file = writeFixture('case-map.zip', mapZip('limitscase', { 'tiles/m/a.png': Buffer.from('A'), 'tiles/m/A.png': Buffer.from('B') }));
      const result = await dataUploadService.extractZip(file);
      assert.match(String(result.err), /^Duplicate map package entry/, JSON.stringify(result).slice(0, 200));
      forbidden('(vii)', result);
      assert.equal(treeBytes(extractDir()).files, 0, '展開先にファイルが書かれた');
    });
    await check('(vii) POI: 大小だけ違う名前 → zip-corrupt', async () => {
      const zip = new AdmZip();
      zip.addFile('pois/a.geojson', Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [] })));
      zip.addFile('pois/readme.txt', Buffer.from('a'));
      zip.addFile('pois/README.TXT', Buffer.from('b'));
      const result = await poiSourceService.importFile({ slug: 'limits-case', title: { ja: 'x' }, filePath: writeFixture('case-poi.zip', zip.toBuffer()) });
      assert.deepEqual({ result: result.result, code: result.code }, { result: 'Error', code: 'zip-corrupt' }, JSON.stringify(result));
      forbidden('(vii)', result);
    });

    if (failures.length > 0) {
      console.log('失敗 ' + failures.length + ' 件');
      process.exit(1);
    }
    console.log(${JSON.stringify(MARKER)});
    process.exit(0);
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
        external: ['jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [bundled], {
      cwd: projectRoot, timeout: 300000, maxBuffer: 1024 * 1024 * 16,
    }));
  } catch (e) {
    if (e && e.stdout) process.stdout.write(e.stdout);
    if (e && e.stderr) process.stderr.write(e.stderr.split('\n').slice(0, 20).join('\n'));
    throw new Error('map zip limits smoke failed', { cause: e });
  }
  process.stdout.write(stdout);
  if (!stdout.includes(MARKER)) {
    throw new Error('map zip limits smoke: 成功マーカーが出力されていない');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
}
