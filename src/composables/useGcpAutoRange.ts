import { ref, watch, type Ref } from 'vue'
import { transform } from 'ol/proj'

interface UseGcpAutoRangeOptions {
  gcps: Ref<any[]>
  onAutoRange?: (bbox: [number, number, number, number] | null) => void
}

interface UseGcpAutoRangeReturn {
  bbox: Ref<[number, number, number, number] | null>
}

export function useGcpAutoRange(options: UseGcpAutoRangeOptions): UseGcpAutoRangeReturn {
  const bbox = ref<[number, number, number, number] | null>(null)

  function calc(): void {
    let result: [number, number, number, number] | null = null
    for (const gcp of options.gcps.value) {
      const merc = gcp?.[1]
      if (!Array.isArray(merc) || typeof merc[0] !== 'number' || typeof merc[1] !== 'number') continue
      const [lng, lat] = transform([merc[0], merc[1]], 'EPSG:3857', 'EPSG:4326')
      result = result
        ? [Math.min(result[0], lng), Math.min(result[1], lat), Math.max(result[2], lng), Math.max(result[3], lat)]
        : [lng, lat, lng, lat]
    }
    bbox.value = result
    options.onAutoRange?.(result)
  }

  watch(options.gcps, () => calc(), { deep: true })

  calc()

  return { bbox }
}
