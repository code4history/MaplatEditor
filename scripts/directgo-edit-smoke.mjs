// directgo 編集のスモーク（純関数）。src/utils/poiContentMode.ts と src/utils/poiGeoJson.ts を vite で build して確かめる。
//   1. URL の検査の受理集合がビューアと同じ: isDangerousUrlString(入力) が
//      「new URL(入力, 'https://maplat.invalid/') の protocol が http:/https: でない（例外も拒否）」と一致する
//   2. url の内容の形と directgo が同じ検査を使う（url の形でも java<TAB>script: 等を拒否する）
//   3. content-mode-link-format: href が無い・文字列でない・検査で拒否 → error。
//      形が 'link' でなくても directgo があれば検査する。ただし空白を除いて空の href は「値なし」（ビューアも
//      空文字は無視する）なので link 以外の形では error にしない。blank はビューアが真偽性で読むので型を問わない
//   4. 内容の形の表: 'link' の値・使う欄・非互換の欄（link は空・他の 3 つは directgo を含む）
//   5. 読み込み時の推定: directgo があれば html・url があっても 'link'
//   6. 書き出しに内部の値（_maplatContentMode）が漏れず、directgo は残る
//   7. フォームの値の組み立て: チェックなし → 文字列、あり → { href, blank: true }、読んだ { href } はオブジェクトのまま
//   8. 文言: 11 言語の public/locales/*/translation.json に新しいキーがすべてあり、空でない
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'directgo-edit-'));

async function buildModule(entry, name) {
  const outDir = path.join(workDir, name);
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: { entry: path.join(projectRoot, entry), formats: ['es'], fileName: () => `${name}.mjs` },
      rollupOptions: { external: [] },
    },
  });
  return import(pathToFileURL(path.join(outDir, `${name}.mjs`)).href);
}

let checks = 0;
const check = (label, fn) => {
  fn();
  checks += 1;
  console.log(`  ok: ${label}`);
};

