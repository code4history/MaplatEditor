// M11-T6 共通 List 契約（List v2 §7 正本 + D8改 差分）。
// primitive/adapter/composable が共有する型の単一定義箇所。

export type Wgs84Bbox = [west: number, south: number, east: number, north: number];

export interface ResourceListFilter {
  q: string;
  bbox: Wgs84Bbox | null;
}

export interface ResourceListBatch<T, Cursor = string> {
  items: T[];
  // D8改: page式backend(maplist/applist)は総数を返さないため null 縮退を許す。
  // POI/BaseMap/Asset(全件取得系)は実 total を返す。List v2 §7 からの唯一の明示差分。
  total: number | null;
  nextCursor: Cursor | null;
}

export interface ResourceListBadge {
  key: string;
  label: string;
  tone: "info" | "warning" | "neutral";
}

export interface ResourceListItemViewModel {
  uid: string;
  slug: string;
  title: string;
  thumbnailUrl: string | null;
  metadata: string[];
  badges: ResourceListBadge[];
  selected: boolean;
  hasDraft: boolean;
  // capability。builtin Base Map 等 action 不能な item は空配列（D4改）。
  actions: Array<"duplicate" | "delete">;
}

export interface ResourceListAdapter<T, Cursor = string> {
  load(input: {
    filter: ResourceListFilter;
    cursor: Cursor | null;
    limit: number;
    signal: AbortSignal;
  }): Promise<ResourceListBatch<T, Cursor>>;
  toViewModel(item: T, activeLang: string): ResourceListItemViewModel;
}

export interface ResourceListAction {
  key: "delete" | "delete-draft"; // T10 で "duplicate" を追加予定。"delete-draft" は新規下書きカード専用
  labelKey: string;
  destructive: boolean;
  enabled: boolean;
  reasonKey?: string; // disabled 理由（Tooltip）
}

export type ResourceListKind = "map" | "poi-source" | "base-map" | "app" | "image-asset";

export type ResourceListState =
  | "loading"
  | "appending"
  | "idle"
  | "empty"
  | "end"
  | "error"
  | "append-error";
