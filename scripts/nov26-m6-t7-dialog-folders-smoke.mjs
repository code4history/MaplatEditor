// nov26-m6-t7: 11ダイアログの経路と実物のSettingsService/electron-store永続化。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
const root = path.resolve(import.meta.dirname, '..');
const files = ['electron/ipc/assets-images.ts', 'electron/ipc/mapedit.ts', 'electron/ipc/poisource.ts',
 'electron/services/AppAssetService.ts', 'electron/services/AppExportService.ts', 'electron/services/DataUploadService.ts',
 'electron/services/MapPurposeService.ts', 'electron/services/MapUploadService.ts', 'electron/services/SettingsService.ts'];
const raw = execFileSync('git', ['grep', '-n', '-E', 'show(Open|Save)Dialog', '--', 'electron'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const live = raw.filter(line => !line.split(':').slice(2).join(':').trimStart().startsWith('//'));
const sites = new Set();
for (const line of live) {
 const [file, number] = line.split(':');
 assert.ok(files.includes(file), `AC1 未列挙ダイアログ: ${file}`);
 const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
 const n = Number(number) - 1;
 const near = lines.slice(Math.max(0, n - 6), n + 7).join('\n');
 const expectedPurpose = file.endsWith('SettingsService.ts') ? 'saveFolder'
  : file.includes('assets-images') || file.includes('AppAssetService') || file.includes('MapUploadService') ? 'image'
  : line.includes('showSaveDialog') ? 'export' : 'import';
 assert.ok(near.includes(`dialogDefaultPath('${expectedPurpose}'`), `AC1 ${file}:${number} 用途が異なる`);
 assert.match(near, /dialogDefaultPath\(/, `AC1 ${file}:${number} が助けを通らない`);
 const defaultIndex = lines.findIndex((l, i) => i >= n - 6 && i <= n + 6 && l.includes('defaultPath:'));
 assert.ok(defaultIndex >= 0);
 sites.add(`${file}:${defaultIndex}`);
 if (!file.endsWith('SettingsService.ts')) {
  const after = lines.slice(n, n + 25).join('\n');
  assert.match(after, /canceled[\s\S]*rememberDialogPath\(/, `AC1 ${file}:${number} 取消の後に記憶する経路なし`);
 } else assert.match(near, /dialogDefaultPath\(['"]saveFolder['"]\)/);
}
assert.equal(raw.length - live.length, 1);
assert.equal(sites.size, 11);
console.log(`生ヒット ${raw.length}・コメント除外 ${raw.length-live.length}・採用 ${live.length}・場所 ${sites.size}`);

const fixtureParent = path.join(root, '.tmp-smoke');
fs.mkdirSync(fixtureParent, { recursive: true });
const fixture = fs.mkdtempSync(path.join(fixtureParent, 'nov26-m6-t7-'));
const documents = path.join(fixture, 'documents'); fs.mkdirSync(documents);
process.env.MAPLAT_E2E_ROOT = path.join(fixture, 'runtime');
const stub = path.join(fixture, 'electron.ts');
fs.writeFileSync(stub, `
 const calls = globalThis.__T7_IMPORT_CALLS__ = [];
 export const app = {
  getPath(name) { calls.push(name); return name === 'documents' ? ${JSON.stringify(documents)} : ${JSON.stringify(fixture)}; },
  getName() { calls.push('getName'); return 'DialogFoldersSmoke'; }, getVersion() { return '1.0.0'; }
 };
 export const ipcMain = { on() {}, handle() {} }; export const dialog = {};
 export const BrowserWindow = class { static getAllWindows() { return []; } };
 export const shell = {}; export default { app, ipcMain, dialog, shell, BrowserWindow };
`);
const entry = path.join(fixture, 'entry.ts');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root,'electron/utils/dialogFolders.ts'))};\nexport { default as Settings } from ${JSON.stringify(path.join(root,'electron/services/SettingsService.ts'))};`);
await build({ root, configFile: false, logLevel: 'error', resolve: { alias: [{ find: 'electron', replacement: stub }] },
 ssr: { noExternal: ['electron-store'] }, build: { ssr: entry, outDir: path.join(fixture,'dist'), emptyOutDir: false,
  target: 'node22', rollupOptions: { output: { format: 'es', entryFileNames: 'entry.mjs' } } } });
const { Settings, dialogDefaultPath, rememberDialogPath } = await import(pathToFileURL(path.join(fixture,'dist/entry.mjs')).href);
assert.ok(globalThis.__T7_IMPORT_CALLS__.includes('documents'));
assert.ok(globalThis.__T7_IMPORT_CALLS__.includes('getName'));
console.log('T7-MIN-1: helper呼出し前に実SettingsService importがgetPath/getNameを呼ぶと実測');
const folders = Object.fromEntries(['import','export','image'].map(k => [k,path.join(fixture,k)]));
for (const dir of Object.values(folders)) fs.mkdirSync(dir);
for (const purpose of Object.keys(folders)) {
 assert.equal(dialogDefaultPath(purpose), documents);
 const picked = path.join(folders[purpose], `${purpose}.txt`); fs.writeFileSync(picked, '専用fixture');
 rememberDialogPath(purpose,picked,'file');
 assert.equal(dialogDefaultPath(purpose), folders[purpose]);
}
assert.equal(dialogDefaultPath('export','sample.zip'),path.join(folders.export,'sample.zip'));
const restarted = new Settings.constructor();
assert.deepEqual(restarted.get('lastDialogFolders'),folders,'AC2 新しいStore instanceへ再読込');
const config = JSON.parse(fs.readFileSync(path.join(fixture,'runtime/electron-store/settings/config.json'),'utf8'));
assert.deepEqual(config.lastDialogFolders,folders);
assert.deepEqual(Object.keys(config.lastDialogFolders).sort(),['export','image','import']);
for (const v of Object.values(config.lastDialogFolders)) { assert.ok(path.isAbsolute(v)); assert.ok(fs.statSync(v).isDirectory()); }
console.log('AC2/AC3: 3用途を分離・再読込で保持・JSONはフォルダ絶対パスのみ');
for (const bad of ['relative', 12, path.join(folders.export,'export.txt'), path.join(fixture,'missing')]) {
 Settings.set('lastDialogFolders',{import:bad}); assert.equal(dialogDefaultPath('import'),documents);
}
Settings.set('lastDialogFolders',null);assert.equal(dialogDefaultPath('import'),documents);
Settings.set('lastDialogFolders',folders);
assert.ok(folders.import.startsWith(fixture+path.sep),'今回作成fixtureの包含確認');
assert.deepEqual(fs.readdirSync(folders.import),['import.txt'],'消す内容は自己生成fixtureのみ');
fs.rmSync(folders.import,{recursive:true}); // 設計AC2の「消えたフォルダ」。自己生成1ディレクトリだけ。
assert.equal(dialogDefaultPath('import'),documents);
Settings.set('saveFolder',folders.export);assert.equal(dialogDefaultPath('saveFolder'),folders.export);
const before=Settings.get('lastDialogFolders');rememberDialogPath('saveFolder',documents,'directory');
assert.deepEqual(Settings.get('lastDialogFolders'),before);
// SettingsService.set(saveFolder)は自動作成するので、壊れた設定ファイル相当を実Storeへ直接入れる。
Settings.store.set('saveFolder',path.join(fixture,'missing'));assert.equal(dialogDefaultPath('saveFolder'),documents);
rememberDialogPath('image','relative/file.png','file');assert.deepEqual(Settings.get('lastDialogFolders'),before);
console.log('AC2: 消失/ファイル/相対/数値/nullは書類へ・保存フォルダは現在値・取消相当では記憶を変えない');
console.log('fixture残置:',fixture);
