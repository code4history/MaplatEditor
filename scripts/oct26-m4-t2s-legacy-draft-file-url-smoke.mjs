// oct26-m4-t2s（第 2 版）smoke: v1.0.0 形式（file://）の url_ を持つ下書きを保存しても、画像が失われないこと（MAJ-1）。
//
// 経緯: 公開済み v1.0.0（2026-08-24）で画像を取り込み、保存せず終了すると、hot-exit 下書き（electron-store）に
//   mapData が丸ごと残る。その url_ は v1.0.0 の imageCutter が作った
//   `file:///<userData>/draft-tiles/<uid>/{z}/{x}/{y}.jpg`。m4-t2（#105）以降の版でこの下書きを復元して保存すると、
//   保存・staging 判定の入口が file:// を認識せず、Success が返るのにタイル・原本が恒久領域へ移らず、
//   下書きの削除（AssetDraftService.onRemoved）で staging ごと画像が消えていた。
//
// sandbox 方式は m12-t17 / m5-t7 と同じ（vite SSR ビルド + electron / electron-store スタブ）。
// userData・saveFolder には空白と非 ASCII を含め、v1.0.0 の file-url の符号化（encodeURI 系）を復号できることも確かめる。
// MAPLAT_E2E_ROOT は空にして、実運用と同じ `userData/draft-tiles` を staging ルートにする。
//
// 断言（すべて走らせてから集約する）:
//   [1] 判定関数: 旧 file:// の staging url_ を isDraftTileUrl が staging と認め、resolveStagingDirFromUrl が staging dir を返す
//   [2] mapedit:stagingStatus: 旧 file:// の staging url_ で、staging が在れば alive=true・無ければ alive=false（復元時警告が働く）。
//       後方互換 tmp の旧 file:// url_ も、tmp/tiles が無ければ alive=false
//   [3] save(create): Success・恒久 url（app://bundle/__local の契約）・tiles/<uid> へ移動・originals/<uid>.jpg・tmbs/<uid>.jpg・
//       staging は残らない。続けて下書き削除と同じ手順で staging を消しても、タイルと原本は残る
//   [4] save(create): 旧 file:// の staging url_ で staging が既に無い → DB に触れず Error（mapedit.staging.missing_tiles）
//   [5] save(create): 旧 file:// の後方互換 tmp url_（tmpFolder/tiles）→ Success・恒久 url・originals/<uid>.jpg
//   [6] save(create/clone): 旧 file:// の複製元タイル url_ → 複製先を指す恒久 url が返る
//   [7] 許可ルート外・境界外の file://（兄弟 dir・'..' 脱出・%2F・{z}/{x}/{y} の無い形）は staging と認めず、移動もしない
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'oct26-m4-t2s-legacy-draft-'));
const entryFile = path.join(workDir, 'legacy-draft-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'legacy-draft-smoke.mjs');

const userDataDir = path.join(workDir, 'user data 下書き');
const saveDir = path.join(workDir, 'save データ');
const tempDir = path.join(workDir, 'temp');

await writeFile(
  electronStubFile,
  `
    const handlers = new Map();
    export const __handlers = handlers;
    export const app = {
      getPath(name: string) {
        if (name === 'userData') return ${JSON.stringify(userDataDir)};
        if (name === 'temp') return ${JSON.stringify(tempDir)};
        if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
        if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
        return ${JSON.stringify(workDir)};
      },
      getName() { return 'MaplatEditor'; },
      whenReady() { return Promise.resolve(); },
      exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
    };
    export const ipcMain = {
      handle: (ch: string, fn: any) => handlers.set(ch, fn),
      removeHandler: (ch: string) => handlers.delete(ch),
    };
    export const dialog = {
      async showSaveDialog() { return { canceled: true, filePath: undefined }; },
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showMessageBox() { return { response: 0 }; },
    };
    export const BrowserWindow = class {
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
    export const shell = { trashItem(_p: string) { return Promise.resolve(); } };
  `,
);
await writeFile(
  electronStoreStubFile,
  `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `,
);

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import fs from 'fs-extra';
    import nodePath from 'node:path';

    const failures: string[] = [];
    const check = async (label: string, fn: () => unknown) => {
      try { await fn(); console.log('ok: ' + label); }
      catch (e: any) { failures.push(label + ' — ' + (e?.message ?? String(e))); console.log('NG: ' + label + ' — ' + (e?.message ?? String(e))); }
    };

    // v1.0.0 が url_ を作ったビルダー（file-url 4.0.0 の fileUrl）と同じ手順を、依存を import せずに書く。
    // 製品の依存から file-url が外れても、既存データの形（入力）はこの形のまま残るため。
    const fileUrlV1 = (filePath: string) => {
      let p = nodePath.resolve(filePath).replace(/\\\\/g, '/');
      if (p[0] !== '/') p = '/' + p;
      return encodeURI('file://' + p).replace(/[?#]/g, encodeURIComponent);
    };
    // 恒久 url の契約（oct26-m4-t2ff 第 2 版）: renderer と同一 origin の app://bundle/__local/<abs>。
    // 製品の定数・ビルダーを使わずに独立に書く（自己参照にしない）
    const CONTRACT_PREFIX = 'app://bundle/__local/';

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(saveDir)});
    SettingsService.set('lang', 'ja');
    const { default: MapEditService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/MapEditService.ts'))});
    const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
    const { draftTileRoot, isDraftTileUrl, resolveStagingDirFromUrl, resolveDraftTileDir } =
      await import(${JSON.stringify(path.join(projectRoot, 'electron/services/draftTilePaths.ts'))});
    const { appUrlToLocalPath } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/appScheme.ts'))});
    const { registerMapEditHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/mapedit.ts'))});
    const { __handlers } = await import(${JSON.stringify(electronStubFile)});
    registerMapEditHandlers();
    const stagingStatus = __handlers.get('mapedit:stagingStatus');

    const saveDir = ${JSON.stringify(saveDir)};
    const tilesDir = nodePath.join(saveDir, 'tiles');
    const originalsDir = nodePath.join(saveDir, 'originals');
    const tmbsDir = nodePath.join(saveDir, 'tmbs');
    const expectedStagingRoot = nodePath.join(${JSON.stringify(userDataDir)}, 'draft-tiles');

    const mapObject = (mapID: string, url_: string) => ({
      mapID, imageExtension: 'jpg', url_, width: 256, height: 256, gcps: [], edges: [], sub_maps: [],
    });
    async function makeStaging(uid: string, tag: string) {
      const dir = nodePath.join(draftTileRoot, uid);
      await fs.ensureDir(nodePath.join(dir, '0', '0'));
      await fs.writeFile(nodePath.join(dir, '0', '0', '0.jpg'), 'tile-' + tag);
      await fs.writeFile(nodePath.join(dir, 'original.jpg'), 'original-' + tag);
      await fs.writeFile(nodePath.join(dir, 'thumbnail.jpg'), 'thumb-' + tag);
      return dir;
    }
    // 恒久 url の実パス部分（テンプレート手前）
    const urlDir = (url: string) => appUrlToLocalPath(String(url).replace(/\\/\\{z\\}\\/\\{x\\}\\/\\{y\\}\\.jpg$/, ''));

    await check('[0] 前提: staging ルートは userData/draft-tiles（v1.0.0 と同じ置き場所）', () => {
      assert.equal(draftTileRoot, expectedStagingRoot);
    });

    // ---------------- [1] 判定関数 ----------------
    const UID1 = 'd1111111-1111-4111-8111-111111111111';
    const staging1 = await makeStaging(UID1, 'one');
    const legacy1 = fileUrlV1(staging1) + '/{z}/{x}/{y}.jpg';
    console.log('fixture url_ (v1.0.0 形式): ' + legacy1);
    await check('[1-a] fixture は v1.0.0 形式（file:// と空白・非 ASCII の percent-encoding）', () => {
      assert.ok(legacy1.startsWith('file:///'), legacy1);
      assert.ok(legacy1.includes('user%20data%20%E4%B8%8B%E6%9B%B8%E3%81%8D'), legacy1);
    });
    await check('[1-b] isDraftTileUrl は旧 file:// の staging url_ を staging と認める', () => {
      assert.equal(isDraftTileUrl(draftTileRoot, legacy1), true);
    });
    await check('[1-c] resolveStagingDirFromUrl は旧 file:// の staging url_ から staging dir を導出する', () => {
      assert.equal(resolveStagingDirFromUrl(draftTileRoot, legacy1), staging1);
    });

    // ---------------- [2] mapedit:stagingStatus ----------------
    await check('[2-a] stagingStatus: 旧 file:// の staging url_ で staging が在れば alive=true', async () => {
      assert.ok(stagingStatus, 'mapedit:stagingStatus が登録されていない');
      const st = await stagingStatus({}, legacy1);
      assert.equal(st.alive, true, JSON.stringify(st));
    });
    await check('[2-b] stagingStatus: 旧 file:// の staging url_ で staging が無ければ alive=false（復元時警告が働く）', async () => {
      const goneUrl = fileUrlV1(nodePath.join(draftTileRoot, 'd9999999-9999-4999-8999-999999999999')) + '/{z}/{x}/{y}.jpg';
      const st = await stagingStatus({}, goneUrl);
      assert.equal(st.alive, false, JSON.stringify(st));
    });

    await check('[2-c] stagingStatus: 旧 file:// の後方互換 tmp url_ で tmp/tiles が無ければ alive=false', async () => {
      const tmpTiles = nodePath.join(SettingsService.get('tmpFolder'), 'tiles');
      assert.equal(await fs.pathExists(tmpTiles), false, '前提: この時点で tmp/tiles は無い');
      const st = await stagingStatus({}, fileUrlV1(tmpTiles) + '/{z}/{x}/{y}.jpg');
      assert.equal(st.alive, false, JSON.stringify(st));
    });

    // ---------------- [3] save(create) で移動し、下書き削除後も画像が残る ----------------
    const res3 = await MapEditService.save({ mapObject: mapObject('legacy-draft-one', legacy1), tins: [], slug: 'legacy-draft-one', uid: UID1, create: true });
    console.log('save [3]: ' + JSON.stringify(res3));
    await check('[3-a] save は Success', () => { assert.equal(res3.result, 'Success'); });
    await check('[3-b] 恒久 url は app://bundle/__local の契約で、実パスは tiles/<uid>・テンプレートを保つ', () => {
      assert.equal(typeof res3.url, 'string', '恒久 url が返らない（staging と認識されていない）');
      assert.ok(res3.url.startsWith(CONTRACT_PREFIX), res3.url);
      assert.ok(res3.url.endsWith('/{z}/{x}/{y}.jpg'), res3.url);
      assert.equal(urlDir(res3.url), nodePath.join(tilesDir, UID1), res3.url);
    });
    await check('[3-c] タイル・原本・サムネイルが恒久領域へ移り、staging は残らない', async () => {
      assert.equal(await fs.readFile(nodePath.join(tilesDir, UID1, '0', '0', '0.jpg'), 'utf8'), 'tile-one');
      assert.equal(await fs.readFile(nodePath.join(originalsDir, UID1 + '.jpg'), 'utf8'), 'original-one');
      assert.equal(await fs.readFile(nodePath.join(tmbsDir, UID1 + '.jpg'), 'utf8'), 'thumb-one');
      assert.equal(await fs.pathExists(staging1), false, 'staging が残っている（移動されていない）');
    });
    // 下書き削除（AssetDraftService.onRemoved）と同じ手順: resolveDraftTileDir で解決して fs.remove
    {
      const draftDir = resolveDraftTileDir(draftTileRoot, UID1);
      if (draftDir) await fs.remove(draftDir);
    }
    await check('[3-d] 下書き削除で staging を消した後も、タイルと原本は残る', async () => {
      assert.equal(await fs.pathExists(nodePath.join(tilesDir, UID1, '0', '0', '0.jpg')), true, 'タイルが失われた');
      assert.equal(await fs.pathExists(nodePath.join(originalsDir, UID1 + '.jpg')), true, '原本が失われた');
    });

    // ---------------- [4] staging 欠損は DB に触れず Error ----------------
    const UID4 = 'd4444444-4444-4444-8444-444444444444';
    const legacy4 = fileUrlV1(nodePath.join(draftTileRoot, UID4)) + '/{z}/{x}/{y}.jpg';
    const res4 = await MapEditService.save({ mapObject: mapObject('legacy-draft-gone', legacy4), tins: [], slug: 'legacy-draft-gone', uid: UID4, create: true });
    await check('[4] staging が既に無い旧 file:// url_ は Error（mapedit.staging.missing_tiles）で DB 行を作らない', async () => {
      assert.deepEqual(res4, { result: 'Error', errorKey: 'mapedit.staging.missing_tiles' }, JSON.stringify(res4));
      assert.ok(!(await SqliteDataService.findMap(UID4)), 'DB 行が作られている');
    });

    // ---------------- [5] 後方互換 tmp の旧 file:// ----------------
    const UID5 = 'd5555555-5555-4555-8555-555555555555';
    const tmpTileFolder = nodePath.join(SettingsService.get('tmpFolder'), 'tiles');
    await fs.ensureDir(nodePath.join(tmpTileFolder, '0', '0'));
    await fs.writeFile(nodePath.join(tmpTileFolder, '0', '0', '0.jpg'), 'tile-tmp');
    await fs.writeFile(nodePath.join(tmpTileFolder, 'original.jpg'), 'original-tmp');
    const legacy5 = fileUrlV1(tmpTileFolder) + '/{z}/{x}/{y}.jpg';
    const res5 = await MapEditService.save({ mapObject: mapObject('legacy-tmp', legacy5), tins: [], slug: 'legacy-tmp', uid: UID5, create: true });
    console.log('save [5]: ' + JSON.stringify(res5));
    await check('[5] 旧 file:// の tmp url_ も移動され、恒久 url と originals/<uid>.jpg ができる', async () => {
      assert.equal(res5.result, 'Success', JSON.stringify(res5));
      assert.equal(typeof res5.url, 'string', '恒久 url が返らない（tmp と認識されていない）');
      assert.ok(res5.url.startsWith(CONTRACT_PREFIX), res5.url);
      assert.equal(urlDir(res5.url), nodePath.join(tilesDir, UID5), res5.url);
      assert.equal(await fs.readFile(nodePath.join(tilesDir, UID5, '0', '0', '0.jpg'), 'utf8'), 'tile-tmp');
      assert.equal(await fs.readFile(nodePath.join(originalsDir, UID5 + '.jpg'), 'utf8'), 'original-tmp');
    });

    // ---------------- [6] 複製元の旧 file:// ----------------
    const UID6 = 'd6666666-6666-4666-8666-666666666666';
    const legacy6 = fileUrlV1(nodePath.join(tilesDir, UID1)) + '/{z}/{x}/{y}.jpg';
    const res6 = await MapEditService.save({ mapObject: mapObject('legacy-clone', legacy6), tins: [], slug: 'legacy-clone', uid: UID6, copyFromUid: UID1, create: true });
    console.log('save [6]: ' + JSON.stringify(res6));
    await check('[6] 旧 file:// の複製元タイル url_ でも、複製先を指す恒久 url が返る', async () => {
      assert.equal(res6.result, 'Success', JSON.stringify(res6));
      assert.equal(typeof res6.url, 'string', '恒久 url が返らない');
      assert.ok(res6.url.startsWith(CONTRACT_PREFIX), res6.url);
      assert.equal(urlDir(res6.url), nodePath.join(tilesDir, UID6), res6.url);
      assert.equal(await fs.readFile(nodePath.join(tilesDir, UID6, '0', '0', '0.jpg'), 'utf8'), 'tile-one');
    });

    // ---------------- [7] 許可ルート外・境界外は staging と認めない ----------------
    const UID7 = 'd7777777-7777-4777-8777-777777777777';
    const siblingDir = nodePath.join(draftTileRoot + '-evil', UID7);
    await fs.ensureDir(nodePath.join(siblingDir, '0', '0'));
    await fs.writeFile(nodePath.join(siblingDir, '0', '0', '0.jpg'), 'tile-evil');
    await fs.writeFile(nodePath.join(siblingDir, 'original.jpg'), 'original-evil');
    const outsideUrls = {
      sibling: fileUrlV1(siblingDir) + '/{z}/{x}/{y}.jpg',
      dotdot: fileUrlV1(draftTileRoot) + '/../' + nodePath.basename(draftTileRoot) + '-evil/' + UID7 + '/{z}/{x}/{y}.jpg',
      encodedSlash: fileUrlV1(draftTileRoot) + '/x%2F' + UID7 + '/{z}/{x}/{y}.jpg',
      noTemplate: fileUrlV1(nodePath.join(draftTileRoot, UID7)),
      elsewhere: 'file:///etc/maplat/' + UID7 + '/{z}/{x}/{y}.jpg',
    };
    await check('[7-a] 境界外の file://（兄弟 dir・.. 脱出・%2F・テンプレート無し・許可ルート外）は staging と認めない', () => {
      for (const [k, u] of Object.entries(outsideUrls)) {
        assert.equal(isDraftTileUrl(draftTileRoot, u), false, k + ': ' + u);
        assert.equal(resolveStagingDirFromUrl(draftTileRoot, u), null, k + ': ' + u);
      }
    });
    const res7 = await MapEditService.save({ mapObject: mapObject('legacy-sibling', outsideUrls.sibling), tins: [], slug: 'legacy-sibling', uid: UID7, create: true });
    await check('[7-b] 兄弟 dir の file:// で保存しても、兄弟 dir から何も移さず恒久 url も返さない', async () => {
      assert.equal(res7.result, 'Success', JSON.stringify(res7));
      assert.equal(res7.url, undefined, JSON.stringify(res7));
      assert.equal(await fs.readFile(nodePath.join(siblingDir, '0', '0', '0.jpg'), 'utf8'), 'tile-evil');
      assert.equal(await fs.pathExists(nodePath.join(tilesDir, UID7)), false);
      assert.equal(await fs.pathExists(nodePath.join(originalsDir, UID7 + '.jpg')), false);
    });

    if (failures.length > 0) {
      console.log('FAILED ' + failures.length + ' 件:');
      for (const f of failures) console.log('  - ' + f);
      process.exit(1);
    }
    console.log('oct26-m4-t2s legacy draft file:// url_ smoke: ALL PASS');
    process.exit(0);
  `,
);

await build({
  configFile: false,
  logLevel: 'error',
  resolve: {
    alias: [
      { find: 'electron', replacement: electronStubFile },
      { find: 'electron-store', replacement: electronStoreStubFile },
    ],
  },
  build: {
    emptyOutDir: true,
    // SSR bundle だけが要る。public/ の複製は不要（数百ファイルの書き出しを避ける）
    copyPublicDir: false,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      external: ['jimp', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform'],
      output: { entryFileNames: 'legacy-draft-smoke.mjs', format: 'es' },
    },
  },
});

try {
  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
    env: { ...process.env, MAPLAT_E2E_ROOT: '' },
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout);
  if (e.stderr) process.stderr.write(e.stderr);
  process.exitCode = 1;
}
// .tmp-smoke は破壊的操作禁止のため残置
