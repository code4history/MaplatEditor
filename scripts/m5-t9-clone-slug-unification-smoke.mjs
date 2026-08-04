// m5-t9: clone の slug 採番を正本 slugSequence へ寄せる（タスク設計 v1.1）。
//
// 固定する受け入れ条件:
//   AC1 正常系の出力が現行と完全一致（n=1..50 表駆動）＋ normalizeCloneBase の適用順
//   AC2 base-local50 が **検査される**（現行の off-by-one の是正）
//   AC3 採番が view から useResourceDuplicate へ移り、view に独自ループが残っていない
//   AC4 枯渇時に null を返す（view は cloneToLocal を呼ばない）
//   AC5 長さ切詰が効く
//   AC6 予約をしない（-copy / -poi との差を潰していない）
//
// 【なぜ「検査回数」を数えるのか】
// 現行実装は base-local〜base-local49 の 49件しか検査せず、
// **未検査の base-local50 を返す**。返り値だけを見ると `base-local50` が返るのは
// 現行も新実装も同じであり、**戻り値の比較では欠陥を検出できない**。
// tryAcquire が何回・どの候補で呼ばれたかを記録して突き合わせる必要がある。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const duplicatePath = path.join(projectRoot, 'src/composables/useResourceDuplicate.ts');
const viewPath = path.join(projectRoot, 'src/views/PoiEdit.vue');

