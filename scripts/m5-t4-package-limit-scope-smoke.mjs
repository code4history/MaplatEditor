// m5-t4: 安全検証と容量上限の分離（設計 v2.1 §5.1）と、列挙 primitive の切り出し。
//
// 固定する受け入れ条件:
//   AC4      1件制約の所在 — findPoiDocumentEntry は「ちょうど1件」を維持し、
//            地図 ZIP は listPoiDocumentEntries を使う
//   AC1      容量上限の適用範囲（契約レベル）— (a)(b) タイルは無制限 / (c) POI payload は
//            同じ上限で拒否 / (d) POI 単体パッケージでは全 entry に効く（payload 外 entry を含む
//            fixture 必須）。経路レベルは AC2（managed-poi-documents smoke）が担う
//   AC3(b)   POI 経路のエラーメッセージが1文字も変わらない（kindLabel 既定値の維持）
//
// 本 smoke は純粋関数層（src/utils/poiPackage.ts）だけを対象とする。
// 実行時点（extractAllTo の前）の固定は AC3(a) を担う別 smoke の責務である。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });

async function importSource() {
  const workDir = await mkdtemp(path.join(scratchRoot, 'm5-t4-package-limit-scope-'));
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
// （mapDownloadZip.ts:85-94）。1000 entry・累積 200 MiB で、512 entry と 100 MiB の
// 両方を超える。
function mapArchiveEntries({ tiles = 1000, tileSize = 200 * 1024, extra = [] } = {}) {
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
// これが設計 v1.4 Major-1（「上限を ZIP 全体へ適用する」は誤り）の実体である。
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
// AC1(a)(b): タイルが 512 entry / 100 MiB を超えても地図 ZIP は通る
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
    `fixture 前提: 累積サイズが上限を超えていること (${total} > ${POI_PACKAGE_MAX_EXPANDED_BYTES})`,
  );

  // (a)(b) 安全検証は通り、容量上限は掛からない
  assert.doesNotThrow(
    () => assertSafeArchiveEntries(entries, 'map package'),
    'AC1(a)(b): 512 entry 超・100 MiB 超のタイルを持つ地図 ZIP が安全検証を通ること',
  );
  assert.doesNotThrow(
    () => assertPoiPayloadLimits(payloadOf(entries)),
    'AC1(a)(b): タイルは POI payload ではないため容量上限の対象外であること',
  );
  assert.equal(payloadOf(entries).length, 0, 'fixture 前提: この地図 ZIP に POI payload は無い');
}

// ---------------------------------------------------------------------------
// AC1(c): POI payload は POI 単体パッケージと同じ上限で拒否される
//          （地図 ZIP 経路にこの検査は従来存在しないため「両経路の同値性」が固定対象）
// ---------------------------------------------------------------------------
{
  // pois/ + imgs/ の合計が 100 MiB 超（タイルは 1 MiB しかない = タイル由来ではない）
  const payloadHeavy = mapArchiveEntries({ tiles: 4, tileSize: 256 * 1024, extra: [
    { name: 'pois/himeji.geojson', size: 60 * MiB },
    { name: 'imgs/a.png', size: 19 * MiB },
    { name: 'imgs/b.png', size: 19 * MiB },
    { name: 'imgs/c.png', size: 19 * MiB },
  ]});
  assert.throws(
    () => assertPoiPayloadLimits(payloadOf(payloadHeavy)),
    /POI package is too large/,
    'AC1(c): pois/+imgs/ の合計が 100 MiB を超える地図 ZIP は拒否されること',
  );

  // imgs/ の1件が 20 MiB 超
  const oversizedImage = mapArchiveEntries({ tiles: 4, extra: [
    { name: 'pois/himeji.geojson', size: 1024 },
    { name: 'imgs/huge.png', size: POI_PACKAGE_MAX_IMAGE_BYTES + 1 },
  ]});
  assert.throws(
    () => assertPoiPayloadLimits(payloadOf(oversizedImage)),
    /Packaged image is too large: imgs\/huge\.png/,
    'AC1(c): imgs/ の1件が 20 MiB を超える地図 ZIP は拒否されること',
  );

  // 同じ payload を POI 単体パッケージ経路へ通しても同じ上限で落ちる（両経路の同値性）
  assert.throws(
    () => assertSafePoiPackageEntries([
      { name: 'pois/himeji.geojson', size: 1024 },
      { name: 'imgs/huge.png', size: POI_PACKAGE_MAX_IMAGE_BYTES + 1 },
    ]),
    /Packaged image is too large: imgs\/huge\.png/,
    'AC1(c): POI 単体パッケージ経路も同じ上限・同じメッセージであること',
  );
}

