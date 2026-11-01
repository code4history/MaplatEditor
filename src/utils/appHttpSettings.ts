// アプリの文書の HTTP の設定（httpSettings）の画面での読み方。
//
// 画面（AppEdit.vue）の読み込みが使う規則を、Vue の外の純関数にしたもの。旧い文書は httpSettings を持たず、
// 旧い `http` の入れ物か、文書の最上位に同じ名前のキー（pwaManifest・mapboxToken 等）を持つ。∴
// `httpSettings || http || 文書そのもの` の順に読み、名指しのキーだけを拾う（最上位の他のキー、例えば
// maplibreMajorVersion は混ざらない）。移行や保存の入口が httpSettings の有無を変えると、この読み方の分かれ方が
// 変わって旧い値が読まれなくなるので、文書の最上位に足すキーは httpSettings の外に置く。
//
// 値は AppEdit.vue の既定（defaultApp().httpSettings）と同じ。AppEdit.vue はこのファイルの既定と読み方を使う。

export interface AppHttpSettings {
  previewPort: number;
  pwaManifest: boolean;
  overlay: boolean;
  enableHideMarker: boolean;
  enableMarkerList: boolean;
  enableBorder: boolean;
  enableCache: boolean;
  stateUrl: boolean;
  enableShare: boolean;
  mapboxToken: string;
  googleApiKey: string;
}

/** 読み込み時の欠落キーの補完にも使う既定（新規作成の時だけの既定は AppEdit.vue の NEW_APP_HTTP_OVERRIDES） */
export function defaultAppHttpSettings(): AppHttpSettings {
  return {
    previewPort: 41781,
    pwaManifest: true,
    overlay: true,
    enableHideMarker: true,
    // マーカー一覧 UI (viewer の enableMarkerList、GUI 検証 D3)。viewer 既定 (無効) に合わせて
    // false 既定 — 既存アプリ (キーなし保存形) の preview/export 出力を変えないため
    enableMarkerList: false,
    enableBorder: true,
    enableCache: true,
    stateUrl: true,
    enableShare: true,
    mapboxToken: "",
    googleApiKey: "",
  };
}

/** HTTP の設定の入れ物（または文書の最上位）から、名指しのキーだけを既定で補って読む */
export function normalizeAppHttpSettings(value: any): AppHttpSettings {
  const defaults = defaultAppHttpSettings();
  return {
    ...defaults,
    previewPort: Number(value.previewPort || defaults.previewPort),
    pwaManifest: value.pwaManifest ?? defaults.pwaManifest,
    overlay: value.overlay ?? defaults.overlay,
    enableHideMarker: value.enableHideMarker ?? defaults.enableHideMarker,
    enableMarkerList: value.enableMarkerList ?? defaults.enableMarkerList,
    enableBorder: value.enableBorder ?? defaults.enableBorder,
    enableCache: value.enableCache ?? defaults.enableCache,
    stateUrl: value.stateUrl ?? defaults.stateUrl,
    enableShare: value.enableShare ?? defaults.enableShare,
    mapboxToken: value.mapboxToken || "",
    googleApiKey: value.googleApiKey || "",
  };
}

/** アプリの文書から HTTP の設定を読む（httpSettings → 旧い http → 文書の最上位 の順） */
export function readAppHttpSettings(document: any): AppHttpSettings {
  return normalizeAppHttpSettings(document.httpSettings || document.http || document);
}
