// nov26-editor-splash-svg smoke: スプラッシュ画像に SVG を指定できるようにする変更のソース契約。
//
// 人間の決定（#462）:
//   - スプラッシュの元画像に SVG を指定できる（処理だけでなく、画像の指定ダイアログの拡張子でも選べる）
//   - SNS のカード画像（og:image）は「SVG から PNG を描いて使う」
//
//   (a) 画像の指定: スプラッシュの filter に svg がある。共通の IMAGE_FILTERS は変えない
//       （PWA アイコン・アセット・地図画像は従来どおり）
//   (b) 取り込み: uploadSplash は SVG を XML として確かめ（ルート svg・大きさあり）、
//       `{uuid}.svg` で img/ へ複製する。壊れた SVG は InvalidImage
//       【NOV26-SR-M12-C1-0465 SR-C1-M-1】文字参照で書いた javascript:/vbscript:/data:・
//       XHTML（および他の）名前空間の要素・属性・DTD の内部実体・style の expression(/@import は拒否する。
//       【NOV26-IM-M12-SVG-HARDEN-0474】style の url( は一律に拒否せず、デコードした中身が
//       文書内参照（url(#id)）のときだけ通す（イラレは .st0{fill:url(#SVGID_1_);} でグラデーションを引く）
//       【NOV26-IM-M12-SVG-HARDEN-0478】文書の先頭の XML 宣言以外の処理命令（xml-stylesheet 等）・
//       許可リスト外の SVG 名前空間の要素（handler・listener・unknownElement 等）・SMIL のアニメーションで
//       参照・style・イベントを指す attributeName・アニメーションの値に書いた javascript:/vbscript:/data: は拒否する。
//       一方、Inkscape 1.x の既定保存（Inkscape SVG）のメタデータ（inkscape/sodipodi/RDF/DC/CC）は通す
//       【NOV26-IM-M12-SVG-HARDEN-0479】レビュー（Major 3・Minor 1）の決定: SMIL の属性は名前空間なしの
//       完全一致の名前で引き（同じ局所名が名前空間違いで複数あれば拒否）・DOCTYPE の内部サブセットは
//       まるごと拒否（外部 ID だけは通す）・XML 宣言の encoding は UTF-8 か未指定だけ・BOM は UTF-8 の
//       ものだけ・`<style>` と style 属性の CSS に `\`（エスケープ）があれば拒否
//   (c) 保存前の表示: 拡張子 allowlist を経路で分ける（スプラッシュは svg 可・アセットは不可）
//   (d) 書き出し: スプラッシュの複製と app JSON の splash は拡張子のまま。og:image は
//       SVG のとき Chromium で描いた PNG（1200x630・背景で余白）
//   (e) Maplat UI はスプラッシュを <img> の src で表示する（innerHTML に中身を入れない）
//   (f) 警告の文言が 11 言語にある
//
// 実挙動は e2e（tests/e2e/nov26-editor-splash-svg.spec.ts）が担う。ここは純関数と
// 「呼び忘れ・経路の取り違え」を安いコストで常時検出するためのソーステキスト検査である。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// electron 非依存の純粋モジュール（node の型ストリップで直接読む）
import { IMAGE_FILTERS, PWA_ICON_IMAGE_FILTERS, SPLASH_IMAGE_FILTERS } from "../electron/utils/imagePickFilters.ts";
import {
  checkSvgBytes,
  checkSvgMarkup,
  isSvgExt,
  svgIntrinsicSize,
  svgIntrinsicSizeFromBytes,
} from "../electron/utils/svgSource.ts";
import {
  ASSET_PREVIEW_ALLOWED_EXTS,
  SPLASH_PREVIEW_ALLOWED_EXTS,
  mimeForPreviewExt,
  validatePreviewRequest,
} from "../electron/utils/pickedPreviewSource.ts";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");

// クラスのメソッド本体（`  async name(...) {` から 2 桁インデントの `}` まで）を取り出す
function methodOf(source, name) {
  const start = Math.max(
    source.indexOf(`  async ${name}(`),
    source.indexOf(`  private async ${name}(`),
  );
  assert.ok(start >= 0, `${name}() がソースに見つからない`);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(end > start, `${name}() の終わりが見つからない`);
  return source.slice(start, end);
}

// --- (a) 画像の指定: スプラッシュだけ svg を足す ---------------------------------
{
  const plain = IMAGE_FILTERS.flatMap((filter) => filter.extensions);
  assert.deepEqual(plain, ["png", "jpg", "jpeg", "gif", "webp"], "共通の IMAGE_FILTERS は変えない");
  const splash = SPLASH_IMAGE_FILTERS.flatMap((filter) => filter.extensions);
  assert.ok(splash.includes("svg"), "スプラッシュの filter に svg がない（人間が拡張子で選べるようにする指示）");
  for (const ext of plain) assert.ok(splash.includes(ext), `スプラッシュの filter から ${ext} が消えている`);

  const service = await readSrc("electron/services/AppAssetService.ts");
  assert.match(service, /async pickImage\(win: BrowserWindow, filters: ImageFilter\[\] = IMAGE_FILTERS\)/, "pickImage が filter を引数で受ける形になっていない（既定は共通の集合）");
  // uploadSplash だけがスプラッシュ用の filter を使う
  const uploadSplash = methodOf(service, "uploadSplash");
  assert.match(uploadSplash, /pickImage\(\s*win\s*,\s*SPLASH_IMAGE_FILTERS\s*\)/, "uploadSplash がスプラッシュ用 filter で選んでいない");
  const others = [
    methodOf(service, "replaceMapThumbnail"),
    methodOf(service, "uploadPwaIcon"),
  ];
  for (const body of others) {
    assert.doesNotMatch(body, /SPLASH_IMAGE_FILTERS/, "スプラッシュ以外の経路に svg を足している");
  }
  // アセット（AssetEdit）のピッカも変えていない
  const assetsImages = await readSrc("electron/ipc/assets-images.ts");
  assert.match(
    assetsImages,
    /filters:\s*\[\{\s*name:\s*'Images',\s*extensions:\s*\['png',\s*'jpg',\s*'jpeg',\s*'gif'\]\s*\}\]/,
    "アセット取り込みのフィルタが変わっている",
  );
  assert.doesNotMatch(assetsImages, /extensions:[^\n]*svg/, "アセット取り込みのフィルタに svg を足している");
}
console.log("ok: (a) スプラッシュの filter だけに svg を足し、他の経路は変えない");

