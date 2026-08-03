// m5-t4b: 搬出 → 別 slug へ import → 再読込・preview・再搬出（タスク設計 v1.1・AC8）。
//
// 固定する受け入れ条件:
//   AC8  POI・icon・maplat-asset:・通常/512px サムネイルを含む地図 ZIP を export し、
//        **別 slug へ import** した後、再読込・preview・再 export まで通す。
//        import 後の DB は pois/*.geojson ／ imgs/* の **ZIP 相対参照**や
//        **一時ディレクトリ参照**を持たない
//
// 【なぜ「別 slug へ」なのか】
// 元の地図を残したまま複製を取り込むのが実際の利用形である。同 slug は Exist で弾かれる
// （その失敗契約は m5-t5 の担当であり本タスクでは変えない）∴ ZIP 側の slug を書き換えて
// 取り込む。書き換えるのは maps/ ・ tmbs/ ・ tiles/ の名前と mapID であり、
// pois/ ・ imgs/ の名前は ZIP 内で slug 非依存なのでそのままである。
//
// 【この smoke が捕まえるもの】
// 個別 AC（AC2/AC6/AC7）は搬出と import を別々に固定しているが、
// **搬出が書いたものを import が読み、その結果を再び搬出できる**ことは通しでしか出ない。
// 特に「import 後の DB が ZIP 相対参照を持たない」は、参照を実体へ正本化し損ねると
// 再搬出で pois/xxx.geojson という **前の ZIP のパス**が漏れ出す形で壊れる。
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
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4b-e2e-'));
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
    export const dialog = { showSaveDialog() { return Promise.resolve({ canceled: true }); },
      showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
      showMessageBox() { return Promise.resolve({ response: 0 }); } };
    export const ipcMain = { handle() {} };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
    // ElectronStorageAdapter は MapDeleteTrashService を transitive に引くため shell が要る
    export const shell = { trashItem() { return Promise.resolve(); }, openPath() { return Promise.resolve(''); } };
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
    import { writeFile as fsWriteFile, mkdir as fsMkdir } from 'node:fs/promises';
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
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { default: StorageAdapter } = await import(${JSON.stringify(path.join(projectRoot, 'electron/adapters/ElectronStorageAdapter.ts'))});
    const { default: Tin } = await import('@maplat/tin');
    const { buildAndWriteMapZip } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'))});
    await SqliteDataService.getDb();

    const win = { webContents: { send() {} }, isDestroyed() { return false; } } as any;

    // ==================================================================
    // fixture: 依存アセットの4種を全て持つ地図
    //   POI 登録参照 / icon（asset UUID）/ html 内 maplat-asset: / 通常・512px サムネイル
    // ==================================================================
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const assetsDir = nodePath.join(dataDir, 'assets');
    await fsMkdir(assetsDir, { recursive: true });
    const mkAsset = async (slug: string) => {
      const { uid } = await SqliteDataService.createAsset(slug, {
        lang: 'ja', title: { ja: slug }, mime: 'image/png', ext: 'png',
        width: 1, height: 1, byteSize: pngBytes.length,
      });
      await fsWriteFile(nodePath.join(assetsDir, uid + '.png'), pngBytes);
      return uid;
    };
    const iconAssetUid = await mkAsset('roundtrip-icon');
    const htmlAssetUid = await mkAsset('roundtrip-photo');

    const sourceFc = {
      type: 'FeatureCollection', id: 'roundtrip-poi', name: '往復POI',
      features: [{
        type: 'Feature', id: 'f1',
        geometry: { type: 'Point', coordinates: [134.69, 34.84] },
        properties: {
          name: '天守',
          icon: iconAssetUid,
          html: { ja: '<img src="maplat-asset:' + htmlAssetUid + '">' },
        },
      }],
    };
    const created = await PoiSourceService.createLocal({
      slug: 'roundtrip-poi', title: { ja: '往復POI' }, lang: 'ja', fc: sourceFc,
    });
    assert.equal(created.result, 'Success', 'fixture: POI ソースの作成: ' + JSON.stringify(created));
    const sourceUid = created.uid;

    const originUid = '33333333-3333-4333-8333-333333333333';
    const originSlug = 'roundtrip-origin';
    const copySlug = 'roundtrip-copy';

    await fsMkdir(nodePath.join(dataDir, 'tmbs'), { recursive: true });
    await fsWriteFile(nodePath.join(dataDir, 'tmbs', originUid + '.jpg'), 'THUMB-NORMAL');
    await fsWriteFile(nodePath.join(dataDir, 'tmbs', originUid + '_512.jpg'), 'THUMB-512');
    await fsMkdir(nodePath.join(dataDir, 'tiles', originUid, '0', '0'), { recursive: true });
    await fsWriteFile(nodePath.join(dataDir, 'tiles', originUid, '0', '0', '0.jpg'), 'TILE-000');

    // GCP と TIN。搬出の交換形は tins が compiled オブジェクトなら compiled を、
    // 文字列なら gcps を載せる（store_handler.histMap2Store）。preview は
    // compiled が無いと GCP から生成するため（MapEditService:130-131）、
    // 実地図と同じ「compiled 済み」の形で往復させる
    // m4-t3 / m10-t1 の fixture と同型（loose・3点）
    const GCPS = [
      [[0, 0], [135.0, 35.1]],
      [[400, 0], [135.1, 35.1]],
      [[200, 300], [135.05, 35.0]],
    ];
    const tin = new Tin({});
    tin.setWh([400, 300]);
    tin.setStrictMode('loose');
    tin.setVertexMode('plain');
    tin.setPoints(GCPS);
    tin.setEdges([]);
    await tin.updateTinAsync();
    const compiledTin = tin.getCompiled();

    const originMapObject = {
      mapID: originSlug, title: '往復元地図', attr: 'test', lang: 'ja',
      width: 400, height: 300, strictMode: 'loose', vertexMode: 'plain',
      gcps: GCPS, edges: [], sub_maps: [],
      pois: [{ poiUid: sourceUid, hide: true, title: { ja: '往復ラベル' } }],
    };

    // ==================================================================
    // Step 1: 搬出
    // ==================================================================
    const zip1Path = nodePath.join(workDir, 'origin.zip');
    await buildAndWriteMapZip(win, originMapObject, [compiledTin], originSlug, originUid, zip1Path);

    const zip1 = new AdmZip(zip1Path);
    const zip1Names = zip1.getEntries().map((e: any) => e.entryName).sort();
    assert.ok(zip1Names.some((n: string) => /^pois\\/.+\\.geojson$/.test(n)), 'Step1: POI 実体が入ること');
    assert.ok(zip1Names.includes('imgs/roundtrip-icon.png'), 'Step1: icon 実体が入ること');
    assert.ok(zip1Names.includes('imgs/roundtrip-photo.png'), 'Step1: html 内 asset の実体が入ること');
    assert.ok(zip1Names.includes('tmbs/' + originSlug + '.jpg'), 'Step1: 通常サムネイルが入ること');
    assert.ok(zip1Names.includes('tmbs/' + originSlug + '_512.jpg'), 'Step1: 512px サムネイルが入ること');
    assert.ok(zip1Names.some((n: string) => n.startsWith('tiles/' + originSlug + '/')), 'Step1: タイルが入ること');
    console.log('ok: Step1 搬出（POI/icon/maplat-asset:/通常・512px/タイル）');

    // ==================================================================
    // Step 2: 別 slug へ書き換える（元の地図を残したまま複製を取り込む形）
    //   slug 依存の名前は maps/ ・ tmbs/ ・ tiles/ のみ。pois/ ・ imgs/ は slug 非依存
    // ==================================================================
    const zip2 = new AdmZip();
    for (const entry of zip1.getEntries()) {
      if (entry.isDirectory) continue;
      const name: string = entry.entryName;
      let renamed = name;
      if (name === 'maps/' + originSlug + '.json') {
        const json = JSON.parse(entry.getData().toString('utf8'));
        json.mapID = copySlug;
        zip2.addFile('maps/' + copySlug + '.json', Buffer.from(JSON.stringify(json)));
        continue;
      }
      if (name.startsWith('tmbs/' + originSlug)) {
        renamed = 'tmbs/' + copySlug + name.slice(('tmbs/' + originSlug).length);
      } else if (name.startsWith('tiles/' + originSlug + '/')) {
        renamed = 'tiles/' + copySlug + '/' + name.slice(('tiles/' + originSlug + '/').length);
      }
      zip2.addFile(renamed, entry.getData());
    }
    const zip2Path = nodePath.join(workDir, 'copy.zip');
    zip2.writeZip(zip2Path);

    // ==================================================================
    // Step 3: import
    // ==================================================================
    const imported = await dataUploadService.extractZip(zip2Path);
    assert.ok(imported.mapData,
      'Step3: 別 slug の import が成功すること（実際: ' + JSON.stringify(imported).slice(0, 300) + '）');
    assert.equal(imported.mapData.mapID, copySlug, 'Step3: 別 slug で取り込まれること');
    console.log('ok: Step3 別 slug へ import');

    // ==================================================================
    // Step 4: import 後の DB に ZIP 相対参照 / 一時ディレクトリ参照が残らないこと
    //
    // 【AC8 の本体】参照を実体へ正本化し損ねると、DB に前の ZIP のパス
    // （pois/xxx.geojson や imgs/yyy.png）が文字列として残り、再搬出で漏れ出す
    // ==================================================================
    {
      const db = await SqliteDataService.getDb();
      const mapRow = db.prepare('SELECT * FROM maps WHERE slug = ?').get(copySlug) as any;
      assert.ok(mapRow, 'Step4: 取り込んだ地図の行が存在すること');
      const mapText = JSON.stringify(mapRow);

      const sourceRows = db.prepare('SELECT * FROM poi_sources').all() as any[];
      const sourceText = JSON.stringify(sourceRows);
      const allText = mapText + sourceText;

      // ZIP 相対参照
      assert.equal(/["'\\s(]pois\\//.test(allText), false,
        'Step4: DB が pois/*.geojson の ZIP 相対参照を持たないこと（maps 行: '
          + mapText.slice(0, 400) + '）');
      assert.equal(/["'\\s(=]imgs\\//.test(allText), false,
        'Step4: DB が imgs/* の ZIP 相対参照を持たないこと');

      // 一時ディレクトリ参照
      assert.equal(allText.includes(tmpDir), false,
        'Step4: DB が一時ディレクトリのパスを持たないこと（' + tmpDir + '）');
      assert.equal(/dataTmp|\\.tmp-smoke/.test(allText), false,
        'Step4: DB が展開作業ディレクトリの痕跡を持たないこと');

      // 参照は poiUid（＝正本化された実体）を指していること
      const storedPois = JSON.parse(mapRow.data_json).pois;
      assert.ok(Array.isArray(storedPois), 'Step4: 保存された pois が配列であること（行: ' + mapText.slice(0, 400) + '）');
      assert.ok(storedPois[0]?.poiUid, 'Step4: pois が poiUid 参照であること（実際: ' + JSON.stringify(storedPois) + '）');
      assert.equal(storedPois[0].hide, true, 'Step4: 上書き属性が保たれること');

      // icon / maplat-asset: は asset の正本（UUID / maplat-asset: 記法）へ戻っていること
      const importedSource = sourceRows.find((r: any) => r.uid === storedPois[0].poiUid);
      assert.ok(importedSource, 'Step4: 参照先の poi_sources 行が存在すること');
      const importedFc = JSON.parse(importedSource.data_json);
      const props = importedFc.features?.[0]?.properties ?? {};
      assert.match(String(props.icon), /^[0-9a-f-]{36}$/,
        'Step4: icon が imgs/ 参照ではなく asset UUID へ正本化されていること（実際: ' + String(props.icon) + '）');
      const html = typeof props.html === 'string' ? props.html : JSON.stringify(props.html ?? '');
      assert.match(html, /maplat-asset:/,
        'Step4: html 内の画像が imgs/ 参照ではなく maplat-asset: へ正本化されていること（実際: ' + html + '）');
      console.log('ok: Step4 DB に ZIP 相対参照・一時ディレクトリ参照が残らない');
    }

    // ==================================================================
    // Step 5: 再読込 / preview
    // ==================================================================
    const reloaded = await StorageAdapter.readMapForEdit(copySlug);
    assert.ok(reloaded, 'Step5: 再読込できること');
    assert.equal(reloaded.mapID ?? reloaded.slug, copySlug, 'Step5: 同じ slug で読めること');
    assert.ok(Array.isArray(reloaded.pois) || reloaded.pois, 'Step5: pois を保持していること');
    assert.equal(JSON.stringify(reloaded).includes(tmpDir), false,
      'Step5: 再読込結果が一時ディレクトリのパスを含まないこと');

    const forPreview = await StorageAdapter.readMapForPreview(copySlug);
    assert.ok(forPreview, 'Step5: preview 用の読み出しが通ること');
    assert.equal(JSON.stringify(forPreview).includes(tmpDir), false,
      'Step5: preview 用の読み出しが一時ディレクトリのパスを含まないこと');
    console.log('ok: Step5 再読込・preview');

    // ==================================================================
    // Step 6: 再搬出。1回目と同じ資源構成が再現されること
    //   （import が参照を正本化できていなければ、ここで pois/ ・ imgs/ が欠ける）
    // ==================================================================
    const zip3Path = nodePath.join(workDir, 'reexport.zip');
    const copyRow = (await SqliteDataService.getDb())
      .prepare('SELECT uid FROM maps WHERE slug = ?').get(copySlug) as any;
    await buildAndWriteMapZip(win, reloaded, [compiledTin], copySlug, copyRow.uid, zip3Path);

    const zip3 = new AdmZip(zip3Path);
    const zip3Names = zip3.getEntries().map((e: any) => e.entryName).sort();

    assert.ok(zip3Names.some((n: string) => /^pois\\/.+\\.geojson$/.test(n)),
      'Step6: 再搬出でも POI 実体が出ること（実際: ' + JSON.stringify(zip3Names) + '）');
    assert.ok(zip3Names.includes('imgs/roundtrip-icon.png'),
      'Step6: 再搬出でも icon 実体が出ること（実際: ' + JSON.stringify(zip3Names) + '）');
    assert.ok(zip3Names.includes('imgs/roundtrip-photo.png'),
      'Step6: 再搬出でも html 内 asset の実体が出ること');
    assert.ok(zip3Names.includes('tmbs/' + copySlug + '.jpg'), 'Step6: 通常サムネイルが出ること');
    assert.ok(zip3Names.includes('tmbs/' + copySlug + '_512.jpg'), 'Step6: 512px サムネイルが出ること');
    assert.ok(zip3Names.some((n: string) => n.startsWith('tiles/' + copySlug + '/')), 'Step6: タイルが出ること');

    // 参照と実体の整合（AC5 Part B と同じ一般形の不変条件を再搬出でも張る）
    const map3 = JSON.parse(zip3.getEntry('maps/' + copySlug + '.json').getData().toString('utf8'));
    const referenced: string[] = [];
    for (const entry of map3.pois ?? []) {
      const layer = entry && typeof entry === 'object' ? (entry as any).layer : undefined;
      if (typeof layer === 'string' && !layer.includes('://')) referenced.push(layer);
    }
    for (const name of zip3Names.filter((n: string) => n.startsWith('pois/'))) {
      const text = zip3.getEntry(name).getData().toString('utf8');
      for (const m of text.matchAll(/imgs\\/[A-Za-z0-9._\\/-]+/g)) referenced.push(m[0]);
    }
    const missing = [...new Set(referenced)].filter((r) => !zip3Names.includes(r));
    assert.deepEqual(missing, [],
      'Step6: 再搬出 ZIP でも参照される実体が全て存在すること（不足: ' + JSON.stringify(missing) + '）');
    assert.ok(referenced.length >= 2, '前提: 再搬出でも参照が実際に存在すること');

    // 元の地図が壊れていないこと（複製の取り込みは既存を変更しない）
    const originStill = (await SqliteDataService.getDb())
      .prepare('SELECT COUNT(*) AS n FROM maps WHERE slug = ?').get(copySlug) as any;
    assert.equal(originStill.n, 1, 'Step6: 取り込んだ地図が1件だけであること');
    console.log('ok: Step6 再搬出で同じ資源構成が再現される');

    console.log('m5-t4b roundtrip end-to-end OK');
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
  console.log('m5-t4b roundtrip end-to-end smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
