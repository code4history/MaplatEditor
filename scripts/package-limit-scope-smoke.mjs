// 安全検証と容量上限の分離と、列挙 primitive の切り出し。
//
// 固定する受け入れ条件:
//   case 4      1件制約の所在 — findPoiDocumentEntry は「ちょうど1件」を維持し、
//            地図 ZIP は listPoiDocumentEntries を使う
//   case 1      容量上限の適用範囲（契約レベル）— (a)(b) タイルは無制限 / (c) POI payload は
//            同じ上限で拒否 / (d) POI 単体パッケージでは全 entry に効く（payload 外 entry を含む
//            fixture 必須）。経路レベルは case 2（managed-poi-documents smoke）が担う
//   case 3(b)   POI 経路のエラーメッセージが1文字も変わらない（kindLabel 既定値の維持）
//
// 本 smoke は純粋関数層（src/utils/poiPackage.ts）だけを対象とする。
// 実行時点（extractAllTo の前）の固定は case 3(a) を担う別 smoke の責務である。
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { makeSmokeScratch } from './smoke-scratch.mjs';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource() {
  const workDir = await makeSmokeScratch('package-limit-scope-');
  const outDir = path.join(workDir, 'dist');
  try {
    await build({
      root: projectRoot,
      logLevel: 'error',
      configFile: false,
      build: {
        outDir,
        emptyOutDir: true,
        lib: {
          entry: path.join(projectRoot, 'src/utils/poiPackage.ts'),
          formats: ['es'],
          fileName: () => 'poiPackage.mjs',
        },
      },
    });
    return await import(`${pathToFileURL(path.join(outDir, 'poiPackage.mjs')).href}?t=${Date.now()}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const {
  assertSafeArchiveEntries,
  assertPoiPayloadLimits,
  assertSafePoiPackageEntries,
  isPoiPayloadEntry,
  listPoiDocumentEntries,
  findPoiDocumentEntry,
  POI_PACKAGE_MAX_ENTRIES,
  POI_PACKAGE_MAX_EXPANDED_BYTES,
  POI_PACKAGE_MAX_IMAGE_BYTES,
} = await importSource();

const MiB = 1024 * 1024;

// 地図 ZIP 経路の (b) 適用範囲。絞り込みは呼び出し側の関心事であり、
// 判定述語だけを製品コードと共有する（テストで別実装を持たない）。
const payloadOf = (entries) => entries.filter((e) => isPoiPayloadEntry(e.name));

// 実地図 ZIP を模した entry 群。タイルは再帰的・無制限に同梱される既存形式である
// （mapDownloadZip.ts:85-94）。1000 entry・累積 2 GiB で、512 entry と合計の上限
// （POI_PACKAGE_MAX_EXPANDED_BYTES = 1 GiB）の両方を超える。
function mapArchiveEntries({ tiles = 1000, tileSize = 2 * 1024 * 1024, extra = [] } = {}) {
  const entries = [
    { name: 'maps/himeji.json', size: 4096 },
    { name: 'tmbs/himeji.jpg', size: 20 * 1024 },
    { name: 'tmbs/himeji_512.webp', size: 80 * 1024 },
  ];
  for (let i = 0; i < tiles; i += 1) {
    entries.push({ name: `tiles/himeji/14/${Math.floor(i / 32)}/${i % 32}.jpg`, size: tileSize });
  }
  return [...entries, ...extra];
}

// ---------------------------------------------------------------------------
// 【RED の対象】分割前の合成関数は、正当な地図 ZIP を拒否する。
// これが「上限を ZIP 全体へ適用する」は誤りという判断の実体である。
// 分割後も合成関数は POI 単体パッケージ用として同じ挙動を保つため、この assert は
// GREEN 後も成立し続ける — すなわち「なぜ分けたのか」を恒久的に固定する回帰である。
// ---------------------------------------------------------------------------
{
  const entries = mapArchiveEntries();
  assert.throws(
    () => assertSafePoiPackageEntries(entries),
    /POI package contains too many entries/,
    '合成関数（POI 単体パッケージ用）は地図 ZIP を拒否する。∴ 地図 ZIP へ流用してはならない',
  );
}

// ---------------------------------------------------------------------------
// case 1(a)(b): タイルが 512 entry / 合計の上限を超えてても地図 ZIP は通る
// ---------------------------------------------------------------------------
{
  const entries = mapArchiveEntries();
  const total = entries.reduce((sum, e) => sum + e.size, 0);
  assert.ok(
    entries.length > POI_PACKAGE_MAX_ENTRIES,
    `fixture 前提: entry 数が上限を超えていること (${entries.length} > ${POI_PACKAGE_MAX_ENTRIES})`,
  );
  assert.ok(
    total > POI_PACKAGE_MAX_EXPANDED_BYTES,
    `fixture 前提: 累積サイズが合計の上限を超えていること (${total} > ${POI_PACKAGE_MAX_EXPANDED_BYTES})`,
  );

  // (a)(b) 安全検査は通り、容量上限は掛からない
  assert.doesNotThrow(
    () => assertSafeArchiveEntries(entries, 'map package'),
    'case 1(a)(b): 512 entry 超・合計の上限を超えるタイルを持つ地図 ZIP が安全検証を通ること',
  );
  assert.doesNotThrow(
    () => assertPoiPayloadLimits(payloadOf(entries)),
    'case 1(a)(b): タイルは POI payload ではないため容量上限の対象外であること',
  );
  assert.equal(payloadOf(entries).length, 0, 'fixture 前提: この地図 ZIP に POI payload は無い');
}

// ---------------------------------------------------------------------------
// case 1(c): POI payload の「1枚あたり」と「件数」の上限は両経路で同じ。
//          **合計の上限だけは経路で違う**（2026-11-20 の修正の固定）:
//            POI 単体パッケージ: 1 GiB で拒否（既定 = applyTotalLimit: true）
//            地図 ZIP 経路:     掛けない（呼び出し側が applyTotalLimit: false で外す）。
//                               地図 ZIP 全体は MAP_ARCHIVE_LIMITS と中央ディレクトリの
//                               検査で守られており、POI の中身の合計だけを止めた実績では
//                               **書き出した本人が取り込めない地図**ができた
// ---------------------------------------------------------------------------
{
  // pois/ + imgs/ の合計が合計の上限（1 GiB）を超える。
  // 1 枚あたりの上限（20 MiB）と別件で止まらないよう、体積は pois/ 側に置く
  // （imgs/ は 20 MiB で先に「Packaged image is too large」になる）
  const payloadHeavy = mapArchiveEntries({ tiles: 4, tileSize: 256 * 1024, extra: [
    { name: 'pois/himeji.geojson', size: POI_PACKAGE_MAX_EXPANDED_BYTES - 3 * MiB },
    { name: 'pois/extra-a.geojson', size: 2 * MiB },
    { name: 'pois/extra-b.geojson', size: 2 * MiB },
  ]});
  const payloadTotal = payloadOf(payloadHeavy).reduce((sum, e) => sum + e.size, 0);
  assert.ok(
    payloadTotal > POI_PACKAGE_MAX_EXPANDED_BYTES,
    `fixture 前提: POI payload の合計が上限を超えていること (${payloadTotal} > ${POI_PACKAGE_MAX_EXPANDED_BYTES})`,
  );

  // POI 単体パッケージ（既定 = 合計の上限を掛ける）は拒否される
  assert.throws(
    () => assertPoiPayloadLimits(payloadOf(payloadHeavy)),
    /POI package is too large/,
    'case 1(c): POI 単体パッケージは payload の合計が 1 GiB を超えると拒否されること',
  );
  // 地図 ZIP 経路（applyTotalLimit: false）は **合計の上限を掛けない**
  assert.doesNotThrow(
    () => assertPoiPayloadLimits(payloadOf(payloadHeavy), { applyTotalLimit: false }),
    'case 1(c): 地図 ZIP 経路は POI payload の合計の上限を掛けないこと',
  );

  // imgs/ の1件が 20 MiB 超 → **合計の上限を外した経路でも**拒否される（同じメッセージ）
  const oversizedImage = mapArchiveEntries({ tiles: 4, extra: [
    { name: 'pois/himeji.geojson', size: 1024 },
    { name: 'imgs/huge.png', size: POI_PACKAGE_MAX_IMAGE_BYTES + 1 },
  ]});
  assert.throws(
    () => assertPoiPayloadLimits(payloadOf(oversizedImage)),
    /Packaged image is too large: imgs\/huge\.png/,
    'case 1(c): imgs/ の1件が 20 MiB を超える地図 ZIP は拒否されること',
  );
  assert.throws(
    () => assertPoiPayloadLimits(payloadOf(oversizedImage), { applyTotalLimit: false }),
    /Packaged image is too large: imgs\/huge\.png/,
    'case 1(c): 1 枚あたりの上限は合計の上限を外した経路でも残ること',
  );

  // 同じ payload を POI 単体パッケージ経路へ通しても同じ上限で落ちる（1枚あたりの同値性）
  assert.throws(
    () => assertSafePoiPackageEntries([
      { name: 'pois/himeji.geojson', size: 1024 },
      { name: 'imgs/huge.png', size: POI_PACKAGE_MAX_IMAGE_BYTES + 1 },
    ]),
    /Packaged image is too large: imgs\/huge\.png/,
    'case 1(c): POI 単体パッケージ経路も同じ上限・同じメッセージであること',
  );

  // 件数の上限（512）も両経路で残る
  const manyPayload = [{ name: 'pois/himeji.geojson', size: 16 }];
  for (let i = 0; i < POI_PACKAGE_MAX_ENTRIES; i += 1) {
    manyPayload.push({ name: `imgs/p-${i}.png`, size: 16 });
  }
  assert.ok(manyPayload.length > POI_PACKAGE_MAX_ENTRIES);
  assert.throws(
    () => assertPoiPayloadLimits(payloadOf(manyPayload)),
    /POI package contains too many entries/,
    'case 1(c): POI 単体パッケージは payload の件数が 512 を超えると拒否されること',
  );
  assert.throws(
    () => assertPoiPayloadLimits(payloadOf(manyPayload), { applyTotalLimit: false }),
    /POI package contains too many entries/,
    'case 1(c): 件数の上限は地図 ZIP 経路（合計の上限なし）でも残ること',
  );
}

// ---------------------------------------------------------------------------
// case 1(d): POI 単体パッケージでは上限が「全 entry」に効く。
//          fixture は payload 外 entry による超過を必ず含める（訂正を固定する検証点）。
//          委譲だけの再実装ではこの2件が素通りする。
// ---------------------------------------------------------------------------
{
  // (d-1) payload 外の巨大 README 1件で 100 MiB 超
  const bigReadme = [
    { name: 'pois/himeji.geojson', size: 1024 },
    { name: 'README', size: POI_PACKAGE_MAX_EXPANDED_BYTES + 1 },
  ];
  assert.throws(
    () => assertSafePoiPackageEntries(bigReadme),
    /POI package is too large/,
    'case 1(d): payload 外 entry（巨大 README）による 100 MiB 超が POI 単体パッケージで拒否されること',
  );
  // 同じ入力は payload 限定の検査では通る = 委譲のみでは検知できないことの証明
  assert.doesNotThrow(
    () => assertPoiPayloadLimits(payloadOf(bigReadme)),
    'case 1(d): payload へ絞ると README が勘定から外れる（∴ 委譲のみの再実装では素通りする）',
  );

  // (d-2) payload 外の名前で 512 entry 超
  const manyDocs = [{ name: 'pois/himeji.geojson', size: 16 }];
  for (let i = 0; i < POI_PACKAGE_MAX_ENTRIES; i += 1) {
    manyDocs.push({ name: `docs/note-${i}.txt`, size: 16 });
  }
  assert.ok(manyDocs.length > POI_PACKAGE_MAX_ENTRIES);
  assert.throws(
    () => assertSafePoiPackageEntries(manyDocs),
    /POI package contains too many entries/,
    'case 1(d): payload 外 entry による 512 entry 超が POI 単体パッケージで拒否されること',
  );
  assert.doesNotThrow(
    () => assertPoiPayloadLimits(payloadOf(manyDocs)),
    'case 1(d): payload へ絞ると docs/ が勘定から外れる（∴ 委譲のみの再実装では素通りする）',
  );
}

// ---------------------------------------------------------------------------
// case 3(b): 安全検証は全 entry へ。メッセージは kindLabel 既定値で1文字も変わらない
// ---------------------------------------------------------------------------
{
  // タイル位置に仕込んだ危険 entry を検出する（参照されない entry でも）
  const unsafeNames = [
    'tiles/../../escape.jpg',
    '/abs/tiles/0.jpg',
    'tiles\\evil\\0.jpg',
    'C:tiles/0.jpg',
  ];
  for (const name of unsafeNames) {
    assert.throws(
      () => assertSafeArchiveEntries([{ name, size: 1 }], 'map package'),
      new RegExp(`Unsafe map package entry: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `case 3: 危険な entry 名 ${name} が拒否されること`,
    );
  }
  assert.throws(
    () => assertSafeArchiveEntries([{ name: 'tiles/link.jpg', size: 1, isSymlink: true }], 'map package'),
    /Unsafe map package entry: tiles\/link\.jpg/,
    'case 3: symlink entry が拒否されること',
  );
  assert.throws(
    () => assertSafeArchiveEntries([
      { name: 'tiles/0.jpg', size: 1 },
      { name: 'tiles/0.jpg', size: 1 },
    ], 'map package'),
    /Duplicate map package entry: tiles\/0\.jpg/,
    'case 3: 重複名が拒否されること',
  );

  // kindLabel 既定値 = 'POI package'。POI 経路のメッセージは1文字も変わらない
  const messageOf = (fn) => {
    try { fn(); } catch (e) { return e.message; }
    throw new Error('expected to throw');
  };
  assert.equal(
    messageOf(() => assertSafeArchiveEntries([{ name: '../escape.geojson', size: 1 }])),
    'Unsafe POI package entry: ../escape.geojson',
    'case 3(b): kindLabel 省略時は既存の "POI package" 文言であること',
  );
  assert.equal(
    messageOf(() => assertSafePoiPackageEntries([{ name: '../escape.geojson', size: 1 }])),
    'Unsafe POI package entry: ../escape.geojson',
    'case 3(b): 合成関数のメッセージが既存と1文字も変わらないこと',
  );
  assert.equal(
    messageOf(() => assertSafePoiPackageEntries([
      { name: 'pois/a.geojson', size: 1 },
      { name: 'pois/a.geojson', size: 1 },
    ])),
    'Duplicate POI package entry: pois/a.geojson',
    'case 3(b): 重複名メッセージが既存と1文字も変わらないこと',
  );
  assert.equal(
    messageOf(() => assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: -1 }])),
    'Invalid POI package entry size: pois/a.geojson',
    'case 3(b): サイズ不正メッセージが既存と1文字も変わらないこと',
  );
}

