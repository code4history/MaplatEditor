/**
 * POI-139 icon 参照文法 resolver（純関数 + registry）。
 *
 * `icon` / `selectedIcon` の値は次の3形式のいずれか（43-poi-editor-spec.md §7 が正本）:
 *   1. Icon set 参照 `{setId}:{iconId}` — setId は登録済み icon set の小文字英数 ID（`[a-z][a-z0-9-]*`）。
 *   2. Asset UID — UUID（コロンを含まない）。Assets タブの image asset を参照。
 *   3. URL — `://` を含む絶対 URL、`data:`、または相対パス。
 *
 * 判別順序: URL パターン → 登録済み setId → UUID。該当なしは url 扱い（相対パス）。
 * http / https / data / file / blob は setId として予約禁止。
 * 未登録の setId のコロン形式は { kind: "iconset" } として返し isRegisteredIconSet(setId) = false
 * となる（URL とはみなさない）。呼び出し側（PoiAttributeForm 等）がこれを「未解決 icon set」警告として扱う。
 *
 * builtin icon set の実体は `public/icons/builtin/*.{png,svg}`（POI-126 の version 管理準拠：
 * icons は追加のみ・既存 id の意味を変えない）。
 * 例外: `defaultpin` のみ 2026-07-11 のユーザー決定「ビルトインをビューア標準ピンに整合させる」
 * に基づき、旧・青 SVG から MaplatCore/parts/defaultpin.png（ビューア標準の青バルーン）へ
 * アートを差し替えた。旧・青 SVG のアートは新 id `defaultpin-blue` として温存している。
 */

export type IconRef =
  | { kind: "iconset"; setId: string; iconId: string }
  | { kind: "asset"; uid: string }
  | { kind: "url"; url: string };

// UUID 形式判定。大文字小文字を区別しない — electron/adapters/StorageAdapter.ts の
// UUID_PATTERN と同じ形（renderer からは import できないため値を揃えてここに再定義する）。
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// setId として許容する文字種（仕様 §7）。
const SET_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

// setId として予約禁止の scheme（URL 判別より先に「setId 予約」として弾く）。
const RESERVED_SCHEMES = new Set(["http", "https", "data", "file", "blob"]);

const ICON_SET_REF_PATTERN = /^([^:]+):(.*)$/s;

/** icon 1 個分の registry エントリ。実体拡張子（png/svg 混在）を id と一緒に持つ */
export interface IconEntry {
  id: string;
  ext: "png" | "svg";
}

interface IconSetRegistryEntry {
  setId: string;
  titleKey: string;
  icons: IconEntry[];
  previewUrl(iconId: string): string;
}

export interface IconSetDef {
  setId: string;
  /** 表示名の i18n キー（呼び出し側が t() で解決する。ハードコード英語文言を持たない） */
  titleKey: string;
  /** id + 実体拡張子（実体は `icons/{setId}/{id}.{ext}`）。並び順 = picker グリッドの表示順 */
  icons: IconEntry[];
  /** icons から導出した id 一覧（既存呼び出し側の存在チェック用に維持） */
  iconIds: string[];
  /** エディタ内プレビュー URL（picker サムネ・badge 用）。export 解決（POI-117）は Phase 7 */
  previewUrl(iconId: string): string;
}

// builtin セットの構成（Phase 8 Task 4, ユーザー決定 2026-07-11「ビューア標準に整合」）:
//   defaultpin          = ビューア標準の青バルーン (MaplatCore/parts/defaultpin.png のコピー)
//   defaultpin-selected = ビューアの選択中ピン (MaplatCore/parts/defaultpin_selected.png のコピー)
//   defaultpin-blue     = 旧 defaultpin の青 SVG を温存 (アート選択肢を失わないボーナストラック)
//   defaultpin-red/green/yellow/gray = 既存 SVG のまま (ボーナストラック)
const BUILTIN_ICONS: IconEntry[] = [
  { id: "defaultpin", ext: "png" },
  { id: "defaultpin-selected", ext: "png" },
  { id: "defaultpin-blue", ext: "svg" },
  { id: "defaultpin-red", ext: "svg" },
  { id: "defaultpin-green", ext: "svg" },
  { id: "defaultpin-yellow", ext: "svg" },
  { id: "defaultpin-gray", ext: "svg" },
];