try {
  const mode = await buildModule('src/utils/poiContentMode.ts', 'poiContentMode');
  const geo = await buildModule('src/utils/poiGeoJson.ts', 'poiGeoJson');

  // ---------- 1. 受理集合の表 ----------
  const viewerAccepts = (s) => {
    try {
      const protocol = new URL(s, 'https://maplat.invalid/').protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  };
  const allowed = ['https://a/', 'http://a/', './x.html', '#!s:abc/x:1/y:2/z:3', '?a=1', '//a/'];
  const rejected = [
    'javascript:alert(1)',
    'JaVaScRiPt:x',
    'java\tscript:alert(1)',
    '\u0000javascript:x',
    ' javascript:x',
    'data:text/html,x',
    'vbscript:x',
    'file:///etc/passwd',
  ];
  assert.equal(typeof geo.isDangerousUrlString, 'function', 'poiGeoJson は isDangerousUrlString を export する');
  for (const input of allowed) {
    check(`allow ${JSON.stringify(input)}`, () => {
      assert.equal(viewerAccepts(input), true, `表の前提: ${JSON.stringify(input)} はビューアで許可`);
      assert.equal(geo.isDangerousUrlString(input), false);
    });
  }
  for (const input of rejected) {
    check(`reject ${JSON.stringify(input)}`, () => {
      assert.equal(viewerAccepts(input), false, `表の前提: ${JSON.stringify(input)} はビューアで拒否`);
      assert.equal(geo.isDangerousUrlString(input), true);
    });
  }
  check('empty / whitespace is allowed (not dangerous)', () => {
    assert.equal(geo.isDangerousUrlString(''), false);
    assert.equal(geo.isDangerousUrlString('   '), false);
  });

  const fcOf = (properties) => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [135, 35] }, properties: { name: 'P', ...properties } }],
  });
  const codes = (properties) => geo.validateFeatureCollection(fcOf(properties)).map((i) => `${i.level}:${i.code}`);

  // ---------- 2. url の内容の形も同じ検査 ----------
  check('url mode rejects java<TAB>script: (same function as directgo)', () => {
    assert.ok(codes({ _maplatContentMode: 'url', url: 'java\tscript:alert(1)' }).includes('error:content-mode-url-format'));
    assert.ok(codes({ _maplatContentMode: 'url', url: { ja: 'https://a/', en: '\u0000javascript:x' } }).includes('error:content-mode-url-format'));
    assert.ok(!codes({ _maplatContentMode: 'url', url: './page.html' }).includes('error:content-mode-url-format'));
  });

  // ---------- 3. content-mode-link-format ----------
  const linkError = 'error:content-mode-link-format';
  const linkBad = [
    ['link mode without directgo', { _maplatContentMode: 'link' }],
    ['link mode with empty href string', { _maplatContentMode: 'link', directgo: '' }],
    ['javascript: string', { _maplatContentMode: 'link', directgo: 'javascript:alert(1)' }],
    ['java<TAB>script: string', { _maplatContentMode: 'link', directgo: 'java\tscript:alert(1)' }],
    ['object without href', { _maplatContentMode: 'link', directgo: { blank: true } }],
    ['object with non-string href', { _maplatContentMode: 'link', directgo: { href: 1 } }],
    ['object with rejected href', { _maplatContentMode: 'link', directgo: { href: 'data:text/html,x', blank: true } }],
    ['number', { _maplatContentMode: 'link', directgo: 3 }],
    ['standard mode with rejected directgo (raw JSON)', { _maplatContentMode: 'standard', desc: 'd', directgo: 'javascript:alert(1)' }],
    ['no mode with rejected directgo', { desc: 'd', directgo: { href: 'vbscript:x' } }],
  ];
  for (const [label, props] of linkBad) {
    check(`link-format error: ${label}`, () => assert.ok(codes(props).includes(linkError), JSON.stringify(codes(props))));
  }
  const linkGood = [
    ['string https', { _maplatContentMode: 'link', directgo: 'https://example.org/a' }],
    ['object blank', { _maplatContentMode: 'link', directgo: { href: 'https://example.org/b', blank: true } }],
    ['object without blank', { _maplatContentMode: 'link', directgo: { href: 'https://example.org/b' } }],
    ['object blank false', { _maplatContentMode: 'link', directgo: { href: 'https://example.org/b', blank: false } }],
    ['in-app relative', { _maplatContentMode: 'link', directgo: '#!s:other/x:1/y:2/z:3' }],
    ['standard mode without directgo', { _maplatContentMode: 'standard', desc: 'd' }],
    ['object with non-boolean blank (viewer reads truthiness)', { _maplatContentMode: 'link', directgo: { href: 'https://a/', blank: 'yes' } }],
  ];
  for (const [label, props] of linkGood) {
    check(`link-format ok: ${label}`, () => assert.ok(!codes(props).includes(linkError), JSON.stringify(codes(props))));
  }

  // 空の directgo・真偽値でない blank で POI ソース全体の保存が止まらない（読み込み時の推定 → 検査の流れで）
  const noErrorAfterLoad = (properties) => {
    const fc = geo.normalizePoiSourceCollection(fcOf(properties), 'ja');
    return geo.validateFeatureCollection(fc).filter((i) => i.level === 'error').map((i) => i.code);
  };
  const saveNotBlocked = [
    ['empty directgo string', { desc: 'd', directgo: '' }],
    ['whitespace-only directgo string', { desc: 'd', directgo: ' \t ' }],
    ['object with empty href', { desc: 'd', directgo: { href: '  ' } }],
    ['empty directgo string with explicit standard mode', { _maplatContentMode: 'standard', desc: 'd', directgo: '' }],
    ['blank given as string "true"', { desc: 'd', directgo: { href: 'https://a/', blank: 'true' } }],
    ['blank given as number 0', { desc: 'd', directgo: { href: 'https://a/', blank: 0 } }],
  ];
  for (const [label, props] of saveNotBlocked) {
    check(`save not blocked: ${label}`, () => assert.deepEqual(noErrorAfterLoad(props), []));
  }
  check('empty directgo is not estimated as link', () => {
    const fc = geo.normalizePoiSourceCollection(fcOf({ desc: 'd', directgo: ' ' }), 'ja');
    assert.notEqual(fc.features[0].properties._maplatContentMode, 'link');
  });

  // ---------- 4. 内容の形の表 ----------
  check('content mode values include link', () => {
    assert.deepEqual([...mode.CONTENT_MODE_VALUES], ['standard', 'html', 'url', 'link']);
  });
  check('link uses directgo and hides (does not delete) other content', () => {
    assert.deepEqual([...mode.activeFieldsForMode('link')], ['directgo']);
    assert.deepEqual([...mode.incompatibleFieldsForMode('link')], []);
  });
  check('leaving link removes directgo', () => {
    for (const m of ['standard', 'html', 'url']) {
      assert.ok(mode.incompatibleFieldsForMode(m).includes('directgo'), `${m} の非互換に directgo`);
    }
  });

  // ---------- 5. 推定 ----------
  check('estimate: directgo wins over html/url', () => {
    assert.equal(mode.estimateContentMode({ directgo: 'https://a/', html: { ja: '<p>x</p>' }, url: 'https://b/' }), 'link');
    assert.equal(mode.estimateContentMode({ directgo: { href: '#!s:m/x:0/y:0/z:1', blank: true }, desc: 'd' }), 'link');
    assert.equal(mode.estimateContentMode({ directgo: '', html: '<p>x</p>' }), 'html');
    assert.equal(mode.estimateContentMode({ directgo: { href: '' }, url: 'https://b/' }), 'url');
    assert.equal(mode.estimateContentMode({ directgo: '  ' }), undefined);
  });
  check('normalize on load assigns link', () => {
    const fc = geo.normalizePoiSourceCollection(fcOf({ desc: 'd', html: '<p>x</p>', directgo: 'https://a/' }), 'ja');
    assert.equal(fc.features[0].properties._maplatContentMode, 'link');
  });
  check('explicit mode is not overwritten on load', () => {
    const fc = geo.normalizePoiSourceCollection(fcOf({ _maplatContentMode: 'standard', desc: 'd', directgo: 'https://a/' }), 'ja');
    assert.equal(fc.features[0].properties._maplatContentMode, 'standard');
  });

  // ---------- 6. 書き出し ----------
  check('export strips _maplatContentMode and keeps directgo', () => {
    const internal = geo.normalizePoiSourceCollection(fcOf({ directgo: { href: 'https://a/', blank: true } }), 'ja');
    assert.equal(internal.features[0].properties._maplatContentMode, 'link');
    const out = geo.toExportForm(internal, 'slug', { ja: 't' });
    assert.equal(Object.prototype.hasOwnProperty.call(out.features[0].properties, '_maplatContentMode'), false);
    assert.deepEqual(out.features[0].properties.directgo, { href: 'https://a/', blank: true });
  });

  // ---------- 7. フォームの値 ----------
  check('form value helpers', () => {
    assert.equal(mode.directgoHref('https://a/'), 'https://a/');
    assert.equal(mode.directgoHref({ href: 'https://b/', blank: true }), 'https://b/');
    assert.equal(mode.directgoHref(undefined), '');
    assert.equal(mode.directgoBlank({ href: 'https://b/', blank: true }), true);
    assert.equal(mode.directgoBlank('https://a/'), false);
    // blank はビューアと同じく真偽性で読む（"true"・"false" はどちらも新しいタブ、0・"" は同じタブ）
    assert.equal(mode.directgoBlank({ href: 'https://b/', blank: 'true' }), true);
    assert.equal(mode.directgoBlank({ href: 'https://b/', blank: 'false' }), true);
    assert.equal(mode.directgoBlank({ href: 'https://b/', blank: 0 }), false);
    assert.equal(mode.directgoBlank({ href: 'https://b/', blank: '' }), false);
    // チェックなし → 文字列
    assert.equal(mode.buildDirectgoValue('https://a/', false, undefined), 'https://a/');
    assert.equal(mode.buildDirectgoValue('https://c/', false, 'https://a/'), 'https://c/');
    // チェックあり → { href, blank: true }
    assert.deepEqual(mode.buildDirectgoValue('https://a/', true, 'https://a/'), { href: 'https://a/', blank: true });
    // 読んだ { href }（blank なし）はオブジェクトのまま
    assert.deepEqual(mode.buildDirectgoValue('https://d/', false, { href: 'https://b/' }), { href: 'https://d/' });
    assert.deepEqual(mode.buildDirectgoValue('https://d/', false, { href: 'https://b/', blank: false }), { href: 'https://d/', blank: false });
    // { href, blank: true } のチェックを外す → 文字列
    assert.equal(mode.buildDirectgoValue('https://b/', false, { href: 'https://b/', blank: true }), 'https://b/');
    // 真偽値でない真の blank もチェックを外せば文字列（残すとビューアが新しいタブで開き続ける）
    assert.equal(mode.buildDirectgoValue('https://b/', false, { href: 'https://b/', blank: 'true' }), 'https://b/');
    assert.deepEqual(mode.buildDirectgoValue('https://b/', true, { href: 'https://b/', blank: 'true' }), { href: 'https://b/', blank: true });
    // 空の href は値を消す
    assert.equal(mode.buildDirectgoValue('  ', false, 'https://a/'), undefined);
    assert.equal(mode.buildDirectgoValue('', true, { href: 'https://a/', blank: true }), undefined);
  });

  // ---------- 8. 文言 ----------
  const NEW_KEYS = [
    'poiedit.content_mode_link',
    'poiedit.directgo_href',
    'poiedit.directgo_blank',
    'poiedit.directgo_examples',
    'poiedit.directgo_preview_note',
    'poiedit.directgo_hidden_content',
    'poisource.errors.content_mode_link_format',
  ];
  const localesDir = path.join(projectRoot, 'public/locales');
  const langs = (await readdir(localesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check('11 locales', () => assert.equal(langs.length, 11, langs.join(',')));
  for (const lang of langs) {
    const json = JSON.parse(await readFile(path.join(localesDir, lang, 'translation.json'), 'utf8'));
    check(`locale ${lang} has new keys`, () => {
      for (const key of NEW_KEYS) {
        const value = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), json);
        assert.equal(typeof value, 'string', `${lang}: ${key}`);
        assert.notEqual(value.trim(), '', `${lang}: ${key} is empty`);
      }
    });
  }

  console.log(`summary: ${checks} checks passed`);
  console.log('directgo edit smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
