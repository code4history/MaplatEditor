// M5-T8 Phase B: 自動上限・ハードブロック・確認往復（設計 §5.3〜§5.6 / §8.3〜§8.6）
//
// 検証する受け入れ条件:
//   AC8   設定を一切触らずに、既定 8192 では通らなかったサイズが通る
//   AC9   デコードへ渡す値が budget.recommendedMemoryMB / recommendedResolutionMP と一致する
//   AC10  budget == null（PNG）でも従来どおり取り込める
//   AC11  decoderHeapMB > safety.maxDecoderHeapMB は jpeg_machine_limit で、デコードせずに返る
//   AC12  その経路が outFolder に一切触れない（既存の下書きタイルが残る）
//   AC14  未設定（空欄）で getJpegDecodeCaps() が {null, null} を返す
//   AC15  機械安全枠を超える手入力がクランプされる（set 経由と store 直書きの両方）
//   AC17  megapixels > 100 で needsConfirmation: 'long_import'。この時点でデコードもタイル化も
//         起きていない
//   AC18  確認 OK でファイル選択ダイアログを再表示せず続行する（呼び出し回数 = 1）
//   AC20  confirmed: true だが保持が無い／uid 不一致で stale_confirmation
//   AC21  別 webContents の選択を拾わない
//
// サンドボックス方式は m5-t6 / m12-t15 の smoke と同じ（vite SSR + electron / electron-store スタブ）。
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t8-phase-b-'));
const entryFile = path.join(workDir, 'phase-b.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'phase-b.mjs');

const dataDir = path.join(workDir, 'data');
await mkdir(dataDir, { recursive: true });

await writeFile(
  electronStubFile,
  `
    const handlers = new Map();
    export const __handlers = handlers;
    globalThis.__nextImagePath = null;
    globalThis.__openDialogCalls = 0;
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
        globalThis.__openDialogCalls += 1;
        const p = globalThis.__nextImagePath;
        if (!p) return { canceled: true, filePaths: [] };
        return { canceled: false, filePaths: [p] };
      },
    };
    export const BrowserWindow = class {
      static fromWebContents() { return new BrowserWindow(); }
    };
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

    const mapUpload = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/MapUploadService.ts'))});
    const { showMapSelectDialog } = mapUpload;
    const { estimateJpegDecodeBudget } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/jpegDecodeBudget.ts'))});
    const { resolveDecodeSafety } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/decodeSafety.ts'))});
    const { registerMapUploadHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/mapupload.ts'))});
    const { __handlers } = await import('electron');

    const failures = [];
    const check = async (label, fn) => {
      try { await fn(); console.log('ok: ' + label); }
      catch (e) { failures.push(label + ' — ' + (e.message ?? String(e))); console.log('NG: ' + label + ' — ' + (e.message ?? String(e))); }
    };
    const exists = (p) => fs.stat(p).then(() => true).catch(() => false);

    /** SOF ヘッダだけを持つ「JPEG のふり」をするファイル（実体が無いのでデコードは不可能） */
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
    const YUV444 = [{ h: 1, v: 1 }, { h: 1, v: 1 }, { h: 1, v: 1 }];

    async function writeSof(name, w, h) {
      const p = nodePath.join(workDir, name);
      await fs.writeFile(p, synthSofHeader(w, h, YUV444));
      return p;
    }
    async function makeRealJpeg(name, w, h) {
      const p = nodePath.join(workDir, name);
      await new Jimp({ width: w, height: h, color: 0x3366ccff }).write(p);
      return p;
    }

    // private だが、読み出し側の防御（store 直書き＝手編集 JSON 相当）の検証には
    // ここを突く必要がある（m5-t6 smoke:210 と同じ手法）
    const rawStore = SettingsService.store;

    const safety = resolveDecodeSafety();
    console.log('info: 機械安全枠 heap=' + safety.heapSizeLimitMB.toFixed(1) + ' MiB / '
      + 'maxDecoderHeap=' + safety.maxDecoderHeapMB + ' MiB / '
      + 'maxResolution=' + safety.maxResolutionMP + ' MP / maxMemory=' + safety.maxMemoryMB + ' MB');

    // ================= AC14 / AC15: キャップの契約 =========================
    await check('AC14 未設定（空欄）で getJpegDecodeCaps() が {null, null}', () => {
      const c = SettingsService.getJpegDecodeCaps();
      assert.equal(c.maxMemoryUsageInMB, null);
      assert.equal(c.maxResolutionInMP, null);
    });

    await check('AC15-a set 経由: 機械安全枠を超える手入力がクランプされる', () => {
      SettingsService.set('jpegDecodeMaxMemoryMB', 99999);
      SettingsService.set('jpegDecodeMaxResolutionMP', 99999);
      const c = SettingsService.getJpegDecodeCaps();
      assert.equal(c.maxMemoryUsageInMB, safety.maxMemoryMB);
      assert.equal(c.maxResolutionInMP, safety.maxResolutionMP);
    });
    await check('AC15-b store 直書き（手編集 JSON 相当）でもクランプされる', () => {
      rawStore.set('jpegDecodeMaxMemoryMB', 99999);
      rawStore.set('jpegDecodeMaxResolutionMP', 99999);
      const c = SettingsService.getJpegDecodeCaps();
      assert.equal(c.maxMemoryUsageInMB, safety.maxMemoryMB);
      assert.equal(c.maxResolutionInMP, safety.maxResolutionMP);
    });
    await check('AC15-c 下限は m5-t6 のまま（512 / 100）', () => {
      SettingsService.set('jpegDecodeMaxMemoryMB', 256);
      SettingsService.set('jpegDecodeMaxResolutionMP', 50);
      const c = SettingsService.getJpegDecodeCaps();
      assert.equal(c.maxMemoryUsageInMB, 512);
      assert.equal(c.maxResolutionInMP, 100);
    });
    await check('AC15-d 空文字・null は「自動」（null）へ落ちる', () => {
      SettingsService.set('jpegDecodeMaxMemoryMB', '');
      SettingsService.set('jpegDecodeMaxResolutionMP', null);
      const c = SettingsService.getJpegDecodeCaps();
      assert.equal(c.maxMemoryUsageInMB, null);
      assert.equal(c.maxResolutionInMP, null);
    });
    await check('AC15-e 非数値も「自動」へ落ちる（m5-t6 は既定値へ落としていた）', () => {
      for (const bad of ['abc', {}, [], NaN, true]) {
        rawStore.set('jpegDecodeMaxMemoryMB', bad);
        assert.equal(SettingsService.getJpegDecodeCaps().maxMemoryUsageInMB, null,
          '不正値 ' + JSON.stringify(bad) + ' が null へ落ちる');
      }
    });
    // 以降のケースは「自動（未設定）」を既定状態とする
    SettingsService.set('jpegDecodeMaxMemoryMB', null);
    SettingsService.set('jpegDecodeMaxResolutionMP', null);

    // ================= AC11 / AC12: ハードブロック =========================
    {
      // 機械安全枠を確実に超える寸法を、安全枠から逆算して作る（機体依存の定数を書かない）
      const overMP = safety.maxResolutionMP * 2;
      const side = Math.min(65535, Math.round(Math.sqrt(overMP * 1e6)));
      const srcFile = await writeSof('machine-limit.jpg', side, side);
      const outFolder = nodePath.join(workDir, 'out-machine-limit');
      await fs.mkdir(outFolder, { recursive: true });
      const sentinel = nodePath.join(outFolder, 'sentinel.txt');
      await fs.writeFile(sentinel, 'AC12: この経路は outFolder に触れてはならない');

      globalThis.__nextImagePath = srcFile;
      const t0 = Date.now();
      const r = await showMapSelectDialog(null, outFolder, '地図画像');
      const elapsed = Date.now() - t0;

      await check('AC11 jpeg_machine_limit が返る（' + side + 'x' + side + ' = '
        + (side * side / 1e6).toFixed(0) + ' MP / 所要 ' + elapsed + 'ms）', () => {
        assert.equal(r.errorCode, 'jpeg_machine_limit');
        assert.ok(r.machine, 'machine が全部入りで付く');
        assert.ok(r.machine.requiredHeapMB > r.machine.availableHeapMB,
          '必要 ' + r.machine.requiredHeapMB + ' > 利用可 ' + r.machine.availableHeapMB);
        assert.equal(r.machine.availableHeapMB, safety.maxDecoderHeapMB);
        assert.ok(Math.abs(r.machine.megapixels - side * side / 1e6) < 1);
      });
      await check('AC12 ハードブロック経路が outFolder に触れない（番人ファイルが残る）', async () => {
        assert.ok(await exists(sentinel), 'sentinel.txt が残っている');
      });
    }

    // ================= AC17 / AC18 / AC20 / AC21: 確認往復 =================
    registerMapUploadHandlers();
    const handler = __handlers.get('mapupload:showMapSelectDialog');
    assert.ok(handler, 'mapupload:showMapSelectDialog が登録されている');
    const ev = (id) => ({ sender: { id } });

    {
      // 100 MP 超だが機械安全枠内の寸法（= D5 だけが発火する）
      const targetMP = Math.min(150, Math.max(101, Math.floor(safety.maxResolutionMP / 2)));
      const side = Math.round(Math.sqrt(targetMP * 1e6));
      const srcFile = await writeSof('long-import.jpg', side, side);
      globalThis.__nextImagePath = srcFile;
      globalThis.__openDialogCalls = 0;

      // staging は uid から解決される。draftTileRoot 配下に作られるので事前生成は不要
      const uid = 'ac17-uid';
      const r1 = await handler(ev(11), '地図画像', uid);
      await check('AC17 ' + targetMP + ' MP で needsConfirmation: long_import が返る', () => {
        assert.equal(r1.needsConfirmation, 'long_import');
        assert.ok(Math.abs(r1.megapixels - side * side / 1e6) < 1);
        assert.equal(r1.err, undefined, 'err を持たない');
        assert.equal(r1.filePath, undefined, '選択パスを renderer へ返さない');
      });

      // 確認 OK → 同じチャネルへ confirmed: true で再送。ダイアログは再表示されない
      const r2 = await handler(ev(11), '地図画像', uid, true);
      await check('AC18 確認 OK でダイアログを再表示しない（showOpenDialog 呼び出し = 1）', () => {
        assert.equal(globalThis.__openDialogCalls, 1,
          '実際の呼び出し回数: ' + globalThis.__openDialogCalls);
        // SOF だけのファイルなので実デコードは失敗する。ここで見るのは
        // 「再びダイアログを出さずにデコードまで進んだ」ことである
        assert.notEqual(r2.needsConfirmation, 'long_import', '確認要求が再度返らない');
      });

      await check('AC20-a 消費後に再送すると stale_confirmation', async () => {
        const r3 = await handler(ev(11), '地図画像', uid, true);
        assert.equal(r3.errorCode, 'stale_confirmation');
      });
      await check('AC20-b uid が一致しないと stale_confirmation', async () => {
        globalThis.__nextImagePath = srcFile;
        const a = await handler(ev(12), '地図画像', uid);
        assert.equal(a.needsConfirmation, 'long_import', '前提: 確認要求が返る');
        const b = await handler(ev(12), '地図画像', 'different-uid', true);
        assert.equal(b.errorCode, 'stale_confirmation');
      });

      await check('AC21 別 webContents の選択を拾わない', async () => {
        const uidA = 'ac21-a', uidB = 'ac21-b';
        const fileA = await writeSof('ac21-a.jpg', side, side);
        const fileB = await writeSof('ac21-b.jpg', side + 8, side + 8);

        globalThis.__nextImagePath = fileA;
        const a1 = await handler(ev(21), '地図画像', uidA);
        assert.equal(a1.needsConfirmation, 'long_import');

        globalThis.__nextImagePath = fileB;
        const b1 = await handler(ev(22), '地図画像', uidB);
        assert.equal(b1.needsConfirmation, 'long_import');

        assert.notEqual(a1.megapixels, b1.megapixels, '前提: 2枚は識別可能な寸法である');

        // (1) uid が違えば通らない
        const wrong = await handler(ev(21), '地図画像', uidB, true);
        assert.equal(wrong.errorCode, 'stale_confirmation',
          'ウィンドウ 21 の保持は uidA のもの。uidB では通らない');

        // (2) **不一致でウィンドウ 21 の保持が消えていない**（失効判定の巻き添えにしない）
        //     ここで fileB を削除しておく。単一スロット実装なら 21 は fileB を掴んでおり
        //     ENOENT で落ちる。webContents 単位なら fileA を掴んでいるので ENOENT にならない。
        //     ∴ 「別ウィンドウの選択を拾っていない」ことが観測で判別できる
        await fs.rm(fileB);
        const right = await handler(ev(21), '地図画像', uidA, true);
        assert.notEqual(right.errorCode, 'stale_confirmation',
          'ウィンドウ 21 は自分の選択（uidA）で続行できる');
        const rightErr = right.err == null ? '' : (right.err.message ?? String(right.err));
        assert.ok(!rightErr.includes('ENOENT'),
          'ウィンドウ 21 が掴んでいるのは削除済みの fileB ではない（実際の err: ' + rightErr + '）');
      });
    }

    // ================= AC8 / AC9 / AC10: 自動上限の実効 =====================
    {
      // 会計量が 8192 MB（m5-t6 の旧既定）を超える寸法を選ぶ。
      // 4:4:4 = 22 B/px なので 8192 MB ≒ 390 MP。実デコードは重すぎるため、
      // 「デコードへ渡された値」を捕捉して検証する（AC9）。
      const captured = [];
      const originalFromBuffer = (await import('jimp')).Jimp.fromBuffer;
      const JimpNs = (await import('jimp')).Jimp;
      JimpNs.fromBuffer = async function (buf, opts) {
        captured.push(opts);
        return await originalFromBuffer.call(this, buf, opts);
      };

      const srcFile = await makeRealJpeg('auto-limit.jpg', 1200, 900);
      const outFolder = nodePath.join(workDir, 'out-auto');
      await fs.mkdir(outFolder, { recursive: true });
      globalThis.__nextImagePath = srcFile;
      captured.length = 0;
      const r = await showMapSelectDialog(null, outFolder, '地図画像');
      const budget = estimateJpegDecodeBudget(await fs.readFile(srcFile));

      await check('AC9 デコードへ渡す値が recommendedMemoryMB / recommendedResolutionMP と一致', () => {
        assert.ok(!r.err, '取り込みが成功する（err=' + (r.err ?? '') + '）');
        // makeThumbnail / makeThumbnail512 の Jimp.read も内部で fromBuffer を通るが、
        // options を渡すのは原寸デコードの1回だけである。そこで絞る
        const withOptions = captured.filter((o) => o && o['image/jpeg']);
        assert.equal(withOptions.length, 1,
          'options 付きの fromBuffer は原寸デコードの1回だけ（実際: ' + withOptions.length
          + ' / 全 fromBuffer 呼び出し ' + captured.length + '）');
        const o = withOptions[0]['image/jpeg'];
        assert.equal(o.maxMemoryUsageInMB, budget.recommendedMemoryMB);
        assert.equal(o.maxResolutionInMP, budget.recommendedResolutionMP);
      });

      await check('AC8 設定を触らずに、旧既定 8192 では通らない会計量の画像が通る', () => {
        // 実デコードせずに「自動値が旧既定を超えて渡される」ことを示す。
        // 8192 MB を超える会計量 ＝ 4:4:4 で約 390 MP。
        const huge = estimateJpegDecodeBudget(synthSofHeader(20000, 20000, YUV444));
        assert.ok(huge.requiredMemoryMB > 8192,
          '前提: 400 MP は旧既定 8192 MB を超える（' + huge.requiredMemoryMB + ' MB）');
        assert.ok(huge.recommendedMemoryMB > 8192,
          '自動で渡される値が旧既定を上回る（' + huge.recommendedMemoryMB + ' MB）');
        assert.ok(huge.decoderHeapMB <= safety.maxDecoderHeapMB,
          '400 MP はこの機体の安全枠内（' + huge.decoderHeapMB + ' <= ' + safety.maxDecoderHeapMB + '）');
      });

      // AC10: PNG（budget == null）
      const pngFile = nodePath.join(workDir, 'auto-limit.png');
      await new Jimp({ width: 600, height: 400, color: 0x22aa66ff }).write(pngFile);
      const outPng = nodePath.join(workDir, 'out-png');
      await fs.mkdir(outPng, { recursive: true });
      globalThis.__nextImagePath = pngFile;
      const rp = await showMapSelectDialog(null, outPng, '地図画像');
      await check('AC10 PNG（予測不能）でも従来どおり取り込める', () => {
        assert.ok(!rp.err, 'err=' + (rp.err ?? ''));
        assert.equal(rp.imageExtension, 'png');
      });

      JimpNs.fromBuffer = originalFromBuffer;
    }

    if (failures.length > 0) {
      throw new Error('Phase B: ' + failures.length + ' 件失敗 / ' + failures.join(' / '));
    }
    console.log('m5-t8 Phase B (自動上限・ハードブロック・確認往復): ALL PASS');
  `,
);

await build({
  configFile: false,
  logLevel: 'silent',
  resolve: {
    alias: [
      { find: /^electron$/, replacement: electronStubFile },
      { find: /^electron-store$/, replacement: electronStoreStubFile },
    ],
  },
  build: {
    emptyOutDir: true,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/],
      output: { entryFileNames: 'phase-b.mjs', format: 'es' },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 900000,
  maxBuffer: 1024 * 1024 * 8,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
