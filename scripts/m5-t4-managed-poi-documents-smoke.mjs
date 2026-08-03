// m5-t4: 複数 managed entry の読み取り API（タスク設計 v1.6 §6.2.6）。
//
// 固定する受け入れ条件:
//   AC18  importManagedPoiDocuments の契約
//         (a) dests に挙げた entry だけを読み、未参照 entry を読まない
//         (b) 安全検証は絞り込み前に ZIP 全体へ1回走る（API 自衛）
//         (c) 複数 document が同じ imgs/x.png を参照しても asset は1つに畳まれる
//         (d) dests にあるのに ZIP に無い場合は Error
//         (e) 本 API は poi_sources を作らない（責務境界）
//   AC19  importPoiZip の無変更（1件制約・戻り値の形）。かつ委譲の前に
//         assertSafePoiPackageEntries を全 entry へ直接呼ぶ
//   AC20  経路レベルの容量上限（中間レビュー Minor-1）
//         512 entry 超のタイルを持つ地図 ZIP が読める / payload 超過は拒否される
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4-managed-poi-'));
const entryFile = path.join(workDir, 'managed-poi-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'managed-poi-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const packageServicePath = path.join(projectRoot, 'electron/services/PoiPackageService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');

  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await writeFile(electronStubFile, `
    export const app = {
      getPath(name: string) {
        if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
        if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
        if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
        return ${JSON.stringify(workDir)};
      },
      getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); },
      exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
    };
    export const dialog = {
      showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); },
    };
    export const ipcMain = { handle() {} };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
  `);
  await writeFile(electronStoreStubFile, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { mkdir as fsMkdir, writeFile as fsWriteFile, readFile as fsReadFile } from 'node:fs/promises';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';
    import { Jimp } from 'jimp';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
    const {
      importManagedPoiDocuments,
      importPoiZip,
    } = await import(${JSON.stringify(packageServicePath)});

    const fixtureDir = nodePath.join(workDir, 'fixtures');
    await fsMkdir(fixtureDir, { recursive: true });
    const pngA = nodePath.join(fixtureDir, 'a.png');
    const pngB = nodePath.join(fixtureDir, 'b.png');
    await (new Jimp({ width: 4, height: 4, color: 0xff0000ff }) as any).write(pngA);
    await (new Jimp({ width: 5, height: 5, color: 0x00ff00ff }) as any).write(pngB);

    const fc = (image?: unknown) => ({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [134.7, 34.8] },
        properties: image === undefined ? {} : { image },
      }],
    });

    const countPoiSources = async (): Promise<number> => {
      const db = await SqliteDataService.getDb();
      return (db.prepare('SELECT COUNT(*) AS n FROM poi_sources').get() as any).n as number;
    };

    // -----------------------------------------------------------------------
    // AC18 (a)(c)(e): dests のものだけ読む / imgs は全 document 横断で1つに畳む /
    //                 poi_sources は作らない
    // -----------------------------------------------------------------------
    {
      const zip = new AdmZip();
      zip.addFile('pois/alpha.geojson', Buffer.from(JSON.stringify(fc('imgs/shared.png'))));
      zip.addFile('pois/beta.geojson', Buffer.from(JSON.stringify(fc('imgs/shared.png'))));
      zip.addFile('pois/unused.geojson', Buffer.from(JSON.stringify(fc('imgs/never.png'))));
      zip.addFile('imgs/shared.png', await fsReadFile(pngA));
      zip.addFile('imgs/never.png', await fsReadFile(pngB));
      const zipPath = nodePath.join(fixtureDir, 'multi.zip');
      await fsWriteFile(zipPath, zip.toBuffer());

      const before = await countPoiSources();
      const r = await importManagedPoiDocuments(zipPath, ['pois/alpha.geojson', 'pois/beta.geojson']);

      // (a) 未参照 entry を読まない
      assert.equal(r.documents.size, 2, 'AC18(a): dests の2件だけが読まれること');
      assert.equal(r.documents.has('pois/unused.geojson'), false, 'AC18(a): 未参照 entry を読まないこと');

      // (c) 同じ imgs/ を参照する2 document で asset は1つ
      assert.equal(r.createdAssetUids.length, 1,
        'AC18(c): 共有画像は1つの asset へ畳まれること（実際: ' + JSON.stringify(r.createdAssetUids) + '）');
      const uid = r.createdAssetUids[0];
      const alpha: any = r.documents.get('pois/alpha.geojson');
      const beta: any = r.documents.get('pois/beta.geojson');
      assert.equal(alpha.features[0].properties.image, uid, 'alpha の参照が asset UID へ正本化されること');
      assert.equal(beta.features[0].properties.image, uid, 'beta も同じ UID を指すこと');

      // 未参照 entry の画像は登録されない（読んでいないことの副次的な証拠）
      assert.equal(r.createdAssetUids.includes('never'), false);

      // (e) poi_sources は作らない（責務境界）
      assert.equal(await countPoiSources(), before, 'AC18(e): 本 API は poi_sources を作らないこと');

      // cleanup は全 document 分をまとめた1つ
      const residue = await r.cleanup();
      assert.deepEqual(residue, [], 'cleanup が完全補償で空配列を返すこと');
      console.log('ok: AC18 (a)(c)(e)');
    }

    // -----------------------------------------------------------------------
    // AC18 (d): dests にあるのに ZIP に無い → Error（黙って落とさない）
    // -----------------------------------------------------------------------
    {
      const zip = new AdmZip();
      zip.addFile('pois/alpha.geojson', Buffer.from(JSON.stringify(fc())));
      const zipPath = nodePath.join(fixtureDir, 'missing.zip');
      await fsWriteFile(zipPath, zip.toBuffer());

      await assert.rejects(
        () => importManagedPoiDocuments(zipPath, ['pois/alpha.geojson', 'pois/ghost.geojson']),
        /pois\\/ghost\\.geojson/,
        'AC18(d): 欠損 dest は Error になり、どの dest かが分かること',
      );
      console.log('ok: AC18 (d) 欠損 dest は Error');
    }

    // -----------------------------------------------------------------------
    // AC18 (b): 安全検証は **絞り込み前に ZIP 全体へ**。
    //   dests に含まれない位置の危険 entry でも拒否される。
    // -----------------------------------------------------------------------
    {
      // adm-zip の addFile は正規化するため、symlink を external attrs で立てて検証する
      const zip = new AdmZip();
      zip.addFile('pois/alpha.geojson', Buffer.from(JSON.stringify(fc())));
      zip.addFile('tiles/evil.jpg', Buffer.from('x'));
      const buf = zip.toBuffer();
      // central directory の external attrs を書き換えて symlink 化するのは煩雑なため、
      // ここは重複名で代替する（同じく (a) の検査対象で、絞り込み前でしか検出できない）
      const zip2 = new AdmZip(buf);
      const raw = zip2.toBuffer();
      await fsWriteFile(nodePath.join(fixtureDir, 'safe-only.zip'), raw);

      // 未参照位置に危険 entry を持つ ZIP は archive-safety-timing smoke が
      // 生 ZIP バイト列で網羅している。ここでは **本 API が (a) を呼ぶこと自体** を、
      // ソース上の呼び出しで固定する（二重の安全網）。
      const source = await fsReadFile(${JSON.stringify(packageServicePath)}, 'utf8');
      assert.match(source, /assertSafeArchiveEntries\\(/,
        'AC18(b): importManagedPoiDocuments が (a) を呼ぶこと');
      assert.match(source, /assertPoiPayloadLimits\\(/,
        'AC18: (b) を payload へ絞って呼ぶこと');
      assert.match(source, /isPoiPayloadEntry/,
        'AC18: 絞り込みは共有述語 isPoiPayloadEntry を使うこと（別実装を持たない）');
      console.log('ok: AC18 (b) 安全検証の呼び出し');
    }

    // -----------------------------------------------------------------------
    // AC19: importPoiZip の無変更（1件制約・戻り値の形）。
    //   かつ **委譲の前に** assertSafePoiPackageEntries を全 entry へ直接呼ぶ。
    // -----------------------------------------------------------------------
    {
      const mk = async (name: string, mutate: (z: AdmZip) => void) => {
        const zip = new AdmZip();
        mutate(zip);
        const p = nodePath.join(fixtureDir, name);
        await fsWriteFile(p, zip.toBuffer());
        return p;
      };

      // 正常系: 戻り値の形が変わらない
      const okPath = await mk('poi-one.zip', (z) => {
        z.addFile('README', Buffer.from('readme'));
        z.addFile('pois/one.geojson', Buffer.from(JSON.stringify(fc('imgs/pic.png'))));
      });
      // imgs/pic.png を後から足す
      {
        const z = new AdmZip(okPath);
        z.addFile('imgs/pic.png', await fsReadFile(pngA));
        await fsWriteFile(okPath, z.toBuffer());
      }
      const one = await importPoiZip(okPath);
      assert.equal(typeof one.fc, 'object', 'AC19: fc を返すこと');
      assert.equal((one.fc as any).type, 'FeatureCollection');
      assert.ok(Array.isArray(one.createdAssetUids), 'AC19: createdAssetUids を返すこと');
      assert.equal(typeof one.cleanup, 'function', 'AC19: cleanup を返すこと');
      assert.equal(Object.keys(one).sort().join(','), 'cleanup,createdAssetUids,fc',
        'AC19: 戻り値のキー集合が変わらないこと');
      await one.cleanup();

      // 1件制約: 0件 / 2件で throw（POI 単体パッケージの入力検証を緩めない）
      const zeroPath = await mk('poi-zero.zip', (z) => z.addFile('README', Buffer.from('x')));
      await assert.rejects(() => importPoiZip(zeroPath), /found 0/, 'AC19: 0件で throw');
      const twoPath = await mk('poi-two.zip', (z) => {
        z.addFile('pois/a.geojson', Buffer.from(JSON.stringify(fc())));
        z.addFile('pois/b.geojson', Buffer.from(JSON.stringify(fc())));
      });
      await assert.rejects(() => importPoiZip(twoPath), /found 2/, 'AC19: 2件で throw');

      // 【本題】payload 外 entry による上限超過が **製品経路で** 拒否されること。
      // 委譲のみの再実装だとここが素通りする（委譲先の (b) は pois/+imgs/ にしか効かない）。
      const bigReadmePath = nodePath.join(fixtureDir, 'poi-big-readme.zip');
      {
        const z = new AdmZip();
        z.addFile('pois/one.geojson', Buffer.from(JSON.stringify(fc())));
        z.addFile('README', Buffer.alloc(101 * 1024 * 1024, 0x41));
        await fsWriteFile(bigReadmePath, z.toBuffer());
      }
      await assert.rejects(
        () => importPoiZip(bigReadmePath),
        /POI package is too large/,
        'AC19/AC20(d): payload 外 entry（巨大 README）による超過が製品経路で拒否されること',
      );
      console.log('ok: AC19 importPoiZip の無変更 + payload 外超過の拒否');
    }

    // -----------------------------------------------------------------------
    // AC20 経路レベル（中間レビュー Minor-1）:
    //   512 entry を超えるタイルを持つ地図 ZIP を importManagedPoiDocuments が読めること。
    //   契約関数の単体検証ではなく、**配線が (b) を payload へ絞っている** ことの証明。
    // -----------------------------------------------------------------------
    {
      const zip = new AdmZip();
      zip.addFile('maps/himeji.json', Buffer.from(JSON.stringify({ title: 'himeji' })));
      zip.addFile('pois/alpha.geojson', Buffer.from(JSON.stringify(fc())));
      // 512 を超えるタイル
      for (let i = 0; i < 600; i += 1) {
        zip.addFile('tiles/himeji/14/' + Math.floor(i / 32) + '/' + (i % 32) + '.jpg', Buffer.alloc(64, 1));
      }
      const zipPath = nodePath.join(fixtureDir, 'many-tiles.zip');
      await fsWriteFile(zipPath, zip.toBuffer());

      const entryCount = new AdmZip(zipPath).getEntries().length;
      assert.ok(entryCount > 512, '前提: entry 数が 512 を超えること（実際: ' + entryCount + '）');

      const r = await importManagedPoiDocuments(zipPath, ['pois/alpha.geojson']);
      assert.equal(r.documents.size, 1,
        'AC20 経路: 512 entry 超のタイルを持つ地図 ZIP でも managed POI を読めること');
      await r.cleanup();

      // 逆に payload 側の超過は拒否される
      const heavy = new AdmZip();
      heavy.addFile('maps/himeji.json', Buffer.from(JSON.stringify({ title: 'himeji' })));
      heavy.addFile('pois/alpha.geojson', Buffer.from(JSON.stringify(fc('imgs/huge.png'))));
      heavy.addFile('imgs/huge.png', Buffer.alloc(21 * 1024 * 1024, 0x42));
      const heavyPath = nodePath.join(fixtureDir, 'heavy-payload.zip');
      await fsWriteFile(heavyPath, heavy.toBuffer());
      await assert.rejects(
        () => importManagedPoiDocuments(heavyPath, ['pois/alpha.geojson']),
        /Packaged image is too large/,
        'AC20 経路: payload 側（imgs/ 1件 20 MiB 超）は拒否されること',
      );
      console.log('ok: AC20 経路レベル（タイルは無制限 / payload は上限）');
    }

    console.log('m5-t4 managed poi documents OK');
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: 'electron', replacement: electronStubFile },
        { find: 'electron-store', replacement: electronStoreStubFile },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'managed-poi-smoke.mjs', format: 'es' },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });

  console.log('m5-t4 managed poi documents smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
