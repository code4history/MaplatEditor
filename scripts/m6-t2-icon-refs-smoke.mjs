import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'icon-refs-'));
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
        entry: path.join(projectRoot, 'src/utils/iconRefs.ts'),
        formats: ['es'],
        fileName: () => 'iconRefs.mjs',
      },
      rollupOptions: { external: [] },
    },
  });

  const mod = await import(pathToFileURL(path.join(outDir, 'iconRefs.mjs')).href);
  const { parseIconRef, isRegisteredIconSet, listIconSets, formatIconRef } = mod;

  // 1. URL パターン: `://` を含む絶対 URL
  assert.deepEqual(parseIconRef('https://example.com/pin.png'), {
    kind: 'url',
    url: 'https://example.com/pin.png',
  });

  // 2. data: URL
  assert.deepEqual(parseIconRef('data:image/svg+xml,<svg/>'), {
    kind: 'url',
    url: 'data:image/svg+xml,<svg/>',
  });

  // 3. file:// URL
  assert.deepEqual(parseIconRef('file:///x.png'), { kind: 'url', url: 'file:///x.png' });

  // 4. blob: URL
  assert.deepEqual(parseIconRef('blob:https://example.com/abcd-1234'), {
    kind: 'url',
    url: 'blob:https://example.com/abcd-1234',
  });

  // 5. builtin:defaultpin → 登録済み icon set
  assert.deepEqual(parseIconRef('builtin:defaultpin'), {
    kind: 'iconset',
    setId: 'builtin',
    iconId: 'defaultpin',
  });
  assert.equal(isRegisteredIconSet('builtin'), true);

  // 6. maki:bank → 未登録だが iconset 扱い(URL とみなさない)
  assert.deepEqual(parseIconRef('maki:bank'), {
    kind: 'iconset',
    setId: 'maki',
    iconId: 'bank',
  });
  assert.equal(isRegisteredIconSet('maki'), false);

  // 7. UUID v4(小文字) → asset
  const uuid = '9b2b6f6e-3c1d-4e5a-8f00-1234567890ab';
  assert.deepEqual(parseIconRef(uuid), { kind: 'asset', uid: uuid });

  // 7b. UUID(大文字) も同じ判定(UUID_PATTERN は大文字小文字を区別しない、SqliteDataService 準拠)
  const uuidUpper = uuid.toUpperCase();
  assert.deepEqual(parseIconRef(uuidUpper), { kind: 'asset', uid: uuidUpper });

  // 8. 相対パス → url
  assert.deepEqual(parseIconRef('imgs/pin.png'), { kind: 'url', url: 'imgs/pin.png' });

  // 9. `://` を含まない予約 scheme のみの文字列(`http:foo`) → setId とみなさず url
  assert.deepEqual(parseIconRef('http:foo'), { kind: 'url', url: 'http:foo' });
  assert.deepEqual(parseIconRef('https:foo'), { kind: 'url', url: 'https:foo' });
  assert.deepEqual(parseIconRef('data:foo'), { kind: 'url', url: 'data:foo' });
  assert.deepEqual(parseIconRef('file:foo'), { kind: 'url', url: 'file:foo' });
  assert.deepEqual(parseIconRef('blob:foo'), { kind: 'url', url: 'blob:foo' });

  // 10. 大文字始まりの setId は文字種違反 → url 扱い(setId は [a-z][a-z0-9-]* のみ)
  assert.deepEqual(parseIconRef('Builtin:defaultpin'), {
    kind: 'url',
    url: 'Builtin:defaultpin',
  });

  // 11. iconId が空(`builtin:`) → url 扱い(iconId 必須、空は setId 参照とみなさない)
  assert.deepEqual(parseIconRef('builtin:'), { kind: 'url', url: 'builtin:' });

  // 11b. `scheme://...` 形の絶対 URL(予約 scheme 以外)は setId 判定より先に url と判別する
  // (仕様 §7 の判別順序: URL パターン → 登録済み setId → UUID。`ftp`/`s3` 等は setId として
  // 登録され得ない scheme だが、`//` を伴う絶対 URL 形はここで url と判定すべき)
  assert.deepEqual(parseIconRef('ftp://host/pin.png'), {
    kind: 'url',
    url: 'ftp://host/pin.png',
  });
  assert.deepEqual(parseIconRef('s3://bucket/x.png'), {
    kind: 'url',
    url: 's3://bucket/x.png',
  });

  // 12. formatIconRef の往復が正規形で安定
  assert.equal(formatIconRef(parseIconRef('builtin:defaultpin')), 'builtin:defaultpin');
  assert.equal(formatIconRef(parseIconRef(uuid)), uuid);
  assert.equal(
    formatIconRef(parseIconRef('https://example.com/pin.png')),
    'https://example.com/pin.png',
  );
  assert.equal(formatIconRef(parseIconRef('maki:bank')), 'maki:bank');

  // 13. listIconSets に builtin があり icons 7種 (Phase 8 Task 4: ビューア整合)。
  //     defaultpin/defaultpin-selected はビューアの png、色5種 (blue/red/green/yellow/gray)
  //     は SVG のボーナストラック。previewUrl は per-icon ext で png/svg 混在に追随する
  const sets = listIconSets();
  const builtin = sets.find((s) => s.setId === 'builtin');
  assert.ok(builtin, 'builtin icon set must be registered');
  assert.equal(builtin.iconIds.length, 7);
  assert.deepEqual(
    [...builtin.iconIds].sort(),
    [
      'defaultpin',
      'defaultpin-selected',
      'defaultpin-blue',
      'defaultpin-gray',
      'defaultpin-green',
      'defaultpin-red',
      'defaultpin-yellow',
    ].sort(),
  );
  // icons: {id, ext}[] — iconIds は icons からの導出で一致するはず
  assert.deepEqual(builtin.icons.map((icon) => icon.id), builtin.iconIds);
  assert.deepEqual(
    Object.fromEntries(builtin.icons.map((icon) => [icon.id, icon.ext])),
    {
      'defaultpin': 'png',
      'defaultpin-selected': 'png',
      'defaultpin-blue': 'svg',
      'defaultpin-red': 'svg',
      'defaultpin-green': 'svg',
      'defaultpin-yellow': 'svg',
      'defaultpin-gray': 'svg',
    },
  );
  // defaultpin の実体はビューア標準の png (ユーザー決定 2026-07-11 のアート差し替え)
  assert.equal(builtin.previewUrl('defaultpin'), 'icons/builtin/defaultpin.png');
  assert.equal(builtin.previewUrl('defaultpin-selected'), 'icons/builtin/defaultpin-selected.png');
  assert.equal(builtin.previewUrl('defaultpin-blue'), 'icons/builtin/defaultpin-blue.svg');
  assert.equal(builtin.previewUrl('defaultpin-red'), 'icons/builtin/defaultpin-red.svg');

  // 14. title は i18n キー (titleKey) を持つ (Phase 6 品質レビュー MINOR-3: ハードコード英語
  // "Builtin" ではなく poiedit.picker.set_builtin キーを呼び出し側の t() で解決する)
  assert.equal(builtin.titleKey, 'poiedit.picker.set_builtin');
  assert.equal(typeof builtin.title, 'undefined', 'title は titleKey に置き換わり残っていないはず');

  console.log('m6-t2-icon-refs smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
