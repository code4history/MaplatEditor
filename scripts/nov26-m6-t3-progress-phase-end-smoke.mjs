// nov26-m6-t3 スモーク: AppExportService のタイルのコピーのフェーズ（copyTilesWithProgress）で、
// 地図ごとの最終件 `(N/N)` が throttle に落ちないこと（#101）。タスク設計（outer リポジトリ
// docs/superpowers/specs/2026-10-11-nov26-m6-t3-task-design.md）§3.2・§7 AC3。
//
//   (1) 静的: copyTilesWithProgress の本体で、`done === total` の分岐が updatePhaseEnd を呼び、
//       それ以外が update を呼ぶ（非最終件の throttle は温存する）
//   (2) 動的・判別力の対照: minPercentDelta 0・分母 10000 で、地図ごとの最終件 `(37/37)` は
//       update だと落ち、updatePhaseEnd だと送られる
//
// 実行方法: node scripts/nov26-m6-t3-progress-phase-end-smoke.mjs（oct26-m4-t3 と同じ vite SSR 方式）
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const MARKER = 'nov26-m6-t3 progress phase end smoke passed';

// ---- (1) 静的な断言 ----
{
  const src = await readFile(path.join(projectRoot, 'electron/services/AppExportService.ts'), 'utf8');
  const start = src.indexOf('async function copyTilesWithProgress(');
  if (start === -1) throw new Error('(1) copyTilesWithProgress が見つからない');
  // 関数の終わり: 次のトップレベルの宣言（行頭の `}`）まで
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end === -1 ? undefined : end);
  const phaseEnd = /if\s*\(\s*done\s*===\s*total\s*\)\s*reporter\.updatePhaseEnd\(\s*progressState\.step\s*,\s*`\$\{slug\} \(\$\{done\}\/\$\{total\}\)`\s*\)/;
  const normal = /else\s+reporter\.update\(\s*progressState\.step\s*,\s*`\$\{slug\} \(\$\{done\}\/\$\{total\}\)`\s*\)/;
  if (!phaseEnd.test(body)) {
    throw new Error('(1) copyTilesWithProgress の最終件（done === total）が reporter.updatePhaseEnd を呼んでいない');
  }
  if (!normal.test(body)) {
    throw new Error('(1) copyTilesWithProgress の非最終件が reporter.update を呼んでいない（throttle の温存）');
  }
  console.log('ok (1): copyTilesWithProgress は最終件 updatePhaseEnd／非最終件 update の二枝');
}

// ---- (2) 動的な断言（判別力の対照）----
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'nov26-m6-t3-progress-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStub = path.join(workDir, 'electron-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  await writeFile(electronStub, 'export const BrowserWindow = class {};\n');
  await writeFile(entryFile, `
    import assert from 'node:assert/strict';
    const { ProgressReporter } = await import(${JSON.stringify(path.join(projectRoot, 'electron/utils/ProgressReporter.ts'))});

    // AppExportService と同じ形: 分母は全体（10000）、文言は地図ごとの (done/total)
    const TOTAL = 10000;
    const make = (sends) => {
      const r = new ProgressReporter('app:taskProgress', TOTAL, 'appedit.export.progress', 'appedit.export.done', { minPercentDelta: 0 });
      r.setWindow({ webContents: { send: (channel, payload) => sends.push({ channel, payload }) } });
      return r;
    };
    // 地図 1 枚目のタイル 37 件。step は全体の通し番号（5000 から）。
    // 36 件目と 37 件目の整数 % はどちらも 50 ∴ 37 件目は update では送られない
    const run = (lastCall) => {
      const sends = [];
      const r = make(sends);
      r.update(5000, 'map-a (0/37)');
      for (let done = 1; done <= 36; done++) r.update(5000 + done, 'map-a (' + done + '/37)');
      lastCall(r, 5037, 'map-a (37/37)');
      return sends;
    };

    const viaUpdate = run((r, step, text) => r.update(step, text));
    assert.equal(viaUpdate.some((s) => s.payload.progress === 'map-a (37/37)'), false,
      '前提: update では地図ごとの最終件 (37/37) が throttle に落ちる（落ちないなら fixture が判別力を持たない）');

    const viaPhaseEnd = run((r, step, text) => r.updatePhaseEnd(step, text));
    assert.equal(viaPhaseEnd.at(-1).payload.progress, 'map-a (37/37)',
      '本命: updatePhaseEnd では最終件 (37/37) が送られる');
    console.log('ok (2): (37/37) は update だと落ち、updatePhaseEnd だと送られる');
    console.log(${JSON.stringify(MARKER)});
    process.exit(0);
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [{ find: 'electron', replacement: electronStub }] },
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: { output: { entryFileNames: 'entry.mjs', format: 'es' } },
    },
  });

  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [bundled], { cwd: projectRoot, timeout: 180000 }));
  } catch (e) {
    if (e && e.stdout) process.stdout.write(e.stdout);
    if (e && e.stderr) process.stderr.write(e.stderr);
    throw e;
  }
  process.stdout.write(stdout);
  if (!stdout.includes(MARKER)) throw new Error('nov26-m6-t3 progress smoke: 成功マーカーが出力されていない');
  console.log(MARKER);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
