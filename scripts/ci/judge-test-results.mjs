#!/usr/bin/env node
/**
 * oct26-m4-t5（#121）: CI の smoke / e2e の報告を除外表と突き合わせて合否を決める判定器。
 *
 * job の合否はこの判定器の exit だけで決まる（実行 step は失敗しても続行する）。∴ fail-closed:
 * 「何も見られなかった」「報告が壊れている」「数が合わない」はすべて赤（exit 1）にする。
 *
 * 使い方:
 *   node scripts/ci/judge-test-results.mjs smoke --report smoke-report.json
 *   node scripts/ci/judge-test-results.mjs e2e --report e2e-report.json --exit-file playwright-exit.txt [--shard 1/3]
 *   共通オプション: --root <リポジトリ直下（既定: カレント）> --exclusions <除外表（既定: <root>/ci/test-exclusions.json）>
 *
 * 規定の正本は設計書 oct26-m4-t5 v2 §5.3（＋設計レビュー R2 の N1・Info-3）。運用は ci/README.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMOKE_PREFIX = 'smoke:';

// ───────────────────────────── 引数 ─────────────────────────────
export function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const opts = { mode };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`不明な引数: ${a}`);
    const key = a.slice(2);
    const val = rest[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`${a} に値がありません`);
    opts[key] = val;
    i++;
  }
  return opts;
}

// ───────────────────────────── 除外表（AC3） ─────────────────────────────
/**
 * 除外表を読み、形式を検査する。問題は errors に 1 行ずつ積む（1 件でもあれば判定は赤）。
 * - 全エントリに kind（smoke: known-failure / excluded、e2e: known-failure / intermittent）・reason・issue
 * - smoke: name が package.json の smoke:* に実在・known-failure は expect 必須・name の重複無し
 * - smoke: kind intermittent は使えない（smoke は 1 回しか実行しないので間欠を表せない）
 * - e2e: kind は known-failure / intermittent のみ（excluded は Playwright の実行対象から外れないので意味を持たない）
 *        intermittent（IR MIN-2）: 同じ commit で合格と失敗の両方を観測したもの。unexpected / flaky / expected のいずれも緑・skipped は赤・issue 必須
 *        tests/e2e/<file> の line 行に test( があり、その第 1 引数の文字列が title と一致・file+title の重複無し
 */
