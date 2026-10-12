// nov26-m6-t5 (#109・HR-15) smoke: 新しく入れる画像の内部名を UUID（ベースマップは uid）に統一する。
// タスク設計 `docs/superpowers/specs/2026-10-11-nov26-m6-t5-task-design.md` v2 §7 の 2・§8 AC1〜AC3。
//
//   (a) スプラッシュ・PWA アイコン・ベースマップのアイコンの書き込み先が §2 の形で、元のファイル名・slug を含まない  -> AC1
//   (b) 同じ名前の画像を 2 回 uploadSplash しても先のファイルが変わらない（ハッシュ）                          -> AC2
//   (c) BaseMapEdit.vue の iconFileKey が document.value.uid を返す（ソーステキスト）。K0 の判定は slug で行う     -> AC1
//   (d) TMS サムネイルのアップロード（撤去したメソッドと IPC）が electron/・src/ に 0 件                                                         -> AC3
//
// m19-t2 と同型の harness（vite SSR ビルド + electron/electron-store スタブ + saveFolder=一時 dir）で
// 実サービス（AppAssetService）を直接呼ぶ。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t5-names-'));
const entryFile = path.join(workDir, 'nov26-m6-t5-names-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'nov26-m6-t5-names-smoke.mjs');
const dataDir = path.join(workDir, 'data');
await mkdir(dataDir, { recursive: true });

const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
const appAssetServicePath = path.join(projectRoot, 'electron/services/AppAssetService.ts');

// 1x1 PNG（ローカルのタイルサーバーが返すタイル）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

await writeFile(
  electronStubFile,
  `
    export const app = {
      getPath(name: string) { return ${JSON.stringify(workDir)} + '/' + name; },
      getName() { return 'MaplatEditorSmoke'; },
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const dialog = {
      async showOpenDialog(_win: any, _opts: any) {
        const p = (globalThis as any).__pickImagePath;
        if (!p) return { canceled: true, filePaths: [] };
        return { canceled: false, filePaths: [p] };
      },
      async showSaveDialog() { return { canceled: true, filePath: undefined }; },
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

    const dataDir = ${JSON.stringify(dataDir)};
    const workDir = ${JSON.stringify(workDir)};
    const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
    const exists = (p) => fs.stat(p).then(() => true).catch(() => false);

    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', dataDir);
    SettingsService.set('lang', 'ja');
    const { default: AppAssetService } = await import(${JSON.stringify(appAssetServicePath)});
    const fakeWin = { webContents: { send() {} } } as any;

    // 2 つの別の画像を、同じ元のファイル名（地図.png）で用意する
    const dirA = nodePath.join(workDir, 'pickA');
    const dirB = nodePath.join(workDir, 'pickB');
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });
    const srcA = nodePath.join(dirA, '地図.png');
    const srcB = nodePath.join(dirB, '地図.png');
    await new Jimp({ width: 40, height: 30, color: 0xff0000ff }).write(srcA as any);
    await new Jimp({ width: 40, height: 30, color: 0x0000ffff }).write(srcB as any);
    const squareSrc = nodePath.join(dirA, 'my-app_icon.png');
    await new Jimp({ width: 600, height: 600, color: 0x00ff00ff }).write(squareSrc as any);

    // ===== (a)(b) スプラッシュ =====
    {
      (globalThis as any).__pickImagePath = srcA;
      const first = await AppAssetService.uploadSplash(fakeWin);
      assert.ok(!first.err, '(a) uploadSplash が成功する: ' + JSON.stringify(first));
      assert.match(first.splash, new RegExp('^' + UUID + '\\\\.png$'), '(a)/AC1 スプラッシュの内部名は {uuid}.png: ' + first.splash);
      assert.ok(!first.splash.includes('地図'), '(a)/AC1 元のファイル名を含まない');
      const firstPath = nodePath.join(dataDir, 'img', first.splash);
      assert.ok(await exists(firstPath), '(a) img/{uuid}.png が書かれる');
      const firstHash = await sha(firstPath);

      (globalThis as any).__pickImagePath = srcB;
      const second = await AppAssetService.uploadSplash(fakeWin);
      assert.ok(!second.err, '(b) 2 回目の uploadSplash が成功する');
      assert.notEqual(second.splash, first.splash, '(b)/AC2 同じ元の名前でも別の内部名になる');
      assert.equal(await sha(firstPath), firstHash, '(b)/AC2 先に入れた画像（1 つ目のアプリ）のファイルが変わらない');
      assert.equal(await sha(nodePath.join(dataDir, 'img', second.splash)), await sha(srcB), '(b) 2 つ目は 2 つ目の画像の複製');
      console.log('ok: (a)(b) スプラッシュは {uuid}.{ext}・同名でも先の画像を上書きしない（AC1・AC2）');
    }

    // ===== (a) PWA アイコン =====
    {
      (globalThis as any).__pickImagePath = squareSrc;
      const r = await AppAssetService.uploadPwaIcon(fakeWin, 'my-app');
      assert.ok(!r.err, '(a) uploadPwaIcon が成功する: ' + JSON.stringify(r));
      assert.match(r.path, new RegExp('^pwa/' + UUID + '\\\\.png$'), '(a)/AC1 PWA アイコンは pwa/{uuid}.png: ' + r.path);
      assert.ok(!r.path.includes('my-app'), '(a)/AC1 slug（appID）を含まない');
      assert.ok(await exists(nodePath.join(dataDir, r.path)), '(a) 実体が書かれる');
      const r2 = await AppAssetService.uploadPwaIcon(fakeWin, 'my-app');
      assert.notEqual(r2.path, r.path, '(a)/AC2 同じ appID でも別名（先の画像を上書きしない）');
      console.log('ok: (a) PWA アイコンは pwa/{uuid}.png（AC1）');
    }

    // ===== (a) ベースマップのアイコン（generateTmsThumbnail(uid, …)）=====
    {
      const nodeHttp = await import('node:http');
      const tilePng = Buffer.from(${JSON.stringify(PNG_B64)}, 'base64');
      const server = nodeHttp.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(tilePng); });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;
      const uid = '0f0f0f0f-1111-4222-8333-444444444444';
      const gen = await AppAssetService.generateTmsThumbnail(
        uid, { url: 'http://127.0.0.1:' + port + '/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 18 }, [[139.7, 35.6], [139.8, 35.7]],
      );
      server.close();
      assert.ok(!gen.err, '(a) generateTmsThumbnail が成功する: ' + JSON.stringify(gen));
      assert.equal(gen.path, 'tmbs/' + uid + '.png', '(a)/AC1 ベースマップのアイコンは uid 名');
      console.log('ok: (a) ベースマップのアイコンは tmbs/{uid}.png（AC1）');
    }

    console.log('nov26-m6-t5 asset uuid names smoke (bundle part): ALL PASS');
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
      external: ['@jsquash/webp'],
      output: { entryFileNames: 'nov26-m6-t5-names-smoke.mjs', format: 'es' },
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

// ===== (c) BaseMapEdit.vue の iconFileKey（ソーステキスト）=====
{
  const src = await readFile(path.join(projectRoot, 'src/components/basemap/BaseMapEdit.vue'), 'utf8');
  const decl = src.split('\n').filter((l) => /^const iconFileKey = /.test(l));
  assert.equal(decl.length, 1, '(c) iconFileKey の宣言は 1 行');
  assert.equal(decl[0].trim(), 'const iconFileKey = () => document.value.uid;', `(c)/AC1 iconFileKey は uid を返す: ${decl[0]}`);
  assert.equal(/revision\.value === null \? document\.value\.slug/.test(src), false, '(c) 未保存なら slug、の分岐が残っていない');
  // K0 の判定（slug 未入力なら null）は slug で行い、ボタンの有効条件を変えない（§4.1）
  assert.ok(/return document\.value\.slug \? \{ fileKey, ext: "png" \} : null;/.test(src), '(c) K0 は slug 未入力で null を返す');
  console.log('ok: (c) BaseMapEdit.vue の iconFileKey は uid・K0 は slug で判定（AC1）');
}

// ===== (d) 撤去したメソッドと IPC が electron/・src/ に 0 件 =====
{
  // AC3 の git grep（scripts も対象）に本 smoke 自身が掛からないよう、needle は連結で組む
  const REMOVED_NEEDLES = ['upload' + 'TmsThumbnail', 'appassets:' + 'upload-tms-thumbnail'];
  const hits = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/\.(ts|vue|js|mjs)$/.test(entry.name)) continue;
      const text = await readFile(full, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (REMOVED_NEEDLES.some((n) => line.includes(n))) hits.push(`${full}:${i + 1}: ${line.trim()}`);
      });
    }
  };
  await walk(path.join(projectRoot, 'electron'));
  await walk(path.join(projectRoot, 'src'));
  assert.deepEqual(hits, [], `(d)/AC3 撤去したメソッドと IPC が electron/・src/ に残っていない:\n${hits.join('\n')}`);
  console.log('ok: (d) 撤去したメソッドと IPC は electron/・src/ に 0 件（AC3）');
}

console.log('nov26-m6-t5 asset uuid names smoke: ALL PASS');
