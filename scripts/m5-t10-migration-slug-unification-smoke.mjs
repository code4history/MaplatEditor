// M5-T10: migration/seed の slug 採番を正本へ寄せる（設計 §5.1 / §5.2 / §8.2）
//
// 検証する受け入れ条件:
//   AC4   resolveSlugCollision の出力が base-2 / base-3 系になる（無効入力は untitled → untitled-2）
//   AC7   SLUG_MAX(100) の切詰が効き、切詰後に衝突しても採番が続く
//   AC8   上限が SEQUENCE_MAX_INDEX(100) になり、超過で throw する
//   AC10  findAvailableSlugSync と findAvailableSlug が**同じ候補系列**を返す
//
// AC5（seed 経路の end-to-end）と AC6（移行経路の renamedSlugs）は、それぞれ実経路を持つ
// 既存 smoke（m12-t32 Part B-2 / m8-t3）で検証する。ここは純関数層に閉じる。
//
// electron / electron-store のエイリアスを張らず external のままバンドルする。
// assetIdentity は node:crypto しか使わず、追加で import する slugSequence も依存ゼロの
// 純関数モジュールである ∴ 素の Node で走る（electron を間接参照していれば
// MODULE_NOT_FOUND で落ちるので、それ自体が純粋性の検査になる）。
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t10-'));
const entryFile = path.join(workDir, 'm5-t10-smoke.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm5-t10-smoke.mjs');

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    import { resolveSlugCollision } from ${JSON.stringify(path.join(projectRoot, 'electron/services/assetIdentity.ts'))};
    import {
      slugCandidate, slugCandidates, findAvailableSlug, findAvailableSlugSync,
      SLUG_MAX, SEQUENCE_MAX_INDEX,
    } from ${JSON.stringify(path.join(projectRoot, 'src/utils/slugSequence.ts'))};

    const failures = [];
    const check = async (label, fn) => {
      try { await fn(); console.log('ok: ' + label); }
      catch (e) { failures.push(label + ' — ' + (e.message ?? String(e))); console.log('NG: ' + label + ' — ' + (e.message ?? String(e))); }
    };
    /** taken の集合から isTaken 述語を作る（resolveSlugCollision の呼び出し形と同じ向き） */
    const takenBy = (...slugs) => (s) => slugs.includes(s);

    // ================= AC4: 生成部が正本の '-' 始まりになる =================
    await check("AC4-1 衝突が無ければ base をそのまま返す（生成部が付かない）", () => {
      assert.equal(resolveSlugCollision('map', takenBy()), 'map');
    });
    await check("AC4-2 base が取られていれば map-2", () => {
      assert.equal(resolveSlugCollision('map', takenBy('map')), 'map-2');
    });
    await check("AC4-3 map, map-2 が取られていれば map-3", () => {
      assert.equal(resolveSlugCollision('map', takenBy('map', 'map-2')), 'map-3');
    });
    await check("AC4-4 旧形式 map_2 が既にあっても新規は map-2（既発行は改名しない・並存する）", () => {
      // 既発行の '_2' を改名しない方針（人間指示 2026-08-03）の帰結。
      // 旧形式が存在していても、それは新規採番の候補系列とは無関係である。
      assert.equal(resolveSlugCollision('map', takenBy('map', 'map_2')), 'map-2');
    });
    await check("AC4-5 無効 slug は untitled へ正規化される（移行固有の責務・設計 §1.1）", () => {
      assert.equal(resolveSlugCollision('日本語', takenBy()), 'untitled');
    });
    await check("AC4-6 untitled も取られていれば untitled-2", () => {
      assert.equal(resolveSlugCollision('a#b', takenBy('untitled')), 'untitled-2');
    });

    // ================= AC7: SLUG_MAX の切詰が効く =================
    const long = 'x'.repeat(SLUG_MAX + 1);   // 101 文字
    await check('AC7-1 SLUG_MAX 超過の base は衝突が無くても切り詰められる（' + (SLUG_MAX + 1) + ' → ' + SLUG_MAX + '）', () => {
      const got = resolveSlugCollision(long, takenBy());
      assert.equal(got.length, SLUG_MAX);
      assert.equal(got, 'x'.repeat(SLUG_MAX));
    });
    await check('AC7-2 切詰後に衝突しても採番が続く（生成部ぶん base をさらに削る）', () => {
      const truncated = 'x'.repeat(SLUG_MAX);
      const got = resolveSlugCollision(long, takenBy(truncated));
      // 生成部 '-2' は 2 文字 ∴ base は SLUG_MAX-2 まで削られる
      assert.equal(got, 'x'.repeat(SLUG_MAX - 2) + '-2');
      assert.equal(got.length, SLUG_MAX);
    });

    // ================= AC8: 上限は SEQUENCE_MAX_INDEX =================
    await check('AC8-1 候補を全部使い切ると throw する（上限 ' + SEQUENCE_MAX_INDEX + '）', () => {
      assert.throws(() => resolveSlugCollision('full', () => true), /could not find a free slug/);
    });
    await check('AC8-2 上限ちょうど（n=' + SEQUENCE_MAX_INDEX + '）は取れる — 境界の内側', () => {
      const last = slugCandidate('full', SEQUENCE_MAX_INDEX);
      assert.equal(resolveSlugCollision('full', (s) => s !== last), last);
    });
    await check('AC8-3 旧上限 10000 まで探しに行かない（探索回数が上限で止まる）', () => {
      let calls = 0;
      try { resolveSlugCollision('full', () => { calls++; return true; }); } catch { /* expected */ }
      assert.equal(calls, SEQUENCE_MAX_INDEX,
        '述語の呼び出し回数が ' + SEQUENCE_MAX_INDEX + ' 回（旧実装なら 10001 回）: ' + calls);
    });

    // ================= AC10: sync と async が同じ候補系列 =================
    await check('AC10-1 slugCandidates が slugCandidate の系列と一致する', () => {
      const gen = [...slugCandidates('base', { maxIndex: 5 })];
      const direct = [1, 2, 3, 4, 5].map((n) => slugCandidate('base', n));
      assert.deepEqual(gen, direct);
    });
    await check('AC10-2 sync と async が同じ slug を選ぶ（複数の taken パターンで）', async () => {
      for (const taken of [[], ['base'], ['base', 'base-2'], ['base', 'base-2', 'base-3']]) {
        const isAvail = (s) => !taken.includes(s);
        const sync = findAvailableSlugSync('base', isAvail);
        const async_ = await findAvailableSlug('base', async (s) => isAvail(s));
        assert.equal(sync, async_, 'taken=' + JSON.stringify(taken) + ' で一致');
      }
    });
    await check('AC10-3 枯渇時の戻り値が sync / async とも null で一致する', async () => {
      assert.equal(findAvailableSlugSync('base', () => false), null);
      assert.equal(await findAvailableSlug('base', async () => false), null);
    });
    await check('AC10-4 suffix / maxIndex / slugMax の各オプションが sync 側にも効く', () => {
      assert.equal(findAvailableSlugSync('base', (s) => s === 'base-copy2', { suffix: '-copy' }), 'base-copy2');
      assert.equal(findAvailableSlugSync('base', () => false, { maxIndex: 3 }), null);
      assert.equal(findAvailableSlugSync('abcdef', () => true, { slugMax: 3 }), 'abc');
    });

    if (failures.length > 0) {
      throw new Error('m5-t10 smoke: ' + failures.length + ' 件失敗 / ' + failures.join(' / '));
    }
    console.log('m5-t10 migration slug unification smoke: ALL PASS');
  `,
);

await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    emptyOutDir: true,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      external: ['electron', 'electron-store', '@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/],
      output: { entryFileNames: 'm5-t10-smoke.mjs', format: 'es' },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 300000,
  maxBuffer: 1024 * 1024 * 8,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
