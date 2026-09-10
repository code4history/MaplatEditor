// oct26-m4-t3 ProgressReporter throttle 構造是正 smoke（issue #101）。
// m13-t1 系と同じ sandbox 方式（vite SSR build + electron stub + git 非追跡の .tmp-smoke 作業ディレクトリ）で、
// 設計 §2.4 の検査 4 点 + Minor 1（呼び出し側 throttle 温存）を behavioral / ソース assert で検証する。
//   (1) 前提条件 assert（fixture 縮退検知）: フェーズ最終件の update の整数パーセントが直前送信済みと等しく、
//       貫通機構なしでは throttle に落とされる規模であること。
//   (2) 本命: updatePhaseEnd() 経由でフェーズ最終件の (N/N) send が現れること。
//   (3) 判別力対照: ProgressReporter.prototype.forceNext を no-op 化すると (N/N) send が現れないこと
//       （= 本検査が forceNext 経路の欠落を実際に検出できることの証明）。
//   (4) parity + Minor 1: update() 単体の throttle は不変（整数%が進まない通常 update は依然落とされる）ことと、
//       AppExportService の呼び出し側が「最終件 updatePhaseEnd / 非最終件 update」の二枝で、
//       非最終件の throttle を温存していること（ソース assert）。
// 作業ディレクトリは mkdtemp で作ったまま残置する（破壊的操作 gate に従い rm しない。git 非追跡）。
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'oct26-m4-t3-progress-reporter-'));
const entryFile = path.join(workDir, 'oct26-m4-t3-progress-reporter-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'oct26-m4-t3-progress-reporter-smoke.mjs');

const progressReporterPath = path.join(projectRoot, 'electron/utils/ProgressReporter.ts');
const appExportServicePath = path.join(projectRoot, 'electron/services/AppExportService.ts');

// ProgressReporter.ts は `import { BrowserWindow } from 'electron'` を type 用途でのみ参照する。
// 実行時は stub で置換する（m13-t1 系の sandbox 方式）。
await writeFile(
  electronStubFile,
  `
    export const BrowserWindow = class {};
  `,
);

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    const { ProgressReporter } = await import(${JSON.stringify(progressReporterPath)});

    const TOTAL = 200;
    const PHASE_FINAL_TEXT = '(191/191)';
    const ZIPPING_MSG = 'appedit.export.zipping';

    function makeWin(sends) {
      return { webContents: { send: (channel, payload) => sends.push({ channel, payload }) } };
    }

    // --- 検査1: 前提条件 assert（fixture 縮退検知）+ update() 単体 throttle の parity 不変 ---
    {
      const sends = [];
      const r = new ProgressReporter('app:taskProgress', TOTAL, 'appedit.export.progress', 'appedit.export.done', { minPercentDelta: 0 });
      r.setWindow(makeWin(sends));
      r.update(189); // floor(189/200*100)=94 → 送信
      r.update(190); // floor(190/200*100)=95 → 送信
      r.update(191, PHASE_FINAL_TEXT, ZIPPING_MSG); // floor(191/200*100)=95 → 整数%進まず → 落下
      assert.equal(
        sends.length, 2,
        'update(189), update(190) の2回だけが送信されるはず（最終件 update() は throttle で落とされる）',
      );
      assert.equal(sends[1].payload.percent, 95, '直前送信済みパーセントは 95 のはず');
      assert.ok(
        sends.every((s) => s.payload.progress !== PHASE_FINAL_TEXT),
        '前提条件: フェーズ最終件の update() は throttle で落とされ (191/191) は送信されないはず',
      );
      console.log('ok: 検査1 前提条件（フェーズ最終件の整数%が直前送信済みと等しい = 貫通なしでは落下）+ update() throttle parity 不変');
    }

    // --- 検査2: 本命 updatePhaseEnd() 経由で (N/N) が届く ---
    {
      const sends = [];
      const r = new ProgressReporter('app:taskProgress', TOTAL, 'appedit.export.progress', 'appedit.export.done', { minPercentDelta: 0 });
      r.setWindow(makeWin(sends));
      r.update(189);
      r.update(190);
      r.updatePhaseEnd(191, PHASE_FINAL_TEXT, ZIPPING_MSG);
      assert.ok(
        sends.some((s) => s.payload.progress === PHASE_FINAL_TEXT),
        '本命: updatePhaseEnd 経由で (191/191) の send が現れるはず',
      );
      console.log('ok: 検査2 フェーズ最終件 updatePhaseEnd() で (191/191) が送信される');
    }

    // --- 検査3: 判別力対照 forceNext no-op で (N/N) が消える ---
    {
      const origForceNext = ProgressReporter.prototype.forceNext;
      try {
        ProgressReporter.prototype.forceNext = function () {};
        const sends = [];
        const r = new ProgressReporter('app:taskProgress', TOTAL, 'appedit.export.progress', 'appedit.export.done', { minPercentDelta: 0 });
        r.setWindow(makeWin(sends));
        r.update(189);
        r.update(190);
        r.updatePhaseEnd(191, PHASE_FINAL_TEXT, ZIPPING_MSG);
        assert.ok(
          sends.every((s) => s.payload.progress !== PHASE_FINAL_TEXT),
          '判別力: forceNext no-op 対照では (191/191) が現れないはず（現れたら本検査は forceNext 経路の欠落を検出できない）',
        );
      } finally {
        ProgressReporter.prototype.forceNext = origForceNext;
      }
      console.log('ok: 検査3 forceNext no-op 対照で (191/191) が消える（判別力の証明）');
    }

    // --- 検査4: Minor 1 呼び出し側 throttle 温存（AppExportService の二枝）のソース assert ---
    {
      const src = readFileSync(${JSON.stringify(appExportServicePath)}, 'utf8');
      assert.ok(src.includes('reporter!.updatePhaseEnd('), '最終件は updatePhaseEnd 呼び出しのはず');
      assert.ok(src.includes('reporter!.update('), '非最終件の update() 枝（reporter!.update(）が残っているはず（throttle 温存）');
      assert.ok(!src.includes('reporter!.forceNext('), '旧 workaround reporter!.forceNext() は除去されているはず');
      console.log('ok: 検査4 AppExportService は最終件 updatePhaseEnd / 非最終件 update の二枝で、旧 forceNext workaround は除去済み');
    }

    console.log('OCT26-M4-T3 progress reporter smoke passed');
    process.exit(0);
  `,
);

await build({
  configFile: false,
  logLevel: 'silent',
  resolve: {
    alias: [
      { find: 'electron', replacement: electronStubFile },
    ],
  },
  build: {
    emptyOutDir: true,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      output: {
        entryFileNames: 'oct26-m4-t3-progress-reporter-smoke.mjs',
        format: 'es',
      },
    },
  },
});

let stdout, stderr;
try {
  ({ stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  }));
} catch (e) {
  // 子プロセス失敗時も stdout/stderr を可視化してから落とす
  if (e && e.stdout) process.stdout.write(e.stdout);
  if (e && e.stderr) process.stderr.write(e.stderr);
  throw e;
}
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
// 成功マーカーの実在検査（子プロセスが黙って exit 0 した場合を成功と区別する）
if (!stdout.includes('OCT26-M4-T3 progress reporter smoke passed')) {
  throw new Error('oct26-m4-t3 smoke: 成功マーカーが出力されていない（子プロセスが途中終了した可能性）');
}
