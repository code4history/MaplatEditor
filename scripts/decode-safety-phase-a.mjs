// Phase A: V8 ヒープ予測と機械安全枠
//
// 検証する受け入れ条件:
//   case 1  decoderBlocks が jpeg-js の blocksToAllocate と一致する（4:4:4 / 4:2:2 / 4:2:0）。
//        **計装した jpeg-js の実値**と突き合わせる（式の再実装で照合しない）
//   case 2  decoderHeapMB が実 Electron main の実測と ±10% で一致する
//   case 3  jpegDecodeBudget.ts が electron / electron-store / v8 のいずれも import しない
//   case 4  JPEG でない入力・SOF 不能で null（例外を投げない）— large-image-decode-limits から継承
//   case 5  resolveDecodeSafety() が heap_size_limit を実行時に読み、定数を焼き込んでいない
//   case 6  実測トリガ級（470 MP 4:4:4）が maxResolutionMP を下回る。
//        **機体依存 assert を書かない** — 期待値は heapSizeLimitMB から式で導出し、
//        470 の追加 assert は heap >= 4096 の機体でのみ行う
//
// case 3 の担保方法: Phase A と同じく electron / electron-store のエイリアスを張らず
// external のままバンドルする。間接参照があれば素の Node 実行で MODULE_NOT_FOUND になる。
// `node:v8` は Node 組み込みなので external でも解決される。∴ case 3 の v8 非依存は
// ソーステキスト assert で別途確認する（jpegDecodeBudget.ts 側の純粋性の担保）。
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'vite';
import { makeSmokeScratch } from './smoke-scratch.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await makeSmokeScratch('decode-safety-phase-a-');
const entryFile = path.join(workDir, 'phase-a.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'phase-a.mjs');

// ---- case 3: ソーステキストによる純粋性の確認（バンドル前に済ませる） ----------
{
  const src = await readFile(path.join(projectRoot, 'electron/utils/jpegDecodeBudget.ts'), 'utf8');
  for (const forbidden of ['electron', 'electron-store', 'node:v8', "from 'v8'", 'from "v8"']) {
    assert.ok(
      !src.includes(`from '${forbidden}'`) && !src.includes(`from "${forbidden}"`) && !src.includes(`require('${forbidden}')`),
      `case 3: jpegDecodeBudget.ts が ${forbidden} を import している（純粋性の契約違反）`,
    );
  }
  console.log('ok: case 3 jpegDecodeBudget.ts は electron / electron-store / v8 を import しない');
}

// ---- 計装した jpeg-js を用意する（case 1 用） ---------------------------------
// node_modules は書き換えない。decoder.js を読んで blocksToAllocate を記録する
// 1行だけを注入した複製を作り、そちらを import する。式の再実装ではなく、
// **jpeg-js 自身が計算した値**を観測する。
// pnpm の strict レイアウトでは jpeg-js は MaplatEditor の直下に現れない（jimp 経由の
// 推移的依存）。パスを決め打ちせず、jimp の解決基点から Node の解決規則で引く。
const requireFromHere = createRequire(import.meta.url);
const decoderPath = createRequire(requireFromHere.resolve('jimp/package.json')).resolve('jpeg-js/lib/decoder.js');
const decoderSrc = await readFile(decoderPath, 'utf8');
const NEEDLE = 'var blocksToAllocate = blocksPerColumnForMcu * blocksPerLineForMcu;';
assert.ok(
  decoderSrc.includes(NEEDLE),
  `計装点が見つからない（jpeg-js の実装が変わった可能性）: ${NEEDLE}`,
);
const instrumentedSrc = decoderSrc.replace(
  NEEDLE,
  `${NEEDLE}\n            (globalThis.__fxBlocks || (globalThis.__fxBlocks = [])).push(blocksToAllocate);`,
);
const instrumentedPath = path.join(workDir, 'jpeg-js-decoder-instrumented.cjs');
await writeFile(instrumentedPath, instrumentedSrc);

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import v8 from 'node:v8';
    import { createRequire } from 'node:module';
    import { Jimp } from 'jimp';
    import { estimateJpegDecodeBudget } from ${JSON.stringify(path.join(projectRoot, 'electron/utils/jpegDecodeBudget.ts'))};
    import { resolveDecodeSafety } from ${JSON.stringify(path.join(projectRoot, 'electron/utils/decodeSafety.ts'))};

    const require_ = createRequire(${JSON.stringify(instrumentedPath)});
    const instrumentedDecoder = require_(${JSON.stringify(instrumentedPath)});

    const failures = [];
    const check = (label, fn) => {
      try { fn(); console.log('ok: ' + label); }
      catch (e) { failures.push(label + ' — ' + (e.message ?? String(e))); console.log('NG: ' + label + ' — ' + (e.message ?? String(e))); }
    };

    /** SOF ヘッダだけを持つ最小の JPEG 断片（Phase A と同一実装） */
    function synthSofHeader(w, h, comps, marker = 0xC0) {
      const n = comps.length;
      const segLen = 8 + n * 3;
      const buf = Buffer.alloc(2 + 2 + segLen);
      buf.writeUInt16BE(0xFFD8, 0);
      buf.writeUInt16BE(0xFF00 | marker, 2);
      buf.writeUInt16BE(segLen, 4);
      buf.writeUInt8(8, 6);
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

    /**
     * 計装した jpeg-js に SOF を読ませ、**jpeg-js 自身が算出した** blocksToAllocate を回収する。
     * SOF 断片は SOS を持たないため parse は必ず throw するが、ブロック確保は SOF 処理の
     * 時点で済んでいるため観測できる（decoder.js:595-613）。
     */
    function observeBlocks(buf) {
      globalThis.__fxBlocks = [];
      try {
        // decoder.js の module.exports は decode 関数そのもの（実読で確認）。
        // decode → decoder.parse の中で SOF 処理が走り、ブロックが確保される。
        instrumentedDecoder(new Uint8Array(buf), {
          maxMemoryUsageInMB: 1e9, maxResolutionInMP: 1e9, tolerantDecoding: true,
        });
      } catch { /* SOS が無いので必ず落ちる。ブロック確保は済んでいる */ }
      const observed = globalThis.__fxBlocks.slice();
      globalThis.__fxBlocks = [];
      return observed;
    }

    // ---- case 1: decoderBlocks が jpeg-js の実値と一致する ---------------------
    const SAMPLINGS = [
      ['4:4:4', [{ h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 }]],
      ['4:2:2', [{ h: 2, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 }]],
      ['4:2:0', [{ h: 2, v: 2 }, { h: 1, v: 1 }, { h: 1, v: 1 }]],
    ];
    // MCU 非整列寸法を混ぜる（8/16 の倍数だけだと切り上げ処理が未検証のまま通る）
    for (const [w, h] of [[1024, 768], [1001, 751]]) {
      for (const [name, comps] of SAMPLINGS) {
        const buf = synthSofHeader(w, h, comps);
        const observed = observeBlocks(buf);
        const expectedTotal = observed.reduce((a, b) => a + b, 0);
        const budget = estimateJpegDecodeBudget(buf);
        check('case 1 ' + w + 'x' + h + ' ' + name + ' decoderBlocks = jpeg-js 実値 ' + expectedTotal, () => {
          assert.ok(budget, 'SOF を読めること');
          assert.equal(observed.length, 3, 'jpeg-js が3成分ぶん確保していること');
          assert.equal(budget.decoderBlocks, expectedTotal);
        });
      }
    }

    // ---- case 2: decoderHeapMB が実 Electron main の実測と ±10% ----------------
    // 実測表（ブロック保持中の heapUsed ピーク）
    const MEASURED = [
      [20, 109.4],
      [50, 267.4],
      [110, 583.2],
    ];
    for (const [mp, measuredMiB] of MEASURED) {
      const side = Math.round(Math.sqrt(mp * 1e6));
      const b = estimateJpegDecodeBudget(synthSofHeader(side, side, SAMPLINGS[0][1]));
      const diff = Math.abs(b.decoderHeapMB - measuredMiB) / measuredMiB;
      check('case 2 ' + mp + ' MP 4:4:4 → 予測 ' + b.decoderHeapMB + ' MiB / 実測 ' + measuredMiB + ' MiB（乖離 ' + (diff * 100).toFixed(1) + '%）', () => {
        assert.ok(diff <= 0.10, '±10% 以内であること');
      });
    }

    // ---- case 4: JPEG でない入力（large-image-decode-limits から継承。新フィールド追加で壊れていないこと）
    check('case 4-1 PNG バッファで null', async () => {
      assert.equal(estimateJpegDecodeBudget(await new Jimp({ width: 8, height: 8 }).getBuffer('image/png')), null);
    });
    check('case 4-2 空バッファで null', () => {
      assert.equal(estimateJpegDecodeBudget(Buffer.alloc(0)), null);
    });
    check('case 4-3 Buffer でない入力で null', () => {
      assert.equal(estimateJpegDecodeBudget('not a buffer'), null);
    });

    // ---- case 5: 安全枠が heap_size_limit を実行時に読む -----------------------
    const safety = resolveDecodeSafety();
    const actualHeapLimitMB = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;
    check('case 5 heapSizeLimitMB が v8.getHeapStatistics() の実測値と一致する', () => {
      assert.ok(Math.abs(safety.heapSizeLimitMB - actualHeapLimitMB) < 0.5,
        '実測 ' + actualHeapLimitMB.toFixed(1) + ' に対し ' + safety.heapSizeLimitMB);
    });
    check('case 5 maxDecoderHeapMB が heapSizeLimitMB から導出されている（0.75 − 128 MiB）', () => {
      assert.equal(safety.maxDecoderHeapMB, Math.floor(safety.heapSizeLimitMB * 0.75 - 128));
    });

    // ---- case 6: 期待値を式から導出する（機体依存 assert を書かない）
    // 最悪ケース 4:4:4 は 1 画素あたり 3/64 ブロック。1 ブロック 120 B。
    const derivedMaxMP = (safety.maxDecoderHeapMB * 1024 * 1024 / 120) * 64 / 3 / 1e6;
    check('case 6-a maxResolutionMP が maxDecoderHeapMB から式で導出された値と一致する', () => {
      assert.equal(safety.maxResolutionMP, Math.floor(derivedMaxMP));
    });
    check('case 6-b maxMemoryMB が maxResolutionMP から 4:4:4 の 22 B/px で導出されている', () => {
      assert.equal(safety.maxMemoryMB, Math.floor(safety.maxResolutionMP * 1e6 * 22 / 1024 / 1024));
    });
    if (safety.heapSizeLimitMB >= 4096) {
      check('case 6-c 実測トリガ級 470 MP が扱える（heap >= 4096 の機体でのみ課す）', () => {
        assert.ok(safety.maxResolutionMP >= 470,
          'maxResolutionMP=' + safety.maxResolutionMP + ' が 470 MP を下回る');
      });
    } else {
      console.log('skip: case 6-c 470 MP の assert（この機体の heap_size_limit は '
        + safety.heapSizeLimitMB.toFixed(1) + ' MiB で 4096 未満。実行時算出により'
        + ' 安全枠は ' + safety.maxResolutionMP + ' MP。式の整合は case 6-a/b で確認済み）');
    }

    if (failures.length > 0) {
      throw new Error('Phase A: ' + failures.length + ' 件失敗 / ' + failures.join(' / '));
    }
    console.log('Phase A (decoderHeapMB / decodeSafety): ALL PASS');
  `,
);

await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    emptyOutDir: true,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      external: ['electron', 'electron-store'],
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
