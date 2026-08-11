// M5-T6 Phase A: JPEG デコード会計量の予測ユーティリティ（設計 §5.3 / §9.1）
//
// 検証する受け入れ条件:
//   AC1  予測式が実測と一致する（予測 ≤ 実測 ≤ 予測 × 1.03）
//   AC2  実データ相当の入力（25552x18400 / 4:4:4 / 3成分）で requiredMemoryMB が 9865 を返す
//   AC3  JPEG でない・壊れた入力で null を返し例外を投げない
//   AC4  electron / electron-store に依存しない（スタブ無しでバンドルして実行する）
//
// AC4 の担保方法: このスクリプトは electron / electron-store の**エイリアスを張らず**、
// それらを external のまま vite SSR でバンドルする。対象が間接的にでも electron を
// 参照していれば、素の Node 実行時に MODULE_NOT_FOUND で落ちる。
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t6-budget-'));
const entryFile = path.join(workDir, 'phase-a.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'phase-a.mjs');

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import { Jimp } from 'jimp';
    import { estimateJpegDecodeBudget } from ${JSON.stringify(path.join(projectRoot, 'electron/utils/jpegDecodeBudget.ts'))};

    // ---- ヘルパ -------------------------------------------------------------

    /** 実行時に合成した JPEG を返す（Jimp = jpeg-js encoder。出力は常に 4:4:4 baseline） */
    async function makeJpeg(w, h) {
      const img = new Jimp({ width: w, height: h, color: 0x3366ccff });
      return await img.getBuffer('image/jpeg');
    }

    /**
     * 実際に必要な会計量を、製品と同じ経路（Jimp.fromBuffer の image/jpeg option）で
     * 二分探索して求める。「デコードが通る最小の maxMemoryUsageInMB」が実測値である。
     * jpeg-js の例外が返す "at least N" は交差時点の不足量でしかなく総量ではないため、
     * そちらからは逆算しない（設計 §5.3 と同じ理由）。
     */
    async function measureRequiredMB(buf, lo, hi) {
      const ok = async (mb) => {
        try {
          await Jimp.fromBuffer(buf, { 'image/jpeg': { maxMemoryUsageInMB: mb, maxResolutionInMP: 100000 } });
          return true;
        } catch { return false; }
      };
      assert.ok(await ok(hi), '二分探索の上限では成功するはず: ' + hi);
      assert.ok(!(await ok(lo)), '二分探索の下限では失敗するはず: ' + lo);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (await ok(mid)) hi = mid; else lo = mid;
      }
      return hi;
    }

    /** SOF ヘッダだけを持つ最小の JPEG 断片を組む（サブサンプリング処理の検証用） */
    function synthSofHeader(w, h, comps, marker = 0xC0) {
      const n = comps.length;
      const segLen = 8 + n * 3;
      const buf = Buffer.alloc(2 + 2 + segLen);
      buf.writeUInt16BE(0xFFD8, 0);            // SOI
      buf.writeUInt16BE(0xFF00 | marker, 2);   // SOFn
      buf.writeUInt16BE(segLen, 4);            // セグメント長
      buf.writeUInt8(8, 6);                    // 精度
      buf.writeUInt16BE(h, 7);
      buf.writeUInt16BE(w, 9);
      buf.writeUInt8(n, 11);
      comps.forEach((c, idx) => {
        const o = 12 + idx * 3;
        buf.writeUInt8(idx + 1, o);
        buf.writeUInt8((c.h << 4) | c.v, o + 1);
        buf.writeUInt8(0, o + 2);
      });
      return buf;
    }

    const failures = [];
    const check = (label, fn) => {
      try { fn(); console.log('ok: ' + label); }
      catch (e) { failures.push(label + ' — ' + (e.message ?? String(e))); console.log('NG: ' + label + ' — ' + (e.message ?? String(e))); }
    };

    // ---- AC3: JPEG でない・壊れた入力 --------------------------------------

    const pngBuf = await new Jimp({ width: 8, height: 8, color: 0xffffffff }).getBuffer('image/png');
    check('AC3-1 PNG バッファで null を返す（例外を投げない）', () => {
      assert.equal(estimateJpegDecodeBudget(pngBuf), null);
    });
    check('AC3-2 空バッファで null を返す', () => {
      assert.equal(estimateJpegDecodeBudget(Buffer.alloc(0)), null);
    });
    const truncated = (await makeJpeg(64, 64)).subarray(0, 4); // SOI + マーカー途中で切る
    check('AC3-3 SOF に届かない切り詰め JPEG で null を返す', () => {
      assert.equal(estimateJpegDecodeBudget(truncated), null);
    });

    // ---- AC2: 実データ相当の入力 -------------------------------------------
    // 実画像そのものは持たない。§3.7 / §3.8 と同じ入力（寸法・成分・4:4:4）を
    // SOF ヘッダとして合成し、式が 9865 を返すことを確かめる。
    check('AC2 25552x18400 / 4:4:4 / 3成分 → requiredMemoryMB = 9865', () => {
      const b = estimateJpegDecodeBudget(synthSofHeader(25552, 18400, [
        { h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 },
      ]));
      assert.ok(b, 'SOF を読めること');
      assert.equal(b.width, 25552);
      assert.equal(b.height, 18400);
      assert.equal(b.components, 3);
      assert.equal(b.requiredMemoryMB, 9865, '§3.7 の計装が示した 9864.3 MB の切り上げ');
    });

    // ---- AC1-b: サブサンプリングの重み付け（パーサ単体） --------------------
    // 利用可能なエンコーダ（Jimp = jpeg-js）は 4:4:4 しか出力しないため、
    // 4:2:2 / 4:2:0 の end-to-end 実測はできない。式のサブサンプリング処理は
    // SOF ヘッダ合成で検証する（デコードは伴わない）。
    const BPX = (comps) => {
      const w = 4000, h = 4000, px = w * h;
      const b = estimateJpegDecodeBudget(synthSofHeader(w, h, comps));
      return (b.requiredMemoryMB * 1024 * 1024) / px;
    };
    check('AC1-b1 4:4:4 の実効値が 22 B/px', () => {
      const v = BPX([{ h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 }]);
      assert.ok(Math.abs(v - 22) < 0.05, '実測 22 B/px（設計 §3.8）に一致: ' + v.toFixed(3));
    });
    check('AC1-b2 4:2:2 の実効値が 17 B/px', () => {
      const v = BPX([{ h: 2, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 }]);
      assert.ok(Math.abs(v - 17) < 0.05, '設計 §3.8 の 17 B/px に一致: ' + v.toFixed(3));
    });
    check('AC1-b3 4:2:0 の実効値が 14.5 B/px', () => {
      const v = BPX([{ h: 2, v: 2 }, { h: 1, v: 1 }, { h: 1, v: 1 }]);
      assert.ok(Math.abs(v - 14.5) < 0.05, '設計 §3.8 の 14.5 B/px に一致: ' + v.toFixed(3));
    });

    // ---- AC1-a: 実 JPEG での実測突き合わせ ----------------------------------
    // MCU 非整列寸法を含める（8 の倍数だけだと端数 0 で ×1.03 の許容幅が未検証のまま通る）
    for (const [w, h] of [[1024, 768], [1001, 751]]) {
      const buf = await makeJpeg(w, h);
      const budget = estimateJpegDecodeBudget(buf);
      assert.ok(budget, 'SOF を読めること: ' + w + 'x' + h);
      const actual = await measureRequiredMB(buf, 1, budget.requiredMemoryMB * 2);
      const label = 'AC1-a ' + w + 'x' + h + ' 予測 ' + budget.requiredMemoryMB
        + ' MB ≤ 実測 ' + actual + ' MB ≤ 予測×1.03 ' + Math.ceil(budget.requiredMemoryMB * 1.03) + ' MB';
      check(label, () => {
        assert.ok(budget.requiredMemoryMB <= actual, '予測が実測を上回らない（下振れさせない）');
        assert.ok(actual <= Math.ceil(budget.requiredMemoryMB * 1.03), 'MCU 端数を +3% マージンが吸収する');
      });
    }

    // ---- 推奨値の規則（設計 §5.3 の表） ------------------------------------
    check('推奨メモリは ceil(required × 1.03)', () => {
      const b = estimateJpegDecodeBudget(synthSofHeader(4000, 3000, [
        { h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 },
      ]));
      assert.equal(b.recommendedMemoryMB, Math.ceil(b.requiredMemoryMB * 1.03));
    });
    check('推奨解像度は ceil(megapixels)（マージンを乗せない・v2.3）', () => {
      const b = estimateJpegDecodeBudget(synthSofHeader(11000, 10000, [
        { h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 },
      ]));
      assert.equal(b.megapixels, 110);
      assert.equal(b.recommendedResolutionMP, 110);
    });

    // ---- progressive（SOF2）も読める ---------------------------------------
    check('SOF2（progressive）も読める — 実測トリガの実画像が progressive のため', () => {
      const b = estimateJpegDecodeBudget(synthSofHeader(1000, 1000, [
        { h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 },
      ], 0xC2));
      assert.ok(b, 'SOF2 を読めること');
      assert.equal(b.megapixels, 1);
    });

    if (failures.length > 0) {
      throw new Error('Phase A: ' + failures.length + ' 件失敗 / ' + failures.join(' / '));
    }
    console.log('m5-t6 Phase A (jpegDecodeBudget): ALL PASS');
  `,
);

await build({
  configFile: false,
  logLevel: 'silent',
  // AC4: electron / electron-store のエイリアスを張らない（external のまま）
  build: {
    emptyOutDir: true,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      external: ['electron', 'electron-store', '@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/],
      output: { entryFileNames: 'phase-a.mjs', format: 'es' },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 600000,
  maxBuffer: 1024 * 1024 * 8,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