// ---------------------------------------------------------------------------
// 単独呼び出しへの自衛: NaN size が上限判定を無効化しないこと。
// total が NaN になると以降の `total > MAX` が恒偽になり、**サイズ上限が黙って
// 素通りする**（最悪の壊れ方）。合成経路では (a) が先に弾くが、(b) 単独では弾けない。
// ---------------------------------------------------------------------------
{
  assert.throws(
    () => assertPoiPayloadLimits([{ name: 'imgs/a.png', size: Number.NaN }]),
    /Invalid POI package entry size: imgs\/a\.png/,
    '(b) 単独呼び出しでも NaN size を弾くこと',
  );
  // NaN を弾かなければ、この巨大 entry が素通りしてしまう（弾く根拠）
  assert.throws(
    () => assertPoiPayloadLimits([
      { name: 'imgs/nan.png', size: Number.NaN },
      { name: 'pois/huge.geojson', size: POI_PACKAGE_MAX_EXPANDED_BYTES + 1 },
    ]),
    /Invalid POI package entry size/,
    'NaN 混入時に後続の上限判定が無効化しないこと',
  );
  assert.throws(
    () => assertPoiPayloadLimits([{ name: 'imgs/a.png', size: -1 }]),
    /Invalid POI package entry size/,
    '(b) 単独呼び出しでも負値を弾くこと',
  );
}

