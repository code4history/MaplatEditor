// アプリのソースの旧形（data にマスタ全コピー）を保存して読み直す往復の smoke（#147）。
//
// 旧形のまま保存された文書は、所有キー（利用範囲・mercator シフト）が `legacyData` の中に
// 入れ子で残る。保存するたびに 1 段深くなり、読み直すと所有キーが翻訳されずに消えて見えていた。
// ここでは normalizeAppSource → resolveAppSource の結果を固定の値で断言する。
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'app-source-legacy-roundtrip-'));
const outDir = path.join(workDir, 'dist');

// 保存（JSON の往復）を真似る
const roundTrip = (value) => JSON.parse(JSON.stringify(value));

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

  const { normalizeAppSource, resolveAppSource } = await import(
    pathToFileURL(path.join(outDir, 'appSourceModel.mjs')).href
  );

  const MASTERS = [
    {
      uid: 'uid-osm', mapID: 'osm', scope: 'builtin',
      data: {
        mapID: 'osm', builtinId: 'osm', always: true, lang: 'en',
        title: { en: 'OpenStreetMap', ja: 'オープンストリートマップ' },
        label: { en: 'OSM(Now)', ja: 'OSM(現在)' },
        attr: '©︎ OpenStreetMap contributors',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        minZoom: 0, maxZoom: 19,
      },
    },
    {
      uid: 'uid-tms', mapID: 'user-tms', scope: 'user',
      data: {
        mapID: 'user-tms', lang: 'ja', kind: 'tms', maptype: 'overlay',
        title: { ja: 'ユーザ地図', en: 'User Map' },
        label: { ja: 'ユーザ' },
        attr: { ja: '作者' },
        url: 'https://tiles.example.test/{z}/{x}/{y}.png',
        minZoom: 5, maxZoom: 18,
      },
    },
  ];
  const lookup = {
    byUid: (uid) => MASTERS.find((m) => m.uid === uid),
    bySlug: (slug) => MASTERS.find((m) => m.mapID === slug),
  };
  const emptyLookup = { byUid: () => undefined, bySlug: () => undefined };

  const ENVELOPE = [[130.5, 32.5], [131, 32.5], [131, 33], [130.5, 33]];
  const OWNED = { envelopeLngLats: ENVELOPE, mercatorXShift: 1.5, mercatorYShift: -2.25 };
  const OLD_LABEL = { ja: '旧ラベル' };

  // 旧形の tms（data にマスタの全コピー＋所有キー）
  const legacyTms = (overrides = {}) => ({
    sourceType: 'tms', mapUid: 'user-tms', role: 'overlay', startFrom: false,
    label: OLD_LABEL,
    data: {
      mapID: 'user-tms', lang: 'ja', kind: 'tms', maptype: 'overlay',
      title: { ja: 'ユーザ地図', en: 'User Map' },
      attr: { ja: '作者' },
      url: 'https://tiles.example.test/{z}/{x}/{y}.png',
      minZoom: 5, maxZoom: 18,
      ...OWNED,
    },
    ...overrides,
  });

  // 1.2.0 が保存した形: normalizeAppSource の結果（legacyData を持つ）をそのまま保存したもの
  const innerTms = (maptype = 'overlay') => ({
    lang: 'ja', kind: 'tms', maptype,
    title: { ja: 'ユーザ地図', en: 'User Map' },
    attr: { ja: '作者' },
    url: 'https://tiles.example.test/{z}/{x}/{y}.png',
    minZoom: 5, maxZoom: 18,
    ...OWNED,
  });
  const savedOnce = (role = 'overlay', maptype = 'overlay') => ({
    sourceType: 'tms', mapUid: 'user-tms', role, startFrom: false,
    label: OLD_LABEL, title: 'ユーザ地図',
    legacyData: innerTms(maptype),
  });
  // 2 回保存した形（入れ子が 2 段）
  const savedTwice = (role = 'overlay', maptype = 'overlay') => ({
    sourceType: 'tms', mapUid: 'user-tms', role, startFrom: false,
    label: OLD_LABEL, title: 'ユーザ地図',
    legacyData: { ...savedOnce(role, maptype), legacyData: innerTms(maptype) },
  });

  const resolveFrom = (raw, l = lookup) => resolveAppSource(normalizeAppSource(roundTrip(raw), 'ja'), l);

  const expectMigrated = (raw, name) => {
    const r = resolveFrom(raw);
    assert.equal(r.ok, true, `${name}: マスタが引ける`);
    assert.deepEqual(r.source.overrides, OWNED, `${name}: 所有キー 3 つが overrides に入る`);
    assert.deepEqual(r.source.label, OLD_LABEL, `${name}: マスタと違う label が残る`);
    assert.equal('legacyData' in r.source, false, `${name}: legacyData が残らない`);
    assert.equal(r.source.baseMapUid, 'uid-tms', `${name}: baseMapUid を補う`);
    return r;
  };

  // (a) 旧形（data 全コピー）
  expectMigrated(legacyTms(), '(a) 旧形');
  console.log('ok: (a) 旧形（data 全コピー）の翻訳');

  // (b) 1.2.0 が保存した形（legacyData が 1 段）
  expectMigrated(savedOnce(), '(b) 1.2.0 の保存形');
  console.log('ok: (b) 1.2.0 の保存形（legacyData の入れ子）を読み戻す');

  // (c) 2 回保存した形（legacyData が 2 段）
  expectMigrated(savedTwice(), '(c) 2 段の入れ子');
  console.log('ok: (c) 2 段の入れ子を読み戻す');

  // (d) 差分保持形は変わらない
  {
    const raw = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'overlay', startFrom: false,
      label: OLD_LABEL, title: 'ユーザ地図',
      overrides: { ...OWNED, title: { ja: '廃止キー' } },
    };
    const n = normalizeAppSource(roundTrip(raw), 'ja');
    assert.deepEqual(n, {
      sourceType: 'tms', mapUid: 'user-tms', role: 'overlay', startFrom: false,
      overrides: OWNED, baseMapUid: 'uid-tms', label: OLD_LABEL, title: 'ユーザ地図',
    }, '(d) 差分保持形の読み方は変わらない');
    console.log('ok: (d) 差分保持形は変わらない');
  }

  // (e) builtin の 1.2.0 保存形
  {
    const raw = {
      sourceType: 'builtin', mapUid: 'osm', role: 'base', startFrom: true,
      label: { ja: '旧OSM' }, title: 'OSM',
      legacyData: {
        mapID: 'osm', builtinId: 'osm', lang: 'en',
        title: { en: 'OpenStreetMap', ja: 'オープンストリートマップ' },
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        envelopeLngLats: ENVELOPE,
      },
    };
    const n = normalizeAppSource(roundTrip(raw), 'ja');
    assert.equal(n.sourceType, 'builtin', '(e) builtin のまま');
    assert.equal(n.role, 'base', '(e) base のまま');
    const r = resolveAppSource(n, lookup);
    assert.equal(r.ok, true);
    assert.deepEqual(r.source.overrides, { envelopeLngLats: ENVELOPE }, '(e) builtin の利用範囲が残る');
    assert.equal(r.source.baseMapUid, 'uid-osm');
    console.log('ok: (e) builtin の 1.2.0 保存形を読み戻す');
  }

  // (f) role を保つ: 外側 role:'base'・内側 maptype:'overlay'（画面で overlay→base に直して保存した形）
  {
    const n = normalizeAppSource(roundTrip(savedOnce('base', 'overlay')), 'ja');
    assert.equal(n.role, 'base', '(f) 最上位の role:base が効く');
    const r = resolveAppSource(n, lookup);
    assert.deepEqual(r.source.overrides, OWNED, '(f) 所有キー 3 つが overrides に入る');
    const back = normalizeAppSource(roundTrip(savedOnce('overlay', 'base')), 'ja');
    assert.equal(back.role, 'overlay', '(f) 逆向き（外側 overlay・内側 base）は overlay');
    console.log('ok: (f) 入れ子を降りても最上位の role が効く');
  }

  // (g) (f) を 2 段の入れ子にしても base
  {
    const n = normalizeAppSource(roundTrip(savedTwice('base', 'overlay')), 'ja');
    assert.equal(n.role, 'base', '(g) 2 段の入れ子でも最上位の role:base が効く');
    assert.deepEqual(resolveAppSource(n, lookup).source.overrides, OWNED, '(g) 所有キー 3 つ');
    console.log('ok: (g) 2 段の入れ子でも最上位の role が効く');
  }

  // (h) 入れ子のない旧形の規則は変えない（固定の値）
  {
    const keysOf = (s) => (s.legacyData ? Object.keys(s.legacyData).sort() : null);
    const tmsDataKeys = ['attr', 'envelopeLngLats', 'kind', 'lang', 'maptype', 'maxZoom',
      'mercatorXShift', 'mercatorYShift', 'minZoom', 'title', 'url'];
    const cases = [
      ['role:overlay＋data overlay', legacyTms({ role: 'overlay' }), 'overlay', 'tms', tmsDataKeys],
      ['role:base＋data overlay', legacyTms({ role: 'base' }), 'overlay', 'tms', tmsDataKeys],
      ['role 無し＋data overlay', (() => { const r = legacyTms(); delete r.role; return r; })(), 'overlay', 'tms', tmsDataKeys],
      ['文字列 osm', 'osm', 'base', 'builtin', null],
      ['builtin の旧形', {
        mapID: 'osm', startFrom: true,
        data: { mapID: 'osm', builtinId: 'osm', lang: 'en', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', envelopeLngLats: ENVELOPE },
      }, 'base', 'builtin', ['builtinId', 'envelopeLngLats', 'lang', 'mapID', 'url']],
    ];
    for (const [name, raw, role, sourceType, keys] of cases) {
      const n = normalizeAppSource(roundTrip(raw), 'ja');
      assert.equal(n.role, role, `(h) ${name}: role`);
      assert.equal(n.sourceType, sourceType, `(h) ${name}: sourceType`);
      assert.deepEqual(keysOf(n), keys, `(h) ${name}: legacyData のキー`);
    }
    console.log('ok: (h) 入れ子のない旧形の読み方は変わらない');
  }

  // (i) べき等（翻訳済みの source をもう一度 resolveAppSource に渡しても同じ）・マスタ欠落は入力のまま
  {
    for (const [name, raw] of [['(a)', legacyTms()], ['(b)', savedOnce()], ['(c)', savedTwice()]]) {
      const r1 = resolveFrom(raw);
      const r2 = resolveAppSource(r1.source, lookup);
      assert.equal(r2.ok, true, `(i) ${name}: 2 回目も ok`);
      assert.equal(r2.master.uid, r1.master.uid, `(i) ${name}: 同じマスタ`);
      assert.deepEqual(r2.merged, r1.merged, `(i) ${name}: merged が同じ`);
      assert.deepEqual(r2.source.overrides, r1.source.overrides, `(i) ${name}: overrides が同じ`);

      const n = normalizeAppSource(roundTrip(raw), 'ja');
      const missing = resolveAppSource(n, emptyLookup);
      assert.equal(missing.ok, false, `(i) ${name}: マスタ欠落は ok でない`);
      assert.equal(missing.source, n, `(i) ${name}: マスタ欠落は入力のまま`);
    }
    console.log('ok: (i) べき等・マスタ欠落は入力のまま');
  }

  console.log('\napp-source-legacy-roundtrip smoke: すべて成功');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
