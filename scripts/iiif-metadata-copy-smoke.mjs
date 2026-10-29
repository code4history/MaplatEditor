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
        compareIiifCopy,
        listIiifCanvases,
        proposeIiifBindings,
        resolveIiifMetadata,
      } = await import(${JSON.stringify(coreModulePath)});
      const {
        applyIiifRecopy,
        applyIiifValues,
        copyIiifMetadata,
        copyIiifMetadataWithBindings,
        iiifBindableKeys,
        planIiifRecopy,
        setIiifBinding,
      } = await import(${JSON.stringify(copyModulePath)});

      const projectRoot = ${JSON.stringify(projectRoot)};
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

      // 写し直しの題材。NDL の 3 コマ目で最初の写しを作り、試験の中でだけ
      // Manifest の写しを書き換えて「新しい Manifest」にする（資料のファイルは変えない）。
      // 4 つの鍵で 4 通りを作る:
      //   title         … 人が直しておらず IIIF も同じ（変わらない）
      //   officialTitle … 人が直した（人が直した）
      //   attr          … IIIF の側が変わった（IIIF の側が変わった）
      //   license       … 人が直し、IIIF の側も変わった（両方）
      const buildRecopyScenario = () => {
        const lang = 'ja';
        const canvasId = ndlCanvases.canvases[2].id;
        const proposed = proposeIiifBindings(ndl, canvasId);
        const bindings = setIiifBinding(proposed, 'officialTitle', 'manifest');
        const first = copyIiifMetadataWithBindings(ndl, { canvas: canvasId, bindings }, lang, { sanitize });
        assert.equal(first.ok, true, 'the first copy must succeed');
        const map = {
          ...applyIiifValues({}, first.values, lang),
          iiif: {
            manifest: ndl['@id'],
            canvas: canvasId,
            bindings,
            copiedValues: first.copiedValues,
            copiedMetadata: first.copiedMetadata,
            copiedAt: first.copiedAt,
          },
          lang,
        };
        // 人が手で直した値（officialTitle と license）
        map.officialTitle = '手で直した題名';
        map.license = '手で直したライセンス';
        // 新しい Manifest（写しを書き換える。資料のファイルは変えない）
        const changed = structuredClone(ndl);
        changed.attribution = '新しい帰属';
        changed.license = 'https://creativecommons.org/licenses/by/4.0/';
        changed.metadata[1].value = '新潟市圖（改訂）';
        const reply = { ok: true, json: changed, requestedUrl: ndl['@id'], finalUrl: ndl['@id'] };
        return { map, reply, lang, canvasId };
      };

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

      // 写し直しの 4 通り。是正を見分けるのは、(1) 4 通りそれぞれの理由の語が
      // 表のとおりであること、(2) その理由が Core の compareIiifCopy の
      // humanEdited／iiifChanged と一致すること、(3) 行の今の値・写した時点の値・
      // 新しい値が 3 つの出どころと一致すること、(4) 計画が地図を変えないこと。
      test('recopy-table', async () => {
        const { map, reply, lang } = buildRecopyScenario();
        const snapshot = structuredClone(map);
        const plan = planIiifRecopy(reply, map, { sanitize });
        assert.equal(plan.ok, true, 'the recopy plan must succeed');
        assert.deepEqual(map, snapshot, 'the plan must not change the map');

        const compared = compareIiifCopy(map, map.iiif.copiedValues, plan.fresh.copiedValues, lang);
        assert.equal(plan.rows.length, compared.length, 'the plan must have one row per compared item');
        const coreByRow = new Map(compared.map((row) => [row.key + '/' + row.lang, row]));

        const expectations = [
          ['title/ja', 'unchanged'],
          ['officialTitle/ja', 'human-edited'],
          ['attr/ja', 'iiif-changed'],
          ['license/ja', 'both'],
        ];
        let passed = 0;
        for (const [id, expectedReason] of expectations) {
          const row = plan.rows.find((item) => item.key + '/' + item.lang === id);
          assert.ok(row, id + ': the row must be in the plan');
          assert.equal(row.reason, expectedReason, id + ': the reason must match the table');
          const core = coreByRow.get(id);
          assert.ok(core, id + ': Core must compare the row');
          assert.equal(
            core.humanEdited,
            expectedReason === 'human-edited' || expectedReason === 'both',
            id + ': humanEdited must match the reason',
          );
          assert.equal(
            core.iiifChanged === true,
            expectedReason === 'iiif-changed' || expectedReason === 'both',
            id + ': iiifChanged must match the reason',
          );
          passed += 1;
        }

        // 行の 3 つの値は、地図・写した時点の控え・新しい取得から取る。
        const attrRow = plan.rows.find((item) => item.key === 'attr');
        assert.equal(attrRow.current, map.attr, 'the current value must come from the map');
        assert.equal(attrRow.copied, map.iiif.copiedValues.attr.ja, 'the copied value must come from copiedValues');
        assert.equal(attrRow.next, plan.fresh.copiedValues.attr.ja, 'the next value must come from the fresh copy');
        const noteRow = plan.rows.find((item) => item.key === 'licenseNote');
        assert.equal(
          noteRow.next,
          undefined,
          'a value that disappeared from the IIIF side must have no next value',
        );
        return '(' + passed + '/' + expectations.length + ')';
      });

      // 選んだ行だけの上書き。是正を見分けるのは、(1) 選んだ iiif-changed の行だけ
      // 地図の値と copiedValues が新しい値になること、(2) 選ばなかった人が直した行
      // （human-edited・both）の地図の値と copiedValues が変える前のままであること、
      // (3) copiedMetadata が新しい取得の値になり copiedAt が差し替えた時計になること、
      // (4) 何も選ばなければ戻り値が入力と同じであること、(5) 入力の地図を変えないこと。
      test('copied-values-rebuilt', async () => {
        const { map, reply, lang } = buildRecopyScenario();
        const plan = planIiifRecopy(reply, map, { sanitize });
        assert.equal(plan.ok, true, 'the recopy plan must succeed');
        // 基準は変える前の値で取る。
        const before = structuredClone(map);

        const selected = plan.rows
          .filter((row) => row.reason === 'iiif-changed')
          .map((row) => ({ key: row.key, lang: row.lang }));
        assert.ok(
          selected.some((row) => row.key === 'attr'),
          'the IIIF-changed row must be selectable',
        );

        const nowText = '2026-01-02T03:04:05.000Z';
        const now = () => new Date(nowText);
        const next = applyIiifRecopy(map, plan, selected, { sanitize, now });

        // (a) 選んだ行の値と copiedValues が新しい値になる
        assert.equal(
          next.attr,
          plan.fresh.copiedValues.attr[lang],
          'the selected field must take the new value',
        );
        assert.deepEqual(
          next.iiif.copiedValues.attr,
          plan.fresh.copiedValues.attr,
          'the selected key must take the new copied values',
        );

        // (b) 選ばなかった手で直した行の値と copiedValues は変える前のまま
        assert.equal(
          next.officialTitle,
          before.officialTitle,
          'a hand-edited row that was not selected must keep the hand value',
        );
        assert.deepEqual(
          next.iiif.copiedValues.officialTitle,
          before.iiif.copiedValues.officialTitle,
          'a hand-edited row that was not selected must keep the copied values',
        );
        assert.equal(
          next.license,
          before.license,
          'the both row that was not selected must keep the hand value',
        );
        assert.deepEqual(
          next.iiif.copiedValues.license,
          before.iiif.copiedValues.license,
          'the both row that was not selected must keep the copied values',
        );

        assert.deepEqual(
          next.iiif.copiedValues.licenseNote,
          before.iiif.copiedValues.licenseNote,
          'a row with no new value must not be overwritten',
        );
        assert.deepEqual(
          next.iiif.copiedValues.title,
          before.iiif.copiedValues.title,
          'an unchanged row that was not selected must stay as it was',
        );

        // (c) copiedMetadata は新しい取得の値、copiedAt は差し替えた時計
        assert.deepEqual(
          next.iiif.copiedMetadata,
          plan.fresh.copiedMetadata,
          'copiedMetadata must be rebuilt from the fresh manifest',
        );
        assert.notDeepEqual(
          next.iiif.copiedMetadata,
          before.iiif.copiedMetadata,
          'the fresh copiedMetadata must differ from the old one',
        );
        assert.equal(next.iiif.copiedAt, nowText, 'copiedAt must use the injected clock');

        // ライセンスを選んだら、その注記も新しい値にそろえる（無ければ消す）。
        const noteDeleted = applyIiifRecopy(map, plan, [{ key: 'license', lang }], { sanitize, now });
        assert.equal(
          noteDeleted.license,
          plan.fresh.copiedValues.license[lang],
          'the selected license must take the new value',
        );
        assert.equal(
          Object.prototype.hasOwnProperty.call(noteDeleted, 'licenseNote'),
          false,
          'a license note that the new value does not have must be removed',
        );
        assert.equal(
          Object.prototype.hasOwnProperty.call(noteDeleted.iiif.copiedValues, 'licenseNote'),
          false,
          'a license note that the new value does not have must be removed from copiedValues',
        );
        const withNote = { ok: true, json: structuredClone(reply.json) };
        withNote.json.license = 'https://example.org/terms';
        const notePlan = planIiifRecopy(withNote, map, { sanitize });
        assert.equal(notePlan.ok, true, 'the plan for the license with a note must succeed');
        const noteAdded = applyIiifRecopy(map, notePlan, [{ key: 'license', lang }], { sanitize, now });
        assert.equal(
          noteAdded.licenseNote,
          'https://example.org/terms',
          'the license note of the new value must be copied with the license',
        );
        assert.deepEqual(
          noteAdded.iiif.copiedValues.licenseNote,
          { [lang]: 'https://example.org/terms' },
          'the license note of the new value must be kept with the license',
        );

        // (4) 入力は変えない (5) 何も選ばなければ何も変えない
        assert.deepEqual(map, before, 'the input map must not be changed');
        assert.deepEqual(
          applyIiifRecopy(map, plan, [], { sanitize, now }),
          before,
          'nothing selected must change nothing',
        );
      });

      // 失敗したときに地図を書き換えないことの確認。是正を見分けるのは、
      // (1) 3 通りの失敗で ok:false と期待する理由を返すこと、(2) 呼んだ後の地図の
      // JSON が控えと同じであること（比べる前の値を基準に取る）、(3) delivery の無い
      // 地図では同じ Manifest でも size-mismatch にならないこと、(4) 画面の案内の
      // 文言が空でなく「取り込み直」「re-import」を含まないこと。
      test('recopy-fail-keeps-data', async () => {
        const lang = 'ja';
        const canvasId = ndlCanvases.canvases[2].id;
        const bindings = proposeIiifBindings(ndl, canvasId);
        const first = copyIiifMetadataWithBindings(ndl, { canvas: canvasId, bindings }, lang, {
          sanitize,
        });
        assert.equal(first.ok, true, 'the first copy must succeed');
        const map = {
          ...applyIiifValues({}, first.values, lang),
          title: { ja: '地図の題名', en: 'Map title' },
          attr: { ja: '地図の帰属', en: 'Map attribution' },
          license: { ja: '地図のライセンス', en: 'Map license' },
          iiif: {
            manifest: ndl['@id'],
            canvas: canvasId,
            bindings,
            copiedValues: first.copiedValues,
            copiedMetadata: first.copiedMetadata,
            copiedAt: first.copiedAt,
          },
          lang,
          delivery: { type: 'iiifImage', url: 'https://dl.ndl.go.jp/api/iiif/948741' },
          width: 4074,
          height: 2705,
        };
        // 基準は変える前の値で取る。
        const before = JSON.stringify(map);

        const resized = structuredClone(ndl);
        resized.sequences[0].canvases[2].width = 4075;
        const failures = [
          ['fetch-failed', { ok: false, reason: 'fetch-failed' }],
          ['not-json', { ok: false, reason: 'not-json' }],
          ['size-mismatch', { ok: true, json: resized }],
        ];
        for (const [reason, reply] of failures) {
          const plan = planIiifRecopy(reply, map, { sanitize });
          assert.equal(plan.ok, false, reason + ': the plan must fail');
          assert.equal(plan.reason, reason, reason + ': the reason must match the failure');
          assert.equal(plan.rows, undefined, reason + ': a failed plan must not list rows');
          assert.equal(
            JSON.stringify(map),
            before,
            reason + ': the map must not change by a single byte',
          );
        }

        // delivery の無い「書誌だけ」の地図は、画像の大きさを比べない。
        const metadataOnly = { ...map };
        delete metadataOnly.delivery;
        const plan = planIiifRecopy({ ok: true, json: resized }, metadataOnly, { sanitize });
        assert.equal(
          plan.ok,
          true,
          'a map without delivery must not fail even when the canvas size changed',
        );

        // 画面の案内。11 の言語で空でなく、取り込み直しを勧める語を含まない。
        const locales = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
        let checked = 0;
        for (const locale of locales) {
          const dict = JSON.parse(
            readFileSync(path.join(projectRoot, 'public/locales/' + locale + '/translation.json'), 'utf8'),
          );
          const text = dict?.iiif_metadata?.recopy_failed_help;
          assert.ok(
            typeof text === 'string' && text.trim() !== '',
            locale + ': the failure help must not be empty',
          );
          assert.equal(
            /取り込み直|re-import/i.test(text),
            false,
            locale + ': the failure help must not suggest importing the map again',
          );
          checked += 1;
        }
        return '(' + checked + '/' + locales.length + ')';
      });

      // 注記の行だけを選んでも何も変わらないことの確認。是正を見分けるのは、
      // 注記（Core の表に無い鍵）を単独で選んだとき戻り値が入力と deepEqual で
      // あること。直す前は注記だけが新しい値に書き換わって落ちる。
      test('license-note-follows-license', async () => {
        const { map, reply, lang } = buildRecopyScenario();
        // ライセンスの値に注記が付く Manifest にする（注記に新しい値がある状態）。
        const withNote = { ok: true, json: structuredClone(reply.json) };
        withNote.json.license = 'https://example.org/terms';
        const plan = planIiifRecopy(withNote, map, { sanitize });
        assert.equal(plan.ok, true, 'the plan for the license with a note must succeed');
        const noteRow = plan.rows.find((row) => row.key === 'licenseNote');
        assert.ok(noteRow, 'the note row must be compared');
        assert.notEqual(noteRow.next, undefined, 'the note row must have a new value');
        const before = structuredClone(map);
        const applied = applyIiifRecopy(map, plan, [{ key: 'licenseNote', lang }], { sanitize });
        assert.deepEqual(applied, before, 'choosing a note row alone must change nothing');
        // ライセンスを選べば、注記も一緒に動く（今の道）。
        const withLicense = applyIiifRecopy(map, plan, [{ key: 'license', lang }], { sanitize });
        assert.equal(
          withLicense.licenseNote,
          'https://example.org/terms',
          'the note must move together with the license',
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
