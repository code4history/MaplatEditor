import { ref, watch, computed, type Ref, type ComputedRef } from 'vue'

interface UseAppCoverageAutoCalcOptions {
  appDoc: Ref<Record<string, any> | null>
}

interface UseAppCoverageAutoCalcReturn {
  autoCoverage: Ref<[number, number][] | null>
  isAuto: ComputedRef<boolean>
  manualOverride: (lngLats: [number, number][] | null) => void
  clear: () => void
}

export function useAppCoverageAutoCalc(options: UseAppCoverageAutoCalcOptions): UseAppCoverageAutoCalcReturn {
  const autoCoverage = ref<[number, number][] | null>(null)

  const isAuto = computed(() => {
    return !options.appDoc.value?.coverageLngLats
  })

  async function calc(): Promise<void> {
    if (!options.appDoc.value) return
    const app = options.appDoc.value as any
    const uid = app.uid ?? app._id ?? ""
    try {
      const rawSources = app.sources ?? app.dataSources ?? []
      const mapUids: string[] = []
      for (const src of rawSources) {
        if (src?.sourceType !== 'maplat') continue
        const mUid = src.mapUid || src.mapID || src.map_id
        if (mUid) mapUids.push(String(mUid))
      }
      const result = await (window as any).search?.appCoverage?.(uid, mapUids)
      if (result && Array.isArray(result.coverageLngLats)) {
        autoCoverage.value = result.coverageLngLats as [number, number][]
      } else {
        autoCoverage.value = null
      }
    } catch {
      autoCoverage.value = null
    }
  }

  watch(() => {
    const doc = options.appDoc.value as any
    if (!doc?.sources) return 0
    return (doc.sources as any[]).length
  }, () => {
    calc()
  })

  watch(() => options.appDoc.value?.uid ?? options.appDoc.value?._id, () => {
    calc()
  })

  function manualOverride(lngLats: [number, number][] | null): void {
    if (options.appDoc.value) {
      options.appDoc.value.coverageLngLats = lngLats
    }
  }

  function clear(): void {
    if (options.appDoc.value) {
      options.appDoc.value.coverageLngLats = null
    }
    calc()
  }

  if (options.appDoc.value) calc()

  return { autoCoverage, isAuto, manualOverride, clear }
}
