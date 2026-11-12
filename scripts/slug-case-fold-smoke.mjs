// スモーク: slug から作る書き出し名の大小の扱い。
//
// 背景: slug から作る書き出し名（pois/<name>.geojson・imgs/<slug>.<ext>）が大小を保ったまま
// ZIP に並ぶと、大小を畳んで重複を検査する取り込み側（poiPackage.assertSafeArchiveEntries の
// entryNameKey）で「Duplicate POI package entry」として拒否される。大小だけ違う slug の画像
// （例: Foo と foo）を持つ POI パッケージは、書き出した ZIP が戻せない。
//
// 固定すること:
//   (1) 予約名 (reservePoiFileBase): 大小だけ違う基底名は、作る名前を小文字に揃えて
//       比べる（畳んだ）結果、連番で分かれる。重複検査にかからない
//   (2) 外部化された pois/<name>.geojson の名前も同じ規則
//   (3) POI パッケージの画像 (imgs/<slug>.<ext>): 大小だけ違う slug の2画像を書き出しても
//       取り込みに戻せる。2画像は別名で同梱され、内容も両方残る
//
// 名前はすべて小文字。ZIP の entry 名の重複検査（entryNameKey、大小・Unicode 正規化を畳む）
// 自体は変えず、書き出す側が大小を畳んだ名前を作らないことで衝突を起こさない。
//
// 実行方法: node scripts/slug-case-fold-smoke.mjs
// 失敗しても途中で止めず、全部の結果を出してから exit 1 にする。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'slug-case-fold-'));
const outDir = path.join(workDir, 'dist');
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const bundled = path.join(outDir, 'entry.mjs');
const MARKER = 'slug case fold smoke passed';

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
    import AdmZip from 'adm-zip';

    const projectRoot = ${JSON.stringify(projectRoot)};
    const workDir = ${JSON.stringify(workDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    await SqliteDataService.getDb();
    const { default: imageAssetService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/ImageAssetService.ts'))});
    const poiPackageService = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiPackageService.ts'))});
    const { createPoiExternalizationContext, externalizePoisArray } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/poiReferenceResolver.ts'))});
    const { reservePoiFileBase } = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/poiExportFileName.ts'))});
    const poiPackage = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/poiPackage.ts'))});
    const { Jimp } = await import('jimp');

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

    const infos = (names) => names.map((name) => ({ name, size: 1 }));
    // 重複検査（大小・Unicode 正規化を畳む）にかからないこと。かかれば 'Duplicate … entry'
    const assertNamesPass = (names, label) => {
      poiPackage.assertSafeArchiveEntries(infos(names), 'POI package');
      for (const name of names) assert.equal(name, name.toLowerCase(), label + ' の名前が小文字でない: ' + name);
      assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length,
        label + ' の名前が大小を畳むと重なる: ' + JSON.stringify(names));
    };

    // ---- (1) 予約名 (reservePoiFileBase) ----
    await check('(1) 予約名: 大小だけ違う基底名 Foo / foo', () => {
      const taken = new Set();
      const names = ['Foo', 'foo'].map((base) => 'pois/' + reservePoiFileBase(base, taken) + '.geojson');
      assertNamesPass(names, '(1)');
      return JSON.stringify(names);
    });
    await check('(1) 予約名: 今までどおりの連番 x / x-2 / x-3 と枯渇', () => {
      const taken = new Set();
      assert.equal(reservePoiFileBase('x', taken), 'x');
      assert.equal(reservePoiFileBase('x', taken), 'x-2');
      assert.equal(reservePoiFileBase('x', taken), 'x-3');
      const full = new Set();
      for (let n = 1; n <= 100; n++) assert.ok(reservePoiFileBase('z', full) !== null);
      assert.equal(reservePoiFileBase('z', full), null);
    });

    // ---- (2) 外部化された pois/<name>.geojson ----
    await check('(2) 外部化: 大小だけ違う FC id の POI ファイル名', async () => {
      const ctx = createPoiExternalizationContext();
      const raw = (id) => ({ type: 'FeatureCollection', id, features: [] });
      const out = await externalizePoisArray([raw('Foo'), raw('foo')], ctx);
      const names = out.documents.map((doc) => doc.dest);
      assert.equal(names.length, 2);
      assertNamesPass(names, '(2)');
      return JSON.stringify(names);
    });

    // ---- (3) POI パッケージの画像 (大小だけ違う slug の2画像) ----
    await check('(3) 書き出した ZIP が取り込みに戻る・2画像とも残る', async () => {
      const pngPath = async (name, hex) => {
        const p = nodePath.join(workDir, name);
        await new Jimp({ width: 2, height: 2, color: hex }).write(p);
        return p;
      };
      const red = await pngPath('src-red.png', 0xff0000ff);
      const blue = await pngPath('src-blue.png', 0x0000ffff);
      const r1 = await imageAssetService.add({ slug: 'Foo', title: { ja: 'Foo' }, lang: 'ja', sourcePath: red });
      const r2 = await imageAssetService.add({ slug: 'foo', title: { ja: 'foo' }, lang: 'ja', sourcePath: blue });
      assert.equal(r1.result, 'Success', JSON.stringify(r1));
      assert.equal(r2.result, 'Success', JSON.stringify(r2));

      const fc = {
        type: 'FeatureCollection',
        id: 'casefold',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.6] },
            properties: { icon: r1.uid } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [139.8, 35.7] },
            properties: { icon: r2.uid } },
        ],
      };
      const inspection = await poiPackageService.inspectPoiExport(fc);
      assert.equal(inspection.kind, 'zip', JSON.stringify(inspection.files));
      const file = nodePath.join(workDir, 'casefold-poi.zip');
      await poiPackageService.writePoiExport(inspection, file);

      const zip = new AdmZip(file);
      const entryNames = zip.getEntries().map((e) => e.entryName);
      const imgs = entryNames.filter((n) => n.startsWith('imgs/'));
      assert.equal(imgs.length, 2, JSON.stringify(entryNames));
      assertNamesPass(imgs, '(3)');
      poiPackage.assertSafePoiPackageEntries(poiPackageService.zipEntryInfos(zip));

      // 取り込みに戻せる（以前は 'Duplicate POI package entry: imgs/…' で失敗した）
      const imported = await poiPackageService.importPoiZip(file);
      assert.equal(imported.fc.features.length, 2);
      for (const feature of imported.fc.features) {
        assert.match(String(feature.properties.icon), /^[0-9a-f-]{36}$/, JSON.stringify(feature.properties));
      }

      // 2画像の内容が両方とも残っていること（片方に畳まれていないこと）
      const imgEntries = zip.getEntries().filter((e) => e.entryName.startsWith('imgs/'));
      assert.equal(new Set(imgEntries.map((e) => e.header.crc >>> 0)).size, 2, '2画像の内容が同じに畳まれている');
      return imgs.join(', ');
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
    throw new Error('slug case fold smoke failed', { cause: e });
  }
  process.stdout.write(stdout);
  if (!stdout.includes(MARKER)) {
    throw new Error('slug case fold smoke: 成功マーカーが出力されていない');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