const iconSetRegistry: Map<string, IconSetRegistryEntry> = new Map();

function registerIconSet(def: Omit<IconSetRegistryEntry, "previewUrl">): void {
  const extById = new Map(def.icons.map((icon) => [icon.id, icon.ext]));
  iconSetRegistry.set(def.setId, {
    ...def,
    // 未知 iconId は svg 扱い（呼び出し側は iconIds 存在チェックを先に通す想定）
    previewUrl: (iconId: string) =>
      `icons/${def.setId}/${iconId}.${extById.get(iconId) ?? "svg"}`,
  });
}

registerIconSet({
  setId: "builtin",
  titleKey: "poiedit.picker.set_builtin",
  icons: [...BUILTIN_ICONS],
});

/** setId が登録済み icon set かどうか。 */
export function isRegisteredIconSet(setId: string): boolean {
  return iconSetRegistry.has(setId);
}

/** 登録済み icon set の一覧。 */
export function listIconSets(): IconSetDef[] {
  return [...iconSetRegistry.values()].map((entry) => ({
    setId: entry.setId,
    titleKey: entry.titleKey,
    icons: entry.icons.map((icon) => ({ ...icon })),
    iconIds: entry.icons.map((icon) => icon.id),
    previewUrl: entry.previewUrl,
  }));
}

/**
 * icon 参照文字列を判別する。判別順序: URL パターン → 登録済み setId → UUID → url(相対パス扱い)。
 */
export function parseIconRef(value: string): IconRef {
  // `{scheme}:...` 形式かどうかをまず見る。予約 scheme なら setId として扱わず url。
  const match = ICON_SET_REF_PATTERN.exec(value);

  if (match) {
    const [, prefix, rest] = match;

    // `://` を含む絶対 URL（http://, https://, file://, blob:blob-uuid のような形は
    // 下の「`://` を含む」チェックで既に url 扱いになる想定だが、ここでは prefix が
    // 予約 scheme の場合は setId 予約として先に url 判定する）。
    if (RESERVED_SCHEMES.has(prefix)) {
      return { kind: "url", url: value };
    }

    // `scheme://...` 形の絶対 URL は setId 判定より先に url と判別する（仕様 §7 の判別順序:
    // URL パターン → 登録済み setId → UUID）。`ftp://`/`s3://` のような予約外 scheme でも
    // `//` を伴う絶対 URL 形は setId 参照とみなさない。
    if (rest.startsWith("//")) {
      return { kind: "url", url: value };
    }

    // setId 文字種違反（大文字始まり等）は setId 参照とみなさず url。
    // iconId が空の場合も同様に url 扱い（iconId 必須）。
    if (SET_ID_PATTERN.test(prefix) && rest.length > 0) {
      return { kind: "iconset", setId: prefix, iconId: rest };
    }

    return { kind: "url", url: value };
  }

  // `://` を含む絶対 URL（コロンなしでここに来るのは相対パス・UUID のみ）
  if (value.includes("://")) {
    return { kind: "url", url: value };
  }

  if (UUID_PATTERN.test(value)) {
    return { kind: "asset", uid: value };
  }

  return { kind: "url", url: value };
}

/** parseIconRef の逆（正規形へ）。 */
export function formatIconRef(ref: IconRef): string {
  switch (ref.kind) {
    case "iconset":
      return `${ref.setId}:${ref.iconId}`;
    case "asset":
      return ref.uid;
    case "url":
      return ref.url;
  }
}
