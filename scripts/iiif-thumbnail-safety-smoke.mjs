// IIIF のサムネイル（52px・512px）の安全確認の smoke。
//   1. 512px は復号の前に JPEG のヘッダだけで判定し、巨大なヘッダは復号せずに警告へ落とす
//   2. 52px はバイトをそのまま下書きへ書き、512px は判定を通したうえで符号化して書く
//   3. JPEG 以外の Content-Type は書かずに警告へ落とす
//   4. 判定の比較（decoderHeapMB）が共通の芯の外に無いことをソースで確かめる
// 既存の smoke と同じく、vite の ssr build で main の TS を束ね、electron をスタブして
// 子プロセスで走らせる（実データ不使用・ネットワーク不使用）。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const serviceFile = path.join(projectRoot, 'electron/services/MapUploadService.ts');
const fixtureDir = path.join(projectRoot, 'tests/fixtures/iiif');
const thumbPathsFile = path.join(projectRoot, 'src/utils/thumbnailPaths.ts');

// ---- ソース検査（バンドル前に実施する） -------------------------------------
{
  const serviceSrc = await readFile(serviceFile, 'utf8');

  assert.match(
    serviceSrc,
    /estimateJpegDecodeBudget\s*\(/u,
    'ヘッダの見積もり estimateJpegDecodeBudget を呼ぶこと',
  );
  assert.match(
    serviceSrc,
    /resolveDecodeSafety\s*\(/u,
    'この機械の上限 resolveDecodeSafety を呼ぶこと',
  );

  // 行番号ではなく関数の構造で本体を切り出す（周辺の編集に強い）
  const preflightMatch = serviceSrc.match(/function preflightJpegDecode\([\s\S]*?\n\}\n/u);
  assert.ok(preflightMatch, 'preflightJpegDecode の定義が見つからない');

  const saveMatch = serviceSrc.match(/export async function saveIiifThumbnails\([\s\S]*?\n\}\n/u);
  assert.ok(saveMatch, 'saveIiifThumbnails の定義が見つからない');
  assert.match(
    saveMatch[0],
    /preflightJpegDecode\s*\(/u,
    'saveIiifThumbnails は切り出した判定 preflightJpegDecode を通ること',
  );

  // 共通の芯の外に、ヒープ量の比較（decoderHeapMB と上限の比べる式）を残さない
  const outsidePreflight = serviceSrc.replace(preflightMatch[0], '');
  const comparisons = outsidePreflight.match(/decoderHeapMB\s*(?:>=|<=|>|<)/gu) ?? [];
  assert.equal(
    comparisons.length,
    0,
    'decoderHeapMB の比較は preflightJpegDecode の中だけに置くこと（外に ' + comparisons.length + ' 件）',
  );
  console.log('ok: decoder-compare-only-in-preflight');
}

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'iiif-thumbnail-safety-'));
const entryFile = path.join(workDir, 'iiif-thumbnail-safety-entry.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'iiif-thumbnail-safety-entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    electronStubFile,
    `
      const handlers = new Map();
      export const __handlers = handlers;
      export const app = {
        getPath(name) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditorSmoke'; },
      };
      export const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), removeHandler: (ch) => handlers.delete(ch) };
      export const dialog = {
        async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      };
      export const BrowserWindow = class {};
      export const session = { defaultSession: { webRequest: { onBeforeRequest: () => {} } } };
    `,
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store {
        constructor(options = {}) { this.store = { ...(options.defaults || {}) }; }
        get(key) { return this.store[key]; }
        set(key, value) { this.store[key] = value; }
        has(key) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `,
  );

  await writeFile(
    entryFile,
    `
      import fs from 'node:fs/promises';
      import nodePath from 'node:path';
      import assert from 'node:assert/strict';
      import { Jimp } from 'jimp';

      const fixtureDir = ${JSON.stringify(fixtureDir)};
      const workDir = ${JSON.stringify(workDir)};
      const dataDir = ${JSON.stringify(dataDir)};

      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', dataDir);
      SettingsService.set('lang', 'ja');

      const { THUMB_512_TMP_BASENAME } = await import(${JSON.stringify(thumbPathsFile)});
      const { saveIiifThumbnails } = await import(${JSON.stringify(serviceFile)});

      const fixture = (name) => fs.readFile(nodePath.join(fixtureDir, name));
      const exists = (filePath) => fs.stat(filePath).then(() => true).catch(() => false);

      // (a) ヘッダが巨大な JPEG は復号せずに警告（取り込み全体は失敗させない）
      const outA = nodePath.join(workDir, 'a');
      await fs.mkdir(outA, { recursive: true });
      let decodeCalls = 0;
      const decodeJpeg = async (buffer, options) => {
        decodeCalls += 1;
        return Jimp.fromBuffer(buffer, { 'image/jpeg': options });
      };
      const resultA = await saveIiifThumbnails(
        outA,
        {
          thumb52: { body: await fixture('thumb-52.jpg'), contentType: 'image/jpeg' },
          thumb512: { body: await fixture('thumb-huge-header.jpg'), contentType: 'image/jpeg' },
        },
        { decodeJpeg },
      );
      assert.equal(resultA.ok, true, '52px が書けていれば全体は成功: ' + JSON.stringify(resultA));
      const machineWarning = resultA.warnings.find((w) => w.errorCode === 'jpeg_machine_limit');
      assert.ok(machineWarning, '512px は jpeg_machine_limit の警告になる: ' + JSON.stringify(resultA.warnings));
      assert.equal(decodeCalls, 0, '復号してはいけない（復号の回数）');
      assert.equal(
        await exists(nodePath.join(outA, THUMB_512_TMP_BASENAME)),
        false,
        '警告になった 512px は書かない',
      );
      assert.equal(await exists(nodePath.join(outA, 'thumbnail.jpg')), true, '52px は書く');
      console.log('ok: reject-huge-header');
      console.log('decode calls: ' + decodeCalls);

      // (b) 52px はバイトをそのまま、512px は判定を通して書く
      const outB = nodePath.join(workDir, 'b');
      await fs.mkdir(outB, { recursive: true });
      const body52 = await fixture('thumb-52.jpg');
      const resultB = await saveIiifThumbnails(outB, {
        thumb52: { body: body52, contentType: 'image/jpeg' },
        thumb512: { body: await fixture('thumb-512.jpg'), contentType: 'image/jpeg' },
      });
      assert.equal(resultB.ok, true, '52px・512px とも書ける: ' + JSON.stringify(resultB));
      assert.deepEqual(resultB.warnings, [], '警告は無い: ' + JSON.stringify(resultB.warnings));
      const written52 = await fs.readFile(nodePath.join(outB, 'thumbnail.jpg'));
      assert.ok(written52.equals(body52), '52px は復号せずバイトをそのまま書く');
      assert.equal(
        await exists(nodePath.join(outB, THUMB_512_TMP_BASENAME)),
        true,
        '512px は下書きの名で書く',
      );
      console.log('ok: writes-thumbnail-drafts');

      // (c) JPEG 以外の Content-Type の 512px は書かずに警告
      const outC = nodePath.join(workDir, 'c');
      await fs.mkdir(outC, { recursive: true });
      const resultC = await saveIiifThumbnails(outC, {
        thumb52: { body: await fixture('thumb-52.jpg'), contentType: 'image/jpeg' },
        thumb512: { body: await fixture('thumb-512.jpg'), contentType: 'image/png' },
      });
      assert.equal(resultC.ok, true, '52px が書けていれば全体は成功: ' + JSON.stringify(resultC));
      assert.ok(
        resultC.warnings.some((w) => w.errorCode === 'not_jpeg'),
        'JPEG 以外は not_jpeg の警告: ' + JSON.stringify(resultC.warnings),
      );
      assert.equal(
        await exists(nodePath.join(outC, THUMB_512_TMP_BASENAME)),
        false,
        'JPEG 以外の 512px は書かない',
      );
      console.log('ok: skips-non-jpeg-512');

      console.log('iiif thumbnail safety smoke: ALL PASS');
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
        output: {
          entryFileNames: 'iiif-thumbnail-safety-entry.mjs',
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
} finally {
  // .tmp-smoke は破壊的操作禁止のため残置
}
