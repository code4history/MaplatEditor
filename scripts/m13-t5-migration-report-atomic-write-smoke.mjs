// M13-T5 スモーク: migration-report-v2.json への atomic write primitive (readReportSafe/
// writeReportAtomic) と、それを使う3つの公開関数 (mergeAndWriteReport/writeLegacyMigrationReport/
// appendMigrationWarnings) を behavioral に検証する。
// MigrationReportService.ts は electron 依存なしの純粋な fs I/O モジュールのため、
// m11-t7-slug-reservation-smoke.mjs と同じパターンで直接 .ts import する
// (vite SSR バンドル + electron スタブは不要)。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t5-migration-pipeline-design.md` §5.1/§7 準拠。
// シナリオ (AC-T5-1):
//   (A) writeLegacyMigrationReport: 既存ファイルなし → 自分のフィールドのみで新規作成
//   (B) writeLegacyMigrationReport: 既存の正当な report(他フィールド含む) → defensive spread
//       してから自分のフィールドで上書き(他フィールドは保持)
//   (C) writeLegacyMigrationReport: 既存ファイルが壊れたJSON → 上書き回復(abandonしない)
//   (D) appendMigrationWarnings: 既存ファイルなし → デフォルト値 + warnings で新規作成
//   (E) appendMigrationWarnings: 既存の正当な report → 既存 warnings に追記、他フィールド不変
//   (F) appendMigrationWarnings: 既存ファイルが壊れたJSON → abandon(書き込まない、既存ファイルは無傷)
//   (G) mergeAndWriteReport (既存T3契約の regression): 壊れたJSON → abandon
//   (H) atomic write 一般: 正常書込み後に .m13tmp が残留しない (temp+fsync+rename)
//   (I) crash-mid-write 模擬: 前回クラッシュ残留の .m13tmp (壊れた内容) が事前に存在していても、
//       次回の正常な書込みで上書き・renameされ、結果は正しい内容になる (SI-5 準拠の設計根拠の実証)
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  mergeAndWriteReport,
  writeLegacyMigrationReport,
  appendMigrationWarnings,
} from '../electron/services/MigrationReportService.ts';

const REPORT_FILE = 'migration-report-v2.json';
const TEMP_SUFFIX = `${REPORT_FILE}.m13tmp`;

