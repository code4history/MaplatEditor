#!/usr/bin/env node
// m19-t13 G2: Windows NSIS インストーラのペイロード（$PLUGINSDIR/app-*.7z）内の
// 全エントリが「nsis7z が確実に解けるコーデック」だけで圧縮されていることを機械照合する。
//
// なぜ必要か（設計 §3.2・実測 2026-08-10）:
//   electron-builder 26 系は arm64 PE に ARM64 フィルタ（7-Zip 21.07 で追加）を自動適用する。
//   NSIS 同梱の nsis7z（nsis-resources 由来）はこれを解けず、**解けないエントリを黙って落として
//   最後まで走り切る**。v1.0.0-rc2 の arm64 では MaplatEditor.exe と DLL 8 本が展開されず、
//   それでもインストーラはエラーを出さずに完了した。
//
//   ∴ この不具合は「ビルドは成功する / 成果物も生成される / インストーラも成功で終わる /
//   **アプリだけが存在しない**」という形で成立する。終了コード・インストール成否・ビルド緑を
//   見る検査では原理的に捕まらないため、**生成物のペイロード内コーデックを直接照合する**。
//
// 許可集合は「現に動いていることが証明されている集合」だけに限る（fail-closed）:
//   rc2 の x64 ペイロードと rc1 の arm64 ペイロードに現れるのは Copy / LZMA / LZMA2 / BCJ2 のみ。
//   ARM / ARMT / DELTA 等は electron-builder の ALLOWED_7Z_FILTERS には入っているが、
//   nsis7z がこの配布パイプラインで解けることの証拠が無い。∴ 誰かがそれらへ変えたら
//   本検査は**落ちるべきである**。将来 7-Zip が新たなフィルタを自動選択するようになった場合も、
//   未知トークンとして自動的に落ちる。
//
// 実行:
//   node scripts/m19-t13/verify-win-payload-codec.mjs <installer.exe> [<installer.exe> …]
// 環境変数:
//   M19T13_7Z … 7-Zip 実行ファイルのパスを明示する（省略時は PATH と既定の導入先を探す）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** nsis7z が解けることが実証済みのコーデックトークン（設計 §6.1）。 */
const ALLOWED = new Set(['Copy', 'LZMA', 'LZMA2', 'BCJ2']);

/** ペイロードに必ず含まれているべき実行形式（本不具合で最初に落ちたもの）。 */
const REQUIRED_ENTRY = 'MaplatEditor.exe';

const die = (msg) => {
  console.error(`m19-t13 G2: ${msg}`);
  process.exit(1);
};

// ───────────────────────────────────────────────
// 7-Zip の解決。**どれも使えなければ exit 1**（「7-Zip が無いので検査をスキップ」を作らない。
// スキップを許すと、silent skip を捕まえるための検査自体が silent skip になる）
// ───────────────────────────────────────────────
function resolve7z() {
  const candidates = [
    process.env.M19T13_7Z,
    '7z', '7zz', '7za',
    'C:\\Program Files\\7-Zip\\7z.exe',
  ].filter(Boolean);
  for (const cmd of candidates) {
    // 引数なし起動で「起動できるか」だけを見る。7-Zip は使用法を表示して終わるが、
    // 終了コードは版によって異なるため spawn 自体の成否（ENOENT の有無）で判定する。
    const r = spawnSync(cmd, [], { encoding: 'utf8' });
    if (r.error == null) return cmd;
  }
  return null;
}

/**
 * `7z l -slt` の出力をエントリ配列へ変換する。
 *
 * **アーカイブ全体のサマリブロックを除外することが本関数の要点である**
 * （設計レビュー MNR-1）。`-slt` はエントリ列挙の前に、アーカイブ自身の情報ブロックを出す。
 * そこにも `Method = ` 行が 1 行あり（rc2 arm64 なら `Method = ARM64 LZMA2:20 LZMA:20 BCJ2`
 * のように全ブロックのフィルタの和集合）、素朴に `grep '^Method = '` すると
 * **エントリ 9 件のはずが 10 件になる**。サマリ行を混ぜると違反出力にアーカイブ自身の
 * 擬似エントリが現れ、「実行形式 9 本」という出力契約が崩れる。
 *
 * 見分けは `Type` キーの有無で行う。サマリブロックだけが `Type = 7z` / `Type = PE` を持ち、
 * ファイルエントリは Path / Size / Packed Size / Modified / Attributes / Method … しか持たない
 * （実測で確認）。`-ba`（ヘッダ抑止）に依存しないのは、古い 7-Zip でも同じ判定が成立するようにするため。
 *
 * **総数照合（v1.2・実装レビュー INF-1）**: ブロック分割に失敗したエントリを**黙って除外しない**。
 * このパーサの前提（空値行が `key = ` の末尾空白付きで出ること等）は**手元の 7-Zip 26.02 でしか
 * 検証されていない**。G2 が実際に走る GitHub `windows-latest` ランナーの 7-Zip は別版であり、
 * `-slt` の出力細部が違えばブロック分割が崩れる。そのとき照合が無ければ本関数は
 * **エントリを黙って落として「違反 0 件」で成功する**——本タスクが是正している nsis7z の
 * silent skip と**同じ壊れ方**をする。`MaplatEditor.exe` 実在 assert は全崩壊しか捕まえられず、
 * 部分的な取りこぼしは通してしまう。∴ 数が合わなければ die する（fail-closed）。
 */
