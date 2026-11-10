#!/usr/bin/env node
// エディタの用語集の検査（scripts/editor-glossary-check.mjs）の回帰検証。
// 設計「MaplatEditor 全言語用語集・CI検査 タスク設計書」v1.2 §5.7 の fixture を、実データを壊さずに一時ディレクトリで確かめる。
//
// - 照合・結び付けの単体: 検査 script の evaluateKey / matchForm を、実物の正本で呼ぶ
// - #237 型の場合 A〜E・E′・#241 相当と関門 1・2: 実物の正本と locale を一時の git リポジトリに写し、値を変えて CLI を走らせる
// - CI: run-smokes → judge-test-results を通して、検査の失敗がジョブの失敗に伝わることを確かめる
// - 実物: このリポジトリの正本と locale で検査が緑・違反を抑えなかった例外が 0 件であること
//
// 使い方: node scripts/editor-glossary-check-smoke.mjs
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(root, 'scripts', 'editor-glossary-check.mjs');
const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passes += 1;
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

const tmpRoots = [];
function tmp(prefix) {
  const dir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), `editor-glossary-${prefix}-`));
  tmpRoots.push(dir);
  return dir;
}

const env = { ...process.env };
delete env.EDITOR_GLOSSARY_BASE;
delete env.GITHUB_STEP_SUMMARY;

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** 実物の正本・locale・検査 script を一時の git リポジトリに写す。withGlossary=false なら正本を写さない（初版 PR の base） */
function makeRepo(prefix, { withGlossary = true } = {}) {
  const dir = tmp(prefix);
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  cpSync(path.join(root, 'public', 'locales'), path.join(dir, 'public', 'locales'), { recursive: true });
  cpSync(checker, path.join(dir, 'scripts', 'editor-glossary-check.mjs'));
  cpSync(path.join(root, 'scripts', 'editor-locale-parity.mjs'), path.join(dir, 'scripts', 'editor-locale-parity.mjs'));
  if (withGlossary) cpSync(path.join(root, 'docs', 'i18n'), path.join(dir, 'docs', 'i18n'), { recursive: true });
  git(dir, 'init', '-q', '-b', 'master');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

function commitAll(dir, msg) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

const localePath = (dir, lang) => path.join(dir, 'public', 'locales', lang, 'translation.json');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function setValue(dir, lang, dotted, value) {
  const file = localePath(dir, lang);
  const data = readJson(file);
  const parts = dotted.split('.');
  let node = data;
  for (const p of parts.slice(0, -1)) node = node[p] ??= {};
  if (value === undefined) delete node[parts.at(-1)];
  else node[parts.at(-1)] = value;
  writeJson(file, data);
}

function editGlossary(dir, fn) {
  const file = path.join(dir, 'docs', 'i18n', 'editor-glossary.json');
  const g = readJson(file);
  fn(g);
  writeJson(file, g);
}

function editExceptions(dir, fn) {
  const file = path.join(dir, 'docs', 'i18n', 'editor-glossary.exceptions.json');
  const e = readJson(file);
  fn(e);
  writeJson(file, e);
}

/** 検査を CLI で走らせ、終了コード・標準出力・報告を返す */
function run(dir, args = [], extraEnv = {}) {
  const report = path.join(tmp('report'), 'report.json');
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'editor-glossary-check.mjs'), '--report', report, ...args], {
    encoding: 'utf8',
    env: { ...env, ...extraEnv },
  });
  let rep = null;
  try {
    rep = readJson(report);
  } catch {
    rep = null;
  }
  return { status: r.status, out: `${r.stdout}${r.stderr}`, report: rep };
}

const findings = (r, pred) => (r.report?.violations ?? []).filter(pred);
const summarize = (r) => `exit=${r.status} ${r.out.split('\n').slice(-12).join(' | ')}`;

