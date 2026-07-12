// M10-T4 スモーク: PNG-in-ICO パッカー (electron/utils/icoPack.ts) の behavioral 検証。
// アプリエクスポートの favicon.ico 生成 (pwa-asset-generator は .ico を出力しないため自前パック) に使う。
// 検証項目:
//   ① ICONDIR ヘッダ: reserved=0 / type=1 (icon) / count=エントリ数 (すべて little-endian)
//   ② ICONDIRENTRY: width/height バイト (256以上は 0)、bytesInRes=PNG長、imageOffset の整合
//   ③ 各エントリのオフセット位置に PNG マジック (89 50 4E 47) がそのまま格納される
//   ④ 複数エントリ時のオフセットが順に連結される (6 + 16*N + 累積長)
//   ⑤ 空配列は Error
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'ico-pack-'));
const outDir = path.join(workDir, 'dist');

try {
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, 'electron/utils/icoPack.ts'),
        formats: ['es'],
        fileName: () => 'icoPack.mjs',
      },
      rollupOptions: { external: [] },
    },
  });

  const { packIco } = await import(pathToFileURL(path.join(outDir, 'icoPack.mjs')).href);

  // 1x1 の実PNG (base64) と、それを水増しした擬似PNGバッファ (マジックのみ本物) を使う
  const pngSmall = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const pngLarge = Buffer.concat([pngSmall, Buffer.alloc(300, 0xab)]);

  // --- ① 単一エントリ: ICONDIR ヘッダ ---
  const single = packIco([{ data: pngSmall, width: 196, height: 196 }]);
  assert.ok(Buffer.isBuffer(single), 'packIco は Buffer を返すはず');
  assert.equal(single.readUInt16LE(0), 0, 'ICONDIR.reserved は 0 のはず');
  assert.equal(single.readUInt16LE(2), 1, 'ICONDIR.type は 1 (icon) のはず');
  assert.equal(single.readUInt16LE(4), 1, 'ICONDIR.count はエントリ数のはず');
  // favicon.ico のマジック (00 00 01 00) で始まること = エクスポート検証と同じ条件
  assert.ok(single.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])),
    'ICO マジック (00 00 01 00) で始まるはず');

  // --- ② 単一エントリ: ICONDIRENTRY ---
  assert.equal(single[6], 196, 'entry.width は 196 のはず');
  assert.equal(single[7], 196, 'entry.height は 196 のはず');
  assert.equal(single[8], 0, 'entry.colorCount は 0 のはず');
  assert.equal(single[9], 0, 'entry.reserved は 0 のはず');
  assert.equal(single.readUInt16LE(10), 1, 'entry.planes は 1 のはず');
  assert.equal(single.readUInt16LE(12), 32, 'entry.bitCount は 32 のはず');
  assert.equal(single.readUInt32LE(14), pngSmall.length, 'entry.bytesInRes は PNG 長のはず');
  assert.equal(single.readUInt32LE(18), 6 + 16, 'entry.imageOffset はヘッダ直後のはず');
  assert.equal(single.length, 6 + 16 + pngSmall.length, '全長 = ヘッダ + エントリ + PNG のはず');

  // --- ③ PNG データがオフセット位置に無加工格納される ---
  const stored = single.subarray(single.readUInt32LE(18), single.readUInt32LE(18) + pngSmall.length);
  assert.ok(stored.equals(pngSmall), 'PNG バイト列が無加工で格納されるはず');
  assert.ok(stored.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    '格納データは PNG マジックで始まるはず');

  // --- ④ 複数エントリ + 256px 以上は width/height バイトが 0 ---
  const multi = packIco([
    { data: pngSmall, width: 32, height: 32 },
    { data: pngLarge, width: 512, height: 512 },
  ]);
  assert.equal(multi.readUInt16LE(4), 2, 'count は 2 のはず');
  assert.equal(multi[6], 32, 'entry0.width は 32 のはず');
  assert.equal(multi[6 + 16], 0, '256px 以上の entry1.width バイトは 0 のはず');
  assert.equal(multi[7 + 16], 0, '256px 以上の entry1.height バイトは 0 のはず');
  const offset0 = multi.readUInt32LE(18);
  const offset1 = multi.readUInt32LE(18 + 16);
  assert.equal(offset0, 6 + 16 * 2, 'entry0 のオフセットはディレクトリ直後のはず');
  assert.equal(offset1, offset0 + pngSmall.length, 'entry1 のオフセットは entry0 の直後のはず');
  assert.ok(multi.subarray(offset1, offset1 + pngLarge.length).equals(pngLarge),
    'entry1 の PNG バイト列も無加工格納のはず');
  assert.equal(multi.length, offset1 + pngLarge.length, '全長がオフセット計算と一致するはず');

  // --- ⑤ 空配列は Error ---
  assert.throws(() => packIco([]), /empty|entries/i, '空配列はエラーのはず');

  console.log('M10-T4 ico pack smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
