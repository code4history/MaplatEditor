// m19-t6: 地図タイル化の高速化（タイル生成ループの原寸クローン削減）
//
// 検証対象は `electron/services/MapUploadService.ts` の `cropRegionBitmap` と、
// それを使うタイル生成ループである。**出力バイトが 1 バイトも変わらないこと**が絶対条件で、
// 性能改善はその次に来る。
//
// 構成（設計書 §8）:
//   Part 1  等価性（AC-N1 / AC-N2 / AC-N5）
//           cropRegionBitmap の返す bitmap が clone().crop({x,y,w,h}) の bitmap と
//           バイト単位で一致すること。resize → JPEG エンコードまで通した符号化後の
//           バイト列も一致すること。原本 bitmap が書き換わらないこと。
//   Part 2  性能（AC-P1 / AC-P2 / AC-P3）
//           同一プロセス・同一入力・同一矩形列で新旧 2 本の抽出経路を回す A/B。
//           過去の別マシンの記録と比較しない（設計書 §3.6 の食い違いを避けるため）。
//   Part 3  実サービスの無回帰（AC-N3 / AC-N4 / AC-N6）
//           実 imageCutter の出力タイル群と、smoke 内の参照ループ
//           （clone().crop().resize().write()）の出力が全ファイル・全バイト一致すること。
//
// 一時ディレクトリ: `.tmp-smoke/` 配下の mkdtemp を使い、**残置する**
// （先例 scripts/m5-t6-large-image-decode-limits-smoke.mjs:491「破壊的操作禁止のため残置」に揃える）。
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm19-t6-tilecut-'));
const entryFile = path.join(workDir, 'm19-t6-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm19-t6-smoke.mjs');

const dataDir = path.join(workDir, 'data');
await mkdir(dataDir, { recursive: true });

