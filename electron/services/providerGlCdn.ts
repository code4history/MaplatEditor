/**
 * m6-t5: Export / Preview HTML へ条件付きで注入する Mapbox / MapLibre GL CDN タグ。
 * 判断ロジックはここに一元化し、両 HTML 生成器から同一関数を呼ぶ（設計 §4.6）。
 *
 * CDN はパッチ固定 + SRI。
 *
 * design_deviation: 設計 v1.1 は maplibre-gl 6.1.0 を例示したが、6.x は UMD ビルド
 * (`dist/maplibre-gl.js`) を同梱せず browser `<script>` 注入に使えない。
 * script タグ経路では UMD がある **5.6.2** をピンする。peerDeps は設計どおり
 * `^5 || ^6`（bundler 経由の 6.x は許容）。
 */

export type ProviderGlKind = "mapbox" | "maplibre";

export type ProviderGlSourceLike = {
  maptype?: string | null;
  kind?: string | null;
  data?: { kind?: string | null; maptype?: string | null } | null;
};

/** ピン留め版（script タグ用 UMD） */
export const PROVIDER_GL_CDN = {
  maplibre: {
    version: "5.6.2",
    js: "https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.2/dist/maplibre-gl.js",
    css: "https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.2/dist/maplibre-gl.css",
    jsIntegrity:
      "sha384-1qC0PnXk2fgMDybOtZF1ui4LM5Sxm7o0TbEkwfxTTVdlZvuNENNGCKUub7d644HP",
    cssIntegrity:
      "sha384-gNYNsUmuZqDYiT3gbirWTV5K7rt71RoveS/yXAaU09d4ZUmeDVTD3XoqB6uJAIFR",
  },
  mapbox: {
    version: "3.27.0",
    js: "https://api.mapbox.com/mapbox-gl-js/v3.27.0/mapbox-gl.js",
    css: "https://api.mapbox.com/mapbox-gl-js/v3.27.0/mapbox-gl.css",
    jsIntegrity:
      "sha384-7ERH+4wJLuDpmJphMVoMUoS1/V7e+D5tR6ZywiuMjqkvGnCFBRPNuN4iywy90jEz",
    cssIntegrity:
      "sha384-XUbQaovfoSbaMso2Q1a1bLMGwU+1h7twi9V0vkuM6eOCZd0i52f6iAuxtHaP1nDO",
  },
} as const;

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

function tagAttrs(integrity: string): string {
  return ` integrity="${integrity}" crossorigin="anonymous"`;
}

/** head 内・ol.js より前に挿入する HTML 断片（link + script） */
export function renderProviderGlCdnTags(required: Set<ProviderGlKind>): string {
  const lines: string[] = [];
  const order: ProviderGlKind[] = ["maplibre", "mapbox"];
  for (const kind of order) {
    if (!required.has(kind)) continue;
    const pin = PROVIDER_GL_CDN[kind];
    lines.push(
      `  <link rel="stylesheet" href="${pin.css}"${tagAttrs(pin.cssIntegrity)}>`,
    );
    lines.push(
      `  <script src="${pin.js}"${tagAttrs(pin.jsIntegrity)}></script>`,
    );
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}
