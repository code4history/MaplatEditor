// m5-t4: 地図 ZIP の安全検証の**実行時点**（タスク設計 v1.6 §6.2.7b）。
//
// 固定する受け入れ条件:
//   AC21(a)    tiles/ 位置の危険 entry（.. / 先頭スラッシュ / symlink / 重複名）が拒否される
//   AC21(a-1)  **展開・ファイル書き込みの前に**拒否される（一時展開先に危険 entry が出現しない）
//   AC21(a-2)  **pois/ を1件も含まない地図 ZIP でも**拒否される（dests が空でも検証が走る）
//   AC21(a-3)  完全ロールバックとして residue を持たない { err } が返る
//
// 【なぜ「範囲」だけでなく「時点」を固定するのか】
// DataUploadService.extractZip は `new AdmZip(zipFile)` の直後に
// `zip.extractAllTo(dataTmpFolder, true)` で **全 entry を無検証のままファイルシステムへ展開**し、
// その **後** で maps/ を読む。∴ map JSON から dests を決めた後にしか呼べない API の内側に
// 検証を置くと、危険 entry の書き込みに構造的に間に合わない。さらに外部 POI 参照を持たない
// 地図では dests が空になり、検証ごと省略され得る。
//
// adm-zip 自身の zip-slip 対策には依存しない。ライブラリ更新で暗黙に安全性が変わることを
// 避けるため、呼び出し側で明示的に検証する。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import { build } from 'vite';

// --- 生 ZIP ビルダ -----------------------------------------------------------
// adm-zip の addFile は **パスを正規化する**（'tiles/../../escape.jpg' → 'escape.jpg'、
// バックスラッシュ → スラッシュ、重複名は上書き）。∴ adm-zip で悪意ある ZIP は組めず、
// それで書いた fixture は「ライブラリが正規化してくれること」しか証明しない。
// 実際の攻撃者は adm-zip を使わないので、ここでは **local file header と central directory を
// 直接組んで**、生の entry 名をそのまま格納する。
function rawZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data ?? '', 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(0, 8);           // method = stored
    lh.writeUInt16LE(0, 10);          // modtime
    lh.writeUInt16LE(0, 12);          // moddate
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);          // extra len
    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x031e, 4);      // version made by: unix
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);          // extra
    ch.writeUInt16LE(0, 32);          // comment
    ch.writeUInt16LE(0, 34);          // disk start
    ch.writeUInt16LE(0, 36);          // internal attrs
    // external attrs: unix mode を上位16bitへ。symlink は 0o120000
    ch.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(locals), cd, eocd]);
}

