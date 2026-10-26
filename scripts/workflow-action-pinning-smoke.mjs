/**
 * GitHub Actions の action 参照の固定（SHA ピン）の検査。
 *
 *   [1] .github/workflows/*.yml の `uses:` のうち、ローカルの action（./）と docker:// 以外が
 *       すべて 40 桁の commit SHA で、行末に元のタグの注記（`# vX.Y.Z`）があること
 *       （first-party の actions/* も例外にしない）
 *   [2] 同じ action（owner/name）の SHA が workflow の全体で 1 つに揃っていること
 *       （既に CI で動いている SHA へ揃えたことの確認。写し間違いを merge の前に落とす）
 *   [3] 撤去した Artifact Signing の疎通 workflow の名前が workflow・scripts・package.json に残っていないこと
 *   [4] 検査関数の自己検査（陰性の入力を落とすこと）
 *
 * node の組み込みだけで書く（`uses:` の行を正規表現で読む。js-yaml を使わない ∴ install なしで走る）。
 * 実行: node scripts/workflow-action-pinning-smoke.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKFLOW_DIR = path.join(projectRoot, '.github/workflows');
// 自分自身に名前を直書きしない（直書きすると [3] の grep 相当が自分に当たる）
const REMOVED_NAME = ['artifact', 'signing', 'probe'].join('-');

const USES_LINE = /^\s*(?:-\s+)?uses:\s*(['"]?)([^\s'"#]+)\1\s*(?:#\s*(.*?))?\s*$/;

/** workflow のテキストから uses: を全数読む。読めない uses: 行は違反として返す */
export function parseUses(text, file) {
  const entries = [];
  const violations = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line) || !/(^|\s|-)uses:/.test(line)) return;
    const m = USES_LINE.exec(line);
    if (!m) {
      violations.push(`${file}:${i + 1}: uses: の行を読めない: ${line.trim()}`);
      return;
    }
    entries.push({ file, line: i + 1, ref: m[2], comment: m[3] ?? '' });
  });
  return { entries, violations };
}

/** 規則 [1]・[2] を適用し、違反の文言の配列を返す */
export function checkPinning(entries) {
  const v = [];
  const shaByAction = new Map();
  for (const e of entries) {
    const at = `${e.file}:${e.line}`;
    if (e.ref.startsWith('./') || e.ref.startsWith('docker://')) continue;
    const idx = e.ref.lastIndexOf('@');
    if (idx < 0) {
      v.push(`${at}: 版の指定が無い: ${e.ref}`);
      continue;
    }
    const name = e.ref.slice(0, idx);
    const ref = e.ref.slice(idx + 1);
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      v.push(`${at}: 40 桁の SHA で固定されていない: ${e.ref}`);
      continue;
    }
    if (!/^v\d+(\.\d+)*\b/.test(e.comment)) {
      v.push(`${at}: 元のタグの注記（# vX.Y.Z）が無い: ${e.ref}`);
    }
    const key = name.split('/').slice(0, 2).join('/');
    if (!shaByAction.has(key)) shaByAction.set(key, new Map());
    const shas = shaByAction.get(key);
    if (!shas.has(ref)) shas.set(ref, []);
    shas.get(ref).push(at);
  }
  for (const [key, shas] of shaByAction) {
    if (shas.size > 1) {
      const detail = [...shas].map(([sha, ats]) => `${sha}（${ats.join(', ')}）`).join(' / ');
      v.push(`${key}: SHA が 1 つに揃っていない: ${detail}`);
    }
  }
  return v;
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

const workflowFiles = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => path.join(WORKFLOW_DIR, f));
assert.ok(workflowFiles.length > 0, 'workflow が 1 つも無い');

// [1]・[2]
{
  const entries = [];
  const v = [];
  for (const f of workflowFiles) {
    const rel = path.relative(projectRoot, f);
    const r = parseUses(readFileSync(f, 'utf8'), rel);
    entries.push(...r.entries);
    v.push(...r.violations);
  }
  assert.ok(entries.length > 0, 'uses: が 1 つも読めない（読み取りの正規表現の誤り）');
  v.push(...checkPinning(entries));
  assert.deepEqual(v, [], `[1][2] 違反:\n${v.join('\n')}`);
  console.log(`  [1/4] uses: ${entries.length} 件がすべて SHA 固定・注記あり: PASS`);
  console.log('  [2/4] 同じ action の SHA が 1 つに揃っている: PASS');
}

// [3]
{
  const hits = [];
  const targets = [...workflowFiles, ...listFiles(path.join(projectRoot, 'scripts')), path.join(projectRoot, 'package.json')];
  for (const f of targets) {
    if (readFileSync(f, 'utf8').includes(REMOVED_NAME)) hits.push(path.relative(projectRoot, f));
  }
  assert.ok(!workflowFiles.some((f) => path.basename(f).startsWith(REMOVED_NAME)), `[3] ${REMOVED_NAME} の workflow が残っている`);
  assert.deepEqual(hits, [], `[3] ${REMOVED_NAME} の語が残っている: ${hits.join(', ')}`);
  console.log('  [3/4] 撤去した疎通 workflow の名前が残っていない: PASS');
}

// [4] 自己検査
{
  const parse = (t) => parseUses(t, 'x.yml');
  const sha = (c) => c.repeat(40);
  const bad = (t) => {
    const r = parse(t);
    return [...r.violations, ...checkPinning(r.entries)];
  };
  assert.ok(bad('      - uses: actions/checkout@v4\n').length > 0, '[4] タグ参照を落とさない');
  assert.ok(bad(`      - uses: actions/checkout@${sha('a')}\n`).length > 0, '[4] 注記の無い SHA を落とさない');
  assert.ok(bad(`      - uses: actions/checkout@${sha('a').slice(1)} # v4.0.0\n`).length > 0, '[4] 39 桁を落とさない');
  assert.ok(bad(`      - uses: actions/checkout@${sha('A')} # v4.0.0\n`).length > 0, '[4] 大文字の hex を落とさない');
  assert.ok(bad('      - uses: actions/checkout\n').length > 0, '[4] 版の指定の無い参照を落とさない');
  assert.ok(
    bad(`      - uses: actions/checkout@${sha('a')} # v4.0.0\n      - uses: actions/checkout@${sha('b')} # v4.1.0\n`).length > 0,
    '[4] 同じ action の SHA の不一致を落とさない',
  );
  assert.ok(bad('      - uses: "actions/checkout@v4"\n').length > 0, '[4] 引用符つきのタグ参照を落とさない');
  assert.ok(bad('        uses: actions/setup-node@v4\n').length > 0, '[4] 「- 」の無い uses: のタグ参照を落とさない');
  assert.deepEqual(
    bad(
      `      - uses: ./.github/actions/local\n      - uses: docker://alpine:3\n` +
        `      - uses: actions/checkout@${sha('a')} # v4.0.0\n      - uses: actions/checkout@${sha('a')} # v4.0.0\n` +
        `      - uses: owner/repo/sub@${sha('c')} # v2\n      # - uses: actions/checkout@v4\n`,
    ),
    [],
    '[4] 正しい入力（ローカル・docker・揃った SHA・注記つき・コメント行）を誤って落とす',
  );
  console.log('  [4/4] 自己検査: PASS');
}

console.log('workflow-action-pinning smoke: PASS');
