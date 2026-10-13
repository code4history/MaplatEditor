// nov26-m6-t3 スモーク: ZIP の取り込みの大きさの検査（#98）と、読み取りの例外を利用者向けの
// コードへ写すこと（#116）。タスク設計 docs/superpowers/specs/2026-10-11-nov26-m6-t3-task-design.md
// （outer リポジトリ）§6・§7 AC2・AC4。
//
// 固定する受け入れ条件:
//   (a) POI の importFile に壊れた／大きすぎる ZIP を渡すと { result: 'Error', code: 'zip-too-large' | 'zip-corrupt' }
//       で返り、message を持たない（PoiEdit.vue は invalid-request のとき message をそのまま出すため）
//   (b) detectImportLanguage が投げずに既定の言語を返す
//   (c) 地図の取り込み（extractZip）の戻り値が { err: 'TooLarge' | 'Corrupt' }
//   (d) どの戻り値の文字列にも 'ADM-ZIP'・'{0}'・'inflate'・fixture のパスが含まれない
//   (e) どの呼び出しも 30 秒以内に settle する
//   (f) 11 言語に 4 キーがあり、ja の値に '{0}' が無い
//   (g) T3-MIN-1（設計レビューの申し送り）: MapEdit.vue が TooLarge／Corrupt を専用の i18n キーへ写す
//       （ソーステキスト。後続タスクが分岐を落としたら気づけるようにする）
//   (h) R1: 利用者の操作による失敗（ENOENT）を「壊れた ZIP」と判定しない
//
// 実行方法: node scripts/nov26-m6-t3-zip-errors-smoke.mjs（oct26-m4-t1 と同じ vite SSR ビルド＋
// electron／electron-store のスタブ方式）。2 GiB＋1 バイトの fixture はスパースファイルで、
// os.tmpdir() 配下に作り、終わりに消す（実ディスクはほぼ使わない）。
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
// バンドルは adm-zip を external にするため、node_modules を辿れるプロジェクト配下に置く
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t3-zip-errors-'));
// fixture（スパースファイルを含む）は設計 §10 のとおり os.tmpdir() 配下
const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'nov26-m6-t3-zip-fixtures-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');
const MARKER = 'nov26-m6-t3 zip errors smoke passed';