function parseSltEntries(stdout) {
  const lines = stdout.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const rawLine of lines) {
    // 行末を trim しないこと。空値の行は `Size = `（末尾に空白 1 個）の形で出るため、
    // trim すると `Size =` になって `key = value` に一致せず、エントリが分断される
    const m = /^([A-Za-z][A-Za-z ]*) = (.*)$/.exec(rawLine);
    if (m == null) {
      // key = value 以外の行（空行 / `--` / `----------` / コメント本文）はブロック境界
      if (current != null) blocks.push(current);
      current = null;
      continue;
    }
    if (current == null) current = {};
    // 同一キーの再出現は新しいブロックの開始とみなす（区切り行が無い版への保険）
    if (Object.prototype.hasOwnProperty.call(current, m[1])) {
      blocks.push(current);
      current = {};
    }
    current[m[1]] = m[2].trim();
  }
  if (current != null) blocks.push(current);

  const entries = blocks.filter(
    (b) => b.Path != null && b.Method != null && b.Type == null
  );

  // ── 総数照合 ──
  // **どちらで数えているか**: 左辺（declared）は「区切り行 `----------` **以降**に現れる
  // `Path = ` 行の数」= 7-Zip が申告したエントリ総数。右辺は **サマリ除外後**のブロック数
  // （= 本関数の返り値の要素数）。アーカイブ自身のサマリブロック（`Type` を持つもの、および
  // NSIS の場合に現れる `Method` を持たない中間ブロック）はいずれも区切り行より **前** に
  // 出るため左辺に含まれない。∴ 「除外後」同士の比較になり、サマリ分 +1 の補正は要らない
  // （実測: rc2 arm64 の Setup.exe で declared=10 / entries=10）。
  const sepAt = lines.findIndex((l) => /^-{10,}$/.test(l.trimEnd()));
  const declared = sepAt < 0
    ? -1
    : lines.slice(sepAt + 1).filter((l) => /^Path = /.test(l)).length;

  if (declared !== entries.length) {
    die('`7z l -slt` の出力を解釈できない（エントリ総数が合わない）。'
      + `\n  7-Zip の申告: ${sepAt < 0 ? "区切り行 '----------' が見つからない" : `${declared} エントリ`}`
      + `\n  パースできた: ${entries.length} エントリ`
      + '\n  この 7-Zip の -slt 出力形式は本パーサの前提（手元の 26.02 で検証）と異なる。'
      + '\n  取りこぼしたエントリを黙って除外して「違反 0 件」で成功させない（fail-closed）。'
      + '\n  対処: 実行中の 7-Zip の版を確認し、parseSltEntries のブロック分割を合わせること（m19-t13）');
  }

  return entries;
}

function list(sevenZip, archive) {
  const r = spawnSync(sevenZip, ['l', '-slt', archive], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error != null) die(`7-Zip の起動に失敗した: ${r.error.message}`);
  if (r.status !== 0) {
    die(`7-Zip がアーカイブを列挙できなかった (exit ${r.status}): ${archive}\n${r.stderr || r.stdout}`);
  }
  return parseSltEntries(r.stdout);
}

/** `Method = BCJ2 LZMA2:20 LZMA:20:lc0:lp2` → ['BCJ2','LZMA2','LZMA','LZMA'] */
const methodTokens = (method) =>
  method.trim().split(/\s+/).filter(Boolean).map((t) => t.split(':')[0]);

// ───────────────────────────────────────────────
// 本体
// ───────────────────────────────────────────────
const installers = process.argv.slice(2);

// 引数 0 個はエラー終了。「対象が無いので何も検査せず成功」は silent skip の再生産である
if (installers.length === 0) {
  die('検査対象のインストーラが 1 つも指定されていない。'
    + '\n  使い方: node scripts/m19-t13/verify-win-payload-codec.mjs <installer.exe> [<installer.exe> …]'
    + '\n  対象が無いことを成功として報告してはならない（この検査自体が silent skip になる）');
}