const scratchRoot = path.join(path.resolve(new URL('..', import.meta.url).pathname), '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mktempScratch();

async function mktempScratch() {
  return mkdtemp(path.join(scratchRoot, 'm13-t5-report-atomic-'));
}

async function readReportRaw(dir) {
  return JSON.parse(await readFile(path.join(dir, REPORT_FILE), 'utf8'));
}

async function tempExists(dir) {
  try {
    await readFile(path.join(dir, TEMP_SUFFIX));
    return true;
  } catch {
    return false;
  }
}

try {
  // ============================================================
  // (A) writeLegacyMigrationReport: 既存ファイルなし → 新規作成
  // ============================================================
  {
    const dir = path.join(workDir, 'a-new');
    await mkdir(dir, { recursive: true });
    const report = { renamedSlugs: [{ kind: 'map', from: 'x', to: 'y' }], renamedFiles: [], warnings: ['w1'] };
    await writeLegacyMigrationReport(dir, report);
    const written = await readReportRaw(dir);
    assert.deepEqual(written.renamedSlugs, report.renamedSlugs);
    assert.deepEqual(written.renamedFiles, report.renamedFiles);
    assert.deepEqual(written.warnings, report.warnings);
    console.log('ok: (A) writeLegacyMigrationReport creates a fresh report when none exists');
  }

  // ============================================================
  // (B) writeLegacyMigrationReport: 既存の正当な report(他フィールド含む) →
  //     defensive spread してから自分のフィールドで上書き(他フィールドは保持)
  // ============================================================
  {
    const dir = path.join(workDir, 'b-defensive-spread');
    await mkdir(dir, { recursive: true });
    // T3 が書いた originalsUuidMigration を模擬した既存ファイル(通常は legacy migration が
    // 先に走るため実運用では起こらないが、defensive spread の契約を単体で検証する)
    const preexisting = {
      renamedSlugs: [],
      renamedFiles: [],
      warnings: [],
      originalsUuidMigration: { designVersion: '2.0', lastRunAt: 'x', mode: 'startup', summary: {}, entries: [] },
    };
    await writeFile(path.join(dir, REPORT_FILE), JSON.stringify(preexisting, null, 2));
    const report = { renamedSlugs: [{ kind: 'map', from: 'old', to: 'new' }], renamedFiles: [], warnings: [] };
    await writeLegacyMigrationReport(dir, report);
    const written = await readReportRaw(dir);
    assert.deepEqual(written.renamedSlugs, report.renamedSlugs, '自分のフィールドで上書きされるはず');
    assert.ok(written.originalsUuidMigration, '他フィールド(originalsUuidMigration)は defensive spread で保持されるはず');
    assert.equal(written.originalsUuidMigration.lastRunAt, 'x');
    console.log('ok: (B) writeLegacyMigrationReport defensively spreads unrelated existing fields');
  }

  // ============================================================
  // (C) writeLegacyMigrationReport: 既存ファイルが壊れたJSON → 上書き回復(abandonしない)
  // ============================================================
  {
    const dir = path.join(workDir, 'c-overwrite-recovery');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, REPORT_FILE), '{not valid json,,,');
    const report = { renamedSlugs: [{ kind: 'map', from: 'a', to: 'b' }], renamedFiles: [], warnings: ['recovered'] };
    await writeLegacyMigrationReport(dir, report);
    const written = await readReportRaw(dir);
    assert.deepEqual(written.renamedSlugs, report.renamedSlugs, '壊れたJSONは上書き回復されるはず(abandonしない)');
    assert.deepEqual(written.warnings, report.warnings);
    console.log('ok: (C) writeLegacyMigrationReport overwrite-recovers a corrupted existing report (AC-T5-1)');
  }

  // ============================================================
  // (D) appendMigrationWarnings: 既存ファイルなし → デフォルト値 + warnings で新規作成
  // ============================================================
  {
    const dir = path.join(workDir, 'd-new');
    await mkdir(dir, { recursive: true });
    await appendMigrationWarnings(dir, ['first warning']);
    const written = await readReportRaw(dir);
    assert.deepEqual(written.renamedSlugs, []);
    assert.deepEqual(written.renamedFiles, []);
    assert.deepEqual(written.warnings, ['first warning']);
    console.log('ok: (D) appendMigrationWarnings creates a default-shaped report when none exists');
  }

  // ============================================================
  // (E) appendMigrationWarnings: 既存の正当な report → 既存 warnings に追記、他フィールド不変
  // ============================================================
  {
    const dir = path.join(workDir, 'e-append');
    await mkdir(dir, { recursive: true });
    const preexisting = {
      renamedSlugs: [{ kind: 'map', from: 'p', to: 'q' }],
      renamedFiles: [{ from: 'r1', to: 'r2' }],
      warnings: ['existing warning'],
    };
    await writeFile(path.join(dir, REPORT_FILE), JSON.stringify(preexisting, null, 2));
    await appendMigrationWarnings(dir, ['new warning 1', 'new warning 2']);
    const written = await readReportRaw(dir);
    assert.deepEqual(written.renamedSlugs, preexisting.renamedSlugs, 'renamedSlugs は不変のはず');
    assert.deepEqual(written.renamedFiles, preexisting.renamedFiles, 'renamedFiles は不変のはず');
    assert.deepEqual(
      written.warnings,
      ['existing warning', 'new warning 1', 'new warning 2'],
      '既存 warnings の末尾に追記されるはず'
    );
    console.log('ok: (E) appendMigrationWarnings appends to existing warnings without touching other fields');
  }

  // ============================================================
  // (F) appendMigrationWarnings: 既存ファイルが壊れたJSON → abandon(書き込まない)
  // ============================================================
  {
    const dir = path.join(workDir, 'f-abandon');
    await mkdir(dir, { recursive: true });
    const corrupted = '{not valid json,,,';
    await writeFile(path.join(dir, REPORT_FILE), corrupted);
    await appendMigrationWarnings(dir, ['should not be written']);
    const rawAfter = await readFile(path.join(dir, REPORT_FILE), 'utf8');
    assert.equal(rawAfter, corrupted, '壊れたJSONは abandon され書き込まれずそのまま残るはず');
    assert.equal(await tempExists(dir), false, 'abandon 時は temp ファイルも作られないはず');
    console.log('ok: (F) appendMigrationWarnings abandons (no write) when the existing report is corrupted');
  }

  // ============================================================
  // (G) mergeAndWriteReport (既存T3契約の regression): 壊れたJSON → abandon
  // ============================================================
  {
    const dir = path.join(workDir, 'g-merge-abandon');
    await mkdir(dir, { recursive: true });
    const corrupted = '{not valid json,,,';
    await writeFile(path.join(dir, REPORT_FILE), corrupted);
    await mergeAndWriteReport(dir, {
      designVersion: '2.0',
      lastRunAt: 'now',
      mode: 'startup',
      summary: {},
      entries: [],
    });
    const rawAfter = await readFile(path.join(dir, REPORT_FILE), 'utf8');
    assert.equal(rawAfter, corrupted, 'mergeAndWriteReport は既存T3契約どおり abandon し続けるはず(regression)');
    console.log('ok: (G) mergeAndWriteReport still abandons on corrupted existing report (T3 contract regression guard)');
  }

  // ============================================================
  // (H) atomic write 一般: 正常書込み後に .m13tmp が残留しない
  // ============================================================
  {
    const dir = path.join(workDir, 'h-no-leftover-temp');
    await mkdir(dir, { recursive: true });
    await writeLegacyMigrationReport(dir, { renamedSlugs: [], renamedFiles: [], warnings: [] });
    assert.equal(await tempExists(dir), false, '正常書込み後は .m13tmp が残らないはず (temp+fsync+rename)');
    console.log('ok: (H) no leftover .m13tmp temp file after a successful atomic write');
  }

  // ============================================================
  // (I) crash-mid-write 模擬: 前回クラッシュ残留の .m13tmp (壊れた内容) が事前に存在していても、
  //     次回の正常な書込みで上書き・renameされ、結果は正しい内容になる
  // ============================================================
  {
    const dir = path.join(workDir, 'i-crash-residue');
    await mkdir(dir, { recursive: true });
    // 前回クラッシュの残留 temp (中身は壊れている想定) を事前配置
    await writeFile(path.join(dir, TEMP_SUFFIX), 'stale-crash-residue-not-json');
    const report = { renamedSlugs: [], renamedFiles: [], warnings: ['post-crash-recovery'] };
    await writeLegacyMigrationReport(dir, report);
    const written = await readReportRaw(dir);
    assert.deepEqual(written.warnings, report.warnings, '残留 temp があっても新しい正常な内容で上書きされるはず');
    assert.equal(await tempExists(dir), false, '残留 temp は今回の書込みの rename で解消されるはず (SI-5 準拠)');
    console.log('ok: (I) a stale crashed .m13tmp residue is overwritten cleanly by the next successful write (fault injection)');
  }

  console.log('M13-T5 migration report atomic write smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