// ---------------------------------------------------------------------------
// case 4: 1件制約の所在 — 列挙 primitive を切り出し、個数の要求は呼び出し側に残す
// ---------------------------------------------------------------------------
{
  const mapNames = ['maps/himeji.json', 'pois/a.geojson', 'pois/b.geojson', 'tiles/himeji/0/0/0.jpg'];
  assert.deepEqual(
    listPoiDocumentEntries(mapNames),
    ['pois/a.geojson', 'pois/b.geojson'],
    'case 4: listPoiDocumentEntries は複数件をそのまま返すこと（地図 ZIP の要求）',
  );
  assert.deepEqual(listPoiDocumentEntries(['README']), [], 'case 4: 0件は空配列であること');
  // ネストは対象外（現行の正規表現 ^pois/[^/]+\.geojson$ を維持する）
  assert.deepEqual(
    listPoiDocumentEntries(['pois/sub/a.geojson']), [],
    'case 4: pois/ 直下以外は POI 文書として列挙しないこと（既存挙動の維持）',
  );

  // findPoiDocumentEntry は「ちょうど1件」を維持する（POI 単体パッケージの入力検証を緩めない）
  assert.equal(findPoiDocumentEntry(['README', 'pois/himeji.geojson']), 'pois/himeji.geojson');
  assert.throws(() => findPoiDocumentEntry([]), /found 0/, 'case 4: 0件で throw すること');
  assert.throws(
    () => findPoiDocumentEntry(['pois/a.geojson', 'pois/b.geojson']),
    /found 2/,
    'case 4: 2件で throw すること（地図 ZIP の都合で緩めない）',
  );
}

// ---------------------------------------------------------------------------
// 合成の等価性: assertSafePoiPackageEntries は分割前と同じ入力集合を受理・拒否する
// ---------------------------------------------------------------------------
{
  assert.doesNotThrow(() => assertSafePoiPackageEntries([
    { name: 'pois/himeji.geojson', size: 200 },
    { name: 'imgs/photo.png', size: 1000 },
  ]));
  assert.throws(() => assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: POI_PACKAGE_MAX_EXPANDED_BYTES + 1 }]));
  // 境界: ちょうど合計の上限（1 GiB）までは通る
  assert.doesNotThrow(() => assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: POI_PACKAGE_MAX_EXPANDED_BYTES }]));
  assert.throws(() => assertSafePoiPackageEntries([{
    name: 'imgs/icons/default/huge.png',
    size: POI_PACKAGE_MAX_IMAGE_BYTES + 1,
  }]), /Packaged image is too large/);
}

console.log('package limit scope smoke: OK');
