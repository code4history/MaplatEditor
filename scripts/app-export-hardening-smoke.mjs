/* global URL, console, process */
// アプリの書き出しとプレビューの防御の smoke。
//
// 固定すること:
//   (1) スプラッシュの複製元は保存フォルダの img/ の中だけ
//   (3) 既定の session の権限は拒否が既定で、許すのはクリップボードの書き込みだけ
//   (5) <script> へ埋める JSON は </script> で閉じられない（書き出しとプレビュー）
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'app-export-hardening-'));
const p = (r) => JSON.stringify(path.join(projectRoot, r));
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`NG ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}

async function run(name, source) {
  const dir = path.join(workDir, name);
  await mkdir(dir, { recursive: true });
  const entryFile = path.join(dir, 'entry.ts');
  await writeFile(entryFile, source);
  await check(name, async () => {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: [
          { find: 'electron', replacement: path.join(workDir, 'electron-stub.ts') },
          { find: 'electron-store', replacement: path.join(workDir, 'electron-store-stub.ts') },
        ],
      },
      build: {
        emptyOutDir: true,
        outDir: path.join(dir, 'dist'),
        ssr: entryFile,
        target: 'node22',
        rollupOptions: {
          external: ['jimp', 'adm-zip', 'pwa-asset-generator', '@maplat/tin', '@maplat/transform'],
          output: { entryFileNames: 'entry.mjs', format: 'es' },
        },
      },
    });
    const result = await execFileAsync(process.execPath, [path.join(dir, 'dist', 'entry.mjs')], {
      cwd: projectRoot, timeout: 300000, maxBuffer: 1024 * 1024 * 16,
    }).catch((e) => {
      process.stdout.write(e.stdout ?? '');
      process.stderr.write(e.stderr ?? '');
      throw new Error('checks failed');
    });
    process.stdout.write(result.stdout);
  });
}

try {
  const dataDir = path.join(workDir, 'home', 'data');
  await mkdir(path.join(dataDir, 'img'), { recursive: true });
  await writeFile(path.join(workDir, 'home', 'leak.png'), 'LEAK');
  await writeFile(path.join(dataDir, 'img', 'ok.png'), 'OK-SPLASH');

  await writeFile(path.join(workDir, 'electron-stub.ts'), `
    export const app = {
      getPath() { return ${JSON.stringify(workDir)}; },
      getAppPath() { return ${JSON.stringify(projectRoot)}; },
      getName() { return 'MaplatEditor'; },
      isPackaged: false,
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const dialog = {
      async showSaveDialog() { return (globalThis as any).__nextDialogResult || { canceled: true }; },
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showMessageBox() { return { response: 0 }; },
    };
    export const ipcMain = { handle() {}, on() {}, removeHandler() {}, removeAllListeners() {} };
    export const shell = { trashItem() { return Promise.resolve(); } };
    export const session = { defaultSession: { clearStorageData() { return Promise.resolve(); } } };
    export const BrowserWindow = class {
      static fromWebContents() { return { webContents: { send() {} } }; }
      static getAllWindows() { return []; }
    };
  `);
  await writeFile(path.join(workDir, 'electron-store-stub.ts'), `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(o: { defaults?: T } = {}) { this.store = { ...(o.defaults || {}) } as T; }
      get(k: string) { return this.store[k]; }
      set(k: string, v: any) { this.store[k as keyof T] = v; }
      has(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k); }
    }
  `);

  const prelude = `
    import assert from 'node:assert/strict';
    import nodeFs from 'node:fs';
    import nodePath from 'node:path';
    import AdmZip from 'adm-zip';

    const workDir = ${JSON.stringify(workDir)};
    const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
    SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});
    const { default: AppExportService } = await import(${p('electron/services/AppExportService.ts')});
    const failed: string[] = [];
    const check = async (name: string, fn: () => void | Promise<void>) => {
      try { await fn(); console.log('ok ' + name); }
      catch (e: any) { failed.push(name); console.error('NG ' + name + ': ' + (e?.message ?? e)); }
    };
    let seq = 0;
    const exportDoc = async (overrides: any, keys?: any) => {
      const out = nodePath.join(workDir, 'app-' + (seq++) + '.zip');
      (globalThis as any).__nextDialogResult = { canceled: false, filePath: out };
      const win = { webContents: { send() {} } } as any;
      const doc = { appID: 'hardening_app', title: { ja: 'アプリ' }, lang: 'ja', sources: [], ...overrides };
      const r = await (AppExportService.exportApp as any)(win, doc, keys);
      assert.equal(r.result, 'Success', 'export: ' + JSON.stringify(r));
      const zip = new AdmZip(out);
      const names = zip.getEntries().filter((e: any) => !e.isDirectory).map((e: any) => e.entryName);
      return { r, names, text: (n: string) => zip.getEntry(n)!.getData().toString('utf8') };
    };
    const count = (text: string, needle: string) => text.split(needle).length - 1;
    const DANGER = '</script><script>alert(1)</script>';
  `;

  await run('export', `${prelude}
    await check('(1) a splash outside img/ is not copied', async () => {
      for (const splash of ['../../leak.png', '..\\\\..\\\\leak.png', 'sub/ok.png', '..']) {
        const { r, names } = await exportDoc({ appSettings: { splash } });
        assert.deepEqual(names.filter((n: string) => /^img\\/.*_splash\\./.test(n)), [], JSON.stringify(splash) + ' was copied');
        assert.ok(r.warnings?.includes('appedit.export.missing_splash'), JSON.stringify(splash) + ': warning');
      }
    });
    await check('(1) a splash inside img/ is copied', async () => {
      const { r, names, text } = await exportDoc({ appSettings: { splash: 'ok.png' } });
      assert.ok(names.includes('img/hardening_app_splash.png'), JSON.stringify(names));
      assert.equal(text('img/hardening_app_splash.png'), 'OK-SPLASH');
      assert.ok(!r.warnings?.includes('appedit.export.missing_splash'));
    });
    await check('(5) exported JSON cannot close the script element', async () => {
      const plain = (await exportDoc({}, { mapboxToken: 'plain-value' })).text('index.html');
      const danger = (await exportDoc({}, { mapboxToken: DANGER })).text('index.html');
      assert.equal(count(danger, '</script>'), count(plain, '</script>'));
      assert.ok(danger.includes('\\\\u003c/script'), 'the escaped form is in the page');
    });
    if (failed.length > 0) process.exit(1);
  `);

  await run('preview', `${prelude}
    await check('(5) preview JSON cannot close the script element', async () => {
      const { default: AppPreviewService } = await import(${p('electron/services/AppPreviewService.ts')});
      const render = (value: string) => (AppPreviewService as any).renderHtml({
        token: 't', app: { title: 'x', lang: 'ja' }, viewerOption: { label: value }, requiredProviderGl: [],
      });
      const plain = render('plain');
      const danger = render(DANGER);
      assert.equal(count(danger, '</script>'), count(plain, '</script>'));
      assert.ok(danger.includes('\\\\u003c/script'));
    });
    if (failed.length > 0) process.exit(1);
  `);

  await run('script-json', `
    import assert from 'node:assert/strict';
    const { jsonForScript } = await import(${p('electron/utils/scriptJson.ts')});
    assert.equal(jsonForScript({ a: '<' }), '{"a":"\\\\u003c"}');
    assert.deepEqual(JSON.parse(jsonForScript({ a: '</script>' }, 2)), { a: '</script>' });
    console.log('ok (5) jsonForScript');
  `);

  await run('permissions', `
    import assert from 'node:assert/strict';
    const { decidePermission } = await import(${p('electron/utils/permissionPolicy.ts')});
    const bundle = 'app://bundle/index.html';
    const dev = 'http://localhost:5173';
    assert.equal(decidePermission('clipboard-sanitized-write', bundle), true);
    assert.equal(decidePermission('clipboard-sanitized-write', 'app://bundle/'), true);
    assert.equal(decidePermission('clipboard-sanitized-write', 'http://localhost:1234/preview/x/'), false);
    assert.equal(decidePermission('clipboard-sanitized-write', 'app://bundle/__local/x.html'), false);
    assert.equal(decidePermission('clipboard-sanitized-write', dev + '/', dev), true);
    assert.equal(decidePermission('clipboard-sanitized-write', dev + '/', null), false);
    for (const permission of ['fullscreen', 'geolocation', 'media', 'notifications', 'pointerLock', 'clipboard-read', 'openExternal']) {
      assert.equal(decidePermission(permission, bundle), false, permission);
    }
    console.log('ok (3) decidePermission');
  `);

  await check('(3) the default session installs both permission handlers', async () => {
    const main = await readFile(path.join(projectRoot, 'electron/main.ts'), 'utf8');
    for (const call of ['session.defaultSession.setPermissionRequestHandler(', 'session.defaultSession.setPermissionCheckHandler(']) {
      assert.equal(main.split(call).length - 1, 1, call);
    }
  });
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`app-export-hardening smoke FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
assert.equal(failures.length, 0);
console.log('app-export-hardening smoke PASS');