const sevenZip = resolve7z();
if (sevenZip == null) {
  die('7-Zip の実行ファイルを解決できない（M19T13_7Z / PATH 上の 7z・7zz・7za /'
    + ' C:\\Program Files\\7-Zip\\7z.exe をこの順で探した）。'
    + '\n  検査をスキップせず失敗として扱う');
}
console.log(`m19-t13 G2: 7-Zip = ${sevenZip}`);

let violationCount = 0;

for (const installer of installers) {
  if (!existsSync(installer)) die(`インストーラが存在しない: ${installer}`);
  console.log(`\n== ${installer}`);

  // (1) インストーラを列挙し $PLUGINSDIR/app-*.7z を特定する
  const outer = list(sevenZip, installer);
  const payloads = outer
    .map((e) => e.Path)
    .filter((p) => /^\$PLUGINSDIR[\\/]app-.*\.7z$/.test(p));

  if (payloads.length !== 1) {
    die(`$PLUGINSDIR/app-*.7z がちょうど 1 本見つからない（${payloads.length} 本）: ${installer}`
      + `\n  見つかったもの: ${payloads.join(', ') || '(なし)'}`
      + '\n  NSIS ペイロードの命名か格納方法が変わった可能性がある。検査対象を失ったまま成功にしない');
  }
  const payloadPath = payloads[0];
  console.log(`  ペイロード: ${payloadPath}`);

  // (2) 取り出す
  const tmp = mkdtempSync(path.join(tmpdir(), 'm19-t13-payload-'));
  try {
    const ex = spawnSync(sevenZip, ['e', '-y', `-o${tmp}`, installer, payloadPath], {
      encoding: 'utf8', maxBuffer: 1 << 28,
    });
    if (ex.status !== 0) {
      die(`ペイロードを取り出せなかった (exit ${ex.status}): ${payloadPath}\n${ex.stderr || ex.stdout}`);
    }
    const extracted = readdirSync(tmp).filter((f) => f.endsWith('.7z'));
    if (extracted.length !== 1) {
      die(`取り出した .7z がちょうど 1 本でない（${extracted.length} 本）: ${tmp}`);
    }
    const payloadFile = path.join(tmp, extracted[0]);

    // (3) ペイロード内の全エントリの Method を照合する
    const entries = list(sevenZip, payloadFile);
    const files = entries.filter((e) => e.Method.trim() !== ''); // ディレクトリは Method 空
    const dirs = entries.length - files.length;

    const violations = [];
    const histogram = new Map();
    for (const e of files) {
      const tokens = methodTokens(e.Method);
      histogram.set(e.Method, (histogram.get(e.Method) ?? 0) + 1);
      const bad = tokens.filter((t) => !ALLOWED.has(t));
      if (bad.length > 0) violations.push({ path: e.Path, method: e.Method, bad });
    }

    console.log(`  エントリ: ${files.length} ファイル / ${dirs} ディレクトリ`);
    for (const [method, count] of [...histogram].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)} × Method = ${method}`);
    }

    // 追加 assert: 本体の実行形式がペイロードに含まれること
    if (!files.some((e) => path.basename(e.Path.replace(/\\/g, '/')) === REQUIRED_ENTRY)) {
      die(`ペイロードに ${REQUIRED_ENTRY} が含まれていない: ${installer}`);
    }

    if (violations.length > 0) {
      violationCount += violations.length;
      console.error(`  ✗ 許可されていないコーデックのエントリ ${violations.length} 件:`);
      for (const v of violations) {
        console.error(`      ${v.path}  →  Method = ${v.method}  （不許可: ${v.bad.join(', ')}）`);
      }
    } else {
      console.log(`  ✓ 全 ${files.length} エントリが許可集合 {${[...ALLOWED].join(', ')}} の内側`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (violationCount > 0) {
  console.error(
    `\nm19-t13 G2: 許可されていないコーデックのエントリが ${violationCount} 件ある。`
    + '\n  nsis7z はこれを黙って落とす。インストールは成功したように見えてアプリが存在しない。'
    + '\n  対処: electron-builder.config.cjs の ELECTRON_BUILDER_7Z_FILTER が'
    + " 'BCJ2' を設定しているか確認すること（m19-t13）"
  );
  process.exit(1);
}
console.log(`\nm19-t13 G2: ${installers.length} 本のインストーラすべてが許可コーデックのみ: PASS`);
