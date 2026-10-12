// nov26-m6-t5 (#110・B) smoke: 書き出し物のスプラッシュは slug 名 `img/{appID}_splash.{ext}`。
// タスク設計 `docs/superpowers/specs/2026-10-11-nov26-m6-t5-task-design.md` v2 §2（書き出し物の行）・§4.5・§8 AC12。
//
//   書き出した zip のスプラッシュ・app JSON の splash・og:image に内部名（UUID）が出ず、`{appID}_splash.{ext}` である。
//   名前は 1 箇所の関数 exportedSplashName で導く（3 箇所で組み立てない）。
//
// harness は m19-t2 と同型（vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時 dir）。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t5-export-splash-'));
const entryFile = path.join(workDir, 'nov26-m6-t5-export-splash-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'nov26-m6-t5-export-splash-smoke.mjs');
const dataDir = path.join(workDir, 'data');
await mkdir(dataDir, { recursive: true });

const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');

// ---- ソーステキスト: 書き出し名は 1 箇所の関数で導く ----
{
  const src = await readFile(appExportServicePath, 'utf8');
  assert.equal((src.match(/function exportedSplashName\(/g) || []).length, 1, 'exportedSplashName の定義は 1 つ');
  assert.equal((src.match(/exportedSplashName\(/g) || []).length, 4, 'exportedSplashName は定義 1・呼び出し 3（複製・app JSON・og:image）');
  assert.equal(/`img\/\$\{splash\}`/.test(src), false, '内部名から img/${splash} を組み立てる箇所が残っていない');
  console.log('ok: 書き出し名は exportedSplashName の 1 箇所で導く');
}

await writeFile(
  electronStubFile,
  `
    export const app = {
      getPath(name: string) { return ${JSON.stringify(workDir)} + '/' + name; },
      getName() { return 'MaplatEditorSmoke'; },
      getAppPath() { return ${JSON.stringify(projectRoot)}; },
      isPackaged: false,
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const dialog = {
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showSaveDialog(_win: any, _opts: any) {
        return (globalThis as any).__nextDialogResult || { canceled: true, filePath: undefined };
      },
      async showMessageBox() { return { response: 0 }; },
    };
    export const BrowserWindow = class {
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); }, webRequest: { onBeforeRequest: () => {} } } };
    export const shell = { trashItem(_path: string) { return Promise.resolve(); } };
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
    import nodePath from 'node:path';
    import fs from 'node:fs/promises';
    import { createHash } from 'node:crypto';
    import { Jimp } from 'jimp';
    import AdmZip from 'adm-zip';

    const dataDir = ${JSON.stringify(dataDir)};
    const workDir = ${JSON.stringify(workDir)};
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('lang', 'ja');
    const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
    const { default: AppExportService } = await import(${JSON.stringify(appExportServicePath)});
    await SqliteDataService.getDb();
    const fakeWin = { webContents: { send() {} } } as any;

    const SPLASH = '0a1b2c3d-1111-4222-8333-444455556666.jpg';
    const splashPath = nodePath.join(dataDir, 'img', SPLASH);
    await fs.mkdir(nodePath.dirname(splashPath), { recursive: true });
    await new Jimp({ width: 80, height: 60, color: 0x336699ff }).write(splashPath as any);

    const exportOnce = async (appID, siteUrl) => {
      const zipPath = nodePath.join(workDir, appID + '.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: zipPath };
      const doc = {
        appID, title: { ja: 'B' }, appName: { ja: 'B' }, lang: 'ja', sources: [], siteUrl,
        appSettings: { splash: SPLASH }, httpSettings: { pwaManifest: false }, manifestSettings: {},
      };
      const r = await AppExportService.exportApp(fakeWin, doc);
      assert.equal(r.result, 'Success', '書き出しが成功する: ' + JSON.stringify(r));
      return new AdmZip(zipPath);
    };

    for (const siteUrl of ['', 'https://example.test/maps/']) {
      const appID = siteUrl ? 'b-app-site' : 'b-app';
      const zip = await exportOnce(appID, siteUrl);
      const names = zip.getEntries().map((e) => e.entryName);
      const expected = 'img/' + appID + '_splash.jpg';
      assert.ok(names.includes(expected), 'AC12: スプラッシュは ' + expected + ': ' + JSON.stringify(names.filter((n) => n.startsWith('img/'))));
      assert.equal(names.some((n) => UUID_RE.test(n)), false, 'AC12: エントリ名に UUID が出ない');
      const entryHash = createHash('sha256').update(zip.getEntry(expected).getData()).digest('hex');
      assert.equal(entryHash, createHash('sha256').update(await fs.readFile(splashPath)).digest('hex'), 'AC12: 中身は内部名のファイルと同じ');
      const appJson = JSON.parse(zip.getEntry('apps/' + appID + '.json').getData().toString('utf8'));
      assert.equal(appJson.splash, appID + '_splash.jpg', 'AC12: app JSON の splash は書き出し名');
      const html = zip.getEntry('index.html').getData().toString('utf8');
      const og = /<meta property="og:image" content="([^"]+)">/.exec(html);
      assert.ok(og, 'AC12: og:image がある');
      assert.equal(og[1], (siteUrl ? siteUrl : '') + 'img/' + appID + '_splash.jpg', 'AC12: og:image は書き出し名');
      assert.equal(UUID_RE.test(html), false, 'AC12: index.html に UUID が出ない');
      assert.equal(UUID_RE.test(JSON.stringify(appJson)), false, 'AC12: app JSON に UUID が出ない');
      console.log('ok: AC12 書き出しのスプラッシュは ' + expected + (siteUrl ? '（siteUrl あり）' : ''));
    }
    console.log('nov26-m6-t5 export splash name smoke (bundle part): ALL PASS');
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
      external: ['@jsquash/webp', 'pwa-asset-generator'],
      output: { entryFileNames: 'nov26-m6-t5-export-splash-smoke.mjs', format: 'es' },
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
console.log('nov26-m6-t5 export splash name smoke: ALL PASS');