// 正常な地図 ZIP の骨格。**pois/ を1件も含まない**（AC21(a-2)）
const MAP_SKELETON = [
  { name: 'maps/himeji.json', data: JSON.stringify({ title: 'himeji' }) },
  { name: 'tmbs/himeji.jpg', data: 'thumb' },
  { name: 'tiles/himeji/0/0/0.jpg', data: 'tile' },
];

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4-archive-safety-'));
const entryFile = path.join(workDir, 'archive-safety-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'archive-safety-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const uploadPath = path.join(projectRoot, 'electron/services/DataUploadService.ts');
  const packageServicePath = path.join(projectRoot, 'electron/services/PoiPackageService.ts');

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

  // --- fixture: 生 ZIP で組む（adm-zip の正規化を回避）---------------------
  const fixtureDirOuter = path.join(workDir, 'fixtures');
  await mkdir(fixtureDirOuter, { recursive: true });
  const CASES = [
    { label: '.. セグメント（tiles 位置）', file: 'evil-dotdot.zip',
      entries: [...MAP_SKELETON, { name: 'tiles/../../escape.jpg', data: 'x' }],
      expect: 'Unsafe map package entry' },
    { label: '先頭スラッシュ（絶対パス）', file: 'evil-absolute.zip',
      entries: [...MAP_SKELETON, { name: '/etc/evil.jpg', data: 'x' }],
      expect: 'Unsafe map package entry' },
    { label: 'バックスラッシュ混入', file: 'evil-backslash.zip',
      entries: [...MAP_SKELETON, { name: 'tiles\\evil\\0.jpg', data: 'x' }],
      expect: 'Unsafe map package entry' },
    { label: 'symlink', file: 'evil-symlink.zip',
      entries: [...MAP_SKELETON, { name: 'tiles/himeji/link.jpg', data: '/etc/passwd', mode: 0o120777 }],
      expect: 'Unsafe map package entry' },
    { label: '重複名', file: 'evil-duplicate.zip',
      entries: [...MAP_SKELETON,
        { name: 'tiles/himeji/0/0/1.jpg', data: 'a' },
        { name: 'tiles/himeji/0/0/1.jpg', data: 'b' }],
      expect: 'Duplicate map package entry' },
  ];
  for (const c of CASES) {
    await writeFile(path.join(fixtureDirOuter, c.file), rawZip(c.entries));
  }
  await writeFile(path.join(fixtureDirOuter, 'safe.zip'), rawZip(MAP_SKELETON));

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { mkdir as fsMkdir, writeFile as fsWriteFile, readdir as fsReaddir } from 'node:fs/promises';
    import { existsSync } from 'node:fs';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { default: dataUploadService } = await import(${JSON.stringify(uploadPath)});
    const { zipEntryInfos } = await import(${JSON.stringify(packageServicePath)});

    const fixtureDir = nodePath.join(workDir, 'fixtures');
    await fsMkdir(fixtureDir, { recursive: true });
    const zipTmpFolder = nodePath.join(tmpDir, 'zip');

    // 一時展開先に何が出現したかを数える（AC21(a-1) の観察手段）
    const extractedNames = async (): Promise<string[]> => {
      if (!existsSync(zipTmpFolder)) return [];
      const out: string[] = [];
      const walk = async (dir: string, prefix: string) => {
        for (const e of await fsReaddir(dir, { withFileTypes: true })) {
          const rel = prefix ? prefix + '/' + e.name : e.name;
          if (e.isDirectory()) await walk(nodePath.join(dir, e.name), rel);
          else out.push(rel);
        }
      };
      await walk(zipTmpFolder, '');
      return out;
    };

    const CASES = ${JSON.stringify(CASES.map((c) => ({ label: c.label, file: c.file, expect: c.expect })))};

    for (const c of CASES) {
      const zipPath = nodePath.join(${JSON.stringify(fixtureDirOuter)}, c.file);

      // 前提: 危険 entry が **生のまま** ZIP に入っていること（fixture が無効化されていない）
      const infos = zipEntryInfos(new AdmZip(zipPath));
      assert.equal(
        infos.some((i: any) => String(i.name).startsWith('pois/')), false,
        c.label + ': AC21(a-2) fixture は pois/ を1件も含まないこと',
      );

      const result = await dataUploadService.extractZip(zipPath);

      // (a) 拒否されること
      assert.ok(result && typeof result.err === 'string',
        c.label + ': AC21(a) { err } で拒否されること（実際: ' + JSON.stringify(result) + '）');
      assert.ok(result.err.includes(c.expect),
        c.label + ': AC21(a) 安全検証のメッセージであること（実際: ' + result.err + '）');

      // (a-3) 完全ロールバック（展開前の失敗なので残留が原理的に存在しない）
      assert.equal('residue' in result, false,
        c.label + ': AC21(a-3) 展開前の失敗は残留を持たないため residue を付けないこと');

      // (a-1) 展開・ファイル書き込みの前に拒否されること
      const written = await extractedNames();
      assert.deepEqual(written, [],
        c.label + ': AC21(a-1) 一時展開先に entry が1件も出現しないこと（実際に出た: ' + JSON.stringify(written) + '）');
      console.log('ok: AC21(a) ' + c.label);
    }

    // -----------------------------------------------------------------------
    // 安全な地図 ZIP は安全検証を素通りする（検証が過剰に拒否していないことの確認）。
    // ここから先は既存の検証（slug 可用性など）に委ねられるため、
    // 安全検証由来のメッセージで落ちていないことだけを固定する。
    // -----------------------------------------------------------------------
    {
      const zipPath = nodePath.join(${JSON.stringify(fixtureDirOuter)}, 'safe.zip');
      const result = await dataUploadService.extractZip(zipPath);
      if (result && typeof result.err === 'string') {
        assert.doesNotMatch(
          result.err, /Unsafe map package entry|Duplicate map package entry/,
          '安全な地図 ZIP が安全検証で拒否されないこと（実際の err: ' + result.err + '）',
        );
      }
      console.log('ok: 安全な地図 ZIP は安全検証を通る');
    }

    // -----------------------------------------------------------------------
    // zipEntryInfos の共有: symlink 判定を二重実装しないための共通変換
    // -----------------------------------------------------------------------
    {
      const zipPath = nodePath.join(${JSON.stringify(fixtureDirOuter)}, 'safe.zip');
      const infos = zipEntryInfos(new AdmZip(zipPath));
      for (const i of infos) {
        assert.equal(typeof i.name, 'string');
        assert.equal(Number.isSafeInteger(i.size), true, 'size は安全整数であること: ' + i.name);
        assert.equal(typeof i.isSymlink, 'boolean', 'isSymlink を必ず埋めること: ' + i.name);
      }
      assert.ok(infos.some((i: any) => i.name === 'maps/himeji.json'));
      console.log('ok: zipEntryInfos が PoiPackageEntryInfo を組む');
    }

    console.log('m5-t4 archive safety timing OK');
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
        output: { entryFileNames: 'archive-safety-smoke.mjs', format: 'es' },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });

  console.log('m5-t4 archive safety timing smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
