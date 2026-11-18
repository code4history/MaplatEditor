// smoke: ジオコーダ応答（Nominatim の display_name）のエスケープ是正。
//
//
// (a): nominatim.js のソースに row.address.name の生補間が現れない
// (b): OSM 分岐が共有プリミティブ template( を通る
// (c): helpers/dom.js の template() を実際に import して起動し、HTML がエスケープされることを確認
//           （テスト内でエスケープ処理を再現しない。実関数を呼ぶ）
//
// dom.js は './mix' を拡張子なしで import するため node から直接 import できない。
// 他の smoke（等）と同じく vite の ssr build で束ねてから実行する。
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const nominatimPath = path.join(projectRoot, 'src/libs/ol-geocoder/nominatim.js');
const domPath = path.join(projectRoot, 'src/libs/ol-geocoder/helpers/dom.js');

// ---- (a)(b): ソース検査 -------------------------------------------------

const nominatim = await readFile(nominatimPath, 'utf8');

// createList() の switch から OSM 分岐の本体を切り出す。
// 行番号ではなく構造（case PROVIDERS.OSM: 〜 break;）で取るため、周辺の編集に強い。
const osmCaseMatch = nominatim.match(/case PROVIDERS\.OSM:\s*([\s\S]*?)\bbreak;/u);
assert.ok(osmCaseMatch, 'createList の OSM 分岐（case PROVIDERS.OSM）が見つからない');
const osmBranch = osmCaseMatch[1];

assert.doesNotMatch(
  nominatim,
  /\$\{\s*row\.address\.[A-Za-z_$][\w$]*\s*\}/u,
  '(a): 応答由来の row.address.* をテンプレートリテラルへ生補間してはならない（エスケープを迂回する）',
);
console.log('ok: (a) no raw interpolation of row.address.* in nominatim.js');

assert.match(
  osmBranch,
  /\btemplate\(/u,
  '(b): OSM 分岐は共有エスケープ primitive template() を通ること',
);
console.log('ok: (b) OSM branch goes through template()');

// 既定分岐（addressTemplate）も従来どおり template() を通り続けること（非退行）
assert.match(
  nominatim,
  /return template\(html\.join\('<br>'\), address\);/u,
  '(b): 既定分岐 addressTemplate() の template() 経由が維持されていること',
);
console.log('ok: (b) default branch still goes through template()');

// template / htmlEscape が dom.js 側に存在し続けること（移設・改名の検知）
const dom = await readFile(domPath, 'utf8');
assert.match(dom, /export function template\(/u, 'helpers/dom.js に template() が存在すること');
assert.match(dom, /export function htmlEscape\(/u, 'helpers/dom.js に htmlEscape() が存在すること');
console.log('ok: shared escape primitives present in helpers/dom.js');

// ---- (c): template() の実起動 -------------------------------------------

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'geocoder-escape-'));
const entryFile = path.join(workDir, 'geocoder-escape-entry.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'geocoder-escape-entry.mjs');

await writeFile(
  entryFile,
  `
    import assert from 'node:assert/strict';
    const { template, htmlEscape } = await import(${JSON.stringify(domPath)});

    // OSM 分岐が実際に使う形（クラス名は定数なのでテンプレート外で補間する）
    const render = (name) => template('<span class="gcd-road">{name}</span>', { name });

    const attack = '<img src=x onerror="window.__fxXss=1">';
    const rendered = render(attack);
    assert.ok(!/<img/u.test(rendered),
      '(c): 応答由来の値から img タグが生成されてはならない: ' + rendered);
    assert.ok(rendered.includes('&lt;img'),
      '(c): < は &lt; へエスケープされること: ' + rendered);
    assert.ok(rendered.includes('&quot;') && !/onerror="/u.test(rendered),
      '(c): 属性区切りの " もエスケープされること: ' + rendered);
    assert.ok(rendered.startsWith('<span class="gcd-road">') && rendered.endsWith('</span>'),
      '(c): テンプレート側の静的マークアップは残ること: ' + rendered);
    console.log('ok: (c) template() escapes response-derived value');

    // & ' > も含めた全数（htmlEscape の契約）
    assert.equal(htmlEscape('&<>"\\''), '&amp;&lt;&gt;&quot;&#039;',
      '(c): htmlEscape が & < > " \\' をすべて実体参照へ変換すること');
    console.log('ok: (c) htmlEscape covers all five characters');

    // 設計レビュー 置換値は再走査されないため {…} を含む応答でも二重展開しない
    const braced = render('{name} 通り');
    assert.equal(braced, '<span class="gcd-road">{name} 通り</span>',
      '(c): 置換値に含まれる {…} は再展開されないこと: ' + braced);
    console.log('ok: (c) substituted value is not re-scanned (design review)');

    console.log('geocoder escape smoke: ALL PASS');
  `,
);

await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    emptyOutDir: true,
    outDir,
    ssr: entryFile,
    target: 'node22',
    rollupOptions: {
      output: { entryFileNames: 'geocoder-escape-entry.mjs', format: 'es' },
    },
  },
});

const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
  cwd: projectRoot,
  timeout: 120000,
  maxBuffer: 1024 * 1024 * 8,
});
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

console.log('geocoder escape smoke passed');
