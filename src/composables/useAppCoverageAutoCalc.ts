import { ref, watch, type Ref } from 'vue'

interface UseAppCoverageAutoCalcOptions {
  appDoc: Ref<Record<string, any> | null>
}

interface UseAppCoverageAutoCalcReturn {
  autoCoverage: Ref<[number, number][] | null>
  isAuto: Ref<boolean>
  manualOverride: (lngLats: [number, number][] | null) => void
  clear: () => void
  refresh: () => void
}

export function useAppCoverageAutoCalc(options: UseAppCoverageAutoCalcOptions): UseAppCoverageAutoCalcReturn {
  const autoCoverage = ref<[number, number][] | null>(null)
  const isAuto = ref(true)
  let currentCalcId = 0

  function mapUids(doc: Record<string, any> | null): string[] {
    if (!doc?.sources || !Array.isArray(doc.sources)) return []
    return (doc.sources as any[])
      .filter((s: any) => s?.sourceType === 'maplat')
      .map((s: any) => s.mapUid || s.mapID || s.map_id || '')
      .filter(Boolean)
      .sort()
  }

  async function calc(): Promise<void> {
    if (!isAuto.value) return
    const uids = mapUids(options.appDoc.value)
    const calcId = ++currentCalcId
    try {
      const result = await (window as any).search?.appCoverage?.('', uids)
      if (calcId !== currentCalcId) return
      if (result && Array.isArray(result.coverageLngLats)) {
        autoCoverage.value = result.coverageLngLats as [number, number][]
      } else {
        autoCoverage.value = null
      }
    } catch {
      if (calcId === currentCalcId) autoCoverage.value = null
    }
  }

  // sources の mapUid 集合の変更を検知（appData 差し替え/ソース追加削除）
  watch(() => JSON.stringify(mapUids(options.appDoc.value)), () => {
    if (isAuto.value) calc()
  })

  function manualOverride(lngLats: [number, number][] | null): void {
    isAuto.value = false
    autoCoverage.value = lngLats
  }

  function clear(): void {
    isAuto.value = true
    calc()
  }

  function refresh(): void {
    calc()
  }

  return { autoCoverage, isAuto, manualOverride, clear, refresh }
}