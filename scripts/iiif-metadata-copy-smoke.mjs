// 取り込みのときの最初の書誌の写しの smoke。
//
// renderer の薄い包み（src/utils/iiifMetadataCopy.ts）が、Core の
// proposeIiifBindings と resolveIiifMetadata をそのまま使っていることを確かめる。
// 包みの戻り値を、同じ Manifest・同じ canvas・同じ偽の sanitize で Core を
// 直接呼んだ結果と突き合わせる（期待する鍵の一覧を手で固定しない）。
//
// Node には window が無いので、洗浄の関数は包みにも Core にも偽物を渡す。
// `@maplat/core/common` は DOM を読むので、束ねるときに小さな代役へ差し替える。
//
// 使い方: node scripts/iiif-metadata-copy-smoke.mjs
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'iiif-metadata-copy-'));
const entryFile = path.join(workDir, 'iiif-metadata-copy-smoke-entry.ts');
const commonStubFile = path.join(workDir, 'common-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'iiif-metadata-copy-smoke.mjs');

const fixtureDir = path.join(projectRoot, 'tests/fixtures/iiif');
const coreModulePath = path.join(projectRoot, 'node_modules/@maplat/core/src/iiif/manifest.ts');
const copyModulePath = path.join(projectRoot, 'src/utils/iiifMetadataCopy.ts');

try {
  // `@maplat/core/common` は DOMPurify と DOM を読む。この試験は洗浄の関数を
  // すべて差し替えるので、入口だけ小さな代役にする。
  await writeFile(
    commonStubFile,
    `
      export function sanitizeIiifHtml() {
        throw new Error('sanitizeIiifHtml is not available without a window');
      }
    `,
  );
  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import path from 'node:path';

      const {
        IIIF_BINDABLE_KEYS,
        listIiifCanvases,
        proposeIiifBindings,
        resolveIiifMetadata,
      } = await import(${JSON.stringify(coreModulePath)});
      const {
        applyIiifValues,
        copyIiifMetadata,
        copyIiifMetadataWithBindings,
        iiifBindableKeys,
        setIiifBinding,
      } = await import(${JSON.stringify(copyModulePath)});

      const fixtureDir = ${JSON.stringify(fixtureDir)};
      const fixture = (name) => JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8'));

      // 洗浄の関数は包みにも Core にも同じものを渡す（値がそのまま同じになることを見る）。
      const sanitize = (html) => 'clean:' + html;

      const tests = [];
      const test = (name, fn) => { tests.push({ name, fn }); };

      const ndl = fixture('ndl-948741.manifest.json');
      const minimal = fixture('manifest-v3-minimal.manifest.json');
      const ndlCanvases = listIiifCanvases(ndl);
      assert.equal(ndlCanvases.ok, true, 'NDL manifest must be readable');
      const minimalCanvases = listIiifCanvases(minimal);
      assert.equal(minimalCanvases.ok, true, 'minimal manifest must be readable');

      const targets = [
        { label: 'ndl-third-canvas', manifest: ndl, canvasId: ndlCanvases.canvases[2].id },
        { label: 'minimal-first-canvas', manifest: minimal, canvasId: minimalCanvases.canvases[0].id },
      ];

      test('copy-matches-core', async () => {
        let passed = 0;
        for (const target of targets) {
          const lang = 'ja';
          const copied = copyIiifMetadata(target.manifest, target.canvasId, lang, { sanitize });
          assert.equal(copied.ok, true, target.label + ': the wrapper must succeed');
          const bindings = proposeIiifBindings(target.manifest, target.canvasId);
          const expected = resolveIiifMetadata(
            target.manifest,
            { canvas: target.canvasId, bindings },
            lang,
            sanitize,
          );
          assert.equal(expected.ok, true, target.label + ': Core resolve must succeed');
          assert.deepEqual(copied.bindings, bindings, target.label + ': bindings must match Core');
          assert.deepEqual(copied.values, expected.values, target.label + ': values must match Core');
          assert.deepEqual(
            copied.copiedValues,
            expected.copiedValues,
            target.label + ': copiedValues must match Core',
          );
          assert.deepEqual(
            copied.copiedMetadata,
            expected.copiedMetadata,
            target.label + ': copiedMetadata must match Core',
          );
          assert.ok(
            typeof copied.copiedAt === 'string' && !Number.isNaN(Date.parse(copied.copiedAt)),
            target.label + ': copiedAt must be an ISO 8601 string but was ' + String(copied.copiedAt),
          );
          assert.equal(
            copied.copiedAt,
            new Date(copied.copiedAt).toISOString(),
            target.label + ': copiedAt must be the canonical ISO 8601 form',
          );
          passed += 1;
        }
        return '(' + passed + '/' + targets.length + ')';
      });

      test('bindable-keys-only', async () => {
        for (const target of targets) {
          const copied = copyIiifMetadata(target.manifest, target.canvasId, 'ja', { sanitize });
          for (const key of Object.keys(copied.bindings ?? {})) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(IIIF_BINDABLE_KEYS, key),
              target.label + ': binding key ' + key + ' is outside the bindable keys',
            );
          }
        }
        // NDL の 3 コマ目は題名・帰属・ライセンスの 3 鍵が入る（Core の既定の 1 行の確認）
        const ndlBindings = proposeIiifBindings(ndl, ndlCanvases.canvases[2].id);
        assert.deepEqual(
          Object.keys(ndlBindings).sort(),
          ['attr', 'license', 'title'],
          'NDL third canvas must bind title, attr and license',
        );
      });

      // 写す鍵の選択と取り出し元が結び付けに入り、写した値が Core の解決器と
      // 一致することの確認。是正を見分けるのは、(1) 鍵の一覧を Core の表の鍵と
      // deepEqual すること、(2) 取り出し元の property を Core の表から取った値と
      // deepEqual すること、(3) 写した値を Core の resolveIiifMetadata の直接呼び出しと
      // deepEqual すること、(4) 地図の欄で写さない言語・鍵が残ること。
      test('metadata-bindings', async () => {
        assert.deepEqual(
          iiifBindableKeys(),
          Object.keys(IIIF_BINDABLE_KEYS),
          'the bindable keys must be the keys of the Core table',
        );

        for (const target of targets) {
          const lang = 'ja';
          const proposed = proposeIiifBindings(target.manifest, target.canvasId);
          const proposedCopy = JSON.parse(JSON.stringify(proposed));

          let bindings = setIiifBinding(proposed, 'description', 'manifest');
          assert.deepEqual(
            bindings.description,
            { from: 'manifest', property: IIIF_BINDABLE_KEYS.description },
            target.label + ': the property must come from the Core table',
          );
          bindings = setIiifBinding(bindings, 'description', null);
          assert.equal(
            Object.prototype.hasOwnProperty.call(bindings, 'description'),
            false,
            target.label + ': a key removed with null must not stay in the bindings',
          );
          bindings = setIiifBinding(bindings, 'title', 'canvas');
          assert.deepEqual(
            bindings.title,
            { from: 'canvas', property: IIIF_BINDABLE_KEYS.title },
            target.label + ': the chosen source must be kept in the bindings',
          );
          const beforeUnknown = JSON.parse(JSON.stringify(bindings));
          bindings = setIiifBinding(bindings, 'licenseNote', 'manifest');
          assert.deepEqual(
            bindings,
            beforeUnknown,
            target.label + ': a key outside the Core table must not change the bindings',
          );
          assert.deepEqual(
            proposed,
            proposedCopy,
            target.label + ': the input bindings must not be changed',
          );

          const copied = copyIiifMetadataWithBindings(
            target.manifest,
            { canvas: target.canvasId, bindings },
            lang,
            { sanitize },
          );
          const expected = resolveIiifMetadata(
            target.manifest,
            { canvas: target.canvasId, bindings },
            lang,
            sanitize,
          );
          assert.equal(copied.ok, true, target.label + ': the copy with the bindings must succeed');
          assert.equal(expected.ok, true, target.label + ': Core resolve must succeed');
          assert.deepEqual(copied.bindings, bindings, target.label + ': the bindings must be the ones given');
          assert.deepEqual(copied.values, expected.values, target.label + ': values must match Core');
          assert.deepEqual(
            copied.copiedValues,
            expected.copiedValues,
            target.label + ': copiedValues must match Core',
          );
          assert.deepEqual(
            copied.copiedMetadata,
            expected.copiedMetadata,
            target.label + ': copiedMetadata must match Core',
          );
          assert.ok(
            typeof copied.copiedAt === 'string' && !Number.isNaN(Date.parse(copied.copiedAt)),
            target.label + ': copiedAt must be an ISO 8601 string',
          );
          assert.equal(
            Object.prototype.hasOwnProperty.call(copied.values, 'description'),
            false,
            target.label + ': a removed key must not be copied',
          );
        }

        // 地図の metadata へ写すときは、写した言語だけを入れ、他の言語と写さない鍵は残す。
        const base = {
          title: { ja: '古い題名', en: 'Old title' },
          description: '古い説明',
          attr: { ja: '古い帰属', en: 'Old attribution' },
          license: 'CC BY',
        };
        const applied = applyIiifValues(
          base,
          { title: { ja: '新しい題名' }, description: '新しい説明' },
          'ja',
        );
        assert.deepEqual(
          applied.title,
          { ja: '新しい題名', en: 'Old title' },
          'the copied language must replace only that language',
        );
        assert.equal(applied.description, '新しい説明', 'a plain string field must be replaced');
        assert.deepEqual(applied.attr, base.attr, 'a key that was not copied must stay as it was');
        assert.equal(applied.license, 'CC BY', 'a key that was not copied must stay as it was');
        assert.deepEqual(
          base.title,
          { ja: '古い題名', en: 'Old title' },
          'the target must not be changed',
        );
        assert.equal(base.description, '古い説明', 'the target must not be changed');

        // 写した値が地図の言語を持たないときは、その値の最初の言語を使う。
        const fallback = applyIiifValues(
          { title: { ja: '古い題名' } },
          { title: { en: 'New title' } },
          'ja',
        );
        assert.deepEqual(
          fallback.title,
          { ja: '古い題名', en: 'New title' },
          'the first language of the value must be used when the map language is missing',
        );
      });

      let failed = 0;
      for (const item of tests) {
        try {
          const suffix = await item.fn();
          console.log('ok: ' + item.name + (suffix ? ' ' + suffix : ''));
        } catch (error) {
          failed += 1;
          console.error('fail: ' + item.name + ': ' + (error instanceof Error ? error.message : String(error)));
        }
      }
      console.log('fail: ' + failed);
      if (failed > 0) {
        console.error('failed: ' + failed + ' of ' + tests.length);
        process.exit(1);
      }
      console.log('passed: ' + tests.length);
    `,
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: '@maplat/core/common', replacement: commonStubFile },
        {
          find: '@maplat/core/src',
          replacement: path.join(projectRoot, 'node_modules/@maplat/core/src'),
        },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        output: {
          entryFileNames: 'iiif-metadata-copy-smoke.mjs',
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
    'iiif metadata copy smoke: failed: ' +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}
