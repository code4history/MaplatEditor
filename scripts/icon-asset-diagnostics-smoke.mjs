// アイコンのアセット参照を欠落診断の対象に入れる件の純ロジック smoke (unit, vite lib build)
// iconRefs.ts の collectIconAssetUids が、アイコン (icon / selectedIcon) のうち
// アセット UID だけを集め、アイコンセットの参照・URL・相対パスを集めないことを確かめる。
// 実体の有無の照会 (window.imageAssets.getFilePath) は PoiEdit.vue 側で、e2e が確かめる。
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'icon-asset-diagnostics-'));
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

  const { collectIconAssetUids } = await import(pathToFileURL(path.join(outDir, 'iconRefs.mjs')).href);

  const LAYER_TOP = '10000000-0000-4000-a000-000000000001';
  const LAYER_PROPS = '10000000-0000-4000-a000-000000000002';
  const FEATURE_ICON = '10000000-0000-4000-a000-000000000003';
  const FEATURE_SELECTED = 'ABCDEF00-0000-4000-A000-000000000004';

  const point = { type: 'Point', coordinates: [139.7, 35.6] };

  // 1. 3 か所 (FC トップレベル・FC.properties・feature.properties) のアセット UID を集める
  {
    const fc = {
      type: 'FeatureCollection',
      icon: LAYER_TOP,
      properties: { selectedIcon: LAYER_PROPS },
      features: [
        { type: 'Feature', geometry: point, properties: { icon: FEATURE_ICON, selectedIcon: FEATURE_SELECTED } },
        { type: 'Feature', geometry: point, properties: { icon: FEATURE_ICON } }, // 重複は 1 件
      ],
    };
    const got = [...collectIconAssetUids(fc)].sort();
    assert.deepEqual(got, [LAYER_TOP, LAYER_PROPS, FEATURE_ICON, FEATURE_SELECTED.toLowerCase()].sort());
    console.log('  [ok] アセット UID のアイコンを 3 か所から集める（大文字は小文字に揃え、重複は 1 件）');
  }

  // 2. アセットではないアイコンは集めない
  {
    const notAssets = [
      'builtin:defaultpin',
      'builtin:defaultpin-selected',
      'builtin:no-such-icon', // 未知の iconId でもアイコンセットの参照であってアセットではない
      'unknownset:pin', // 未登録の setId
      'https://example.org/icons/pin.png',
      'http://example.org/pin.svg',
      'data:image/png;base64,iVBORw0KGgo=',
      'file:///tmp/pin.png',
      'icons/pin.png',
      './pin.png',
      'pin.png',
      '10000000-0000-4000-a000-00000000000', // UUID の形に足りない
      ` ${LAYER_TOP}`, // 前後に空白がある値は書き出しでも相対パス扱い（asset にならない）
      '',
    ];
    const fc = {
      type: 'FeatureCollection',
      icon: 'builtin:defaultpin',
      selectedIcon: 'https://example.org/selected.png',
      properties: { icon: 'icons/layer.png', selectedIcon: 'builtin:defaultpin-selected' },
      features: notAssets.map((value) => ({
        type: 'Feature', geometry: point, properties: { icon: value, selectedIcon: value },
      })),
    };
    assert.equal(collectIconAssetUids(fc).size, 0);
    console.log('  [ok] 組み込みの名前・未登録のセット・URL・相対パス・UUID 未満の値は集めない');
  }

  // 3. icon / selectedIcon 以外の項目と、壊れた入力は見ない
  {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: point, properties: { image: [LAYER_TOP], html: { ja: `maplat-asset:${LAYER_TOP}` } } },
        { type: 'Feature', geometry: point, properties: { icon: { src: LAYER_TOP } } }, // 文字列以外
        null,
        { type: 'Feature', geometry: point },
      ],
    };
    assert.equal(collectIconAssetUids(fc).size, 0);
    for (const bad of [null, undefined, 'str', 42, [], { features: 'x' }]) {
      assert.equal(collectIconAssetUids(bad).size, 0);
    }
    console.log('  [ok] image・html は数えず（別の収集が担当）、壊れた入力でも落ちない');
  }

  console.log('icon-asset-diagnostics smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