export function loadExclusions(root, exclusionsPath) {
  const errors = [];
  const file = exclusionsPath ?? path.join(root, 'ci', 'test-exclusions.json');
  let table;
  try {
    table = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`除外表を読めない: ${file}（${e.code ?? e.message}）`);
    return { table: null, errors };
  }
  if (table?.schema !== 1) errors.push(`除外表の schema が 1 ではない: ${JSON.stringify(table?.schema)}`);
  if (!Array.isArray(table?.smoke)) errors.push('除外表に smoke 配列が無い');
  if (!Array.isArray(table?.e2e)) errors.push('除外表に e2e 配列が無い');
  if (errors.length) return { table: null, errors };

  let smokeNames = null;
  try {
    smokeNames = new Set(listSmokeNames(root));
  } catch (e) {
    errors.push(`package.json を読めない: ${e.message}`);
  }

  const common = (entry, where) => {
    if (entry === null || typeof entry !== 'object') {
      errors.push(`${where}: エントリがオブジェクトではない`);
      return false;
    }
    if (!['known-failure', 'excluded', 'intermittent'].includes(entry.kind)) errors.push(`${where}: kind が known-failure / excluded / intermittent ではない（${JSON.stringify(entry.kind)}）`);
    for (const k of ['reason', 'issue']) {
      if (typeof entry[k] !== 'string' || entry[k].trim() === '') errors.push(`${where}: ${k} が空`);
    }
    return true;
  };

  const seenSmoke = new Set();
  table.smoke.forEach((entry, i) => {
    const where = `除外表 smoke[${i}]`;
    if (!common(entry, where)) return;
    if (entry.kind === 'intermittent') errors.push(`${where}: kind intermittent は smoke では使えない（e2e 専用。smoke は 1 回しか実行しない）`);
    if (typeof entry.name !== 'string' || entry.name === '') {
      errors.push(`${where}: name が空`);
      return;
    }
    if (entry.name.startsWith(SMOKE_PREFIX)) errors.push(`${where}: name は "${SMOKE_PREFIX}" を付けずに書く（${entry.name}）`);
    if (smokeNames && !smokeNames.has(entry.name)) errors.push(`${where}: package.json に smoke:${entry.name} が無い`);
    if (seenSmoke.has(entry.name)) errors.push(`${where}: ${entry.name} が重複している`);
    seenSmoke.add(entry.name);
    if (entry.kind === 'known-failure' && (typeof entry.expect !== 'string' || entry.expect.trim() === '')) {
      errors.push(`${where}: known-failure の ${entry.name} に expect（失敗出力の固定部分）が無い`);
    }
  });

  const seenE2e = new Set();
  table.e2e.forEach((entry, i) => {
    const where = `除外表 e2e[${i}]`;
    if (!common(entry, where)) return;
    if (!['known-failure', 'intermittent'].includes(entry.kind)) errors.push(`${where}: e2e の kind は known-failure / intermittent だけを使う（${JSON.stringify(entry.kind)}）`);
    if (typeof entry.file !== 'string' || typeof entry.title !== 'string' || !Number.isInteger(entry.line)) {
      errors.push(`${where}: file（文字列）・line（整数）・title（文字列）が必要`);
      return;
    }
    const key = `${entry.file}\u0000${entry.title}`;
    if (seenE2e.has(key)) errors.push(`${where}: ${entry.file} の「${entry.title}」が重複している`);
    seenE2e.add(key);
    const specPath = path.join(root, 'tests', 'e2e', entry.file);
    let lines;
    try {
      lines = fs.readFileSync(specPath, 'utf8').split('\n');
    } catch {
      errors.push(`${where}: tests/e2e/${entry.file} が無い`);
      return;
    }
    const src = lines[entry.line - 1];
    if (src === undefined) {
      errors.push(`${where}: tests/e2e/${entry.file} に ${entry.line} 行目が無い`);
      return;
    }
    const m = /\btest\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(src);
    if (!m) {
      errors.push(`${where}: tests/e2e/${entry.file}:${entry.line} に test( が無い`);
      return;
    }
    const literal = m[2].replace(/\\(.)/g, '$1');
    if (literal !== entry.title) errors.push(`${where}: tests/e2e/${entry.file}:${entry.line} の test 名「${literal}」が title「${entry.title}」と一致しない`);
  });

  return { table, errors };
}

export function listSmokeNames(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return Object.keys(pkg.scripts ?? {})
    .filter((k) => k.startsWith(SMOKE_PREFIX))
    .map((k) => k.slice(SMOKE_PREFIX.length))
    .sort();
}

