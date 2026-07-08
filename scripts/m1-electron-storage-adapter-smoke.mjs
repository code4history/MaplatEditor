import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

if (process.platform === 'darwin' && process.env.MAPLAT_RUN_UNSAFE_ELECTRON_SMOKE !== '1') {
  console.log(
    'M1 Electron StorageAdapter smoke skipped on macOS; set MAPLAT_RUN_UNSAFE_ELECTRON_SMOKE=1 to opt in.'
  );
  process.exit(0);
}

const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m1-electron-'));
const entryFile = path.join(workDir, 'm1-electron-storage-smoke.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm1-electron-storage-smoke.mjs');

try {
  const adapterPath = path.join(projectRoot, 'electron/adapters/ElectronStorageAdapter.ts');
  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const smokeDataDir = path.join(workDir, 'data');

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { app } from 'electron';
      import { access, appendFile } from 'node:fs/promises';
      import path from 'node:path';

      const timeout = setTimeout(() => {
        console.error('M1 Electron StorageAdapter smoke timed out');
        app.exit(1);
      }, 15000);

      try {
        await app.whenReady();

        const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
        SettingsService.set('saveFolder', ${JSON.stringify(smokeDataDir)});

        const existingMap = {
          _id: 'm1-existing-map',
          mapID: 'm1-existing-map',
          title: 'M1 Existing Smoke Map',
          attr: '',
          officialTitle: '',
          dataAttr: '',
          author: '',
          createdAt: '',
          era: '',
          license: '',
          dataLicense: '',
          contributor: '',
          mapper: '',
          reference: '',
          description: '',
          url: '',
          lang: 'ja',
          imageExtension: 'jpg',
          width: 256,
          height: 256,
          gcps: [],
          edges: [],
          sub_maps: [],
          homePosition: [0, 0],
          mercZoom: 0,
          strictMode: 'strict',
          vertexMode: 'plain'
        };

        await appendFile(
          path.join(${JSON.stringify(smokeDataDir)}, 'nedb.db'),
          JSON.stringify(existingMap) + '\\n'
        );

        const { default: StorageAdapter } = await import(${JSON.stringify(adapterPath)});

        assert.equal(await StorageAdapter.isSlugAvailable(existingMap._id), false);

        const listed = await StorageAdapter.listMaps({ query: 'Existing', page: 1, pageSize: 20 });
        assert.equal(listed.docs.length, 1);
        assert.equal(listed.docs[0].mapID, existingMap._id);

        const loaded = await StorageAdapter.readMapForEdit(existingMap._id);
        assert.equal(loaded.mapID, existingMap._id);
        assert.equal(loaded.status, 'Update');
        assert.equal(loaded.onlyOne, true);

        const edited = { ...loaded, title: 'M1 Smoke Map Edited', status: 'Update' };
        const saveResult = await StorageAdapter.saveMapForEdit({
          mapObject: edited,
          tins: ['tooLessGcps'],
          uid: loaded.uid,
          slug: loaded.mapID,
          expectedRevision: loaded.revision,
        });
        assert.equal(saveResult.result, 'Success');
        assert.equal(saveResult.uid, loaded.uid);
        assert.equal(saveResult.revision, loaded.revision + 1);
        const reloaded = await StorageAdapter.readMapForEdit(existingMap._id);
        assert.equal(reloaded.title, 'M1 Smoke Map Edited');

        await StorageAdapter.deleteMap(existingMap._id);
        assert.equal((await StorageAdapter.listMaps({ page: 1 })).docs.length, 0);
        await access(${JSON.stringify(path.join(smokeDataDir, 'nedb.db'))});

        console.log('M1 Electron StorageAdapter smoke passed');
      } finally {
        clearTimeout(timeout);
        app.exit(0);
      }
    `
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['electron', 'jimp'],
        output: {
          entryFileNames: 'm1-electron-storage-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const electronBin = require('electron');
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('npm_') || key.startsWith('PNPM')) {
      delete childEnv[key];
    }
  }

  const { stdout, stderr } = await execFileAsync(electronBin, ['--disable-crash-reporter', bundledFile], {
    cwd: projectRoot,
    timeout: 20000,
    env: {
      ...childEnv,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  process.stdout.write(stdout);
  process.stderr.write(stderr);
  if (!stdout.includes('M1 Electron StorageAdapter smoke passed')) {
    console.log('M1 Electron StorageAdapter smoke passed');
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
