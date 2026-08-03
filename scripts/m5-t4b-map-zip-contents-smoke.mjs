// m5-t4b: 地図 ZIP の同梱物（タスク設計 v1.1 §5 契約表・AC2/AC3/AC4）。
//
// 固定する受け入れ条件:
//   AC2  pois/*.geojson が **ZIP に実体として同梱される**（compose が dest を書くだけでは足りない）
//   AC3  通常・512px の両サムネイルを含み、UID ではなく slug を使う
//   AC4  maps/<slug>.json が minify である（**アプリ ZIP の地図 JSON も同じく minify**。
//        v1.2 訂正: 整形はパッケージ単位ではなく内容種別単位。アプリ ZIP 側の固定は
//        m4-t2-export-pois-externalization smoke が担う）
//
// compose 層の契約（外部参照へ変換されること）は map-export-poi-parity smoke が担う。
// 本 smoke は **buildAndWriteMapZip が実際に書き出す ZIP の中身** を対象にする。
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
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4b-map-zip-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showSaveDialog() { return Promise.resolve({ canceled: true }); } };
    export const ipcMain = { handle() {} };
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
    import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { buildAndWriteMapZip } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'))});

    const uid = '11111111-1111-4111-8111-111111111111';
    const slug = 'himeji';

    // 内部ファイルは uid キーで置かれる（ADR-0007）。ZIP 内は slug 名になる
    await fsMkdir(nodePath.join(dataDir, 'tmbs'), { recursive: true });
    await fsWriteFile(nodePath.join(dataDir, 'tmbs', uid + '.jpg'), 'THUMB');
    await fsWriteFile(nodePath.join(dataDir, 'tmbs', uid + '_512.jpg'), 'THUMB512');
    await fsMkdir(nodePath.join(dataDir, 'tiles', uid, '0', '0'), { recursive: true });
    await fsWriteFile(nodePath.join(dataDir, 'tiles', uid, '0', '0', '0.jpg'), 'TILE');

    const mapObject = {
      mapID: slug, title: '姫路城', attr: 'test', lang: 'ja', gcps: [], edges: [],
      pois: [{
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [134.69, 34.84] },
          properties: { name: '天守' },
        }],
      }],
    };

    const win = { webContents: { send() {} }, isDestroyed() { return false; } } as any;
    const outZip = nodePath.join(workDir, 'out.zip');
    await buildAndWriteMapZip(win, mapObject, [], slug, uid, outZip);

    const names = new AdmZip(outZip).getEntries().map((e: any) => e.entryName).sort();
    const has = (re: RegExp) => names.some((n: string) => re.test(n));

    // -----------------------------------------------------------------------
    // AC2: pois/*.geojson が **実体として** 同梱されること
    // -----------------------------------------------------------------------
    assert.ok(
      has(/^pois\\/[^/]+\\.geojson$/),
      'AC2: pois/*.geojson が ZIP に同梱されること（実際の entry: ' + JSON.stringify(names) + '）',
    );

    // map JSON の pois が指す dest と、ZIP 内の実体が一致すること
    const zip = new AdmZip(outZip);
    const mapEntry = zip.getEntry('maps/' + slug + '.json');
    assert.ok(mapEntry, 'AC2: maps/<slug>.json が存在すること');
    const mapText = mapEntry.getData().toString('utf8');
    const mapJson = JSON.parse(mapText);
    assert.ok(Array.isArray(mapJson.pois), 'AC2: pois が配列であること');
    for (const entry of mapJson.pois) {
      if (entry && typeof entry.layer === 'string' && entry.layer.startsWith('pois/')) {
        assert.ok(
          names.includes(entry.layer),
          'AC2: map JSON が指す ' + entry.layer + ' の実体が ZIP に存在すること',
        );
        // 実体が有効な GeoJSON であること
        const doc = JSON.parse(zip.getEntry(entry.layer).getData().toString('utf8'));
        assert.equal(doc.type, 'FeatureCollection', 'AC2: 外部化された実体が FeatureCollection であること');
      }
    }
    // pois/*.geojson の整形は **搬出種別を問わず 2-space pretty**（アプリ ZIP と同じ）。
    // 地図 ZIP 側だけ JSON.stringify（minify）で書いていた時期があり、
    // 「同じ dest の同じ実体が経路で別物になる」状態だった（2026-08-03 人間指摘）
    for (const name of names.filter((n: string) => n.startsWith('pois/'))) {
      const text = zip.getEntry(name).getData().toString('utf8');
      assert.equal(
        text.trim(), JSON.stringify(JSON.parse(text), null, 2),
        '地図 ZIP の ' + name + ' も 2-space pretty のはず（アプリ ZIP と同一契約）: '
          + JSON.stringify(text.slice(0, 120)),
      );
    }
    console.log('ok: AC2 pois/*.geojson が実体として同梱される（2-space pretty）');

    // -----------------------------------------------------------------------
    // AC3: 通常・512px の両サムネイル。UID ではなく slug
    // -----------------------------------------------------------------------
    assert.ok(names.includes('tmbs/' + slug + '.jpg'), 'AC3: 通常サムネイルが slug 名で同梱されること');
    assert.ok(
      names.includes('tmbs/' + slug + '_512.jpg'),
      'AC3: **512px サムネイル**が slug 名で同梱されること（実際の entry: ' + JSON.stringify(names) + '）',
    );
    assert.equal(has(new RegExp('^tmbs/' + uid)), false, 'AC3: UID 名の entry を含まないこと');
    console.log('ok: AC3 通常・512px の両サムネイルが slug 名で入る');

    // -----------------------------------------------------------------------
    // AC4: maps/<slug>.json は minify（地図 JSON は搬出種別を問わず minify）
    // -----------------------------------------------------------------------
    assert.equal(
      mapText.includes('\\n'), false,
      'AC4: 地図 JSON は minify であること（改行を含まない）',
    );
    console.log('ok: AC4 地図 JSON は minify のまま');

    // タイルは従来どおり slug 名で再帰同梱される（非回帰）
    assert.ok(has(new RegExp('^tiles/' + slug + '/')), 'タイルが slug 名で同梱されること（非回帰）');
    console.log('ok: タイルの同梱は非回帰');

    console.log('m5-t4b map zip contents OK');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 120000, maxBuffer: 1024 * 1024 * 8,
  });
  console.log('m5-t4b map zip contents smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
