// m5-t4: 補償の申告義務（マイルストーン設計 I-4c、タスク設計 v1.6 §6.3・§6.4）。
//
// 固定する受け入れ条件:
//   AC7b  補償の二次失敗を注入する。delete() が bytes:'retained' と retainedPath を返し、
//         cleanup() が握り潰さず残留物一覧を返し、DB 削除側を失敗させた場合も申告される
//
// 【なぜこの smoke が要るか】
// ImageAssetService.delete() は DB 行を消した後、実体を _trash へ退避する。退避に失敗しても
// console.warn して { ok: true } を返していた（ヘッダコメントが明記するリポジトリ方針
// 「DBは正、ファイル操作の失敗はログのみ」に基づく）。方針自体は覆さないが、**戻り値が
// 「実体が live path に残った」ことを呼び出し側へ伝えられない**ため、補償を呼んだ側は
// 成功と区別できなかった。I-4c はこれを「補償は成功したことにできない」として禁じる。
//
// 【注入手段】assets/_trash を同名の通常ファイルで塞ぐ（設計 §7 AC7b の注入手段）。
// fs.ensureDir(trashDir) が ENOTDIR/EEXIST で throw し、現行の catch 経路をそのまま踏むため、
// 製品コードにテスト用フックを足さずに再現できる。fs.move のモンキーパッチは実経路を
// 回避したテストになりやすいため採らない。
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4-compensation-'));
const entryFile = path.join(workDir, 'compensation-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'compensation-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const servicePath = path.join(projectRoot, 'electron/services/ImageAssetService.ts');

  await mkdir(dataDir, { recursive: true });
  await writeFile(electronStubFile, `
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
    export const ipcMain = { handle() {} };
    export const BrowserWindow = class { static getAllWindows() { return []; } };
  `);
  await writeFile(electronStoreStubFile, `
    export default class Store<T extends Record<string, any>> {
      store: T;
      constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
      get(key: string) { return this.store[key]; }
      set(key: string, value: any) { this.store[key as keyof T] = value; }
      has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
    }
  `);

  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
    import { existsSync } from 'node:fs';
    import nodePath from 'node:path';
    import { Jimp } from 'jimp';

    const workDir = ${JSON.stringify(workDir)};
    const dataDir = ${JSON.stringify(dataDir)};

    const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
    SettingsService.set('saveFolder', dataDir);
    const { default: imageAssetService } = await import(${JSON.stringify(servicePath)});

    const fixtureDir = nodePath.join(workDir, 'fixtures');
    await fsMkdir(fixtureDir, { recursive: true });
    const pngPath = nodePath.join(fixtureDir, 'a.png');
    await (new Jimp({ width: 4, height: 4, color: 0xff0000ff }) as any).write(pngPath);

    const addAsset = async (slug: string) => {
      const added = await imageAssetService.add({ slug, title: slug, sourcePath: pngPath });
      assert.equal(added.result, 'Success', slug + ' の add は Success のはず: ' + JSON.stringify(added));
      return added.uid as string;
    };
    const assetsDir = nodePath.join(dataDir, 'assets');

    // -----------------------------------------------------------------------
    // AC7b-1 正常系: 退避に成功したら bytes:'trashed'。retainedPath は付かない
    // -----------------------------------------------------------------------
    {
      const uid = await addAsset('trashed-ok');
      const result = await imageAssetService.delete(uid);
      assert.equal(result.ok, true, '正常系の ok:true は維持されること（既存 m9-t4 の回帰）');
      assert.equal(result.bytes, 'trashed', 'AC7b: 退避に成功したら bytes は trashed であること');
      assert.equal(result.retainedPath, undefined, 'AC7b: 残留していないので retainedPath は付かないこと');
      assert.equal(result.warning, undefined, 'AC7b: 警告も付かないこと');
      assert.equal(existsSync(nodePath.join(assetsDir, uid + '.png')), false, 'live path から消えていること');
      assert.equal(existsSync(nodePath.join(assetsDir, '_trash', uid + '.png')), true, '_trash に退避されていること');
      console.log('ok: AC7b-1 trashed');
    }

    // -----------------------------------------------------------------------
    // AC7b-2 対象不在: no-op も ok:true。bytes は 'absent'
    // -----------------------------------------------------------------------
    {
      const result = await imageAssetService.delete('00000000-0000-4000-8000-000000000000');
      assert.equal(result.ok, true, '対象不在の no-op は成功扱い（冪等）であること');
      assert.equal(result.bytes, 'absent', 'AC7b: 実体が無いので bytes は absent であること');
      console.log('ok: AC7b-2 absent');
    }

    // -----------------------------------------------------------------------
    // AC7b-3 【本題】退避失敗の注入 — _trash を通常ファイルで塞ぐ。
    //   実体は live path に残る（リポジトリ方針どおり DB 削除は成功）。
    //   その事実を戻り値で申告できることを固定する（I-4c）。
    // -----------------------------------------------------------------------
    {
      const uid = await addAsset('retained-case');
      const livePath = nodePath.join(assetsDir, uid + '.png');
      assert.equal(existsSync(livePath), true, '前提: 実体が live path にあること');

      // _trash を通常ファイルで塞ぐ → fs.ensureDir が throw する
      const trashPath = nodePath.join(assetsDir, '_trash');
      if (existsSync(trashPath)) {
        const { rm: fsRm } = await import('node:fs/promises');
        await fsRm(trashPath, { recursive: true, force: true });
      }
      await fsWriteFile(trashPath, 'blocker');

      const result = await imageAssetService.delete(uid);

      assert.equal(result.ok, true, 'DB 削除は成功しているので ok:true は維持されること（方針は覆さない）');
      assert.equal(result.bytes, 'retained', 'AC7b: 実体が live path に残ったことを bytes:retained で申告すること');
      assert.equal(result.retainedPath, livePath, 'AC7b: 残留した live path の絶対パスを申告すること');
      assert.ok(result.warning, 'AC7b: 警告が付くこと');
      assert.equal(result.warning.stage, 'trash', 'AC7b: 警告の stage は trash であること');
      assert.equal(typeof result.warning.message, 'string');
      assert.ok(result.warning.message.length > 0, 'AC7b: 警告メッセージが空でないこと');

      assert.equal(existsSync(livePath), true, '実体は live path に残っていること（申告内容と一致）');
      const row = await imageAssetService.get(uid);
      assert.equal(row, null, 'DB 行は消えていること（DBは正）');

      // 塞ぎを解除して後続へ影響させない
      const { rm: fsRm2 } = await import('node:fs/promises');
      await fsRm2(trashPath, { force: true });
      console.log('ok: AC7b-3 retained (declared, not silently swallowed)');
    }

    // -----------------------------------------------------------------------
    // AC7b-4 冪等性: 一度 retained になった uid をもう一度 delete しても
    //   DB 行が無いので absent を返す（残留の申告は1回目のみ）
    // -----------------------------------------------------------------------
    {
      const uid = await addAsset('retained-twice');
      const trashPath = nodePath.join(assetsDir, '_trash');
      const { rm: fsRm } = await import('node:fs/promises');
      await fsRm(trashPath, { recursive: true, force: true });
      await fsWriteFile(trashPath, 'blocker');
      const first = await imageAssetService.delete(uid);
      assert.equal(first.bytes, 'retained');
      await fsRm(trashPath, { force: true });
      const second = await imageAssetService.delete(uid);
      assert.equal(second.ok, true);
      assert.equal(second.bytes, 'absent', 'DB 行が無い2回目は absent であること');
      console.log('ok: AC7b-4 idempotent');
    }

    console.log('m5-t4 compensation declaration (ImageAssetService) OK');
  `);

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
        output: { entryFileNames: 'compensation-smoke.mjs', format: 'es' },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });

  console.log('m5-t4 compensation declaration smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
