// M12-T13 smoke: resourceImageResolver / AppAssetService.fileUrlFor のパス封じ込め防御多層化。
// m12-t1-hotfix-1 smoke と同型の harness（electron/electron-store stub + vite ssr build）で
// resolver 関数を直接起動し、以下を検証する:
//   AC1: resolveMapListImage は '..' を含む fileKey で saveFolder 外の file:// を返さず null
//        （tmbs 経路・tiles fallback 経路の両方）
//   AC2: resolveBaseMapListImage は兄弟ディレクトリ ({saveFolder}-x/...) への thumbnail で null
//        （startsWith(saveFolder) は通るが startsWith(saveFolder + sep) で除外される）
//   AC3: resolveBaseMapListImage の legacyPath も外なら null（多層化）
//   AC4: AppAssetService.fileUrlFor は兄弟ディレクトリ ({saveFolder}-x) への relPath で null
//   AC5: 正常系（tmbs/tiles/saveFolder 内の thumbnail/legacy/img）は現行どおり file:// を返す（非退行）
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm12-t13-containment-'));
const entryFile = path.join(workDir, 'm12-t13-containment-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm12-t13-containment-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditor'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const dialog = {
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const ipcMain = {
        handle(channel: string, fn: any) { handlers.set(channel, fn); },
        removeHandler() {},
      };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
      };
    `
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
      import nodePath from 'node:path';

      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
      const dataDir = ${JSON.stringify(dataDir)};
      const workDir = ${JSON.stringify(workDir)};

      const { __handlers } = await import(${JSON.stringify(electronStubFile)});
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const { resolveMapListImage, resolveBaseMapListImage } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/resourceImageResolver.ts'))});
      const { isUnderFolder } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/resourceAssets.ts'))});
      const { default: AppAssetService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/appAssetService.ts'))});

      // ---- AC1: resolveMapListImage の fileKey 封じ込め ----
      // (1-a) tmbs 経路: fileKey = '../../escape-tmbs' → saveFolder 外へ脱出
      //   path.join(saveFolder/tmbs, '../../escape-tmbs.jpg') = parent(saveFolder)/escape-tmbs.jpg
      //   ※ '../' 一つだけでは saveFolder に戻ってしまうため、外へ出るには二つ上が必要
      await fsWriteFile(nodePath.join(workDir, 'escape-tmbs.jpg'), PNG);
      const ac1Tmbs = await resolveMapListImage({ uid: '../../escape-tmbs' });
      assert.equal(ac1Tmbs, null,
        'AC1: fileKey が saveFolder 外へ脱出する tmbs パスは null（file:// を返さない）: ' + ac1Tmbs);
      console.log('ok: AC1 (tmbs) fileKey escaping saveFolder returns null');

      // (1-b) tiles fallback 経路: tmbs を空にして tiles 側に脱出ファイルを置く
      //   fileKey = '../../escape-tiles' → path.join(saveFolder/tiles, '../../escape-tiles/0/0')
      //   = parent(saveFolder)/escape-tiles/0/0
      const escapeTilesDir = nodePath.join(workDir, 'escape-tiles', '0', '0');
      await fsMkdir(escapeTilesDir, { recursive: true });
      await fsWriteFile(nodePath.join(escapeTilesDir, '0.png'), PNG);
      const ac1Tiles = await resolveMapListImage({ uid: '../../escape-tiles' });
      assert.equal(ac1Tiles, null,
        'AC1: tiles fallback も fileKey が脱出すれば null: ' + ac1Tiles);
      console.log('ok: AC1 (tiles fallback) fileKey escaping saveFolder returns null');

      // (1-c) 正常系（uid が UUID を想定した素性もので tmbs に実体がある）は file:// を返す
      const okUid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const tmbsDir = nodePath.join(dataDir, 'tmbs');
      await fsMkdir(tmbsDir, { recursive: true });
      await fsWriteFile(nodePath.join(tmbsDir, okUid + '.jpg'), PNG);
      const ac1Ok = await resolveMapListImage({ uid: okUid });
      assert.ok(ac1Ok && ac1Ok.startsWith('file://'),
        'AC1 正常系: 素性 fileKey の tmbs は file:// を返す: ' + ac1Ok);
      console.log('ok: AC1 (non-regression) regular tmbs returns file://');

      // ---- AC2: resolveBaseMapListImage の兄弟ディレクトリ排除 ----
      // saveFolder の兄弟として {saveFolder}-x ディレクトリを作り、thumbnail を '../{basename}-x/...' で指定
      const baseName = nodePath.basename(dataDir); // 'data'
      const siblingDir = nodePath.join(nodePath.dirname(dataDir), baseName + '-x');
      await fsMkdir(siblingDir, { recursive: true });
      await fsWriteFile(nodePath.join(siblingDir, 'thumb.png'), PNG);
      // thumbnail を '../data-x/thumb.png' とすると
      //   path.resolve(path.join(saveFolder, '../data-x/thumb.png'))
      //   = path.resolve(parent + '/data-x/thumb.png')
      //   = siblingDir/thumb.png （saveFolder 外の兄弟ディレクトリ）
      const ac2Thumb = resolveBaseMapListImage({ data: { thumbnail: '../' + baseName + '-x/thumb.png' } });
      assert.equal(ac2Thumb, null,
        'AC2: 兄弟ディレクトリ ({saveFolder}-x) への thumbnail は null: ' + ac2Thumb);
      console.log('ok: AC2 sibling directory thumbnail returns null');

      // (2-b) 正常系: saveFolder 内の thumbnail は file:// を返す（非退行）
      const insideThumbDir = nodePath.join(dataDir, 'thumbnails');
      await fsMkdir(insideThumbDir, { recursive: true });
      await fsWriteFile(nodePath.join(insideThumbDir, 'ok.png'), PNG);
      const ac2Ok = resolveBaseMapListImage({ data: { thumbnail: 'thumbnails/ok.png' } });
      assert.ok(ac2Ok && ac2Ok.startsWith('file://'),
        'AC2 正常系: saveFolder 内 thumbnail は file:// を返す: ' + ac2Ok);
      console.log('ok: AC2 (non-regression) saveFolder-inside thumbnail returns file://');

      // ---- AC3: legacyPath 多層化 ----
      // mapID に '../../' を含めて saveFolder 外の legacy ファイルを指す
      // legacyPath = path.join(saveFolder, 'tmbs', '../../escape-legacy_menu.jpg')
      //            = parent(saveFolder)/escape-legacy_menu.jpg （tmbs と saveFolder の二階層を脱出）
      //   ※ '../' 一つだけでは saveFolder に戻ってしまうため、外へ出るには二つ上が必要
      await fsWriteFile(nodePath.join(workDir, 'escape-legacy_menu.jpg'), PNG);
      const ac3Legacy = resolveBaseMapListImage({ mapID: '../../escape-legacy', data: {} });
      assert.equal(ac3Legacy, null,
        'AC3: legacyPath が saveFolder 外へ脱出する mapID は null: ' + ac3Legacy);
      console.log('ok: AC3 legacyPath escaping saveFolder returns null');

      // (3-b) 正常系: 素性 mapID の legacy も現行どおり file:// を返す（非退行）
      const okMapID = 'regularmap';
      await fsWriteFile(nodePath.join(tmbsDir, okMapID + '_menu.jpg'), PNG);
      const ac3Ok = resolveBaseMapListImage({ mapID: okMapID, data: {} });
      assert.ok(ac3Ok && ac3Ok.startsWith('file://'),
        'AC3 正常系: 素性 mapID の legacy は file:// を返す: ' + ac3Ok);
      console.log('ok: AC3 (non-regression) regular legacy path returns file://');

      // ---- AC4: AppAssetService.fileUrlFor の兄弟ディレクトリ排除 ----
      // relPath = '../{basename}-x/thumb.png' → sibling ディレクトリへ脱出
      await fsWriteFile(nodePath.join(siblingDir, 'appicon.png'), PNG);
      const ac4 = AppAssetService.fileUrlFor('../' + baseName + '-x/appicon.png');
      assert.equal(ac4, null,
        'AC4: 兄弟ディレクトリ ({saveFolder}-x) への relPath は null: ' + ac4);
      console.log('ok: AC4 fileUrlFor sibling directory relPath returns null');

      // (4-b) 正常系: saveFolder 内の iconSource は file:// を返す（非退行）
      const appImgDir = nodePath.join(dataDir, 'img');
      await fsMkdir(appImgDir, { recursive: true });
      await fsWriteFile(nodePath.join(appImgDir, 'appicon.png'), PNG);
      const ac4Ok = AppAssetService.fileUrlFor('img/appicon.png');
      assert.ok(ac4Ok && ac4Ok.startsWith('file://'),
        'AC4 正常系: saveFolder 内 iconSource は file:// を返す: ' + ac4Ok);
      console.log('ok: AC4 (non-regression) saveFolder-inside iconSource returns file://');

      // (4-c) basemap_icons/ 経路は resourceAssetFileUrl 経由で非退行
      const ac4Builtin = AppAssetService.fileUrlFor('basemap_icons/does-not-exist.png');
      assert.equal(ac4Builtin, null,
        'AC4: 存在しない basemap_icons は null（非退行; 経路が生きていることの確認）');
      console.log('ok: AC4 (non-regression) basemap_icons/ route preserved');

      // ---- isUnderFolder 共有 util 自体の基本契約（ドキュメント化） ----
      assert.equal(isUnderFolder(nodePath.join(dataDir, 'foo'), dataDir), true,
        'isUnderFolder: saveFolder 直下は true');
      assert.equal(isUnderFolder(nodePath.join(dataDir, 'sub', 'foo'), dataDir), true,
        'isUnderFolder: saveFolder 配下は true');
      assert.equal(isUnderFolder(nodePath.join(nodePath.dirname(dataDir), baseName + '-x', 'foo'), dataDir), false,
        'isUnderFolder: 兄弟ディレクトリ ({saveFolder}-x) は false');
      // ※ base ちょうど（folder 自身）は startsWith(base + sep) で false となる設計（iconSetFilePath と同形式。
      //   対象は常に配下ファイルのため実害なし = 設計 Info1）
      assert.equal(isUnderFolder(dataDir, dataDir), false,
        'isUnderFolder: base ちょうどは false（対象は常に配下ファイルのため実害なし）');
      console.log('ok: isUnderFolder util contract');

      console.log('m12-t13 smoke: ALL PASS');
    `
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
        external: ['@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/, 'jimp'],
        output: {
          entryFileNames: 'm12-t13-containment-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
