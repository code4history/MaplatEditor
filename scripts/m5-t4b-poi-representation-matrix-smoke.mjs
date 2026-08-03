// m5-t4b: POI 全表現 × 依存アセットの実測比較表（タスク設計 v1.1 §7・AC5）。
//
// 固定する受け入れ条件:
//   AC5  POI の全サポート形（登録参照・生 FC・wrapper・URL 文字列・旧形式・単独形）と
//        依存アセットの比較表を設計書へ残す。**コピー不能な実体は成功扱いで黙殺せず
//        warning／Error のどちらかを契約として検証する**
//
// 【この smoke の3部構成】
//   Part A  6表現それぞれを共通 API へ通し、出力参照形・外部ファイル・依存 assets・warnings を
//           **実測**する。設計書 §7 の表はこの出力を転記したものであり、手で書いた推測ではない
//   Part B  全表現を1枚の地図に載せて buildAndWriteMapZip で実 ZIP を作り、
//           **maps/<slug>.json が参照する pois/* と imgs/* が ZIP に全て実在する**ことを固定する。
//           これは「黙殺」の一般形を捕まえる assert である — 原因が何であれ、
//           参照だけがあって実体が無い ZIP を出したらここで落ちる
//           （import 側 AC7 の「欠損 entry は Error」の搬出側の鏡）
//   Part C  コピー不能な実体の契約を**実際に発火させて**確認する。
//           manifest 段（実体を解決できない）＝ warning、コピー段（実体を読めない）＝ Error
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4b-matrix-'));
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
    export const dialog = { showSaveDialog() { return Promise.resolve({ canceled: true }); } };
    export const ipcMain = { handle() {} };
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
    import { writeFile as fsWriteFile, mkdir as fsMkdir, chmod as fsChmod, readFile as fsReadFile } from 'node:fs/promises';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};
    const tmpDir = ${JSON.stringify(tmpDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', tmpDir);
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: PoiSourceService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
    const {
      externalizeMapDocumentPois,
      createPoiExternalizationContext,
    } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/poiReferenceResolver.ts'))});
    const { buildAndWriteMapZip } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'))});
    await SqliteDataService.getDb();

    const UNRESOLVED_ICON = 'appedit.warn_unresolved_icon';
    const MISSING_ASSET_REF = 'appedit.warn_missing_asset_ref';
    const MISSING_POI_SOURCE = 'appedit.warn_missing_poi_source';
    const MIXED_POIS = 'appedit.warn_mixed_pois';
    const MISSING_UID = '99999999-9999-4999-8999-999999999999';

    // ------------------------------------------------------------------
    // fixture: asset 実体 / icon 実体 / POI ソース
    // ------------------------------------------------------------------
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const assetsDir = nodePath.join(dataDir, 'assets');
    await fsMkdir(assetsDir, { recursive: true });

    const mkAsset = async (slug: string, opts: { bytes?: boolean } = {}) => {
      const { uid } = await SqliteDataService.createAsset(slug, {
        lang: 'ja', title: { ja: slug }, mime: 'image/png', ext: 'png',
        width: 1, height: 1, byteSize: pngBytes.length,
      });
      if (opts.bytes !== false) await fsWriteFile(nodePath.join(assetsDir, uid + '.png'), pngBytes);
      return uid;
    };

    const iconAssetUid = await mkAsset('temple-mark');          // 実体あり
    const orphanAssetUid = await mkAsset('orphan-mark', { bytes: false }); // DB 行はあるが実体なし
    const htmlAssetUid = await mkAsset('inline-photo');          // html 内 maplat-asset: 用
    const htmlOrphanUid = await mkAsset('orphan-photo', { bytes: false });

    const fcOf = (id: string, name: string, props: Record<string, unknown> = {}) => ({
      type: 'FeatureCollection', id, name,
      features: [{
        type: 'Feature', id: 'f1',
        geometry: { type: 'Point', coordinates: [134.69, 34.84] },
        properties: { name: name + 'の点', ...props },
      }],
    });

    const createdA = await PoiSourceService.createLocal({
      slug: 'registered-poi', title: { ja: '登録POI' }, lang: 'ja',
      fc: { ...fcOf('registered-poi', '登録POI'), icon: 'builtin:defaultpin' },
    });
    assert.equal(createdA.result, 'Success', 'fixture: POI ソースの作成: ' + JSON.stringify(createdA));
    const registeredUid = createdA.uid;

    // ==================================================================
    // Part A: 6表現の実測（設計書 §7 の表はこの出力の転記である）
    // ==================================================================
    type Row = {
      label: string;
      input: unknown;
      out: string;
      docs: string[];
      assets: string[];
      warns: string[];
    };
    const rows: Row[] = [];

    const measure = async (label: string, pois: unknown): Promise<Row> => {
      const mapJson: { pois?: unknown } = { pois };
      const ctx = createPoiExternalizationContext();
      const { result } = await externalizeMapDocumentPois(mapJson, ctx);
      const row: Row = {
        label,
        input: pois,
        out: JSON.stringify(mapJson.pois),
        docs: (result?.documents ?? []).map((d: any) => d.dest).sort(),
        assets: (result?.files ?? []).map((f: any) => f.dest).sort(),
        warns: (result?.warnings ?? []).slice().sort(),
      };
      rows.push(row);
      return row;
    };

    // (1) 登録参照 {poiUid}（上書き4種つき。icon は asset UUID = 参照文法）
    {
      const r = await measure('登録参照 {poiUid}', [{
        poiUid: registeredUid, hide: true, title: { ja: '差替タイトル' },
        icon: iconAssetUid, selectedIcon: 'builtin:defaultpin',
      }]);
      const w = JSON.parse(r.out)[0];
      assert.equal(w.layer, 'pois/registered-poi.geojson', '登録参照は外部ファイルへ');
      assert.equal(w.icon, 'imgs/temple-mark.png', '上書き icon の asset UUID が imgs/ へ解決される');
      assert.equal(w.selectedIcon, 'imgs/icons/builtin/defaultpin.png', '上書き selectedIcon の icon set 参照が解決される');
      assert.deepEqual(r.docs, ['pois/registered-poi.geojson']);
      // 依存 assets = 上書き icon の実体 + ソース FC 自身の icon 実体
      assert.ok(r.assets.includes('imgs/temple-mark.png'), '上書き icon の実体コピー要求が載る');
      assert.ok(r.assets.includes('imgs/icons/builtin/defaultpin.png'), 'ソース FC 自身の icon 実体も載る');
      assert.deepEqual(r.warns, [], '正常な登録参照では warning なし');
    }

    // (2) 生 FeatureCollection
    {
      const r = await measure('生 FeatureCollection', [fcOf('raw-fc', '生FC')]);
      assert.deepEqual(JSON.parse(r.out), [{ layer: 'pois/raw-fc.geojson' }],
        '生 FC は外部化され、上書きの無い純粋な参照になる');
      assert.deepEqual(r.docs, ['pois/raw-fc.geojson']);
      assert.deepEqual(r.assets, [], '依存 asset の無い FC は files を増やさない');
      assert.deepEqual(r.warns, []);
    }

    // (3) ラッパー（layer:<FC> + 上書き属性）
    {
      const r = await measure('ラッパー {layer:<FC>, 上書き}', [{
        layer: fcOf('wrapped', 'ラップFC'), hide: true, title: { ja: 'ラッパー題' }, icon: iconAssetUid,
      }]);
      const w = JSON.parse(r.out)[0];
      assert.equal(w.layer, 'pois/wrapped.geojson');
      assert.equal(w.hide, true, '上書きはラッパー側に載る');
      assert.equal(w.icon, 'imgs/temple-mark.png');
      const doc = (await (async () => {
        const mapJson: { pois?: unknown } = { pois: [{ layer: fcOf('wrapped', 'ラップFC'), hide: true, icon: iconAssetUid }] };
        const ctx = createPoiExternalizationContext();
        const { result } = await externalizeMapDocumentPois(mapJson, ctx);
        return (result as any).documents[0].json;
      })());
      assert.equal((doc as any).hide, undefined, '上書きが FC 実体へ焼き込まれないこと');
      assert.equal((doc as any).icon, undefined, '上書き icon が FC 実体へ焼き込まれないこと');
      assert.deepEqual(r.warns, []);
    }

    // (4) URL 文字列（裸 / wrapper 済み）
    {
      const r = await measure('URL 文字列（裸）', ['https://example.com/remote.geojson']);
      assert.deepEqual(JSON.parse(r.out), [{ layer: 'https://example.com/remote.geojson' }],
        '裸 URL は {layer:URL} へ包まれる（viewer の先頭要素モード判定を避けるため）');
      assert.deepEqual(r.docs, [], 'URL は外部ファイルを生まない');
      assert.deepEqual(r.assets, [], 'URL は依存 asset を持たない');
      assert.deepEqual(r.warns, []);

      const r2 = await measure('URL 文字列（{layer:URL}）', [{ layer: 'https://example.com/remote.geojson', hide: true }]);
      assert.deepEqual(JSON.parse(r2.out), [{ layer: 'https://example.com/remote.geojson', hide: true }],
        '{layer:URL} は上書きごとそのまま透過する');
      assert.deepEqual(r2.docs, []);
      assert.deepEqual(r2.warns, []);
    }

    // (5) 旧形式（素の POI 配列）
    {
      const legacy = [
        { lat: 34.84, lng: 134.69, name: '旧POI1' },
        { lat: 34.85, lng: 134.70, name: '旧POI2' },
      ];
      const r = await measure('旧形式（素の POI 配列）', legacy);
      assert.deepEqual(JSON.parse(r.out), legacy, '旧形式は無加工で透過する（外部化しない）');
      assert.deepEqual(r.docs, [], '旧形式は外部ファイルを生まない');
      assert.deepEqual(r.assets, [], '旧形式は依存 asset を持たない');
      assert.deepEqual(r.warns, [], '旧形式のみの配列では混在警告も出ない');

      // 旧形式と FC が混ざった場合だけ混在警告が出る
      const r2 = await measure('旧形式 + FC の混在', [legacy[0], fcOf('mixed-fc', '混在FC')]);
      assert.ok(r2.warns.includes(MIXED_POIS),
        '旧形式と FC の混在で mixed 警告が出ること（実際: ' + JSON.stringify(r2.warns) + '）');
    }

    // (6) 単独形（レイヤ1つを配列に包まず直接置く形）
    {
      const r = await measure('単独形（配列に包まない FC）', fcOf('solo-fc', '単独FC'));
      assert.deepEqual(JSON.parse(r.out), [{ layer: 'pois/solo-fc.geojson' }],
        '単独形も配列形と同じ外部参照へ変換される（§2.2 の欠陥是正・AC2b）');
      assert.deepEqual(r.docs, ['pois/solo-fc.geojson']);
      assert.deepEqual(r.warns, []);
    }

    // 実測表の出力（設計書 §7 へ転記する元データ）
    console.log('');
    console.log('=== AC5 実測比較表（POI 表現 × 依存アセット） ===');
    console.log('| POI 表現 | 出力参照形 | 外部ファイル | 依存 assets | warnings |');
    console.log('|---|---|---|---|---|');
    for (const r of rows) {
      const cell = (v: string[]) => (v.length === 0 ? '—' : v.map((x) => '\`' + x + '\`').join('<br>'));
      console.log('| ' + r.label + ' | \`' + r.out + '\` | ' + cell(r.docs) + ' | ' + cell(r.assets) + ' | ' + cell(r.warns) + ' |');
    }
    console.log('');
    console.log('ok: AC5 Part A 6表現の実測');

    // ==================================================================
    // Part B: 実 ZIP で「参照だけがあって実体が無い」状態を作らないこと
    //
    // 原因を問わない一般形の assert である。map JSON が指す pois/* と imgs/* が
    // ZIP に無ければ落ちる ∴ 将来どこかで黙って落とすようになったらここで検知される
    // ==================================================================
    {
      const uid = '11111111-1111-4111-8111-111111111111';
      const slug = 'matrix-map';
      await fsMkdir(nodePath.join(dataDir, 'tmbs'), { recursive: true });
      await fsWriteFile(nodePath.join(dataDir, 'tmbs', uid + '.jpg'), 'THUMB');
      await fsWriteFile(nodePath.join(dataDir, 'tmbs', uid + '_512.jpg'), 'THUMB512');

      const mapObject = {
        mapID: slug, title: '全表現地図', attr: 'test', lang: 'ja', gcps: [], edges: [],
        pois: [
          { poiUid: registeredUid, icon: iconAssetUid },                      // 登録参照 + 上書き icon
          fcOf('raw-in-zip', '生FC'),                                          // 生 FC
          { layer: fcOf('wrapped-in-zip', 'ラップFC'), hide: true },            // ラッパー
          'https://example.com/remote.geojson',                                // URL
          // html 内 maplat-asset:（依存 asset が icon 以外の経路で載る）
          fcOf('html-fc', 'HTML付', { html: { ja: '<img src="maplat-asset:' + htmlAssetUid + '">' } }),
        ],
      };

      const win = { webContents: { send() {} }, isDestroyed() { return false; } } as any;
      const outZip = nodePath.join(workDir, 'matrix.zip');
      await buildAndWriteMapZip(win, mapObject, [], slug, uid, outZip);

      const zip = new AdmZip(outZip);
      const names = zip.getEntries().map((e: any) => e.entryName);
      const mapJson = JSON.parse(zip.getEntry('maps/' + slug + '.json').getData().toString('utf8'));

      // map JSON が参照する pois/* が ZIP に実在すること
      const referenced: string[] = [];
      for (const entry of mapJson.pois) {
        const layer = entry && typeof entry === 'object' ? (entry as any).layer : undefined;
        if (typeof layer === 'string' && !layer.includes('://')) referenced.push(layer);
        for (const key of ['icon', 'selectedIcon']) {
          const v = entry && typeof entry === 'object' ? (entry as any)[key] : undefined;
          if (typeof v === 'string' && v.startsWith('imgs/')) referenced.push(v);
        }
      }
      // 外部化された実体の中の imgs/... 参照も辿る（icon / html 内 asset）。
      // html は JSON 文字列の中に \\" を含む HTML が入るため、引用符アンカーではなく
      // パスとして成立する文字だけを拾う（\\ を食べると存在判定が空振りする）
      for (const name of names.filter((n: string) => n.startsWith('pois/'))) {
        const text = zip.getEntry(name).getData().toString('utf8');
        for (const m of text.matchAll(/imgs\\/[A-Za-z0-9._\\/-]+/g)) referenced.push(m[0]);
      }
      const missing = [...new Set(referenced)].filter((r) => !names.includes(r));
      assert.deepEqual(missing, [],
        'AC5: map JSON / 外部化実体が参照する pois/* と imgs/* は ZIP に全て実在すること'
          + '（不足: ' + JSON.stringify(missing) + ' / ZIP entry: ' + JSON.stringify(names) + '）');

      assert.ok(referenced.some((r) => r.startsWith('pois/')), '前提: pois/* の参照が実際に存在すること');
      assert.ok(referenced.some((r) => r.startsWith('imgs/')), '前提: imgs/* の参照が実際に存在すること');
      assert.ok(names.includes('imgs/inline-photo.png'),
        'AC5: html 内 maplat-asset: の実体も同梱されること（icon 以外の依存アセット経路）');
      console.log('ok: AC5 Part B 参照される実体が ZIP に全て存在する（参照 '
        + [...new Set(referenced)].length + ' 件）');
    }

    // ==================================================================
    // Part C: コピー不能な実体の契約
    //   manifest 段（解決できない）= warning / コピー段（読めない）= Error
    //   どちらでもない「成功扱いで黙殺」が無いことを固定する
    // ==================================================================
    {
      // (a) icon の asset UUID が DB に無い
      const a = await measure('【異常】icon: 未登録 UUID', [fcOf('bad-1', 'x', { icon: MISSING_UID })]);
      assert.ok(a.warns.includes(UNRESOLVED_ICON),
        '(a) 未登録 UUID の icon は warning になること（実際: ' + JSON.stringify(a.warns) + '）');

      // (b) icon の asset は DB にあるが実体バイトが無い
      const b = await measure('【異常】icon: 実体なし asset', [fcOf('bad-2', 'x', { icon: orphanAssetUid })]);
      assert.ok(b.warns.includes(UNRESOLVED_ICON),
        '(b) 実体の無い asset の icon は warning になること（実際: ' + JSON.stringify(b.warns) + '）');
      assert.deepEqual(b.assets, [], '(b) 実体の無い asset はコピー要求に載らないこと');

      // (c) icon set の未知 setId / iconId
      const c = await measure('【異常】icon: 未知 icon set', [fcOf('bad-3', 'x', { icon: 'builtin:no-such-icon' })]);
      assert.ok(c.warns.includes(UNRESOLVED_ICON),
        '(c) 未知 icon set 参照は warning になること（実際: ' + JSON.stringify(c.warns) + '）');

      // (d)(e) html 内 maplat-asset: の DB 行なし / 実体なし
      const d = await measure('【異常】html: 未登録 maplat-asset:',
        [fcOf('bad-4', 'x', { html: { ja: '<img src="maplat-asset:' + MISSING_UID + '">' } })]);
      assert.ok(d.warns.includes(MISSING_ASSET_REF),
        '(d) 未登録 maplat-asset: は warning になること（実際: ' + JSON.stringify(d.warns) + '）');
      const e = await measure('【異常】html: 実体なし maplat-asset:',
        [fcOf('bad-5', 'x', { html: { ja: '<img src="maplat-asset:' + htmlOrphanUid + '">' } })]);
      assert.ok(e.warns.includes(MISSING_ASSET_REF),
        '(e) 実体の無い maplat-asset: は warning になること（実際: ' + JSON.stringify(e.warns) + '）');

      // (f) 解決できない登録参照
      const f = await measure('【異常】{poiUid}: 解決不能', [{ poiUid: MISSING_UID }]);
      assert.ok(f.warns.includes(MISSING_POI_SOURCE),
        '(f) 解決できない poiUid は warning になること（実際: ' + JSON.stringify(f.warns) + '）');
      assert.deepEqual(JSON.parse(f.out), [], '(f) 解決できない要素は落ちる（warning つき）');

      console.log('ok: AC5 Part C manifest 段の6ケースは全て warning（黙殺なし）');
    }

    // (g) コピー段: manifest に載ったが実体を **読めない**
    //     → 成功扱いで黙って欠けた ZIP を出さず、Error が伝播すること
    {
      const readOnlyImpossible = nodePath.join(assetsDir, iconAssetUid + '.png');
      let injected = false;
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        console.log('skip: (g) root 実行のため chmod による読み取り不能を再現できない');
      } else {
        await fsChmod(readOnlyImpossible, 0o000);
        try {
          await fsReadFile(readOnlyImpossible);
          console.log('skip: (g) chmod 000 でも読めるファイルシステムのため再現できない');
          await fsChmod(readOnlyImpossible, 0o644);
        } catch {
          injected = true;
        }
      }

      if (injected) {
        const uid2 = '22222222-2222-4222-8222-222222222222';
        const slug2 = 'unreadable-map';
        await fsWriteFile(nodePath.join(dataDir, 'tmbs', uid2 + '.jpg'), 'THUMB');
        const mapObject = {
          mapID: slug2, title: '読めないicon', attr: 'test', lang: 'ja', gcps: [], edges: [],
          pois: [fcOf('unreadable', 'x', { icon: iconAssetUid })],
        };
        const win = { webContents: { send() {} }, isDestroyed() { return false; } } as any;
        const outZip2 = nodePath.join(workDir, 'unreadable.zip');

        let threw: unknown = null;
        try {
          await buildAndWriteMapZip(win, mapObject, [], slug2, uid2, outZip2);
        } catch (err) {
          threw = err;
        } finally {
          await fsChmod(readOnlyImpossible, 0o644);
        }

        assert.ok(threw,
          '(g) 実体を読めない場合は成功扱いで黙殺せず Error が伝播すること'
            + '（実際: 例外なしで ZIP が完成した）');
        assert.match(String((threw as any)?.code ?? (threw as any)?.message ?? threw), /EACCES|EPERM/,
          '(g) 失敗理由が読み取り不能であること（実際: ' + String(threw) + '）');
        console.log('ok: AC5 Part C (g) コピー不能な実体は Error として伝播する');
      }
    }

    console.log('m5-t4b poi representation matrix OK');
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 180000, maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  console.log('m5-t4b poi representation matrix smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
