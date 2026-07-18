import { computed, ref, type ComputedRef } from "vue";
import type { Wgs84Bbox } from "../components/resource-list/resourceListTypes";

export function useSelectorSpatialContext(source: ComputedRef<Wgs84Bbox | null>) {
  const enabled = ref(true);
  const bbox = computed<Wgs84Bbox | null>(() => enabled.value ? source.value : null);
  const toggle = () => { enabled.value = !enabled.value; };
  return { bbox, enabled, toggle };
}
