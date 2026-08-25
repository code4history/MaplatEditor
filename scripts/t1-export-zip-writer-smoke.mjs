// t1 スモーク: ストリーミング ZIP 書き出し（electron/utils/zipWriter.ts）と搬出経路の検査。
// タスク設計 `docs/superpowers/specs/2026-08-25-mapedit-export-zip-failure-t1-design.md` §8 準拠。
//
// 対象 AC:
//   t1/AC2  新実装の zip エントリ名一覧が同一入力の adm-zip 出力と完全一致（順序含む）
//   t1/AC3  (a) adm-zip で読める・展開できる (b) unzip -t OK (c) ditto -x -k OK
//           (d) 展開結果が原本とバイト一致。70,000 エントリの ZIP64 経路では
//               両方向の再帰一覧一致 + 件数 70,000 + getEntries().length===70000
//           (e) ヘッダエンコーダ単体検査（offset=5GiB 飽和 / EOCD64 定数 / entryCount 飽和）
//           (f) ファイル単体 ≥ 0xFFFFFFFF バイトの fail-fast
//   t1/AC4  uncaughtException で appedit:export ガードが settle する（実結線経由。
//           unhandledRejection では settle しない負検査を含む — 設計書 §4.5 / レビュー N-1）
//   t1/AC6  搬出フローで進捗が (N/N) まで到達してから完了文言に切り替わる
//           （forceNext() 欠落なら throttle される規模であることを前提条件 assert）
//
// m6-t10 と同じ sandbox 方式（vite SSR ビルド + electron/electron-store スタブ）。
// 環境変数:
//   T1_SMOKE_WORKDIR: 作業ディレクトリの明示指定（既定: .tmp-smoke 配下の mkdtemp）
//   T1_SMOKE_KEEP=1 : 終了後も作業ディレクトリを残す（実測証跡の残置用）
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
let workDir;
if (process.env.T1_SMOKE_WORKDIR) {
  workDir = path.resolve(process.env.T1_SMOKE_WORKDIR);
  await mkdir(workDir, { recursive: true });
} else {
  const scratchRoot = path.join(projectRoot, '.tmp-smoke');
  await mkdir(scratchRoot, { recursive: true });
  workDir = await mkdtemp(path.join(scratchRoot, 't1-export-zip-writer-'));
}
const keepWorkDir = process.env.T1_SMOKE_KEEP === '1';
const entryFile = path.join(workDir, 't1-export-zip-writer-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 't1-export-zip-writer-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const exportDir = path.join(workDir, 'export-out');
  await mkdir(dataDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const zipWriterPath = path.join(projectRoot, 'electron/utils/zipWriter.ts');
  const inflightGuardPath = path.join(projectRoot, 'electron/utils/inflightGuard.ts');
  const backendErrorForwarderPath = path.join(projectRoot, 'electron/utils/backendErrorForwarder.ts');
  const progressReporterPath = path.join(projectRoot, 'electron/utils/ProgressReporter.ts');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');
  const appsIpcPath = path.join(projectRoot, 'electron/ipc/apps.ts');

  await writeFile(
    electronStubFile,
    `
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditorSmoke'; },
        whenReady() { return Promise.resolve(); },
        exit() {},
      };
      export const ipcMain = { handle() {}, removeHandler() {} };
      export const dialog = {
        async showSaveDialog(_win: any, _opts: any) {
          return (globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined };
        },
        async showMessageBox() { return { response: 0 }; },
        async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      };
      export const BrowserWindow = class {
        static fromWebContents() { return { webContents: { send() {} } }; }
        static getAllWindows() { return []; }
      };
      export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
      export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
    `,
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `,
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import crypto from 'node:crypto';
      import nodePath from 'node:path';
      import { execFile } from 'node:child_process';
      import { promisify } from 'node:util';
      import { open, readFile, writeFile as fsWriteFile, mkdir as fsMkdir, readdir, stat } from 'node:fs/promises';
      import AdmZip from 'adm-zip';

      const execFileAsync = promisify(execFile);
      const WORK = ${JSON.stringify(workDir)};

      const {
        writeZipStreaming,
        encodeCentralDirectoryHeader,
        encodeEndRecords,
      } = await import(${JSON.stringify(zipWriterPath)});

      // ---- helpers ----
      async function walkFiles(dir: string): Promise<string[]> {
        const out: string[] = [];
        const stack: string[] = [''];
        while (stack.length) {
          const rel = stack.pop()!;
          const abs = rel ? nodePath.join(dir, rel) : dir;
          let entries;
          try { entries = await readdir(abs, { withFileTypes: true }); } catch { continue; }
          for (const e of entries) {
            const cr = rel ? nodePath.join(rel, e.name) : e.name;
            if (e.isDirectory()) stack.push(cr);
            else if (e.isFile()) out.push(cr);
          }
        }
        return out.sort();
      }
      async function sha256(file: string): Promise<string> {
        return crypto.createHash('sha256').update(await readFile(file)).digest('hex');
      }
      // 展開結果 extractedDir を原本 srcDir と両方向で照合する（一覧一致 + バイト一致）
      async function assertTreeEqual(srcDir: string, extractedDir: string, label: string, expectedCount?: number) {
        const srcList = await walkFiles(srcDir);
        const dstList = await walkFiles(extractedDir);
        assert.deepEqual(dstList, srcList, label + ': 再帰ファイル一覧が両方向で一致するはず');
        if (expectedCount != null) {
          assert.equal(srcList.length, expectedCount, label + ': 原本の件数');
          assert.equal(dstList.length, expectedCount, label + ': 展開結果の件数');
        }
        for (const rel of srcList) {
          const a = await sha256(nodePath.join(srcDir, rel));
          const b = await sha256(nodePath.join(extractedDir, rel));
          assert.equal(b, a, label + ': バイト一致するはず: ' + rel);
        }
      }
      function entryNameOf(rel: string): string {
        return rel.split(nodePath.sep).filter((s) => s && s !== '.').join('/');
      }

      // ============================================================
      // SECTION 1: t1/AC3(e) ヘッダエンコーダ単体検査（4GB 境界の dead path 対策）
      // ============================================================
      {
        const GIB5 = 5 * 1024 * 1024 * 1024; // 5 GiB
        // (e1) localHeaderOffset = 5GiB → offset フィールド飽和 + zip64 拡張 + versionNeeded 45
        {
          const buf = encodeCentralDirectoryHeader({
            entryName: 'a.txt', crc: 0x12345678, compressedSize: 10, uncompressedSize: 20,
            method: 8, dosTime: 0x6000, dosDate: 0x5800, localHeaderOffset: GIB5,
          });
          assert.equal(buf.readUInt32LE(0), 0x02014b50, 'e1: central header 署名');
          assert.equal(buf.readUInt16LE(6), 45, 'e1: zip64 拡張を付けたエントリの versionNeeded は 45');
          assert.equal(buf.readUInt32LE(42), 0xffffffff, 'e1: offset フィールドは 0xFFFFFFFF に飽和');
          const nameLen = buf.readUInt16LE(28);
          const extraLen = buf.readUInt16LE(30);
          assert.equal(nameLen, 5, 'e1: name length');
          const extraOff = 46 + nameLen;
          assert.equal(extraLen, 12, 'e1: 飽和フィールドは offset のみ ∴ 拡張は 4+8 バイト');
          assert.equal(buf.readUInt16LE(extraOff), 0x0001, 'e1: zip64 拡張ヘッダ ID');
          assert.equal(buf.readUInt16LE(extraOff + 2), 8, 'e1: zip64 拡張データ長');
          assert.equal(buf.readBigUInt64LE(extraOff + 4), BigInt(GIB5), 'e1: 64bit 真値');
        }
        // (e1') 複数フィールド飽和時は uncompressedSize → compressedSize → localHeaderOffset の固定順
        {
          const U = GIB5, C = GIB5 + 4096, O = GIB5 + 8192;
          const buf = encodeCentralDirectoryHeader({
            entryName: 'b', crc: 0, compressedSize: C, uncompressedSize: U,
            method: 0, dosTime: 0, dosDate: 0x21, localHeaderOffset: O,
          });
          assert.equal(buf.readUInt32LE(20), 0xffffffff, 'e1: compressedSize 飽和');
          assert.equal(buf.readUInt32LE(24), 0xffffffff, 'e1: uncompressedSize 飽和');
          assert.equal(buf.readUInt32LE(42), 0xffffffff, 'e1: offset 飽和');
          const extraOff = 46 + 1;
          assert.equal(buf.readUInt16LE(extraOff + 2), 24, 'e1: 3 フィールド分 24 バイト');
          assert.equal(buf.readBigUInt64LE(extraOff + 4), BigInt(U), 'e1: 第1固定順 = uncompressedSize');
          assert.equal(buf.readBigUInt64LE(extraOff + 12), BigInt(C), 'e1: 第2固定順 = compressedSize');
          assert.equal(buf.readBigUInt64LE(extraOff + 20), BigInt(O), 'e1: 第3固定順 = localHeaderOffset');
        }
        // (e2) centralDirOffset = 5GiB → EOCD ENDOFF 飽和 + Zip64 EOCD record/locator の確定値
        {
          const buf = encodeEndRecords({ entryCount: 10, centralDirSize: 100, centralDirOffset: GIB5 });
          assert.equal(buf.readUInt32LE(0), 0x06064b50, 'e2: Zip64 EOCD record 署名');
          assert.equal(buf.readBigUInt64LE(4), 44n, 'e2: record size フィールド = 44');
          assert.equal(buf.readUInt16LE(12), 45, 'e2: version made by = 45');
          assert.equal(buf.readUInt16LE(14), 45, 'e2: version needed = 45');
          assert.equal(buf.readBigUInt64LE(24), 10n, 'e2: entries on disk');
          assert.equal(buf.readBigUInt64LE(32), 10n, 'e2: total entries');
          assert.equal(buf.readBigUInt64LE(40), 100n, 'e2: central dir size');
          assert.equal(buf.readBigUInt64LE(48), BigInt(GIB5), 'e2: central dir offset');
          assert.equal(buf.readUInt32LE(56), 0x07064b50, 'e2: Zip64 EOCD locator 署名');
          assert.equal(buf.readBigUInt64LE(64), BigInt(GIB5) + 100n, 'e2: zip64 EOCD の位置 = offset+size');
          assert.equal(buf.readUInt32LE(72), 1, 'e2: total number of disks = 1');
          assert.equal(buf.readUInt32LE(76), 0x06054b50, 'e2: EOCD 署名');
          assert.equal(buf.readUInt16LE(76 + 8), 10, 'e2: EOCD entries (飽和不要)');
          assert.equal(buf.readUInt32LE(76 + 12), 100, 'e2: EOCD size (飽和不要)');
          assert.equal(buf.readUInt32LE(76 + 16), 0xffffffff, 'e2: EOCD ENDOFF は飽和');
        }
        // (e3) entryCount = 70,000 → EOCD のエントリ数フィールドが 0xFFFF に飽和
        {
          const buf = encodeEndRecords({ entryCount: 70000, centralDirSize: 100, centralDirOffset: 200 });
          assert.equal(buf.readUInt32LE(0), 0x06064b50, 'e3: zip64 経路に入るはず');
          assert.equal(buf.readBigUInt64LE(24), 70000n, 'e3: zip64 record の真値');
          assert.equal(buf.readUInt16LE(76 + 8), 0xffff, 'e3: EOCD entries on disk 飽和');
          assert.equal(buf.readUInt16LE(76 + 10), 0xffff, 'e3: EOCD total entries 飽和');
        }
        // 非 zip64 経路: 通常 EOCD のみ（22 バイト）
        {
          const buf = encodeEndRecords({ entryCount: 3, centralDirSize: 150, centralDirOffset: 1000 });
          assert.equal(buf.length, 22, '非 zip64 では EOCD 22 バイトのみ');
          assert.equal(buf.readUInt32LE(0), 0x06054b50);
          assert.equal(buf.readUInt16LE(8), 3);
          assert.equal(buf.readUInt32LE(12), 150);
          assert.equal(buf.readUInt32LE(16), 1000);
        }
        console.log('ok: t1/AC3(e) ヘッダエンコーダ単体検査（e1/e2/e3 + 非zip64）');
      }

      // ============================================================
      // SECTION 2: t1/AC3(f) ファイル単体 ≥ 0xFFFFFFFF バイトの fail-fast
      // ============================================================
      {
        const dir = nodePath.join(WORK, 'failfast');
        await fsMkdir(dir, { recursive: true });
        const sparse = nodePath.join(dir, 'huge-sparse.bin');
        const fh = await open(sparse, 'w');
        await fh.truncate(0xffffffff); // APFS の sparse file。実ディスク消費はほぼ 0
        await fh.close();
        assert.equal((await stat(sparse)).size, 0xffffffff, '前提: sparse file が 0xFFFFFFFF バイト');
        const target = nodePath.join(dir, 'failfast.zip');
        await assert.rejects(
          () => writeZipStreaming(target, [{ entryName: 'huge.bin', localPath: sparse }]),
          (err: any) => /4GiB/.test(String(err?.message)) && /huge\\.bin/.test(String(err?.message)),
          'AC3(f): 明示エラーで reject するはず',
        );
        let removed = false;
        try { await stat(target); } catch { removed = true; }
        assert.ok(removed, 'AC3(f): 失敗時は書きかけの targetPath が残らないはず');
        console.log('ok: t1/AC3(f) ファイル単体 >= 4GiB-1 バイトの fail-fast');
      }

      // ============================================================
      // SECTION 3: t1/AC2 + t1/AC3(a-d) 小規模合成ツリー
      //   設計書 §8 の確定仕様: STORE 閾値超 / 非圧縮性データ / 空ファイル / 非 ASCII 名を含む
      // ============================================================
      {
        const srcDir = nodePath.join(WORK, 'small-tree');
        await fsMkdir(srcDir, { recursive: true });
        const put = async (rel: string, data: Buffer | string) => {
          const abs = nodePath.join(srcDir, rel);
          await fsMkdir(nodePath.dirname(abs), { recursive: true });
          await fsWriteFile(abs, data);
        };
        await put('index.html', '<!doctype html><title>t1</title>' + 'x'.repeat(4000));
        await put(nodePath.join('apps', 'app.json'), JSON.stringify({ appID: 't1', values: Array(200).fill('v') }));
        await put(nodePath.join('tiles', 'uid1', '0', '0', '0.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
        await put(nodePath.join('tiles', 'uid1', '1', '0', '1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6, 5]));
        // STORE 閾値（既定 8 MiB）超の圧縮性ファイル → 2 パス CRC + ストリームコピー経路
        await put(nodePath.join('big', 'compressible-9mib.bin'), Buffer.alloc(9 * 1024 * 1024, 0x41));
        // 非圧縮性データ → deflate 膨張 → STORE フォールバック経路
        await put(nodePath.join('rand', 'random-1mib.bin'), crypto.randomBytes(1024 * 1024));
        // 空ファイル → size 0 / CRC 0
        await put(nodePath.join('empty', 'empty.txt'), Buffer.alloc(0));
        // 非 ASCII 名 → UTF-8 名前 + 0x0800 フラグ経路
        await put(nodePath.join('地図', 'タイル画像.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]));

        const rels = await walkFiles(srcDir);
        const entries = rels.map((rel) => ({ entryName: entryNameOf(rel), localPath: nodePath.join(srcDir, rel) }));

        // 新実装で書く
        const ourZip = nodePath.join(WORK, 'small-ours.zip');
        let onEntryCalls = 0;
        await writeZipStreaming(ourZip, entries, { onEntry: async (i: number, total: number) => {
          assert.equal(total, entries.length); assert.equal(i, onEntryCalls); onEntryCalls++;
        } });
        assert.equal(onEntryCalls, entries.length, 'onEntry は全エントリで 1 回ずつ呼ばれるはず');

        // 現行 adm-zip で同じ入力を書く（AC2 の比較対象）
        const admZipPath = nodePath.join(WORK, 'small-admzip.zip');
        {
          const zip = new AdmZip();
          for (const rel of rels) {
            const zipDir = nodePath.dirname(rel).split(nodePath.sep).filter((s) => s && s !== '.').join('/');
            zip.addLocalFile(nodePath.join(srcDir, rel), zipDir, nodePath.basename(rel));
          }
          await zip.writeZipPromise(admZipPath);
        }

        // --- AC2: エントリ名一覧の完全一致（順序含む） ---
        const ourNames = new AdmZip(ourZip).getEntries().map((e) => e.entryName);
        const admNames = new AdmZip(admZipPath).getEntries().map((e) => e.entryName);
        assert.deepEqual(ourNames, admNames, 'AC2: エントリ名一覧が adm-zip 出力と完全一致するはず');
        assert.deepEqual(ourNames, entries.map((e) => e.entryName), 'AC2: 入力順が保存されるはず');
        console.log('ok: t1/AC2 エントリ名一覧の adm-zip 完全一致（' + ourNames.length + ' 件・非 ASCII 名含む）');

        // --- 圧縮方式の分岐確認（設計書 §4.3.2 step 2/3） ---
        const ourEntries = new AdmZip(ourZip).getEntries();
        const methodOf = (name: string) => ourEntries.find((e) => e.entryName === name)!.header.method;
        assert.equal(methodOf('big/compressible-9mib.bin'), 0, '閾値超は STORE（ストリームコピー経路）');
        assert.equal(methodOf('rand/random-1mib.bin'), 0, '非圧縮性は deflate 膨張 → STORE フォールバック');
        assert.equal(methodOf('index.html'), 8, '圧縮の効く小ファイルは DEFLATE');
        const emptyEntry = ourEntries.find((e) => e.entryName === 'empty/empty.txt')!;
        assert.equal(emptyEntry.header.size, 0, '空ファイル size 0');
        assert.equal(emptyEntry.header.crc, 0, '空ファイル CRC 0');

        // --- AC3(a): adm-zip extractAllTo + バイト一致 ---
        const admExtract = nodePath.join(WORK, 'small-extract-admzip');
        new AdmZip(ourZip).extractAllTo(admExtract, true);
        await assertTreeEqual(srcDir, admExtract, 'AC3(a) adm-zip 展開');

        // --- AC3(b): unzip -t ---
        const unzipRes = await execFileAsync('unzip', ['-t', ourZip]);
        assert.match(unzipRes.stdout, /No errors detected/, 'AC3(b): unzip -t OK');

        // --- AC3(c)(d): ditto -x -k 展開 + バイト一致 ---
        const dittoExtract = nodePath.join(WORK, 'small-extract-ditto');
        await execFileAsync('ditto', ['-x', '-k', ourZip, dittoExtract]);
        await assertTreeEqual(srcDir, dittoExtract, 'AC3(c)(d) ditto 展開');
        console.log('ok: t1/AC3(a-d) 小規模合成ツリー（adm-zip/unzip -t/ditto + バイト一致）');
      }

      // ============================================================
      // SECTION 4: t1/AC3 ZIP64 経路（70,000 エントリ > 65,535）
      //   設計書 §10 S1: ここが崩れたら停止（短縮しない）
      // ============================================================
      {
        const srcDir = nodePath.join(WORK, 'zip64-tree');
        const N = 70000;
        console.log('zip64: 70,000 ファイルの合成ツリーを生成中...');
        for (let d = 0; d < 700; d++) {
          const dir = nodePath.join(srcDir, 'd' + String(d).padStart(3, '0'));
          await fsMkdir(dir, { recursive: true });
          const writes = [];
          for (let f = 0; f < 100; f++) {
            const rel = 'd' + String(d).padStart(3, '0') + '/f' + String(f).padStart(2, '0') + '.txt';
            writes.push(fsWriteFile(nodePath.join(srcDir, rel), 't1 zip64 ' + rel + '\\n'));
          }
          await Promise.all(writes);
        }
        const rels = await walkFiles(srcDir);
        assert.equal(rels.length, N, '前提: 合成ツリーが 70,000 ファイル');
        const entries = rels.map((rel) => ({ entryName: entryNameOf(rel), localPath: nodePath.join(srcDir, rel) }));

        const zipPath = nodePath.join(WORK, 'zip64.zip');
        const t0 = Date.now();
        await writeZipStreaming(zipPath, entries);
        console.log('zip64: 書き出し完了 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's, size=' + (await stat(zipPath)).size);

        // adm-zip: getEntries().length === 70000（EOCD 飽和値 65,535 の見逃し防止）
        const admEntries = new AdmZip(zipPath).getEntries();
        assert.equal(admEntries.length, N, 'AC3: adm-zip getEntries().length === 70000');

        // unzip -t
        const unzipRes = await execFileAsync('unzip', ['-t', zipPath], { maxBuffer: 64 * 1024 * 1024 });
        assert.match(unzipRes.stdout, /No errors detected/, 'AC3: unzip -t OK (ZIP64)');

        // ditto -x -k 展開 → 両方向一覧一致 + 件数 70,000 + バイト一致
        const dittoExtract = nodePath.join(WORK, 'zip64-extract-ditto');
        await execFileAsync('ditto', ['-x', '-k', zipPath, dittoExtract]);
        await assertTreeEqual(srcDir, dittoExtract, 'AC3 ZIP64 ditto 展開', N);

        // adm-zip extractAllTo → 両方向一覧一致 + バイト一致
        const admExtract = nodePath.join(WORK, 'zip64-extract-admzip');
        new AdmZip(zipPath).extractAllTo(admExtract, true);
        await assertTreeEqual(srcDir, admExtract, 'AC3 ZIP64 adm-zip 展開', N);

        console.log('ok: t1/AC3 ZIP64 70,000 エントリ（unzip -t / ditto / adm-zip / 両方向一覧一致 / バイト一致）');
      }

      console.log('T1 export zip writer smoke passed');
    `,
  );

  await build({
    root: projectRoot,
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
        external: [
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          /^@duckdb\/node-bindings-.*/,
          'jimp',
          'adm-zip',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
        ],
        output: { entryFileNames: 't1-export-zip-writer-smoke.mjs', format: 'es' },
      },
    },
  });

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 1200000,
    maxBuffer: 1024 * 1024 * 64,
  });
  process.stdout.write(stdout);
} finally {
  if (keepWorkDir) {
    console.log(`T1 smoke workdir kept: ${workDir}`);
  } else {
    await rm(workDir, { recursive: true, force: true });
  }
}
