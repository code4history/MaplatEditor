// スモーク: 地図 ZIP に同梱される POI（pois/・imgs/）の容量上限の経路差。
//
// 背景（2026-11-20 実測）: 人間が書き出した地図 zip（162 MB、imgs/ に 6.9〜19.3 MB の画像が
// 11 枚で POI の中身の合計 約 143 MB）を同じエディタで取り込むと
// 「地図データのインポートでエラーが発生しました。」で止まった（main のログは
// `POI package is too large`）。**アプリ自身が書き出した zip を同じアプリが取り込めない**のが不具合の本体。
//
// 固定すること:
//   (A) 地図 zip の imgs/ に 18 MiB の画像を 6 枚（合計 108 MiB = 旧上限 100 MiB 超）入れ、
//       POI の html から参照させる → 取り込みが成功し、html の参照が maplat-asset: に正本化される
//   (B) 21 MiB の画像 1 枚 → 専用のコード 'PoiImageTooLarge' と entry 名が返る
//       （1 枚あたり 20 MiB の上限は地図 zip 経路でも残す）
//   (B2) POI payload（pois/ + imgs/）の合計がちょうど 512 件なら通り、513 件なら
//       専用のコード 'PoiTooManyEntries' が返る（件数の上限 512 も地図 zip 経路で残す）
//   (B3) 外部 POI 文書を参照しない地図 zip でも、**展開の前の検査**で拒否される。
//       展開（extractAllTo）は一度も呼ばれず、失敗後に一時展開先へ何も残らない
//   (C) POI 単体パッケージの合計の上限は 1 GiB。ちょうど 1 GiB は通る / 1 GiB + 1 は拒否される
//   (C2) importManagedPoiDocuments は既定で合計を掛け、applyTotalLimit: false では掛けない
//       （地図 zip 経路が渡す値。**経路差の配線**の固定）
//   (D) 上限の例外は構造（kind・entryName）を持ち、message の文面は従来どおり
//
// 実行方法: node scripts/map-zip-poi-payload-smoke.mjs。fixture は小さく保ち、
// 大きい画像はゼロ画素の BMP（デコードできる実画像。asset 登録が jimp でデコードするため）で作る。
// 失敗しても途中で止めず、全部の結果を出してから exit 1 にする。
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'map-zip-poi-payload-'));
const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'map-zip-poi-payload-fixtures-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const storeStub = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const tmpDir = path.join(workDir, 'tmp');
  await mkdir(dataDir, { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  await writeFile(electronStub, `
    export const app = { getPath() { return ${JSON.stringify(workDir)}; }, getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); }, exit() {} };
    export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); } };
    export const ipcMain = { handle() {} };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
  `);
  await writeFile(storeStub, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { writeFile as fsWriteFile, readFile as fsReadFile } from 'node:fs/promises';
    import { existsSync } from 'node:fs';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const fixtureDir = ${JSON.stringify(fixtureDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};
    const MiB = 1024 * 1024;
    const GiB = 1024 * MiB;

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { default: poiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
    const poiPackageService = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiPackageService.ts'))});
    const poiPackage = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/poiPackage.ts'))});
    await SqliteDataService.getDb();

    const failures: string[] = [];
    const check = async (label: string, fn: () => unknown | Promise<unknown>) => {
      try {
        const note = await fn();
        console.log('ok ' + label + (note ? ': ' + note : ''));
      } catch (e) {
        failures.push(label);
        console.log('NG ' + label + ': ' + String((e as any)?.message ?? e).split('\\n')[0].slice(0, 300));
      }
    };

    // 戻り値に、利用者に見せてはいけない原文や一時パスが混ざらないこと
    const forbidden = (label: string, value: unknown) => {
      const s = JSON.stringify(value);
      for (const needle of ['ADM-ZIP', '{0}', 'inflate', fixtureDir, workDir]) {
        assert.equal(s.includes(needle), false, label + ' の戻り値に ' + JSON.stringify(needle) + ' が含まれる: ' + s);
      }
    };

    let serial = 0;
    const writeFixture = async (name: string, buf: Buffer) => {
      const p = nodePath.join(fixtureDir, (++serial) + '-' + name);
      await fsWriteFile(p, buf);
      return p;
    };

    // ゼロ画素の BMP を作る。**デコードできる実画像**である必要がある
    // （POI ZIP 同梱画像は ImageAssetService.add が jimp でデコードして asset 登録する。
    //   無効なバイト列の「ゼロ埋め」は拒まれる）。画素はゼロのまま、ヘッダだけを書く。
    const makeBmp = (width: number, height: number): Buffer => {
      const rowBytes = width * 3;
      assert.equal(rowBytes % 4, 0, 'BMP の行長は 4 の倍数であること');
      const dataSize = rowBytes * height;
      const buf = Buffer.alloc(54 + dataSize);
      buf.write('BM', 0);
      buf.writeUInt32LE(54 + dataSize, 2);
      buf.writeUInt32LE(54, 10);
      buf.writeUInt32LE(40, 14);
      buf.writeInt32LE(width, 18);
      buf.writeInt32LE(height, 22);
      buf.writeUInt16LE(1, 26);
      buf.writeUInt16LE(24, 28);
      buf.writeUInt32LE(dataSize, 34);
      return buf;
    };

    const fc = (opts: { name?: string; html?: string } = {}) => ({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [134.69, 34.84] },
        properties: { name: opts.name ?? 'poi', ...(opts.html ? { html: opts.html } : {}) },
      }],
    });
    const htmlRef = (names: string[]) =>
      '<p>poi images</p>' + names.map((n) => '<img src="imgs/' + n + '">').join('');

    // 地図 zip を組む（pois は map JSON が正本、pois/ と imgs/ は実体の供給元）
    const mapZip = (opts: {
      slug: string;
      docs?: Record<string, unknown>;
      imgs?: Record<string, Buffer>;
      pois?: unknown;
    }) => {
      const zip = new AdmZip();
      zip.addFile('maps/' + opts.slug + '.json', Buffer.from(JSON.stringify({
        mapID: opts.slug, title: opts.slug, attr: 'test', lang: 'ja',
        width: 400, height: 300, gcps: [], edges: [],
        pois: opts.pois ?? [{ layer: 'pois/poi1.geojson' }],
      })));
      zip.addFile('tmbs/' + opts.slug + '.jpg', Buffer.from('THUMB:' + opts.slug));
      zip.addFile('tiles/' + opts.slug + '/0/0/0.jpg', Buffer.from('TILE:' + opts.slug));
      for (const [dest, json] of Object.entries(opts.docs ?? {})) {
        zip.addFile(dest, Buffer.from(JSON.stringify(json)));
      }
      for (const [name, bytes] of Object.entries(opts.imgs ?? {})) zip.addFile(name, bytes);
      return zip.toBuffer();
    };

    // 中央ディレクトリの宣言サイズ（展開後サイズ）だけを書き換える。
    // 合計の上限を超える**実データ**を fixture にしないための道具。検査は宣言サイズで
    // 行うのでこの形で十分。DEFLATED（adm-zip 既定）に限る（STORED は宣言と実体の一致を
    // assertArchiveStructure に要求される）。書き換えた entry は getData しないこと。
    const patchDeclaredSize = async (zipPath: string, entryName: string, declared: number) => {
      const buf = await fsReadFile(zipPath);
      const name = Buffer.from(entryName);
      let at = -1;
      for (let i = 0; i + 46 <= buf.length; i += 1) {
        if (buf.readUInt32LE(i) !== 0x02014b50) continue;
        const nameLen = buf.readUInt16LE(i + 28);
        if (nameLen === name.length && buf.compare(name, 0, name.length, i + 46, i + 46 + nameLen) === 0) {
          at = i;
          break;
        }
      }
      assert.ok(at >= 0, 'fixture: 中央ディレクトリに ' + entryName + ' が無い');
      buf.writeUInt32LE(declared, at + 24);
      await fsWriteFile(zipPath, buf);
    };

    // ---- (A) 合計100 MiB 超の POI 画像を持つ地図 zip が取り込める（本題の回帰）----
    await check('(A) imgs/ 18 MiB × 6（合計 108 MiB）の地図 zip が取り込める', async () => {
      const names = [0, 1, 2, 3, 4, 5].map((i) => 'img' + i + '.bmp');
      const imgs: Record<string, Buffer> = {};
      for (const n of names) imgs['imgs/' + n] = makeBmp(4096, 1536);
      const imgTotal = Object.values(imgs).reduce((sum, b) => sum + b.length, 0);
      assert.ok(imgTotal > 100 * MiB,
        'fixture 前提: imgs/ の合計が旧上限 100 MiB を超えること（' + imgTotal + '）');
      for (const b of Object.values(imgs)) {
        assert.ok(b.length <= 20 * MiB, 'fixture 前提: 1 枚が 20 MiB 以下であること（' + b.length + '）');
      }
      const zipPath = await writeFixture('big-payload.zip', mapZip({
        slug: 'poibig',
        docs: { 'pois/poi1.geojson': fc({ name: 'big', html: htmlRef(names) }) },
        imgs,
      }));
      const result = await dataUploadService.extractZip(zipPath);
      assert.equal(result.err, undefined,
        '取り込みが成功すること（実際: ' + JSON.stringify(result).slice(0, 300) + '）');
      assert.ok(result.mapData, 'mapData が返ること');
      // 成功時の戻り値には tile の実体パス（url_ 等）が正当に含まれるため forbidden は掛けない。
      // 原文漏れの検査は失敗経路の (B)(B2) が担う

      // POI は管理下ソースとして復元され、html の imgs/ 参照は maplat-asset: に正本化される
      const pois = result.mapData.pois;
      assert.ok(Array.isArray(pois) && pois[0] && pois[0].poiUid,
        'pois が { poiUid } に復元されること（実際: ' + JSON.stringify(pois).slice(0, 200) + '）');
      const detail = await poiSourceService.get(pois[0].poiUid);
      assert.ok(detail, 'POI ソースが読めること');
      const html = JSON.stringify(detail.fc);
      const refs = [...html.matchAll(/maplat-asset:([0-9a-fA-F-]{36})/g)].map((m) => m[1]);
      assert.equal(refs.length, 6,
        'html の参照 6 件が maplat-asset: に正本化されること（実際: ' + refs.length + ' / ' + html.slice(0, 300) + '）');
      assert.equal(new Set(refs).size, 6, '6 枚がそれぞれ別の asset になること');
      assert.ok(!html.includes('imgs/img'), 'ZIP 相対参照（imgs/…）が残っていないこと');
      return 'POI 画像 ' + (imgTotal / MiB).toFixed(1) + ' MiB / asset 6 件';
    });

    // ---- (B) 1 枚 21 MiB → 専用のコード（1 枚の上限は残す）----
    await check('(B) 21 MiB の画像 1 枚 → PoiImageTooLarge と entry 名', async () => {
      const zipPath = await writeFixture('huge-image.zip', mapZip({
        slug: 'poihuge',
        docs: { 'pois/poi1.geojson': fc({ name: 'huge', html: htmlRef(['huge.png']) }) },
        imgs: { 'imgs/huge.png': Buffer.alloc(21 * MiB + 1) },
      }));
      const result = await dataUploadService.extractZip(zipPath);
      assert.equal(result.err, 'PoiImageTooLarge',
        '専用のコードになること（実際: ' + JSON.stringify(result).slice(0, 300) + '）');
      assert.equal(result.errEntry, 'imgs/huge.png', 'どの画像かが entry 名で分かること');
      assert.equal(result.residue, undefined, '補償が完結していること（residue が無い）');
      forbidden('(B)', result);
    });

    // ---- (B2) 件数の境界: POI payload（pois/ + imgs/）の合計がちょうど 512 件は通り、
    //      513 件は拒否される（製品の経路 extractZip で固定する）----
    await check('(B2) POI payload ちょうど 512 件は通り 513 件は PoiTooManyEntries', async () => {
      // 512 件 = 画像 511 + GeoJSON 1（未参照の画像は取り込まれないだけで件数には数える）
      const imgs512: Record<string, Buffer> = {};
      for (let i = 0; i < 511; i += 1) imgs512['imgs/p' + i + '.png'] = Buffer.alloc(8);
      const okPath = await writeFixture('payload-512.zip', mapZip({
        slug: 'poicount512',
        docs: { 'pois/poi1.geojson': fc({ name: 'count' }) },
        imgs: imgs512,
      }));
      const ok = await dataUploadService.extractZip(okPath);
      assert.equal(ok.err, undefined,
        'ちょうど 512 件は通ること（実際: ' + JSON.stringify(ok).slice(0, 300) + '）');
      assert.ok(ok.mapData, 'mapData が返ること');

      // 513 件 = 画像 512 + GeoJSON 1
      const imgs513: Record<string, Buffer> = {};
      for (let i = 0; i < 512; i += 1) imgs513['imgs/p' + i + '.png'] = Buffer.alloc(8);
      const ngPath = await writeFixture('payload-513.zip', mapZip({
        slug: 'poicount513',
        docs: { 'pois/poi1.geojson': fc({ name: 'count' }) },
        imgs: imgs513,
      }));
      const result = await dataUploadService.extractZip(ngPath);
      assert.equal(result.err, 'PoiTooManyEntries',
        '専用のコードになること（実際: ' + JSON.stringify(result).slice(0, 300) + '）');
      assert.equal(result.residue, undefined, '補償が完結していること（residue が無い）');
      forbidden('(B2)', result);
    });

    // ---- (B3) 外部 POI 文書を参照しない地図 zip でも、展開の前の検査で拒否される ----
    // （展開後の restoreManagedPois の検査だけでは、参照が無いと検査ごと省略される）
    await check('(B3) POI 参照なしの地図 zip も展開前に拒否され一時フォルダに何も残らない', async () => {
      const imgs: Record<string, Buffer> = {};
      for (let i = 0; i < 513; i += 1) imgs['imgs/p' + i + '.png'] = Buffer.alloc(8);
      const zipPath = await writeFixture('no-ref-many-payload.zip', mapZip({
        slug: 'poinoref',
        pois: [],   // map JSON は外部 POI 文書を参照しない
        imgs,
      }));
      // 展開（extractAllTo）が呼ばれないことを観察する（展開の前に止まることの直接の証拠）
      const extractCalls: string[] = [];
      const originalExtract = AdmZip.prototype.extractAllTo;
      AdmZip.prototype.extractAllTo = function (this: unknown, ...args: any[]) {
        extractCalls.push(String(args[0]));
        return (originalExtract as any).apply(this, args);
      };
      try {
        const result = await dataUploadService.extractZip(zipPath);
        assert.equal(result.err, 'PoiTooManyEntries',
          '専用のコードになること（実際: ' + JSON.stringify(result).slice(0, 300) + '）');
        assert.equal(result.residue, undefined, '補償が完結していること（residue が無い）');
        assert.deepEqual(extractCalls, [],
          '展開（extractAllTo）が一度も呼ばれないこと（実際: ' + JSON.stringify(extractCalls) + '）');
        assert.equal(existsSync(nodePath.join(tmpDir, 'zip')), false,
          '一時展開先が消えて何も残らないこと');
        forbidden('(B3)', result);
      } finally {
        AdmZip.prototype.extractAllTo = originalExtract;
      }
    });

    // ---- (C) POI 単体パッケージの合計の上限は 1 GiB ----
    await check('(C) POI 単体パッケージは合計 1 GiB 超で拒否される（境界と製品経路）', async () => {
      // 純関数の境界: ちょうど 1 GiB は通る / 1 GiB + 1 は拒否される
      assert.doesNotThrow(
        () => poiPackage.assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: GiB }]),
        'ちょうど 1 GiB は通ること');
      try {
        poiPackage.assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: GiB + 1 }]);
        assert.fail('1 GiB + 1 が拒否されなかった');
      } catch (e: any) {
        assert.equal(e.name, 'PoiPayloadLimitError', '例外の型が PoiPayloadLimitError であること');
        assert.equal(e.kind, 'payload-too-large', 'kind が payload-too-large であること');
        assert.equal(e.message, 'POI package is too large', 'message の文面が従来どおりであること');
      }

      // 製品経路（importPoiZip）: payload 外 entry（巨大 README）の合計でも 1 GiB で拒否される
      const z = new AdmZip();
      z.addFile('pois/one.geojson', Buffer.from(JSON.stringify(fc())));
      z.addFile('README', Buffer.alloc(1024, 0x41));
      const bigPath = nodePath.join(fixtureDir, 'poi-big-readme.zip');
      await fsWriteFile(bigPath, z.toBuffer());
      await patchDeclaredSize(bigPath, 'README', GiB + 1);
      await assert.rejects(
        () => poiPackageService.importPoiZip(bigPath),
        /POI package is too large/,
        'payload 外 entry による 1 GiB 超が importPoiZip で拒否されること');
    });

    // ---- (C2) 経路差の配線: 既定で合計を掛け、地図 zip 経路（applyTotalLimit: false）では掛けない ----
    await check('(C2) importManagedPoiDocuments の合計の上限は applyTotalLimit で外せる', async () => {
      // pois/unused.geojson の宣言だけを 1 GiB + 1 にした zip（実データは小さい）。
      // dests に挙げない entry なので getData されない（宣言サイズだけの fixture で安全）
      const z = new AdmZip();
      z.addFile('pois/one.geojson', Buffer.from(JSON.stringify(fc())));
      z.addFile('pois/unused.geojson', Buffer.from(JSON.stringify(fc())));
      const p = nodePath.join(fixtureDir, 'poi-heavy-declared.zip');
      await fsWriteFile(p, z.toBuffer());
      await patchDeclaredSize(p, 'pois/unused.geojson', GiB + 1);

      // 既定（POI 単体パッケージと同じ）では payload の合計で拒否される
      await assert.rejects(
        () => poiPackageService.importManagedPoiDocuments(p, ['pois/one.geojson']),
        /POI package is too large/,
        '既定では payload の合計の上限が掛かること');

      // 地図 zip 経路が渡す applyTotalLimit: false では掛けない
      const r = await poiPackageService.importManagedPoiDocuments(p, ['pois/one.geojson'], { applyTotalLimit: false });
      assert.equal(r.documents.size, 1, '合計の上限を外すと dests の document が読めること');
      assert.equal(r.documents.get('pois/one.geojson')!.type, 'FeatureCollection');
      await r.cleanup();
    });

    // ---- (D) 上限の例外の構造と message の不変 ----
    await check('(D) 上限の例外は kind・entryName を持ち message は従来どおり', () => {
      const kindOf = (fn: () => void) => {
        try { fn(); return null; } catch (e: any) { return e; }
      };
      const image = kindOf(() => poiPackage.assertPoiPayloadLimits(
        [{ name: 'imgs/huge.png', size: 21 * MiB }]));
      assert.equal(image?.name, 'PoiPayloadLimitError');
      assert.equal(image?.kind, 'image-too-large');
      assert.equal(image?.entryName, 'imgs/huge.png');
      assert.equal(image?.message, 'Packaged image is too large: imgs/huge.png');

      const count = kindOf(() => poiPackage.assertPoiPayloadLimits(
        Array.from({ length: 513 }, (_, i) => ({ name: 'pois/' + i + '.geojson', size: 1 }))));
      assert.equal(count?.kind, 'too-many-entries');
      assert.equal(count?.entryName, undefined);
      assert.equal(count?.message, 'POI package contains too many entries');

      // 合計の上限を外しても 1 枚と件数の上限は同じ message で残る
      const imageNoTotal = kindOf(() => poiPackage.assertPoiPayloadLimits(
        [{ name: 'imgs/huge.png', size: 21 * MiB }], { applyTotalLimit: false }));
      assert.equal(imageNoTotal?.message, 'Packaged image is too large: imgs/huge.png');
      const countNoTotal = kindOf(() => poiPackage.assertPoiPayloadLimits(
        Array.from({ length: 513 }, (_, i) => ({ name: 'pois/' + i + '.geojson', size: 1 })),
        { applyTotalLimit: false }));
      assert.equal(countNoTotal?.message, 'POI package contains too many entries');
    });

    if (failures.length > 0) {
      console.log('FAILURES: ' + failures.length);
      process.exit(1);
    }
    console.log('map zip poi payload smoke passed');
    process.exit(0);
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [
      { find: 'electron', replacement: electronStub },
      { find: 'electron-store', replacement: storeStub },
    ]},
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: {
        external: ['jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [bundled], {
      cwd: projectRoot, timeout: 600000, maxBuffer: 1024 * 1024 * 16,
    }));
  } catch (e) {
    if (e && e.stdout) process.stdout.write(e.stdout);
    if (e && e.stderr) process.stderr.write(e.stderr);
    throw e;
  }
  process.stdout.write(stdout);
  if (!stdout.includes('map zip poi payload smoke passed')) {
    throw new Error('map zip poi payload smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
}
