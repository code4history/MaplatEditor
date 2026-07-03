// window.maplist(Electron IPC)への直接アクセスを集約するサービス層。
// raw IPC の直呼び箇所は m1-t2-registered-map-catalog-smoke.mjs の allowlist で管理する。

export interface DesktopMapListItem {
  mapID: string;
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
