import type { ResourceListKind } from "../components/resource-list/resourceListTypes";

export interface ResourceListBackState {
  q: string;
  bbox: string | null;
  batches: number;
  anchorUid: string | null;
  scrollTop: number;
}

// P6/D6: 一覧→item 遷移前の状態を sessionStorage(resource-list:<kind>) へ退避し、Back 時に復元する。
// renderer 寿命のみ（Electron 再起動を跨ぐ持続は不要 / List v2 §15「永続 draft へ入れない」）。
export function useResourceListBackCache(kind: ResourceListKind) {
  const key = `resource-list:${kind}`;
  function save(state: ResourceListBackState): void {
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* quota 等は無視 */ }
  }
  function load(): ResourceListBackState | null {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as ResourceListBackState) : null;
    } catch { return null; }
  }
  function clear(): void { try { sessionStorage.removeItem(key); } catch { /* noop */ } }
  return { save, load, clear };
}
