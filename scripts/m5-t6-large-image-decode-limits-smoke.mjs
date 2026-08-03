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
      const { estimateJpegDecodeBudget } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/jpegDecodeBudget.ts'))});
      const nodeFs = await import('node:fs');
      const LOCALES = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];

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

      // ================= Phase B: 設定値化（AC5 / AC7 / AC8） =================

      const okB = (label, fn) => {
        try { fn(); console.log('ok: ' + label); }
        catch (e) { failures.push(label + ' — ' + (e.message ?? String(e))); console.log('NG: ' + label + ' — ' + (e.message ?? String(e))); }
      };

      okB('AC5 既定値が 8192 / 800', () => {
        const d = SettingsService.getJpegDecodeLimits();
        assert.equal(d.maxMemoryUsageInMB, 8192);
        assert.equal(d.maxResolutionInMP, 800);
      });

      // AC7: 不正値は既定へ落ちる。store は利用者が編集できる JSON なので UI を通らない値が入り得る。
      // set 経由（書き込み側の防御）と store 直書き（読み出し側の防御）の**両方**を確認する —
      // set だけだと読み出し側の正規化が効いているかを証明できない。
      const rawStore = SettingsService.store; // private だが、読み出し側の検証にはここを突く必要がある
      for (const bad of [0, -1, 'abc', null, Infinity]) {
        okB('AC7 不正値 ' + JSON.stringify(bad) + ' が既定へ落ちる（set 経由・例外を投げない）', () => {
          SettingsService.set('jpegDecodeMaxMemoryMB', bad);
          SettingsService.set('jpegDecodeMaxResolutionMP', bad);
          const d = SettingsService.getJpegDecodeLimits();
          assert.equal(d.maxMemoryUsageInMB, 8192);
          assert.equal(d.maxResolutionInMP, 800);
        });
        okB('AC7 不正値 ' + JSON.stringify(bad) + ' が既定へ落ちる（store 直書き＝手編集の JSON 相当）', () => {
          rawStore.set('jpegDecodeMaxMemoryMB', bad);
          rawStore.set('jpegDecodeMaxResolutionMP', bad);
          const d = SettingsService.getJpegDecodeLimits();
          assert.equal(d.maxMemoryUsageInMB, 8192);
          assert.equal(d.maxResolutionInMP, 800);
        });
      }

      okB('AC8 下限が効く（256→512 / 50→100）', () => {
        SettingsService.set('jpegDecodeMaxMemoryMB', 256);
        SettingsService.set('jpegDecodeMaxResolutionMP', 50);
        const d = SettingsService.getJpegDecodeLimits();
        assert.equal(d.maxMemoryUsageInMB, 512, 'jpeg-js 既定 512 を下回らない');
        assert.equal(d.maxResolutionInMP, 100, 'jpeg-js 既定 100 を下回らない');
      });

      okB('正当な値はそのまま通り、小数は切り捨てられる', () => {
        SettingsService.set('jpegDecodeMaxMemoryMB', 20480.9);
        SettingsService.set('jpegDecodeMaxResolutionMP', 1200.7);
        const d = SettingsService.getJpegDecodeLimits();
        assert.equal(d.maxMemoryUsageInMB, 20480);
        assert.equal(d.maxResolutionInMP, 1200);
      });

      // ============ Phase C: 事前判定と構造化エラー（AC10-AC14 / AC18） ============
      // 実測トリガ級の巨大画像を使わずに検証する。ガードは「設定値」に対する判定なので、
      // 小さい画像 + 意図的に低い設定値で同じ経路を通せる（実行時間を無駄にしない）。

      const resetLimits = () => {
        SettingsService.set('jpegDecodeMaxMemoryMB', 8192);
        SettingsService.set('jpegDecodeMaxResolutionMP', 800);
      };

      /** prediction の「全部入りか無しか」を検査する（AC11b の不変条件） */
      function assertPredictionShape(r, label) {
        if (r.prediction === undefined) return 'absent';
        assert.equal(typeof r.prediction, 'object', label + ': prediction はオブジェクト');
        const keys = r.errorCode === 'jpeg_memory_limit'
          ? ['requiredMemoryMB', 'recommendedMemoryMB']
          : ['megapixels', 'recommendedResolutionMP'];
        for (const k of keys) {
          assert.equal(typeof r.prediction[k], 'number',
            label + ': prediction.' + k + ' が数値（部分的に埋まった中間状態を作らない）');
        }
        return 'present';
      }

      // 下限（メモリ 512 / 解像度 100）があるため、小さい画像では不足を作れない。
      // ∴ 実サイズのフィクスチャを使い、v1.3 からの回帰ケース（48 MP / 110 MP）と統合する。
      const bigJpg = nodePath.join(workDir, 'ac10-48mp.jpg');
      await makeFixture(8000, 6000, bigJpg);                    // 48 MP / 4:4:4 → 予測 1008 MB
      const bigBudget = estimateJpegDecodeBudget(await fs.readFile(bigJpg));

      const hugeJpg = nodePath.join(workDir, 'ac11-110mp.jpg');
      await makeFixture(11000, 10000, hugeJpg);                 // 110 MP
      const hugeBudget = estimateJpegDecodeBudget(await fs.readFile(hugeJpg));

      /**
       * 番兵ファイルを置いてから取り込む。
       * imageCutter は原寸デコードの前に outFolder を fs.remove でクリアするため、
       * **番兵が残っていればデコード段まで到達していない**ことの構造的な証拠になる。
       * 所要時間では判定しない（環境依存で偽陽性・偽陰性のどちらも生む）。
       * 同時に「事前判定で弾いたとき既存の下書きタイルを壊さない」ことの検証も兼ねる。
       */
      const SENTINEL = 'do-not-delete.txt';
      async function upload(dirName, srcFile) {
        const outFolder = nodePath.join(workDir, dirName);
        await fs.mkdir(outFolder, { recursive: true });
        await fs.writeFile(nodePath.join(outFolder, SENTINEL), 'sentinel');
        globalThis.__nextImagePath = srcFile;
        const t = Date.now();
        const r = await showMapSelectDialog(null, outFolder, '地図画像');
        return {
          r, outFolder, elapsed: Date.now() - t,
          sentinelSurvived: await exists(nodePath.join(outFolder, SENTINEL)),
        };
      }

      // --- AC6 RED 相当 + AC10: 既定の 512 相当ではメモリ不足を事前判定して弾く ---
      resetLimits();
      SettingsService.set('jpegDecodeMaxMemoryMB', 512);   // jpeg-js 既定と同じ＝下限
      const memCase = await upload('ac10-mem', bigJpg);
      okB('AC10 メモリ不足を事前判定し jpeg_memory_limit を返す（48 MP / 上限 512）', () => {
        assert.equal(memCase.r.errorCode, 'jpeg_memory_limit', JSON.stringify(memCase.r));
        assert.equal(memCase.r.configuredMB, 512);
        assert.equal(assertPredictionShape(memCase.r, 'AC10'), 'present');
        assert.equal(memCase.r.prediction.requiredMemoryMB, bigBudget.requiredMemoryMB);
        assert.equal(memCase.r.prediction.recommendedMemoryMB, bigBudget.recommendedMemoryMB);
      });
      okB('AC10 原寸デコードもタイル化も開始していない（番兵が残る・時間では判定しない）', () => {
        assert.equal(memCase.sentinelSurvived, true,
          '事前判定で弾いた場合、imageCutter は outFolder のクリアにも到達しない'
          + '（＝既存の下書きタイルを壊さない）');
      });

      // --- AC6 GREEN 相当 + AC12 + AC3: 推奨値をそのまま設定すると1回で通り、生成物も揃う ---
      SettingsService.set('jpegDecodeMaxMemoryMB', memCase.r.prediction.recommendedMemoryMB);
      const memRetry = await upload('ac12-mem-retry', bigJpg);
      okB('AC12 推奨メモリ値（' + memCase.r.prediction.recommendedMemoryMB
        + ' MB）をそのまま設定すると1回で通る（48 MP）', () => {
        assert.ok(!memRetry.r.err, '成功する: ' + JSON.stringify(memRetry.r));
        assert.equal(memRetry.r.width, 8000);
        assert.equal(memRetry.r.height, 6000);
        assert.equal(memRetry.r.imageExtension, 'jpg');
        // 番兵チェックが「常に真」になっていないことの担保: 成功経路では消える
        assert.equal(memRetry.sentinelSurvived, false,
          '取り込みが進めば imageCutter が outFolder をクリアするので番兵は消える');
      });
      await (async () => {
        // AC3: 生成物が揃う（maxZoom = ceil(log2(8000/256)) = 5）
        try {
          await assertArtifacts(memRetry.outFolder, 'jpg', 5, 'AC3 48 MP');
          console.log('ok: AC3 生成物が揃う（48 MP・タイル化 ' + (memRetry.elapsed / 1000).toFixed(1) + 's）');
        } catch (e) {
          failures.push(e.message ?? String(e)); console.log('NG: ' + (e.message ?? String(e)));
        }
      })();

      // --- AC11: 解像度不足も同様に事前判定で弾く（デコードしないので即座に返る） ---
      resetLimits();
      SettingsService.set('jpegDecodeMaxResolutionMP', 100);   // jpeg-js 既定と同じ＝下限
      const resCase = await upload('ac11-res', hugeJpg);
      okB('AC11 解像度不足を事前判定し jpeg_resolution_limit を返す（110 MP / 上限 100）', () => {
        assert.equal(resCase.r.errorCode, 'jpeg_resolution_limit', JSON.stringify(resCase.r));
        assert.equal(resCase.r.configuredMP, 100);
        assert.equal(assertPredictionShape(resCase.r, 'AC11'), 'present');
        assert.equal(resCase.r.prediction.megapixels, 110);
        assert.equal(resCase.r.prediction.recommendedResolutionMP, 110,
          'ceil(110) = 110。マージンを乗せない（v2.3）');
      });
      okB('AC11 原寸デコードもタイル化も開始していない（番兵が残る）', () => {
        assert.equal(resCase.sentinelSurvived, true);
      });

      // --- AC12b + v1.3 の 110 MP 回帰: 推奨解像度（マージン無し）で1回で通る ---
      SettingsService.set('jpegDecodeMaxResolutionMP', resCase.r.prediction.recommendedResolutionMP);
      SettingsService.set('jpegDecodeMaxMemoryMB', hugeBudget.recommendedMemoryMB);
      const resRetry = await upload('ac12b-res-retry', hugeJpg);
      okB('AC12b 推奨解像度値 ceil(megapixels)=110（マージン無し）で1回で通る（110 MP）', () => {
        assert.ok(!resRetry.r.err, '成功する: ' + JSON.stringify(resRetry.r));
        assert.equal(resRetry.r.width, 11000);
        assert.equal(resRetry.r.height, 10000);
      });
      await (async () => {
        try {
          await assertArtifacts(resRetry.outFolder, 'jpg', 6, 'AC3 110 MP');
          console.log('ok: AC3 生成物が揃う（110 MP・タイル化 ' + (resRetry.elapsed / 1000).toFixed(1) + 's）');
        } catch (e) {
          failures.push(e.message ?? String(e)); console.log('NG: ' + (e.message ?? String(e)));
        }
      })();

      const smallJpg = nodePath.join(workDir, 'small.jpg');
      await makeFixture(1200, 900, smallJpg);

      // --- AC13: 予測できない失敗は errorCode unknown（prediction を持たない） ---
      resetLimits();
      const brokenJpg = nodePath.join(workDir, 'broken.jpg');
      {
        // SOF は読めるが entropy data が壊れている JPEG（予測は立つがデコードは失敗する）
        const good = await fs.readFile(smallJpg);
        const broken = Buffer.from(good);
        broken.fill(0x00, Math.floor(broken.length * 0.6));
        await fs.writeFile(brokenJpg, broken);
      }
      {
        const outFolder = nodePath.join(workDir, 'ac13-unknown');
        await fs.mkdir(outFolder, { recursive: true });
        globalThis.__nextImagePath = brokenJpg;
        const r = await showMapSelectDialog(null, outFolder, '地図画像');
        okB('AC13 上限起因でない失敗は errorCode unknown で、prediction を持たない', () => {
          assert.ok(r.err, '失敗する: ' + JSON.stringify(r));
          assert.equal(r.errorCode, 'unknown', JSON.stringify(r));
          assert.equal(assertPredictionShape(r, 'AC13'), 'absent');
        });
      }

      // --- AC14: Canceled は従来どおり ---
      {
        const outFolder = nodePath.join(workDir, 'ac14-cancel');
        await fs.mkdir(outFolder, { recursive: true });
        globalThis.__nextImagePath = null;   // showOpenDialog が canceled を返す
        const r = await showMapSelectDialog(null, outFolder, '地図画像');
        okB('AC14 Canceled は err のみで errorCode を付けない', () => {
          assert.equal(r.err, 'Canceled');
          assert.equal(r.errorCode, undefined, 'Canceled に errorCode は付かない');
          assert.equal(r.prediction, undefined);
        });
      }

      // --- AC18: 汎用エラーキーを削除していない ---
      okB('AC18 mapedit.error_image_upload（汎用の受け皿）が11ロケールすべてに残っている', () => {
        for (const lang of LOCALES) {
          const t = JSON.parse(nodeFs.readFileSync(
            nodePath.join(${JSON.stringify(projectRoot)}, 'public/locales', lang, 'translation.json'), 'utf8'));
          assert.ok(t.mapedit && typeof t.mapedit.error_image_upload === 'string' && t.mapedit.error_image_upload.length > 0,
            lang + ': mapedit.error_image_upload が残っている');
        }
      });

      resetLimits();

      // AC5: PNG 非回帰。PNG のデコードオプションにはメモリ・解像度の上限が無く（設計 §3.5）、
      // image/jpeg の options は参照されない。
      // maxZoom = ceil(log2(1200/256)) = ceil(2.23) = 3
      resetLimits();
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