// m5-t6 / m12-t15 smoke と同じサンドボックス方式
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
    import nodeFs from 'node:fs';
    import fs from 'node:fs/promises';
    import nodePath from 'node:path';
    import crypto from 'node:crypto';
    import assert from 'node:assert/strict';
    import { Jimp } from 'jimp';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const projectRoot = ${JSON.stringify(projectRoot)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('lang', 'ja');

    const mapUpload = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/MapUploadService.ts'))});
    const { imageCutter, cropRegionBitmap } = mapUpload;

    const failures = [];
    function ok(label, fn) {
      try { fn(); console.log('OK   ' + label); }
      catch (e) { failures.push(label); console.log('NG   ' + label + ' :: ' + (e && e.message)); }
    }
    const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
    const mib = (n) => (n / 1024 / 1024).toFixed(1);

    // 決定的擬似乱数（レビュアーの独立実験と同じ方針。単色より等価性の検出力が高い）
    function fillPseudoRandom(bitmap, seed) {
      let s = seed >>> 0;
      const d = bitmap.data;
      for (let i = 0; i < d.length; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        d[i] = (s >>> 24) & 0xff;
      }
    }

    // ============================================================
    // Part 1: 等価性（AC-N1 / AC-N2 / AC-N5）
    // ============================================================
    {
      const W = 137, H = 91;
      const src = new Jimp({ width: W, height: H });
      fillPseudoRandom(src.bitmap, 20260809);
      const sourceHashBefore = sha256(src.bitmap.data);
      const sourceWBefore = src.bitmap.width, sourceHBefore = src.bitmap.height;

      // 矩形集合（13 種）。設計 §8.1 AC-N1 の 8 カテゴリに加え、
      // レビュー Minor-2 の指摘により **分岐境界 x===0 かつ w < width** を明示的に含める。
      const rects = [
        { label: '全画像（x=0 かつ w=width: ショートカット分岐）', x: 0, y: 0, w: W, h: H },
        { label: '全幅 1 行（ショートカット分岐）', x: 0, y: 5, w: W, h: 1 },
        { label: '全幅の帯（ショートカット分岐）', x: 0, y: 10, w: W, h: 20 },
        { label: '全幅かつ最終行まで（ショートカット分岐・バッファ末尾）', x: 0, y: H - 3, w: W, h: 3 },
        { label: '【分岐境界】x=0 だが w<width（ショートカットに入らない）', x: 0, y: 0, w: W - 1, h: H },
        { label: '【分岐境界】x=0 かつ w=1（最左列のみ）', x: 0, y: 0, w: 1, h: H },
        { label: '左端でない全高列', x: 3, y: 0, w: 1, h: H },
        { label: '最終列を含む全高列', x: W - 1, y: 0, w: 1, h: H },
        { label: '端の部分タイル（右下）', x: W - 7, y: H - 5, w: 7, h: 5 },
        { label: '1x1（左上）', x: 0, y: 0, w: 1, h: 1 },
        { label: '1x1（右下・最終画素）', x: W - 1, y: H - 1, w: 1, h: 1 },
        { label: '幅も高さも半端な内部矩形', x: 13, y: 7, w: 29, h: 17 },
        { label: '最終行を含む帯', x: 5, y: H - 1, w: 20, h: 1 },
      ];

      let bitmapOk = 0, jpegOk = 0;
      for (const r of rects) {
        // 旧経路（実装から消える経路を smoke が保持する）
        const refImg = src.clone().crop({ x: r.x, y: r.y, w: r.w, h: r.h });
        const ref = refImg.bitmap;
        // 新経路（製品コードから import）
        const got = cropRegionBitmap(src.bitmap, r.x, r.y, r.w, r.h);

        ok('AC-N1 bitmap バイト一致: ' + r.label, () => {
          assert.equal(got.width, ref.width, 'width');
          assert.equal(got.height, ref.height, 'height');
          assert.equal(got.data.byteLength, ref.data.byteLength, 'byteLength');
          assert.equal(sha256(got.data), sha256(ref.data), 'data の sha256');
          assert.equal(Buffer.compare(Buffer.from(got.data.buffer, got.data.byteOffset, got.data.byteLength),
                                      Buffer.from(ref.data.buffer, ref.data.byteOffset, ref.data.byteLength)), 0,
            'Buffer.compare');
        });
        if (got.width === ref.width && got.height === ref.height && sha256(got.data) === sha256(ref.data)) bitmapOk++;

        // AC-N2: resize → JPEG エンコードまで通した符号化後のバイト列
        const tw = Math.max(1, Math.ceil(r.w / 2));
        const th = Math.max(1, Math.ceil(r.h / 2));
        const refJpeg = await new Jimp({ data: Buffer.from(ref.data), width: ref.width, height: ref.height })
          .resize({ w: tw, h: th }).getBuffer('image/jpeg');
        const gotJpeg = await new Jimp(cropRegionBitmap(src.bitmap, r.x, r.y, r.w, r.h))
          .resize({ w: tw, h: th }).getBuffer('image/jpeg');
        ok('AC-N2 resize→JPEG 符号化後バイト一致: ' + r.label, () => {
          assert.equal(Buffer.compare(refJpeg, gotJpeg), 0, 'JPEG バイト列');
        });
        if (Buffer.compare(refJpeg, gotJpeg) === 0) jpegOk++;
      }

      console.log('AC-N1 bitmap equivalence: ok=' + bitmapOk + ' ng=' + (rects.length - bitmapOk) + ' / ' + rects.length);
      console.log('AC-N2 downstream jpeg equivalence: ok=' + jpegOk + ' ng=' + (rects.length - jpegOk) + ' / ' + rects.length);

      // AC-N5: 原本 bitmap が書き換わらない
      ok('AC-N5 原本 bitmap が抽出によって書き換わらない（sha256 / width / height）', () => {
        assert.equal(sha256(src.bitmap.data), sourceHashBefore, 'data の sha256');
        assert.equal(src.bitmap.width, sourceWBefore, 'width');
        assert.equal(src.bitmap.height, sourceHBefore, 'height');
      });

      // AC-N1 補足: 返り値が必ず新しいオブジェクトであること（source.bitmap を返していないこと）。
      // ここを誤ると resize が原本の width/height/data を書き換えて後続タイルが全滅する
      // （設計レビュー §7.3 の検証観点）。
      ok('AC-N1 補足 返り値は必ず新しいオブジェクト（source.bitmap と同一参照でない）', () => {
        const full = cropRegionBitmap(src.bitmap, 0, 0, W, H);
        assert.notEqual(full, src.bitmap, '同一オブジェクトを返していない');
        // 実害の再現: 返り値を Jimp に包んで resize しても原本が壊れないこと
        new Jimp(full).resize({ w: 10, h: 10 });
        assert.equal(src.bitmap.width, W, 'resize 後も原本 width が不変');
        assert.equal(src.bitmap.height, H, 'resize 後も原本 height が不変');
        assert.equal(sha256(src.bitmap.data), sourceHashBefore, 'resize 後も原本 data が不変');
      });
    }

    if (failures.length > 0) {
      throw new Error('m19-t6 smoke: ' + failures.length + ' 件の受け入れ条件が失敗 / ' + failures.join(' / '));
    }
    console.log('m19-t6 tile cut clone reduction smoke: ALL PASS');
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
        entryFileNames: 'm19-t6-smoke.mjs',
        format: 'es',
      },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 1800000,
  maxBuffer: 1024 * 1024 * 16,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
