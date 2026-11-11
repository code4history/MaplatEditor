// 地図ごとにオフライン表示（Viewer のタイルキャッシュ）の対象から外す印の smoke（#85）。
//
// アプリのソースのトップレベルの `noCache: true` を、保存形（差分保持形・Maplat の地図・旧形の組み込み・
// 旧形の tms）を問わず読み込みで拾い、書き出し・プレビューのソースの要素へ出すことを確かめる。
// 印の無いソースの出力は変えない（既定の挙動を変えない）。
//   1〜7  normalizeAppSource の 4 つの道（真偽値の true だけ・トップレベルだけを拾う）
//   8〜10 composeViewerSource（組み込み・Maplat の地図）
//   11    resolveAppSource（旧形の翻訳で印が消えない）
//   12    文言 3 キー × 11 言語
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'map-cache-exclusion-'));
const outDir = path.join(workDir, 'dist');

// 保存（JSON の往復）を真似る
const roundTrip = (value) => JSON.parse(JSON.stringify(value));

let failures = 0;
const row = (label, fn) => {
  try {
    fn();
    console.log(`  ok: ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  NG: ${label}\n      ${String(error?.message ?? error).split('\n').join('\n      ')}`);
  }
};

try {
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, 'src/utils/appSourceModel.ts'),
        formats: ['es'],
        fileName: () => 'appSourceModel.mjs',
      },
      rollupOptions: { external: [] },
    },
  });

  const { normalizeAppSource, composeViewerSource, resolveAppSource } = await import(
    pathToFileURL(path.join(outDir, 'appSourceModel.mjs')).href
  );

  // 組み込みのマスタは実物（electron/builtin_base_maps.json の osm）を使う
  const builtins = JSON.parse(await readFile(path.join(projectRoot, 'electron/builtin_base_maps.json'), 'utf8'));
  const osm = builtins.find((item) => item.mapID === 'osm');
  assert.ok(osm, '組み込みの osm がある');
  const MASTERS = [
    { uid: 'uid-osm', mapID: 'osm', data: osm },
    {
      uid: 'uid-tms', mapID: 'user-tms',
      data: {
        mapID: 'user-tms', lang: 'ja', kind: 'tms', maptype: 'base',
        title: { ja: 'ユーザ地図' },
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        minZoom: 0, maxZoom: 19,
      },
    },
  ];
  const lookup = {
    byUid: (uid) => MASTERS.find((m) => m.uid === uid),
    bySlug: (slug) => MASTERS.find((m) => m.mapID === slug),
  };
  const norm = (raw) => normalizeAppSource(roundTrip(raw), 'ja');

  console.log('normalizeAppSource');
  row('1 差分保持形の tms: トップレベルの noCache:true を拾う', () => {
    assert.deepEqual(norm({ sourceType: 'tms', mapUid: 'x', overrides: {}, noCache: true }), {
      sourceType: 'tms', mapUid: 'x', role: 'base', startFrom: false, overrides: {}, noCache: true,
    });
  });
  row('2 真偽値の true 以外（"true"・1・false）は拾わない', () => {
    for (const value of ['true', 1, false]) {
      assert.deepEqual(norm({ sourceType: 'tms', mapUid: 'x', overrides: {}, noCache: value }), {
        sourceType: 'tms', mapUid: 'x', role: 'base', startFrom: false, overrides: {},
      }, `noCache: ${JSON.stringify(value)}`);
    }
  });
  row('3 Maplat の地図: noCache:true を拾う', () => {
    assert.deepEqual(norm({ sourceType: 'maplat', mapUid: 'm', noCache: true }), {
      sourceType: 'maplat', mapUid: 'm', role: 'maplat', startFrom: false,
      label: undefined, title: undefined, mapSlug: undefined, noCache: true,
    });
  });
  row('4 旧形の組み込み: noCache:true を拾い、legacyData には残さない', () => {
    const n = norm({ mapID: 'osm', maptype: 'base', noCache: true });
    assert.deepEqual(n, {
      sourceType: 'builtin', mapUid: 'osm', role: 'base', startFrom: false,
      label: undefined, legacyData: { mapID: 'osm', maptype: 'base' }, title: undefined, noCache: true,
    });
  });
  row('5 旧形の tms（data あり）: トップレベルの noCache:true を拾う', () => {
    const n = norm({
      data: { mapID: 't', maptype: 'base', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
      mapID: 't', noCache: true,
    });
    assert.deepEqual(n, {
      sourceType: 'tms', mapUid: 't', role: 'base', startFrom: false, label: undefined,
      legacyData: { maptype: 'base', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
      title: undefined, noCache: true,
    });
  });
  row('6 旧形で data の中だけに noCache:true（トップレベルに無い）は拾わない', () => {
    const n = norm({
      data: { mapID: 't', maptype: 'base', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', noCache: true },
      mapID: 't',
    });
    assert.equal('noCache' in n, false, 'トップレベルに noCache が無い');
    assert.equal('noCache' in n.legacyData, false, 'legacyData にも残らない');
  });
  row('7 入れ子の旧形（legacyData が 1 段深い）＋トップレベルの noCache:true', () => {
    const n = norm({
      sourceType: 'tms', mapUid: 'user-tms', role: 'base', startFrom: false, title: 'ユーザ地図',
      noCache: true,
      legacyData: {
        sourceType: 'tms', mapUid: 'user-tms', role: 'base',
        legacyData: { lang: 'ja', kind: 'tms', maptype: 'base', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
      },
    });
    assert.equal(n.noCache, true, 'noCache: true');
    assert.equal('noCache' in n.legacyData, false, 'legacyData に残らない');
    const r = resolveAppSource(n, lookup);
    assert.equal(r.ok, true);
    assert.equal(r.source.noCache, true, '翻訳の後も残る');
    assert.equal('noCache' in r.source.overrides, false, 'overrides に混ざらない');
  });

  console.log('composeViewerSource');
  row('8 組み込み osm（lookup あり）＋noCache:true', () => {
    const n = norm({ sourceType: 'builtin', mapUid: 'osm', baseMapUid: 'uid-osm', overrides: {}, noCache: true });
    assert.deepEqual(composeViewerSource(n, { lookup, lang: 'ja' }), {
      mapID: 'osm', settingFile: 'maps/osm.json', noCache: true,
    });
  });
  row('9 組み込み osm（lookup あり）で印なし: 出力は今と同じ', () => {
    const n = norm({ sourceType: 'builtin', mapUid: 'osm', baseMapUid: 'uid-osm', overrides: {} });
    assert.deepEqual(composeViewerSource(n, { lookup, lang: 'ja' }), {
      mapID: 'osm', settingFile: 'maps/osm.json',
    });
  });
  row('10 Maplat の地図（settingFilePrefix あり）＋noCache:true', () => {
    const n = norm({ sourceType: 'maplat', mapUid: 'uid-m', noCache: true });
    assert.deepEqual(composeViewerSource(n, { settingFilePrefix: 'maps/', maplatMapID: 'kyoto' }), {
      mapID: 'kyoto', maptype: 'maplat', settingFile: 'maps/kyoto.json', noCache: true,
    });
    const plain = norm({ sourceType: 'maplat', mapUid: 'uid-m' });
    assert.deepEqual(composeViewerSource(plain, { settingFilePrefix: 'maps/', maplatMapID: 'kyoto' }), {
      mapID: 'kyoto', maptype: 'maplat', settingFile: 'maps/kyoto.json',
    }, '印なしは今と同じ');
  });

  console.log('resolveAppSource');
  row('11 旧形の組み込み（legacyData あり）を翻訳しても noCache が残る', () => {
    const n = norm({ mapID: 'osm', maptype: 'base', noCache: true });
    const r = resolveAppSource(n, lookup);
    assert.equal(r.ok, true);
    assert.equal(r.source.noCache, true);
    assert.equal('noCache' in r.source.overrides, false, 'overrides に混ざらない');
    assert.equal('noCache' in r.merged, false, 'マスタとのマージ結果に混ざらない');
  });

  console.log('文言');
  row('12 3 キー × 11 言語', () => {
    const EXPECTED = {
      ja: {
        source_no_cache: 'オフライン表示から外す',
        source_no_cache_note: 'アプリの「オフライン表示（キャッシュ）」がオンでも、この地図のタイルは端末に残さず、毎回配信元から読み込みます。配信元が端末へのタイルの一括ダウンロードを認めていない地図（OpenStreetMap の公式タイルなど）で使います。外した地図では、ビューアのタイルの一括取得の操作も出ません。',
        source_no_cache_unavailable: 'アプリの「オフライン表示（キャッシュ）」がオフ（または「ホーム画面に追加（PWA）」がオフ）なので、どの地図のタイルも端末に残しません。',
      },
      en: {
        source_no_cache: 'Exclude from offline viewing',
        source_no_cache_note: 'Even when the app\'s "Offline Viewing (Cache)" is on, tiles of this map are not kept on the device and are loaded from the provider every time. Use it for maps whose provider does not allow bulk downloading of tiles to devices (such as the official OpenStreetMap tiles). The viewer does not offer bulk download of tiles for excluded maps.',
        source_no_cache_unavailable: 'The app\'s "Offline Viewing (Cache)" is off (or "Add to Home Screen (PWA)" is off), so no map\'s tiles are kept on the device.',
      },
    };
    const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
    const load = (lang) => JSON.parse(readFileSync(path.join(projectRoot, 'public/locales', lang, 'translation.json'), 'utf8'));
    const ja = load('ja').appedit ?? {};
    for (const lang of LANGS) {
      const appedit = load(lang).appedit ?? {};
      for (const key of Object.keys(EXPECTED.ja)) {
        const value = appedit[key];
        assert.equal(typeof value, 'string', `${lang}.appedit.${key} が文字列`);
        assert.notEqual(value.trim(), '', `${lang}.appedit.${key} が空でない`);
        assert.notEqual(value, key, `${lang}.appedit.${key} がキーの文字列でない`);
        assert.notEqual(value, `appedit.${key}`, `${lang}.appedit.${key} がキーの文字列でない`);
        if (EXPECTED[lang]) assert.equal(value, EXPECTED[lang][key], `${lang}.appedit.${key} が設計の文と一致`);
        else assert.notEqual(value, ja[key], `${lang}.appedit.${key} が ja の写しでない`);
      }
    }
  });
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`map-cache-exclusion smoke: ${failures} row(s) failed`);
  process.exit(1);
}
console.log('map-cache-exclusion smoke: ok');
