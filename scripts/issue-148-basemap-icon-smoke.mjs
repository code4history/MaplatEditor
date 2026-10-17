// Issue #148: real SQLite/service code and files, isolated Electron settings.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'issue-148-'));
const electronStubFile = path.join(workDir, 'electron.ts');
const electronStoreStubFile = path.join(workDir, 'store.ts');
const outDir = path.join(workDir, 'dist');
await writeFile(
  electronStubFile,
  `
    export const app = {
      getPath(name: string) {
        if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
        if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
        if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
        return ${JSON.stringify(workDir)};
      },
      getName() { return 'MaplatEditorSmoke'; },
      whenReady() { return Promise.resolve(); },
      exit() {},
    };
    export const ipcMain = { handle() {}, removeHandler() {} };
    export const dialog = {
      // pickImage(): globalThis.__pickImagePath を返す（null でキャンセル扱い）
      async showOpenDialog(_win: any, _opts: any) {
        const p = (globalThis as any).__pickImagePath;
        if (!p) return { canceled: true, filePaths: [] };
        return { canceled: false, filePaths: [p] };
      },
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


await build({
  configFile: false, logLevel: 'silent',
  resolve: { alias: [
    { find: 'electron', replacement: electronStubFile },
    { find: 'electron-store', replacement: electronStoreStubFile },
  ] },
  build: { outDir, ssr: path.join(projectRoot, 'tests/fixtures/issue-148-basemap-icon.ts'),
    target: 'node22', rollupOptions: { output: { entryFileNames: 'test.mjs', format: 'es' } } },
});
try {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [path.join(outDir, 'test.mjs')], {
    cwd: projectRoot, env: { ...process.env, MAPLAT_E2E_ROOT: workDir }, timeout: 120000,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} catch (error) {
  process.stdout.write(error.stdout || '');
  process.stderr.write(error.stderr || '');
  throw error;
}
