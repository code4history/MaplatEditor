// POI の一括入出力 (取り込み) の smoke。
// - CSV の解析 (列の定義・数値・上限・警告) と、解析が出す issue の期待値
// - 取り込みの IPC 本体 (パスを受け取らない・拡張子・大きさ)
// - 新しいソースを作る取り込み (importFile) が解析と合流を共有して動く
// - 結線の静的検査 (ipc.handle・runGuarded・チャネル名・入口の置き場所・無効条件・確定時の再確認)
// - 文言: poiio の節に、データを指す名詞の「設定」相当の語が無い (11 言語の語で検査)
import { mkdir, mkdtemp, rm, readFile, readdir, writeFile, truncate } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = path.join(projectRoot, 'tests/fixtures/poi-io');
const read = (rel) => readFile(path.join(projectRoot, rel), 'utf8');
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'poi-import-'));

try {
  const ipcSrc = await read('electron/ipc/poisource.ts');
  const preloadSrc = await read('electron/preload.ts');
  const typesSrc = await read('src/electron.d.ts');
  const guardSrc = await read('scripts/oct26-m4-t2-ipc-guard-smoke.mjs');
  const editSrc = await read('src/views/PoiEdit.vue');

  // ---------- 静的検査の部品 ----------
  // ipc.handle('<channel>', …) の開始から対応する閉じ括弧までを取る (文字列・コメントを読み飛ばす)。
  // ハンドラが長くなっても窓が足りなくならない
  const extractHandler = (src, channel) => {
    const start = src.indexOf(`ipc.handle('${channel}'`);
    if (start < 0) return null;
    let depth = 0;
    let i = src.indexOf('(', start);
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
      if (c === "'" || c === '"' || c === '`') {
        const q = c;
        for (i += 1; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i += 1;
        continue;
      }
      if (c === '(') depth += 1;
      if (c === ')') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
    }
    return null;
  };
  const handlerUses = (src, channel, word) => {
    const handler = extractHandler(src, channel);
    return handler !== null && handler.includes(word);
  };
  // 開始タグ (属性値の引用符の中の > を読み飛ばす)
  const openTag = (src, marker) => {
    const at = src.indexOf(marker);
    if (at < 0) return null;
    const start = src.lastIndexOf('<button', at);
    let quote = '';
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') return { text: src.slice(start, i + 1), start, end: i };
    }
    return null;
  };
  const disabledExpr = (tag) => (tag.match(/:disabled="([^"]*)"/) ?? [])[1] ?? '';

  // ---------- 書き出しの IPC (PR-1) ----------
  {
    assert.match(ipcSrc, /ipc\.handle\(\s*'poisource:exportTable'/, 'poisource:exportTable が ipc.handle で登録されていない');
    assert.match(ipcSrc, /runGuarded\(\s*'poisource:exportTable'/, 'poisource:exportTable が runGuarded で包まれていない');
    assert.match(guardSrc, /"poisource:exportTable"/, 'ipc-guard smoke の列挙に poisource:exportTable がない');
    assert.match(preloadSrc, /exportTable:\s*\(uid: string, format: 'csv' \| 'json'\)\s*=>\s*ipcRenderer\.invoke\('poisource:exportTable', uid, format\)/);
    assert.match(typesSrc, /exportTable\(uid: string, format: 'csv' \| 'json'\): Promise<PoiExportTableResult>/);
    const sig = typesSrc.match(/exportTable\(([^)]*)\)/);
    assert.ok(sig, 'exportTable の型がない');
    assert.doesNotMatch(sig[1], /path|file/i, 'exportTable の引数にパスがある');
    const handler = extractHandler(ipcSrc, 'poisource:exportTable');
    assert.ok(handler, 'exportTable のハンドラを取り出せない');
    assert.match(handler, /\(event, uid, format\)/, 'ハンドラの引数は (event, uid, format) だけ');
    assert.ok(handler.includes('showSaveDialog'), '保存先を保存ダイアログから得ていない');
    console.log('  case a (書き出しの IPC の結線): PASS');
  }

  // ---------- AC16(e): ハンドラの窓の変異試験 ----------
  {
    const padded = (body) => `ipc.handle('x:y', (event, uid, format) => {\n${'  // 長いハンドラの注記 ) ( } {\n'.repeat(300)}  const s = "文字列の ) ( 括弧";\n${body}\n});\nipc.handle('z', () => 1);`;
    assert.equal(handlerUses(padded('  dialog.showSaveDialog(options);'), 'x:y', 'showSaveDialog'), true, 'ハンドラを長くしても検査が通る');
    assert.equal(handlerUses(padded('  return null;'), 'x:y', 'showSaveDialog'), false, 'showSaveDialog が無いハンドラでは落ちる');
    // 次のハンドラの showSaveDialog を拾わない
    const two = `ipc.handle('a:a', () => { return 1; });\nipc.handle('b:b', () => { dialog.showSaveDialog(o); });`;
    assert.equal(handlerUses(two, 'a:a', 'showSaveDialog'), false);
    assert.equal(handlerUses(two, 'b:b', 'showSaveDialog'), true);
    console.log('  case b (ハンドラの窓の検査に変異を当てる): PASS');
  }

  // ---------- 取り込みの IPC の結線 (AC7) ----------
  {
    assert.match(ipcSrc, /ipc\.handle\(\s*'poisource:pickAndParseMerge'/, 'pickAndParseMerge が ipc.handle で登録されていない');
    assert.match(ipcSrc, /runGuarded\(\s*'poisource:pickAndParseMerge'/, 'pickAndParseMerge が runGuarded で包まれていない');
    assert.match(guardSrc, /"poisource:pickAndParseMerge"/, 'ipc-guard smoke の列挙に pickAndParseMerge がない');
    assert.match(preloadSrc, /pickAndParseMerge:\s*\(input: \{ lang: string \}\)\s*=>\s*ipcRenderer\.invoke\('poisource:pickAndParseMerge', input\)/);
    assert.match(typesSrc, /pickAndParseMerge\(input: \{ lang: string \}\): Promise<PoiPickAndParseMergeResult>/);
    // 引数と戻り値の型に path が無い
    const rowsSrc = await read('src/utils/poiImportRows.ts');
    const typeBlock = (source, name) => {
      const at = source.indexOf(`export ${name}`);
      assert.ok(at >= 0, `${name} の型がない`);
      const end = source.indexOf('\nexport ', at + 1);
      return source.slice(at, end < 0 ? undefined : end);
    };
    assert.doesNotMatch(typeBlock(typesSrc, 'type PoiPickAndParseMergeResult'), /\b(path|filePath)\b/i, 'PoiPickAndParseMergeResult にパスがある');
    for (const name of ['interface PoiImportParseResult', 'interface PoiImportRow', 'interface PoiImportIssue']) {
      assert.doesNotMatch(typeBlock(rowsSrc, name), /\b(path|filePath)\b/i, `${name} にパスがある`);
    }
    const handler = extractHandler(ipcSrc, 'poisource:pickAndParseMerge');
    assert.ok(handler, 'pickAndParseMerge のハンドラを取り出せない');
    assert.match(handler, /\(event, input\)/, 'ハンドラの引数は (event, input) だけ');
    assert.ok(handler.includes('showOpenDialog'), '選択をダイアログから得ていない');
    assert.ok(handler.includes("dialogDefaultPath('import'"), "取り込みの選択は dialogDefaultPath('import') を使う");
    assert.ok(handler.includes("rememberDialogPath('import'"), "取り込みの選択は rememberDialogPath('import') で記憶する");
    // main の取り込み部は renderer へパスを返さない
    const svc = await read('electron/services/PoiTableIoService.ts');
    assert.doesNotMatch(svc.slice(svc.indexOf('pickAndParsePoiMerge')), /filePath:\s*(?!picked)/);
    console.log('  case c (取り込みの IPC の結線・パスを受け取らない・返さない): PASS');
  }

  // ---------- AC16(a)(c)(d): 入口の置き場所と無効条件 ----------
  {
    const exportTag = openTag(editSrc, 'data-editor-action="poi-export-table"');
    const importTag = openTag(editSrc, 'data-editor-action="poi-merge-import"');
    assert.ok(exportTag, '書き出しのボタンがない');
    assert.ok(importTag, '取り込みのボタンがない');
    // (a) 同じ行 (同じ div) にあり、取り込みが左。ヘッダの #actions には足されていない
    const rowStart = editSrc.lastIndexOf('<div', exportTag.start);
    const rowEnd = editSrc.indexOf('</div>', exportTag.end);
    assert.ok(importTag.start > rowStart && importTag.end < rowEnd, '2 つのボタンが同じ行にない');
    assert.ok(importTag.start < exportTag.start, '取り込みが書き出しの左にない');
    const actionsAt = editSrc.indexOf('<template #actions');
    const actionsEnd = editSrc.indexOf('</template>', actionsAt);
    assert.ok(actionsAt >= 0 && actionsEnd > actionsAt);
    const actions = editSrc.slice(actionsAt, actionsEnd);
    assert.ok(!actions.includes('poi-merge-import') && !actions.includes('poi-export-table'), 'ヘッダの #actions に足してはいけない');
    // (c) 書き出しの無効条件に saving
    const exportDisabled = disabledExpr(exportTag.text);
    assert.match(exportDisabled, /\bsaving\b/, '書き出しの :disabled に saving がない');
    // (d) 取り込みの無効条件
    const importDisabled = disabledExpr(importTag.text);
    for (const word of ['readOnly', 'translationMode', 'saving', 'importing', 'exporting', 'cloning']) {
      assert.match(importDisabled, new RegExp(`\\b${word}\\b`), `取り込みの :disabled に ${word} がない`);
    }
    // 変異: saving を外した式では落ちる
    assert.doesNotMatch(exportDisabled.replace(/saving\s*\|\|\s*/, ''), /\bsaving\b/);
    console.log('  case d (入口の置き場所と無効条件): PASS');
  }

  // ---------- 確定時の再確認 (r5 Minor-3) ----------
  {
    const at = editSrc.indexOf('function onMergeImportSubmit');
    assert.ok(at >= 0, 'onMergeImportSubmit がない');
    const rest = editSrc.slice(at + 10);
    const next = rest.search(/\n(?:async )?function /);
    const body = editSrc.slice(at, next < 0 ? undefined : at + 10 + next);
    for (const word of ['saving.value', 'readOnly.value', 'translationMode.value', 'loadGeneration']) {
      assert.ok(body.includes(word), `確定時に ${word} を確かめ直していない`);
    }
    assert.ok(body.includes('planPoiMerge'), '確定時に現在の features で合流を計算し直していない');
    assert.ok(body.includes('session.commit'), '確定が session.commit 1 回でない');
    const dialogSrc = await read('src/components/PoiMergeImportDialog.vue');
    assert.match(dialogSrc, /ref<PoiMergeMode>\('append'\)/, '初期選択が追記でない');
    console.log('  case e (確定時の再確認・初期選択は追記): PASS');
  }

  // ---------- 解析と IPC 本体 (バンドル) ----------
  const entry = path.join(workDir, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiImportRows.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'src/utils/poiMerge.ts'))};`,
      `export * from ${JSON.stringify(path.join(projectRoot, 'electron/services/PoiTableIoService.ts'))};`,
    ].join('\n'),
  );
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: { outDir: path.join(workDir, 'dist'), emptyOutDir: true, ssr: entry, rollupOptions: { output: { entryFileNames: 'bundle.mjs', format: 'es' } } },
    ssr: { noExternal: true },
  });
  const mod = await import(pathToFileURL(path.join(workDir, 'dist/bundle.mjs')).href);
  const { parsePoiImportFile, planPoiMerge, pickAndParsePoiMerge } = mod;
  const enc = (s) => new TextEncoder().encode(s);
  const parse = (text, defaultLang = 'ja') => parsePoiImportFile({ format: 'csv', bytes: typeof text === 'string' ? enc(text) : text, defaultLang });
  const keyOf = (i) => `${i.line}:${i.code}:${i.level}`;
  const codes = (r) => r.issues.map((i) => i.code);

  // ---------- AC4: デモ B の解析 ----------
  {
    const bytes = new Uint8Array(await readFile(path.join(fixtureDir, 'demo-errors.csv')));
    const r = parse(bytes);
    assert.equal(r.fatal, false);
    assert.equal(r.format, 'csv');
    assert.equal(r.encoding, 'utf-8');
    assert.equal(r.totalRecords, 7);
    assert.deepEqual(r.issues.map(keyOf).sort(), [
      '3:coord-range:error',
      '4:coordinate-partial:warning', // a-3 は lng だけに値がある (設計 §4.9 の警告。AC4 の表からは漏れていた)
      '5:file-duplicate-id:error',
      '6:display-id-charset:error',
      '7:image-dropped:warning',
    ]);
    assert.deepEqual(r.rows.map((x) => x.line), [2, 4, 7, 8]);
    assert.equal(r.rows[1].coordinates, null, '座標が空の行は coordinates: null で合流へ渡す');
    const swapped = r.issues.find((i) => i.code === 'coord-range');
    assert.equal(swapped.swapped, true, '緯度と経度が逆では、の案内');
    assert.ok(!codes(r).includes('name-required') && !codes(r).includes('coord-missing'), '解析は合流の責務の issue を出さない');
    // 合流 (追記) で増える issue: 行 4 coord-missing・行 8 name-required。取り込まれるのは行 2 と 7
    const plan = planPoiMerge({ existing: [], rows: r.rows, mode: 'append', defaultLang: 'ja' });
    assert.deepEqual(plan.issues.map(keyOf).sort(), ['4:coord-missing:error', '8:name-required:error']);
    assert.equal(plan.features.length, 2);
    assert.equal(r.totalRecords - plan.features.length, 5, '除かれるのは 5 件');
    console.log('  case f (AC4: デモ B の解析と合流): PASS');
  }

  // ---------- AC4: 列の定義 ----------
  {
    // 別名・NFKC・大文字小文字
    const r = parse('ID,名称,説明,住所,画像,緯度,経度\r\na,n,d,ad,https://x/1.jpg,35.5,139.5\r\n');
    assert.deepEqual(r.columns, ['id', 'name', 'desc', 'address', 'image', 'lat', 'lng']);
    assert.deepEqual(r.rows[0].name, { ja: 'n' });
    assert.deepEqual(r.rows[0].image, ['https://x/1.jpg']);
    assert.deepEqual(r.rows[0].coordinates, [139.5, 35.5]);
    const r2 = parse('ＩＤ, Ｎａｍｅ ,Latitude,Lon\r\nb,x,1,2\r\n');
    assert.deepEqual(r2.columns, ['id', 'name', 'lat', 'lng']);
    assert.deepEqual(parse('識別子,名前,description,表示id,lat,long\r\n').fatal, true, '別名が重なれば duplicate-column');
    assert.equal(parse('識別子,名前,description,lat,long\r\n').fatal, false);
    // 言語つきの列
    const r3 = parse('id,name,name:EN,name:zh-tw,desc:ko,address:xx,lat,lng\r\na,あ,A,甲,설명,x,1,2\r\n');
    assert.deepEqual(r3.columns, ['id', 'name', 'name:en', 'name:zh-TW', 'desc:ko', 'lat', 'lng']);
    assert.deepEqual(r3.rows[0].name, { ja: 'あ', en: 'A', 'zh-TW': '甲' });
    assert.deepEqual(r3.rows[0].desc, { ko: '설명' });
    const ign = r3.issues.find((i) => i.code === 'ignored-columns');
    assert.ok(ign && ign.level === 'warning' && String(ign.value ?? ign.column).includes('address:xx'));
    // 既定言語を変えると言語なしの列の言語が変わる
    assert.deepEqual(parse('id,name,lat,lng\r\na,Name,1,2\r\n', 'en').rows[0].name, { en: 'Name' });
    // duplicate-column
    for (const header of ['id,name,名称,lat,lng', 'id,name,name:ja,lat,lng', 'id,lat,lng,LAT']) {
      const bad = parse(header + '\r\n');
      assert.equal(bad.fatal, true, header);
      assert.ok(codes(bad).includes('duplicate-column'), header);
      assert.deepEqual(bad.rows, []);
    }
    assert.equal(parse('id,name,name:ja,lat,lng\r\n', 'en').fatal, false, '既定言語が en なら name と name:ja は別の列');
    // 座標の列
    for (const header of ['id,name,lat', 'id,name,lng', 'name,緯度']) {
      const bad = parse(header + '\r\n');
      assert.equal(bad.fatal, true, header);
      assert.ok(codes(bad).includes('incomplete-coordinate-columns'), header);
    }
    const missing = parse('name,desc\r\nx,y\r\n');
    assert.equal(missing.fatal, true);
    assert.ok(codes(missing).includes('missing-columns'));
    const idOnly = parse('id,name\r\nx,y\r\n');
    assert.equal(idOnly.fatal, false, 'id の列があれば座標の列が無くてもよい');
    assert.equal(idOnly.rows[0].coordinates, null);
    // 見出しだけ・空
    assert.equal(parse('id,name,lat,lng\r\n').fatal, false);
    assert.deepEqual(parse('id,name,lat,lng\r\n').rows, []);
    assert.equal(parse('').fatal, true);
    // 見出しの BOM の除去
    const withBom = parse(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('id,name,lat,lng\r\nz,n,1,2\r\n')]));
    assert.equal(withBom.encoding, 'utf-8-bom');
    assert.deepEqual(withBom.columns, ['id', 'name', 'lat', 'lng']);
    // __proto__・constructor の見出しは無害
    const proto = parse('__proto__,constructor,name,lat,lng\r\nx,y,n,1,2\r\n');
    assert.equal(proto.fatal, false);
    assert.deepEqual(proto.columns, ['name', 'lat', 'lng']);
    assert.ok(codes(proto).includes('ignored-columns'));
    assert.equal({}.x, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'x'), false);
    assert.equal(Object.keys(proto.rows[0]).includes('__proto__'), false);
    // ピクセル座標は取り込まず警告
    const px = parse('id,name,lat,lng,x,Y,pixel_x\r\na,n,1,2,10,20,30\r\n');
    assert.ok(px.issues.some((i) => i.code === 'pixel-coordinates-ignored' && i.level === 'warning'));
    assert.ok(!px.columns.includes('x'));
    console.log('  case g (AC4: 列の定義): PASS');
  }

  // ---------- AC4: 数値・値の形・警告 ----------
  {
    const coord = (lat, lng) => parse(`id,name,lat,lng\r\na,n,${lat},${lng}\r\n`);
    const ok = (lat, lng, expected) => {
      const r = coord(lat, lng);
      assert.deepEqual(r.rows[0]?.coordinates, expected, `${lat},${lng}`);
      assert.ok(!r.issues.some((i) => i.level === 'error'), `${lat},${lng}`);
    };
    ok('35.6', '139.7', [139.7, 35.6]);
    ok('+35.6', '-139.7', [-139.7, 35.6]);
    ok('３５．６', '１３９．７', [139.7, 35.6]); // 全角
    ok('−35.6', '139.7', [139.7, -35.6]); // U+2212
    ok('90', '180', [180, 90]);
    ok('-90.0', '-180.0', [-180, -90]);
    for (const [lat, lng] of [['1e2', '2'], ['"35,6"', '139'], ['35°', '139'], ['35度', '139'], ['abc', '1'], ['1', '1.'], ['.5', '1'], ['1 2', '3']]) {
      const r = coord(lat, lng);
      assert.deepEqual(r.issues.map((i) => i.code), ['coord-format'], `${lat},${lng}`);
      assert.deepEqual(r.rows, [], '値の形の誤りの行は除く');
    }
    const range = coord('90.1', '10');
    assert.deepEqual(range.issues.map((i) => i.code), ['coord-range']);
    assert.equal(coord('10', '180.1').issues[0].code, 'coord-range');
    assert.equal(coord('10', '180.1').issues[0].swapped, undefined);
    assert.equal(coord('139.7', '35.6').issues[0].swapped, true);
    // 片方だけの座標
    const partial = parse('id,name,lat,lng\r\na,n,35.5,\r\nb,n,,139.5\r\nc,n,,\r\n');
    assert.deepEqual(partial.issues.map(keyOf), ['2:coordinate-partial:warning', '3:coordinate-partial:warning']);
    assert.deepEqual(partial.rows.map((x) => x.coordinates), [null, null, null]);
    // 列の数
    const cc = parse('id,name,lat,lng\r\na,b,1\r\nc,d,1,2,3\r\ne,f,1,2\r\n');
    assert.deepEqual(cc.issues.map(keyOf), ['2:column-count:error', '3:column-count:error']);
    assert.deepEqual(cc.rows.map((x) => x.id), ['e']);
    // 表示 ID
    const ids = parse('id,name,lat,lng\r\nok_1-A,n,1,2\r\nあ,n,1,2\r\na.b,n,1,2\r\n,n,1,2\r\n');
    assert.deepEqual(ids.issues.map(keyOf), ['3:display-id-charset:error', '4:display-id-charset:error']);
    assert.deepEqual(ids.rows.map((x) => x.id), ['ok_1-A', '']);
    // 大文字小文字を区別する重複判定
    assert.deepEqual(parse('id,name,lat,lng\r\nA,n,1,2\r\na,n,1,2\r\nA,n,1,2\r\n').issues.map(keyOf), ['4:file-duplicate-id:error']);
    // 先に出た行が誤りなら、後の同じ id は重複にならない
    const firstBad = parse('id,name,lat,lng\r\nx,n,abc,2\r\nx,n,1,2\r\n');
    assert.deepEqual(firstBad.issues.map(keyOf), ['2:coord-format:error']);
    assert.deepEqual(firstBad.rows.map((x) => x.line), [3]);
    // 文字列セル: trim しない。name は空白だけなら空と同じ。改行は \n へ
    const strings = parse('id,name,desc,address,lat,lng\r\na,   ,"  x\r\ny\rz  ", ,1,2\r\n');
    assert.equal(strings.rows[0].name, undefined);
    assert.deepEqual(strings.rows[0].desc, { ja: '  x\ny\nz  ' });
    assert.deepEqual(strings.rows[0].address, { ja: ' ' });
    // 空セルと列なしを区別しない: キーが無い
    const empty = parse('id,name,desc,image,lat,lng\r\na,,,,,\r\n');
    assert.deepEqual(Object.keys(empty.rows[0]).sort(), ['coordinates', 'id', 'label', 'line', 'row'].sort());
    // image: | 区切り・前後の空白を除く・空の要素は捨てる・http(s)/相対以外は捨てて警告
    const img = parse('id,name,image,lat,lng\r\na,n," https://x/1.jpg | ./rel.png ||/abs.png ",1,2\r\nb,n,javascript:alert(1)|data:text/plain,1,2\r\nc,n,550e8400-e29b-41d4-a716-446655440000,1,2\r\n');
    assert.deepEqual(img.rows[0].image, ['https://x/1.jpg', './rel.png', '/abs.png']);
    assert.equal(img.rows[1].image, undefined);
    assert.equal(img.rows[2].image, undefined);
    assert.deepEqual(img.issues.map(keyOf), ['3:image-dropped:warning', '4:image-dropped:warning']);
    // 式の無害化の取り消しと警告 (件数だけ)
    const q = parse("id,name,desc,address,image,lat,lng\r\nx1,'-1,'+2,'@3,'=x,1,2\r\nx2,''=b,n,d,,1,2\r\nx3,'n,n,n,,1,2\r\n");
    assert.deepEqual(q.rows[0].name, { ja: '-1' });
    assert.deepEqual(q.rows[0].desc, { ja: '+2' });
    assert.deepEqual(q.rows[0].address, { ja: '@3' });
    assert.deepEqual(q.rows[0].image, ['=x']);
    assert.deepEqual(q.rows[1].name, { ja: "'=b" });
    assert.deepEqual(q.rows[2].name, { ja: "'n" }, '式の記号が続かない先頭の \' は剥がさない');
    const stripped = q.issues.filter((i) => i.code === 'quote-prefix-stripped');
    assert.equal(stripped.length, 1, '警告は件数だけを 1 件');
    assert.equal(stripped[0].level, 'warning');
    assert.equal(stripped[0].message, '5');
    // lat・lng には無害化を戻さない (数値の列)
    assert.equal(parse("id,name,lat,lng\r\na,n,'+1,2\r\n").issues[0].code, 'coord-format');
    console.log('  case h (AC4: 値の形・警告): PASS');
  }

  // ---------- AC4: 上限 ----------
  {
    const many = 'id,name,lat,lng\r\n' + Array.from({ length: 20001 }, (_, i) => `i${i},n,1,2`).join('\r\n') + '\r\n';
    const r = parse(many);
    assert.equal(r.fatal, true);
    assert.ok(codes(r).includes('too-many-rows'));
    assert.deepEqual(r.rows, []);
    const exact = parse('id,name,lat,lng\r\n' + Array.from({ length: 20000 }, (_, i) => `i${i},n,1,2`).join('\r\n') + '\r\n');
    assert.equal(exact.fatal, false);
    assert.equal(exact.rows.length, 20000);
    const big = parse(`id,name,lat,lng\r\na,${'あ'.repeat(1024 * 1024 + 1)},1,2\r\nb,ok,1,2\r\n`);
    assert.deepEqual(big.issues.map(keyOf), ['2:cell-too-large:error']);
    assert.deepEqual(big.rows.map((x) => x.id), ['b']);
    // 文字コード・構造の致命的な誤り
    const unterminated = parse('id,name,lat,lng\r\na,"x,1,2\r\n');
    assert.equal(unterminated.fatal, true);
    assert.ok(codes(unterminated).includes('csv-unterminated-quote'));
    assert.ok(codes(parse(Uint8Array.from([0xff, 0xfe, 0x69, 0x00]))).includes('encoding-unsupported'));
    assert.ok(codes(parse(enc('id,name\u0000'))).includes('not-text'));
    assert.equal(parse(Uint8Array.from([0xff, 0xfe, 0x69, 0x00])).encoding, null);
    console.log('  case i (AC4: 上限・致命的な誤り): PASS');
  }

  // ---------- AC7(c)(d): 取り込みの IPC 本体 ----------
  {
    const dir = path.join(workDir, 'files');
    await mkdir(dir, { recursive: true });
    const fileOk = path.join(dir, 'shrines.csv');
    await writeFile(fileOk, 'id,name,lat,lng\r\na,n,1,2\r\n');
    const calls = [];
    const picker = (target) => async () => { calls.push('pick'); return target; };
    const run = (input, target) => pickAndParsePoiMerge({ input, pickOpenPath: picker(target) });

    for (const bad of [{ lang: 'xx' }, { lang: '' }, { lang: 123 }, {}, null, 'ja', undefined]) {
      calls.length = 0;
      const r = await run(bad, fileOk);
      assert.deepEqual({ result: r.result, code: r.code }, { result: 'Error', code: 'invalid-request' }, JSON.stringify(bad));
      assert.equal(calls.length, 0, '不正な引数ではダイアログも開かない');
    }
    assert.deepEqual(await run({ lang: 'ja' }, null), { result: 'Canceled' });
    const parsed = await run({ lang: 'ja' }, fileOk);
    assert.equal(parsed.result, 'Parsed');
    assert.equal(parsed.fileName, 'shrines.csv');
    assert.equal(parsed.parse.rows.length, 1);
    assert.ok(!JSON.stringify(parsed).includes(dir), '戻り値にパスを含めない');
    // 言語なしの列は渡した言語の値
    const en = await run({ lang: 'en' }, fileOk);
    assert.deepEqual(en.parse.rows[0].name, { en: 'n' });
    // 拡張子
    const mk = async (name, content = 'x') => { const p = path.join(dir, name); await writeFile(p, content); return p; };
    assert.equal((await run({ lang: 'ja' }, await mk('a.kmz'))).code, 'kmz-unsupported');
    assert.equal((await run({ lang: 'ja' }, await mk('a.kmz', '<kml/>'))).code, 'kmz-unsupported', '.kmz は .kml の判定より先に断る');
    const kml = await run({ lang: 'ja' }, path.join(fixtureDir, 'demo.kml'));
    assert.equal(kml.result, 'Parsed');
    assert.equal(kml.fileName, 'demo.kml');
    assert.equal(kml.parse.format, 'kml');
    assert.equal(kml.parse.rows.length, 2);
    assert.ok(!JSON.stringify(kml).includes(fixtureDir), 'KML の戻り値にもパスを含めない');
    const badKml = await run({ lang: 'ja' }, await mk('bad.kml', '<kml><Placemark>'));
    assert.equal(badKml.result, 'Parsed');
    assert.equal(badKml.parse.fatal, true);
    assert.equal((await run({ lang: 'ja' }, await mk('a.txt'))).code, 'unsupported-extension');
    assert.equal((await run({ lang: 'ja' }, await mk('noext'))).code, 'unsupported-extension');
    assert.equal((await run({ lang: 'ja' }, await mk('UPPER.CSV', 'id,name,lat,lng\r\n'))).result, 'Parsed');
    // 大きさ
    const huge = path.join(dir, 'huge.csv');
    await writeFile(huge, '');
    await truncate(huge, 20 * 1024 * 1024 + 1);
    assert.equal((await run({ lang: 'ja' }, huge)).code, 'file-too-large');
    const missing = await run({ lang: 'ja' }, path.join(dir, 'none.csv'));
    assert.equal(missing.code, 'read-failed');
    assert.ok(!String(missing.message ?? '').includes(dir), 'システムのエラー文 (パス入り) を載せない');
    // 11 言語はすべて受ける
    for (const lang of ['ja', 'en', 'de', 'fr', 'es', 'ko', 'zh', 'zh-TW', 'vi', 'th', 'id']) {
      assert.equal((await run({ lang }, fileOk)).result, 'Parsed', lang);
    }
    console.log('  case j (AC7: 取り込みの IPC 本体): PASS');
  }

  // ---------- AC15: 新しいソースを作る取り込み ----------
  {
    const svc = await read('electron/services/PoiSourceService.ts');
    const importAt = svc.indexOf('async importFile(');
    // importFile と、その .csv の分岐が呼ぶ importCsvFile (次のメソッドの前まで)
    const importBody = svc.slice(importAt, svc.indexOf('async createPoiSourceFromManagedDocument(', importAt));
    assert.ok(importBody.includes('.csv') && importBody.includes('.kml'), 'importFile に .csv・.kml の分岐がない');
    assert.ok(importBody.includes('importTableFile('), 'importFile が importTableFile を呼んでいない');
    assert.ok(importBody.includes('parsePoiImportBytes('), 'importTableFile が parsePoiImportBytes を呼んでいない');
    assert.doesNotMatch(importBody, /\bparsePoiImportFile\(|\bparsePoiKml\(/, '解析は parsePoiImportBytes だけを呼ぶ');
    assert.ok(importBody.includes('planPoiMerge('), 'importFile が planPoiMerge を呼んでいない');
    assert.doesNotMatch(importBody, /split\(\s*['"],['"]/, 'importFile に独自の CSV 解析 (split(",")) がある');
    const detectAt = svc.indexOf('async detectImportLanguage(');
    const detectBody = svc.slice(detectAt, svc.indexOf('// 明示再取得', detectAt));
    assert.ok(detectBody.indexOf('.csv') >= 0 && detectBody.indexOf('.csv') < detectBody.indexOf('JSON.parse'), 'detectImportLanguage が .csv で JSON.parse の前に返していない');
    assert.ok(detectBody.indexOf('.kml') >= 0 && detectBody.indexOf('.kml') < detectBody.indexOf('JSON.parse'), 'detectImportLanguage が .kml で JSON.parse の前に返していない');
    const pickAt = ipcSrc.indexOf("'poisource:pickImportFile'");
    assert.match(ipcSrc.slice(pickAt, pickAt + 700), /extensions:\s*\['geojson', 'json', 'zip', 'csv', 'kml'\]/, 'pickImportFile の拡張子が geojson・json・zip・csv・kml の完全一致でない');

    // 実行 (c): 実物の PoiSourceService を SQLite に向けて動かす (同種の smoke の方式)
    const stubDir = path.join(workDir, 'svc');
    await mkdir(path.join(stubDir, 'data'), { recursive: true });
    const electronStub = path.join(stubDir, 'electron-stub.ts');
    const storeStub = path.join(stubDir, 'electron-store-stub.ts');
    const childEntry = path.join(stubDir, 'child.ts');
    await writeFile(electronStub, `
      export const app = {
        getPath(name: string) { return ${JSON.stringify(stubDir)}; },
        getName() { return 'MaplatEditor'; },
        whenReady() { return Promise.resolve(); },
        exit() {},
      };
      export const dialog = { showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); }, showMessageBox() { return Promise.resolve({ response: 0 }); } };
      export const ipcMain = { handle() {} };
      export const BrowserWindow = class { static getAllWindows() { return []; } };
    `);
    await writeFile(storeStub, `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) { this.store = { ...(options.defaults || {}) } as T; }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `);
    await writeFile(childEntry, `
      import assert from 'node:assert/strict';
      const { default: SettingsService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SettingsService.ts'))});
      SettingsService.set('saveFolder', ${JSON.stringify(path.join(stubDir, 'data'))});
      SettingsService.set('lang', 'ja');
      const { default: SqliteDataService } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/SqliteDataService.ts'))});
      const { default: service } = await import(${JSON.stringify(path.join(projectRoot, 'electron/services/PoiSourceService.ts'))});
      await SqliteDataService.getDb();
      const fx = (name: string) => ${JSON.stringify(fixtureDir + '/')} + name;
      const keys = (issues: any[]) => issues.map((i) => i.code + ':' + i.level);

      // (b) detectImportLanguage は CSV で投げない
      assert.equal(await service.detectImportLanguage(fx('names-utf8.csv'), 'en'), 'en');
      assert.equal(await service.detectImportLanguage(fx('names-utf8.csv')), 'ja');

      // (c) §8.1 の CSV: temple-1 の行が新しい POI の必須を満たさない -> 全件か拒否
      const merge = await service.importFile({ slug: 'csv-merge', title: { ja: 'm' }, filePath: fx('demo-merge.csv'), lang: 'ja' });
      assert.equal(merge.result, 'Invalid', JSON.stringify(merge));
      assert.ok(keys(merge.issues).includes('name-required:error'));
      assert.ok(keys(merge.issues).includes('coord-missing:error'));
      assert.equal(await service.get('csv-merge'), null, 'Invalid では行を残さない');

      // §8.2 の CSV: Invalid で issues が parse.issues + plan.issues
      const errors = await service.importFile({ slug: 'csv-errors', title: { ja: 'e' }, filePath: fx('demo-errors.csv'), lang: 'ja' });
      assert.equal(errors.result, 'Invalid');
      const got = keys(errors.issues).sort();
      for (const k of ['coord-range:error', 'file-duplicate-id:error', 'display-id-charset:error', 'image-dropped:warning', 'coord-missing:error', 'name-required:error']) {
        assert.ok(got.includes(k), k + ' が無い: ' + got.join(','));
      }
      assert.equal(errors.issues.find((i: any) => i.code === 'coord-range').line, 3);

      // 致命的な構造の誤り
      const fatalCsv = await service.importFile({ slug: 'csv-fatal', title: { ja: 'f' }, filePath: ${JSON.stringify(path.join(workDir, 'fatal.csv'))}, lang: 'ja' });
      assert.equal(fatalCsv.result, 'Invalid');
      assert.ok(keys(fatalCsv.issues).includes('missing-columns:error'));

      // 有効な CSV (§8.3): 3 つの文字コードとも Success・名前は同じ
      for (const [slug, file] of [['csv-bom', 'names-utf8bom.csv'], ['csv-utf8', 'names-utf8.csv'], ['csv-sjis', 'names-sjis.csv']] as const) {
        const ok = await service.importFile({ slug, title: { ja: slug }, filePath: fx(file), lang: 'ja' });
        assert.equal(ok.result, 'Success', file + ' ' + JSON.stringify(ok));
        const detail = await service.get(ok.uid);
        assert.equal(detail.featureCount, 1);
        assert.deepEqual(detail.fc.features[0].properties.name, { ja: '日本橋' }, file);
        assert.equal(detail.fc.features[0].id, 'j-1');
        assert.deepEqual(detail.fc.features[0].geometry.coordinates, [139.7745, 35.684]);
        assert.match(detail.fc.features[0].properties._maplatUid, /^[0-9a-f-]{36}$/);
      }
      // KML (AC15 の KML 版): デモ D は経緯度が逆の Point があり Invalid。有効な KML は Success。壊れた KML は Invalid
      assert.equal(await service.detectImportLanguage(fx('demo.kml'), 'en'), 'en');
      assert.equal(await service.detectImportLanguage(fx('demo.kml')), 'ja');
      const kmlBad = await service.importFile({ slug: 'kml-demo', title: { ja: 'k' }, filePath: fx('demo.kml'), lang: 'ja' });
      assert.equal(kmlBad.result, 'Invalid', JSON.stringify(kmlBad).slice(0, 300));
      assert.ok(keys(kmlBad.issues).includes('coord-range:error'));
      assert.equal(await service.get('kml-demo'), null, 'Invalid では行を残さない');
      const kmlOk = await service.importFile({ slug: 'kml-ok', title: { ja: 'k' }, filePath: ${JSON.stringify(path.join(workDir, 'valid.kml'))}, lang: 'ja' });
      assert.equal(kmlOk.result, 'Success', JSON.stringify(kmlOk).slice(0, 300));
      const kmlDetail = await service.get(kmlOk.uid);
      assert.equal(kmlDetail.featureCount, 2);
      assert.deepEqual(kmlDetail.fc.features[0].properties.name, { ja: '浅草寺', en: 'Sensoji' });
      assert.deepEqual(kmlDetail.fc.features[0].geometry.coordinates, [139.7967, 35.7148]);
      assert.equal(kmlDetail.fc.features[0].id, 'kml-1');
      const kmlBroken = await service.importFile({ slug: 'kml-broken', title: { ja: 'k' }, filePath: ${JSON.stringify(path.join(workDir, 'broken.kml'))}, lang: 'ja' });
      assert.equal(kmlBroken.result, 'Invalid');
      assert.ok(keys(kmlBroken.issues).includes('kml-not-xml:error'));
      // 既存の GeoJSON の取り込みは変わらない
      const missingExt = await service.importFile({ slug: 'x', title: { ja: 'x' }, filePath: '/tmp/a.txt' });
      assert.equal(missingExt.result, 'Error');
      console.log('poi-import service child: PASS');
    `);
    await writeFile(path.join(workDir, 'fatal.csv'), 'name,desc\r\nx,y\r\n');
    // 有効な KML (デモ D から経緯度が逆の Placemark を除いたもの) と壊れた KML
    const demoKml = await readFile(path.join(fixtureDir, 'demo.kml'), 'utf8');
    await writeFile(path.join(workDir, 'valid.kml'), demoKml.replace(/ <Placemark><name>経緯度が逆<\/name>.*<\/Placemark>\n/, ''));
    await writeFile(path.join(workDir, 'broken.kml'), '<kml><Placemark><name>x</kml>');
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: [{ find: 'electron', replacement: electronStub }, { find: 'electron-store', replacement: storeStub }] },
      build: {
        emptyOutDir: true,
        outDir: path.join(stubDir, 'dist'),
        ssr: childEntry,
        target: 'node22',
        rollupOptions: { external: ['jimp'], output: { entryFileNames: 'child.mjs', format: 'es' } },
      },
    });
    const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(stubDir, 'dist/child.mjs')], {
      cwd: projectRoot, timeout: 120000, maxBuffer: 1024 * 1024 * 8,
    });
    process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    console.log('  case k (AC15: 新しいソースを作る取り込み): PASS');
  }

  // ---------- AC18: PR-3 の結線 ----------
  {
    const listFiles = async (dir) => {
      const out = [];
      for (const entry of await readdir(path.join(projectRoot, dir), { withFileTypes: true, recursive: true })) {
        if (entry.isFile() && /\.(ts|vue|mjs)$/.test(entry.name)) out.push(path.join(entry.parentPath ?? entry.path, entry.name));
      }
      return out;
    };
    const electronFiles = await listFiles('electron');
    const srcFiles = await listFiles('src');
    const tableSvc = await read('electron/services/PoiTableIoService.ts');
    const kmlSrc = await read('src/utils/poiKml.ts');
    const rowsSrc = await read('src/utils/poiImportRows.ts');
    const body = (source, startRe) => {
      const at = source.search(startRe);
      assert.ok(at >= 0, `${startRe} がない`);
      const rest = source.slice(at + 10);
      const next = rest.search(/\n(?:export )?(?:async )?function |\nexport (?:const|type|interface) /);
      return source.slice(at, next < 0 ? undefined : at + 10 + next);
    };

    // (a) electron/ の下で解析を直接呼ぶのは parsePoiImportBytes の中だけ。両方の呼び出し側がそれを呼ぶ
    const direct = [];
    for (const file of electronFiles) {
      const text = await readFile(file, 'utf8');
      for (const line of text.split('\n')) {
        if (/^\s*(import|\/\/|\*)/.test(line)) continue;
        if (/\b(parsePoiImportFile|parsePoiKml)\(/.test(line)) direct.push(path.relative(projectRoot, file));
      }
    }
    assert.deepEqual([...new Set(direct)], ['electron/services/PoiTableIoService.ts'], '解析を直接呼ぶのは PoiTableIoService だけ');
    const bytesBody = body(tableSvc, /export async function parsePoiImportBytes\(/);
    assert.ok(/parsePoiImportFile\(/.test(bytesBody) && /parsePoiKml\(/.test(bytesBody), 'parsePoiImportBytes が拡張子で .csv・.kml を振り分けていない');
    assert.equal((tableSvc.match(/\bparsePoiImportFile\(/g) ?? []).length, 1, 'parsePoiImportFile の呼び出しは 1 か所');
    assert.equal((tableSvc.match(/\bparsePoiKml\(/g) ?? []).length, 1, 'parsePoiKml の呼び出しは 1 か所');
    assert.ok(body(tableSvc, /export async function pickAndParsePoiMerge\(/).includes('parsePoiImportBytes('), 'pickAndParsePoiMerge が parsePoiImportBytes を呼んでいない');
    const svcSrc = await read('electron/services/PoiSourceService.ts');
    assert.ok(svcSrc.includes('parsePoiImportBytes('), 'PoiSourceService の取り込みが parsePoiImportBytes を呼んでいない');
    assert.ok(!/\bimportCsvFile\b/.test(svcSrc), 'importCsvFile は importTableFile に改名済み');

    // (b) xmldom を import するのは main の PoiTableIoService.ts だけ。静的な import ではなく動的 import
    const xmldomUsers = [];
    for (const file of [...electronFiles, ...srcFiles]) {
      if ((await readFile(file, 'utf8')).includes('@xmldom/xmldom')) xmldomUsers.push(path.relative(projectRoot, file));
    }
    assert.deepEqual(xmldomUsers, ['electron/services/PoiTableIoService.ts'], 'xmldom を参照するのは PoiTableIoService だけ (src/ には無い)');
    assert.doesNotMatch(tableSvc, /^import[^\n]*@xmldom\/xmldom/m, 'xmldom は静的に import しない (既存の smoke の読み込みに影響させない)');
    assert.match(tableSvc, /await import\(['"]@xmldom\/xmldom['"]\)/, 'xmldom は動的 import');

    // (c) scanKmlShape は DOM を作る前に呼ばれる
    const kmlBody = body(kmlSrc, /export function parsePoiKml\(/);
    const scanAt = kmlBody.indexOf('scanKmlShape(');
    const docAt = kmlBody.indexOf('createDocument(');
    assert.ok(scanAt >= 0 && docAt >= 0 && scanAt < docAt, 'parsePoiKml が createDocument の前に scanKmlShape を見ていない');
    assert.match(kmlBody.slice(scanAt, docAt), /return/, '事前走査が失敗したら DOM を作らずに返す');

    // (d) 見出しの解決と行への写しは poiImportRows.ts の共有実装。poiKml.ts に独自の処理を持たない
    assert.match(kmlSrc, /import\s*\{[^}]*\bresolveColumnSpec\b[^}]*\}\s*from\s*['"]\.\/poiImportRows['"]/, 'poiKml.ts が resolveColumnSpec を import していない');
    assert.match(kmlSrc, /import\s*\{[^}]*\bmapCellsToImportRow\b[^}]*\}\s*from\s*['"]\.\/poiImportRows['"]/, 'poiKml.ts が mapCellsToImportRow を import していない');
    assert.ok(body(kmlSrc, /export function parsePoiKml\(/).includes('mapCellsToImportRow('), 'KML の行が mapCellsToImportRow を通っていない');
    assert.ok(body(kmlSrc, /export function parsePoiKml\(/).includes('resolveColumnSpec('), 'ExtendedData の名前が resolveColumnSpec を通っていない');
    for (const word of ['normalizeHeader', 'PLAIN_ALIASES', 'FIELD_ALIASES', 'LANG_BY_LOWER', 'NFKC', 'readCoordinate', 'isDangerousUrlString', 'UID_RE', "'lat'", "'lng'"]) {
      assert.ok(!kmlSrc.includes(word), `poiKml.ts に独自の処理 (${word}) がある`);
    }
    for (const word of ['export function resolveColumnSpec', 'export function normalizeHeader', 'export function mapCellsToImportRow']) {
      assert.ok(rowsSrc.includes(word), `poiImportRows.ts に ${word} がない`);
    }
    // 切り出しの変異: 見出しの別名表は poiImportRows.ts の 1 か所だけ
    assert.equal((rowsSrc.match(/const PLAIN_ALIASES\b/g) ?? []).length, 1);

    // (e) 選択の拡張子と filters
    const mergeHandler = extractHandler(ipcSrc, 'poisource:pickAndParseMerge');
    assert.match(mergeHandler, /extensions:\s*\['csv', 'kml'\]/, 'pickAndParseMerge の filters が csv・kml でない');
    const pkg = JSON.parse(await read('package.json'));
    // (AC7(e)) xmldom は dependencies に 0.8.15 の完全一致
    assert.equal(pkg.dependencies['@xmldom/xmldom'], '0.8.15', '@xmldom/xmldom は 0.8.15 の完全一致');
    assert.equal(pkg.devDependencies?.['@xmldom/xmldom'], undefined);
    const lock = await read('pnpm-lock.yaml');
    assert.match(lock, /importers:\n {2}\.:\n[\s\S]*?\n {6}'@xmldom\/xmldom':\n {8}specifier: 0\.8\.15\n {8}version: 0\.8\.15\n/, 'lock の importers に xmldom がない');
    console.log('  case m (AC18・AC7(e): 唯一の入口・xmldom の置き場所・事前走査の順序・共有の実装): PASS');
  }

  // ---------- PR-2 の実装レビュー m-1: 取り込み後の「N 件追加」の表示を、Undo・保存の後に残さない ----------
  {
    assert.match(editSrc, /watch\(\s*\(\)\s*=>\s*editState\.value\?\.features[\s\S]{0,240}mergeResultMessage\.value\s*=\s*""/, 'features が変わったら結果の表示を消す watch がない');
    assert.match(editSrc, /watch\(\s*saving[\s\S]{0,160}mergeResultMessage\.value\s*=\s*""/, '保存の開始で結果の表示を消す watch がない');
    console.log('  case n (取り込み結果の表示を Undo・保存の後に残さない): PASS');
  }

  // ---------- 文言 (AC10) ----------
  {
    const WORDS = {
      ja: ['設定'], en: ['setting'], de: ['einstellung'], fr: ['paramètre', 'réglage'],
      es: ['configuración', 'ajuste'], ko: ['설정'], zh: ['设置'], 'zh-TW': ['設定', '設置'],
      vi: ['cài đặt'], th: ['ตั้งค่า'], id: ['pengaturan'],
    };
    for (const [lang, words] of Object.entries(WORDS)) {
      const json = JSON.parse(await read(`public/locales/${lang}/translation.json`));
      assert.ok(json.poiio && Object.keys(json.poiio).length > 0, `${lang}: poiio がない`);
      const text = JSON.stringify(json.poiio).toLowerCase();
      for (const w of words) assert.ok(!text.includes(w.toLowerCase()), `${lang}: poiio に「${w}」が含まれる`);
    }
    console.log('  case l (poiio に「設定」相当の語が無い・11 言語): PASS');
  }

  console.log('poi-import smoke: PASS');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