try {
  // ---- (f) i18n: 11 言語に 4 キー ----
  const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  const KEYS = [
    ['dataupload', 'error_too_large'],
    ['dataupload', 'error_corrupt'],
    ['poisource', 'errors', 'zip_too_large'],
    ['poisource', 'errors', 'zip_corrupt'],
  ];
  const i18nFailures = [];
  for (const lang of LANGS) {
    const json = JSON.parse(await readFile(path.join(projectRoot, 'public/locales', lang, 'translation.json'), 'utf8'));
    for (const keyPath of KEYS) {
      const value = keyPath.reduce((o, k) => (o == null ? undefined : o[k]), json);
      if (typeof value !== 'string' || value.trim() === '') {
        i18nFailures.push(`${lang}: ${keyPath.join('.')} が無い`);
      } else if (/\{\d\}|ADM-ZIP/.test(value)) {
        i18nFailures.push(`${lang}: ${keyPath.join('.')} にテンプレート／原文が残る: ${value}`);
      }
    }
  }
  if (i18nFailures.length > 0) {
    throw new Error('(f) i18n のキーが揃っていない:\n  ' + i18nFailures.join('\n  '));
  }
  console.log('ok (f): 11 言語に 4 キーがあり、{0} や原文を含まない');

  // ---- (g) T3-MIN-1: MapEdit.vue の分岐の写像（ソーステキスト）----
  {
    const mapEdit = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
    const expected = [
      ["arg.err === 'TooLarge'", "modalFinish('dataupload.error_too_large')"],
      ["arg.err === 'Corrupt'", "modalFinish('dataupload.error_corrupt')"],
    ];
    for (const [cond, call] of expected) {
      const ci = mapEdit.indexOf(cond);
      if (ci === -1) throw new Error(`(g) MapEdit.vue に分岐 ${cond} が無い`);
      // 条件の直後（次の else まで）に対応する i18n キーの呼び出しがあること
      const tail = mapEdit.slice(ci, ci + 200);
      const ei = tail.indexOf('} else');
      const body = ei === -1 ? tail : tail.slice(0, ei);
      if (!body.includes(call)) throw new Error(`(g) ${cond} の分岐が ${call} を呼んでいない`);
    }
    console.log('ok (g): MapEdit.vue が TooLarge／Corrupt を専用の i18n キーへ写す');
  }

  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

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
    import { writeFile as fsWriteFile, readFile as fsReadFile, open as fsOpen } from 'node:fs/promises';
    import zlib from 'node:zlib';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const fixtureDir = ${JSON.stringify(fixtureDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { default: poiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
    const guard = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/zipImportGuard.ts'))});
    await SqliteDataService.getDb();

    // (e) settle の上限: どの呼び出しも 30 秒以内に解決すること
    const settle = (label, promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('(e) ' + label + ' が 30 秒以内に settle しない')), 30000)),
    ]);

    // ---- fixture ----
    const fc = (name) => ({
      type: 'FeatureCollection',
      lang: 'en',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [135, 35] },
        properties: { name: name + ' '.repeat(8) + 'payload-'.repeat(64) } }],
    });
    const poiZipBuffer = (opts = {}) => {
      const zip = new AdmZip();
      zip.addFile('pois/sample.geojson', Buffer.from(JSON.stringify(fc('Sample'))));
      zip.addFile('pois/readme.txt', Buffer.from('readme'));
      if (opts.stored) for (const e of zip.getEntries()) e.header.method = 0;
      return zip.toBuffer();
    };
    const mapZipBuffer = (slug, opts = {}) => {
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: 'm6-t3 ' + slug, attr: 'test', lang: 'ja',
        width: 400, height: 300, gcps: [], edges: [],
      })));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB:' + slug));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE-PAYLOAD:'.repeat(32) + slug));
      zip.addFile('tiles/' + slug + '/0/0/1.jpg', Buffer.from('TILE-PAYLOAD:'.repeat(32) + slug));
      if (opts.stored) for (const e of zip.getEntries()) e.header.method = 0;
      return zip.toBuffer();
    };
    const replaceAll = (buf, from, to) => {
      const a = Buffer.from(from), b = Buffer.from(to);
      assert.equal(a.length, b.length);
      let idx = buf.indexOf(a), n = 0;
      while (idx !== -1) { b.copy(buf, idx); n++; idx = buf.indexOf(a, idx + a.length); }
      return n;
    };
    const writeFixture = async (name, buf) => {
      const p = nodePath.join(fixtureDir, name);
      await fsWriteFile(p, buf);
      return p;
    };
    const sparse = async (name) => {
      const p = nodePath.join(fixtureDir, name);
      const fh = await fsOpen(p, 'w');
      await fh.truncate(2 * 1024 * 1024 * 1024 + 1); // 2 GiB + 1 バイトのスパースファイル
      await fh.close();
      return p;
    };

    // CRC 不正: 無圧縮の entry の本体を 1 バイト書き換える（CRC は中央ディレクトリに残る）
    const crcBroken = (buf, needle, repl) => {
      const n = replaceAll(buf, needle, repl);
      assert.ok(n >= 1, 'fixture: CRC を壊す対象の本体が見つからない');
      return buf;
    };
    // deflate の本体を壊す: zlib の例外（code Z_DATA_ERROR 等）を起こす
    const deflateBroken = (buf, entryName) => {
      const zip = new AdmZip(buf);
      const entry = zip.getEntry(entryName);
      const raw = entry.getCompressedData();
      const start = buf.indexOf(raw);
      assert.ok(start > 0, 'fixture: 圧縮本体の位置が見つからない');
      for (let i = 0; i < Math.min(raw.length, 16); i++) buf[start + i] = 0xff;
      return buf;
    };
    // 重複名: 同じ長さの 2 つの名前の片方を、ローカル・中央の両方のヘッダで書き換える
    const duplicated = (buf) => {
      const n = replaceAll(buf, 'pois/readme.txt', 'pois/readme.tx_');
      assert.ok(n >= 2);
      return buf;
    };

    const poiFixtures = {
      'too-large': [await sparse('poi-oversize.zip'), 'zip-too-large'],
      'crc': [await writeFixture('poi-crc.zip', crcBroken(poiZipBuffer({ stored: true }), 'Sample', 'Sampla')), 'zip-corrupt'],
      'zlib': [await writeFixture('poi-zlib.zip', deflateBroken(poiZipBuffer(), 'pois/sample.geojson')), 'zip-corrupt'],
      'truncated': [await writeFixture('poi-truncated.zip', poiZipBuffer().subarray(0, 120)), 'zip-corrupt'],
      'no-end': [await writeFixture('poi-no-end.zip', Buffer.from('this is not a zip file at all '.repeat(40))), 'zip-corrupt'],
    };
    // 重複名は 2 つの名前を同じ長さで揃える必要がある ∴ 専用の zip を組む
    {
      const zip = new AdmZip();
      zip.addFile('pois/sample.geojson', Buffer.from(JSON.stringify(fc('Dup'))));
      zip.addFile('pois/readme.txt', Buffer.from('a'));
      zip.addFile('pois/readme.tx_', Buffer.from('b'));
      const buf = zip.toBuffer();
      // 2 件目の名前を 1 件目と同じにする
      replaceAll(buf, 'pois/readme.tx_', 'pois/readme.txt');
      poiFixtures['duplicate'] = [await writeFixture('poi-dup.zip', buf), 'zip-corrupt'];
    }

    const forbidden = (label, value) => {
      const s = JSON.stringify(value);
      for (const needle of ['ADM-ZIP', '{0}', 'inflate', fixtureDir, workDir]) {
        assert.equal(s.includes(needle), false, '(d) ' + label + ' の戻り値に ' + JSON.stringify(needle) + ' が含まれる: ' + s);
      }
    };

    // ---- (a)(b)(d)(e): POI の取り込み ----
    for (const [label, [filePath, code]] of Object.entries(poiFixtures)) {
      const result = await settle('POI importFile ' + label,
        poiSourceService.importFile({ slug: 'm6t3-' + label, title: { ja: label }, filePath }));
      assert.equal(result.result, 'Error', '(a) ' + label + ': Error で返ること（実際: ' + JSON.stringify(result) + '）');
      assert.equal(result.code, code, '(a) ' + label + ': code が ' + code + '（実際: ' + JSON.stringify(result) + '）');
      assert.equal('message' in result, false, '(a) ' + label + ': message を持たない（実際: ' + JSON.stringify(result) + '）');
      forbidden('POI importFile ' + label, result);

      const lang = await settle('detectImportLanguage ' + label, poiSourceService.detectImportLanguage(filePath, 'de'));
      assert.equal(lang, 'de', '(b) ' + label + ': detectImportLanguage が投げずに既定の言語を返す（実際: ' + lang + '）');
      console.log('ok (a)(b)(d)(e) POI ' + label + ': ' + JSON.stringify(result) + ' / lang=' + lang);
    }

    // 負検査: 正常な POI ZIP は従来どおり取り込める（判定が広すぎないこと）
    {
      const okPath = await writeFixture('poi-ok.zip', poiZipBuffer());
      assert.equal(await poiSourceService.detectImportLanguage(okPath, 'de'), 'en', '負検査: 正常な ZIP の言語は en');
      const ok = await settle('POI importFile ok', poiSourceService.importFile({ slug: 'm6t3-ok', title: { ja: 'ok' }, filePath: okPath }));
      assert.equal(ok.result, 'Success', '負検査: 正常な POI ZIP は取り込める（実際: ' + JSON.stringify(ok) + '）');
      console.log('ok 負検査: 正常な POI ZIP は従来どおり取り込める');
    }

    // ---- (c)(d)(e): 地図の取り込み ----
    {
      const mapFixtures = {
        'too-large': [await sparse('map-oversize.zip'), 'TooLarge'],
        'crc': [await writeFixture('map-crc.zip', crcBroken(mapZipBuffer('m6t3crc', { stored: true }), 'TILE-PAYLOAD:', 'TILE-PAYLOAX:')), 'Corrupt'],
        'zlib': [await writeFixture('map-zlib.zip', deflateBroken(mapZipBuffer('m6t3zlib'), 'tiles/m6t3zlib/0/0/0.jpg')), 'Corrupt'],
        'truncated': [await writeFixture('map-truncated.zip', mapZipBuffer('m6t3trunc').subarray(0, 150)), 'Corrupt'],
        'no-end': [await writeFixture('map-no-end.zip', Buffer.from('not a zip '.repeat(80))), 'Corrupt'],
      };
      for (const [label, [filePath, code]] of Object.entries(mapFixtures)) {
        const result = await settle('extractZip ' + label, dataUploadService.extractZip(filePath));
        assert.equal(result.err, code, '(c) 地図 ' + label + ': err が ' + code + '（実際: ' + JSON.stringify(result) + '）');
        forbidden('extractZip ' + label, result);
        console.log('ok (c)(d)(e) 地図 ' + label + ': ' + JSON.stringify(result));
      }
      const normal = await settle('extractZip ok', dataUploadService.extractZip(await writeFixture('map-ok.zip', mapZipBuffer('m6t3ok'))));
      assert.ok(normal.mapData, '負検査: 正常な地図 ZIP は取り込める（実際: ' + JSON.stringify(normal).slice(0, 200) + '）');
      console.log('ok 負検査: 正常な地図 ZIP は従来どおり取り込める');
    }

    // ---- (h) R1: 利用者の操作による失敗を「壊れた ZIP」と判定しない ----
    {
      const missing = nodePath.join(fixtureDir, 'does-not-exist.zip');
      const poi = await settle('POI importFile ENOENT', poiSourceService.importFile({ slug: 'm6t3-missing', title: { ja: 'x' }, filePath: missing }));
      assert.equal(poi.result, 'Error');
      assert.ok(poi.code !== 'zip-corrupt' && poi.code !== 'zip-too-large', '(h) ENOENT は zip-* にしない（実際: ' + JSON.stringify(poi) + '）');
      const map = await settle('extractZip ENOENT', dataUploadService.extractZip(missing));
      assert.ok(map.err !== 'Corrupt' && map.err !== 'TooLarge', '(h) 地図の ENOENT は Corrupt／TooLarge にしない（実際: ' + JSON.stringify(map) + '）');

      const enoent = Object.assign(new Error("ENOENT: no such file or directory, open 'x.zip'"), { code: 'ENOENT' });
      const eacces = Object.assign(new Error("EACCES: permission denied, open 'x.zip'"), { code: 'EACCES' });
      assert.equal(guard.classifyZipReadError(enoent), null, '(h) ENOENT は null');
      assert.equal(guard.classifyZipReadError(eacces), null, '(h) EACCES は null');
      assert.equal(guard.classifyZipReadError(new Error('ADM-ZIP: File not found: "x.zip"')), null, '(h) adm-zip の File not found は null');
      assert.equal(guard.classifyZipReadError('string'), null, '(h) 文字列は null');
      assert.equal(guard.classifyZipReadError(new Error('ADM-ZIP: CRC32 checksum failed {0}'))?.kind, 'corrupt');
      assert.equal(guard.classifyZipReadError(Object.assign(new Error('invalid stored block lengths'), { code: 'Z_DATA_ERROR' }))?.kind, 'corrupt');
      assert.equal(guard.classifyZipReadError(new Error('Duplicate POI package entry'))?.kind, 'duplicate-entry');
      assert.equal(guard.classifyZipReadError(new guard.ZipImportError('too-large', 'x'))?.kind, 'too-large');
      assert.equal(guard.ZIP_IMPORT_MAX_BYTES, 2 * 1024 * 1024 * 1024);
      console.log('ok (h): ENOENT・EACCES・File not found は壊れた ZIP と判定しない');
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
    if (e && e.stderr) process.stderr.write(e.stderr);
    throw e;
  }
  process.stdout.write(stdout);
  if (!stdout.includes(MARKER)) {
    throw new Error('nov26-m6-t3 zip errors smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
  }
  console.log(MARKER);
} finally {
  await rm(workDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
}
