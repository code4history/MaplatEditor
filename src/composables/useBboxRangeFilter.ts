import { computed, ref } from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";
import { bboxToEnvelope, envelopeToBbox } from "../utils/appSourceModel";
import { parseBaseMapBboxQuery, serializeBaseMapBboxQuery, type Wgs84Bbox } from "../utils/baseMapCatalogFilter";

export function useBboxRangeFilter({ route, router }: { route: RouteLocationNormalizedLoaded; router: Router }) {
  const modalOpen = ref(false);
  const bbox = computed(() => parseBaseMapBboxQuery(route.query.bbox));
  const envelopeForModal = computed(() => bbox.value ? bboxToEnvelope(bbox.value) : null);

  async function replaceBbox(value: Wgs84Bbox | null): Promise<void> {
    const serialized = serializeBaseMapBboxQuery(value);
    const query = { ...route.query };
    if (serialized) query.bbox = serialized;
    else delete query.bbox;
    await router.replace({ query });
  }

  async function apply(envelope: [number, number][] | null): Promise<void> {
    await replaceBbox(envelopeToBbox(envelope) as Wgs84Bbox | null);
    modalOpen.value = false;
  }

  const clear = () => replaceBbox(null);
  return { bbox, modalOpen, envelopeForModal, apply, clear };
}
