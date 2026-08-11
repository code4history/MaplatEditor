// m5-t5 AC2/AC3/AC4/AC5: 地図 ZIP import の slug 衝突を自動解決する（タスク設計 v1.4）。
//
// 固定する受け入れ条件:
//   AC2 同名 slug の地図 ZIP が 'Exist' にならず base-2 として取り込まれる
//   AC3 解決後 slug の一貫性 — DB の maps.slug / 返却 mapData.mapID / 再搬出 ZIP の
//       maps/<slug>.json がすべて一致する
//   AC4 ZIP 内の読みは **元 slug** のまま。衝突取込でも NoTile/NoTmb にならず、
//       タイル・通常/512px サムネイルが uid キーで格納される
//   AC5 連続衝突で base-2 → base-3。候補枯渇（base-100 まで実際に埋める）で 'Exist'
//
// 【slug の3系統を取り違えると何が起きるか】
//   読みを解決後 slug にする → ZIP にその名前は無いので NoTile / NoTmb へ化ける（AC4）
//   DB を元 slug のままにする → createMap が一意制約で落ちる
//   格納を slug キーにする   → ADR-0007 違反。改名のたびに実体移動が要る
// この3つを独立に検証するのが本 smoke の主目的である。
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
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t5-map-collision-'));
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
    import nodePath from 'node:path';
    import nodeFs from 'node:fs';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('tmpFolder', ${JSON.stringify(tmpDir)});
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { default: dataUploadService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/DataUploadService.ts'))});
    const { slugCandidate, SEQUENCE_MAX_INDEX } = await import(${JSON.stringify(path.join(projectRoot, 'src/utils/slugSequence.ts'))});
    const { buildAndWriteMapZip } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/mapDownloadZip.ts'))});

    // 地図 ZIP の最小 fixture。**ZIP 内の名前はすべて元 slug** である。
    const makeMapZip = (slug: string, opts: { with512?: boolean } = {}) => {
      const zip = new AdmZip();
      zip.addFile('maps/' + slug + '.json', Buffer.from(JSON.stringify({
        mapID: slug, title: '衝突テスト ' + slug, attr: 'test', lang: 'ja',
        width: 400, height: 300, gcps: [], edges: [],
      })));
      zip.addFile('tmbs/' + slug + '.jpg', Buffer.from('THUMB:' + slug));
      if (opts.with512) zip.addFile('tmbs/' + slug + '_512.webp', Buffer.from('THUMB512:' + slug));
      zip.addFile('tiles/' + slug + '/0/0/0.jpg', Buffer.from('TILE:' + slug));
      const p = nodePath.join(workDir, slug + '-' + Math.random().toString(36).slice(2) + '.zip');
      zip.writeZip(p);
      return p;
    };

    const slugOfUid = async (uid: string) => {
      const db = await SqliteDataService.getDb();
      return (db.prepare('SELECT slug FROM maps WHERE uid = ?').get(uid) as any)?.slug ?? null;
    };

    // =====================================================================
    // AC2: 同名 slug が 'Exist' にならず base-2 として取り込まれる
    // =====================================================================
    const BASE = 'collide';
    const first = await dataUploadService.extractZip(makeMapZip(BASE));
    assert.ok(first.mapData, 'AC2: 1件目は素の slug で取り込めること: ' + JSON.stringify(first).slice(0, 200));
    assert.equal(first.mapData.mapID, BASE, 'AC2: 1件目は衝突なし ∴ 元の名前そのもの');

    const second = await dataUploadService.extractZip(makeMapZip(BASE));
    assert.equal(second.err, undefined,
      'AC2: 同名 ZIP が Exist で止まらないこと（実際: ' + JSON.stringify(second).slice(0, 200) + '）');
    assert.ok(second.mapData, 'AC2: 2件目も取り込めること');
    assert.equal(second.mapData.mapID, slugCandidate(BASE, 2),
      'AC2: 2件目は正本の2番目の候補（collide-2）になること（実際: ' + second.mapData.mapID + '）');
    console.log('ok AC2: 同名 slug の地図 ZIP が base-2 として取り込まれる');

    // =====================================================================
    // AC3: 解決後 slug の一貫性（DB / 返却 / 再搬出名）
    // =====================================================================
    {
      const uid = second.mapData.uid;
      const dbSlug = await slugOfUid(uid);
      assert.equal(dbSlug, slugCandidate(BASE, 2), 'AC3: DB の maps.slug が解決後 slug');
      assert.equal(second.mapData.mapID, dbSlug, 'AC3: 返却 mapID が DB の slug と一致');

      // 再搬出: 解決後 slug で出す ∴ ZIP 内も maps/collide-2.json になる
      const win = { webContents: { send() {} }, isDestroyed() { return false; } } as any;
      const reexportPath = nodePath.join(workDir, 'reexport.zip');
      await buildAndWriteMapZip(win, { ...second.mapData, mapID: dbSlug }, [], dbSlug, uid, reexportPath);
      const names = new AdmZip(reexportPath).getEntries().map((e: any) => e.entryName);
      assert.ok(names.includes('maps/' + dbSlug + '.json'),
        'AC3: 再搬出 ZIP が maps/' + dbSlug + '.json を含むこと（実際: ' + JSON.stringify(names) + '）');
      assert.equal(names.includes('maps/' + BASE + '.json'), false,
        'AC3: 元 slug の名前で出てはならない（再搬出名は解決後 slug）');
      console.log('ok AC3: DB / 返却 mapID / 再搬出名がすべて解決後 slug で一致');
    }

    // =====================================================================
    // AC4: 読みは元 slug・格納は uid（3系統の分離）
    // =====================================================================
    {
      // 512px 付きで衝突させる。**ZIP 内の名前は元 slug のまま**であり、
      // 読み出しを解決後 slug にしていたらここで NoTile / NoTmb になる。
      const third = await dataUploadService.extractZip(makeMapZip(BASE, { with512: true }));
      assert.equal(third.err, undefined,
        'AC4: 衝突取込でも NoTile/NoTmb にならないこと（読みは元 slug のはず。実際: '
          + JSON.stringify(third).slice(0, 200) + '）');
      const uid = third.mapData.uid;
      assert.equal(third.mapData.mapID, slugCandidate(BASE, 3), 'AC4: 3件目は collide-3');

      // 格納は uid キー（ADR-0007）。解決後 slug でも元 slug でもない
      assert.equal(nodeFs.existsSync(nodePath.join(dataDir, 'tiles', uid)), true,
        'AC4: タイルが tiles/<uid> へ格納されること');
      assert.equal(nodeFs.existsSync(nodePath.join(dataDir, 'tmbs', uid + '.jpg')), true,
        'AC4: 通常サムネイルが tmbs/<uid>.jpg へ格納されること');
      assert.equal(nodeFs.existsSync(nodePath.join(dataDir, 'tmbs', uid + '_512.webp')), true,
        'AC4: 512px サムネイルが tmbs/<uid>_512.webp へ格納されること');
      assert.equal(nodeFs.existsSync(nodePath.join(dataDir, 'tiles', third.mapData.mapID)), false,
        'AC4: 格納先が slug キーになっていないこと（ADR-0007）');

      // 中身が今回の ZIP のものであること（前回取込のものを拾っていない）
      const tile = nodeFs.readFileSync(nodePath.join(dataDir, 'tiles', uid, '0', '0', '0.jpg'), 'utf8');
      assert.equal(tile, 'TILE:' + BASE, 'AC4: 実体は元 slug 名の entry から読まれていること');
      console.log('ok AC4: 読み=元 slug / 格納=uid / DB=解決後 slug の3系統が分離している');
    }

    // =====================================================================
    // AC5: 連続衝突と候補枯渇
    // =====================================================================
    {
      // 既に collide / collide-2 / collide-3 が埋まっている → 次は collide-4
      const fourth = await dataUploadService.extractZip(makeMapZip(BASE));
      assert.equal(fourth.mapData.mapID, slugCandidate(BASE, 4),
        'AC5: 連続衝突で次の候補へ進むこと（実際: ' + fourth.mapData.mapID + '）');

      // 枯渇: **上限を下げず実際に埋める**。候補名は正本から生成する
      // （手書きすると規則変更時に埋め残しが出て、枯渇が発火せず黙って Success になる）
      const EX = 'exhaust';
      for (let n = 1; n <= SEQUENCE_MAX_INDEX; n++) {
        const s = slugCandidate(EX, n);
        await SqliteDataService.createMap(s, { mapID: s, title: s, gcps: [], edges: [] });
      }
      const exhausted = await dataUploadService.extractZip(makeMapZip(EX));
      assert.equal(exhausted.err, 'Exist',
        'AC5: 候補枯渇は Exist（実際: ' + JSON.stringify(exhausted).slice(0, 200) + '）');
      assert.equal(exhausted.mapData, undefined, 'AC5: 枯渇時は地図を作らない');
      console.log('ok AC5: 連続衝突で候補が進み、base-100 まで枯渇すると Exist');
    }

    console.log('m5-t5 map import slug collision OK');
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
  console.log('m5-t5 map import slug collision smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