// ---------------------------------------------------------------------------
// AC1(d): POI 単体パッケージでは上限が「全 entry」に効く。
//          fixture は payload 外 entry による超過を必ず含める（§6.2.6 の訂正を固定する検証点）。
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
    'AC1(d): payload 外 entry（巨大 README）による 100 MiB 超が POI 単体パッケージで拒否されること',
  );
  // 同じ入力は payload 限定の検査では通る = 委譲のみでは検知できないことの証明
  assert.doesNotThrow(
    () => assertPoiPayloadLimits(payloadOf(bigReadme)),
    'AC1(d): payload へ絞ると README が勘定から外れる（∴ 委譲のみの再実装では素通りする）',
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
    'AC1(d): payload 外 entry による 512 entry 超が POI 単体パッケージで拒否されること',
  );
  assert.doesNotThrow(
    () => assertPoiPayloadLimits(payloadOf(manyDocs)),
    'AC1(d): payload へ絞ると docs/ が勘定から外れる（∴ 委譲のみの再実装では素通りする）',
  );
}

// ---------------------------------------------------------------------------
// AC3(b): 安全検証は全 entry へ。メッセージは kindLabel 既定値で1文字も変わらない
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
      `AC3: 危険な entry 名 ${name} が拒否されること`,
    );
  }
  assert.throws(
    () => assertSafeArchiveEntries([{ name: 'tiles/link.jpg', size: 1, isSymlink: true }], 'map package'),
    /Unsafe map package entry: tiles\/link\.jpg/,
    'AC3: symlink entry が拒否されること',
  );
  assert.throws(
    () => assertSafeArchiveEntries([
      { name: 'tiles/0.jpg', size: 1 },
      { name: 'tiles/0.jpg', size: 1 },
    ], 'map package'),
    /Duplicate map package entry: tiles\/0\.jpg/,
    'AC3: 重複名が拒否されること',
  );

  // kindLabel 既定値 = 'POI package'。POI 経路のメッセージは1文字も変わらない
  const messageOf = (fn) => {
    try { fn(); } catch (e) { return e.message; }
    throw new Error('expected to throw');
  };
  assert.equal(
    messageOf(() => assertSafeArchiveEntries([{ name: '../escape.geojson', size: 1 }])),
    'Unsafe POI package entry: ../escape.geojson',
    'AC3(b): kindLabel 省略時は既存の "POI package" 文言であること',
  );
  assert.equal(
    messageOf(() => assertSafePoiPackageEntries([{ name: '../escape.geojson', size: 1 }])),
    'Unsafe POI package entry: ../escape.geojson',
    'AC3(b): 合成関数のメッセージが既存と1文字も変わらないこと',
  );
  assert.equal(
    messageOf(() => assertSafePoiPackageEntries([
      { name: 'pois/a.geojson', size: 1 },
      { name: 'pois/a.geojson', size: 1 },
    ])),
    'Duplicate POI package entry: pois/a.geojson',
    'AC3(b): 重複名メッセージが既存と1文字も変わらないこと',
  );
  assert.equal(
    messageOf(() => assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: -1 }])),
    'Invalid POI package entry size: pois/a.geojson',
    'AC3(b): サイズ不正メッセージが既存と1文字も変わらないこと',
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
// AC4: 1件制約の所在 — 列挙 primitive を切り出し、個数の要求は呼び出し側に残す
// ---------------------------------------------------------------------------
{
  const mapNames = ['maps/himeji.json', 'pois/a.geojson', 'pois/b.geojson', 'tiles/himeji/0/0/0.jpg'];
  assert.deepEqual(
    listPoiDocumentEntries(mapNames),
    ['pois/a.geojson', 'pois/b.geojson'],
    'AC4: listPoiDocumentEntries は複数件をそのまま返すこと（地図 ZIP の要求）',
  );
  assert.deepEqual(listPoiDocumentEntries(['README']), [], 'AC4: 0件は空配列であること');
  // ネストは対象外（現行の正規表現 ^pois/[^/]+\.geojson$ を維持する）
  assert.deepEqual(
    listPoiDocumentEntries(['pois/sub/a.geojson']), [],
    'AC4: pois/ 直下以外は POI 文書として列挙しないこと（既存挙動の維持）',
  );

  // findPoiDocumentEntry は「ちょうど1件」を維持する（POI 単体パッケージの入力検証を緩めない）
  assert.equal(findPoiDocumentEntry(['README', 'pois/himeji.geojson']), 'pois/himeji.geojson');
  assert.throws(() => findPoiDocumentEntry([]), /found 0/, 'AC4: 0件で throw すること');
  assert.throws(
    () => findPoiDocumentEntry(['pois/a.geojson', 'pois/b.geojson']),
    /found 2/,
    'AC4: 2件で throw すること（地図 ZIP の都合で緩めない）',
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
  assert.throws(() => assertSafePoiPackageEntries([{ name: 'pois/a.geojson', size: 101 * MiB }]));
  assert.throws(() => assertSafePoiPackageEntries([{
    name: 'imgs/icons/default/huge.png',
    size: POI_PACKAGE_MAX_IMAGE_BYTES + 1,
  }]), /Packaged image is too large/);
}

console.log('m5-t4 package limit scope smoke: OK');
