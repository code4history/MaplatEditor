/**
 * oct26-m4-t5（#121）: CI の判定器・除外表・workflow・測り直しスクリプト・実行器の打ち切りの受け入れ検査
 *
 * AC2: 判定器が合成報告で赤／緑を正しく出す（(a)〜(s)・IR MIN-2 の intermittent (t)〜(z)）
 * AC3: ci/test-exclusions.json の形式検査（実物が通る・壊した複製が落ちる）
 * AC5: .github/workflows/test.yml の静的検査
 * AC6: measure-exclusions.mjs が 3 種の差分を 1 件ずつ検出する・intermittent は結果を問わず差分にしない（(m-1)）
 * AC1 の一部: 実行器の打ち切り（孫プロセスを残さない・実行器が孫の寿命まで止まらない）
 *
 * 合成データはすべて os.tmpdir() 配下に作る（リポジトリには書かない）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JUDGE = path.join(projectRoot, 'scripts/ci/judge-test-results.mjs');
const MEASURE = path.join(projectRoot, 'scripts/ci/measure-exclusions.mjs');
const RUNNER = path.join(projectRoot, 'scripts/ci/run-smokes.mjs');
const WORKFLOW = path.join(projectRoot, '.github/workflows/test.yml');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'oct26-m4-t5-ci-judge-'));
const writeJson = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  return file;
};

// ───────────────────────────── 合成リポジトリ ─────────────────────────────
const ROOT = path.join(work, 'repo');
writeJson(path.join(ROOT, 'package.json'), {
  name: 'synthetic',
  scripts: {
    'smoke:alpha': 'true',
    'smoke:beta': 'true',
    'smoke:known': 'false',
    'smoke:skipme': 'false',
    'test:e2e:x': 'true',
  },
});
fs.mkdirSync(path.join(ROOT, 'tests/e2e'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'tests/e2e/x.spec.ts'),
  [
    "import { test } from '@playwright/test';",
    "test.describe('D', () => {",
    "  test('passes', async () => {});",
    "  test('known broken', async () => {});",
    "  test('other', async () => {});",
    "  test.skip('human only', async () => {});",
    "  test('sometimes', async () => {});",
    '});',
    '',
  ].join('\n'),
);
const baseTable = {
  schema: 1,
  policy: 'synthetic',
  smoke: [
    { name: 'skipme', kind: 'excluded', reason: '環境依存', issue: '#0' },
    { name: 'known', kind: 'known-failure', reason: '既知', issue: '#0', expect: 'EXPECTED-MARKER' },
  ],
  e2e: [{ file: 'x.spec.ts', line: 4, title: 'known broken', kind: 'known-failure', reason: '既知', issue: '#0' }],
};
const TABLE = writeJson(path.join(ROOT, 'ci/test-exclusions.json'), baseTable);

const smokeOk = (over = {}) => ({ exit: 0, signal: null, timedOut: false, ms: 1, outputTail: 'ok', ...over });
const smokeReport = (results) => ({ schema: 1, totalDeclared: 4, excludedNames: ['skipme'], expectedRunCount: 3, results, finished: true });
const goodSmokeResults = () => ({
  alpha: smokeOk(),
  beta: smokeOk(),
  known: smokeOk({ exit: 1, outputTail: 'AssertionError: EXPECTED-MARKER はずれ' }),
});

const e2eTest = (title, line, status, results, annotations = []) => ({
  title,
  line,
  file: 'x.spec.ts',
  tests: [{ status, annotations, results: results ?? [{ status: status === 'unexpected' ? 'failed' : status === 'skipped' ? 'skipped' : 'passed', retry: 0, errors: [] }] }],
});
const e2eReport = (specs, over = {}) => {
  const stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  for (const s of specs) for (const t of s.tests) stats[t.status]++;
  return {
    config: { shard: { current: 1, total: 3 } },
    suites: [{ title: 'x.spec.ts', file: 'x.spec.ts', specs: [], suites: [{ title: 'D', file: 'x.spec.ts', specs }] }],
    errors: [],
    stats: { startTime: 'x', duration: 1, ...stats },
    ...over,
  };
};
const goodE2eSpecs = () => [
  e2eTest('passes', 3, 'expected'),
  e2eTest('known broken', 4, 'unexpected', [{ status: 'failed', retry: 0 }, { status: 'failed', retry: 1 }]),
  e2eTest('other', 5, 'expected'),
  e2eTest('human only', 6, 'skipped', [{ status: 'skipped', retry: 0 }], [{ type: 'skip', description: '人間確認用' }]),
];

let caseNo = 0;
function judge(mode, { report, exitCode = '1', table = TABLE, extra = [], rawReport } = {}) {
  caseNo++;
  const dir = path.join(work, `case-${caseNo}`);
  fs.mkdirSync(dir, { recursive: true });
  const args = [JUDGE, mode, '--root', ROOT, '--exclusions', table];
  const reportFile = path.join(dir, 'report.json');
  if (rawReport !== undefined) fs.writeFileSync(reportFile, rawReport);
  else if (report !== undefined) writeJson(reportFile, report);
  args.push('--report', reportFile);
  if (mode === 'e2e') {
    const exitFile = path.join(dir, 'playwright-exit.txt');
    if (exitCode !== null) fs.writeFileSync(exitFile, `${exitCode}\n`);
    args.push('--exit-file', exitFile, '--shard', '1/3');
  }
  args.push(...extra);
  const env = { ...process.env };
  delete env.GITHUB_STEP_SUMMARY;
  return spawnSync(process.execPath, args, { encoding: 'utf8', env });
}
const red = (r, msg, re) => {
  assert.equal(r.status, 1, `${msg}: exit 1 のはず\n${r.stdout}${r.stderr}`);
  if (re) assert.match(r.stdout, re, `${msg}: 判定理由`);
};
const green = (r, msg, re) => {
  assert.equal(r.status, 0, `${msg}: exit 0 のはず\n${r.stdout}${r.stderr}`);
  if (re) assert.match(r.stdout, re, `${msg}: Summary`);
};

// ───────────────────────────── AC2 ─────────────────────────────
{
  // 対照: 正しい報告は緑
  green(judge('smoke', { report: smokeReport(goodSmokeResults()) }), '対照 smoke（q の smoke 側）', /想定どおり失敗した known-failure（1 本）: known/);

  const r1 = goodSmokeResults();
  r1.alpha = smokeOk({ exit: 1 });
  red(judge('smoke', { report: smokeReport(r1) }), '(a) 未登録の smoke 失敗', /未登録の smoke が失敗: alpha/);

  const r2 = goodSmokeResults();
  r2.beta = smokeOk({ exit: null, signal: 'SIGKILL', timedOut: true });
  red(judge('smoke', { report: smokeReport(r2) }), '(b) 未登録の smoke 打ち切り', /未登録の smoke が失敗: beta/);

  const r3 = goodSmokeResults();
  r3.known = smokeOk();
  red(judge('smoke', { report: smokeReport(r3) }), '(c) known-failure が exit 0', /known-failure の smoke が通った/);

  const r4 = goodSmokeResults();
  r4.known = smokeOk({ exit: 1, outputTail: 'TypeError: 別の理由' });
  red(judge('smoke', { report: smokeReport(r4) }), '(d) known-failure の expect 不一致', /想定と別の理由で失敗/);

  red(judge('smoke', {}), '(e) smoke 報告が無い', /smoke の報告が無い/);
  red(judge('smoke', { rawReport: '{"schema":1,' }), '(f) JSON 破損', /JSON として読めない/);

  const g = smokeReport(goodSmokeResults());
  delete g.finished;
  red(judge('smoke', { report: g }), '(g) finished 無し', /finished: true が無い/);

  red(judge('smoke', { report: smokeReport({}) }), '(h) results 0 件', /実行結果が 0 件/);

  const i1 = goodSmokeResults();
  delete i1.beta;
  red(judge('smoke', { report: smokeReport(i1) }), '(i-1) 実行集合の 1 本欠け', /報告に無い（1 本）: beta/);
  const i2 = goodSmokeResults();
  i2.skipme = smokeOk({ exit: 1 });
  red(judge('smoke', { report: smokeReport(i2) }), '(i-2) 実行集合に 1 本余分（excluded を実行）', /実行されるべきでない smoke が報告にある.*（1 本）: skipme/);

  // 報告の expectedRunCount を偽っても判定器は package.json から数え直す
  const i3 = smokeReport((() => { const x = goodSmokeResults(); delete x.alpha; return x; })());
  i3.expectedRunCount = 2;
  red(judge('smoke', { report: i3 }), '(i-3) expectedRunCount を偽った報告', /報告に無い（1 本）: alpha/);

  // e2e
  green(judge('e2e', { report: e2eReport(goodE2eSpecs()), exitCode: '1' }), '(q) known-failure だけが想定どおり失敗', /想定どおり失敗した known-failure（1 件）/);

  red(judge('e2e', { report: e2eReport(goodE2eSpecs(), { errors: [{ message: 'Error: globalSetup failed' }] }) }), '(j) e2e errors[] 非空', /errors\[\] が空ではない/);

  const k = e2eReport([e2eTest('human only', 6, 'skipped', [{ status: 'skipped' }], [{ type: 'skip' }])]);
  red(judge('e2e', { report: k, exitCode: '0' }), '(k) e2e 実行 0 件', /実行件数が 0/);

  red(judge('e2e', { report: e2eReport(goodE2eSpecs()), exitCode: null }), '(l) exit-file 無し', /exit を記録したファイル/);

  const m = goodE2eSpecs().filter((s) => s.title !== 'known broken');
  red(judge('e2e', { report: e2eReport(m), exitCode: '1' }), '(m) Playwright exit 非 0 かつ unexpected 0', /unexpected が 0/);

  const n = goodE2eSpecs();
  n[2] = e2eTest('other', 5, 'unexpected');
  red(judge('e2e', { report: e2eReport(n), exitCode: '1' }), '(n) 未登録の e2e unexpected', /未登録の e2e が失敗: x\.spec\.ts:5 other/);

  const o = goodE2eSpecs();
  o[1] = e2eTest('known broken', 4, 'expected');
  red(judge('e2e', { report: e2eReport(o), exitCode: '0' }), '(o) known-failure の e2e が expected', /1 回目で通った/);

  red(judge('smoke', { report: smokeReport(goodSmokeResults()), table: path.join(work, 'no-such-table.json') }), '(p) 除外表が無い', /除外表を読めない/);

  const rr = goodE2eSpecs();
  rr[2] = e2eTest('other', 5, 'flaky', [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }]);
  green(judge('e2e', { report: e2eReport(rr), exitCode: '1' }), '(r) 未登録の flaky', /flaky（再試行で合格）1 件: x\.spec\.ts:5 other/);

  const s = goodE2eSpecs();
  s[1] = e2eTest('known broken', 4, 'flaky', [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }]);
  green(judge('e2e', { report: e2eReport(s), exitCode: '0' }), '(s) known-failure の flaky', /間欠化/);

  // 補強（設計 §5.3 の「不整合」）
  red(judge('e2e', { report: e2eReport(goodE2eSpecs()), extra: [], exitCode: 'abc' }), '(補-1) exit の記録が数値でない', /数値ではない/);
  const sh = e2eReport(goodE2eSpecs(), { config: { shard: { current: 2, total: 3 } } });
  red(judge('e2e', { report: sh }), '(補-2) シャード不一致', /--shard 1\/3 と一致しない/);
  const st = e2eReport(goodE2eSpecs());
  st.stats.expected = 99;
  red(judge('e2e', { report: st }), '(補-3) stats とテスト一覧の不一致', /一致しない（報告が壊れている）/);
  const ren = goodE2eSpecs().filter((x) => x.title !== 'known broken');
  ren.push(e2eTest('known broken (renamed)', 4, 'unexpected'));
  red(judge('e2e', { report: e2eReport(ren), exitCode: '1' }), '(補-4) known-failure の改名（同 file は実行済み）', /除外表の known-failure が報告に無い/);
  red(judge('e2e', { report: e2eReport(goodE2eSpecs()), exitCode: '0' }), '(補-5) exit 0 なのに unexpected あり', /exit が 0 なのに unexpected/);

  // N1（設計レビュー R2）: 中断されたシャードを緑に化けさせない
  // SIGINT 中断の実報告（R2 r2probe/pw/report-sigint.json）と同じ形: exit 130・errors 0・既知失敗 1・
  // 中断されたテスト（results[].status == interrupted）・未着手のテスト（results 空・skip 注記なし）
  const sigint = [
    e2eTest('known broken', 4, 'unexpected', [{ status: 'failed', retry: 0 }, { status: 'failed', retry: 1 }]),
    e2eTest('passes', 3, 'skipped', [{ status: 'interrupted', retry: 0 }]),
    e2eTest('other', 5, 'skipped', []),
  ];
  red(judge('e2e', { report: e2eReport(sigint), exitCode: '130' }), '(N1-a) SIGINT 中断（exit 130・既知失敗を含む）', /interrupted/);
  red(judge('e2e', { report: e2eReport(sigint), exitCode: '1' }), '(N1-b) 中断の形で exit が 1 と記録されていても赤', /中断されたテスト/);
  const unstarted = goodE2eSpecs();
  unstarted[2] = e2eTest('other', 5, 'skipped', []);
  red(judge('e2e', { report: e2eReport(unstarted), exitCode: '1' }), '(N1-c) skip 注記の無い skipped（未着手）', /skip の注記が無い skipped/);
  red(judge('e2e', { report: e2eReport(goodE2eSpecs()), exitCode: '130' }), '(N1-d) Playwright exit が 0/1 以外', /exit が 130/);
  const knownSkipped = goodE2eSpecs();
  knownSkipped[1] = e2eTest('known broken', 4, 'skipped', [{ status: 'skipped', retry: 0 }], [{ type: 'skip', description: '後から skip' }]);
  red(judge('e2e', { report: e2eReport(knownSkipped), exitCode: '0' }), '(N1-e) known-failure に後から test.skip（Info-3）', /known-failure の e2e が skipped/);
  const fixme = goodE2eSpecs();
  fixme[2] = e2eTest('other', 5, 'skipped', [{ status: 'skipped', retry: 0, annotations: [{ type: 'fixme' }] }]);
  green(judge('e2e', { report: e2eReport(fixme), exitCode: '1' }), '(N1-対照) fixme 注記の skipped は緑');

  // IR MIN-2: e2e 専用の kind intermittent（結果を問わず緑・skipped は赤・issue 必須・smoke では使えない）
  const INTERMITTENT = { file: 'x.spec.ts', line: 7, title: 'sometimes', kind: 'intermittent', reason: '間欠', issue: '#0' };
  const TABLE_I = writeJson(path.join(work, 'table-intermittent.json'), { ...baseTable, e2e: [...baseTable.e2e, INTERMITTENT] });
  const withSometimes = (status, results, annotations) => [...goodE2eSpecs(), e2eTest('sometimes', 7, status, results, annotations)];
  green(judge('e2e', { report: e2eReport(withSometimes('unexpected', [{ status: 'failed', retry: 0 }, { status: 'failed', retry: 1 }])), exitCode: '1', table: TABLE_I }),
    '(t) intermittent が unexpected', /^- intermittent（許容）: x\.spec\.ts:7 sometimes（結果 unexpected/m);
  green(judge('e2e', { report: e2eReport(withSometimes('flaky', [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }])), exitCode: '1', table: TABLE_I }),
    '(u) intermittent が flaky', /^- intermittent（許容）: x\.spec\.ts:7 sometimes（結果 flaky/m);
  green(judge('e2e', { report: e2eReport(withSometimes('expected')), exitCode: '1', table: TABLE_I }),
    '(v) intermittent が expected', /^- intermittent（許容）: x\.spec\.ts:7 sometimes（結果 expected/m);
  red(judge('e2e', { report: e2eReport(withSometimes('skipped', [{ status: 'skipped', retry: 0 }], [{ type: 'skip', description: '後から skip' }])), exitCode: '1', table: TABLE_I }),
    '(w) intermittent が skipped', /intermittent の e2e が skipped/);
  const smokeI = writeJson(path.join(work, 'table-smoke-intermittent.json'), { ...baseTable, smoke: [...baseTable.smoke, { name: 'beta', kind: 'intermittent', reason: '間欠', issue: '#0' }] });
  red(judge('smoke', { report: smokeReport(goodSmokeResults()), table: smokeI }), '(x) smoke に kind intermittent', /intermittent は smoke では使えない/);
  const noIssue = writeJson(path.join(work, 'table-intermittent-noissue.json'), { ...baseTable, e2e: [...baseTable.e2e, { ...INTERMITTENT, issue: '' }] });
  red(judge('e2e', { report: e2eReport(withSometimes('unexpected')), exitCode: '1', table: noIssue }), '(y) intermittent の issue が空', /e2e\[1\]: issue が空/);
  red(judge('e2e', { report: e2eReport(goodE2eSpecs()), exitCode: '1', table: TABLE_I }), '(z) intermittent の file は実行されたがテスト名が無い', /除外表の intermittent が報告に無い.*x\.spec\.ts:7 sometimes/);

  console.log('  [1/5] AC2 判定器の合成ケース (a)〜(s)＋補強 5＋N1 6＋intermittent (t)〜(z) 7: PASS');
}

// ───────────────────────────── AC3 ─────────────────────────────
{
  // 実物の除外表が形式検査を通る（判定器の loadExclusions をそのまま使う）
  const { loadExclusions } = await import(JUDGE);
  const real = loadExclusions(projectRoot);
  assert.deepEqual(real.errors, [], `実物の ci/test-exclusions.json が形式検査に落ちた:\n${real.errors.join('\n')}`);
  assert.ok(real.table.policy && real.table.policy.length > 20, '実物の除外表に policy が書かれている');

  const bad = (mutate, re, msg) => {
    const t = structuredClone(baseTable);
    mutate(t);
    const file = writeJson(path.join(work, `table-${++caseNo}.json`), t);
    const r = loadExclusions(ROOT, file);
    assert.ok(r.errors.some((e) => re.test(e)), `${msg}: ${re} を含むはず\n${r.errors.join('\n')}`);
  };
  bad((t) => { delete t.smoke[0].reason; }, /reason が空/, 'reason 欠落');
  bad((t) => { delete t.smoke[0].issue; }, /issue が空/, 'issue 欠落');
  bad((t) => { t.smoke[0].kind = 'skip'; }, /kind が known-failure \/ excluded \/ intermittent ではない/, 'kind が 3 値外');
  bad((t) => { t.smoke[1].kind = 'intermittent'; }, /intermittent は smoke では使えない/, 'smoke の intermittent');
  bad((t) => { t.smoke[0].name = 'no-such'; }, /package\.json に smoke:no-such が無い/, 'smoke 名が実在しない');
  bad((t) => { delete t.smoke[1].expect; }, /expect/, 'known-failure の expect 欠落');
  bad((t) => { t.smoke.push(structuredClone(t.smoke[0])); }, /重複/, 'smoke 重複');
  bad((t) => { t.e2e[0].line = 3; }, /title「known broken」と一致しない/, 'e2e の line がずれて別の test');
  bad((t) => { t.e2e[0].line = 2; }, /test\( が無い/, 'e2e の line に test( が無い');
  bad((t) => { t.e2e[0].line = 999; }, /999 行目が無い/, 'e2e の line が範囲外');
  bad((t) => { t.e2e[0].file = 'nope.spec.ts'; }, /tests\/e2e\/nope\.spec\.ts が無い/, 'e2e の file が無い');
  bad((t) => { t.e2e.push(structuredClone(t.e2e[0])); }, /重複/, 'e2e 重複');
  bad((t) => { t.e2e[0].kind = 'excluded'; }, /known-failure \/ intermittent だけを使う/, 'e2e の excluded');
  bad((t) => { t.e2e[0].kind = 'intermittent'; t.e2e[0].issue = ' '; }, /issue が空/, 'e2e の intermittent に issue 無し');
  bad((t) => { t.schema = 2; }, /schema が 1 ではない/, 'schema');
  // 形式検査に落ちた表では判定器が赤
  const broken = writeJson(path.join(work, 'table-broken.json'), { ...baseTable, smoke: [{ name: 'alpha', kind: 'excluded' }] });
  red(judge('smoke', { report: smokeReport(goodSmokeResults()), table: broken }), 'AC3 形式不備の表で判定器が赤', /reason が空/);
  console.log('  [2/5] AC3 除外表の形式検査（実物 PASS・壊した複製 15 種 FAIL）: PASS');
}

// ───────────────────────────── AC5 ─────────────────────────────
{
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  const wf = yaml.load(text);
  assert.deepEqual(wf.permissions, { contents: 'read' }, 'permissions は contents: read のみ');
  assert.ok(!('pull_request_target' in (wf.on ?? {})) && !text.includes('pull_request_target'), 'pull_request_target を使わない');
  assert.equal(/secrets\./.test(text), false, 'secrets. 参照 0');
  assert.match(String(wf.concurrency?.['cancel-in-progress']), /github\.event_name\s*==\s*'pull_request'/, 'cancel-in-progress は PR のときだけ');
  assert.deepEqual(Object.keys(wf.jobs).sort(), ['e2e', 'smoke'], 'job は smoke と e2e');

  const allSteps = [];
  for (const [jobName, job] of Object.entries(wf.jobs)) {
    assert.equal(job['runs-on'], 'macos-26', `${jobName}: runs-on は macos-26`);
    for (const step of job.steps) allSteps.push({ jobName, step });
    for (const step of job.steps) {
      if (!step.uses) continue;
      assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${jobName}: action は 40 桁 SHA 固定（${step.uses}）`);
      if (step.uses.startsWith('actions/checkout@')) assert.equal(step.with?.['persist-credentials'], false, `${jobName}: checkout は persist-credentials: false`);
      if (step.uses.startsWith('pnpm/action-setup@')) assert.equal(step.with?.version, 11, `${jobName}: pnpm/action-setup は version: 11`);
    }
    const judgeSteps = job.steps.filter((s) => typeof s.run === 'string' && s.run.includes('scripts/ci/judge-test-results.mjs'));
    assert.equal(judgeSteps.length, 1, `${jobName}: 判定 step が 1 つ`);
    assert.equal(judgeSteps[0].if, 'always()', `${jobName}: 判定 step は if: always()`);
    assert.equal('continue-on-error' in judgeSteps[0], false, `${jobName}: 判定 step は continue-on-error を持たない`);
    // 判定 step より後ろは upload だけ（判定の後に job を赤にしうる step を置かない）
    const after = job.steps.slice(job.steps.indexOf(judgeSteps[0]) + 1);
    assert.ok(after.every((s) => s.uses?.startsWith('actions/upload-artifact@') && s.if === 'always()'), `${jobName}: 判定 step の後ろは if: always() の upload だけ`);
  }
  // outer の verify-pnpm-config.mjs AC2b が読む形（block 形式の version: 行）で、11 未満の version: 行が無い
  const versionLines = [...text.matchAll(/^\s*version:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]));
  assert.ok(versionLines.length === 2 && versionLines.every((v) => v >= 11), `version: 行は 2 つ（両 job）で 11 以上（${versionLines}）`);

  // continue-on-error を持つのは smoke 実行 step だけ（N3）
  const coe = allSteps.filter(({ step }) => 'continue-on-error' in step);
  assert.equal(coe.length, 1, `continue-on-error は 1 step だけ（${coe.map((x) => x.step.name).join(', ')}）`);
  assert.equal(coe[0].jobName, 'smoke');
  assert.equal(coe[0].step['continue-on-error'], true);
  assert.match(coe[0].step.run, /scripts\/ci\/run-smokes\.mjs --report smoke-report\.json/, 'continue-on-error は smoke 実行 step');

  const smokeRuns = wf.jobs.smoke.steps.map((s) => s.run ?? '');
  assert.ok(smokeRuns.includes('pnpm run build'), 'smoke job に pnpm run build');
  assert.ok(smokeRuns.indexOf('pnpm run build') < smokeRuns.findIndex((r) => r.includes('run-smokes.mjs')), 'build は smoke 実行より前');
  assert.ok(wf.jobs.smoke.steps.find((s) => (s.run ?? '').includes('judge-test-results.mjs smoke --report smoke-report.json')), 'smoke 判定 step の引数');

  const e2e = wf.jobs.e2e;
  assert.deepEqual(e2e.strategy?.matrix?.shard, [1, 2, 3], 'e2e は 3 シャード');
  assert.equal(e2e.strategy?.['fail-fast'], false, 'e2e は fail-fast: false');
  const pw = e2e.steps.find((s) => (s.run ?? '').includes('playwright test'));
  assert.ok(pw, 'Playwright step がある');
  assert.match(pw.run, /set \+e/, 'Playwright step は set +e');
  assert.match(pw.run, /--shard=\$\{\{ matrix\.shard \}\}\/3/, 'Playwright step は --shard');
  assert.match(pw.run, /--reporter=json/, 'Playwright step は json reporter');
  // IR MIN-1: test.only の混入で一部だけ実行した報告を緑にしない。playwright test の起動行そのものに --forbid-only
  const pwLine = pw.run.split('\n').find((l) => l.includes('playwright test')) ?? '';
  assert.match(pwLine, /(^|\s)--forbid-only(\s|$)/, 'Playwright step の playwright test 行に --forbid-only（IR MIN-1）');
  assert.match(pw.run, /echo "\$\?" > playwright-exit\.txt\n\s*exit 0/, 'Playwright step は exit を playwright-exit.txt に書いて 0 で抜ける');
  assert.equal(pw.env?.PLAYWRIGHT_JSON_OUTPUT_NAME, 'e2e-report.json');
  // 追補 1（F-AC6）: macOS runner は en-US。Playwright の前に Electron の言語を ja に固定し、確かめる
  const pwIndex = e2e.steps.indexOf(pw);
  const setLoc = e2e.steps.findIndex((s) => s.name === 'Set Electron locale (ja)');
  const checkLoc = e2e.steps.findIndex((s) => s.name === 'Check Electron locale');
  assert.ok(setLoc >= 0 && (e2e.steps[setLoc].run ?? '').includes('defaults write com.github.Electron AppleLanguages -array ja'), 'e2e job に Set Electron locale (ja)（defaults write com.github.Electron AppleLanguages -array ja）');
  assert.ok(checkLoc >= 0 && (e2e.steps[checkLoc].run ?? '').includes('scripts/ci/electron-locale-check.cjs'), 'e2e job に Check Electron locale（scripts/ci/electron-locale-check.cjs）');
  assert.ok(setLoc < checkLoc && checkLoc < pwIndex, `言語の設定 → 検査 → Playwright の順（${setLoc} / ${checkLoc} / ${pwIndex}）`);
  for (const i of [setLoc, checkLoc]) {
    assert.equal('continue-on-error' in e2e.steps[i], false, `${e2e.steps[i].name} は continue-on-error を持たない`);
    assert.equal('if' in e2e.steps[i], false, `${e2e.steps[i].name} は if を持たない`);
  }
  // 追補 2（F-AC7）: pnpm の side-effects cache は空ディレクトリ（Electron.app の *.lproj）を記録しない。
  // e2e job の install は side-effects cache を使わず electron の postinstall を必ず走らせる（smoke job は検査しない）
  const e2eInstall = e2e.steps.find((s) => s.name === 'Install dependencies');
  assert.ok(e2eInstall && /(^|\s)--config\.side-effects-cache=false(\s|$)/.test(e2eInstall.run ?? ''),
    `e2e job の Install dependencies に --config.side-effects-cache=false（追補 2 F-AC7。run=${e2eInstall?.run}）`);
  const e2eJudge = e2e.steps.find((s) => (s.run ?? '').includes('judge-test-results.mjs e2e'));
  assert.match(e2eJudge.run, /--report e2e-report\.json --exit-file playwright-exit\.txt --shard \$\{\{ matrix\.shard \}\}\/3/, 'e2e 判定 step の引数');
  assert.ok(e2e.steps.map((s) => s.run ?? '').includes('pnpm run build'), 'e2e job に pnpm run build');
  console.log('  [3/5] AC5 test.yml の静的検査（＋--forbid-only・Electron の言語固定・e2e install の side-effects cache 無効）: PASS');
}

// ───────────────────────────── AC6 ─────────────────────────────
{
  const dir = path.join(work, 'measure');
  const sr = goodSmokeResults();
  sr.alpha = smokeOk({ exit: 1, outputTail: 'noise\nAssertionError: alpha の新しい失敗\n' }); // 除外表に無い失敗
  sr.known = smokeOk({ exit: 1, outputTail: 'TypeError: 違う理由' }); // expect 不一致
  const smokeFile = writeJson(path.join(dir, 'smoke.json'), smokeReport(sr));
  const es = goodE2eSpecs();
  es[1] = e2eTest('known broken', 4, 'expected'); // 表に在るが通った
  const e2eFile = writeJson(path.join(dir, 'e2e.json'), e2eReport(es));
  const r = spawnSync(process.execPath, [MEASURE, '--root', ROOT, '--exclusions', TABLE, '--smoke-report', smokeFile, '--e2e-reports', e2eFile], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const types = [...out.smoke, ...out.e2e].map((d) => `${d.type}:${d.name ?? d.title}`).sort();
  assert.deepEqual(types, ['expect-mismatch:known', 'registered-but-passed:known broken', 'unregistered-failure:alpha'], `3 種を 1 件ずつ検出（${types}）`);
  assert.equal(out.smoke.find((d) => d.type === 'unregistered-failure').proposal.expect, 'AssertionError: alpha の新しい失敗', 'expect の候補');
  const before = fs.readFileSync(TABLE, 'utf8');
  assert.equal(fs.readFileSync(TABLE, 'utf8'), before, '表は書き換えない');
  const rf = spawnSync(process.execPath, [MEASURE, '--root', ROOT, '--exclusions', TABLE, '--smoke-report', smokeFile, '--fail-on-diff', '1'], { encoding: 'utf8' });
  assert.equal(rf.status, 1, '--fail-on-diff 1 で差分ありは exit 1');
  // 差分なし
  const clean = writeJson(path.join(dir, 'smoke-clean.json'), smokeReport(goodSmokeResults()));
  const rc = spawnSync(process.execPath, [MEASURE, '--root', ROOT, '--exclusions', TABLE, '--smoke-report', clean, '--fail-on-diff', '1'], { encoding: 'utf8' });
  assert.equal(rc.status, 0, `差分なしは exit 0: ${rc.stdout}`);
  // (m-1) IR MIN-2: intermittent は expected / unexpected / flaky のいずれも差分 0 件。報告のどこにも無いときだけ not-observed
  const tableI = writeJson(path.join(dir, 'table-intermittent.json'), { ...baseTable, e2e: [...baseTable.e2e, { file: 'x.spec.ts', line: 7, title: 'sometimes', kind: 'intermittent', reason: '間欠', issue: '#0' }] });
  const runs = { unexpected: [{ status: 'failed', retry: 0 }, { status: 'failed', retry: 1 }], flaky: [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }], expected: undefined };
  for (const [status, results] of Object.entries(runs)) {
    const f = writeJson(path.join(dir, `e2e-intermittent-${status}.json`), e2eReport([...goodE2eSpecs(), e2eTest('sometimes', 7, status, results)]));
    const ri = spawnSync(process.execPath, [MEASURE, '--root', ROOT, '--exclusions', tableI, '--e2e-reports', f, '--fail-on-diff', '1'], { encoding: 'utf8' });
    assert.equal(ri.status, 0, `(m-1) intermittent が ${status} なら差分 0 件で exit 0: ${ri.stdout}${ri.stderr}`);
    assert.equal(JSON.parse(ri.stdout).total, 0, `(m-1) ${status}: total 0`);
  }
  const absent = writeJson(path.join(dir, 'e2e-intermittent-absent.json'), e2eReport(goodE2eSpecs()));
  const ra = spawnSync(process.execPath, [MEASURE, '--root', ROOT, '--exclusions', tableI, '--e2e-reports', absent], { encoding: 'utf8' });
  assert.equal(ra.status, 0, ra.stderr);
  assert.deepEqual(JSON.parse(ra.stdout).e2e.map((d) => `${d.type}:${d.title}`), ['not-observed:sometimes'], '(m-1) 報告に無い intermittent だけが not-observed');
  console.log('  [4/5] AC6 measure-exclusions の 3 種検出＋intermittent (m-1): PASS');
}

// ───────────────────────────── AC1（打ち切り） ─────────────────────────────
{
  const repo = path.join(work, 'kill-repo');
  const pidDir = path.join(work, 'kill-pids');
  fs.mkdirSync(pidDir, { recursive: true });
  const spawner = path.join(repo, 'spawn-detached.mjs');
  fs.mkdirSync(repo, { recursive: true });
  // 別のプロセスグループ（setsid）で孫を起こす。mode=pipe なら親の標準出力を握らせる
  fs.writeFileSync(spawner, [
    "import { spawn } from 'node:child_process';",
    "import fs from 'node:fs';",
    "const [pidFile, mode] = process.argv.slice(2);",
    "const c = spawn('sleep', ['37'], { detached: true, stdio: mode === 'pipe' ? ['ignore', 'inherit', 'inherit'] : 'ignore' });",
    "fs.writeFileSync(pidFile, String(c.pid));",
    "setInterval(() => {}, 1000);",
    '',
  ].join('\n'));
  const node = JSON.stringify(process.execPath);
  writeJson(path.join(repo, 'package.json'), {
    scripts: {
      'smoke:same-group': `sleep 41 & echo $! > ${pidDir}/same-group; wait`,
      'smoke:other-group-pipe': `${node} spawn-detached.mjs ${pidDir}/other-group-pipe pipe`,
      'smoke:other-group-ignore': `${node} spawn-detached.mjs ${pidDir}/other-group-ignore ignore`,
      'smoke:quick': 'echo hello',
    },
  });
  writeJson(path.join(repo, 'ci/test-exclusions.json'), { schema: 1, policy: 'kill test', smoke: [], e2e: [] });
  const report = path.join(work, 'kill-report.json');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [RUNNER, '--root', repo, '--report', report, '--timeout-sec', '1'], { encoding: 'utf8', timeout: 60_000 });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 0, `実行器は exit 0: ${r.stdout}${r.stderr}`);
  const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(rep.finished, true);
  for (const name of ['same-group', 'other-group-pipe', 'other-group-ignore']) {
    assert.equal(rep.results[name].timedOut, true, `${name}: timedOut`);
    assert.equal(rep.results[name].signal, 'SIGKILL', `${name}: signal SIGKILL`);
    const pid = Number(fs.readFileSync(path.join(pidDir, name), 'utf8'));
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      try {
        process.kill(pid, 0);
        spawnSync('sleep', ['0.1']);
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, `${name}: 打ち切り後に孫プロセス（pid ${pid}）が残っていない`);
  }
  assert.equal(rep.results.quick.exit, 0);
  assert.match(rep.results.quick.outputTail, /hello/);
  // 孫の寿命（37〜41 秒）まで止まらない: 打ち切り 1 秒 × 3 本 + 猶予
  assert.ok(elapsed < 25_000, `実行器が孫の寿命まで止まらない（${elapsed}ms）`);
  // 判定器は未登録の打ち切りを赤にする（b の実物版）
  const j = spawnSync(process.execPath, [JUDGE, 'smoke', '--root', repo, '--report', report], { encoding: 'utf8' });
  assert.equal(j.status, 1, j.stdout);
  console.log(`  [5/5] AC1 打ち切り（同グループ・別グループ＋パイプ保持・別グループ）で孫 0 件・${elapsed}ms: PASS`);
}

console.log('oct26-m4-t5 ci-judge smoke: ALL PASS');
