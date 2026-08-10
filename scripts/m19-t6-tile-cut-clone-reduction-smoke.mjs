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

    // ============================================================
    // Part 2: 性能（AC-P1 / AC-P2 / AC-P3）
    //
    // 同一プロセス・同一入力・同一矩形列で新旧 2 本の抽出経路を回す A/B。
    // 過去の別マシンの記録（FUTURE_PLAN §6 の 41 秒 / m5-t6 smoke ヘッダの約 65 秒）は
    // 1.6〜1.8 倍食い違っているため、しきい値の基礎に使わない（設計書 §3.6）。
    //
    // フィクスチャ 4096x4096: 幅が 256 の 2 冪倍ちょうどのため最低ズームがショートカット分岐に
    // 入り、ピーク比が実装に対して決定的になる。
    // ============================================================
    {
      const W = 4096, H = 4096;
      const src = new Jimp({ width: W, height: H, color: 0x3366ccff });
      const fullBytes = src.bitmap.data.byteLength;

      // imageCutter と同一の式で構築したタスクリスト（ファイル書き出しはしない）
      const maxZoom = Math.ceil(Math.log(Math.max(W, H) / 256) / Math.log(2));
      const rects = [];
      for (let z = maxZoom; z >= 0; z--) {
        const pw = Math.round(W / Math.pow(2, maxZoom - z));
        const ph = Math.round(H / Math.pow(2, maxZoom - z));
        for (let tx = 0; tx * 256 < pw; tx++) {
          const sx = tx * 256 * Math.pow(2, maxZoom - z);
          const sw = (tx + 1) * 256 * Math.pow(2, maxZoom - z) > W ? W - sx : 256 * Math.pow(2, maxZoom - z);
          for (let ty = 0; ty * 256 < ph; ty++) {
            const sy = ty * 256 * Math.pow(2, maxZoom - z);
            const sh = (ty + 1) * 256 * Math.pow(2, maxZoom - z) > H ? H - sy : 256 * Math.pow(2, maxZoom - z);
            rects.push([sx, sy, sw, sh]);
          }
        }
      }

      // --- 旧腕: imageJimp.clone().crop({x,y,w,h}) ---
      let oldMs = 0n, oldAlloc = 0, oldPeak = 0, oldPeakExternal = 0, oldPeakRss = 0;
      for (const r of rects) {
        const t0 = process.hrtime.bigint();
        const cloned = src.clone();
        // crop は bitmap をその場で書き換えて同じ image を返すため、クローンの ArrayBuffer は
        // **crop の前に**控えておく（後で見ると必ず crop 後の値になり、view 判定が常に真になる）
        const clonedArrayBuffer = cloned.bitmap.data.buffer;
        const cropped = cloned.crop({ x: r[0], y: r[1], w: r[2], h: r[3] });
        oldMs += process.hrtime.bigint() - t0;
        // 新規確保の会計: clone は必ず原寸ぶんの新規 Buffer。crop はショートカット時のみ view。
        const cloneBytes = fullBytes;
        const viewOfClone = cropped.bitmap.data.buffer === clonedArrayBuffer;
        const cropBytes = viewOfClone ? 0 : cropped.bitmap.data.byteLength;
        oldAlloc += cloneBytes + cropBytes;
        const live = fullBytes + cloneBytes + cropBytes;
        if (live > oldPeak) {
          oldPeak = live;
          const m = process.memoryUsage();
          oldPeakExternal = m.external; oldPeakRss = m.rss;
        }
      }

      // --- 新腕: cropRegionBitmap(imageJimp.bitmap, x, y, w, h)（製品コードから import） ---
      let newMs = 0n, newAlloc = 0, newPeak = 0, newPeakExternal = 0, newPeakRss = 0;
      for (const r of rects) {
        const t0 = process.hrtime.bigint();
        const bm = cropRegionBitmap(src.bitmap, r[0], r[1], r[2], r[3]);
        newMs += process.hrtime.bigint() - t0;
        const viewOfSource = bm.data.buffer === src.bitmap.data.buffer;
        const allocBytes = viewOfSource ? 0 : bm.data.byteLength;
        newAlloc += allocBytes;
        const live = fullBytes + allocBytes;
        if (live > newPeak) {
          newPeak = live;
          const m = process.memoryUsage();
          newPeakExternal = m.external; newPeakRss = m.rss;
        }
      }

      const oldMsNum = Number(oldMs / 1000000n), newMsNum = Number(newMs / 1000000n);
      console.log('AC-P 計測 フィクスチャ ' + W + 'x' + H + '（原寸 RGBA ' + mib(fullBytes) + ' MiB, '
        + 'maxZoom ' + maxZoom + ', タイル数 ' + rects.length + '）');
      console.log('AC-P1 抽出のみの所要時間        : 旧 ' + oldMsNum + ' ms / 新 ' + newMsNum + ' ms'
        + '（比 ' + (newMsNum > 0 ? (oldMsNum / newMsNum).toFixed(1) : 'inf') + ' 倍）');
      console.log('AC-P2 抽出のための新規確保 累計 : 旧 ' + mib(oldAlloc) + ' MiB / 新 ' + mib(newAlloc) + ' MiB'
        + '（比 ' + (newAlloc > 0 ? (oldAlloc / newAlloc).toFixed(1) : 'inf') + ' 倍）');
      console.log('AC-P3 抽出時のピーク live（会計）: 旧 ' + mib(oldPeak) + ' MiB / 新 ' + mib(newPeak) + ' MiB'
        + '（比 ' + (newPeak / oldPeak).toFixed(3) + '）');
      console.log('AC-P 副次記録（しきい値なし・GC 依存）: '
        + '旧 external ' + mib(oldPeakExternal) + ' MiB / rss ' + mib(oldPeakRss) + ' MiB, '
        + '新 external ' + mib(newPeakExternal) + ' MiB / rss ' + mib(newPeakRss) + ' MiB');

      ok('AC-P1 抽出のみの所要時間が 5 倍以上短縮（new_ms * 5 <= old_ms）', () => {
        assert.ok(newMsNum * 5 <= oldMsNum, '旧 ' + oldMsNum + ' ms / 新 ' + newMsNum + ' ms');
      });
      ok('AC-P2 抽出のための新規確保 累計が 20 倍以上削減（new_alloc * 20 <= old_alloc）', () => {
        assert.ok(newAlloc * 20 <= oldAlloc, '旧 ' + mib(oldAlloc) + ' MiB / 新 ' + mib(newAlloc) + ' MiB');
      });
      ok('AC-P3 抽出時のピーク live が 0.75 倍以下（new_peak <= old_peak * 0.75）', () => {
        assert.ok(newPeak <= oldPeak * 0.75, '旧 ' + mib(oldPeak) + ' MiB / 新 ' + mib(newPeak) + ' MiB');
      });
    }

    // ============================================================
    // Part 4: 圧縮元バッファの解放（AC-P4）
    //
    // 本項が保証するのは「Jimp.fromBuffer 以降に圧縮元バッファへの参照を残さないコード形状」
    // までである（jpeg-js が入力 Buffer への参照を内部に保持しないことまでは検証していない。
    // 設計レビュー v1 Minor-4）。
    // ============================================================
    {
      const servicePath = nodePath.join(projectRoot, 'electron/services/MapUploadService.ts');
      const lines = nodeFs.readFileSync(servicePath, 'utf8').split('\\n');
      const fromBufferLine = lines.findIndex((l) => l.includes('Jimp.fromBuffer(sourceBuffer'));
      // 行コメント内の言及は「参照」ではないので落とす（コード上の参照だけを数える）
      const stripComment = (l) => l.replace(/\\/\\/.*$/, '');
      const after = lines
        .map((l, i) => ({ n: i + 1, l }))
        .filter((e) => e.n > fromBufferLine + 1 && /\\bsourceBuffer\\b/.test(stripComment(e.l)));
      ok('AC-P4 Jimp.fromBuffer より後に現れる sourceBuffer は解放行 1 行のみ', () => {
        assert.ok(fromBufferLine >= 0, 'Jimp.fromBuffer(sourceBuffer の行が見つかる');
        assert.equal(after.length, 1, '後続の出現: ' + JSON.stringify(after));
        assert.match(after[0].l, /sourceBuffer = Buffer\\.alloc\\(0\\)/, '解放行である: ' + after[0].l);
      });
      console.log('AC-P4 観測: Jimp.fromBuffer は ' + (fromBufferLine + 1) + ' 行目、'
        + '後続の sourceBuffer 出現は ' + after.map((e) => e.n).join(',') + ' 行目のみ');
    }

    // ============================================================
    // Part 3: 実サービスの無回帰（AC-N3 / AC-N4 / AC-N6）
    //
    // 実 imageCutter の出力タイル群と、smoke 内の参照ループ
    // （旧経路 clone().crop().resize().write()）の出力を全ファイル・全バイト比較する。
    // このテストは「置換前後で出力が変わらない」ことの番人であり、**置換前から緑である**のが正しい。
    // ============================================================
    {
      const W = 1400, H = 900;   // maxZoom 3 / 33 タイル。thumbnail_512.webp 経路が走る最小規模
      const ext = 'jpg';
      const fixtureDir = nodePath.join(workDir, 'part3');
      await fs.mkdir(fixtureDir, { recursive: true });
      const srcFile = nodePath.join(fixtureDir, 'fixture.' + ext);

      {
        const img = new Jimp({ width: W, height: H });
        fillPseudoRandom(img.bitmap, 987654321);
        await img.write(srcFile);
      }

      // --- AC-N6: ProgressReporter.prototype.update を spy する ---
      // 設計書 §8.1 は webContents.send の**回数**を数える記述だったが、ProgressReporter は
      // 5% 刻み + 30 秒 heartbeat で送信を throttle するため send 回数 != update 回数である。
      // さらに heartbeat は実時間依存であり、本タスクは実行時間そのものを変える。
      // ∴ 回数は update の spy で数え、send の記録は**内容**の確認にのみ使う
      //（設計レビュー v1 Major-1 の訂正）。
      const { ProgressReporter } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/ProgressReporter.ts'))});
      const updateArgs = [];
      const originalUpdate = ProgressReporter.prototype.update;
      ProgressReporter.prototype.update = function (...args) {
        updateArgs.push(args);
        return originalUpdate.apply(this, args);
      };
      const sendRecords = [];
      const fakeWin = { webContents: { send: (channel, payload) => sendRecords.push({ channel, payload }) } };

      // --- 実 imageCutter（検証対象の実経路） ---
      const outA = nodePath.join(fixtureDir, 'actual');
      const result = await imageCutter(fakeWin, srcFile, outA);
      ProgressReporter.prototype.update = originalUpdate;

      ok('AC-N3 前提 imageCutter が成功する', () => {
        assert.equal(result.err, undefined, JSON.stringify(result));
        assert.equal(result.width, W);
        assert.equal(result.height, H);
        assert.equal(result.imageExtension, ext);
      });

      // --- 参照ループ（旧経路。実装から消える clone().crop().resize() を smoke が保持する） ---
      const outB = nodePath.join(fixtureDir, 'reference');
      await fs.mkdir(outB, { recursive: true });
      const refImage = await Jimp.read(srcFile);
      const refW = refImage.width, refH = refImage.height;
      const maxZoom = Math.ceil(Math.log(Math.max(refW, refH) / 256) / Math.log(2));
      // タスクリスト構築式は MapUploadService の実装と同一（旧腕の定義そのもの）
      const refTasks = [];
      for (let z = maxZoom; z >= 0; z--) {
        const pw = Math.round(refW / Math.pow(2, maxZoom - z));
        const ph = Math.round(refH / Math.pow(2, maxZoom - z));
        for (let tx = 0; tx * 256 < pw; tx++) {
          const tw = (tx + 1) * 256 > pw ? pw - tx * 256 : 256;
          const sx = tx * 256 * Math.pow(2, maxZoom - z);
          const sw = (tx + 1) * 256 * Math.pow(2, maxZoom - z) > refW ? refW - sx : 256 * Math.pow(2, maxZoom - z);
          const tileDir = nodePath.resolve(outB, String(z), String(tx));
          await fs.mkdir(tileDir, { recursive: true });
          for (let ty = 0; ty * 256 < ph; ty++) {
            const th = (ty + 1) * 256 > ph ? ph - ty * 256 : 256;
            const sy = ty * 256 * Math.pow(2, maxZoom - z);
            const sh = (ty + 1) * 256 * Math.pow(2, maxZoom - z) > refH ? refH - sy : 256 * Math.pow(2, maxZoom - z);
            refTasks.push([nodePath.resolve(tileDir, ty + '.' + ext), sx, sy, sw, sh, tw, th]);
          }
        }
      }
      // 分岐網羅の確認（設計レビュー §7.3 の検証観点）: crop の両分岐を実際に踏んでいること
      const shortcutCount = refTasks.filter((t) => t[1] === 0 && t[3] === refW).length;
      const nonShortcutCount = refTasks.length - shortcutCount;
      ok('AC-N3 前提 実タスクリストが crop の両分岐を踏む（ショートカット / 非ショートカット）', () => {
        assert.ok(shortcutCount > 0, 'ショートカット分岐 (x=0 && w=width) が ' + shortcutCount + ' 件');
        assert.ok(nonShortcutCount > 0, '非ショートカット分岐が ' + nonShortcutCount + ' 件');
      });
      for (const t of refTasks) {
        const canvasJimp = refImage.clone()
          .crop({ x: t[1], y: t[2], w: t[3], h: t[4] })
          .resize({ w: t[5], h: t[6] });
        await canvasJimp.write(t[0]);
      }

      // --- AC-N3: タイル群の全ファイル・全バイト一致 ---
      async function tileManifest(root) {
        const out = [];
        async function walk(dir, rel) {
          for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
            const p = nodePath.join(dir, e.name);
            const r = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory()) await walk(p, r);
            else if (/^\\d+\\/\\d+\\/\\d+\\.[a-z]+$/.test(r)) out.push(r + ':' + sha256(await fs.readFile(p)));
          }
        }
        await walk(root, '');
        out.sort();
        return out;
      }
      const manA = await tileManifest(outA);
      const manB = await tileManifest(outB);
      ok('AC-N3 タイルの相対パス集合が一致する（' + manA.length + ' 枚）', () => {
        assert.deepEqual(manA.map((s) => s.split(':')[0]), manB.map((s) => s.split(':')[0]));
        assert.equal(manA.length, refTasks.length, 'タイル数 = タスク数');
      });
      let mismatches = 0;
      for (let i = 0; i < Math.min(manA.length, manB.length); i++) if (manA[i] !== manB[i]) mismatches++;
      ok('AC-N3 全タイルの sha256 が一致する（旧経路の出力とバイト単位で同一）', () => {
        assert.equal(mismatches, 0, mismatches + ' 枚が不一致');
        assert.equal(sha256(Buffer.from(manA.join('\\n'))), sha256(Buffer.from(manB.join('\\n'))));
      });
      const manifestHash = sha256(Buffer.from(manA.join('\\n')));
      console.log('AC-N3 tile manifest sha256 = ' + manifestHash + ' (' + manA.length + ' tiles, '
        + 'shortcut=' + shortcutCount + ' non-shortcut=' + nonShortcutCount + ')');

      // --- AC-N4: 付随物 ---
      // original.<ext> は fs.copy(srcFile, ...) による**元ファイルからの直コピー**であり、
      // タイル経路に依存しない（∴ バイト同一の保証はむしろ強い。設計レビュー Minor-3）。
      // thumbnail.jpg / thumbnail_512.webp は生成済みタイルから導出され、その生成コードは
      // 本タスクで 1 行も変更していない。∴ AC-N3 が通れば内容も同一である。
      const originalPath = nodePath.join(outA, 'original.' + ext);
      ok('AC-N4 original.' + ext + ' が元ファイルとバイト単位で同一（fs.copy による直コピー）', () => {
        assert.equal(sha256(nodeFs.readFileSync(originalPath)), sha256(nodeFs.readFileSync(srcFile)));
      });
      for (const name of ['thumbnail.jpg', 'thumbnail_512.webp']) {
        ok('AC-N4 ' + name + ' が生成され非ゼロサイズ（一致したタイルから導出）', () => {
          const st = nodeFs.statSync(nodePath.join(outA, name));
          assert.ok(st.size > 0, name + ' のサイズ = ' + st.size);
        });
      }
      // フィクスチャは決定的（固定シードの擬似乱数）なので、この 3 行はコードを変えない限り
      // 実行のたびに同じ値になる。∴ 置換の前後で走らせて突き合わせれば、タイル以外の生成物にも
      // バイト同一性の観測が及ぶ（AC-N4 の補強。合否は上の assert が持つ）。
      console.log('AC-N4 artifacts sha256: original.' + ext + '=' + sha256(nodeFs.readFileSync(originalPath)));
      for (const name of ['thumbnail.jpg', 'thumbnail_512.webp']) {
        console.log('AC-N4 artifacts sha256: ' + name + '=' + sha256(nodeFs.readFileSync(nodePath.join(outA, name))));
      }

      // --- AC-N6: 進捗契約が不変 ---
      ok('AC-N6 update の呼び出し回数がタイル数 + 1（初期化の update(0) を含む）', () => {
        assert.equal(updateArgs.length, refTasks.length + 1,
          'update 回数 = ' + updateArgs.length + ' / 期待 ' + (refTasks.length + 1));
      });
      ok('AC-N6 update の第 1 引数が 0..N の連番（1 タイル 1 回）', () => {
        assert.deepEqual(updateArgs.map((a) => a[0]), Array.from({ length: refTasks.length + 1 }, (_, i) => i));
      });
      ok('AC-N6 send の内容が不変（チャネル / i18n キー / progress 形式）— 回数は assert しない', () => {
        assert.ok(sendRecords.length > 0, 'send が 1 回以上発生している');
        for (const r of sendRecords) {
          assert.equal(r.channel, 'mapedit:taskProgress', 'チャネル');
          assert.ok(['mapupload.dividing_tile', 'mapupload.next_thumbnail'].includes(r.payload.text),
            'i18n キー: ' + r.payload.text);
          assert.match(String(r.payload.progress), /^\\(\\d+\\/\\d+\\)$/, 'progress 形式: ' + r.payload.progress);
          assert.equal(String(r.payload.progress).split('/')[1].replace(')', ''), String(refTasks.length),
            'progress の総数 = タイル数');
        }
      });
      console.log('AC-N6 観測: update 呼び出し ' + updateArgs.length + ' 回 / '
        + 'webContents.send ' + sendRecords.length + ' 回（throttle により一致しないのが正常）');
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
