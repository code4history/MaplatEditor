// 保存の往復（electron/utils/store_handler.ts）で、IIIF の配信情報が落ちないことを確かめる smoke。
//
// store2HistMap（保存形 → 地図形）→ histMap2Store（地図形 → 保存形）の往復で、
// delivery・iiif と、既にある title・license・pois などが同じ値で戻ることを見る。
// store_handler は TypeScript なので vite の SSR ビルドで束ね、子プロセスで走らせる。
//
// 使い方: node scripts/iiif-import-save-smoke.mjs
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'iiif-import-save-'));
const entryFile = path.join(workDir, 'iiif-import-save-smoke-entry.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'iiif-import-save-smoke.mjs');
const storeModulePath = path.join(projectRoot, 'electron/utils/store_handler.ts');

try {
  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const { store2HistMap, histMap2Store } = await import(${JSON.stringify(storeModulePath)});

      const delivery = {
        type: 'iiifImage',
        url: 'https://dl.ndl.go.jp/api/iiif/948741/R0000003',
      };
      const iiif = {
        manifest: 'https://www.dl.ndl.go.jp/api/iiif/948741/manifest.json',
        canvas: 'https://www.dl.ndl.go.jp/api/iiif/948741/canvas/1',
        image: 'https://dl.ndl.go.jp/api/iiif/948741/R0000003',
        bindings: { title: 'label', license: 'rights' },
        copiedValues: { title: { ja: '見本の地図' } },
        copiedMetadata: [{ label: '所蔵', value: '見本の資料' }],
        copiedAt: '2026-10-28T00:00:00.000Z',
      };

      // 既存の項目も一緒に往復させ、keys の書き換えで落ちないことを見る。
      const store = {
        title: { ja: '見本の地図' },
        label: { ja: '見本' },
        attr: { ja: '見本の所蔵' },
        dataAttr: { ja: '見本の所蔵' },
        author: { ja: '見本' },
        createdAt: { ja: '1900' },
        era: { ja: '明治' },
        license: 'CC0',
        dataLicense: 'CC-BY',
        licenseNote: { ja: '自由に使えます' },
        dataLicenseNote: { ja: '出典を書いてください' },
        contributor: { ja: '見本' },
        mapper: { ja: '見本' },
        reference: 'https://example.org/reference',
        description: { ja: '見本の説明' },
        url: '',
        lang: 'ja',
        imageExtension: 'jpg',
        width: 4074,
        height: 2705,
        strictMode: 'strict',
        vertexMode: 'plain',
        yaxisMode: 'up',
        gcps: [
          { source: [0, 0], target: [139.7, 35.6] },
          { source: [4074, 0], target: [139.8, 35.6] },
          { source: [0, 2705], target: [139.7, 35.7] },
        ],
        edges: [],
        sub_maps: [],
        homePosition: [139.75, 35.65],
        mercZoom: 12,
        pois: [{ poiUid: 'poi-1', cachedTitle: '見本' }],
        delivery,
        iiif,
      };

      const [histMap, tins] = await store2HistMap(store, false);
      assert.deepEqual(histMap.delivery, delivery, 'store2HistMap が delivery を落としている');
      assert.deepEqual(histMap.iiif, iiif, 'store2HistMap が iiif を落としている');
      assert.deepEqual(histMap.title, store.title, 'store2HistMap が title を落としている');
      assert.deepEqual(histMap.label, store.label, 'store2HistMap が label を落としている');
      assert.deepEqual(histMap.licenseNote, store.licenseNote, 'store2HistMap が licenseNote を落としている');
      assert.deepEqual(histMap.pois, store.pois, 'store2HistMap が pois を落としている');

      const saved = await histMap2Store(histMap, tins);
      assert.deepEqual(saved.delivery, delivery, 'histMap2Store が delivery を落としている');
      assert.deepEqual(saved.iiif, iiif, 'histMap2Store が iiif を落としている');
      assert.deepEqual(saved.title, store.title, 'histMap2Store が title を落としている');
      assert.deepEqual(saved.label, store.label, 'histMap2Store が label を落としている');
      assert.equal(saved.license, store.license, 'histMap2Store が license を落としている');
      assert.deepEqual(saved.licenseNote, store.licenseNote, 'histMap2Store が licenseNote を落としている');
      assert.deepEqual(saved.pois, store.pois, 'histMap2Store が pois を落としている');
      assert.equal(saved.width, store.width, 'histMap2Store が width を落としている');
      assert.equal(saved.height, store.height, 'histMap2Store が height を落としている');
      assert.equal(saved.lang, store.lang, 'histMap2Store が lang を落としている');
      assert.equal(saved.reference, store.reference, 'histMap2Store が reference を落としている');

      console.log('ok: store-roundtrip');
    `,
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
        output: {
          entryFileNames: 'iiif-import-save-smoke.mjs',
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
} catch (error) {
  if (error && typeof error === 'object' && 'stdout' in error && error.stdout) {
    process.stdout.write(String(error.stdout));
  }
  if (error && typeof error === 'object' && 'stderr' in error && error.stderr) {
    process.stderr.write(String(error.stderr));
  }
  console.error(
    'iiif import save smoke: failed: ' +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
