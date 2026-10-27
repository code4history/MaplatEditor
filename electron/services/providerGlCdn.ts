/**
 * m6-t5: Export / Preview HTML へ条件付きで注入する Mapbox / MapLibre GL CDN タグ。
 * 判断ロジックはここに一元化し、両 HTML 生成器から同一関数を呼ぶ（設計 §4.6）。
 *
 * CDN はパッチ固定 + SRI。
 *
 * MapLibre GL JS は 6 系から ESM だけの配布になり、UMD（`dist/maplibre-gl.js`）が無い。そこで
 * - CSS の `<link>` と、`integrity` 付きの import map（`<script type="importmap">`）を出す
 * - MapLibre を使うアプリに限り、起動のスクリプトを `<script type="module">` にし、動的な `import()` で
 *   読み込んで `window.maplibregl` に入れてから viewer を起動する（renderViewerStartupScript）。
 *   読み込みに失敗しても、エラーを記録して MapLibre のベースマップ抜きで起動する（静的な import だと
 *   起動のスクリプト全体が走らなくなるため、動的な import() を try で包む）
 * - ワーカー（`maplibre-gl-worker.mjs`）は CDN から `blob:` の URL を介して読まれ、import map の
 *   `integrity` は効かない（URL が違い、ワーカーの中では import map が効かない）
 * - 将来プレビューや書き出したアプリに CSP を付けるときは、`script-src https://cdn.jsdelivr.net
 *   https://api.mapbox.com`・`worker-src blob:`・`style-src` に CDN の CSS が要る
 * - MapLibre も Mapbox も使わないアプリの出力は、この対応の前と同じ（断片は空・起動は従来の `<script>`）
 *
 * MapLibre の版はアプリごとに選ぶ（アプリの文書の最上位の `maplibreMajorVersion`。既定は 5）:
 * - 5 系: UMD がある **5.6.2** を `<link>`＋`<script src>` で入れ、起動は従来の `<script>`。版を選べるようにする前の
 *   出力と 1 バイトも変わらない（5 系で動いていたアプリはそのまま動く）
 * - 6 系: 上の ESM の形（import map とモジュールの起動）
 * - 版を決めるのは resolveMaplibreMajor だけ（値が無い・5・不正な値は 5、6 だけが 6）。Export と Preview は
 *   これを 1 回だけ呼び、断片と起動のスクリプトの両方に同じ値を渡す。引数は省略させない（渡し忘れが黙って 5 に
 *   化けると、6 を選んだアプリが 5 で書き出されるため）
 *
 * Mapbox GL JS は 3 系も UMD を配っているので、従来どおり `<script src>` で注入する。
 * peerDeps は `^5 || ^6`・`^2 || ^3`。
 */

export type ProviderGlKind = "mapbox" | "maplibre";

export type ProviderGlSourceLike = {
  maptype?: string | null;
  kind?: string | null;
  data?: { kind?: string | null; maptype?: string | null } | null;
};

/** ピン留め版（MapLibre は 5 系が UMD・6 系が ESM のモジュール、Mapbox は UMD） */
export const PROVIDER_GL_CDN = {
  maplibre5: {
    version: "5.6.2",
    js: "https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.2/dist/maplibre-gl.js",
    css: "https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.2/dist/maplibre-gl.css",
    jsIntegrity:
      "sha384-1qC0PnXk2fgMDybOtZF1ui4LM5Sxm7o0TbEkwfxTTVdlZvuNENNGCKUub7d644HP",
    cssIntegrity:
      "sha384-gNYNsUmuZqDYiT3gbirWTV5K7rt71RoveS/yXAaU09d4ZUmeDVTD3XoqB6uJAIFR",
  },
  maplibre6: {
    version: "6.16.0",
    module: "https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.mjs",
    css: "https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.css",
    moduleIntegrity:
      "sha384-uLwQnFL74rrONqIWx/ubL4wcAtA2h08tbMDZd9U4KbQ7GhaA7S1XKepHU89UkU7C",
    cssIntegrity:
      "sha384-S+OnE5M4U3Qc2nR0RgljGrVs06xqfRg8L7uFk/pOF5+sRuSDG4oKkqKZmFrx7w09",
  },
  mapbox: {
    version: "3.33.0",
    js: "https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js",
    css: "https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.css",
    jsIntegrity:
      "sha384-jdGuG3GDIph+ONsjITkxWmlUE2RR0At6jtOVirn6L/6dYy3WcAVDaBNI3X96rUT0",
    cssIntegrity:
      "sha384-S0a+eT2dLtsB1suB6ZJ/8IX+0d0Fvix9weJQ67L3E+jHOvn6SUKwYXVDyGdMuJtL",
  },
} as const;

/** import map のキーで、起動のスクリプトの `import()` の引数 */
export const MAPLIBRE_IMPORT_SPECIFIER = "maplibre-gl";

/** アプリが選ぶ MapLibre GL JS の系列 */
export type MaplibreMajor = 5 | 6;

/**
 * アプリの文書から MapLibre の系列を決める（main の側の唯一の関数）。文書の最上位の `maplibreMajorVersion` が
 * 数の 6 のときだけ 6、それ以外（無い・5・不正な値）は 5。値が無いときの 5 は、移行の前のデータを読む道
 */
export function resolveMaplibreMajor(document: unknown): MaplibreMajor {
  const value = document && typeof document === "object"
    ? (document as { maplibreMajorVersion?: unknown }).maplibreMajorVersion
    : undefined;
  return value === 6 ? 6 : 5;
}