function readJson(file, label, errors) {
  if (!file) {
    errors.push(`${label} の報告ファイルが指定されていない`);
    return null;
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    errors.push(`${label} の報告が無い: ${file}（${e.code ?? e.message}）`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    errors.push(`${label} の報告が JSON として読めない: ${file}（${e.message}）`);
    return null;
  }
}

// ───────────────────────────── smoke ─────────────────────────────
/** @returns {{ failures: string[], notes: string[] }} failures が 1 件でもあれば赤 */
export function judgeSmoke({ root, report, table }) {
  const failures = [];
  const notes = [];
  if (report?.schema !== 1) failures.push(`smoke 報告の schema が 1 ではない: ${JSON.stringify(report?.schema)}`);
  if (report?.finished !== true) failures.push('smoke 報告に finished: true が無い（実行器が途中で止まった）');
  const results = report?.results;
  if (results === null || typeof results !== 'object' || Array.isArray(results)) {
    failures.push('smoke 報告に results オブジェクトが無い');
    return { failures, notes };
  }
  const ran = Object.keys(results);
  if (ran.length === 0) failures.push('smoke の実行結果が 0 件');

  const byName = new Map(table.smoke.map((e) => [e.name, e]));
  const excluded = new Set(table.smoke.filter((e) => e.kind === 'excluded').map((e) => e.name));
  // 実行されるべき集合は判定器が自分で数え直す（報告の expectedRunCount は信用しない）
  const expected = listSmokeNames(root).filter((n) => !excluded.has(n));
  const expectedSet = new Set(expected);
  const ranSet = new Set(ran);
  const missing = expected.filter((n) => !ranSet.has(n));
  const extra = ran.filter((n) => !expectedSet.has(n));
  if (missing.length) failures.push(`実行されるべき smoke が報告に無い（${missing.length} 本）: ${missing.join(', ')}`);
  if (extra.length) failures.push(`実行されるべきでない smoke が報告にある（除外表の excluded・package.json に無い）（${extra.length} 本）: ${extra.join(', ')}`);

  const knownFailed = [];
  for (const name of ran) {
    const r = results[name] ?? {};
    const entry = byName.get(name);
    const failed = r.exit !== 0 || r.timedOut === true || (r.signal !== null && r.signal !== undefined);
    const detail = `exit=${r.exit} signal=${r.signal ?? null} timedOut=${r.timedOut === true}`;
    if (!entry) {
      if (failed) failures.push(`未登録の smoke が失敗: ${name}（${detail}）`);
      continue;
    }
    if (entry.kind !== 'known-failure') continue; // excluded は上の集合検査で扱う
    if (!failed) {
      failures.push(`known-failure の smoke が通った（直ったなら除外表から外す）: ${name}`);
    } else if (r.timedOut === true) {
      failures.push(`known-failure の smoke が打ち切られた（想定の失敗ではない）: ${name}（${detail}）`);
    } else if (typeof r.outputTail !== 'string' || !r.outputTail.includes(entry.expect)) {
      failures.push(`known-failure の smoke が想定と別の理由で失敗（expect「${entry.expect}」を出力に含まない）: ${name}（${detail}）`);
    } else {
      knownFailed.push(name);
    }
  }
  if (knownFailed.length) notes.push(`想定どおり失敗した known-failure（${knownFailed.length} 本）: ${knownFailed.join(', ')}`);
  if (excluded.size) notes.push(`excluded（実行しない）: ${excluded.size} 本`);
  notes.push(`実行 ${ran.length} 本 / 実行されるべき ${expected.length} 本`);
  return { failures, notes };
}

// ───────────────────────────── e2e ─────────────────────────────
export function collectTests(report) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        out.push({ file: spec.file, line: spec.line, title: spec.title, status: t.status, annotations: t.annotations ?? [], results: t.results ?? [] });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

const label = (t) => `${t.file}:${t.line} ${t.title}`;

/** @returns {{ failures: string[], notes: string[] }} */
export function judgeE2e({ report, table, exitText, shard }) {
  const failures = [];
  const notes = [];
  if (report === null || typeof report !== 'object' || !report.stats || !Array.isArray(report.suites)) {
    failures.push('e2e 報告の形が Playwright の JSON 報告ではない（stats / suites が無い）');
    return { failures, notes };
  }
  if (!Array.isArray(report.errors)) failures.push('e2e 報告に errors 配列が無い');
  else if (report.errors.length) {
    failures.push(`e2e 報告の errors[] が空ではない（${report.errors.length} 件。設定読込・globalSetup・collection 失敗・globalTimeout 等）: ${report.errors.map((e) => String(e.message ?? '').split('\n')[0]).join(' / ')}`);
  }

  let pwExit = null;
  if (exitText === null) failures.push('Playwright の exit を記録したファイル（--exit-file）が無い・読めない');
  else if (!/^\s*\d+\s*$/.test(exitText)) failures.push(`Playwright の exit の記録が数値ではない: ${JSON.stringify(exitText)}`);
  else pwExit = Number(exitText.trim());

  if (shard) {
    const m = /^(\d+)\/(\d+)$/.exec(shard);
    const cfg = report.config?.shard;
    if (!m) failures.push(`--shard の形式が不正: ${shard}`);
    else if (!cfg || cfg.current !== Number(m[1]) || cfg.total !== Number(m[2])) {
      failures.push(`報告のシャード ${JSON.stringify(cfg ?? null)} が --shard ${shard} と一致しない`);
    }
  }

  const s = report.stats;
  const ranCount = (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0);
  if (ranCount === 0) failures.push('e2e の実行件数が 0（expected + unexpected + flaky = 0）');

  const tests = collectTests(report);
  const count = (st) => tests.filter((t) => t.status === st).length;
  for (const st of ['expected', 'unexpected', 'flaky', 'skipped']) {
    if ((s[st] ?? 0) !== count(st)) failures.push(`e2e 報告の stats.${st}=${s[st]} とテスト一覧の件数 ${count(st)} が一致しない（報告が壊れている）`);
  }

  // N1（設計レビュー R2）: 中断（SIGINT・job 取り消し等）されたシャードを「既知失敗だけ」と読まない。
  // SIGINT では exit 130・errors 0 件になり、中断されたテストは results[].status == interrupted、
  // 未着手のテストは status skipped だが skip / fixme の注記を持たない（R2 r2probe/pw/report-sigint.json で実測）
  const interrupted = tests.filter((t) => t.results.some((r) => r.status === 'interrupted'));
  if (interrupted.length) failures.push(`中断されたテストがある（results[].status == interrupted・${interrupted.length} 件。シャードが途中で止まった）: ${interrupted.map(label).join(' / ')}`);
  const hasSkipNote = (t) => [...t.annotations, ...t.results.flatMap((r) => r.annotations ?? [])].some((a) => a?.type === 'skip' || a?.type === 'fixme');
  const unstarted = tests.filter((t) => t.status === 'skipped' && !hasSkipNote(t) && !interrupted.includes(t));
  if (unstarted.length) failures.push(`skip の注記が無い skipped（未着手＝実行が途中で止まった）が ${unstarted.length} 件: ${unstarted.map(label).join(' / ')}`);

  if (pwExit !== null) {
    if (pwExit !== 0 && pwExit !== 1) failures.push(`Playwright の exit が ${pwExit}（0 / 1 以外は中断・異常終了。130 は SIGINT）`);
    if (pwExit !== 0 && (s.unexpected ?? 0) === 0) failures.push(`Playwright の exit が ${pwExit} なのに unexpected が 0（中断・globalTimeout 等を「失敗 0」と読まない）`);
    if (pwExit === 0 && (s.unexpected ?? 0) > 0) failures.push(`Playwright の exit が 0 なのに unexpected が ${s.unexpected}（exit の記録と報告が食い違う）`);
  }

  const known = new Map(table.e2e.map((e) => [`${e.file}\u0000${e.title}`, e]));
  const seenKnown = new Set();
  const flakyUnknown = [];
  const flakyKnown = [];
  const failedKnown = [];
  const intermittentSeen = [];
  for (const t of tests) {
    const key = `${t.file}\u0000${t.title}`;
    const entry = known.get(key);
    if (entry) seenKnown.add(key);
    // IR MIN-2: intermittent は結果を問わず緑（unexpected / flaky / expected）。skipped だけは赤（実行されていない＝何も観測していない）
    if (entry?.kind === 'intermittent') {
      if (t.status === 'skipped') failures.push(`intermittent の e2e が skipped（skip するなら除外表から外し、理由は spec 側に書く）: ${label(t)}`);
      else if (['unexpected', 'flaky', 'expected'].includes(t.status)) intermittentSeen.push(`${label(t)}（結果 ${t.status}・${entry.issue}）`);
      continue;
    }
    switch (t.status) {
      case 'unexpected':
        if (entry) failedKnown.push(label(t));
        else failures.push(`未登録の e2e が失敗: ${label(t)}`);
        break;
      case 'expected':
        if (entry) failures.push(`known-failure の e2e が 1 回目で通った（直ったなら除外表から外す）: ${label(t)}`);
        break;
      case 'flaky':
        if (entry) flakyKnown.push(label(t));
        else flakyUnknown.push(label(t));
        break;
      case 'skipped':
        // R2 Info-3: known-failure に後から test.skip が付くと「直ったら赤」が発火しなくなる
        if (entry) failures.push(`known-failure の e2e が skipped（skip するなら除外表から外し、理由は spec 側に書く）: ${label(t)}`);
        break;
      default:
        break;
    }
  }

  // シャード内に file が在るのに表のテスト名（known-failure / intermittent）が見つからない → 名前変更・削除（表が古い）
  const filesInReport = new Set(tests.map((t) => t.file));
  for (const [key, e] of known) {
    if (filesInReport.has(e.file) && !seenKnown.has(key)) {
      failures.push(`除外表の ${e.kind} が報告に無い（同じ file は実行されている。テスト名の変更・削除なら表を直す）: ${e.file}:${e.line} ${e.title}`);
    }
  }

  if (failedKnown.length) notes.push(`想定どおり失敗した known-failure（${failedKnown.length} 件）: ${failedKnown.join(' / ')}`);
  if (flakyUnknown.length) notes.push(`flaky（再試行で合格）${flakyUnknown.length} 件: ${flakyUnknown.join(' / ')}`);
  for (const x of intermittentSeen) notes.push(`intermittent（許容）: ${x}`);
  if (flakyKnown.length) notes.push(`known-failure が間欠化（再試行で合格）${flakyKnown.length} 件: ${flakyKnown.join(' / ')}`);
  notes.push(`stats: expected=${s.expected} unexpected=${s.unexpected} flaky=${s.flaky} skipped=${s.skipped}・Playwright exit=${pwExit}`);
  return { failures, notes };
}

// ───────────────────────────── 出力 ─────────────────────────────
function emit(mode, failures, notes) {
  const ok = failures.length === 0;
  const lines = [`### ${mode} 判定: ${ok ? '合格' : '不合格'}`, ''];
  for (const f of failures) lines.push(`- **[NG]** ${f}`);
  for (const n of notes) lines.push(`- ${n}`);
  const md = lines.join('\n') + '\n';
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    } catch {
      // Summary に書けなくても判定は stdout に出ている
    }
  }
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    emit('引数', [e.message], []);
    return 1;
  }
  const root = path.resolve(opts.root ?? process.cwd());
  const failures = [];
  let notes = [];
  if (!['smoke', 'e2e'].includes(opts.mode)) {
    emit('引数', [`第 1 引数は smoke / e2e（${JSON.stringify(opts.mode)}）`], []);
    return 1;
  }
  const { table, errors } = loadExclusions(root, opts.exclusions && path.resolve(opts.exclusions));
  failures.push(...errors);
  const report = readJson(opts.report && path.resolve(opts.report), opts.mode, failures);
  if (table && report) {
    if (opts.mode === 'smoke') {
      const r = judgeSmoke({ root, report, table });
      failures.push(...r.failures);
      notes = r.notes;
    } else {
      let exitText = null;
      if (opts['exit-file']) {
        try {
          exitText = fs.readFileSync(path.resolve(opts['exit-file']), 'utf8');
        } catch {
          exitText = null;
        }
      }
      const r = judgeE2e({ report, table, exitText, shard: opts.shard });
      failures.push(...r.failures);
      notes = r.notes;
    }
  }
  emit(opts.mode, failures, notes);
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
