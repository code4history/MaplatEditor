/* global console, process, URL */
// ZIP の取り込みで、new AdmZip の前に ZIP の末尾（EOCD・ZIP64 EOCD）から件数と中央ディレクトリの
// 大きさを読み、上限を超えたものを拒むことのスモーク。
//
// 背景: adm-zip は末尾の記録の件数を信じて entry の物を作る。件数を細工した ZIP（数十 MB で 100 万件）を
// 渡すと new AdmZip の中でメモリが尽き、main が異常終了していた。
//
// 固定する受け入れ条件:
//   (a) 件数 100 万の ZIP64 を細工したファイル（スパースファイルに末尾の記録だけ書く）を、
//       POI の取り込み（importFile）は { result: 'Error', code: 'zip-too-many-entries' }、
//       地図の取り込み（extractZip）は { err: 'TooManyEntries' }、
//       地図に同梱の POI の読み取り（importManagedPoiDocuments）は ZipImportError('too-many-entries') で拒む。
//       ZIP64 でない ZIP の中央ディレクトリの大きさの上限も同じ形で拒む
//   (b) 普通の ZIP（POI パッケージ・地図データ）は従来どおり取り込め、末尾から読んだ件数が adm-zip と一致する
//   (c) EOCD が無い・途中で切れた・記録が矛盾したファイルは 'corrupt'（Corrupt／zip-corrupt）で拒む
//   (d) new AdmZip を呼ぶ取り込みの関数（4 か所）が、どれも new AdmZip の前に assertZipImportable を呼ぶ（ソース）
//   (e) 11 言語に新しい 2 キーがある
//
// 実行方法: node scripts/zip-entry-limit-smoke.mjs（nov26-m6-t3 と同じ vite SSR ビルド＋
// electron／electron-store のスタブ方式）。作業場所は .tmp-smoke/ の下に作り、終わりに消す。
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'zip-entry-limit-'));
const fixtureDir = path.join(workDir, 'fixtures');
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');
const MARKER = 'zip entry limit smoke passed';
// (d)(e) の失敗は最後にまとめて投げる（直す前に (a) の赤を子プロセスで確かめられるように）
const staticFailures = [];

