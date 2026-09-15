#!/usr/bin/env node
/**
 * oct26-m4-t5（#121）: package.json の smoke:* を全数、直列に実行して報告を書く実行器。
 *
 * - 除外表 ci/test-exclusions.json の kind: excluded 以外をすべて実行する（新しい smoke は表に書かない限り自動で走る）
 * - 自身の exit は smoke の成否で決めない（常に 0）。報告を書けなかったときだけ非 0。合否は judge-test-results.mjs が決める
 * - 1 本ごとに新しいプロセスグループ（detached）で起動し、打ち切り（既定 600 秒）ではグループごと SIGKILL する
 *
 * 使い方: node scripts/ci/run-smokes.mjs --report smoke-report.json [--timeout-sec 600] [--root .] [--exclusions ci/test-exclusions.json] [--log-dir <dir>]
 *
 * 打ち切りの範囲（設計レビュー R2 Info-1 への対応）:
 *   (1) 同じプロセスグループの子孫 → kill(-pgid) で届く
 *   (2) 別のプロセスグループ／セッションへ移った子孫 → 打ち切りの時点で親子関係（ps の ppid）を辿って列挙し、
 *       その pid とそのプロセスグループにも SIGKILL を送る
 *   (3) それでも標準出力を握ったまま残るもの → 本体の exit 後、猶予 GRACE_MS を過ぎたらパイプを破棄して次へ進む
 *       （実行器が孫の寿命まで止まらない）
 *   届かないのは「打ち切りより前に親が死に、init（pid 1）へ付け替えられた別グループの孫」だけ。
 *   GitHub の runner は job ごとに使い捨てなので実害は無い（手元では孤児が残りうる。ci/README.md に記載）
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, listSmokeNames, loadExclusions, SMOKE_PREFIX } from './judge-test-results.mjs';

const TAIL_BYTES = 64 * 1024;
const GRACE_MS = 5000;

/** ps から pid → 子 pid の表を作り、root の子孫（root 自身を除く）を返す */
export function listDescendants(rootPid) {
  let out;
  try {
    out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const children = new Map();
  const pgidOf = new Map();
  for (const line of out.split('\n')) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    pgidOf.set(pid, pgid);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = [];
  const stack = [...(children.get(rootPid) ?? [])];
  while (stack.length) {
    const p = stack.pop();
    found.push({ pid: p, pgid: pgidOf.get(p) });
    stack.push(...(children.get(p) ?? []));
  }
  return found;
}

function killTree(pid) {
  const desc = listDescendants(pid); // 親子関係が残っているうちに列挙する
  const tryKill = (target) => {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // 既に終了している
    }
  };
  tryKill(-pid);
  for (const d of desc) {
    if (d.pgid && d.pgid !== pid && d.pgid !== process.pid && d.pgid > 1) tryKill(-d.pgid);
    tryKill(d.pid);
  }
}

class Tail {
  constructor(limit) {
    this.limit = limit;
    this.chunks = [];
    this.size = 0;
  }
  push(buf) {
    this.chunks.push(buf);
    this.size += buf.length;
    while (this.size - this.chunks[0].length >= this.limit) this.size -= this.chunks.shift().length;
  }
  toString() {
    const all = Buffer.concat(this.chunks);
    return all.subarray(Math.max(0, all.length - this.limit)).toString('utf8');
  }
}

export function runOne(command, { cwd, timeoutMs, logFile }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(command, { cwd, shell: '/bin/bash', detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = new Tail(TAIL_BYTES);
    const log = logFile ? fs.openSync(logFile, 'w') : null;
    const onData = (d) => {
      tail.push(d);
      if (log !== null) fs.writeSync(log, d);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    let timedOut = false;
    let exitInfo = null;
    let done = false;
    let graceTimer = null;
    const finish = (pipesAbandoned) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      if (pipesAbandoned) {
        child.stdout.destroy();
        child.stderr.destroy();
      }
      if (log !== null) fs.closeSync(log);
      resolve({
        exit: exitInfo?.code ?? null,
        signal: exitInfo?.signal ?? null,
        timedOut,
        pipesAbandoned,
        ms: Date.now() - t0,
        outputTail: tail.toString(),
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on('error', (e) => {
      tail.push(Buffer.from(`\n[run-smokes] spawn error: ${e.message}\n`));
      exitInfo = exitInfo ?? { code: null, signal: null };
      finish(true);
    });
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal };
      // 本体が終わってもパイプを握る子孫がいると close が来ない。猶予後にグループを落としてパイプを捨てる
      graceTimer = setTimeout(() => {
        killTree(child.pid);
        finish(true);
      }, GRACE_MS);
    });
    child.on('close', () => finish(false));
  });
}

export async function main(argv) {
  const opts = parseArgs(['run', ...argv]);
  if (!opts.report) {
    console.error('--report が必要');
    return 2;
  }
  const root = path.resolve(opts.root ?? process.cwd());
  const reportPath = path.resolve(opts.report);
  const timeoutSec = Number(opts['timeout-sec'] ?? 600);
  if (!(timeoutSec > 0)) {
    console.error(`--timeout-sec が不正: ${opts['timeout-sec']}`);
    return 2;
  }
  const logDir = opts['log-dir'] ? path.resolve(opts['log-dir']) : null;
  if (logDir) fs.mkdirSync(logDir, { recursive: true });

  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const names = listSmokeNames(root);
  // 除外表が壊れていても実行はする（excluded を判別できない分は走らせる）。判定器が表の不備で赤にする
  const { table, errors } = loadExclusions(root, opts.exclusions && path.resolve(opts.exclusions));
  for (const e of errors) console.log(`[run-smokes] 警告: ${e}`);
  const excludedNames = (table?.smoke ?? []).filter((e) => e?.kind === 'excluded').map((e) => e.name);
  const excluded = new Set(excludedNames);
  const toRun = names.filter((n) => !excluded.has(n));

  const report = {
    schema: 1,
    totalDeclared: names.length,
    excludedNames: [...excluded].sort(),
    expectedRunCount: toRun.length,
    timeoutSec,
    results: {},
    finished: false,
  };
  const write = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  write();

  const t0 = Date.now();
  let failed = 0;
  for (const [i, name] of toRun.entries()) {
    const r = await runOne(scripts[SMOKE_PREFIX + name], {
      cwd: root,
      timeoutMs: timeoutSec * 1000,
      logFile: logDir ? path.join(logDir, `${name}.log`) : null,
    });
    report.results[name] = r;
    write();
    const bad = r.exit !== 0 || r.timedOut;
    if (bad) failed++;
    console.log(`[${i + 1}/${toRun.length}] ${bad ? 'FAIL' : 'ok  '} ${name} exit=${r.exit} signal=${r.signal} timedOut=${r.timedOut} ${r.ms}ms`);
    if (bad) {
      const tail = r.outputTail.slice(-4000);
      console.log(tail.split('\n').map((l) => `    | ${l}`).join('\n'));
    }
  }
  report.finished = true;
  report.totalMs = Date.now() - t0;
  write();
  console.log(`[run-smokes] declared=${names.length} excluded=${excluded.size} ran=${toRun.length} failed=${failed} ${report.totalMs}ms → ${reportPath}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 2;
    },
  );
}
