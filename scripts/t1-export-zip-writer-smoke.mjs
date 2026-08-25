// t1 スモーク: ストリーミング ZIP 書き出し（electron/utils/zipWriter.ts）と搬出経路の検査。
// タスク設計 `docs/superpowers/specs/2026-08-25-mapedit-export-zip-failure-t1-design.md` §8 準拠。
//
// 対象 AC:
//   t1/AC2  新実装の zip エントリ名の**集合**が同一入力の adm-zip 出力と一致する
//           （順序は契約外 — adm-zip 0.6.0 は書き出し時に名前でソート（zipFile.js:135-146）し、
//           新実装は入力順を保存するため、本番の未ソート DFS 入力ではエントリ順が異なる。
//           zip 仕様上エントリ順は任意で、既存検査の getEntries 全 20 箇所に順序依存 assert は
//           0 件（実装レビュー v1 MAJ-2 実測）∴ 集合一致を契約とする。検査入力は本番
//           listTileFiles と同じ**未ソート** stack DFS 順で与える）
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
//   T1_SMOKE_KEEP_BUILD=1 : vite ビルド出力（.tmp-smoke 配下）も残す（デバッグ用）
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
// ビルド出力（vite バンドル）は常にプロジェクト配下に置く。プロジェクト外に置くと
// external 指定の 'adm-zip' 等が bundle の位置から解決できず ERR_MODULE_NOT_FOUND になる（実測）
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const buildRoot = await mkdtemp(path.join(scratchRoot, 't1-export-zip-writer-build-'));
// データ作業域（合成ツリー・zip・展開結果）は T1_SMOKE_WORKDIR で外へ出せる（証跡の残置用）
let workDir;
if (process.env.T1_SMOKE_WORKDIR) {
  workDir = path.resolve(process.env.T1_SMOKE_WORKDIR);
  await mkdir(workDir, { recursive: true });
} else {
  workDir = await mkdtemp(path.join(scratchRoot, 't1-export-zip-writer-'));
}
const keepWorkDir = process.env.T1_SMOKE_KEEP === '1';
const entryFile = path.join(buildRoot, 't1-export-zip-writer-smoke.ts');
const electronStubFile = path.join(buildRoot, 'electron-stub.ts');
const electronStoreStubFile = path.join(buildRoot, 'electron-store-stub.ts');
const outDir = path.join(buildRoot, 'dist');
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

      // SECTION の AC4 検査が installBackendErrorForwarding() を呼ぶと process に
      // unhandledRejection ハンドラが載り、以降のセクションで top-level await が reject しても
      // Node の既定（exit 1）が抑止されて **exit 0 のまま黙って終了する**（本スモーク開発中に実測）。
      // ∴ 本体を main() に包み、失敗を明示的に exit 1 へ変換する。成功マーカーの出力も必須とし、
      // 呼び出し側（外側スクリプト）がマーカーの実在を検査する
      const main = async () => {

      const execFileAsync = promisify(execFile);
      const WORK = ${JSON.stringify(workDir)};

      const {
        writeZipStreaming,
        encodeCentralDirectoryHeader,
        encodeEndRecords,
      } = await import(${JSON.stringify(zipWriterPath)});

      // ---- helpers ----
      // 本番の AppExportService.listTileFiles (:107-129) と同じ**未ソート** stack(LIFO) DFS。
      // AC2 の検査入力はこの順で与える（実装レビュー v1 MAJ-2: ソート済み入力での比較は
      // 本番経路（未ソート）を一度も通らず判別力が無い）
      async function walkFilesProductionOrder(dir: string): Promise<string[]> {
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
        return out;
      }
      // ソート済み一覧。**順序を捨てた**木の照合（assertTreeEqual）専用であり、
      // AC2 のエントリ順比較の入力には使わない（同上 MAJ-2 実測 4 の是正）
      async function walkFiles(dir: string): Promise<string[]> {
        return (await walkFilesProductionOrder(dir)).sort();
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
        // (e4) 境界ちょうどの zip64 判定（実装レビュー v1 MIN-1）:
        //   APPNOTE 4.4.21 / 4.4.22 / 4.4.24 は「当該フィールドの値が 0xFFFF / 0xFFFFFFFF の
        //   ときは zip64 レコードを見よ」と定める ∴ 値が**ちょうど**境界値のときも 16/32bit
        //   フィールドでは表現できず zip64 EOCD が必須（needZip64 は >= が正。> だと
        //   境界ちょうどで sentinel だけ書いて zip64 レコードを書かない逸脱になる）。
        //   encodeCentralDirectoryHeader 側（>=）との同一ファイル内整合も兼ねる
        {
          const eqCases = [
            { name: 'entryCount', p: { entryCount: 0xffff, centralDirSize: 100, centralDirOffset: 200 } },
            { name: 'centralDirSize', p: { entryCount: 3, centralDirSize: 0xffffffff, centralDirOffset: 200 } },
            { name: 'centralDirOffset', p: { entryCount: 3, centralDirSize: 100, centralDirOffset: 0xffffffff } },
          ];
          for (const c of eqCases) {
            const buf = encodeEndRecords(c.p);
            assert.equal(buf.length, 56 + 20 + 22,
              'e4: 境界ちょうど(' + c.name + ')で zip64 EOCD record + locator が生成されるはず');
            assert.equal(buf.readUInt32LE(0), 0x06064b50, 'e4: zip64 EOCD record 署名 (' + c.name + ')');
            // zip64 record 側に 64bit 真値が入る
            assert.equal(buf.readBigUInt64LE(24), BigInt(c.p.entryCount), 'e4: 真値 entries (' + c.name + ')');
            assert.equal(buf.readBigUInt64LE(40), BigInt(c.p.centralDirSize), 'e4: 真値 size (' + c.name + ')');
            assert.equal(buf.readBigUInt64LE(48), BigInt(c.p.centralDirOffset), 'e4: 真値 offset (' + c.name + ')');
          }
          // 境界ちょうど(entryCount)で EOCD 側は sentinel（Math.min による飽和値と同値）
          const eq = encodeEndRecords({ entryCount: 0xffff, centralDirSize: 100, centralDirOffset: 200 });
          assert.equal(eq.readUInt16LE(76 + 8), 0xffff, 'e4: EOCD entries は sentinel');
          // 境界の 1 つ手前は非 zip64 のまま（>= へ直しても範囲が広がり過ぎないこと）
          const under = encodeEndRecords({
            entryCount: 0xfffe, centralDirSize: 0xfffffffe, centralDirOffset: 0xfffffffe,
          });
          assert.equal(under.length, 22, 'e4: 境界未満（0xFFFE / 0xFFFFFFFE）は EOCD のみ');
        }
        console.log('ok: t1/AC3(e) ヘッダエンコーダ単体検査（e1/e2/e3/e4 + 非zip64）');
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

        // AC2 の検査入力は本番 listTileFiles と同じ**未ソート** stack DFS 順（MAJ-2 是正）。
        // 前提条件: この fixture で DFS 順がソート順と実際に異なること（一致してしまう構成では
        // 「未ソート入力を通した」ことにならず検査が空洞化する ∴ fixture 縮退をここで検出する）
        const rels = await walkFilesProductionOrder(srcDir);
        assert.notDeepEqual(rels, [...rels].sort(),
          'AC2 前提条件: fixture の DFS 列挙順はソート順と異なるはず（未ソート入力の判別力）');
        const entries = rels.map((rel) => ({ entryName: entryNameOf(rel), localPath: nodePath.join(srcDir, rel) }));

        // 新実装で書く
        const ourZip = nodePath.join(WORK, 'small-ours.zip');
        let onEntryCalls = 0;
        await writeZipStreaming(ourZip, entries, { onEntry: async (i: number, total: number) => {
          assert.equal(total, entries.length); assert.equal(i, onEntryCalls); onEntryCalls++;
        } });
        assert.equal(onEntryCalls, entries.length, 'onEntry は全エントリで 1 回ずつ呼ばれるはず');

        // 現行 adm-zip で同じ入力（同じ未ソート順）を書く（AC2 の比較対象）
        const admZipPath = nodePath.join(WORK, 'small-admzip.zip');
        {
          const zip = new AdmZip();
          for (const rel of rels) {
            const zipDir = nodePath.dirname(rel).split(nodePath.sep).filter((s) => s && s !== '.').join('/');
            zip.addLocalFile(nodePath.join(srcDir, rel), zipDir, nodePath.basename(rel));
          }
          await zip.writeZipPromise(admZipPath);
        }

        // --- AC2: エントリ名の**集合**一致（順序は契約外） ---
        // adm-zip 0.6.0 は書き出し時に名前でソート（zipFile.js:135-146）し、新実装は入力順を
        // 保存する ∴ 未ソート入力ではエントリ順は一致しない（それで正しい。zip 仕様上順序は
        // 任意・既存検査に順序依存 assert 0 件 — 実装レビュー v1 MAJ-2）。集合一致のみを契約とする
        const ourNames = new AdmZip(ourZip).getEntries().map((e) => e.entryName);
        const admNames = new AdmZip(admZipPath).getEntries().map((e) => e.entryName);
        assert.deepEqual([...ourNames].sort(), [...admNames].sort(),
          'AC2: エントリ名の集合が adm-zip 出力と一致するはず');
        assert.deepEqual(ourNames, entries.map((e) => e.entryName), 'AC2: 新実装は入力順を保存するはず');
        console.log('ok: t1/AC2 エントリ名集合の adm-zip 一致（' + ourNames.length +
          ' 件・未ソート DFS 入力・非 ASCII 名含む）');

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
      // SECTION 4: t1/AC4 uncaughtException 時の settle 保証（実結線経由）
      //   設計レビュー v2 N-1: テスト内で自前結線せず、実モジュールの
      //   installBackendErrorForwarding() が登録した uncaughtException ハンドラ
      //   （backendErrorForwarder.ts:67 の 1 行追加）を経由して検査する。
      //   自前結線だと :67 への 1 行追加の欠落を検出できず負検査も空洞化する。
      // ============================================================
      {
        const { installBackendErrorForwarding } = await import(${JSON.stringify(backendErrorForwarderPath)});
        const { runGuarded } = await import(${JSON.stringify(inflightGuardPath)});
        installBackendErrorForwarding();

        // --- 負検査: unhandledRejection では settle しない（結線されていないこと。§4.5） ---
        {
          let settled: any = null;
          let resolveFn!: (v: string) => void;
          const guarded = runGuarded('t1-neg', () => new Promise<string>((res) => { resolveFn = res; }));
          guarded.then((v) => { settled = { v }; }, (e) => { settled = { e }; });
          process.emit('unhandledRejection' as any, new Error('t1 synthetic rejection'), Promise.resolve());
          await new Promise((r) => setTimeout(r, 100));
          assert.equal(settled, null, 'AC4 負検査: unhandledRejection では tripwire が発火しないはず');
          resolveFn('fn-result');
          assert.equal(await guarded, 'fn-result', 'AC4 負検査: fn の結果がそのまま返るはず');
          assert.deepEqual(settled, { v: 'fn-result' });
        }

        // --- 正検査: uncaughtException で必ず settle（発火源は実ハンドラ） ---
        {
          let settled: any = null;
          const guarded = runGuarded('t1-pos', () => new Promise(() => { /* 永遠に pending（孤児化の再現） */ }));
          guarded.then(() => { settled = { resolved: true }; }, (e) => { settled = { e }; });
          const boom = new Error('t1 synthetic uncaught');
          process.emit('uncaughtException' as any, boom);
          await new Promise((r) => setImmediate(r));
          assert.ok(settled && settled.e === boom, 'AC4 正検査: uncaughtException の例外で reject するはず: ' + settled);
        }

        // --- fn が正常に settle すれば登録は解除される（誤検知しない） ---
        {
          const value = await runGuarded('t1-ok', async () => 42);
          assert.equal(value, 42);
          // 完了後に uncaughtException が起きても済んだ呼び出しへは波及しない（Set から除去済み）
          process.emit('uncaughtException' as any, new Error('t1 late uncaught'));
          await new Promise((r) => setImmediate(r));
        }

        // --- 結線の実在（ソーステキストの固定）: ipc/apps.ts の appedit:export が runGuarded を通ること ---
        {
          const appsSrc = await readFile(${JSON.stringify(appsIpcPath)}, 'utf8');
          assert.ok(
            /runGuarded\\('appedit:export'/.test(appsSrc),
            'AC4: appedit:export ハンドラが runGuarded を経由するはず',
          );
        }
        console.log('ok: t1/AC4 uncaughtException で settle / unhandledRejection では settle しない（実結線経由）');
      }

      // ============================================================
      // SECTION 5: t1/AC6 搬出フロー検査（進捗が (N/N) まで到達してから完了文言へ）
      //   設計レビュー v1 M-1: forceNext() の単体検査では §4.3.3 での呼び出し欠落を
      //   検出できない ∴ 実 AppExportService.exportApp を合成アプリに対して実行する。
      //
      //   【決定化（実装レビュー v1 MAJ-1 是正）】caller throttle（AppExportService の
      //   200ms/100件条件）は実時間依存であり、zip ループ途中で 200ms 条件が再発火すると
      //   sinceLastReport がリセットされて送信列が実行ごとに変わる（設計書 v1.1 §8 の
      //   「タイミング非依存」の論証は誤りだった — 挟まる送信はより低いパーセントで実際に
      //   送信されるため条件が変わる。3 回中 3 回 99!==97 / 99!==93 で fail した実測）。
      //   ∴ 本検査は exportApp 実行中だけ Date.now を凍結する。凍結下では 200ms 条件は
      //   ループ先頭件（lastReportTime=0 との差が常に成立）でのみ発火し、以後の送信は
      //   sinceLastReport>=100（zipped=101）と最終件（zipped===N）のみ ∴ 送信列が決定的になる。
      //   （ProgressReporter 内部の heartbeat は new Date() の実時間だが 30s 閾値であり、
      //   この fixture の実行は秒オーダー ∴ 発火しない — 設計レビュー v2 I-3 の前提のまま）
      //
      //   検査構造:
      //   (a) 前提条件: ループ最終件の update の整数パーセントが直前送信済みと等しい
      //       （= forceNext() 無しなら 1% throttle に落とされる規模）を assert
      //   (b) (N/N) の zipping send の実在を assert
      //   (c) 対照実行（レビュー是正案 1）: ProgressReporter.prototype.forceNext を no-op に
      //       した実行では (N/N) send が**現れない**ことを assert（= 本検査が §4.3.3 の
      //       forceNext() 呼び出し欠落を実際に検出できるという判別力の証明。fixture 縮退や
      //       throttle constant の変更で判別力が消えた場合はここが fail する）
      //
      //   規模検算（設計書 §8 の一般化。sandbox の非タイル実測 E=17:
      //   assets 13(css+umd+11locales) + index.html + favicon.ico + apps json + maps json。
      //   ol.js は sandbox では olPackageRoot が未解決のため入らない（vite が public/ を
      //   bundle の dist/ へコピーし、previewAssetRoot は dist/preview で解決される — 実測））:
      //   tiles=85 → N=102, finalTotal = 85+102+1+4 = 192。凍結下では zip ループ先頭件で
      //   200ms 条件が 1 回だけ発火し、次の送信は zipped=101（step 191 → 99%）、
      //   最終件 zipped=102 は step 192→cap 191 → 同じ 99% ∴ forceNext() 無しでは落とされる。
      //   規模が (a) を満たさない場合は本検査自身が fail する（fixture 縮退で空洞化しない）
      // ============================================================
      {
        const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
        SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
        const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
        const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
        const { ProgressReporter } = await import(${JSON.stringify(progressReporterPath)});
        await SqliteDataService.getDb();

        const { uid: mapUid } = await SqliteDataService.createMap('t1map', { title: { ja: 't1地図' } });
        assert.ok(mapUid, '地図 fixture の作成');
        // tiles: 85 ファイル（上の規模検算のとおり N=102 に合わせる）
        const TILES = 85;
        for (let i = 0; i < TILES; i++) {
          const rel = nodePath.join('tiles', mapUid, String(Math.floor(i / 10)), i + '.png');
          const abs = nodePath.join(${JSON.stringify(dataDir)}, rel);
          await fsMkdir(nodePath.dirname(abs), { recursive: true });
          await fsWriteFile(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47, i & 0xff]));
        }

        const doc = {
          appID: 't1_ac6_app', title: { ja: 'T1' }, lang: 'ja',
          sources: [{ sourceType: 'maplat', mapUid, role: 'maplat', startFrom: true,
            data: { mapID: 't1map', maptype: 'maplat', noload: true } }],
          appSettings: {}, httpSettings: {},
        };

        const updateArgs: any[][] = [];
        const originalUpdate = ProgressReporter.prototype.update;
        ProgressReporter.prototype.update = function (...args: any[]) {
          updateArgs.push(args);
          return originalUpdate.apply(this, args);
        };
        const sendRecords: { channel: string; payload: any }[] = [];
        const fakeWin = { webContents: { send: (channel: string, payload: any) => sendRecords.push({ channel, payload }) } };
        const zipPath = nodePath.join(${JSON.stringify(exportDir)}, 't1-ac6.zip');
        (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
        // Date.now 凍結（上記【決定化】。exportApp 実行中のみ。new Date() は凍結しない —
        // ProgressReporter の heartbeat(30s) は実時間のままだが秒オーダーの実行では発火しない）
        const realDateNow = Date.now;
        const frozenNow = realDateNow();
        let exported;
        try {
          Date.now = () => frozenNow;
          exported = await AppExportService.exportApp(fakeWin, doc);
        } finally {
          Date.now = realDateNow;
          ProgressReporter.prototype.update = originalUpdate;
        }
        assert.equal(exported.result, 'Success', 'AC6: 搬出が完走するはず: ' + JSON.stringify(exported));

        const progressSends = sendRecords.filter((r) => r.channel === 'app:taskProgress');
        const zipSends = progressSends.filter((r) => r.payload && r.payload.text === 'appedit.export.zipping');
        assert.ok(zipSends.length > 0, 'AC6: zipping フェーズの send が存在するはず');
        const finalZipSend = zipSends[zipSends.length - 1];
        const m = /^\\((\\d+)\\/(\\d+)\\)$/.exec(finalZipSend.payload.progress);
        assert.ok(m && m[1] === m[2], 'AC6(b): (N/N) の zipping send が実在するはず: ' + finalZipSend.payload.progress);
        const N = Number(m![2]);
        assert.equal(N, TILES + 17, 'AC6: packageFiles の規模が規模検算と一致するはず' +
          '（assets 構成が変わった場合は TILES を再調整して (a) を維持する）: ' + N);

        // (a) 前提条件: (N/N) send の直前に送信済みのパーセントと、最終件のパーセントが等しい
        //     （等しい ∴ forceNext() 無しでは 1% throttle に落とされる規模である）
        const idx = progressSends.indexOf(finalZipSend);
        assert.ok(idx > 0, 'AC6(a): (N/N) より前に送信済み send があるはず');
        assert.equal(
          finalZipSend.payload.percent, progressSends[idx - 1].payload.percent,
          'AC6(a) 前提条件: 最終件のパーセントが直前送信済みパーセントと等しいはず（fixture 規模の検算）',
        );
        // update spy 側でも最終件の update が (N/N) で呼ばれたことを固定（send との突き合わせ）
        const zipUpdates = updateArgs.filter((a) => a[2] === 'appedit.export.zipping');
        assert.equal(zipUpdates[zipUpdates.length - 1][1], '(' + N + '/' + N + ')',
          'AC6: ループ最終件の update が (N/N) で呼ばれるはず');

        // (N/N) 到達の後に完了文言 (appedit.export.done / percent 100) へ切り替わる
        const doneIdx = progressSends.findIndex(
          (r) => r.payload && r.payload.text === 'appedit.export.done' && r.payload.percent === 100,
        );
        assert.ok(doneIdx > idx, 'AC6: (N/N) 到達後に完了文言へ切り替わるはず: doneIdx=' + doneIdx + ' idx=' + idx);

        // 生成された zip の実在とエントリ数（搬出フローの成果物として読めること）
        assert.equal(exported.outDir, zipPath);
        assert.equal(new AdmZip(zipPath).getEntries().length, N, 'AC6: zip のエントリ数 = packageFiles 数');
        console.log('ok: t1/AC6 搬出フローで (N/N)=(' + N + '/' + N + ') 到達 → 完了文言（前提条件 (a) 成立を確認）');

        // (c) 対照実行: forceNext() を no-op にすると (N/N) send が現れない（判別力の証明）。
        //     §4.3.3 の reporter.forceNext() 呼び出しが欠落した製品コードと同じ挙動を
        //     prototype 差し替えで再現する。Date.now 凍結も同一条件
        {
          const contrastSends: { channel: string; payload: any }[] = [];
          const contrastWin = { webContents: { send: (channel: string, payload: any) => contrastSends.push({ channel, payload }) } };
          const contrastZip = nodePath.join(${JSON.stringify(exportDir)}, 't1-ac6-contrast.zip');
          (globalThis as any).__nextDialogResult = { canceled: false, filePath: contrastZip };
          const originalForceNext = ProgressReporter.prototype.forceNext;
          let contrastExported;
          try {
            Date.now = () => frozenNow;
            ProgressReporter.prototype.forceNext = function () { /* 欠落の再現 */ };
            contrastExported = await AppExportService.exportApp(contrastWin, doc);
          } finally {
            Date.now = realDateNow;
            ProgressReporter.prototype.forceNext = originalForceNext;
          }
          assert.equal(contrastExported.result, 'Success', 'AC6(c): 対照実行も完走するはず');
          const contrastZipSends = contrastSends.filter(
            (r) => r.channel === 'app:taskProgress' && r.payload && r.payload.text === 'appedit.export.zipping',
          );
          assert.ok(contrastZipSends.length > 0, 'AC6(c): 対照実行にも zipping send はあるはず');
          const nn = '(' + N + '/' + N + ')';
          assert.ok(
            contrastZipSends.every((r) => r.payload.progress !== nn),
            'AC6(c) 対照実行: forceNext 欠落時は ' + nn + ' send が現れないはず（現れた場合、' +
              '本検査は forceNext() の呼び出し欠落を検出できない = 判別力喪失）: ' +
              JSON.stringify(contrastZipSends.map((r) => r.payload.progress)),
          );
          console.log('ok: t1/AC6(c) 対照実行で (N/N) send が消えることを確認（判別力の証明）');
        }
      }

      // ============================================================
      // SECTION 6: t1/AC3 ZIP64 経路（70,000 エントリ > 65,535）
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
      };

      main().then(
        () => { process.exit(0); },
        (e) => {
          console.error('[t1-smoke] FAILED:', (e && (e as any).stack) || e);
          process.exit(1);
        },
      );
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
  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
      cwd: projectRoot,
      timeout: 1200000,
      maxBuffer: 1024 * 1024 * 64,
    }));
  } catch (e) {
    // 子プロセス失敗時も stdout/stderr を可視化してから落とす
    if (e && e.stdout) process.stdout.write(e.stdout);
    if (e && e.stderr) process.stderr.write(e.stderr);
    throw e;
  }
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  // 成功マーカーの実在検査（子プロセスが黙って exit 0 した場合を成功と区別する）
  if (!stdout.includes('T1 export zip writer smoke passed')) {
    throw new Error('t1 smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
  }
} finally {
  if (process.env.T1_SMOKE_KEEP_BUILD !== "1") await rm(buildRoot, { recursive: true, force: true });
  if (keepWorkDir) {
    console.log(`T1 smoke workdir kept: ${workDir}`);
  } else {
    await rm(workDir, { recursive: true, force: true });
  }
}
