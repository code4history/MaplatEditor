// M5-T2 AC6: `url` を多言語オブジェクトとして扱う経路が新たに生じていないことの回帰。
//
// なぜ必要か（設計書 §1 / マイルストーン不変条件 I-1）:
//   `HistMapStore.url` の型宣言は `LangResource`（= string | Record<string,string>）だったが、
//   実体は単一文字列のタイルURLテンプレートである。本タスクで型宣言を `string` へ是正した。
//   型は消えても、`MAP_LANG_ATTRS`（言語別フィールドの単一の正本）に後から `url` が
//   紛れ込めば、保存・エクスポート経路で再び多言語オブジェクトへ畳み込まれてしまう。
//   ∴ **実行時の挙動として**その経路が生じていないことを固定する。
//
// 位置づけ:
//   本 smoke は RED からの GREEN ではなく**回帰ガード**である（実装前後とも GREEN）。
//   守っているのは「将来 url が MAP_LANG_ATTRS へ追加されないこと」であり、
//   ソーステキストの grep ではなく実モジュールを import して実挙動を assert する。
//
// 参照: docs/superpowers/specs/2026-08-03-m5-t2-url-type-declaration-design.md
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t2-url-type-'));
const entryFile = path.join(workDir, 'm5-t2-url-type-smoke.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm5-t2-url-type-smoke.mjs');

try {
  const langResourcePath = path.join(projectRoot, 'src/utils/langResource.ts');

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const {
        MAP_LANG_ATTRS,
        normalizeMapLangFields,
        compactMapLangFields,
      } = await import(${JSON.stringify(langResourcePath)});

      const TILE_URL = 'https://t.example.jp/ext/{z}/{x}/{y}.jpg';

      // --- AC6-1: url は言語別フィールドの集合に属さない ---
      assert.ok(
        Array.isArray(MAP_LANG_ATTRS) && MAP_LANG_ATTRS.length > 0,
        'MAP_LANG_ATTRS は非空の配列のはず'
      );
      assert.equal(
        MAP_LANG_ATTRS.includes('url'), false,
        'AC6-1: MAP_LANG_ATTRS に url が含まれてはいけない（不変条件 I-1）。実際: ' + JSON.stringify(MAP_LANG_ATTRS)
      );
      console.log('ok: AC6-1 MAP_LANG_ATTRS does not contain url');

      // --- AC6-2: 内部形への正規化で url が畳み込まれない ---
      // 言語別フィールド (title) はオブジェクトへ正規化されるのに対し、url は文字列のまま素通しになる。
      // 「url だけが対象外である」ことを、同じ入力の中で対比して固定する
      const normalized = normalizeMapLangFields({ lang: 'ja', title: 'T', url: TILE_URL });
      assert.deepEqual(
        normalized.title, { ja: 'T' },
        'AC6-2: 言語別フィールド title は内部形（オブジェクト）へ正規化されるはず'
      );
      assert.strictEqual(
        normalized.url, TILE_URL,
        'AC6-2: url は正規化されず文字列のまま素通しするはず。実際: ' + JSON.stringify(normalized.url)
      );
      console.log('ok: AC6-2 normalizeMapLangFields leaves url untouched while folding title');

      // --- AC6-3: 交換形への畳み込みでも url が変換されない ---
      const compacted = compactMapLangFields({ lang: 'ja', title: { ja: 'T' }, url: TILE_URL });
      assert.strictEqual(
        compacted.title, 'T',
        'AC6-3: 言語別フィールド title は交換形（プレーン文字列）へ畳み込まれるはず'
      );
      assert.strictEqual(
        compacted.url, TILE_URL,
        'AC6-3: url は交換形でも文字列のまま素通しするはず。実際: ' + JSON.stringify(compacted.url)
      );
      console.log('ok: AC6-3 compactMapLangFields leaves url untouched while folding title');

      console.log('M5-T2 url type smoke passed');
      process.exit(0);
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
        output: { entryFileNames: 'm5-t2-url-type-smoke.mjs', format: 'es' },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
