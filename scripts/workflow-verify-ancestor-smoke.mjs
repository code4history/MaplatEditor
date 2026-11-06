/**
 * build.yml の dispatch で、mode=verify も「ビルドする commit が origin/master の祖先であること」を
 * prepare の段で確かめることの検査。
 *
 *   [1] 静的検査: prepare の checkout が fetch-depth: 0 で、その直後の step が祖先の確認であり、
 *       dispatch の verify・full・sign-check の 3 つをすべて検査の分岐に入れていること
 *   [2] 祖先の確認の shell を fixture のリポジトリで実行する
 *       - verify: master の祖先は通る・別ブランチの commit は落ちる（SHA を渡したときも、省いて
 *         dispatch した ref の HEAD で確かめるときも）・40 桁でない値と checkout の食い違いは落ちる
 *       - full・sign-check: 従来どおり（SHA は必須）
 *       - push: 検査しない
 *       - mode と SHA の形の外れ（未知の mode・大文字の mode・タグ名・ブランチ名・短い SHA）: すべて落ちる
 *   [3] 自己検査: verify を分岐から外した shell では [2] が違反を出す（規則の空振りの検出）。
 *       未知の mode を拒む行を外した shell（直す前の分岐: *) で exit 0）でも [2] が違反を出す
 *
 * 実行: node scripts/workflow-verify-ancestor-smoke.mjs（rtk を付けない）
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKFLOW = path.join(projectRoot, '.github/workflows/build.yml');

const runOf = (st) => (typeof st?.run === 'string' ? st.run : '');
const usesOf = (st) => (typeof st?.uses === 'string' ? st.uses : '');

/** prepare の checkout の直後の step（祖先の確認）を返す */
function ancestorStep(wf) {
  const prep = wf?.jobs?.prepare?.steps ?? [];
  const coAt = prep.findIndex((st) => usesOf(st).startsWith('actions/checkout@'));
  return { prep, coAt, step: coAt < 0 ? undefined : prep[coAt + 1] };
}

