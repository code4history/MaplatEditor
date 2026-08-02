// M5-T6: 大容量地図画像の JPEG デコード上限の互換復元
//
// 旧 Electron 版（commit 0db2f94 / backend/src/mapupload.js:25-28）が jpeg-js へ明示していた
// maxMemoryUsageInMB: 8192 / maxResolutionInMP: 800 を、Jimp 1.x の正しい伝達経路
// （Jimp.fromBuffer の image/jpeg option）へ復元したことを、実サービス経路で検証する。
//
// 検証する受け入れ条件（設計 §9）:
//   AC1a  maxMemoryUsageInMB の伝達 — 48 MP（8000x6000）JPEG が取り込める。
//         この寸法は解像度上限 100 MP 未満なので、GREEN の理由は memory 伝達以外にない。
//   AC1b  maxResolutionInMP の伝達 — 110 MP（11000x10000）JPEG が取り込める。
//         memory だけ 8192 にしても RED のままである実測（設計 §3.6）があるため、
//         GREEN は resolution 伝達を要する。
//   AC3   生成物が揃う（タイル・original.<ext>・thumbnail.jpg・thumbnail_512.jpg）。
//   AC4   観測記録のみ（合否条件ではない）。heapUsed / external のピークを出力する。
//         閾値 assert は置かないため、この項目でテストが失敗することはない。
//   AC5   PNG 原本が従来どおり取り込める（JPEG options の追加が PNG 経路を壊さない）。
//
// フィクスチャは実行時に合成する（利用者の実データはリポジトリにも一時領域にも置かない）。
// メモリ: RGBA バッファは 48 MP で約 183 MiB、110 MP で約 420 MiB を要する。いずれも
// Buffer（V8 ヒープ外）である。
//
// 実行時間: タイル生成が支配的で、実測で 48 MP 約 65 秒 / 110 MP 約 286 秒（合計 6〜8 分）。
// imageCutter がタイルごとに原寸ビットマップを clone するためで（設計 §8 の非スコープ項目）、
// 本タスクのデコード設定とは独立した既存実装の性質である。
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t6-decode-'));
const entryFile = path.join(workDir, 'm5-t6-decode-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm5-t6-decode-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  // m12-t15-upload-512-smoke.mjs と同じサンドボックス方式
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      globalThis.__nextImagePath = null;
      export const app = {
        getPath(name) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditorSmoke'; },
      };
      export const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), removeHandler: (ch) => handlers.delete(ch) };
      export const dialog = {
        async showOpenDialog() {
          const p = globalThis.__nextImagePath;
          if (!p) return { canceled: true, filePaths: [] };
          return { canceled: false, filePaths: [p] };
        },
      };
      export const BrowserWindow = class {};
      export const session = { defaultSession: { webRequest: { onBeforeRequest: () => {} } } };
    `,
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store {
        constructor(options = {}) { this.store = { ...(options.defaults || {}) }; }
        get(key) { return this.store[key]; }
        set(key, value) { this.store[key] = value; }
        has(key) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `,
  );

  await writeFile(
    entryFile,
    `
      import fs from 'node:fs/promises';
      import nodePath from 'node:path';
      import assert from 'node:assert/strict';
      import { Jimp } from 'jimp';

      const workDir = ${JSON.stringify(workDir)};
      const dataDir = ${JSON.stringify(dataDir)};
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const { showMapSelectDialog } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/MapUploadService.ts'))});

      // AC4: 観測記録。閾値 assert は置かない（実メモリは物理メモリ・同時実行・GC タイミングに
      // 依存するため、閾値を置くと環境差で偽陰性・偽陽性のどちらも生む）。
      let peakHeapUsed = 0;
      let peakExternal = 0;
      const sampler = setInterval(() => {
        const m = process.memoryUsage();
        if (m.heapUsed > peakHeapUsed) peakHeapUsed = m.heapUsed;
        if (m.external > peakExternal) peakExternal = m.external;
      }, 250);
      const mib = (n) => (n / 1024 / 1024).toFixed(1);

      async function makeFixture(w, h, filePath) {
        // 平坦画像はよく圧縮されるが、jpeg-js のガード会計は寸法に基づくため
        // 上限判定は実写真と同じように働く（設計 §3.6 で実測確認済み）。
        const img = new Jimp({ width: w, height: h, color: 0x3366ccff });
        await img.write(filePath);
      }

      async function exists(p) {
        return fs.stat(p).then(() => true).catch(() => false);
      }

      // 生成物の検証（AC3）。maxZoom は imageCutter の式
      //   ceil(log2(max(w,h) / 256))
      // を手計算した既知の値を渡す（テスト側でロジックを再実装しない）。
      async function assertArtifacts(outFolder, ext, maxZoom, label) {
        assert.ok(await exists(nodePath.join(outFolder, '0', '0', '0.' + ext)),
          label + ': ズーム0のタイルが実在する');
        assert.ok(await exists(nodePath.join(outFolder, String(maxZoom), '0', '0.' + ext)),
          label + ': 最大ズーム ' + maxZoom + ' のタイルが実在する');
        assert.ok(!(await exists(nodePath.join(outFolder, String(maxZoom + 1)))),
          label + ': 最大ズームの1つ上のフォルダは作られない');
        assert.ok(await exists(nodePath.join(outFolder, 'original.' + ext)),
          label + ': original.' + ext + ' が実在する');

        const thumb = nodePath.join(outFolder, 'thumbnail.jpg');
        assert.ok(await exists(thumb), label + ': thumbnail.jpg が実在する');
        const thumbImg = await Jimp.read(thumb);
        assert.ok(Math.max(thumbImg.width, thumbImg.height) <= 52,
          label + ': thumbnail.jpg の長辺は 52px 以下: ' + thumbImg.width + 'x' + thumbImg.height);

        // maxZoom >= 2 のときだけ 512px サムネイルが生成される（M12-T15 §C3）
        const thumb512 = nodePath.join(outFolder, 'thumbnail_512.jpg');
        assert.ok(await exists(thumb512), label + ': thumbnail_512.jpg が実在する');
        const thumb512Img = await Jimp.read(thumb512);
        assert.ok(Math.max(thumb512Img.width, thumb512Img.height) <= 512,
          label + ': thumbnail_512.jpg の長辺は 512px 以下: ' + thumb512Img.width + 'x' + thumb512Img.height);
      }

      // AC2a / AC2b の RED 実証のため、最初の失敗で打ち切らず全ケースを走らせて
      // 失敗を集約する。修正前は 48 MP が maxMemoryUsageInMB、110 MP が maxResolutionInMP と
      // 異なる文言で落ち、2つのガードが別個であることが1回の実行で読める（設計 §3.6）。
      const failures = [];

      async function runCase({ label, w, h, ext, maxZoom, dirName }) {
        const outFolder = nodePath.join(workDir, dirName);
        await fs.mkdir(outFolder, { recursive: true });
        const srcFile = nodePath.join(workDir, dirName + '.' + ext);
        const t0 = Date.now();
        await makeFixture(w, h, srcFile);
        const tFixture = Date.now() - t0;

        globalThis.__nextImagePath = srcFile;
        const t1 = Date.now();
        const r = await showMapSelectDialog(null, outFolder, '地図画像');
        const tCut = Date.now() - t1;

        // err は Error オブジェクトのこともあるため、RED 実証で文言が読めるよう展開する
        const errText = r.err == null ? '' : (r.err.message ?? String(r.err));
        assert.ok(!r.err, label + ': 取り込みが成功する（err=' + errText + '）');
        assert.equal(r.width, w, label + ': width が投入画像と一致する');
        assert.equal(r.height, h, label + ': height が投入画像と一致する');
        assert.equal(r.imageExtension, ext, label + ': imageExtension が ' + ext);
        assert.ok(typeof r.url === 'string' && r.url.endsWith('/{z}/{x}/{y}.' + ext),
          label + ': url がタイルテンプレート形式である: ' + r.url);

        await assertArtifacts(outFolder, ext, maxZoom, label);
        console.log('ok: ' + label + ' (' + w + 'x' + h + ' = ' + (w * h / 1e6).toFixed(1) + ' MP, '
          + 'フィクスチャ生成 ' + (tFixture / 1000).toFixed(1) + 's / タイル化 ' + (tCut / 1000).toFixed(1) + 's)');
      }

      async function runCaseCollecting(spec) {
        try {
          await runCase(spec);
        } catch (e) {
          failures.push(e.message ?? String(e));
          console.log('NG: ' + (e.message ?? String(e)));
        }
      }

      // AC1a: maxMemoryUsageInMB の伝達。48 MP は解像度上限 100 MP 未満なので、
      // ここが GREEN になる理由は memory オプションの伝達以外にない（設計 §3.6）。
      // maxZoom = ceil(log2(8000/256)) = ceil(4.97) = 5
      await runCaseCollecting({ label: 'AC1a 48 MP JPEG（memory ガードの識別）',
        w: 8000, h: 6000, ext: 'jpg', maxZoom: 5, dirName: 'ac1a-48mp' });

      // AC1b: maxResolutionInMP の伝達。memory だけ 8192 にしても RED のままである実測が
      // あるため（設計 §3.6）、ここが GREEN になるには resolution オプションの伝達を要する。
      // maxZoom = ceil(log2(11000/256)) = ceil(5.43) = 6
      await runCaseCollecting({ label: 'AC1b 110 MP JPEG（resolution ガードの識別）',
        w: 11000, h: 10000, ext: 'jpg', maxZoom: 6, dirName: 'ac1b-110mp' });

      // AC5: PNG 非回帰。PNG のデコードオプションにはメモリ・解像度の上限が無く（設計 §3.5）、
      // image/jpeg の options は参照されない。
      // maxZoom = ceil(log2(1200/256)) = ceil(2.23) = 3
      await runCaseCollecting({ label: 'AC5 PNG 原本（JPEG options の追加が PNG 経路を壊さない）',
        w: 1200, h: 900, ext: 'png', maxZoom: 3, dirName: 'ac5-png' });

      clearInterval(sampler);
      // AC4: 観測記録（合否条件ではない）
      console.log('AC4 観測記録: heapUsed ピーク = ' + mib(peakHeapUsed) + ' MiB, '
        + 'external ピーク = ' + mib(peakExternal) + ' MiB');

      if (failures.length > 0) {
        // 個々の文言は上の NG 行に出力済み。ここでは1行に集約する
        throw new Error('m5-t6 smoke: ' + failures.length + ' 件の受け入れ条件が失敗 / ' + failures.join(' / '));
      }
      console.log('m5-t6 large image decode limits smoke: ALL PASS');
    `,
  );

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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/],
        output: {
          entryFileNames: 'm5-t6-decode-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  // タイル生成が支配的で 6〜8 分を要するため、既存 smoke（120 秒）より長い上限を置く
  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 1800000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  // .tmp-smoke は破壊的操作禁止のため残置
}