const PR237 = {
  de: ['Verweise auf Asset-Bilder sind unverändert enthalten: {{items}}. In einer anderen Umgebung haben sie keine Bedeutung.', 'Asset-Bilder', 'Asset-Symbole'],
  en: ['Asset image references are included as they are: {{items}}. They have no meaning in another environment.', 'Asset images', 'Asset icons'],
  es: ['Las referencias de imágenes de recursos se incluyen tal cual: {{items}}. No tienen significado en otro entorno.', 'Imágenes de recursos', 'Iconos de recursos'],
  fr: ['Les références d’images d’actifs sont incluses telles quelles : {{items}}. Elles n’ont aucun sens dans un autre environnement.', 'Images d’actifs', 'Icônes d’actifs'],
  id: ['Referensi gambar aset disertakan apa adanya: {{items}}. Referensi ini tidak bermakna di lingkungan lain.', 'Gambar aset', 'Ikon aset'],
  ja: ['画像の参照（資産）がそのまま入っています: {{items}}。別の環境では意味を持ちません。', '資産の画像', '資産のアイコン'],
  ko: ['자산 이미지 참조가 그대로 들어 있습니다: {{items}}. 다른 환경에서는 의미가 없습니다.', '자산 이미지', '자산 아이콘'],
  th: ['การอ้างอิงรูปภาพของแอสเซ็ตรวมอยู่ตามเดิม: {{items}} ซึ่งไม่มีความหมายในสภาพแวดล้อมอื่น', 'รูปภาพแอสเซ็ต', 'ไอคอนแอสเซ็ต'],
  vi: ['Tham chiếu hình ảnh tài nguyên được giữ nguyên: {{items}}. Chúng không có ý nghĩa ở môi trường khác.', 'Hình ảnh tài nguyên', 'Biểu tượng tài nguyên'],
  zh: ['资源图片的引用已原样包含：{{items}}。在其他环境中没有意义。', '资源图片', '资源图标'],
  'zh-TW': ['資源圖片的參照已原樣包含：{{items}}。在其他環境中沒有意義。', '資源圖片', '資源圖示'],
};
const PR237_KEYS = ['poiio.asset_json', 'poiio.label_image_asset', 'poiio.label_icon_asset'];

function apply237(dir, lang) {
  PR237_KEYS.forEach((k, i) => setValue(dir, lang, k, PR237[lang][i]));
}

