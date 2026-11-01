// IIIF から配信する地図（タイルの実体を持たない地図）で、URL の無い地図を前提にしている
// 経路が壊れないことを確かめる smoke。
//
// 確かめること:
//   (A 保存) URL の無い地図を新規に保存すると、下書きの場所（draft-tiles/<uid>）に置いた
//            サムネイル 2 枚が tmbs の正しい場所へ移り、tiles/<uid> は作られない
//   (A 複製) 複製した地図に delivery と iiif が写る（呼び出し側が渡さなくても写る）
//   (D ZIP)  tiles/ を含まず delivery を持つ地図の ZIP を取り込めて、url_ を作らない
//   (E 一覧) 一覧の画像が tmbs から出る（落ちない）
//   (E プレビュー) delivery を持つ地図で url_ が無くても MapPurposeService が落ちない
//   取り込みをやめたら下書きのサムネイルが残らない（discardDraft・期限切れ）
//
// 既存の smoke と同じ harness（electron/electron-store スタブ + vite の ssr build）で
// main のサービスをそのまま起動し、実際にファイルと DB を触って確かめる。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'iiif-map-tiles-'));
const entryFile = path.join(workDir, 'iiif-map-tiles-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'iiif-map-tiles-smoke.mjs');

const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
const appSchemePath = path.join(projectRoot, 'electron/utils/appScheme.ts');
const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');
const dataUploadServicePath = path.join(projectRoot, 'electron/services/DataUploadService.ts');
const mapPurposeServicePath = path.join(projectRoot, 'electron/services/MapPurposeService.ts');
const resolverPath = path.join(projectRoot, 'electron/services/resourceImageResolver.ts');
const draftPathsPath = path.join(projectRoot, 'electron/services/draftTilePaths.ts');
const iiifImportServicePath = path.join(projectRoot, 'electron/services/iiifImportService.ts');
const thumbnailPathsPath = path.join(projectRoot, 'src/utils/thumbnailPaths.ts');

try {
  await writeFile(
    electronStubFile,
    `
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          if (name === 'userData') return ${JSON.stringify(path.join(workDir, 'userData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditor'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const dialog = {
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showSaveDialog() {
          return Promise.resolve({ canceled: false, filePath: ${JSON.stringify(path.join(workDir, 'export', 'iiif-map.zip'))} });
        },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const ipcMain = {
        handle() {},
        removeHandler() {},
      };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
        static fromWebContents() { return null; }
      };
      export const shell = {
        trashItem() { return Promise.resolve(); },
      };
      export const session = {
        defaultSession: {
          clearStorageData() { return Promise.resolve(); },
        },
      };
    `,
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
    `,
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import fs from 'fs-extra';
      import path from 'node:path';
      import AdmZip from 'adm-zip';

      const workDir = ${JSON.stringify(workDir)};
      const saveFolder = path.join(workDir, 'data');
      await fs.ensureDir(saveFolder);
      await fs.ensureDir(path.join(workDir, 'export'));

      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', saveFolder);
      SettingsService.set('lang', 'ja');

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      const { default: DataUploadService } = await import(${JSON.stringify(dataUploadServicePath)});
      const { default: MapPurposeService } = await import(${JSON.stringify(mapPurposeServicePath)});
      const { resolveMapListImage } = await import(${JSON.stringify(resolverPath)});
      const { appUrlToLocalPath } = await import(${JSON.stringify(appSchemePath)});
      const { draftTileRoot, resolveDraftTileDir } = await import(${JSON.stringify(draftPathsPath)});
      const {
        THUMB_512_TMP_BASENAME,
        thumb512PathFor,
        thumb52PathFor,
      } = await import(${JSON.stringify(thumbnailPathsPath)});
      const {
        stageDraft,
        iiifDraftFolder,
        takeDraft,
        discardDraft,
        setIiifDraftStoreClock,
        IIIF_DRAFT_TTL_MS,
      } = await import(${JSON.stringify(iiifImportServicePath)});

      const delivery = {
        type: 'iiifImage',
        url: 'https://example.org/iiif/iiif-map-a/info.json',
      };
      const iiif = {
        manifestUrl: 'https://example.org/iiif/manifest.json',
        canvasId: 'https://example.org/iiif/canvas/1',
        copiedAt: '2026-10-28T00:00:00.000Z',
      };
      const gcps = [
        [[0, 0], [139.7, 35.7]],
        [[4000, 0], [139.8, 35.7]],
        [[0, 3000], [139.7, 35.6]],
      ];
      const mapObjectFor = (mapID) => ({
        mapID,
        imageExtension: 'jpg',
        width: 4000,
        height: 3000,
        gcps,
        edges: [],
        sub_maps: [],
        strictMode: 'strict',
        vertexMode: 'plain',
      });

      const UID = 'c1111111-1111-4111-8111-111111111111';
      const CLONE_UID = 'c2222222-2222-4222-8222-222222222222';

      const tmbs52Path = path.join(saveFolder, 'tmbs', UID + '.jpg');
      const tmbs512Path = path.join(saveFolder, thumb512PathFor(thumb52PathFor(UID, 'jpg')));

      // ============================================================
      // (A 保存) 下書きのサムネイルが tmbs へ移り、tiles/<uid> は作られない
      // ============================================================
      {
        const draftId = await stageDraft({ source: 'iiif' });
        const draftFolder = iiifDraftFolder(draftId);
        assert.ok(draftFolder, '下書きのフォルダが解決できない');
        await fs.ensureDir(draftFolder);
        await fs.writeFile(path.join(draftFolder, 'thumbnail.jpg'), 'thumb52-from-iiif');
        await fs.writeFile(path.join(draftFolder, THUMB_512_TMP_BASENAME), 'thumb512-from-iiif');

        const payload = await takeDraft(draftId, UID);
        assert.ok(payload, '下書きの中身が返らない');
        const uidDraftDir = resolveDraftTileDir(draftTileRoot, UID);
        assert.ok(uidDraftDir, 'uid の下書きの場所が解決できない');
        assert.ok(await fs.pathExists(path.join(uidDraftDir, 'thumbnail.jpg')), '下書きのサムネイルが移っていない');

        const saved = await MapEditService.save({
          mapObject: {
            ...mapObjectFor('iiif-map-a'),
            delivery,
            iiif,
          },
          tins: [],
          slug: 'iiif-map-a',
          uid: UID,
          create: true,
        });
        assert.equal(saved.result, 'Success', 'URL の無い地図の保存が失敗した: ' + JSON.stringify(saved));

        assert.ok(await fs.pathExists(tmbs52Path), '52px のサムネイルが tmbs の場所に移っていない: ' + tmbs52Path);
        assert.ok(tmbs512Path, '512px の置き場が導けない');
        assert.ok(await fs.pathExists(tmbs512Path), '512px のサムネイルが tmbs の場所に移っていない: ' + tmbs512Path);
        assert.equal(await fs.readFile(tmbs52Path, 'utf8'), 'thumb52-from-iiif', '52px のサムネイルの中身が違う');
        assert.equal(await fs.readFile(tmbs512Path, 'utf8'), 'thumb512-from-iiif', '512px のサムネイルの中身が違う');

        const tileDir = path.join(saveFolder, 'tiles', UID);
        const tileDirExists = await fs.pathExists(tileDir);
        const tileDirEmpty = tileDirExists ? (await fs.readdir(tileDir)).length === 0 : true;
        assert.ok(tileDirEmpty, 'タイルの実体を作ってはいけない: ' + tileDir);
      }

      // ============================================================
      // (A 複製) 呼び出し側が delivery と iiif を渡さなくても複製元から写る
      // ============================================================
      {
        const cloned = await MapEditService.save({
          mapObject: mapObjectFor('iiif-map-a-clone'),
          tins: [],
          slug: 'iiif-map-a-clone',
          uid: CLONE_UID,
          copyFromUid: UID,
          create: true,
        });
        assert.equal(cloned.result, 'Success', 'URL の無い地図の複製が失敗した: ' + JSON.stringify(cloned));

        const cloneDoc = await SqliteDataService.findMap(CLONE_UID);
        assert.ok(cloneDoc, '複製した地図が DB に無い');
        assert.deepEqual(cloneDoc.delivery, delivery, '複製した地図に delivery が写っていない');
        assert.deepEqual(cloneDoc.iiif, iiif, '複製した地図に iiif が写っていない');

        const cloneThumb = path.join(saveFolder, 'tmbs', CLONE_UID + '.jpg');
        assert.ok(await fs.pathExists(cloneThumb), '複製した地図の 52px サムネイルが無い: ' + cloneThumb);
        const cloneTileDir = path.join(saveFolder, 'tiles', CLONE_UID);
        const cloneTileExists = await fs.pathExists(cloneTileDir);
        assert.ok(!cloneTileExists || (await fs.readdir(cloneTileDir)).length === 0, '複製先にタイルの実体を作ってはいけない');
      }

      // ============================================================
      // (D ZIP) tiles/ を含まず delivery を持つ地図の ZIP を取り込める
      // ============================================================
      {
        const sourceDoc = await SqliteDataService.findMap(UID);
        assert.ok(sourceDoc, 'ZIP の材料にする地図が DB に無い');
        const zipJson = { ...sourceDoc };
        delete zipJson.uid;
        delete zipJson.slug;
        delete zipJson.revision;
        delete zipJson.mapID;

        const zip = new AdmZip();
        zip.addFile('maps/iiif-map-zip.json', Buffer.from(JSON.stringify(zipJson)));
        zip.addFile('tmbs/iiif-map-zip.jpg', Buffer.from('thumb-from-zip'));
        const zipPath = path.join(workDir, 'iiif-map.zip');
        zip.writeZip(zipPath);

        const imported = await DataUploadService.extractZip(zipPath);
        assert.ok(!imported.err, 'tiles/ の無い ZIP の取り込みが失敗した: ' + JSON.stringify(imported.err));
        assert.equal(imported.mapData.url_, undefined, 'タイルの無い ZIP から url_ を作ってはいけない: ' + imported.mapData.url_);
        assert.deepEqual(imported.mapData.delivery, delivery, '取り込んだ地図の delivery が落ちている');
      }

      // ============================================================
      // (E 一覧) 一覧の画像は tmbs から出る
      // ============================================================
      {
        const listUrl = await resolveMapListImage({ uid: UID });
        assert.ok(typeof listUrl === 'string' && listUrl.length > 0, '一覧の画像が解決できない: ' + listUrl);
        assert.equal(appUrlToLocalPath(listUrl), tmbs52Path, '一覧の画像が tmbs の 52px を指していない: ' + listUrl);
      }

      // ============================================================
      // (E プレビューの用途) url_ が無くても MapPurposeService が落ちない
      // ============================================================
      {
        const previewResult = await MapPurposeService.downloadSavedMap(null, UID);
        assert.equal(previewResult, 'Success', 'プレビューの用途が URL の無い地図で落ちた: ' + previewResult);

        // プレビュー／書き出しの JSON にも配信情報が渡る（タイルの実体が無くても配れる地図のまま）
        const exportedZip = new AdmZip(path.join(workDir, 'export', 'iiif-map.zip'));
        const mapsEntry = exportedZip.getEntries().find(
          (entry) => entry.entryName.startsWith('maps/') && entry.entryName.endsWith('.json'),
        );
        assert.ok(mapsEntry, 'プレビューの ZIP に maps/*.json が無い');
        const exportedJson = JSON.parse(exportedZip.readAsText(mapsEntry));
        assert.deepEqual(exportedJson.delivery, delivery, 'プレビューの JSON から delivery が落ちている');
      }

      console.log('ok: url-less-map-ops');

      // ============================================================
      // 取り込みをやめたら下書きのサムネイルが残らない
      // ============================================================
      {
        const discardedId = await stageDraft({ source: 'iiif' });
        const discardedFolder = iiifDraftFolder(discardedId);
        assert.ok(discardedFolder, '下書きのフォルダが解決できない');
        await fs.ensureDir(discardedFolder);
        await fs.writeFile(path.join(discardedFolder, 'thumbnail.jpg'), 'thumb-from-aborted-import');
        assert.equal(await discardDraft(discardedId), true, '下書きを捨てられなかった');
        assert.equal(await fs.pathExists(discardedFolder), false, '捨てた下書きのフォルダが残っている: ' + discardedFolder);

        const clock = { now: 1_000_000 };
        setIiifDraftStoreClock(() => clock.now);
        const expiredId = await stageDraft({ source: 'iiif' });
        const expiredFolder = iiifDraftFolder(expiredId);
        assert.ok(expiredFolder, '下書きのフォルダが解決できない');
        await fs.ensureDir(expiredFolder);
        await fs.writeFile(path.join(expiredFolder, 'thumbnail.jpg'), 'thumb-from-expired-import');
        clock.now += IIIF_DRAFT_TTL_MS + 1;
        await stageDraft({ source: 'iiif' });
        assert.equal(await fs.pathExists(expiredFolder), false, '期限切れの下書きのフォルダが残っている: ' + expiredFolder);
        assert.equal(iiifDraftFolder(expiredId), null, '期限切れの下書きが預かり所に残っている');
        setIiifDraftStoreClock();
      }

      console.log('ok: thumbnail-draft-cleaned');
      process.exit(0);
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
        external: [
          'jimp',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
          'adm-zip',
          'recursive-fs',
        ],
        output: {
          entryFileNames: 'iiif-map-tiles-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
