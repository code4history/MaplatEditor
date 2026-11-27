// スモーク: ランタイムタイル URL 導出 IPC（`mapedit:deriveRuntimeTileUrl`）
//
// なぜ必要か:
//   タイル URL 欄が書き換えるのは `mapData.url` だが、タイル源が読むのは `mapData.url_` で、
//   両者を繋ぐ反映がどこにも無い。renderer 側で `url_` を導出すると、url-derivation-unification が1本化した
//   `deriveRuntimeTileUrl` が3箇所目として復活するため、main へ問い合わせる形にする。
//
// 検証する受け入れ条件:
//   case 1  非空の url はそのまま返る
//   case 2  空の url + 保存済みタイルあり → 内部タイルの {z}/{x}/{y} 形式が返る
//   case 3  空の url + draft staging のみ → staging の URL が返る
//   case 4  保存済みと draft の両方があれば **draft が優先**
//   case 4b draft が無ければ保存済みへ落ちる（通常ケースが draft 優先で変わらないことの担保）
//   case 5  どちらも無ければ undefined を返し例外を投げない
//   case 6  mapRef に '..' 等を渡しても親領域を見に行かない（resolveDraftTileDir の防御）
//   case 7  導出が deriveRuntimeTileUrl を通っている（mapedit:request 経由の url_ と値が一致）
//
// 検証方式: 既存 smokeと同じサンドボックス方式
//   （vite SSR ビルド + electron / electron-store スタブ + 一時 saveFolder）。
//   IPC ハンドラは electron スタブの `__handlers` から取り出して**実際に呼ぶ**。
//
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';
import { makeSmokeScratch } from './smoke-scratch.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await makeSmokeScratch('runtime-tile-url-ipc-tile-url-');
const entryFile = path.join(workDir, 'runtime-tile-url-ipc-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'runtime-tile-url-ipc-smoke.mjs');

// case 2 の percent-encoding 経路も通るよう、保存フォルダに空白と非 ASCII を含める
// （URL の導出の統一と同じ理由。percent-encoding ありのビルダー — #105 以降は appScheme の
//  localFileUrl()（app://bundle/__local）— の組み立てであることの確認を兼ねる）
const dataDir = path.join(workDir, 'データ folder');
const draftRoot = path.join(workDir, 'e2eroot', 'draft-tiles');
await mkdir(dataDir, { recursive: true });
await mkdir(draftRoot, { recursive: true });

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
        if (name === 'userData') return ${JSON.stringify(path.join(workDir, 'userData'))};
        return ${JSON.stringify(workDir)};
      },
      getName() { return 'MaplatEditorSmoke'; },
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
    const check = (label: string, fn: () => void) => {
      try { fn(); console.log('ok: ' + label); }
      catch (e: any) { failures.push(label + ' — ' + (e?.message ?? String(e))); console.log('NG: ' + label + ' — ' + (e?.message ?? String(e))); }
    };

    const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    SettingsService.set('lang', 'ja');

    const { registerMapEditHandlers } = await import(${JSON.stringify(path.join(projectRoot, 'electron/ipc/mapedit.ts'))});
    const { __handlers } = await import(${JSON.stringify(electronStubFile)});
    const { draftTileRoot } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/draftTilePaths.ts'))});
    const { deriveRuntimeTileUrl } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/runtimeTileUrl.ts'))});
    const { appUrlToLocalPath } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/appScheme.ts'))});

    registerMapEditHandlers();
    const derive = __handlers.get('mapedit:deriveRuntimeTileUrl');
    assert.ok(derive, 'mapedit:deriveRuntimeTileUrl が登録されていない（IPC 未実装）');
    const call = (url: any, mapRef: any) => derive({ senderFrame: { url: 'app://bundle/index.html', parent: null } } as any, url, mapRef);

    // ---- フィクスチャ ------------------------------------------------------
    // 保存済みタイル: <saveFolder>/tiles/<uid>/0/0/0.jpg
    const SAVED_UID = 'saved-uid-0001';
    const savedTileDir = nodePath.join(${JSON.stringify(dataDir)}, 'tiles', SAVED_UID, '0', '0');
    await fs.ensureDir(savedTileDir);
    await fs.writeFile(nodePath.join(savedTileDir, '0.jpg'), 'saved');

    // draft staging: <draftTileRoot>/<uid>/0/0/0.png
    // 拡張子を保存済みと変える（どちらを見たかが戻り値の拡張子で判別できる）
    const draftTileDir = nodePath.join(draftTileRoot, SAVED_UID, '0', '0');
    await fs.ensureDir(draftTileDir);
    await fs.writeFile(nodePath.join(draftTileDir, '0.png'), 'draft');

    // draft を持たない保存済み地図（case 4b 用）
    const SAVED_ONLY_UID = 'saved-only-0002';
    const savedOnlyDir = nodePath.join(${JSON.stringify(dataDir)}, 'tiles', SAVED_ONLY_UID, '0', '0');
    await fs.ensureDir(savedOnlyDir);
    await fs.writeFile(nodePath.join(savedOnlyDir, '0.jpg'), 'saved-only');

    // ---- case 1: 非空の url はそのまま返る ------------------------------------
    const EXT_URL = 'https://example.com/tiles/{z}/{x}/{y}.png';
    check('case 1 非空の url はそのまま返る（保存済み uid を渡しても上書きされない）', () => {});
    {
      const got = await call(EXT_URL, SAVED_UID);
      check('case 1 外部URLがそのまま返る', () => { assert.equal(got, EXT_URL); });
      // タイル実体を見に行っていないことの傍証: 存在しない uid でも同じ値が返る
      const got2 = await call(EXT_URL, 'no-such-uid');
      check('case 1 タイル実体に依存しない（存在しない uid でも同値）', () => { assert.equal(got2, EXT_URL); });
    }

    // ---- case 4: draft と保存済みの両方 → draft 優先 ---------------------------
    {
      const got = await call('', SAVED_UID);
      check('case 4 draft と保存済みの両方があれば draft が優先される（.png が返る）', () => {
        assert.ok(typeof got === 'string', 'string が返る: ' + JSON.stringify(got));
        assert.ok(got.endsWith('/{z}/{x}/{y}.png'), 'draft 側の拡張子 png: ' + got);
        assert.ok(got.includes('draft-tiles'), 'draft staging のパスを指す: ' + got);
      });
    }

    // ---- case 3: draft のみ ---------------------------------------------------
    {
      const DRAFT_ONLY = 'draft-only-0003';
      const d = nodePath.join(draftTileRoot, DRAFT_ONLY, '0', '0');
      await fs.ensureDir(d);
      await fs.writeFile(nodePath.join(d, '0.png'), 'draft-only');
      const got = await call('', DRAFT_ONLY);
      check('case 3 draft staging のみ → staging の URL が返る', () => {
        assert.ok(typeof got === 'string' && got.includes('draft-tiles') && got.endsWith('/{z}/{x}/{y}.png'), String(got));
      });
    }

    // ---- case 2 / case 4b: 保存済みのみ ------------------------------------------
    {
      const got = await call('', SAVED_ONLY_UID);
      check('case 2 保存済みタイルから {z}/{x}/{y} 形式が返る', () => {
        assert.ok(typeof got === 'string', String(got));
        assert.ok(got.endsWith('/{z}/{x}/{y}.jpg'), '保存済み側の拡張子 jpg: ' + got);
        // #105 の契約 — ランタイムのローカルタイル URL は app://bundle/__local
        assert.ok(got.startsWith('app://bundle/__local/'), 'app://bundle/__local 形式 (#105): ' + got);
        assert.equal(
          appUrlToLocalPath(got.replace(/\\/\\{z\\}\\/\\{x\\}\\/\\{y\\}\\.jpg$/, '')),
          nodePath.join(${JSON.stringify(dataDir)}, 'tiles', SAVED_ONLY_UID),
          '実パス部分は空白・非 ASCII を含む saveFolder/tiles/<uid> へ復号される: ' + got
        );
        // 空白と非 ASCII が percent-encoding されている（localFileUrl() 経由であることの確認）
        assert.ok(!got.includes(' '), '空白が percent-encoding される: ' + got);
        assert.ok(got.includes('%'), '非 ASCII が percent-encoding される: ' + got);
      });
      check('case 4b draft が無ければ保存済みへ落ちる（通常ケースが draft 優先で変わらない）', () => {
        assert.ok(String(got).includes(nodePath.basename(${JSON.stringify(dataDir)}).replace(/ /g, '%20')) || String(got).includes('tiles'), String(got));
      });
    }

    // ---- case 5: どちらも無ければ undefined -----------------------------------
    {
      const got = await call('', 'no-tiles-anywhere-0004');
      check('case 5 どちらにもタイルが無ければ undefined（例外を投げない）', () => {
        assert.equal(got, undefined);
      });
      const got2 = await call('', undefined);
      check('case 5 mapRef 未指定 + url 空でも undefined（例外を投げない）', () => {
        assert.equal(got2, undefined);
      });
    }

    // ---- case 6: パス脱出の防御 -----------------------------------------------
    for (const evil of ['..', '.', '../..', 'a/b', 'a\\\\b']) {
      const got = await call('', evil);
      check('case 6 mapRef=' + JSON.stringify(evil) + ' で親領域を見に行かない（undefined）', () => {
        assert.equal(got, undefined);
      });
    }

    // ---- case 7: deriveRuntimeTileUrl を通っている ----------------------------
    // 同じ入力（保存済み thumbFolder）に対し、正本関数を直接呼んだ値と一致することを確かめる。
    // 「共通実装を呼んでいる」をソーステキストで縛らず、値の一致で担保する。
    {
      const thumbFolder = nodePath.join(${JSON.stringify(dataDir)}, 'tiles', SAVED_ONLY_UID, '0', '0');
      const expected = await deriveRuntimeTileUrl({}, thumbFolder);
      const got = await call('', SAVED_ONLY_UID);
      check('case 7 導出が deriveRuntimeTileUrl（url-derivation-unification の正本）と同じ値を返す', () => {
        assert.equal(got, expected);
      });
      const expectedExt = await deriveRuntimeTileUrl({ url: EXT_URL }, thumbFolder);
      const gotExt = await call(EXT_URL, SAVED_ONLY_UID);
      check('case 7 非空 url でも正本と同じ値を返す', () => {
        assert.equal(gotExt, expectedExt);
      });
    }

    if (failures.length > 0) {
      throw new Error('IPC smoke: ' + failures.length + ' 件失敗 / ' + failures.join(' / '));
    }
    console.log('runtime tile url IPC smoke: ALL PASS');
  `,
);

try {
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
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: [
          'jimp', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform',
        ],
        output: { entryFileNames: 'runtime-tile-url-ipc-smoke.mjs', format: 'es' },
      },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
    env: { ...process.env, MAPLAT_E2E_ROOT: path.join(workDir, 'e2eroot') },
  });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  // .tmp-smoke は smoke-scratch.mjs がプロセス終了時に消す（残す場合は KEEP_SMOKE_TMP=1）
}
