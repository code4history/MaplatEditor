// assetIdentity 純関数モジュール(ADR-0007)のスモーク。
// slug検証・uid生成・スラッグ衝突解消(数値サフィックス方式)の振る舞いを検証する。
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'asset-identity-'));
const entryFile = path.join(workDir, 'asset-identity-smoke.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'asset-identity-smoke.mjs');

try {
  const assetIdentityPath = path.join(projectRoot, 'electron/services/assetIdentity.ts');

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const { isValidSlug, generateUid, resolveSlugCollision } = await import(${JSON.stringify(assetIdentityPath)});

      assert.equal(isValidSlug('abc_-1'), true, 'abc_-1 は有効なslugのはず');
      console.log('ok: isValidSlug accepts alnum/underscore/hyphen');

      assert.equal(isValidSlug('a#b'), false, 'a#b は無効なslugのはず');
      console.log('ok: isValidSlug rejects symbols');

      assert.equal(isValidSlug('日本語'), false, '日本語 は無効なslugのはず');
      console.log('ok: isValidSlug rejects non-ASCII');

      assert.equal(isValidSlug(''), false, '空文字は無効なslugのはず');
      console.log('ok: isValidSlug rejects empty string');

      const uid1 = generateUid();
      const uid2 = generateUid();
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert.match(uid1, uuidPattern, 'generateUid はUUID v4形式を返すはず');
      assert.notEqual(uid1, uid2, '2回の呼び出しで異なるUIDが生成されるはず');
      console.log('ok: generateUid returns distinct UUID v4 values');

      assert.equal(
        resolveSlugCollision('map', (s) => ['map', 'map_2'].includes(s)),
        'map_3',
        '既存の map, map_2 と衝突する場合は map_3 になるはず'
      );
      console.log('ok: resolveSlugCollision skips taken numeric suffixes');

      assert.equal(
        resolveSlugCollision('map', () => false),
        'map',
        '衝突がなければそのまま返すはず'
      );
      console.log('ok: resolveSlugCollision returns desired when free');

      assert.equal(
        resolveSlugCollision('', () => false),
        'untitled',
        '空文字は untitled に正規化されるはず'
      );
      console.log('ok: resolveSlugCollision normalizes empty to untitled');

      assert.equal(
        resolveSlugCollision('あ', () => false),
        'untitled',
        'SLUG_PATTERNに違反する文字列は untitled に正規化されるはず'
      );
      console.log('ok: resolveSlugCollision normalizes invalid slug to untitled');

      assert.equal(
        resolveSlugCollision('untitled', (s) => s === 'untitled'),
        'untitled_2',
        'untitled が既に使われていれば untitled_2 になるはず'
      );
      console.log('ok: resolveSlugCollision appends suffix to untitled when taken');

      console.log('M8-T1 asset identity smoke passed');
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
        output: {
          entryFileNames: 'asset-identity-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 8,
  });
  console.log('M8-T1 asset identity smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
