// window.maplist(Electron IPC)への直接アクセスを集約するサービス層。
// raw IPC の直呼び箇所は registered-map-catalog-smoke.mjs の allowlist で管理する。

export interface DesktopMapListItem {
  uid: string; // Asset UID (資産の正本の識別子は変わらない uid とし、slug は全種類で一意な利用者向けの名前とする決まり): app sources等の正本参照キー
  mapID: string; // slug (表示用)
  title: string;
  image: string | null;
  width?: number;
  height?: number;
  previewDisabled?: boolean;
  previewDisabledReason?: string;
}

// 登録済みMaplat地図を全件取得する(pageSize=0 は全件・ページネーションなし)
export async function fetchAllRegisteredMaps(): Promise<DesktopMapListItem[]> {
  const result = await window.maplist.request("", 1, 0);
  return result.docs;
}