// google は GL CDN が不要のため、ここは mapbox/maplibre の2種 subset 判定であり
// baseMapEditorDocument の isProviderKind（3種）とは意図的に別述語とする
function sourceKind(s: ProviderGlSourceLike): ProviderGlKind | null {
  const candidates = [s.maptype, s.kind, s.data?.maptype, s.data?.kind];
  for (const c of candidates) {
    if (c === "mapbox" || c === "maplibre") return c;
  }
  return null;
}

/** アプリの sources / ベースマップ一覧から必要な GL を判定（builtin 等の文字列要素は無視） */
export function detectRequiredProviderGl(
  sources: Iterable<ProviderGlSourceLike | string | null | undefined>,
): Set<ProviderGlKind> {
  const out = new Set<ProviderGlKind>();
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    const k = sourceKind(s);
    if (k) out.add(k);
  }
  return out;
}

/**
 * m6-t10 (ADR-0017/0018): アプリ側の viewer 要素は **maptype も kind も持たない**。
 * どちらもマスタ所有へ移し、定義本体は maps/<slug>.json 側に置いたためである。
 * ∴ 合成後の要素を detectRequiredProviderGl へ渡しても mapbox/maplibre を検出できない
 * （m6-t5 AC16 の E2E がこの退行を捕捉した）。GL の要否はマスタの解決結果から判定する。
 *
 * Export と Preview の両 HTML 生成器はこの関数だけを呼ぶ（同一扱いは共通実装へ徹底）。
 */
export function detectRequiredProviderGlFromAppSources(
  sources: Iterable<{ sourceType: string }>,
  resolveMasterData: (source: any) => Record<string, unknown> | null,
): Set<ProviderGlKind> {
  const masters: ProviderGlSourceLike[] = [];
  for (const source of sources) {
    // maplat ソースはベースマップマスタを持たず、GL も要さない
    if (!source || source.sourceType === "maplat") continue;
    const data = resolveMasterData(source);
    if (data) masters.push(data as ProviderGlSourceLike);
  }
  return detectRequiredProviderGl(masters);
}

function tagAttrs(integrity: string): string {
  return ` integrity="${integrity}" crossorigin="anonymous"`;
}

/**
 * `<body>` 内・ol.js より前に挿入する HTML 断片。MapLibre は 5 系なら link + script、6 系なら link + import map。
 * Mapbox は版によらず link + script
 */
export function renderProviderGlCdnTags(
  required: Set<ProviderGlKind>,
  maplibreMajor: MaplibreMajor,
): string {
  const lines: string[] = [];
  if (required.has("maplibre") && maplibreMajor === 6) {
    const pin = PROVIDER_GL_CDN.maplibre6;
    lines.push(
      `  <link rel="stylesheet" href="${pin.css}"${tagAttrs(pin.cssIntegrity)}>`,
    );
    const importMap = {
      imports: { [MAPLIBRE_IMPORT_SPECIFIER]: pin.module },
      integrity: { [pin.module]: pin.moduleIntegrity },
    };
    lines.push(`  <script type="importmap">${JSON.stringify(importMap)}</script>`);
  } else if (required.has("maplibre")) {
    const pin = PROVIDER_GL_CDN.maplibre5;
    lines.push(
      `  <link rel="stylesheet" href="${pin.css}"${tagAttrs(pin.cssIntegrity)}>`,
    );
    lines.push(
      `  <script src="${pin.js}"${tagAttrs(pin.jsIntegrity)}></script>`,
    );
  }
  if (required.has("mapbox")) {
    const pin = PROVIDER_GL_CDN.mapbox;
    lines.push(
      `  <link rel="stylesheet" href="${pin.css}"${tagAttrs(pin.cssIntegrity)}>`,
    );
    lines.push(
      `  <script src="${pin.js}"${tagAttrs(pin.jsIntegrity)}></script>`,
    );
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

// 起動のスクリプトの先頭に置く MapLibre の読み込み。字下げは生成器の <script> の中（4 桁）に合わせる
const MAPLIBRE_LOADER = [
  "    try {",
  `      window.maplibregl = await import('${MAPLIBRE_IMPORT_SPECIFIER}');`,
  "    } catch (e) {",
  "      console.error('MapLibre GL JS could not be loaded; MapLibre base maps are not shown.', e);",
  "    }",
].join("\n");

/**
 * viewer の起動のスクリプト要素を 1 つ返す。`body` は `<script>` と `</script>` の間の行（前後の改行を含まない）。
 *
 * - MapLibre を使わないアプリと、5 系を選んだアプリ: 従来の `<script>`（出力は 1 バイトも変わらない）
 * - MapLibre を使い 6 系を選んだアプリ: `<script type="module">`。`import()` で読み込んで `window.maplibregl` に入れてから
 *   `body`（option の組み立てと createObject）を走らせる。モジュールは文書の解析の後に走るので、
 *   ol.js・maplat_ui.umd.js（通常のスクリプト）は実行済み
 *
 * Export と Preview の両 HTML 生成器はこの関数だけを呼ぶ（モジュールの字面を生成器に書かない）。
 */
export function renderViewerStartupScript(
  required: Set<ProviderGlKind>,
  body: string,
  maplibreMajor: MaplibreMajor,
): string {
  if (!required.has("maplibre") || maplibreMajor !== 6) return `  <script>\n${body}\n  </script>`;
  return `  <script type="module">\n${MAPLIBRE_LOADER}\n${body}\n  </script>`;
}