// --- (b) SVG の取り込み ---------------------------------------------------------
{
  assert.equal(isSvgExt("svg"), true);
  assert.equal(isSvgExt(".SVG"), true);
  assert.equal(isSvgExt("png"), false);
  assert.equal(isSvgExt(undefined), false);

  const valid = [
    // width/height（px・単位なし）
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#00f"/></svg>',
    // viewBox だけ
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><circle cx="150" cy="100" r="50"/></svg>',
    // 宣言・コメント・DOCTYPE・名前空間つきルート
    '<?xml version="1.0" encoding="UTF-8"?>\n<!-- コメント -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="100px" height="50px"><svg:g/><svg:g></svg:g></svg:svg>\n',
    // CDATA と自己終了・属性の並び
    '<svg width="10" height="10"><style><![CDATA[ .a { fill: red; } ]]></style><path d="M0 0h10v10z" /></svg>',
    // % 指定でも viewBox があれば大きさが決まる（実在の書き方）
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><text x="1" y="2">a &amp; b</text></svg>',
    // DOCTYPE の内部サブセット（`[ ... ]`）は
    // 【NOV26-IM-M12-SVG-HARDEN-0479】まるごと拒否の側へ移した（ATTLIST の既定値で検査の見ていない
    // 属性を補えるため）。外部 ID だけの DOCTYPE は今までどおり通す
    '<!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg width="1" height="1"/>',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg width="1" height="1"/>',
    // 【NOV26-IM-M12-SVG-HARDEN-0479】XML 宣言の encoding は書かないか `UTF-8` だけ
    // （大文字小文字・前後の空白は問わない）
    '<?xml version="1.0"?><svg width="1" height="1"/>',
    '<?xml version="1.0" encoding="UTF-8"?><svg width="1" height="1"/>',
    '<?xml version="1.0" encoding="utf-8" standalone="no"?><svg width="1" height="1"/>',
    '<?xml version="1.0" encoding=" utf-8 "?><svg width="1" height="1"/>',
    // BOM は UTF-8 のもの（1 つだけ）を今までどおり許す
    '\uFEFF<svg width="1" height="1"/>',
    // Illustrator の典型的な書き出し（xlink の宣言・style 要素・xml:space・fill="url(#id)" は属性なので可）
    '<?xml version="1.0" encoding="utf-8"?>\n'
      + '<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n'
      + '<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
      + ' x="0px" y="0px" viewBox="0 0 100 100" style="enable-background:new 0 0 100 100;" xml:space="preserve">\n'
      + '<style type="text/css">\n\t.st0{fill:#FFFFFF;}\n\t.st1{fill:none;stroke:#000000;stroke-width:2;}\n</style>\n'
      + '<rect class="st0" width="100" height="100"/>\n'
      + '<circle class="st1" cx="50" cy="50" r="20"/>\n'
      + '<defs><linearGradient id="SVGID_1_"><stop offset="0" stop-color="#fff"/></linearGradient></defs>\n'
      + '<rect x="0" y="0" width="10" height="10" fill="url(#SVGID_1_)"/>\n'
      + '</svg>\n',
    // Inkscape の書き出し（メタデータの名前空間なしで保存したもの）
    '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
      + ' width="210mm" height="297mm" viewBox="0 0 210 297" version="1.1"><defs>'
      + '<g id="arrow"><path d="M0,0 L10,5 L0,10 z"/></g></defs>'
      + '<use xlink:href="#arrow" x="10" y="10"/><a href="https://example.com/"><text x="1" y="2">link</text></a></svg>',
    // Figma の書き出し
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M12 2L2 22h20L12 2z" fill="#1E1E1E"/></svg>',
    // 手書きの典型（名前空間の宣言なし・数値の文字参照・定義済み 5 実体）
    '<svg viewBox="0 0 8 8"><title>a &#38; b</title><path d="M0 0 8 8" stroke="black" stroke-width="1"/></svg>',
    // 【NOV26-IM-M12-SVG-HARDEN-0474】url( は文書内参照（`#` で始まる名前）だけを許す。
    // Illustrator のグラデーション参照の実在の形（style 属性・<style>・引用符つき・空白つき）
    '<svg width="10" height="10"><rect style="fill:url(#SVGID_1_);" width="1" height="1"/></svg>',
    '<svg width="10" height="10"><style>.st0{fill:url(#SVGID_1_);}</style><rect class="st0" width="1" height="1"/></svg>',
    '<svg width="10" height="10"><style>.st0{fill:url(\'#a\');}</style><rect class="st0" width="1" height="1"/></svg>',
    '<svg width="10" height="10"><style>.st0{fill:url( "#a" );}</style><rect class="st0" width="1" height="1"/></svg>',
    // 文字参照を挟んだ url( も、デコードした結果が文書内参照なら通す（以前は一律に拒否していた）
    '<svg width="10" height="10"><style>.a{fill:u&#114;l(#a)}</style><rect width="1" height="1"/></svg>',
    // CDATA に書かれた <style> の中身も同じ扱い（以前は一律に拒否していた）
    '<svg width="10" height="10"><style><![CDATA[ .a{fill:url(#a)} ]]></style><rect width="1" height="1"/></svg>',
    // style 属性の文書内参照（以前は一律に拒否していた）
    '<svg width="10" height="10"><rect style="fill:url(#g)" width="1" height="1"/></svg>',
    // 【NOV26-IM-M12-SVG-HARDEN-0478】Inkscape 1.x の既定保存（Inkscape SVG）。
    // inkscape・sodipodi・RDF・Dublin Core・Creative Commons のメタデータは図柄に効かないので通す。
    // 無害な SMIL のアニメーション（opacity の 0→1）も通す
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
      + '<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#"'
      + ' xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:svg="http://www.w3.org/2000/svg"'
      + ' xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"'
      + ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" id="svg8"'
      + ' width="210mm" height="297mm" viewBox="0 0 210 297" inkscape:version="1.2.2" sodipodi:docname="drawing.svg">\n'
      + '  <defs id="defs2"/>\n'
      + '  <sodipodi:namedview id="base" pagecolor="#ffffff" bordercolor="#666666" inkscape:zoom="0.35"'
      + ' inkscape:cx="400" inkscape:cy="560"><inkscape:page x="0" y="0" width="210" height="297" id="page1"/></sodipodi:namedview>\n'
      + '  <metadata id="metadata5"><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format>'
      + '<dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/></cc:Work></rdf:RDF></metadata>\n'
      + '  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1"><rect width="100" height="50" fill="#39f">'
      + '<animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></rect></g>\n'
      + '</svg>\n',
    // メタデータの要素の中でも、SVG の要素は許可リストで見る（メタデータの中の図柄はそのまま通す）
    '<svg xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="10" height="10">'
      + '<sodipodi:namedview><rect width="1" height="1"/></sodipodi:namedview></svg>',

    // 【NOV26-IM-M12-SVG-HARDEN-0480】埋め込みのラスター画像（PNG/JPEG/GIF/WebP の base64）は
    // `image`・`feImage` の href／xlink:href に限って通す。Illustrator・Inkscape は図を
    // 埋め込むとこの形で書き出す（今までは一律に拒否していて、画像入りの SVG を取り込めなかった）
    '<?xml version="1.0" encoding="utf-8"?>\n'
      + '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
      + ' x="0px" y="0px" viewBox="0 0 100 100">\n'
      + '<image style="overflow:visible;" width="100" height="100" xlink:href="data:image/png;base64,'
      + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="'
      + ' transform="matrix(1 0 0 1 0 0)"></image>\n'
      + '</svg>\n',
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
      + ' width="210mm" height="297mm" viewBox="0 0 210 297" version="1.1">\n'
      + '  <image width="10" height="10" x="0" y="0" preserveAspectRatio="none"'
      + ' xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="/>\n'
      + '</svg>\n',
    // 空白（改行・タブ）を挟んだ base64 も通す
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><image width="1" height="1"'
      + ' xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8\n\tz8BQDwAEAhQGAhKmMIQAAAABJRU5ErkJggg==="/></svg>',
    // 属性名と値の引用符・対応する 4 つの型
    '<svg width="10" height="10"><image href="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAA==" width="1" height="1"/></svg>',
    "<svg width='10' height='10'><image x='0' y='0' width='1' height='1' href='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'/></svg>",
    '<svg width="10" height="10"><image href="data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==" width="1" height="1"/></svg>',
    // feImage も同じ扱い（フィルタの入力に埋め込み画像を使う）
    '<svg width="10" height="10"><defs><filter id="f"><feImage href="data:image/pnG;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" result="r"/></filter></defs><rect filter="url(#f)" width="1" height="1"/></svg>',
  ];
  for (const text of valid) {
    assert.deepEqual(checkSvgMarkup(text), { ok: true }, `正しい SVG を弾いた: ${text.slice(0, 60)}`);
  }

  const invalid = [
    ["", "空"],
    ["not a svg at all", "XML でない"],
    ['<svg width="10" height="10"><g></svg>', "閉じていない"],
    ['<svg width="10" height="10">', "ルートが閉じていない"],
    ['<html><body/></html>', "ルートが svg でない"],
    ['<svg><rect/></svg>', "大きさがない"],
    ['<svg width="10"><rect/></svg>', "width だけ（height がない）"],
    ['<svg width="0" height="10"/>', "width が 0"],
    ['<svg viewBox="0 0 0 10"/>', "viewBox が 0 幅"],
    ['<svg width="10" height="10"><rect width="10" height="10"></svg>', "タグの対応が取れていない"],
    ['<svg width="10" height="10">a & b</svg>', "エスケープされていない &"],
    ['<svg width="10" height="10"></svg><svg width="10" height="10"></svg>', "ルートが 2 つ"],
    ['<svg width="10" height="10"><!-- 閉じない </svg>', "コメントが閉じていない"],
    ['<svg width="10" height="10" width="20"/>', "同じ属性が 2 つ"],
    ['<svg width="10" height="10"/><', "末尾に壊れた文字"],
    // NOV26-IR-EDITOR-SPLASH-SVG-0464 MINOR-2: 書き出したサイトで直接開かれても script が動かないように
    ['<svg width="10" height="10"><script>alert(1)</script></svg>', "script 要素"],
    ['<svg xmlns:s="http://www.w3.org/2000/svg" width="10" height="10"><s:script>x</s:script></svg>', "名前空間つきの script"],
    ['<svg width="10" height="10" onload="alert(1)"/>', "onload 属性"],
    ['<svg width="10" height="10"><rect ONCLICK="x" width="1" height="1"/></svg>', "大文字のイベント属性"],
    ['<svg width="10" height="10"><a href=" javascript:alert(1)"><rect width="1" height="1"/></a></svg>', "javascript: の参照"],
    ['<svg width="10" height="10"><foreignObject width="10" height="10"><div/></foreignObject></svg>', "foreignObject"],

    // 【NOV26-SR-M12-C1-0465 SR-C1-M-1】1. 文字参照で書いた javascript:（字面だけの検査をすり抜ける）
    ['<svg width="10" height="10"><a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>', "10 進の文字参照の javascript:"],
    ['<svg width="10" height="10"><a href="&#x6A;avascript:alert(1)"><rect width="1" height="1"/></a></svg>', "16 進の文字参照の javascript:"],
    ['<svg width="10" height="10"><a href="&#0000106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>', "0 詰めの文字参照の javascript:"],
    ['<svg width="10" height="10"><a href="java&#9;script:alert(1)"><rect width="1" height="1"/></a></svg>', "タブを挟んだ javascript:"],
    ['<svg width="10" height="10"><a href="java&#10;script:alert(1)"><rect width="1" height="1"/></a></svg>', "改行を挟んだ javascript:"],
    ['<svg width="10" height="10"><a href="java&#x0d;&#x0a;script:alert(1)"><rect width="1" height="1"/></a></svg>', "CR LF を挟んだ javascript:"],
    ['<svg xml:space="preserve" width="10" height="10"><a href="&#x6a;avascript:alert(1)"><rect width="1" height="1"/></a></svg>', "xml:space と併用した文字参照の javascript:"],
    ['<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><a xlink:href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>', "xlink:href の文字参照の javascript:"],
    ['<svg width="10" height="10"><a href="&#118;bscript:msgbox(1)"><rect width="1" height="1"/></a></svg>', "文字参照の vbscript:"],
    ['<svg width="10" height="10"><image href="&#100;ata:text/html,&lt;script&gt;" width="1" height="1"/></svg>', "文字参照の data: の参照"],
    ['<svg width="10" height="10"><use href="&#100;ata:image/svg+xml,&lt;svg/&gt;" width="1" height="1"/></svg>', "data: を use で参照"],

    // 【NOV26-SR-M12-C1-0465 SR-C1-M-1】2. XHTML 名前空間の要素
    ['<svg xmlns:html="http://www.w3.org/1999/xhtml" width="10" height="10"><html:iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/></svg>', "XHTML の接頭辞つき iframe"],
    ['<svg width="10" height="10"><iframe xmlns="http://www.w3.org/1999/xhtml" srcdoc="x"/></svg>', "既定の名前空間を XHTML にした iframe"],
    ['<svg xmlns:h="http://www.w3.org/1999/xhtml" width="10" height="10"><g><h:p>よみこみ</h:p></g></svg>', "入れ子の中の XHTML 要素"],
    ['<svg xmlns:h="http://www.w3.org/1999/xhtml" h:x="1" width="10" height="10"/>', "XHTML 名前空間の属性"],
    ['<svg xmlns="http://www.w3.org/1999/xhtml" width="10" height="10"/>', "ルート自体を XHTML にした"],
    ['<svg width="10" height="10"><g xmlns="http://www.w3.org/1999/xhtml"><p>x</p></g></svg>', "途中で既定の名前空間を XHTML に切り替えた"],
    ['<svg width="10" height="10"><undeclared:x/></svg>', "宣言していない接頭辞"],
    // 【NOV26-IM-M12-SVG-HARDEN-0478】通すのは上に挙げた 5 つのメタデータの名前空間だけ。
    // 古い sodipodi の名前空間（0.0.dtd）と Illustrator の i: は今までどおり拒否する
    ['<svg xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd" width="10" height="10"><sodipodi:namedview/></svg>', "許可していない sodipodi の名前空間（0.0.dtd）"],
    ['<svg xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/" width="10" height="10"><i:pgf/></svg>', "Illustrator の i: のメタデータ"],

    // 【NOV26-SR-M12-C1-0465 SR-C1-M-1】3. DTD の内部実体
    ['<?xml version="1.0"?><!DOCTYPE svg [ <!ENTITY x "javascript:alert(1)"> ]><svg width="10" height="10"><a href="&x;"><rect width="1" height="1"/></a></svg>', "実体を属性で参照"],
    ['<?xml version="1.0"?><!DOCTYPE svg [ <!ENTITY x "<script>alert(1)</script>"> ]><svg width="10" height="10"><text>&x;</text></svg>', "実体を本文で参照"],
    ['<?xml version="1.0" standalone="no"?><!DOCTYPE svg [ <!ENTITY foo "bar"> ]><svg width="1" height="1"/>', "使っていない実体の宣言（以前は通していた例）"],
    ['<!DOCTYPE svg [<!ENTITY % p "<!ENTITY x \'y\'>"> ]><svg width="1" height="1"/>', "パラメータ実体の宣言"],
    ['<!DOCTYPE svg [<!entity x "y">]><svg width="1" height="1"/>', "小文字の実体宣言"],
    ['<svg width="10" height="10"><text>&foo;</text></svg>', "宣言の無い名前つき実体（本文）"],
    ['<svg width="10" height="10"><a href="&foo;"><rect width="1" height="1"/></a></svg>', "宣言の無い名前つき実体（属性）"],
    ['<svg width="10" height="10"><text>&nbsp;</text></svg>', "定義済み 5 以外の HTML の実体"],

    // 【NOV26-SR-M12-C1-0465 SR-C1-M-1】style の expression(・javascript:・@import
    ['<svg width="10" height="10"><style>@import url("http://example.invalid/x.css");</style><rect width="1" height="1"/></svg>', "<style> の @import"],
    ['<svg width="10" height="10"><style>.a{color:&#101;xpression(alert(1))}</style><rect width="1" height="1"/></svg>', "文字参照を挟んだ <style> の expression("],
    ['<svg width="10" height="10"><rect style="width:expression(alert(1))" width="1" height="1"/></svg>', "style 属性の expression("],

    // 【NOV26-IM-M12-SVG-HARDEN-0474】url( のうち文書内参照でないもの
    ['<svg width="10" height="10"><style>.a{fill:url(http://x/a.svg#a)}</style><rect width="1" height="1"/></svg>', "<style> の url( の外部参照（http）"],
    ['<svg width="10" height="10"><rect style="fill:url(data:image/svg+xml;base64,AAAA)" width="1" height="1"/></svg>', "style 属性の url( の data:"],
    ['<svg width="10" height="10"><style>.a{fill:url(a.svg#x)}</style><rect width="1" height="1"/></svg>', "<style> の url( の相対パス"],
    // 文書内参照の後に続く 2 つ目の url( も見る（最初の 1 つだけ見て通さない）
    ['<svg width="10" height="10"><style>.a{fill:url(#a)} .b{fill:url(//x)}</style><rect width="1" height="1"/></svg>', "文書内参照の後に続く url(//x)"],
    ['<svg width="10" height="10"><style>.a{fill:url(\\23 a)}</style><rect width="1" height="1"/></svg>', "<style> の url( の CSS エスケープ"],
    ['<svg width="10" height="10"><style>.a{fill:url()}</style><rect width="1" height="1"/></svg>', "空の url("],
    ['<svg width="10" height="10"><style>.a{fill:url(var(--x))}</style><rect width="1" height="1"/></svg>', "関数の入れ子の url("],
    ['<svg width="10" height="10"><g style="x:java&#9;script:alert(1)"/></svg>', "style 属性の javascript:"],
    ['<svg width="10" height="10"><g STYLE="x:java&#x0a;script:alert(1)"/></svg>', "大文字の style 属性"],

    // 【NOV26-IM-M12-SVG-HARDEN-0478】1. 文書の先頭の XML 宣言以外の処理命令
    ['<?xml-stylesheet href="x.css"?><svg width="10" height="10"/>', "先頭の xml-stylesheet（href つき）"],
    ['<?xml-stylesheet type="text/xsl" href="x.xsl"?><svg width="10" height="10"/>', "先頭の xml-stylesheet（XSLT）"],
    ['<?xml version="1.0"?><?xml version="1.0"?><svg width="10" height="10"/>', "2 つ目の XML 宣言"],
    ['<svg width="10" height="10"><?xml version="1.0"?><rect width="1" height="1"/></svg>', "ルートの中の XML 宣言"],
    ['<svg width="10" height="10"><?xml-stylesheet href="x.css"?><rect width="1" height="1"/></svg>', "ルートの中の xml-stylesheet"],

    // 【NOV26-IM-M12-SVG-HARDEN-0478】2. SMIL のアニメーション
    ['<svg width="10" height="10"><animate attributeName="href" values="#a;javascript:alert(1)" dur="1s" repeatCount="indefinite"/></svg>', "attributeName が href の animate（values に javascript:）"],
    ['<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><set attributeName="xlink:href" to="&#106;avascript:alert(1)"/></svg>', "attributeName が xlink:href の set（文字参照の javascript:）"],
    ['<svg width="10" height="10"><animate attributeName="ONCLICK" values="alert(1)" dur="1s"/></svg>', "attributeName が onclick の animate"],
    ['<svg width="10" height="10"><animate attributeName="style" values="fill:red" dur="1s"/></svg>', "attributeName が style の animate"],
    ['<svg width="10" height="10"><animate attributeName="src" values="a.png" dur="1s"/></svg>', "attributeName が参照の属性（src）の animate"],
    ['<svg width="10" height="10"><animate attributeName="opacity" values="0;java&#115;cript:alert(1)" dur="1s"/></svg>', "values の 2 つ目が文字参照の javascript:"],
    ['<svg width="10" height="10"><animate attributeName="opacity" from="0" to="data:text/html,x" dur="1s"/></svg>', "to の data:"],
    ['<svg width="10" height="10"><animate attributeName="opacity" by="&#118;bscript:msgbox(1)" dur="1s"/></svg>', "by の文字参照の vbscript:"],
    ['<svg width="10" height="10"><animateMotion dur="1s"><mpath href="&#100;ata:image/svg+xml,&lt;svg/&gt;"/></animateMotion></svg>', "mpath の data: の参照"],

    // 【NOV26-IM-M12-SVG-HARDEN-0478】3. 許可リスト外の SVG 名前空間の要素
    ['<svg width="10" height="10"><handler type="application/ecmascript">alert(1)</handler></svg>', "handler"],
    ['<svg width="10" height="10"><listener event="load" handler="#x"/></svg>', "listener"],
    ['<svg width="10" height="10"><unknownElement/></svg>', "許可リスト外の要素"],
    ['<svg xmlns:svg="http://www.w3.org/2000/svg" width="10" height="10"><svg:handler/></svg>', "接頭辞つきの許可リスト外の要素"],

    // 【NOV26-IM-M12-SVG-HARDEN-0478】4. メタデータ名前空間の子孫でも名前空間の判定はそのまま
    ['<svg xmlns:i="http://www.inkscape.org/namespaces/inkscape" xmlns:h="http://www.w3.org/1999/xhtml" width="10" height="10"><i:foo><h:iframe/></i:foo></svg>', "inkscape の要素の子の XHTML の iframe"],
    ['<svg xmlns:i="http://www.inkscape.org/namespaces/inkscape" xmlns:h="http://www.w3.org/1999/xhtml" width="10" height="10"><i:foo h:x="1"/></svg>', "メタデータの要素の XHTML 名前空間の属性"],

    // 【NOV26-IM-M12-SVG-HARDEN-0479】1. SMIL の属性は名前空間なしの属性だけを完全一致の名前で引く。
    // 接頭辞を落とした局所名で最初の値を返していたため、`inkscape:attributeName` を本物より前に
    // 置くと本物の `attributeName="href"` を見落とせた
    ['<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10" height="10"><animate inkscape:attributeName="x" attributeName="href" inkscape:values="0" values="#a;javascript:alert(1)"/></svg>', "メタデータの接頭辞を本物の属性の前に置いた animate"],
    ['<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10" height="10"><animate attributeName="href" inkscape:attributeName="x" values="#a;javascript:alert(1)" inkscape:values="0"/></svg>', "属性の順を入れ替えた同上"],
    ['<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10" height="10"><animate attributeName="opacity" inkscape:attributeName="x" values="0;1" dur="1s"/></svg>', "同じ局所名の属性が名前空間違いで 2 つある animate"],

    // 【NOV26-IM-M12-SVG-HARDEN-0479】2. DTD の内部サブセットはまるごと拒否（ATTLIST の既定値で、
    // この検査が見ていない属性を補えるため。`[` `]` の数え方の取り違えも同時に消える）
    ['<!DOCTYPE svg [<!ATTLIST svg onload CDATA "x">]><svg width="10" height="10"/>', "ATTLIST の既定値で onload を補う内部サブセット"],
    ['<?xml version="1.0" standalone="no"?><!DOCTYPE svg [ <!ATTLIST svg foo CDATA #IMPLIED> ]><svg width="1" height="1"/>', "無害に見える ATTLIST の内部サブセット（以前は通していた例）"],
    ['<!DOCTYPE svg [<!ATTLIST svg a CDATA "]">]><svg width="10" height="10"/>', "宣言の中に \"]\" を含む内部サブセット"],
    ['<!DOCTYPE svg [<!ATTLIST svg a CDATA ">">]><svg width="10" height="10"/>', "宣言の中に \">\" を含む内部サブセット"],
    ['<!DOCTYPE svg []><svg width="10" height="10"/>', "空の内部サブセット"],

    // 【NOV26-IM-M12-SVG-HARDEN-0479】3. XML 宣言の encoding は書かないか `UTF-8` だけ
    ['<?xml version="1.0" encoding="ISO-2022-JP"?><svg width="10" height="10"/>', "ISO-2022-JP の宣言"],
    ['<?xml version="1.0" encoding="Shift_JIS"?><svg width="10" height="10"/>', "Shift_JIS の宣言"],
    ['<?xml version="1.0" encoding="UTF-16"?><svg width="10" height="10"/>', "UTF-16 の宣言"],
    ["<?xml version='1.0' encoding='UTF-16LE'?><svg width=\"10\" height=\"10\"/>", "単一引用符の UTF-16LE の宣言"],
    ['<?xml version="1.0" encoding="utf8"?><svg width="10" height="10"/>', "utf8 の綴り違いの宣言"],
    ['\uFFFE<?xml version="1.0"?><svg width="10" height="10"/>', "UTF-16 の BOM を逆の符号で読んだもの"],
    ['\uFEFF\uFEFF<svg width="10" height="10"/>', "BOM が 2 つ"],

    // 【NOV26-IM-M12-SVG-HARDEN-0479】4. CSS のエスケープ（`@\\69 mport`・`\\75 rl(` など）
    ['<svg width="10" height="10"><style>@\\69 mport url("http://example.invalid/x.css");</style><rect width="1" height="1"/></svg>', "<style> のエスケープで書いた @import"],
    ['<svg width="10" height="10"><style>.a{fill:\\75 rl(http://x/a.svg#a)}</style><rect width="1" height="1"/></svg>', "<style> のエスケープで書いた url("],
    ['<svg width="10" height="10"><rect style="fill:\\75 rl(#a)" width="1" height="1"/></svg>', "style 属性のエスケープで書いた url("],
    ['<svg width="10" height="10"><style>.a{color:&#92;65 xpression(alert(1))}</style><rect width="1" height="1"/></svg>', "文字参照で書いた CSS エスケープ"],

    // 【NOV26-IM-M12-SVG-HARDEN-0480】1. 宣言の区切りは引用符を見る。`<!DOCTYPE` はルートより前に
    // 1 回だけ。それ以外の宣言（ATTLIST・ELEMENT・NOTATION・ENTITY）は場所を問わず拒否する
    ['<!DOCTYPE svg SYSTEM "x>" [<!ATTLIST svg onload CDATA "...">]><svg width="10" height="10"/>', "引用符の中の > で区切って内部サブセットを隠した DOCTYPE"],
    ["<!DOCTYPE svg SYSTEM 'x>' [<!ATTLIST svg onload CDATA \"...\">]><svg width=\"10\" height=\"10\"/>", "単一引用符版の同上"],
    ['<!DOCTYPE svg PUBLIC "a>" "b>" [ <!ATTLIST svg onload CDATA "x"> ]><svg width="10" height="10"/>', "PUBLIC の引用符の中の > で区切って内部サブセットを隠した DOCTYPE"],
    ['<!DOCTYPE svg SYSTEM "a"><!DOCTYPE svg SYSTEM "b"><svg width="10" height="10"/>', "2 つ目の DOCTYPE"],
    ['<svg width="10" height="10"/><!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">', "ルートの後の DOCTYPE"],
    ['<!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg width="10" height="10"><!ATTLIST svg onload CDATA "x"></svg>', "ルートの中の ATTLIST"],
    ['<svg width="10" height="10"/><!ATTLIST svg onload CDATA "x">', "ルートの後の ATTLIST"],
    ['<!ATTLIST svg onload CDATA "x"><svg width="10" height="10"/>', "ルートより前の裸の ATTLIST"],
    ['<!ELEMENT svg ANY><svg width="10" height="10"/>', "ELEMENT の宣言"],
    ['<!NOTATION x SYSTEM "http://x"><svg width="10" height="10"/>', "NOTATION の宣言"],
    ['<!ENTITY x "javascript:alert(1)"><svg width="10" height="10"/>', "ルートより前の実体の宣言"],
    ['<!element svg ANY><svg width="10" height="10"/>', "小文字の ELEMENT の宣言"],
    ['<!DoCtYpE svg SYSTEM "a"><!aTtLiSt svg onload CDATA "x"><svg width="10" height="10"/>', "大文字小文字を混ぜた DOCTYPE の後の ATTLIST"],
    ['<!DOCTYPE svg SYSTEM "http://x><svg width="10" height="10"/>', "閉じない引用符の DOCTYPE"],

    // 【NOV26-IM-M12-SVG-HARDEN-0480】2. 埋め込みのラスター画像として通すのは
    // `image`・`feImage` の href／xlink:href の PNG/JPEG/GIF/WebP の base64 だけ
    ['<svg width="10" height="10"><image href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=" width="1" height="1"/></svg>', "image の data:image/svg+xml"],
    ['<svg width="10" height="10"><use href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="1" height="1"/></svg>', "use の data:image/png"],
    ['<svg width="10" height="10"><a href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="><rect width="1" height="1"/></a></svg>', "a の data:image/png"],
    ['<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><image xlink:href="data:image/png;base64,iVBORw0KGgoAA!AAAABJRU5ErkJggg==" width="1" height="1"/></svg>', "base64 に記号の混じる埋め込み画像"],
    ['<svg width="10" height="10"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg%20AAAAA" width="1" height="1"/></svg>', "base64 に % の混じる埋め込み画像"],
    ['<svg width="10" height="10"><image href="data:image/png,&lt;script&gt;alert(1)&lt;/script&gt;" width="1" height="1"/></svg>', "base64 でない data:image/png"],
    ['<svg width="10" height="10"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==&#33;" width="1" height="1"/></svg>', "文字参照で記号を足した埋め込み画像"],
    ['<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><feImage xlink:href="data:image/svg+xml;base64,PHN2Zy8+" result="r"/></svg>', "feImage の data:image/svg+xml"],
  ];
  for (const [text, why] of invalid) {
    const result = checkSvgMarkup(text);
    assert.equal(result.ok, false, `${why} を正しい SVG として通した: ${text.slice(0, 60)}`);
  }

  // 【NOV26-IM-M12-SVG-HARDEN-0479】バイト列の BOM は UTF-8 のものだけを通す。
  // UTF-16 の文書（BOM つき）は UTF-8 として読めないので拒否する
  {
    const encode = (text) => new TextEncoder().encode(text);
    const document = '<?xml version="1.0" encoding="UTF-16"?><svg width="10" height="10"/>';
    const utf16 = (littleEndian) => {
      const bytes = new Uint8Array(2 + document.length * 2);
      bytes[0] = littleEndian ? 0xff : 0xfe;
      bytes[1] = littleEndian ? 0xfe : 0xff;
      for (let i = 0; i < document.length; i += 1) {
        const code = document.charCodeAt(i);
        bytes[2 + i * 2 + (littleEndian ? 0 : 1)] = code & 0xff;
        bytes[2 + i * 2 + (littleEndian ? 1 : 0)] = code >> 8;
      }
      return bytes;
    };
    assert.deepEqual(
      checkSvgBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...encode('<svg width="10" height="10"/>')])),
      { ok: true },
      "UTF-8 の BOM つきの SVG を弾いた",
    );
    assert.equal(checkSvgBytes(utf16(false)).ok, false, "UTF-16BE（FE FF）の BOM つきの SVG を通した");
    assert.equal(checkSvgBytes(utf16(true)).ok, false, "UTF-16LE（FF FE）の BOM つきの SVG を通した");
  }

  const service = await readSrc("electron/services/AppAssetService.ts");
  const uploadSplash = methodOf(service, "uploadSplash");
  assert.match(uploadSplash, /isSvgExt\(/, "uploadSplash が SVG かどうかを見ていない（Jimp は SVG を読めない）");
  assert.match(uploadSplash, /checkSvg(?:Bytes|Markup)\(/, "uploadSplash が SVG の中身を確かめていない");
  assert.match(uploadSplash, /InvalidImage/, "uploadSplash が壊れた SVG に InvalidImage を返さない");
  // 壊れた SVG も今と同じ InvalidImage（新しいエラー名を作らない）
  assert.doesNotMatch(uploadSplash, /err:\s*'InvalidSvg'/, "壊れた SVG 用に新しいエラー名を作っている");
  // 拡張子のまま `{uuid}.svg` で img/ へ複製する
  assert.match(uploadSplash, /newSplashName\(\s*ext\s*\?\?\s*'png'\s*\)/, "内部名の導き方が変わっている");
  assert.ok(
    /if\s*\(ext\)\s*\{[\s\S]*?fs\.copy\(file, dest/.test(uploadSplash),
    "拡張子のある SVG を複製する経路がない（中身を書き換えていない）",
  );
}
console.log("ok: (b) SVG は XML として確かめて {uuid}.svg で複製し、壊れていれば InvalidImage");

// --- (c) 保存前の表示: allowlist を経路で分ける ---------------------------------
{
  assert.deepEqual([...ASSET_PREVIEW_ALLOWED_EXTS], ["png", "jpg", "jpeg", "gif"], "アセットの allowlist に svg を足している");
  assert.ok(SPLASH_PREVIEW_ALLOWED_EXTS.includes("svg"), "スプラッシュの allowlist に svg がない");
  for (const ext of ASSET_PREVIEW_ALLOWED_EXTS) {
    assert.ok(SPLASH_PREVIEW_ALLOWED_EXTS.includes(ext), `スプラッシュの allowlist から ${ext} が消えている`);
  }
  // 既定（アセット経路）は svg を通さない
  assert.equal(mimeForPreviewExt("svg"), null, "アセット経路の MIME に svg が生えている");
  assert.deepEqual(validatePreviewRequest({ ext: "svg", byteSize: 1024 }), { ok: false, code: "unsupported" });
  // スプラッシュ経路は svg を data: URL で表示できる
  assert.equal(mimeForPreviewExt("svg", SPLASH_PREVIEW_ALLOWED_EXTS), "image/svg+xml");
  assert.deepEqual(
    validatePreviewRequest({ ext: "svg", byteSize: 1024, allowed: SPLASH_PREVIEW_ALLOWED_EXTS }),
    { ok: true },
  );
  // スプラッシュ経路でも上限・大文字小文字の扱いは同じ
  assert.deepEqual(
    validatePreviewRequest({ ext: "SVG", byteSize: 1024, allowed: SPLASH_PREVIEW_ALLOWED_EXTS }),
    { ok: true },
  );
  assert.equal(mimeForPreviewExt("png", SPLASH_PREVIEW_ALLOWED_EXTS), "image/png");
  assert.deepEqual(
    validatePreviewRequest({ ext: "svg", byteSize: 20 * 1024 * 1024 + 1, allowed: SPLASH_PREVIEW_ALLOWED_EXTS }),
    { ok: false, code: "too-large" },
  );
}
console.log("ok: (c) allowlist は経路ごと（スプラッシュは svg 可・アセットは不可）");

// --- (d) 書き出し ---------------------------------------------------------------
const exportService = await readSrc("electron/services/AppExportService.ts");
{
  // スプラッシュの複製・app JSON は拡張子のまま
  assert.match(exportService, /await fs\.copy\(from, path\.join\(outDir, 'img', exportedSplashName\(appID, splash\)\)\)/, "スプラッシュの複製名が変わっている");
  assert.match(exportService, /out\.splash = exportedSplashName\(String\(document\.appID \|\| ''\)\.trim\(\), splash\)/, "app JSON の splash が変わっている");
  // exportedSplashName の定義は 1 つ（m6-t5 smoke の契約）
  assert.equal((exportService.match(/function exportedSplashName\(/g) || []).length, 1, "exportedSplashName の定義は 1 つ");

  // og:image: SVG のときは Chromium で描いた PNG
  assert.match(exportService, /renderImagePng\(/, "og:image の PNG 化が Chromium の描画を呼んでいない");
  assert.match(exportService, /OG_IMAGE_WIDTH\s*=\s*1200/, "og:image の幅 1200 が定義されていない");
  assert.match(exportService, /OG_IMAGE_HEIGHT\s*=\s*630/, "og:image の高さ 630 が定義されていない");
  assert.match(exportService, /isSvgExt\(/, "書き出しがスプラッシュの拡張子を見ていない");
  assert.match(exportService, /OG_IMAGE_FAILED_WARNING\s*=\s*'appedit\.export\.og_image_failed'/, "描画失敗の警告キーがない");
  // 描画に失敗したら og:image を付けない（rel を undefined に戻す）
  assert.match(
    exportService,
    /catch\s*(?:\([^)]*\))?\s*\{[\s\S]{0,400}OG_IMAGE_FAILED_WARNING[\s\S]{0,200}return undefined;/,
    "og:image の描画失敗で「付けない」経路になっていない",
  );
  // index.html は og:image の相対パスを引数で受ける（splash から毎回導かない）
  assert.match(exportService, /private renderIndexHtml\([^)]*ogImageRel/, "renderIndexHtml が og:image のパスを受け取っていない");
  assert.match(exportService, /if \(ogImageRel\) \{/, "index.html の og:image が出す条件が変わっている");
  // 背景色で余白を埋める（既定 #f6f0d3）
  assert.match(exportService, /renderImagePng\(\{[\s\S]{0,400}background/, "og:image の描画に背景色を渡していない");

  // 描画側: 縦横比を保った contain と背景塗りは pwa と同じ部品を使う
  const renderer = await readSrc("electron/utils/pwaChromiumRenderer.ts");
  assert.match(renderer, /export async function renderImagePng\(/, "renderImagePng がない");
  assert.match(renderer, /canLoadImage\(/, "描く前に画像が読めるかを確かめていない");
  assert.match(renderer, /buildPwaShellHtml\(/, "PWA と同じシェル（背景塗り）を使っていない");
  assert.match(renderer, /object-fit/, "contain の指定が見つからない"); // pwaAssets 側の CSS
  const pwaAssets = await readSrc("electron/utils/pwaAssets.ts");
  assert.match(pwaAssets, /object-fit:contain/, "シェルの CSS から object-fit: contain が消えている");
}
console.log("ok: (d) スプラッシュは拡張子のまま、og:image は SVG のとき PNG（1200x630・背景で余白）");

// --- (e) Maplat UI の表示方法 ---------------------------------------------------
{
  const ui = await readSrc("public/preview/maplat_ui.umd.js");
  assert.match(ui, /splash_img/, "Maplat UI に splash_img がない");
  assert.match(ui, /\.splash_img"\)\.setAttribute\("src"/, "Maplat UI がスプラッシュを <img> の src で表示していない");
  assert.doesNotMatch(ui, /splash_div[^;]{0,200}innerHTML/, "Maplat UI がスプラッシュを innerHTML で入れている");
}
console.log("ok: (e) Maplat UI はスプラッシュを <img src> で表示する（SVG でも描ける）");

// --- (f) 11 言語の文言 ----------------------------------------------------------
{
  const locales = ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"];
  for (const lang of locales) {
    const json = JSON.parse(await readSrc(`public/locales/${lang}/translation.json`));
    const message = json?.appedit?.export?.og_image_failed;
    assert.equal(typeof message, "string", `${lang} に appedit.export.og_image_failed がない`);
    assert.ok(message.trim().length > 0, `${lang} の appedit.export.og_image_failed が空`);
  }
}
console.log("ok: (f) og:image の警告文言が 11 言語にある");

// --- (g) PWA アイコン元画像の SVG（NOV26-IM-PWA-ICON-SOURCE-0481） ---------------------
{
  // 指定ダイアログの filter: PWA アイコンの経路だけ svg を足す（共通の IMAGE_FILTERS は変えない）
  const pwaIcon = PWA_ICON_IMAGE_FILTERS.flatMap((filter) => filter.extensions);
  assert.ok(pwaIcon.includes("svg"), "PWA アイコンの filter に svg がない（人間は拡張子の選択肢を忘れがち）");
  for (const ext of IMAGE_FILTERS.flatMap((filter) => filter.extensions)) {
    assert.ok(pwaIcon.includes(ext), `PWA アイコンの filter から ${ext} が消えている`);
  }
  const service = await readSrc("electron/services/AppAssetService.ts");
  const uploadPwaIcon = methodOf(service, "uploadPwaIcon");
  assert.match(uploadPwaIcon, /pickImage\(\s*win\s*,\s*PWA_ICON_IMAGE_FILTERS\s*\)/, "uploadPwaIcon が PWA アイコン用 filter で選んでいない");
  assert.match(uploadPwaIcon, /isSvgExt\(/, "uploadPwaIcon が SVG かどうかを見ていない（Jimp は SVG を読めない）");
  const saveSvgPwaIcon = methodOf(service, "saveSvgPwaIcon");
  assert.match(saveSvgPwaIcon, /checkSvg(?:Bytes|Markup)\(/, "SVG のアイコンが中身を確かめていない");
  assert.match(saveSvgPwaIcon, /InvalidImage/, "壊れた SVG に InvalidImage を返さない");
  assert.match(saveSvgPwaIcon, /NotSquare/, "正方形判定がない");
  assert.match(saveSvgPwaIcon, /svgIntrinsicSize/, "正方形判定が viewBox/width・height を見ていない");
  assert.match(saveSvgPwaIcon, /renderImagePng\(/, "退避用の PNG を描いていない");
  assert.match(saveSvgPwaIcon, /dest\.replace\(\/\\\.svg\$\/i/, "退避用 PNG の名前が同じ uuid になっていない");

  // SVG の正方形判定は viewBox（無ければ width/height）で行う
  assert.deepEqual(
    svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="10" height="20"/>'),
    { width: 512, height: 512 },
    "viewBox を優先していない",
  );
  assert.deepEqual(
    svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="512px" height="512"/>'),
    { width: 512, height: 512 },
    "viewBox が無いとき width/height を読めていない（px 付き）",
  );
  assert.deepEqual(
    svgIntrinsicSize('<?xml version="1.0"?><!-- c --><svg width="300" height="200"/>'),
    { width: 300, height: 200 },
    "XML 宣言・コメントの後ろのルートを読めていない",
  );
  assert.equal(svgIntrinsicSize('<svg width="100%"/>'), null, "大きさの無い SVG を大きさありとして扱っている");
  assert.deepEqual(
    svgIntrinsicSizeFromBytes(new TextEncoder().encode('<svg viewBox="0 0 100 100"/>')),
    { width: 100, height: 100 },
    "バイト列から大きさを読めていない",
  );
}
console.log("ok: (g) PWA アイコン元画像は svg を選べて、viewBox で正方形を判定する");

console.log("nov26-editor-splash-svg smoke: ALL PASS");
