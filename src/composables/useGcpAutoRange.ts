import { ref, watch, type Ref } from 'vue'
import type { CrsObject } from '@maplat/transform'
import { crsToLonLat } from '../utils/crsProjection'

interface UseGcpAutoRangeOptions {
  gcps: Ref<any[]>
  crs?: Ref<CrsObject | undefined>
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
      const native = gcp?.[1]
      if (!Array.isArray(native) || typeof native[0] !== 'number' || typeof native[1] !== 'number') continue
      const lonLat = crsToLonLat(native, options.crs?.value)
      if (lonLat === false) continue
      const [lng, lat] = lonLat
      result = result
        ? [Math.min(result[0], lng), Math.min(result[1], lat), Math.max(result[2], lng), Math.max(result[3], lat)]
        : [lng, lat, lng, lat]
    }
    bbox.value = result
    options.onAutoRange?.(result)
  }

  watch(options.crs ? [options.gcps, options.crs] : options.gcps, () => calc(), { deep: true })

  calc()

  return { bbox }
}
