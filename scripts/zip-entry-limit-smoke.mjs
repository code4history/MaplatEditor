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
//   (f) 末尾の記録を adm-zip が検査と別の位置から読む ZIP は 'corrupt' で拒む（検査を通ったら件数は adm-zip と同じ）
//   (g) 正当な ZIP（最小の形・ZIP64・大きな地図・OS に付属の書き手で作ったもの）は通り、件数が adm-zip と一致する
//
// 実行方法: node scripts/zip-entry-limit-smoke.mjs（zip-errors-smoke と同じ vite SSR ビルド＋
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
    import { writeFile as fsWriteFile, open as fsOpen, stat as fsStat, mkdir as fsMkdir } from 'node:fs/promises';
    import { execFileSync } from 'node:child_process';
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

    // ---- (f)(g) で使う部品 ----
    const centralHeader = (name, offset) => {
      const nm = Buffer.from(name);
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
      h.writeUInt16LE(nm.length, 28); h.writeUInt32LE(offset, 42);
      return Buffer.concat([h, nm]);
    };
    const localHeader = (name) => {
      const nm = Buffer.from(name);
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(nm.length, 26);
      return Buffer.concat([h, nm]);
    };
    const plainEocd = (entries, cdBytes, cdOffset, comment = Buffer.alloc(0)) => {
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(entries, 8); eocd.writeUInt16LE(entries, 10);
      eocd.writeUInt32LE(cdBytes, 12); eocd.writeUInt32LE(cdOffset, 16);
      eocd.writeUInt16LE(comment.length, 20);
      return Buffer.concat([eocd, comment]);
    };
    // 中央ディレクトリ（ゼロ埋め cdBytes）＋ ZIP64 EOCD（可変部つき）＋ locator ＋ EOCD（コメントつき）
    const zip64File = (entries, cdBytes, extensible = Buffer.alloc(0), comment = Buffer.alloc(0)) => {
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(0x06064b50, 0);
      rec.writeBigUInt64LE(BigInt(44 + extensible.length), 4);
      rec.writeUInt16LE(45, 12); rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(entries), 24);
      rec.writeBigUInt64LE(BigInt(entries), 32);
      rec.writeBigUInt64LE(BigInt(cdBytes), 40);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeBigUInt64LE(BigInt(cdBytes), 8);
      loc.writeUInt32LE(1, 16);
      return Buffer.concat([Buffer.alloc(cdBytes), rec, extensible, loc, plainEocd(0xffff, 0xffffffff, 0xffffffff, comment)]);
    };
    // 検査を通ったら、検査が読んだ件数は adm-zip が読む件数と同じ
    const agreesWithAdmZip = async (label, p) => {
      const info = await guard.assertZipCentralDirectory(p, label);
      const n = new AdmZip(p).getEntries().length;
      assert.equal(info.entries, n, label + ': 検査の件数 ' + info.entries + ' が adm-zip の件数 ' + n + ' と違う');
      return info;
    };
    const isCorrupt = (e) => e instanceof guard.ZipImportError && e.kind === 'corrupt';

    // ---- (f) 末尾の記録を adm-zip が別の位置から読む ZIP は corrupt（SR-DEC26-C1-1） ----
    {
      const N = 300;
      const first = localHeader('maps/a.json');
      const otherCd = Buffer.concat(Array.from({ length: N }, (_, i) => centralHeader('t/' + String(i).padStart(5, '0'), 0)));
      const realCd = centralHeader('maps/a.json', 0);
      const otherRecord = Buffer.alloc(56);
      otherRecord.writeUInt32LE(0x06064b50, 0); otherRecord.writeBigUInt64LE(44n, 4);
      otherRecord.writeBigUInt64LE(BigInt(N), 24); otherRecord.writeBigUInt64LE(BigInt(N), 32);
      otherRecord.writeBigUInt64LE(BigInt(otherCd.length), 40); otherRecord.writeBigUInt64LE(BigInt(first.length), 48);
      const withStraySignature = (signature, distance) => {
        const pad = Buffer.alloc(32);
        pad.writeUInt32LE(signature, pad.length - distance);
        return Buffer.concat([first, otherCd, realCd, otherRecord, pad,
          plainEocd(1, realCd.length, first.length + otherCd.length)]);
      };
      const fixedPart = zip64File(10, 1000);
      fixedPart.writeUInt32LE(0x06064b50, 1000 + 12);
      const extensible = Buffer.alloc(16);
      extensible.writeUInt32LE(0x06064b50, 4);
      const cases = {
        'stray-locator-16': withStraySignature(0x07064b50, 16),
        'stray-locator-4': withStraySignature(0x07064b50, 4),
        'stray-locator-19': withStraySignature(0x07064b50, 19),
        'stray-end-20': withStraySignature(0x06054b50, 20),
        'stray-end-9': withStraySignature(0x06054b50, 9),
        'zip64-fixed-part-signature': fixedPart,
        'zip64-extensible-signature': zip64File(10, 1000, extensible),
        'zip64-record-out-of-scan-range': zip64File(10, 1000, Buffer.alloc(0), Buffer.alloc(65500, 0x20)),
      };
      const passed = [];
      for (const [label, buf] of Object.entries(cases)) {
        const p = await writeFixture('f-' + label + '.zip', buf);
        try {
          const info = await guard.assertZipCentralDirectory(p, 'x');
          let admZip;
          try { admZip = new AdmZip(p).getEntries().length + ' 件'; } catch (e) { admZip = '例外 ' + e.message; }
          passed.push(label + '（検査 ' + info.entries + ' 件・adm-zip ' + admZip + '）');
        } catch (e) {
          assert.ok(isCorrupt(e), '(f) ' + label + ' は corrupt（実際: ' + (e && e.message) + '）');
        }
      }
      assert.deepEqual(passed, [], '(f) 検査を通ってはいけない ZIP が通った');
      const map = await settle('extractZip stray', dataUploadService.extractZip(await writeFixture('f-map.zip', cases['stray-locator-16'])));
      assert.equal(map.err, 'Corrupt', '(f) 地図（実際: ' + JSON.stringify(map).slice(0, 200) + '）');
      const poi = await settle('POI importFile stray', poiSourceService.importFile({ slug: 'zl-f', title: { ja: 'f' }, filePath: await writeFixture('f-poi.zip', cases['stray-end-20']) }));
      assert.deepEqual(poi, { result: 'Error', code: 'zip-corrupt' }, '(f) POI（実際: ' + JSON.stringify(poi) + '）');
      console.log('ok (f): ' + Object.keys(cases).join('・') + ' は corrupt（地図 Corrupt・POI zip-corrupt）');
    }

    // ---- (g) 正当な ZIP は通り、件数は adm-zip と一致する ----
    {
      // 手で組んだ最小の ZIP（extra・コメント・ディレクトリの entry が無い形）
      const name = 'maps/a.json';
      const minimal = Buffer.concat([localHeader(name), centralHeader(name, 0), plainEocd(1, 46 + name.length, 30 + name.length)]);
      await agreesWithAdmZip('minimal', await writeFixture('g-minimal.zip', minimal));

      // ZIP64（可変部とコメントつき）。中央ディレクトリは穴なので adm-zip では開かない
      const z64 = await guard.assertZipCentralDirectory(
        await writeFixture('g-zip64.zip', zip64File(10, 1000, Buffer.alloc(32, 0x41), Buffer.from('comment '.repeat(12)))), 'x');
      assert.deepEqual([z64.entries, z64.zip64], [10, true], '(g) ZIP64');

      // 大きな地図: 正当な地図 ZIP の理論上の最大（約 12,216 件）
      const BIG = 12216;
      const big = new AdmZip();
      big.addFile('maps/big.json', Buffer.from('{}'));
      big.addFile('tmbs/big.jpg', Buffer.from('T'));
      for (let i = 0; big.getEntries().length < BIG; i++) {
        big.addFile('tiles/big/7/' + (i >> 7) + '/' + (i & 127) + '.jpg', Buffer.from('T'));
      }
      const bigInfo = await agreesWithAdmZip('big map', await writeFixture('g-big.zip', big.toBuffer()));
      assert.equal(bigInfo.entries, BIG, '(g) 大きな地図の件数');
      // 同じ件数で 2 GiB ちょうどの大きさ（スパース。末尾に本物の中央ディレクトリと EOCD）
      const bigCd = Buffer.concat(Array.from({ length: BIG }, (_, i) => centralHeader('tiles/big/7/' + (i >> 7) + '/' + (i & 127) + '.jpg', 0)));
      const bigCdOffset = guard.ZIP_IMPORT_MAX_BYTES - bigCd.length - 22;
      const huge = await sparseWithTail('g-huge.zip', bigCdOffset, Buffer.concat([bigCd, plainEocd(BIG, bigCd.length, bigCdOffset)]));
      assert.equal(await guard.assertZipImportable(huge, 'x'), guard.ZIP_IMPORT_MAX_BYTES, '(g) 2 GiB ちょうどの地図');
      assert.equal((await guard.readZipCentralDirectoryInfo(huge, 'x')).entries, BIG);

      // OS に付属の書き手で作った ZIP（macOS: zip・ditto（Finder の圧縮と同じ）・bsdtar。
      // Windows: Compress-Archive・tar.exe（bsdtar と同じ libarchive）。その他: zip があれば）
      const src = nodePath.join(fixtureDir, 'g-src');
      for (const [rel, body] of [['maps/sample.json', '{"mapID":"sample"}'], ['tmbs/sample.jpg', 'THUMB'],
        ['tiles/sample/0/0/0.jpg', 'TILE'], ['tiles/sample/1/0/1.jpg', 'TILE'.repeat(5000)], ['pois/日本語の名前.geojson', '{}']]) {
        await fsMkdir(nodePath.dirname(nodePath.join(src, rel)), { recursive: true });
        await fsWriteFile(nodePath.join(src, rel), body);
      }
      const out = (n) => nodePath.join(fixtureDir, 'g-' + n + '.zip');
      const writers = process.platform === 'darwin' ? [
        ['zip', '/usr/bin/zip', ['-r', '-q', out('zip'), '.'], src],
        ['ditto', '/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', src, out('ditto')], fixtureDir],
        ['bsdtar', '/usr/bin/bsdtar', ['-a', '-cf', out('bsdtar'), '-C', src, '.'], fixtureDir],
      ] : process.platform === 'win32' ? [
        ['compress-archive', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          'Compress-Archive -Path ' + JSON.stringify(nodePath.join(src, '*')) + ' -DestinationPath ' + JSON.stringify(out('compress-archive'))], fixtureDir],
        ['tar', 'tar.exe', ['-a', '-cf', out('tar'), '-C', src, '.'], fixtureDir],
      ] : [
        ['zip', 'zip', ['-r', '-q', out('zip'), '.'], src],
      ];
      const ran = [];
      for (const [label, command, args, cwd] of writers) {
        try {
          execFileSync(command, args, { cwd, stdio: 'ignore' });
        } catch (e) {
          if (e && e.code === 'ENOENT') { console.log('skip (g): ' + label + ' が無い'); continue; }
          throw e;
        }
        const info = await agreesWithAdmZip(label, out(label));
        assert.equal(info.zip64, false, '(g) ' + label + ' は ZIP64 ではない');
        assert.ok(info.entries >= 5, '(g) ' + label + ' の件数 ' + info.entries);
        ran.push(label + ' ' + info.entries + ' 件');
      }
      if (process.platform === 'darwin') assert.equal(ran.length, 3, '(g) macOS の 3 つの書き手がすべて動く');
      console.log('ok (g): 最小の ZIP・ZIP64・大きな地図（' + BIG + ' 件・2 GiB ちょうど）・OS の書き手（' + (ran.join('・') || 'なし') + '）は通り、件数は adm-zip と一致');
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