// ---- AC3: 採番が view から出ている（ソース assert）----
// 挙動だけでは「同じ規則を view にも書いた」場合を検出できない。
{
  const viewSrc = await readFile(viewPath, 'utf8');
  assert.equal(/for\s*\(\s*let\s+i\s*=\s*2;\s*i\s*<=\s*50/.test(viewSrc), false,
    'AC3: PoiEdit.vue に独自の候補生成ループが残っていないこと');
  assert.equal(/`\$\{base\}-local/.test(viewSrc), false,
    'AC3: PoiEdit.vue に独自の候補文字列組み立てが残っていないこと');
  assert.equal(/replace\(\/\[\^A-Za-z0-9_-\]\+\/g/.test(viewSrc), false,
    'AC3: base 正規化も composable 側へ移っていること（設計 v1.1 Minor-1）');
  assert.match(viewSrc, /findLocalCloneSlug/,
    'AC3: PoiEdit.vue が共有 API を呼んでいること');

  const dupSrc = await readFile(duplicatePath, 'utf8');
  assert.match(dupSrc, /export async function findLocalCloneSlug/,
    'AC3: findLocalCloneSlug が useResourceDuplicate に定義されていること');
  assert.match(dupSrc, /export function normalizeCloneBase/,
    'AC3: normalizeCloneBase も同居していること');
  // AC6: sanctioned wrapper を経由すること（生 check を UI 層に散らさない — M11-T7/AC17）
  assert.match(dupSrc, /checkSlugAvailability/,
    'AC6: sanctioned wrapper checkSlugAvailability を経由すること');

  // 定義の一意性: リポジトリ全体で findLocalCloneSlug の定義は1つだけ
  const { stdout } = await execFileAsync('grep', [
    '-rn', '--include=*.ts', '--include=*.vue', '-E',
    '(export )?(async )?function +findLocalCloneSlug',
    path.join(projectRoot, 'src'),
  ]).catch((e) => ({ stdout: e.stdout || '' }));
  const defs = stdout.split('\n').filter(Boolean);
  assert.equal(defs.length, 1,
    'AC3: findLocalCloneSlug の定義は1つだけであること（実際:\n' + defs.join('\n') + '\n）');
  console.log('ok AC3: 採番が view から useResourceDuplicate へ移っている');
}

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t9-clone-slug-'));
const entryFile = path.join(workDir, 'entry.ts');
const outDir = path.join(workDir, 'dist');
const bundled = path.join(outDir, 'entry.mjs');

try {
  await writeFile(entryFile, `
    import assert from 'node:assert/strict';

    // window.slugReservations スタブ（registry + 予約表の合成を check が見る想定）。
    // **どの候補が何回検査されたか**を記録する — 返り値だけでは off-by-one を検出できない。
    const makeWindow = (taken: Set<string>) => {
      const checked: string[] = [];
      const reserved: string[] = [];
      (globalThis as any).window = {
        slugReservations: {
          async check({ slug }: { slug: string }) {
            checked.push(slug);
            return taken.has(slug) ? 'taken' : 'available';
          },
          async reserve({ slug }: { slug: string }) { reserved.push(slug); return { result: 'ok' }; },
          async release() {},
        },
      };
      return { checked, reserved };
    };

    const { findLocalCloneSlug, normalizeCloneBase } =
      await import(${JSON.stringify(duplicatePath)});
    const { slugCandidate, SLUG_MAX } =
      await import(${JSON.stringify(path.join(projectRoot, 'src/utils/slugSequence.ts'))});

    const LOCAL = { suffix: '-local', maxIndex: 50 };

    // =====================================================================
    // AC1-a: normalizeCloneBase の適用順（正規化 → 空判定 → fallback）
    // =====================================================================
    {
      // 【-copy / -poi とは順序が違う】reserveSequencedSlug は \`baseSlug || fallbackBase\`
      // で **fallback が先**（正規化しない）。clone は「正規化してから空判定」である。
      // 順序を入れ替えると '' の扱いが変わる（正: fallback / 誤: '' のまま候補生成へ）。
      // 【実測に基づく表】fallback が発火するのは **入力が完全に空のときだけ**である。
      // 非 ASCII や記号のみの入力は "-" へ畳まれ、非空なので fallback へ落ちない。
      // これは現行 view の挙動そのものであり、本タスクは**変えない**（adaptation）。
      const table: [string | undefined, string, string, string][] = [
        ['sapporo',   'poi', 'sapporo',   'そのまま通る'],
        ['a b c',     'poi', 'a-b-c',     '空白は "-" へ畳む'],
        ['a  b',      'poi', 'a-b',       '連続する不許可文字は1つの "-" へ'],
        ['a_b-c',     'poi', 'a_b-c',     '_ と - は許可文字 ∴ 保たれる'],
        ['東京-map',  'poi', '--map',     '非 ASCII 部分が "-" になり、元の "-" と並んで "--" になる'],
        ['札幌',       'poi', '-',         '全て不許可文字でも "-" は非空 ∴ fallback へ落ちない'],
        ['###',       'poi', '-',         '同上（記号のみ）'],
        ['  ',        'poi', '-',         '同上（空白のみ）'],
        ['',          'poi', 'poi',       '**完全に空のときだけ** fallback'],
        [undefined,   'poi', 'poi',       'undefined も同様'],
      ];
      for (const [input, fallback, expected, why] of table) {
        assert.equal(normalizeCloneBase(input, fallback), expected,
          'AC1-a: normalizeCloneBase(' + JSON.stringify(input) + ', ' + JSON.stringify(fallback)
            + ') は ' + JSON.stringify(expected) + ' — ' + why);
      }
      console.log('ok AC1-a: normalizeCloneBase の適用順（正規化 → 空判定 → fallback）');
    }

    // =====================================================================
    // AC1-b: 正常系の出力が現行と完全一致（n=1..50 表駆動）
    // =====================================================================
    {
      for (let n = 1; n <= 50; n++) {
        // 現行実装の文字列組み立てと同値であること（規則の突き合わせ点）
        const legacy = n === 1 ? 'b-local' : 'b-local' + n;
        assert.equal(slugCandidate('b', n, LOCAL), legacy,
          'AC1-b: n=' + n + ' の候補が現行の文字列組み立てと一致すること');
      }
      // 実経路: 空きがあれば素の base-local
      {
        const { checked } = makeWindow(new Set());
        assert.equal(await findLocalCloneSlug('sapporo', 'poi'), 'sapporo-local',
          'AC1-b: 空きがあれば base-local');
        assert.deepEqual(checked, ['sapporo-local'], 'AC1-b: 1件だけ検査する');
      }
      // 実経路: 先頭が埋まっていれば base-local2
      {
        const { checked } = makeWindow(new Set(['sapporo-local']));
        assert.equal(await findLocalCloneSlug('sapporo', 'poi'), 'sapporo-local2',
          'AC1-b: 先頭が埋まっていれば base-local2');
        assert.deepEqual(checked, ['sapporo-local', 'sapporo-local2'],
          'AC1-b: 検査は先頭から順に、見つかった時点で止まる');
      }
      console.log('ok AC1-b: 正常系の出力が現行と完全一致');
    }

    // =====================================================================
    // AC2: base-local50 が **検査される**（現行の off-by-one の是正）
    // =====================================================================
    {
      // base-local 〜 base-local49 を埋める（**候補名は正本から生成する**。
      // 手書きすると規則が変わったとき fixture だけ旧規則に取り残される）
      const taken = new Set<string>();
      for (let n = 1; n <= 49; n++) taken.add(slugCandidate('x', n, LOCAL));

      const { checked } = makeWindow(taken);
      const got = await findLocalCloneSlug('x', 'poi');

      assert.equal(got, slugCandidate('x', 50, LOCAL),
        'AC2: 50番目の候補が返ること（実際: ' + got + '）');
      assert.equal(checked.length, 50,
        'AC2: **50回検査されること**。現行実装は49回しか検査せず、'
          + '未検査の base-local50 を返していた（実際: ' + checked.length + '回）');
      assert.equal(checked[49], slugCandidate('x', 50, LOCAL),
        'AC2: 50件目の検査対象が base-local50 であること（実際: ' + checked[49] + '）');
      console.log('ok AC2: base-local50 が検査される（off-by-one の是正）');
    }

    // =====================================================================
    // AC4: 枯渇時は null（view は cloneToLocal を呼ばない）
    // =====================================================================
    {
      const taken = new Set<string>();
      for (let n = 1; n <= 50; n++) taken.add(slugCandidate('y', n, LOCAL));

      const { checked } = makeWindow(taken);
      const got = await findLocalCloneSlug('y', 'poi');

      assert.equal(got, null,
        'AC4: 全候補が埋まっていれば null（現行は未検査の base-local50 を返していた）実際: ' + got);
      assert.equal(checked.length, 50, 'AC4: 上限まで検査してから諦めること');
      console.log('ok AC4: 枯渇時は null');
    }

    // =====================================================================
    // AC5: 長さ切詰が効く
    // =====================================================================
    {
      const longBase = 'a'.repeat(120);
      const { checked } = makeWindow(new Set());
      const got = await findLocalCloneSlug(longBase, 'poi');
      assert.equal(got.length, SLUG_MAX,
        'AC5: 生成 slug が SLUG_MAX に収まること（現行は切り詰めず超過した）実際: ' + got.length);
      assert.equal(got, 'a'.repeat(SLUG_MAX - 6) + '-local',
        'AC5: base 側が削られ末尾が -local であること（実際末尾: ' + got.slice(-8) + '）');
      assert.equal(checked[0].length, SLUG_MAX, 'AC5: 検査対象も切詰後の値であること');

      // 連番が付くと生成部が伸びる ∴ base はさらに削られる
      const taken2 = new Set([got]);
      makeWindow(taken2);
      const got2 = await findLocalCloneSlug(longBase, 'poi');
      assert.equal(got2.length, SLUG_MAX, 'AC5: 連番付きでも SLUG_MAX ちょうど');
      assert.equal(got2.slice(-7), '-local2', 'AC5: 末尾が -local2（実際: ' + got2.slice(-7) + '）');
      console.log('ok AC5: 長さ切詰が効く');
    }

    // =====================================================================
    // AC6: **予約をしない**（-copy / -poi との差を潰していない）
    // =====================================================================
    {
      const { checked, reserved } = makeWindow(new Set());
      await findLocalCloneSlug('nopreserve', 'poi');
      assert.ok(checked.length > 0, 'AC6: 検査は行うこと');
      assert.deepEqual(reserved, [],
        'AC6: **予約表に一切書き込まないこと**。clone は直後の cloneToLocal が slug を'
          + '確定する経路であり、予約を挟むと解放責務が新たに生じる（実際: '
          + JSON.stringify(reserved) + '）');
      console.log('ok AC6: 予約をしない（-copy / -poi との取得方式の差を保つ）');
    }

    console.log('m5-t9 clone slug unification OK');
  `);

  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true, outDir, ssr: entryFile, target: 'node22',
      rollupOptions: { output: { entryFileNames: 'entry.mjs', format: 'es' } },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundled], {
    cwd: projectRoot, timeout: 60000, maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  console.log('m5-t9 clone slug unification smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
