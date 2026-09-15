#!/usr/bin/env node
/**
 * oct26-m4-t5（#121）: 手元で取った smoke / e2e の報告と除外表を突き合わせ、表の差分案を出す（表は書き換えない）。
 *
 * 検出するもの:
 *   - unregistered-failure: 除外表に無い失敗（smoke の exit≠0・打ち切り／e2e の unexpected）→ 追加案（expect の候補つき）
 *   - registered-but-passed: 表に known-failure として在るのに通ったもの（smoke exit 0／e2e expected）→ 削除案
 *   - intermittent: 表の known-failure が e2e で flaky（再試行で合格）→ 要判断
 *   - expect-mismatch: smoke の known-failure が expect を出力に含まずに失敗 → expect 修正案（候補つき）
 *   - not-observed: 表の known-failure が、与えた報告のどこにも出てこない（e2e は全シャードを与えたときだけ意味がある）
 *
 * 使い方:
 *   node scripts/ci/measure-exclusions.mjs [--smoke-report smoke-report.json] [--e2e-reports a.json,b.json,c.json]
 *     [--root .] [--exclusions ci/test-exclusions.json] [--out diff.json] [--fail-on-diff 1]
 * 出力: 差分案の JSON（stdout、--out 指定時はファイルにも）。exit: 0（差分の有無に依らない。--fail-on-diff 1 なら差分ありで 1）、入力不備は 2
 *
 * 運用手順は ci/README.md「除外表の測り直し」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, loadExclusions, collectTests } from './judge-test-results.mjs';

/** 失敗出力から expect の候補（パスや乱数を含みにくい 1 行）を選ぶ */
export function expectCandidate(outputTail) {
  const lines = String(outputTail ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = (re) => lines.find((l) => re.test(l));
  const line = pick(/AssertionError|^Error:|assert|FAIL|失敗/i) ?? lines[lines.length - 1] ?? '';
  // 絶対パス・16 進の長い列は候補から削る
  return line.replace(/\/(?:private|Users|var|tmp)\/\S*/g, '').replace(/[0-9a-f]{16,}/gi, '').trim().slice(0, 200);
}

export function measure({ root, table, smokeReport, e2eReports }) {
  const diff = { smoke: [], e2e: [] };
  if (smokeReport) {
    const byName = new Map(table.smoke.map((e) => [e.name, e]));
    const results = smokeReport.results ?? {};
    for (const [name, r] of Object.entries(results)) {
      const failed = r.exit !== 0 || r.timedOut === true;
      const entry = byName.get(name);
      if (!entry) {
        if (failed) diff.smoke.push({ type: 'unregistered-failure', name, exit: r.exit, timedOut: r.timedOut === true, proposal: { name, kind: 'known-failure', reason: 'TODO', issue: 'TODO', expect: expectCandidate(r.outputTail) } });
        continue;
      }
      if (entry.kind !== 'known-failure') continue;
      if (!failed) diff.smoke.push({ type: 'registered-but-passed', name, proposal: 'remove' });
      else if (typeof r.outputTail !== 'string' || !r.outputTail.includes(entry.expect)) {
        diff.smoke.push({ type: 'expect-mismatch', name, currentExpect: entry.expect, exit: r.exit, timedOut: r.timedOut === true, proposal: { expect: expectCandidate(r.outputTail) } });
      }
    }
    for (const e of table.smoke) {
      if (e.kind === 'known-failure' && !(e.name in results)) diff.smoke.push({ type: 'not-observed', name: e.name });
    }
  }
  if (e2eReports?.length) {
    const known = new Map(table.e2e.map((e) => [`${e.file} ${e.title}`, e]));
    const seen = new Set();
    for (const rep of e2eReports) {
      for (const t of collectTests(rep)) {
        const key = `${t.file} ${t.title}`;
        const entry = known.get(key);
        if (entry) seen.add(key);
        if (t.status === 'unexpected' && !entry) {
          const firstError = t.results.flatMap((x) => x.errors ?? []).map((er) => String(er.message ?? '').split('\n')[0])[0] ?? '';
          diff.e2e.push({ type: 'unregistered-failure', file: t.file, line: t.line, title: t.title, error: firstError, proposal: { file: t.file, line: t.line, title: t.title, kind: 'known-failure', reason: 'TODO', issue: 'TODO' } });
        } else if (entry && t.status === 'expected') {
          diff.e2e.push({ type: 'registered-but-passed', file: t.file, line: t.line, title: t.title, proposal: 'remove' });
        } else if (entry && t.status === 'flaky') {
          diff.e2e.push({ type: 'intermittent', file: t.file, line: t.line, title: t.title });
        } else if (entry && t.status === 'skipped') {
          diff.e2e.push({ type: 'registered-but-skipped', file: t.file, line: t.line, title: t.title });
        }
      }
    }
    for (const [key, e] of known) if (!seen.has(key)) diff.e2e.push({ type: 'not-observed', file: e.file, line: e.line, title: e.title });
  }
  return diff;
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(['measure', ...argv]);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const root = path.resolve(opts.root ?? process.cwd());
  const { table, errors } = loadExclusions(root, opts.exclusions && path.resolve(opts.exclusions));
  if (!table) {
    console.error(errors.join('\n'));
    return 2;
  }
  const formatErrors = errors;
  const read = (f) => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
  let smokeReport = null;
  let e2eReports = [];
  try {
    if (opts['smoke-report']) smokeReport = read(opts['smoke-report']);
    if (opts['e2e-reports']) e2eReports = opts['e2e-reports'].split(',').filter(Boolean).map(read);
  } catch (e) {
    console.error(`報告を読めない: ${e.message}`);
    return 2;
  }
  if (!smokeReport && e2eReports.length === 0) {
    console.error('--smoke-report か --e2e-reports のどちらかが必要');
    return 2;
  }
  const diff = measure({ root, table, smokeReport, e2eReports });
  const out = { formatErrors, ...diff, total: diff.smoke.length + diff.e2e.length + formatErrors.length };
  const text = JSON.stringify(out, null, 2) + '\n';
  process.stdout.write(text);
  if (opts.out) fs.writeFileSync(path.resolve(opts.out), text);
  return opts['fail-on-diff'] === '1' && out.total > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
