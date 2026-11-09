// POI の取り込み（追記・上書き）の合流 smoke (unit, vite ssr build)
// planPoiMerge（空セルは変えない・往復で変更なし・Undo 1 回）を検証する。
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = path.join(projectRoot, 'tests/fixtures/poi-io');
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-merge-'));
const outDir = path.join(workDir, 'dist');

try {
  const entry = path.join(workDir, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiMerge.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiImportRows.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiCsvExport.ts'))};`,
      `export { usePoiEditSession } from ${JSON.stringify(path.join(projectRoot, 'src/composables/usePoiEditSession.ts'))};`,
      `export { normalizePoiSourceCollection, toExportForm, validateFeatureCollection } from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiGeoJson.ts'))};`,
    ].join('\n'),
  );
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      ssr: entry,
      rollupOptions: { output: { entryFileNames: 'bundle.mjs', format: 'es' } },
    },
    ssr: { noExternal: true },
  });
  const mod = await import(pathToFileURL(path.join(outDir, 'bundle.mjs')).href);
  const {
    planPoiMerge, parsePoiImportFile, buildPoiCsv, usePoiEditSession,
    normalizePoiSourceCollection, toExportForm, validateFeatureCollection,
  } = mod;

  const enc = (s) => new TextEncoder().encode(s);
  const readJson = async (name) => JSON.parse(await readFile(path.join(fixtureDir, name), 'utf8'));
  const stripInternal = (f) => ({
    ...f,
    properties: Object.fromEntries(Object.entries(f.properties).filter(([k]) => !k.startsWith('_maplat'))),
  });
  const parseCsv = (bytes, defaultLang = 'ja') => parsePoiImportFile({ format: 'csv', bytes, defaultLang });
  const plan = (existing, parse, mode, impl = planPoiMerge) =>
    impl({ existing, rows: parse.rows, mode, defaultLang: 'ja' });
  const existingFeatures = async () => normalizePoiSourceCollection(await readJson('merge-existing.json'), 'ja').features;
  const demoBytes = new Uint8Array(await readFile(path.join(fixtureDir, 'demo-merge.csv')));

  // --- AC6(1)(3)(4)(5): デモ A の追記と上書き ---
  // 性質の検査は関数にまとめ、変異版 (下の case 10) にも同じ検査を当てる
  const checkDemo = async (impl) => {
    const existing = await existingFeatures();
    const parse = parseCsv(demoBytes);
    const problems = [];
    const check = (name, fn) => { try { fn(); } catch { problems.push(name); } };

    const append = plan(existing, parse, 'append', impl);
    check('append: 件数と期待値', () => {
      assert.deepEqual(JSON.parse(JSON.stringify(append.features.map(stripInternal))), JSON.parse(JSON.stringify(expectedAppend)));
      assert.deepEqual(append.summary, { added: 3, updated: 0, unchanged: 0, keptExisting: 0, renamed: 1, skippedRows: 1 });
    });
    check('append: 既存はそのまま (===)', () => {
      for (let i = 0; i < 3; i++) assert.equal(append.features[i], existing[i]);
    });
    check('append: 衝突は付け替え', () => assert.equal(new Set(append.features.map((f) => f.id)).size, append.features.length));
    check('append: 付け替えの警告と除く行の誤り', () => {
      const got = append.issues.map((i) => `${i.line}:${i.code}:${i.level}`).sort();
      assert.deepEqual(got, ['2:id-renamed:warning', '3:coord-missing:error', '3:name-required:error']);
    });
    const over = plan(existing, parse, 'overwrite', impl);
    check('overwrite: 期待値', () => {
      assert.deepEqual(JSON.parse(JSON.stringify(over.features.map(stripInternal))), JSON.parse(JSON.stringify(expectedOverwrite)));
      assert.deepEqual(over.summary, { added: 2, updated: 2, unchanged: 0, keptExisting: 1, renamed: 0, skippedRows: 0 });
    });
    check('overwrite: _maplatUid を維持', () => {
      assert.equal(over.features[1].properties._maplatUid, 'uid-shrine-2');
      assert.equal(over.features[2].properties._maplatUid, 'uid-temple-1');
    });
    check('overwrite: 触っていない POI は同じオブジェクト', () => assert.equal(over.features[0], existing[0]));
    check('overwrite: 空セルは何も消さない (address・座標・image)', () => {
      assert.deepEqual(over.features[1].properties.address, { ja: '東京都' });
      assert.deepEqual(over.features[2].geometry.coordinates, [139.76, 35.68]);
      assert.equal(over.features[2].properties.image, 'https://example.com/t1.jpg');
    });
    check('新しい POI の _maplatUid と検証', () => {
      const added = append.features.slice(3).concat(over.features.slice(3));
      for (const f of added) assert.match(f.properties._maplatUid, /^[0-9a-f-]{36}$/);
      for (const result of [append, over]) {
        const errors = validateFeatureCollection({ type: 'FeatureCollection', lang: 'ja', features: result.features })
          .filter((i) => i.level === 'error');
        assert.deepEqual(errors, []);
      }
    });
    return problems;
  };
  const expectedAppend = await readJson('expected-append.json');
  const expectedOverwrite = await readJson('expected-overwrite.json');
  assert.deepEqual(await checkDemo(planPoiMerge), []);
  console.log('  case 1 (デモ A: 追記 6 件・上書き 5 件): PASS');

  // --- AC6(2): 空セルの規則の表駆動 ---
  {
    // 項目 × 列あり/なし × セルが空/非空 × 既存に値あり/なし
    const fields = [
      { key: 'name', cols: ['name'], get: (f) => f.properties.name?.ja, cell: 'N新', base: 'N旧' },
      { key: 'name:en', cols: ['name:en'], get: (f) => f.properties.name?.en, cell: 'EN-new', base: 'EN-old' },
      { key: 'desc', cols: ['desc'], get: (f) => f.properties.desc?.ja, cell: 'D新', base: 'D旧' },
      { key: 'address', cols: ['address'], get: (f) => f.properties.address?.ja, cell: 'A新', base: 'A旧' },
      { key: 'image', cols: ['image'], get: (f) => f.properties.image, cell: 'https://x/new.jpg', base: 'https://x/old.jpg' },
      { key: 'latlng', cols: ['lat', 'lng'], get: (f) => f.geometry.coordinates.join(','), cell: ['36.5', '140.5'], base: [35.5, 139.5] },
    ];
    let combos = 0;
    for (const field of fields) {
      for (const hasColumn of [true, false]) {
        for (const cellNonEmpty of [true, false]) {
          for (const existingHas of [true, false]) {
            if (field.key === 'latlng' && !existingHas) continue; // 座標は必須。既存は常に持つ
            const props = { name: { ja: '基本' } };
            if (field.key === 'name') props.name = existingHas ? { ja: field.base } : { en: '英' };
            else if (field.key === 'name:en') { if (existingHas) props.name = { ja: '基本', en: field.base }; }
            else if (field.key === 'desc') { if (existingHas) props.desc = { ja: field.base }; }
            else if (field.key === 'address') { if (existingHas) props.address = { ja: field.base }; }
            else if (field.key === 'image') { if (existingHas) props.image = field.base; }
            const existing = [{
              type: 'Feature', id: 't1',
              geometry: { type: 'Point', coordinates: field.key === 'latlng' ? [field.base[1], field.base[0]] : [139.5, 35.5] },
              properties: { _maplatUid: 'u-t1', ...props },
            }];
            const header = ['id', ...(hasColumn ? field.cols : [])];
            const value = field.key === 'latlng' ? field.cell : [field.cell];
            const cells = ['t1', ...(hasColumn ? (cellNonEmpty ? value : value.map(() => '')) : [])];
            const text = header.join(',') + '\r\n' + cells.join(',') + '\r\n';
            const parse = parseCsv(enc(text));
            assert.equal(parse.fatal, false, text);
            const result = plan(existing, parse, 'overwrite');
            const before = field.get(existing[0]);
            const after = field.get(result.features[0]);
            const label = `${field.key} 列=${hasColumn} セル非空=${cellNonEmpty} 既存=${existingHas}`;
            if (hasColumn && cellNonEmpty) {
              const expected = field.key === 'latlng' ? '36.5,140.5' : field.cell;
              assert.equal(after, expected, label + ' は上書き');
              assert.equal(result.summary.updated, 1, label);
            } else {
              assert.equal(after, before, label + ' は変えない');
              assert.equal(result.features[0], existing[0], label + ' は同じオブジェクト');
              assert.equal(result.summary.unchanged, 1, label);
            }
            combos += 1;
          }
        }
      }
    }
    // name:en の空セルは英語名を消さず、ほかの言語も触らない
    const existing = [{
      type: 'Feature', id: 'k', geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { _maplatUid: 'u-k', name: { ja: '名', en: 'Name', ko: '이름' } },
    }];
    const r = plan(existing, parseCsv(enc('id,name,name:en\r\nk,新名,\r\n')), 'overwrite');
    assert.deepEqual(r.features[0].properties.name, { ja: '新名', en: 'Name', ko: '이름' });
    assert.ok(combos >= 40);
    console.log(`  case 2 (空セルの規則 ${combos} 通り): PASS`);
  }

  // --- AC6(6): id の枯渇 ---
  {
    const ids = ['x', ...Array.from({ length: 99 }, (_, i) => `x-${i + 2}`)]; // x, x-2 ... x-100
    const existing = ids.map((id) => ({
      type: 'Feature', id, geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { _maplatUid: `u-${id}`, name: { ja: id } },
    }));
    const r = plan(existing, parseCsv(enc('id,name,lat,lng\r\nx,新,1,2\r\n')), 'append');
    assert.equal(r.features.length, existing.length);
    assert.deepEqual(r.issues.map((i) => `${i.code}:${i.level}`), ['id-exhausted:error']);
    assert.equal(r.summary.skippedRows, 1);
    // あと 1 つ空いていれば付け替わる
    const r2 = plan(existing.slice(0, -1), parseCsv(enc('id,name,lat,lng\r\nx,新,1,2\r\n')), 'append');
    assert.equal(r2.features.at(-1).id, 'x-100');
    console.log('  case 3 (id の枯渇): PASS');
  }

  // --- AC6(7): 往復 ---
  {
    const source = await readJson('roundtrip-source.json');
    const internal = normalizePoiSourceCollection(source, 'ja');
    const exported = toExportForm(internal, 'src', { ja: 't' }, { roundCoordinates: true, defaultLang: 'ja' });
    const csv = buildPoiCsv(exported);
    const csvText = new TextDecoder().decode(csv.bytes.subarray(3));
    const run = (text) => {
      const parse = parseCsv(enc(text));
      assert.equal(parse.fatal, false);
      return { parse, result: plan(internal.features, parse, 'overwrite') };
    };
    // 本体: 5 件すべて unchanged・===
    {
      const { parse, result } = run(csvText);
      assert.equal(result.summary.updated, 0);
      assert.equal(result.summary.unchanged, 5);
      assert.equal(result.summary.added, 0);
      for (let i = 0; i < 5; i++) assert.equal(result.features[i], internal.features[i], `r-${i + 1} が同じオブジェクト`);
      // 式の無害化を外した旨の警告 (件数だけ) が出る: r-4 の name と desc
      assert.ok(parse.issues.some((i) => i.code === 'quote-prefix-stripped'));
      // 9 桁座標・資産画像・{src,alt}・html・独自 property が残る
      assert.deepEqual(result.features[0].geometry.coordinates, [139.123456789, 35.123456789]);
      assert.deepEqual(result.features[1].properties.image, ['550e8400-e29b-41d4-a716-446655440000', 'https://example.com/2.jpg']);
      assert.deepEqual(result.features[2].properties.image, { src: 'https://example.com/3.jpg', alt: '三の写真' });
      assert.equal(result.features[3].properties.memo, 'm');
      assert.deepEqual(result.features[3].properties.html, { ja: '<p>x</p>' });
      assert.deepEqual(result.features[4].properties.desc, { ja: ' 前後に空白 ' });
    }
    // 陰性対照 A: r-3 の URL だけ変える
    {
      const { result } = run(csvText.replace('https://example.com/3.jpg', 'https://example.com/3b.jpg'));
      assert.equal(result.features[2].properties.image, 'https://example.com/3b.jpg');
      assert.equal(result.summary.updated, 1);
      assert.equal(result.summary.unchanged, 4);
      for (const i of [0, 1, 3, 4]) assert.equal(result.features[i], internal.features[i]);
    }
    // 陰性対照 B: r-2 の URL だけ変える -> [新URL, UUID]
    {
      const { result } = run(csvText.replace('https://example.com/2.jpg', 'https://example.com/2b.jpg'));
      assert.deepEqual(result.features[1].properties.image, ['https://example.com/2b.jpg', '550e8400-e29b-41d4-a716-446655440000']);
      assert.equal(result.summary.updated, 1);
    }
    // 陰性対照 C: セルが裸の UUID -> image-dropped・既存は変わらない
    {
      const { parse, result } = run(csvText.replace('https://example.com/2.jpg', '550e8400-e29b-41d4-a716-446655440000'));
      assert.ok(parse.issues.some((i) => i.code === 'image-dropped' && i.level === 'warning'));
      assert.equal(result.features[1], internal.features[1]);
      assert.equal(result.summary.unchanged, 5);
    }
    // 陰性対照 D: src に | を含む URL は書き出しで imageUnrepresentable・往復で unchanged
    {
      const withPipe = normalizePoiSourceCollection({
        type: 'FeatureCollection', lang: 'ja',
        features: [{ type: 'Feature', id: 'pp', geometry: { type: 'Point', coordinates: [1, 2] },
          properties: { name: 'パイプ', image: 'https://a.example/b|c.jpg' } }],
      }, 'ja');
      const out = buildPoiCsv(toExportForm(withPipe, 's', { ja: 't' }, { roundCoordinates: true, defaultLang: 'ja' }));
      assert.equal(out.omitted.imageUnrepresentable, 1);
      const parse = parseCsv(out.bytes);
      const result = plan(withPipe.features, parse, 'overwrite');
      assert.equal(result.features[0], withPipe.features[0]);
      assert.equal(result.summary.unchanged, 1);
    }
    console.log('  case 4 (往復と陰性対照 A〜D): PASS');
  }

  // --- AC6(8): 20,000 行の合流が 1 秒以内 ---
  {
    const n = 20000;
    const existing = Array.from({ length: n }, (_, i) => ({
      type: 'Feature', id: `id-${i}`, geometry: { type: 'Point', coordinates: [139 + (i % 100) / 1000, 35 + (i % 100) / 1000] },
      properties: { _maplatUid: `u-${i}`, name: { ja: `名${i}` }, desc: { ja: `説明${i}` } },
    }));
    const rows = Array.from({ length: n }, (_, i) => ({
      row: i + 1, line: i + 2, label: `id-${i}`, id: i % 2 ? `id-${i}` : `new-${i}`,
      coordinates: [139 + (i % 100) / 1000, 35 + (i % 100) / 1000], name: { ja: i % 3 ? `名${i}` : `新${i}` },
    }));
    const t0 = performance.now();
    const r = planPoiMerge({ existing, rows, mode: 'overwrite', defaultLang: 'ja' });
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `20,000 行の合流が ${ms.toFixed(0)} ms`);
    assert.equal(r.summary.added, n / 2);
    assert.equal(r.features.length, n + n / 2);
    const t1 = performance.now();
    planPoiMerge({ existing, rows, mode: 'append', defaultLang: 'ja' });
    assert.ok(performance.now() - t1 < 1000, '追記も 1 秒以内');
    console.log(`  case 5 (20,000 行 ${ms.toFixed(0)} ms): PASS`);
  }

  // --- AC9: 取り込みの取り消し (編集セッションの commit 1 回 = Undo 1 単位) ---
  {
    for (const mode of ['append', 'overwrite']) {
      const session = usePoiEditSession();
      const internal = normalizePoiSourceCollection(await readJson('merge-existing.json'), 'ja');
      session.load({ lang: 'ja', slug: 's', title: { ja: 't' }, fc: internal });
      const before = session.state.value.features.slice();
      assert.equal(session.isDirty.value, false);
      const result = plan(before, parseCsv(demoBytes), mode);
      session.commit((draft) => { draft.features = result.features; });
      assert.equal(session.isDirty.value, true);
      assert.equal(session.state.value.features.length, result.features.length);
      session.undo();
      assert.equal(session.state.value.features.length, before.length);
      before.forEach((f, i) => assert.equal(session.state.value.features[i], f, `${mode}: Undo 後の ${i} が同一`));
      assert.equal(session.isDirty.value, false);
      session.redo();
      result.features.forEach((f, i) => assert.equal(session.state.value.features[i], f, `${mode}: Redo 後の ${i} が同一`));
      // 下書きの復元: 取り込んだ状態から reset(…, true) しても取り込んだ状態
      const restored = usePoiEditSession();
      restored.reset({ ...session.state.value }, true);
      assert.equal(restored.state.value.features.length, result.features.length);
      assert.equal(restored.state.value.features.at(-1).id, result.features.at(-1).id);
    }
    console.log('  case 6 (取り込みの取り消し): PASS');
  }

  // --- 変異試験: 性質の検査が壊れた実装を検出する ---
  {
    const mutate = (fn) => (args) => fn(planPoiMerge(args), args);
    const mutants = {
      '上書きで _maplatUid を新規採番する': mutate((r, a) => ({
        ...r,
        features: r.features.map((f, i) => (a.mode === 'overwrite' && f.id === 'shrine-2'
          ? { ...f, properties: { ...f.properties, _maplatUid: 'regenerated' } } : f)),
      })),
      '追記で衝突を付け替えない': mutate((r) => ({
        ...r, features: r.features.map((f) => (f.id === 'shrine-2-2' ? { ...f, id: 'shrine-2' } : f)),
      })),
      '変化なしでも新しいオブジェクトを返す': mutate((r) => ({
        ...r, features: r.features.map((f) => structuredClone(f)),
      })),
      '空セルで消す': mutate((r, a) => ({
        ...r,
        features: r.features.map((f) => {
          if (a.mode !== 'overwrite' || f.id !== 'shrine-2') return f;
          const props = { ...f.properties }; delete props.address;
          return { ...f, properties: props };
        }),
      })),
      'image の資産要素を落とす': mutate((r) => ({
        ...r,
        features: r.features.map((f) => (f.id === 'temple-1' ? { ...f, properties: { ...f.properties, image: undefined } } : f)),
      })),
    };
    for (const [name, impl] of Object.entries(mutants)) {
      const problems = await checkDemo(impl);
      assert.ok(problems.length > 0, `変異「${name}」を検出できない`);
    }
    // 往復の変異: 変化なしでも新しいオブジェクトを返す実装は往復の === で落ちる
    const source = normalizePoiSourceCollection(await readJson('roundtrip-source.json'), 'ja');
    const csv = buildPoiCsv(toExportForm(source, 's', { ja: 't' }, { roundCoordinates: true, defaultLang: 'ja' }));
    const parse = parseCsv(csv.bytes);
    const broken = plan(source.features, parse, 'overwrite', mutate((r) => ({ ...r, features: r.features.map((f) => structuredClone(f)) })));
    assert.notEqual(broken.features[0], source.features[0]);
    console.log('  case 7 (変異試験 5 + 往復 1 を検出): PASS');
  }

  console.log('poi-merge smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
