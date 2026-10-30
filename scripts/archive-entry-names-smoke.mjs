// スモーク: ZIP の entry 名の検査（Windows で同じ名前に落ちるもの・大小を畳んだ重複）。
//
// 固定すること:
//   (1) 末尾のドット・空白
//   (2) Windows の予約名（拡張子つき・セグメントのどこでも）
//   (3) 制御文字と Windows で使えない文字
//   (4) 大小・末尾のドット・Unicode の正規化を畳むと同じになる名前
//   実際の書き出しの名前とタイルの名前は全部通り、今までの拒否（`..`・`\`・先頭 `/`・ドライブ・symlink・完全一致）も残る。
//
// OS で分岐しない（どの OS で作った ZIP でも、どの OS へ運ばれるか分からないため）。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const { assertSafeArchiveEntries, assertSafePoiPackageEntries } = await import(
  pathToFileURL(path.join(projectRoot, 'src/utils/poiPackage.ts')).href
);

const baseline = JSON.parse(
  await readFile(path.join(projectRoot, 'scripts/fixtures/nov26-m6-t8-default-map-export.json'), 'utf8'),
);
const source = await readFile(path.join(projectRoot, 'src/utils/poiPackage.ts'), 'utf8');

const failures = [];
const check = (label, fn) => {
  try {
    fn();
    console.log('ok ' + label);
  } catch (e) {
    failures.push(label);
    console.log('NG ' + label + ': ' + String(e?.message ?? e).split('\n')[0].slice(0, 200));
  }
};
const entries = (...names) => names.map((name) => ({ name, size: 1 }));
const rejects = (names, pattern) => {
  assert.throws(() => assertSafeArchiveEntries(entries(...names), 'map package'), pattern, JSON.stringify(names));
  assert.throws(() => assertSafePoiPackageEntries(entries(...names)), (e) => /POI package/.test(e.message), JSON.stringify(names));
};
const UNSAFE = /^Error: Unsafe map package entry: /;
const DUPLICATE = /^Error: Duplicate map package entry: /;

for (const name of ['tiles/m/a.png.', 'tiles/m/a.png ', 'tiles/m./x', 'tiles/m /x']) {
  check('(1) 末尾のドット・空白: ' + JSON.stringify(name), () => rejects([name], UNSAFE));
}
for (const name of [
  'tiles/CON/0.png', 'pois/nul.geojson', 'imgs/COM1.jpg', 'tiles/lpt9/x', 'con.png', 'tiles/CON .png',
  'tiles/COM¹', 'tiles/lpt²/x', 'tiles/CONIN$', 'tiles/conout$.txt', 'AUX', 'tiles/Prn.tar.gz',
]) {
  check('(2) 予約名: ' + JSON.stringify(name), () => rejects([name], UNSAFE));
}
for (const name of [
  'tiles/a\u0000b.png', 'tiles/a\u001fb.png', 'tiles/a\u007fb.png', 'tiles/a<b.png', 'tiles/a>b.png', 'tiles/a:b.png',
  'tiles/a"b.png', 'tiles/a|b.png', 'tiles/a?b.png', 'tiles/a*b.png',
]) {
  check('(3) 使えない文字: ' + JSON.stringify(name), () => rejects([name], UNSAFE));
}
for (const pair of [
  ['tiles/m/a.png', 'tiles/m/A.png'],
  ['tiles/M/a.png', 'tiles/m/a.png'],
  ['tiles/m/\u00e9.png', 'tiles/m/e\u0301.png'],
  ['tiles/m/stra\u00dfe.png', 'tiles/m/strasse.png'],
  ['tiles/m/\u017f.png', 'tiles/m/s.png'],
  ['tiles/m/\u03c2.png', 'tiles/m/\u03c3.png'],
  ['tiles/m/\ufb01.png', 'tiles/m/fi.png'],
  ['tiles/m/ẞ.png', 'tiles/m/ss.png'],
  ['tiles/m/ẞ.png', 'tiles/m/ß.png'],
]) {
  check('(4) 重複: ' + JSON.stringify(pair), () => rejects(pair, DUPLICATE));
}
// 展開のときに空のセグメントが畳まれ、tiles/a.png と同じファイルへ上書きされる
for (const names of [['tiles//a.png'], ['tiles/a.png', 'tiles//a.png'], ['tiles/m//']]) {
  check('(5) 空のセグメント: ' + JSON.stringify(names), () => rejects(names, UNSAFE));
}
check('(4) 末尾のドットを落とすと重なる名前は、重複の前に末尾のドットで拒否される', () => {
  rejects(['tiles/m/b.png', 'tiles/m/b.png.'], /^Error: (Unsafe|Duplicate) map package entry: /);
});

check('通る: 実際の書き出しの名前', () => {
  const names = Object.keys(baseline.entries);
  assert.ok(names.length >= 7);
  assert.doesNotThrow(() => assertSafeArchiveEntries(entries(...names), 'map package'));
});
check('通る: タイルの名前 100 件と、予約名に似た名前', () => {
  const names = [];
  for (let i = 0; i < 100; i++) {
    const ext = ['jpg', 'png', 'webp'][i % 3];
    names.push(`tiles/map-${i % 7}_x/${i % 5}/${i}/${i * 3}.${ext}`);
  }
  names.push(
    'export-manifest.json', 'tiles/', 'tiles/m/', '.DS_Store', '__MACOSX/._a.png', 'docs/CONSOLE.png', 'docs/com10.png',
    'docs/lpt.txt', 'docs/console/0.png', 'docs/nul_x.txt', 'docs/日本語の名前.png', 'docs/a b.png',
  );
  assert.doesNotThrow(() => assertSafeArchiveEntries(entries(...names), 'map package'));
});

const refusals = [
  ['../x', UNSAFE], ['tiles/../../x', UNSAFE], ['tiles\\x', UNSAFE], ['/etc/passwd', UNSAFE], ['C:/x', UNSAFE], ['', UNSAFE],
];
for (const [name, pattern] of refusals) {
  check('今までの拒否: ' + JSON.stringify(name), () => {
    assert.throws(() => assertSafeArchiveEntries(entries(name), 'map package'), pattern);
  });
}
check('今までの拒否: symlink・完全一致の重複', () => {
  assert.throws(() => assertSafeArchiveEntries([{ name: 'a', size: 1, isSymlink: true }], 'map package'), UNSAFE);
  assert.throws(() => assertSafeArchiveEntries(entries('a', 'a'), 'map package'), /^Error: Duplicate map package entry: a$/);
});

check('検査が OS で分岐しない', () => assert.equal(/process\.platform/.test(source), false));

if (failures.length > 0) {
  console.log('失敗 ' + failures.length + ' 件');
  process.exit(1);
}
console.log('archive entry names smoke passed');