try {
  // ───────────── 実物の状態 ─────────────
  {
    const r = run(root);
    check('実物: 検査が緑（exit 0・違反 0 件）', r.status === 0 && r.report?.violations?.length === 0, summarize(r));
    check('実物: 違反を抑えなかった例外が 0 件', r.report?.warnings?.filter((w) => w.kind === 'unused-exception').length === 0, summarize(r));
    check('実物: 生成物（bindings.json・md）が再生成と一致', !findings(r, (v) => v.kind === 'generated').length, summarize(r));
    const parity = spawnSync(process.execPath, [path.join(root, 'scripts', 'editor-locale-parity.mjs')], { encoding: 'utf8' });
    check('実物: 11 言語の parity が成功', parity.status === 0, parity.stdout + parity.stderr);
  }

  // ───────────── 照合・結び付けの単体（実物の正本） ─────────────
  const mod = await import(pathToFileURL(checker).href);
  const { glossary } = mod.loadCanonical(root);
  const evaluate = (values) => {
    const full = {};
    for (const l of LANGS) full[l] = values[l] ?? values.en;
    return mod.evaluateKey(glossary, full, 'fixture.key');
  };
  const has = (res, cid) => Object.prototype.hasOwnProperty.call(res.bindings, cid);
  const langFindings = (res, cid, lang) => res.findings.filter((f) => f.concept === cid && f.lang === lang);

  check('照合: fr「filtre actif」は禁止形 d’actifs に当たらない', !mod.matchForm('word', 'filtre actif', 'd’actifs') && mod.matchForm('word', 'Images d’actifs', 'd’actifs'));
  {
    const res = evaluate({ en: 'Active asset filter', ja: 'アセットの有効フィルタ', fr: 'filtre actif des ressources' });
    check('誤検出なし: fr「filtre actif」（asset の結び付け）', has(res, 'asset') && langFindings(res, 'asset', 'fr').length === 0, JSON.stringify(res.findings.filter((f) => f.lang === 'fr')));
  }
  check('誤検出なし: ja「コマンド」は canvas に結び付かない', !has(evaluate({ en: 'Run the command', ja: 'コマンドを実行' }), 'canvas'));
  check('誤検出なし: ja「スタイル」は tile に結び付かない', !has(evaluate({ en: 'Choose a style', ja: 'スタイルを選ぶ' }), 'tile'));
  check('誤検出なし: en「import map」は import に結び付かない', !has(evaluate({ en: 'Requires import map support', ja: 'import map への対応が要ります' }), 'import'));
  check('誤検出なし: vi「Nhập tiêu đề」は import の錨にならない', !has(evaluate({ en: 'Enter the title', ja: 'タイトルを入力', vi: 'Nhập tiêu đề' }), 'import'));
  {
    const res = evaluate({ en: 'Asset images', ja: 'アセットの画像', th: 'รูปภาพทรัพยากร' });
    check('誤検出なし: th「รูปภาพทรัพยากร」は asset を満たす', has(res, 'asset') && langFindings(res, 'asset', 'th').length === 0);
    const res2 = evaluate({ en: 'Asset images', ja: 'アセットの画像', th: 'รูปภาพ' });
    check('M5: th「รูปภาพ」単独は asset を満たさない', langFindings(res2, 'asset', 'th').some((f) => f.kind === 'required'));
  }
  {
    const res = evaluate({ en: 'Map list', ja: '地図一覧', de: 'Kartenliste' });
    check('照合モード: de「Kartenliste」は map を満たす', has(res, 'map') && langFindings(res, 'map', 'de').length === 0);
    const res2 = evaluate({ en: 'Base map list', ja: 'ベースマップ一覧', de: 'Basiskartenliste' });
    check('照合モード: de「Basiskarte」は map ではなく basemap に結び付く', has(res2, 'basemap') && !has(res2, 'map') && langFindings(res2, 'basemap', 'de').length === 0);
    for (const word of ['diimpor', 'mengimpor']) {
      const res3 = evaluate({ en: 'Import the data', ja: 'データをインポート', id: `Data ${word}` });
      check(`照合モード: id「${word}」は import を満たす`, langFindings(res3, 'import', 'id').length === 0);
    }
  }
  {
    const res = evaluate({ en: 'Replace the values', ja: '値を上書き' });
    check('共有形: ja「上書き」があり en に overwrite も override も無いと赤', res.findings.some((f) => f.kind === 'shared'), JSON.stringify(res.findings.slice(0, 3)));
    const res2 = evaluate({ en: 'Source', ja: '典拠' });
    check('共有形: ja「典拠」のキーは source でなく citation に結び付く', has(res2, 'citation') && !has(res2, 'source'));
  }
  {
    const res = evaluate({ en: 'Open the settings page', ja: '設定ページを開く', fr: 'Ouvrir la page Réglages' });
    check('configure: screen の役割で fr「page Réglages」は赤', res.bindings.configure?.role === 'screen' && langFindings(res, 'configure', 'fr').some((f) => f.kind === 'former'));
    const res2 = evaluate({ en: 'Please configure a value', ja: '値を設定してください', de: 'Bitte einen Wert angeben' });
    check('configure: item の役割の「設定してください」は必須形を求めない', !res2.findings.some((f) => f.concept === 'configure' && f.kind === 'required'));
  }
  {
    const r1 = evaluate({ en: 'Layer list', ja: 'レイヤ一覧', de: 'die angegebenen Werte' });
    check('誤一致なし: de「angegebenen」は layer を満たさない', langFindings(r1, 'layer', 'de').some((f) => f.kind === 'required'));
    const r2 = evaluate({ en: 'Save the map', ja: '地図を保存', de: 'Arbeitsspeicher der Karte' });
    check('誤一致なし: de「Arbeitsspeicher」は save を満たさない', langFindings(r2, 'save', 'de').some((f) => f.kind === 'required'));
    const r3 = evaluate({ en: 'Advanced settings', ja: '詳細設定', id: 'teratur' });
    check('誤一致なし: id「teratur」は configure を満たさない', r3.bindings.configure?.role === 'screen' && langFindings(r3, 'configure', 'id').some((f) => f.kind === 'required'));
    const r4 = evaluate({ en: 'Layer', ja: 'レイヤ', de: 'Player-Ebene' });
    check('誤一致なし: de「Player」は統一前の形「layer」に当たらない', !langFindings(r4, 'layer', 'de').some((f) => f.kind === 'former'));
  }

  // ───────────── #237 型（設計 §5.7 の場合 A〜E・E′・#241 相当） ─────────────
  {
    const dir = makeRepo('case-a');
    for (const l of LANGS) apply237(dir, l);
    const r = run(dir);
    check('場合 A: #237 の 3 キーを足し正本に何も足さない → 赤（生成物の不一致・禁止形）',
      r.status === 1 && findings(r, (v) => v.kind === 'generated').length > 0 && findings(r, (v) => v.kind === 'forbidden').length > 0, summarize(r));

    run(dir, ['--write']);
    const rb = run(dir);
    const forb = findings(rb, (v) => v.kind === 'forbidden' && PR237_KEYS.includes(v.key));
    const forbPairs = new Set(forb.map((v) => `${v.lang}/${v.key}`));
    check('場合 B: #237 の 3 言語×3 キー → 赤（9 件とも禁止形）', rb.status === 1 && ['ja', 'ko', 'fr'].every((l) => PR237_KEYS.every((k) => forbPairs.has(`${l}/${k}`))), summarize(rb));
    const bindings = readJson(path.join(dir, 'docs', 'i18n', 'editor-glossary.bindings.json'));
    check('場合 C: additionalBindings に何も書かなくても en "Asset images" が錨に当たり結び付く',
      PR237_KEYS.every((k) => bindings.asset?.[k]?.by?.includes('en')), JSON.stringify(PR237_KEYS.map((k) => bindings.asset?.[k])));
  }
  {
    const dir = makeRepo('case-d');
    for (const l of LANGS) apply237(dir, l);
    // 禁止形に無い別の語に替え、ほかの言語は直した訳にする
    const alt = {
      ja: ['画像の参照（アセット）がそのまま入っています: {{items}}。別の環境では意味を持ちません。', '素材の画像', 'アセットのアイコン'],
      ko: ['에셋 이미지 참조가 그대로 들어 있습니다: {{items}}. 다른 환경에서는 의미가 없습니다.', '리소스 이미지', '에셋 아이콘'],
      fr: ['Les références d’images de ressources sont incluses telles quelles : {{items}}. Elles n’ont aucun sens dans un autre environnement.', 'Images des biens', 'Icônes de ressources'],
      th: ['การอ้างอิงรูปภาพทรัพยากรรวมอยู่ตามเดิม: {{items}} ซึ่งไม่มีความหมายในสภาพแวดล้อมอื่น', 'รูปภาพทรัพยากร', 'ไอคอนทรัพยากร'],
      zh: ['素材图片的引用已原样包含：{{items}}。在其他环境中没有意义。', '素材图片', '素材图标'],
      'zh-TW': ['素材圖片的參照已原樣包含：{{items}}。在其他環境中沒有意義。', '素材圖片', '素材圖示'],
    };
    for (const [l, vals] of Object.entries(alt)) PR237_KEYS.forEach((k, i) => setValue(dir, l, k, vals[i]));
    run(dir, ['--write']);
    const r = run(dir);
    const at = (l, k, kind) => findings(r, (v) => v.lang === l && v.key === k && v.kind === kind).length > 0;
    check('場合 D: ja「素材の画像」は統一前の形で赤', at('ja', 'poiio.label_image_asset', 'former'), summarize(r));
    check('場合 D: ko「리소스 이미지」・fr「Images des biens」は必須形の不足で赤',
      at('ko', 'poiio.label_image_asset', 'required') && at('fr', 'poiio.label_image_asset', 'required') && r.status === 1, summarize(r));
    const assetOther = findings(r, (v) => PR237_KEYS.includes(v.key) && !(['ja', 'ko', 'fr'].includes(v.lang) && v.key === 'poiio.label_image_asset'));
    check('場合 D: 直した訳の行は違反にならない', assetOther.length === 0, JSON.stringify(assetOther.slice(0, 5)));
  }
  {
    // 場合 E: 正本の ko 許容形に「리소스」を足し、同じ PR で locale も変える → 関門 1 で赤
    const dir = makeRepo('case-e');
    const base = git(dir, 'rev-parse', 'HEAD');
    for (const l of LANGS) apply237(dir, l);
    PR237_KEYS.forEach((k, i) => setValue(dir, 'ko', k, ['리소스 이미지 참조가 그대로 들어 있습니다: {{items}}. 다른 환경에서는 의미가 없습니다.', '리소스 이미지', '리소스 아이콘'][i]));
    editGlossary(dir, (g) => g.concepts.find((c) => c.id === 'asset').locales.ko.acceptedForms.push('리소스'));
    run(dir, ['--write']);
    commitAll(dir, 'case E');
    const r = run(dir, ['--base', base]);
    check('場合 E: 正本と locale を同じ PR で変える → 赤（関門 1）', r.status === 1 && findings(r, (v) => v.kind === 'gate').length === 1, summarize(r));

    const dir2 = makeRepo('case-e2');
    const base2 = git(dir2, 'rev-parse', 'HEAD');
    editGlossary(dir2, (g) => g.concepts.find((c) => c.id === 'asset').locales.ko.acceptedForms.push('자산'));
    commitAll(dir2, 'case E jasan');
    const r2 = run(dir2, ['--base', base2]);
    check('場合 E: 許容形「자산」は禁止形との重なりで赤', r2.status === 1 && findings(r2, (v) => v.kind === 'structure' && /자산/.test(v.message ?? '')).length > 0, summarize(r2));
  }
  {
    // 場合 E′: 正本の変更だけを別 PR にする → 緑。PR に変更の要約が出る（関門 2）
    const dir = makeRepo('case-e-prime');
    const base = git(dir, 'rev-parse', 'HEAD');
    editGlossary(dir, (g) => g.concepts.find((c) => c.id === 'asset').locales.ko.acceptedForms.push('리소스'));
    run(dir, ['--write']);
    commitAll(dir, 'glossary only');
    const summaryFile = path.join(tmp('summary'), 'step-summary.md');
    writeFileSync(summaryFile, '');
    const r = run(dir, ['--base', base], { GITHUB_STEP_SUMMARY: summaryFile });
    const md = r.report?.glossaryChangeSummary ?? '';
    check('場合 E′: 正本だけの PR は緑', r.status === 0, summarize(r));
    check('場合 E′: 変更の要約に「足した許容形 ko 리소스」が緩める変更として出る', /緩める変更/.test(md) && /許容形を足した.*ko.*리소스/.test(md), md);
    check('場合 E′: 要約がジョブの要約（GITHUB_STEP_SUMMARY）にも出る', readFileSync(summaryFile, 'utf8').includes('리소스'));
  }
  {
    // #241 相当: #237 の 3 キーを消した状態 → 緑
    const dir = makeRepo('case-241');
    for (const l of LANGS) apply237(dir, l);
    run(dir, ['--write']);
    commitAll(dir, '#237');
    for (const l of LANGS) PR237_KEYS.forEach((k) => setValue(dir, l, k, undefined));
    run(dir, ['--write']);
    const r = run(dir);
    check('#241 相当: 3 キーを削除 → 緑', r.status === 0, summarize(r));
  }

  // ───────────── 例外 ─────────────
  {
    const dir = makeRepo('exceptions');
    const ex = readJson(path.join(dir, 'docs', 'i18n', 'editor-glossary.exceptions.json')).exceptions;
    const u = ex.find((e) => e.type === 'untranslated');
    const o = ex.find((e) => e.type === 'omission');
    // 値を変えると例外は失効する（全文一致）
    setValue(dir, o.locale, o.key, `${o.value} (x)`);
    const r1 = run(dir);
    check('例外: 全文が違う omission の例外は抑止しない（赤）', r1.status === 1 && findings(r1, (v) => v.lang === o.locale && v.key === o.key && v.kind === 'required').length > 0, summarize(r1));
    check('例外: 抑止しなかった例外は警告になる', (r1.report?.warnings ?? []).some((w) => w.kind === 'unused-exception' && w.key === o.key));
    setValue(dir, o.locale, o.key, o.value);
    // untranslated は en の値が変わると成り立たない
    setValue(dir, 'en', u.key, `${u.value} (changed)`);
    run(dir, ['--write']);
    const r2 = run(dir);
    check('例外: untranslated の例外は en の値を変えると成り立たず赤', r2.status === 1 && findings(r2, (v) => v.lang === u.locale && v.key === u.key && v.kind === 'required').length > 0, summarize(r2));
  }
  {
    const dir = makeRepo('exceptions2');
    // 違反の無い行に例外を書く（正本だけの変更）→ 警告で緑
    editExceptions(dir, (e) => e.exceptions.push({ type: 'omission', concept: 'asset', locale: 'ja', key: 'navbar.assets', value: 'アセット管理', reason: 'fixture' }));
    const r = run(dir);
    check('例外: 違反を抑えなかった例外は警告で、赤にはしない', r.status === 0 && (r.report?.warnings ?? []).some((w) => w.kind === 'unused-exception' && w.key === 'navbar.assets'), summarize(r));
    // キーが違う例外は抑止しない
    editExceptions(dir, (e) => {
      const x = e.exceptions.find((y) => y.type === 'omission');
      x.key = 'navbar.edit_map';
    });
    const r2 = run(dir);
    check('例外: キーが違う例外は抑止しない（赤）', r2.status === 1, summarize(r2));
  }

  // ───────────── 関門 1・2 ─────────────
  {
    const dir = makeRepo('gate-glossary-only');
    const base = git(dir, 'rev-parse', 'HEAD');
    editGlossary(dir, (g) => g.concepts.find((c) => c.id === 'map').locales.de.acceptedForms.push('landkarte'));
    run(dir, ['--write']);
    commitAll(dir, 'glossary');
    const r = run(dir, ['--base', base]);
    check('関門: 正本だけの PR は関門 1 を通り、要約が出る', r.status === 0 && /landkarte/.test(r.report?.glossaryChangeSummary ?? ''), summarize(r));
  }
  {
    const dir = makeRepo('gate-locale-only');
    const base = git(dir, 'rev-parse', 'HEAD');
    setValue(dir, 'ja', 'common.save', '保存');
    setValue(dir, 'de', 'common.save', 'Speichern!');
    commitAll(dir, 'locale');
    const r = run(dir, ['--base', base]);
    check('関門: locale だけの PR は関門 1 を通り、要約は出ない', r.status === 0 && !r.report?.glossaryChangeSummary, summarize(r));
  }
  {
    const dir = makeRepo('gate-both');
    const base = git(dir, 'rev-parse', 'HEAD');
    setValue(dir, 'de', 'common.save', 'Speichern!');
    editGlossary(dir, (g) => g.concepts.find((c) => c.id === 'map').locales.de.acceptedForms.push('landkarte'));
    commitAll(dir, 'both');
    const r = run(dir, ['--base', base]);
    check('関門: 正本と locale を両方変える PR は赤', r.status === 1 && findings(r, (v) => v.kind === 'gate').length === 1, summarize(r));
    const r2 = run(dir, ['--base', 'f'.repeat(40)]);
    check('関門: base を解決できなければ赤（fail-closed）', r2.status === 1, summarize(r2));
  }
  {
    const dir = makeRepo('gate-script');
    const base = git(dir, 'rev-parse', 'HEAD');
    setValue(dir, 'de', 'common.save', 'Speichern!');
    writeFileSync(path.join(dir, 'scripts', 'editor-glossary-check.mjs'), `${readFileSync(path.join(dir, 'scripts', 'editor-glossary-check.mjs'), 'utf8')}\n// 緩める変更\n`);
    commitAll(dir, 'script and locale');
    const r = run(dir, ['--base', base]);
    check('関門: 検査 script と locale を同じ PR で変えると赤', r.status === 1 && findings(r, (v) => v.kind === 'gate').length === 1, summarize(r));
  }
  {
    const dir = makeRepo('gate-first', { withGlossary: false });
    const base = git(dir, 'rev-parse', 'HEAD');
    cpSync(path.join(root, 'docs', 'i18n'), path.join(dir, 'docs', 'i18n'), { recursive: true });
    setValue(dir, 'de', 'common.save', 'Speichern!');
    commitAll(dir, 'first PR');
    const r = run(dir, ['--base', base]);
    check('関門: base に正本が無い PR（初版）は関門 1 をかけない', r.status === 0 && findings(r, (v) => v.kind === 'gate').length === 0, summarize(r));
  }
  {
    const dir = makeRepo('gate-generated');
    const base = git(dir, 'rev-parse', 'HEAD');
    setValue(dir, 'ja', 'common.ok_new_key_for_fixture', 'アセットを開く');
    for (const l of LANGS.filter((x) => x !== 'ja')) setValue(dir, l, 'common.ok_new_key_for_fixture', { en: 'Open asset', de: 'Asset öffnen', es: 'Abrir recurso', fr: 'Ouvrir la ressource', id: 'Buka aset', ko: '에셋 열기', th: 'เปิดทรัพยากร', vi: 'Mở tài nguyên', zh: '打开素材', 'zh-TW': '開啟素材' }[l]);
    run(dir, ['--write']);
    commitAll(dir, 'locale and generated');
    const changed = git(dir, 'diff', '--name-only', base, 'HEAD');
    const r = run(dir, ['--base', base]);
    check('関門: 生成物と locale を一緒に変える PR は通る', r.status === 0 && changed.includes('editor-glossary.bindings.json'), summarize(r));
  }

  // ───────────── 代表語・構造 ─────────────
  {
    const dir = makeRepo('representative');
    setValue(dir, 'ja', 'navbar.assets', 'アイテム管理');
    run(dir, ['--write']);
    const r = run(dir);
    check('代表語: 根拠キーの値から代表語を消すと赤', r.status === 1 && findings(r, (v) => v.kind === 'representative' && v.concept === 'asset' && v.lang === 'ja').length === 1, summarize(r));
  }
  {
    const dir = makeRepo('missing-lang');
    rmSync(path.join(dir, 'public', 'locales', 'th'), { recursive: true });
    const r = run(dir);
    check('構造: 11 言語の脱落は赤', r.status === 1 && findings(r, (v) => v.kind === 'structure' && /th/.test(v.message)).length > 0, summarize(r));
  }
  {
    const dir = makeRepo('dup-key');
    const file = localePath(dir, 'de');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^\{\n/, '{\n  "navbar": {},\n'));
    const r = run(dir);
    check('構造: locale の重複キーは赤', r.status === 1 && findings(r, (v) => v.kind === 'structure' && /duplicate/i.test(v.message)).length > 0, summarize(r));
  }
  {
    const dir = makeRepo('dup-key-glossary');
    const file = path.join(dir, 'docs', 'i18n', 'editor-glossary.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^\{\n/, '{\n  "version": 1,\n'));
    const r = run(dir);
    check('構造: 正本の重複キーは赤', r.status === 1 && findings(r, (v) => v.kind === 'structure' && /duplicate/i.test(v.message)).length > 0, summarize(r));
  }
  {
    const dir = makeRepo('non-string');
    setValue(dir, 'fr', 'common.save', 42);
    const r = run(dir);
    check('構造: 文字列でない leaf は赤', r.status === 1 && findings(r, (v) => v.kind === 'structure' && /common\.save/.test(v.message)).length > 0, summarize(r));
  }
  {
    const dir = makeRepo('schema');
    editGlossary(dir, (g) => {
      g.concepts.find((c) => c.id === 'map').locales.de.acceptedForms.push('');
      g.concepts.push({ ...g.concepts[0] });
    });
    const r = run(dir);
    check('構造: 空語・概念 ID の重複は赤', r.status === 1 && findings(r, (v) => v.kind === 'structure').length >= 2, summarize(r));
  }
  {
    const dir = makeRepo('stale');
    const file = path.join(dir, 'docs', 'i18n', 'editor-glossary.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n手で足した行\n`);
    const r = run(dir);
    check('構造: 生成物の古さ（md の手編集）は赤', r.status === 1 && findings(r, (v) => v.kind === 'generated').length === 1, summarize(r));
    run(dir, ['--write']);
    const r2 = run(dir);
    check('構造: --write で生成物を書き直すと緑（locale と正本には書かない）', r2.status === 0 && git(dir, 'status', '--porcelain').split('\n').filter(Boolean).every((l) => !/locales|editor-glossary\.json|exceptions/.test(l)), summarize(r2));
  }
  {
    const dir = makeRepo('parity');
    setValue(dir, 'ko', 'common.save', '');
    setValue(dir, 'vi', 'common.cancel', undefined);
    const p = spawnSync(process.execPath, [path.join(dir, 'scripts', 'editor-locale-parity.mjs')], { encoding: 'utf8' });
    check('構造: 空値・キーの脱落は parity で赤', p.status === 1 && /empty: common\.save/.test(p.stderr) && /missing: common\.cancel/.test(p.stderr), p.stderr);
  }

  // ───────────── CI の最終判定への伝播 ─────────────
  {
    const dir = makeRepo('ci');
    writeJson(path.join(dir, 'package.json'), { name: 'fixture', private: true, scripts: { 'smoke:editor-glossary': 'node scripts/editor-glossary-check.mjs' } });
    mkdirSync(path.join(dir, 'ci'), { recursive: true });
    writeJson(path.join(dir, 'ci', 'test-exclusions.json'), { schema: 1, policy: 'fixture', smoke: [], e2e: [] });
    const smokes = (tag) => {
      const rep = path.join(dir, `smoke-report-${tag}.json`);
      const a = spawnSync(process.execPath, [path.join(root, 'scripts', 'ci', 'run-smokes.mjs'), '--root', dir, '--report', rep], { encoding: 'utf8', env });
      const b = spawnSync(process.execPath, [path.join(root, 'scripts', 'ci', 'judge-test-results.mjs'), 'smoke', '--root', dir, '--report', rep], { encoding: 'utf8', env });
      return { run: a, judge: b };
    };
    const green = smokes('green');
    check('CI: 緑の状態では最終判定が緑', green.judge.status === 0, green.judge.stdout + green.judge.stderr);
    setValue(dir, 'ja', 'navbar.assets', '資産管理');
    const red = smokes('red');
    check('CI: 用語検査の失敗が最終判定の失敗に伝わる', red.run.status === 0 && red.judge.status !== 0, red.judge.stdout + red.judge.stderr);
  }
} finally {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
}

console.log(`\neditor-glossary fixtures: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
