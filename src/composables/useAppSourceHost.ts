import { ref, type Ref } from "vue";
import type { SelectedRegisteredMapHostState } from "./useRegisteredMapSelector";

// module singleton: 全 consumer が同一 ref を共有
const state: Ref<SelectedRegisteredMapHostState | null> = ref(null);

export function useAppSourceHost() {
  function selectMap(hostState: Readonly<SelectedRegisteredMapHostState>): void {
    state.value = hostState;
  }

  function clearMap(): void {
    state.value = null;
  }

  return {
    state,
    selectMap,
    clearMap,
  };
}