try {
  // ---- (e) i18n ----
  const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  const KEYS = [
    ['dataupload', 'error_too_many_entries'],
    ['poisource', 'errors', 'zip_too_many_entries'],
  ];
  const i18nFailures = [];
  for (const lang of LANGS) {
    const json = JSON.parse(await readFile(path.join(projectRoot, 'public/locales', lang, 'translation.json'), 'utf8'));
    for (const keyPath of KEYS) {
      const value = keyPath.reduce((o, k) => (o == null ? undefined : o[k]), json);
      if (typeof value !== 'string' || value.trim() === '') i18nFailures.push(`${lang}: ${keyPath.join('.')} が無い`);
    }
  }
  if (i18nFailures.length > 0) staticFailures.push('(e) i18n:\n' + i18nFailures.join('\n'));
  else console.log('ok (e): 11 言語に 2 キーがある');

  // ---- (d) ソース: new AdmZip の前に assertZipImportable ----
  {
    const targets = [
      ['electron/services/DataUploadService.ts', 'restoreManagedPois'],
      ['electron/services/DataUploadService.ts', 'extractZip'],
      ['electron/services/PoiPackageService.ts', 'importManagedPoiDocuments'],
      ['electron/services/PoiPackageService.ts', 'importPoiZip'],
    ];
    let total = 0;
    for (const file of new Set(targets.map(([f]) => f))) {
      const src = await readFile(path.join(projectRoot, file), 'utf8');
      total += src.split('new AdmZip(').length - 1;
    }
    if (total !== targets.length) {
      staticFailures.push(`(d) new AdmZip の呼び口が ${total} か所（想定 ${targets.length}）。増えたら本スモークに足す`);
    }
    const before = staticFailures.length;
    for (const [file, fn] of targets) {
      const src = await readFile(path.join(projectRoot, file), 'utf8');
      const start = src.search(new RegExp(`(?:async |function )${fn}\\(`));
      if (start < 0) { staticFailures.push(`(d) ${file} に ${fn} が無い`); continue; }
      const zipAt = src.indexOf('new AdmZip(', start);
      const guardAt = src.indexOf('assertZipImportable(', start);
      if (guardAt < 0 || guardAt > zipAt) {
        staticFailures.push(`(d) ${file} の ${fn} が new AdmZip の前に assertZipImportable を呼ばない`);
      }
    }
    if (staticFailures.length === before) console.log('ok (d): new AdmZip の 4 か所すべてが先に assertZipImportable を呼ぶ');
  }

  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });

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
    import { writeFile as fsWriteFile, open as fsOpen, stat as fsStat } from 'node:fs/promises';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const fixtureDir = ${JSON.stringify(fixtureDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { default: poiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
    const { importManagedPoiDocuments } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiPackageService.ts'))});
    const guard = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/zipImportGuard.ts'))});
    await SqliteDataService.getDb();

    const settle = (label, promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' が 60 秒以内に settle しない')), 60000)),
    ]);
    const writeFixture = async (name, buf) => {
      const p = nodePath.join(fixtureDir, name);
      await fsWriteFile(p, buf);
      return p;
    };

    // ---- 細工した ZIP: スパースファイルの末尾に記録だけを書く（中身は作らない） ----
    // ZIP64 EOCD（56）＋ locator（20）＋ EOCD（22）。中央ディレクトリは 0 から cdBytes まで（ゼロ埋めの穴）
    const zip64Tail = (entries, cdBytes) => {
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(0x06064b50, 0);
      rec.writeBigUInt64LE(44n, 4);
      rec.writeUInt16LE(45, 12); rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(entries), 24);
      rec.writeBigUInt64LE(BigInt(entries), 32);
      rec.writeBigUInt64LE(BigInt(cdBytes), 40);
      rec.writeBigUInt64LE(0n, 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeBigUInt64LE(BigInt(cdBytes), 8);
      loc.writeUInt32LE(1, 16);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10);
      eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16);
      return Buffer.concat([rec, loc, eocd]);
    };
    const plainTail = (entries, cdBytes) => {
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(entries, 8); eocd.writeUInt16LE(entries, 10);
      eocd.writeUInt32LE(cdBytes, 12); eocd.writeUInt32LE(0, 16);
      return eocd;
    };
    const sparseWithTail = async (name, holeBytes, tail) => {
      const p = nodePath.join(fixtureDir, name);
      const fh = await fsOpen(p, 'w');
      await fh.truncate(holeBytes);
      await fh.write(tail, 0, tail.length, holeBytes);
      await fh.close();
      return p;
    };
    // 100 万件 × 54 バイト ≒ 54 MB の中央ディレクトリを宣言する ZIP64（実ディスクはほぼ使わない）
    const bomb = async (name) => sparseWithTail(name, 54_000_000, zip64Tail(1_000_000, 54_000_000));
    // ZIP64 でない ZIP で、中央ディレクトリ 40 MiB を宣言する
    const bigDir = async (name) => sparseWithTail(name, 40 * 1024 * 1024, plainTail(1000, 40 * 1024 * 1024));

    // ---- 普通の ZIP（既存のスモークと同じ形の fixture） ----
    const fc = (name) => ({
      type: 'FeatureCollection', lang: 'en',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [135, 35] }, properties: { name } }],
    });
    const poiZipBuffer = () => {
      const zip = new AdmZip();
      zip.addFile('pois/sample.geojson', Buffer.from(JSON.stringify(fc('Sample'))));
      zip.addFile('pois/readme.txt', Buffer.from('readme'));
      return zip.toBuffer();
    };
    const mapZipBuffer = (slug) => {
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: 'zip-limit ' + slug, attr: 'test', lang: 'ja',
        width: 400, height: 300, gcps: [], edges: [],
      })));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB:' + slug));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE:' + slug));
      zip.addFile('tiles/' + slug + '/0/0/1.jpg', Buffer.from('TILE:' + slug));
      return zip.toBuffer();
    };

    // ---- (a) 件数・中央ディレクトリの上限 ----
    {
      const poiBomb = await bomb('poi-bomb.zip');
      const st = await fsStat(poiBomb);
      console.log('fixture: poi-bomb.zip の見かけ ' + st.size + ' バイト・実ディスク ' + st.blocks * 512 + ' バイト');
      const poi = await settle('POI importFile bomb', poiSourceService.importFile({ slug: 'zl-bomb', title: { ja: 'bomb' }, filePath: poiBomb }));
      assert.deepEqual(poi, { result: 'Error', code: 'zip-too-many-entries' }, '(a) POI: zip-too-many-entries（実際: ' + JSON.stringify(poi) + '）');
      const lang = await settle('detectImportLanguage bomb', poiSourceService.detectImportLanguage(poiBomb, 'de'));
      assert.equal(lang, 'de', '(a) detectImportLanguage は投げずに既定の言語');
      console.log('ok (a) POI importFile（ZIP64 100 万件）: ' + JSON.stringify(poi));

      const map = await settle('extractZip bomb', dataUploadService.extractZip(await bomb('map-bomb.zip')));
      assert.equal(map.err, 'TooManyEntries', '(a) 地図: TooManyEntries（実際: ' + JSON.stringify(map).slice(0, 200) + '）');
      console.log('ok (a) 地図 extractZip（ZIP64 100 万件）: ' + JSON.stringify(map));

      await assert.rejects(importManagedPoiDocuments(await bomb('managed-bomb.zip'), ['pois/a.geojson']),
        (e) => e instanceof guard.ZipImportError && e.kind === 'too-many-entries', '(a) importManagedPoiDocuments');
      console.log('ok (a) importManagedPoiDocuments（ZIP64 100 万件）: too-many-entries');

      const poiDir = await settle('POI importFile bigDir', poiSourceService.importFile({ slug: 'zl-dir', title: { ja: 'dir' }, filePath: await bigDir('poi-bigdir.zip') }));
      assert.deepEqual(poiDir, { result: 'Error', code: 'zip-too-many-entries' }, '(a) POI 中央ディレクトリ 40 MiB（実際: ' + JSON.stringify(poiDir) + '）');
      const mapDir = await settle('extractZip bigDir', dataUploadService.extractZip(await bigDir('map-bigdir.zip')));
      assert.equal(mapDir.err, 'TooManyEntries', '(a) 地図 中央ディレクトリ 40 MiB（実際: ' + JSON.stringify(mapDir).slice(0, 200) + '）');
      console.log('ok (a) 中央ディレクトリ 40 MiB（ZIP64 でない）: POI ' + JSON.stringify(poiDir) + ' / 地図 ' + JSON.stringify(mapDir));

      // 上限ちょうどは通り、1 つ超えると拒む（境界）
      const L = guard.ZIP_CENTRAL_DIRECTORY_LIMITS;
      const atLimit = await sparseWithTail('at-limit.zip', L.maxEntries * 46, zip64Tail(L.maxEntries, L.maxEntries * 46));
      assert.equal((await guard.assertZipCentralDirectory(atLimit, 'x')).entries, L.maxEntries, '(a) 件数の上限ちょうどは通る');
      const overLimit = await sparseWithTail('over-limit.zip', (L.maxEntries + 1) * 46, zip64Tail(L.maxEntries + 1, (L.maxEntries + 1) * 46));
      await assert.rejects(guard.assertZipCentralDirectory(overLimit, 'x'), (e) => e.kind === 'too-many-entries', '(a) 上限 + 1 は拒む');
      console.log('ok (a) 境界: 件数 ' + L.maxEntries + ' は通り ' + (L.maxEntries + 1) + ' は拒む');
    }

    // ---- (b) 普通の ZIP ----
    {
      const poiOk = await writeFixture('poi-ok.zip', poiZipBuffer());
      const info = await guard.readZipCentralDirectoryInfo(poiOk, 'POI package');
      assert.equal(info.entries, new AdmZip(poiOk).getEntries().length, '(b) 件数が adm-zip と一致');
      assert.equal(info.zip64, false);
      const ok = await settle('POI importFile ok', poiSourceService.importFile({ slug: 'zl-ok', title: { ja: 'ok' }, filePath: poiOk }));
      assert.equal(ok.result, 'Success', '(b) 普通の POI ZIP は取り込める（実際: ' + JSON.stringify(ok) + '）');
      const mapOk = await writeFixture('map-ok.zip', mapZipBuffer('zlok'));
      const mapInfo = await guard.readZipCentralDirectoryInfo(mapOk, 'Map package');
      assert.equal(mapInfo.entries, new AdmZip(mapOk).getEntries().length, '(b) 地図の件数が adm-zip と一致');
      const normal = await settle('extractZip ok', dataUploadService.extractZip(mapOk));
      assert.ok(normal.mapData, '(b) 普通の地図 ZIP は取り込める（実際: ' + JSON.stringify(normal).slice(0, 200) + '）');
      // コメント付きの ZIP（EOCD が末尾から離れる）も読める
      const commented = new AdmZip(poiZipBuffer());
      commented.addZipComment('x'.repeat(60000));
      const commentedPath = await writeFixture('poi-comment.zip', commented.toBuffer());
      assert.equal((await guard.readZipCentralDirectoryInfo(commentedPath, 'x')).entries, 2, '(b) コメント 60,000 バイトの ZIP');
      console.log('ok (b): 普通の POI・地図 ZIP は通り、件数は adm-zip と一致（POI ' + info.entries + ' 件・地図 ' + mapInfo.entries + ' 件）');
    }

    // ---- (c) EOCD が無い・壊れた ----
    {
      const good = poiZipBuffer();
      const eocdAt = good.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      const contradict = Buffer.from(good); contradict.writeUInt16LE(500, eocdAt + 8); contradict.writeUInt16LE(500, eocdAt + 10);
      const overrun = Buffer.from(good); overrun.writeUInt32LE(0x7fffffff, eocdAt + 16);
      const badComment = Buffer.from(good); badComment.writeUInt16LE(1000, eocdAt + 20);
      const badLocator = Buffer.concat([Buffer.alloc(100), zip64Tail(10, 1000)]);
      badLocator.writeBigUInt64LE(5000n, 100 + 56 + 8); // locator が範囲外を指す
      const noSig = Buffer.concat([Buffer.alloc(100), zip64Tail(10, 1000)]);
      noSig.writeUInt32LE(0, 100); // ZIP64 EOCD の署名を消す
      const cases = {
        'no-end': Buffer.from('this is not a zip file at all '.repeat(40)),
        'empty': Buffer.alloc(0),
        'truncated': good.subarray(0, good.length - 10),
        'count-vs-size': contradict,
        'dir-overrun': overrun,
        'comment-overrun': badComment,
        'zip64-locator-out-of-range': badLocator,
        'zip64-no-signature': noSig,
      };
      for (const [label, buf] of Object.entries(cases)) {
        const p = await writeFixture('c-' + label + '.zip', buf);
        await assert.rejects(guard.assertZipCentralDirectory(p, 'x'), (e) => e instanceof guard.ZipImportError && e.kind === 'corrupt',
          '(c) ' + label + ' は corrupt');
      }
      const poi = await poiSourceService.importFile({ slug: 'zl-c', title: { ja: 'c' }, filePath: await writeFixture('c-poi.zip', contradict) });
      assert.deepEqual(poi, { result: 'Error', code: 'zip-corrupt' }, '(c) POI（実際: ' + JSON.stringify(poi) + '）');
      const map = await dataUploadService.extractZip(await writeFixture('c-map.zip', cases['no-end']));
      assert.equal(map.err, 'Corrupt', '(c) 地図（実際: ' + JSON.stringify(map).slice(0, 200) + '）');
      console.log('ok (c): ' + Object.keys(cases).join('・') + ' は corrupt（POI zip-corrupt・地図 Corrupt）');
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
    ({ stdout } = await execFileAsync(process.execPath, ['--max-old-space-size=2048', bundled], {
      cwd: projectRoot, timeout: 300000, maxBuffer: 1024 * 1024 * 16,
    }));
  } catch (e) {
    if (e && e.stdout) process.stdout.write(e.stdout);
    if (e && e.stderr) process.stderr.write(String(e.stderr).slice(-4000));
    throw e;
  }
  process.stdout.write(stdout);
  if (!stdout.includes(MARKER)) {
    throw new Error('zip entry limit smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
  }
  if (staticFailures.length > 0) throw new Error(staticFailures.join('\n'));
  console.log(MARKER);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