/** [1] 静的検査。違反の文言の配列を返す */
export function checkStatic(wf) {
  const v = [];
  const { prep, coAt, step } = ancestorStep(wf);
  if (coAt < 0) return ['prepare に actions/checkout が無い'];
  if (prep[coAt].with?.['fetch-depth'] !== 0) v.push('prepare の checkout に fetch-depth: 0 が無い');
  if (prep[coAt].with?.ref !== '${{ inputs.expected_editor_sha }}') v.push('prepare の checkout が expected_editor_sha を ref にしていない');
  const run = runOf(step);
  if (!/merge-base --is-ancestor/.test(run)) return [...v, 'prepare の checkout の直後の step が祖先の確認でない'];
  if (run.includes('${{')) v.push('祖先の確認の run: に ${{ がある（env: で渡す）');
  if (/scripts\//.test(run)) v.push('祖先の確認の run: がリポジトリのファイルを呼ぶ');
  for (const mode of ['verify', 'full', 'sign-check']) {
    if (!run.includes(`workflow_dispatch:${mode}`)) v.push(`祖先の確認の分岐に workflow_dispatch:${mode} が無い`);
  }
  if (step.env?.MODE !== '${{ inputs.mode }}' || step.env?.SHA !== '${{ inputs.expected_editor_sha }}' || step.env?.EVENT !== '${{ github.event_name }}') {
    v.push('祖先の確認の env: が EVENT・MODE・SHA を入力から受けていない');
  }
  return v;
}

/** fixture のリポジトリ（master: A→B、別ブランチ: A→C、origin/master=B）を作る */
function makeFixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'verify-ancestor-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 's', GIT_AUTHOR_EMAIL: 's@example.com', GIT_COMMITTER_NAME: 's', GIT_COMMITTER_EMAIL: 's@example.com' };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'master');
  const commit = (msg) => { writeFileSync(path.join(repo, 'f.txt'), msg); git('add', 'f.txt'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  const A = commit('A');
  const B = commit('B');
  git('switch', '-q', '-c', 'other', A);
  const C = commit('C');
  git('update-ref', 'refs/remotes/origin/master', B);
  return { repo, git, A, B, C };
}

/** [2] 祖先の確認の shell を fixture で走らせ、期待と違うものを違反として返す */
export function checkBehavior(runText, fx) {
  const { repo, git, A, B, C } = fx;
  const run = (event, mode, sha, at) => {
    git('switch', '-q', '--detach', at);
    return spawnSync('bash', ['-c', runText], { cwd: repo, encoding: 'utf8', env: { ...process.env, EVENT: event, MODE: mode, SHA: sha } }).status;
  };
  const cases = [
    // [説明, event, mode, SHA, checkout の位置, 通るべきか]
    ['verify: master の先端 B を渡すと通る', 'workflow_dispatch', 'verify', B, B, true],
    ['verify: master の祖先 A を渡すと通る', 'workflow_dispatch', 'verify', A, A, true],
    ['verify: 別ブランチの C を渡すと落ちる', 'workflow_dispatch', 'verify', C, C, false],
    ['verify: SHA を省いて master の B を dispatch すると通る', 'workflow_dispatch', 'verify', '', B, true],
    ['verify: SHA を省いて別ブランチの C を dispatch すると落ちる', 'workflow_dispatch', 'verify', '', C, false],
    ['verify: 40 桁でない値は落ちる', 'workflow_dispatch', 'verify', 'deadbeef', B, false],
    ['verify: checkout が SHA を指していなければ落ちる', 'workflow_dispatch', 'verify', B, A, false],
    ['full: 別ブランチの C は落ちる', 'workflow_dispatch', 'full', C, C, false],
    ['full: master の B は通る', 'workflow_dispatch', 'full', B, B, true],
    ['full: SHA の省略は落ちる', 'workflow_dispatch', 'full', '', B, false],
    ['sign-check: 別ブランチの C は落ちる', 'workflow_dispatch', 'sign-check', C, C, false],
    ['sign-check: master の B は通る', 'workflow_dispatch', 'sign-check', B, B, true],
    ['sign-check: SHA の省略は落ちる', 'workflow_dispatch', 'sign-check', '', B, false],
    ['push: 別ブランチでも検査しない', 'push', '', '', C, true],
    // mode と SHA の形の外れ（どれも prepare で落ちる）
    ['未知の mode は落ちる', 'workflow_dispatch', 'bogus', B, B, false],
    ['大文字の mode（Verify）は落ちる', 'workflow_dispatch', 'Verify', B, B, false],
    ['verify: SHA にタグ名を渡すと落ちる', 'workflow_dispatch', 'verify', 'v1.2.0', B, false],
    ['verify: SHA にブランチ名を渡すと落ちる', 'workflow_dispatch', 'verify', 'master', B, false],
    ['verify: 短い SHA は落ちる', 'workflow_dispatch', 'verify', B.slice(0, 7), B, false],
    ['full: SHA にタグ名を渡すと落ちる', 'workflow_dispatch', 'full', 'v1.2.0', B, false],
    ['full: 短い SHA は落ちる', 'workflow_dispatch', 'full', B.slice(0, 12), B, false],
  ];
  const v = [];
  for (const [what, event, mode, sha, at, ok] of cases) {
    const st = run(event, mode, sha, at);
    if ((st === 0) !== ok) v.push(`${what}（終了コード ${st}）`);
  }
  return v;
}

const wf = yaml.load(readFileSync(WORKFLOW, 'utf8'));
const fx = makeFixture();
try {
  {
    const v = checkStatic(wf);
    assert.deepEqual(v, [], `build.yml の静的検査の違反:\n  ${v.join('\n  ')}`);
    console.log('  [1/3] build.yml の静的検査: PASS');
  }
  const runText = runOf(ancestorStep(wf).step);
  {
    const v = checkBehavior(runText, fx);
    assert.deepEqual(v, [], `祖先の確認の挙動の違反:\n  ${v.join('\n  ')}`);
    console.log('  [2/3] 祖先の確認（fixture のリポジトリで実行）: PASS');
  }
  {
    const mutated = runText.replace('|workflow_dispatch:verify', '');
    assert.notEqual(mutated, runText, '自己検査の前提: 分岐に |workflow_dispatch:verify が無い');
    assert.ok(checkBehavior(mutated, fx).length > 0, '自己検査: verify を分岐から外しても [2] が違反を出さない');
    const w2 = structuredClone(wf);
    ancestorStep(w2).step.run = mutated;
    assert.ok(checkStatic(w2).length > 0, '自己検査: verify を分岐から外しても [1] が違反を出さない');
    console.log('  [3/3] 自己検査（verify を外した変異を [1]・[2] が落とす）: PASS');
    // 直す前の分岐: 未知の mode を拒む行（workflow_dispatch:*）が無く、*) の分岐で exit 0 になっていた
    const unknownLine = runText.split('\n').find((l) => /workflow_dispatch:\*\)/.test(l));
    assert.ok(unknownLine, '自己検査の前提: 未知の mode を拒む行（workflow_dispatch:*）が無い');
    const beforeFix = runText.replace(`${unknownLine}\n`, '');
    assert.notEqual(beforeFix, runText);
    const v = checkBehavior(beforeFix, fx);
    assert.ok(v.some((x) => /未知の mode|大文字の mode/.test(x)), `自己検査: 直す前の分岐（*) で exit 0）を [2] が落とさない: ${v.join(' / ')}`);
    console.log(`    直す前の分岐（workflow_dispatch:* の行を外し、*) で exit 0）→ [2] の違反 ${v.length} 件: ${v.join(' / ')}`);
  }
} finally {
  rmSync(fx.repo, { recursive: true, force: true });
}
console.log('\nworkflow verify ancestor smoke: すべて成功');
