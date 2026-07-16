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
  let currentCalcId = 0

  const isAuto = computed(() => {
    return !options.appDoc.value?.coverageLngLats
  })

  async function calc(): Promise<void> {
    if (!options.appDoc.value) {
      console.log('calc: appDoc.value is empty');
      return;
    }
    const calcId = ++currentCalcId
    const app = options.appDoc.value as any
    const uid = app.uid ?? app._id ?? ""
    console.log('calc start:', { uid, app });
    try {
      const rawSources = app.sources ?? app.dataSources ?? []
      const mapUids: string[] = []
      for (const src of rawSources) {
        if (src?.sourceType !== 'maplat') continue
        const mUid = src.mapUid || src.mapID || src.map_id
        if (mUid) mapUids.push(String(mUid))
      }
      console.log('calc mapUids:', mapUids);
      const result = await (window as any).search?.appCoverage?.(uid, mapUids)
      console.log('calc result:', result);
      if (calcId !== currentCalcId) {
        console.log('calc: race condition layout ignored');
        return;
      }

      if (result && Array.isArray(result.coverageLngLats)) {
        console.log('calc success set autoCoverage:', result.coverageLngLats);
        autoCoverage.value = result.coverageLngLats as [number, number][]
      } else {
        console.log('calc no result coverage set null');
        autoCoverage.value = null
      }
    } catch (e) {
      console.log('calc error:', e);
      if (calcId === currentCalcId) {
        autoCoverage.value = null
      }
    }
  }

  watch(() => options.appDoc.value, () => {
    console.log('watch triggered for appDoc.value:', options.appDoc.value);
    calc()
  }, { deep: true, immediate: true })

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

  return { autoCoverage, isAuto, manualOverride, clear }
}
