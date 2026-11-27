<template>
  <div class="crs-estimation-panel d-flex flex-column h-100 bg-white" data-testid="crs-estimation-panel">
    <div class="d-flex align-items-center gap-2 p-2 border-bottom">
      <strong class="me-auto">{{ t('mapedit.crs_panel_heading') }}</strong>
      <button
        type="button"
        class="btn-close"
        data-testid="crs-panel-close"
        :aria-label="t('common.close')"
        @click="emit('close')"
      ></button>
    </div>

    <div class="flex-grow-1 overflow-auto p-2 d-flex flex-column gap-2">
      <div class="d-flex align-items-center gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          data-testid="crs-reestimate-button"
          :disabled="estimating"
          @click="runEstimate()"
        >
          {{ t('mapedit.crs_reestimate_button') }}
        </button>
        <label class="small d-flex align-items-center gap-1">
          <input
            v-model="onshoreOnly"
            type="checkbox"
            class="form-check-input"
            data-testid="crs-onshore-only"
          />
          {{ t('mapedit.crs_onshore_only') }}
        </label>
        <ContextHelp
          :text="t('mapedit.crs_onshore_only_help')"
          :ariaLabel="t('editor_ui.help_about', { name: t('mapedit.crs_onshore_only') })"
        />
      </div>

      <!-- 推定の警告・失敗は DiagnosticFeedback（文言の t() は script 側の計算に置く） -->
      <DiagnosticFeedback
        v-if="warningItems.length"
        scope="section"
        :items="warningItems"
        data-testid="crs-panel-warnings"
      />
      <DiagnosticFeedback
        v-if="failureItems.length"
        scope="operation"
        :items="failureItems"
        data-testid="crs-panel-failure"
      />

      <template v-if="summary">
        <div class="small d-flex flex-wrap gap-2" data-testid="crs-panel-pipeline">
          <span>{{ t('mapedit.crs_pipeline_summary', {
            candidates: summary.candidateCount,
            transformable: summary.transformableCount,
            fitted: summary.fittedCount,
          }) }}</span>
          <span>{{ t('mapedit.crs_result_crs', { crs: summary.crsLabel }) }}</span>
          <span v-if="summary.unitName">{{ t('mapedit.crs_result_unit', { unit: summary.unitName }) }}</span>
          <span>{{ summary.yScaleSign === -1 ? t('mapedit.crs_result_yaxis_down') : t('mapedit.crs_result_yaxis_up') }}</span>
          <span>{{ t('mapedit.crs_result_current_setup', { setup: t(summary.currentSetupKey) }) }}</span>
        </div>

        <div data-testid="crs-panel-comparison">
          <span class="small fw-bold me-2">{{ t('mapedit.crs_compare_heading') }}</span>
          <span class="small">{{ comparisonMessage }}</span>
        </div>

        <div>
          <div class="small fw-bold">{{ t('mapedit.crs_candidates_heading') }}</div>
          <table class="table table-sm small" data-testid="crs-panel-candidates">
            <thead>
              <tr>
                <th>{{ t('mapedit.crs_col_rank') }}</th>
                <th>{{ t('mapedit.crs_col_id') }}</th>
                <th>{{ t('mapedit.crs_col_name') }}</th>
                <th>{{ t('mapedit.crs_col_score') }}</th>
                <th>{{ t('mapedit.crs_col_rms') }}</th>
                <th>{{ t('mapedit.crs_col_diff') }}</th>
                <th>{{ t('mapedit.crs_col_unit') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in candidateTable"
                :key="row.id"
                :data-testid="`crs-panel-candidate-row-${row.id}`"
                :class="{ 'table-primary': row.id === selectedId }"
                role="button"
                @click="selectCandidate(row.id)"
              >
                <td>{{ row.rank }}</td>
                <td>{{ row.id }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.score === null ? '—' : row.score.toFixed(6) }}</td>
                <td>{{ row.rmsMeters.toFixed(2) }}</td>
                <td>{{ row.diff3857Percent === null ? '—' : `${row.diff3857Percent.toFixed(1)}%` }}</td>
                <td>{{ row.unitName }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 推奨（§4.8「推奨のまま採用」は比較切替なしでも押せる） -->
        <div class="d-flex flex-column gap-2" data-testid="crs-panel-recommendation">
          <div v-if="!stale" class="d-flex align-items-center gap-2">
            <button
              type="button"
              class="btn btn-primary"
              data-testid="crs-adopt-recommended"
              :disabled="!recommendedPlan"
              @click="recommendedPlan && emit('adopt', recommendedPlan.selection)"
            >
              {{ t('mapedit.crs_adopt_recommended_button') }}
            </button>
            <ContextHelp
              v-if="recommendedPlan && recommendedPlan.borderlineSetupLabelKey"
              :text="t('mapedit.crs_adopt_recommended_borderline_note', { setup: t(recommendedPlan.borderlineSetupLabelKey) })"
              :ariaLabel="t('editor_ui.help_about', { name: t('mapedit.crs_adopt_recommended_button') })"
            />
            <ContextHelp
              v-if="!recommendedPlan && recommendedDisabledReason"
              :text="recommendedDisabledHelp"
              :ariaLabel="t('editor_ui.unavailable_reason', { name: t('mapedit.crs_adopt_recommended_button') })"
            />
          </div>

          <DiagnosticFeedback
            v-if="advice && advice.reason === 'unavailable'"
            scope="section"
            :items="setupUnavailableItems"
            data-testid="crs-panel-setup-unavailable"
          />

          <div class="d-flex flex-wrap gap-2">
            <button
              v-for="card in setupCards"
              :key="card.key"
              type="button"
              class="btn"
              :class="selectedSetup === card.key ? 'btn-primary' : 'btn-outline-secondary'"
              :data-testid="`crs-setup-card-${card.key}`"
              :disabled="card.disabled"
              @click="chooseSetup(card.key)"
            >
              {{ t(setupLabelKey(card.key)) }}
              <span v-if="card.recommended" class="badge text-bg-success" data-testid="crs-setup-recommended">
                {{ t('mapedit.crs_setup_recommended_badge') }}
              </span>
            </button>
          </div>
          <ContextHelp
            v-if="advice && advice.reason === 'borderline' && advice.score !== null"
            :text="t('mapedit.crs_setup_borderline_note', { score: advice.score.toFixed(6) })"
            :ariaLabel="t('editor_ui.help_about', { name: t('mapedit.crs_setup_borderline_note') })"
          />
          <ContextHelp
            v-if="advice && advice.reason === 'birdeye'"
            :text="birdeyeHelp"
            :ariaLabel="t('editor_ui.help_about', { name: t('mapedit.crs_setup_recommended_badge') })"
          />

          <div class="d-flex align-items-center gap-2">
            <button
              type="button"
              class="btn btn-primary"
              data-testid="crs-adopt-button"
              :disabled="adoptDisabled || !manual"
              @click="manual && emit('adopt', manual)"
            >
              {{ t('mapedit.crs_adopt_button') }}
            </button>
            <ContextHelp
              v-if="adoptDisabledReasonKey"
              :text="t(adoptDisabledReasonKey)"
              :ariaLabel="t('editor_ui.unavailable_reason', { name: t('mapedit.crs_adopt_button') })"
            />
          </div>
        </div>
      </template>

      <!-- 見た目の比較（ベクタ。ラスター重ね合わせは後続の担当） -->
      <div class="d-flex flex-column gap-2" data-testid="crs-panel-preview">
        <div class="small fw-bold">{{ t('mapedit.crs_preview_heading') }}</div>
        <div class="btn-group btn-group-sm" role="group">
          <button
            v-for="mode in previewModes"
            :key="mode"
            type="button"
            class="btn"
            :class="previewMode === mode ? 'btn-primary' : 'btn-outline-secondary'"
            :data-testid="`crs-preview-mode-${mode}`"
            @click="previewMode = mode"
          >
            {{ t(previewModeLabelKey(mode)) }}
          </button>
        </div>
        <label class="small d-flex align-items-center gap-2">
          {{ t('mapedit.crs_preview_opacity') }}
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            :value="Math.round(previewOpacity * 100)"
            data-testid="crs-preview-opacity"
            @input="onOpacityInput"
          />
        </label>
        <DiagnosticFeedback
          v-if="previewFallbackNotice"
          scope="section"
          :items="previewFallbackItems"
          data-testid="crs-panel-preview-fallback"
        />
      </div>

      <!-- 残差（矢印・表） -->
      <div class="d-flex flex-column gap-2" data-testid="crs-panel-residuals">
        <div class="d-flex align-items-center gap-2">
          <span class="small fw-bold me-auto">{{ t('mapedit.crs_residuals_heading') }}</span>
          <label class="small d-flex align-items-center gap-1">
            {{ t('mapedit.crs_residual_scale') }}
            <select v-model="residualScale" class="form-select form-select-sm w-auto" data-testid="crs-residual-scale">
              <option value="1x">{{ t('mapedit.crs_residual_scale_1x') }}</option>
              <option value="5x">{{ t('mapedit.crs_residual_scale_5x') }}</option>
              <option value="auto">{{ t('mapedit.crs_residual_scale_auto') }}</option>
            </select>
          </label>
        </div>
        <table class="table table-sm small" data-testid="crs-panel-residual-table">
          <thead>
            <tr>
              <th>{{ t('mapedit.crs_residual_table_gcp') }}</th>
              <th>{{ t('mapedit.crs_residual_table_distance') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in residualTable"
              :key="row.index"
              :data-testid="`crs-panel-residual-row-${row.index}`"
              role="button"
              @click="emit('pan-residual', row.measuredMerc)"
            >
              <td>{{ row.index }}</td>
              <td>{{ row.distanceMeters.toFixed(1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import Tin from '@maplat/tin';
import type { CrsObject, EdgeSet, PointSet, WorldFile } from '@maplat/transform';
import type { GcpPair } from '@c4h/teiresias';
import ContextHelp from '../editor-ui/ContextHelp.vue';
import DiagnosticFeedback from '../editor-ui/DiagnosticFeedback.vue';
import type { DiagnosticItem } from '../editor-ui/editorUiTypes';
import type { CrsAdoptionSelection } from '../../utils/crsAdoption';
import type { CrsEstimationAPI, CrsEstimationResponse, SelectedCrsCandidate } from '../../types/crsEstimation';
import { editorComputeBackend } from '../../services/editorComputeBackend';
import { resolveTinBuildOptions } from '../../utils/tinOptions';
import { reprojectLayerCoords } from '../../utils/crsProjection';
import {
  adoptRecommendedPlan,
  buildPipelineSummary,
  candidateRows,
  compare3857,
  estimationResultFor,
  isEstimationStale,
  manualSelection,
  previewCornerPolygonMercator,
  previewMeshMercator,
  residualRows,
  setupAdvice,
  setupLabelKey,
  usableEstimation,
  warningMessageKeys,
  type AdoptRecommendedDisabledReason,
  type PreviewMode,
  type ResidualRow,
  type ResidualScaleMode,
  type TransformSetupKey,
} from '../../utils/crsEstimationPanel';

const props = defineProps<{
  gcps: GcpPair[];
  edges: EdgeSet[];
  crs?: CrsObject;
  vertexMode: 'plain' | 'birdeye';
  strictMode: 'strict' | 'auto' | 'loose';
  editGeneration: number;
  layerIndex: number;
  width: number;
  height: number;
  bounds?: number[][];
  currentSetup: string;
}>();

const emit = defineEmits<{
  close: [];
  estimating: [boolean];
  adopt: [CrsAdoptionSelection];
  residuals: [payload: { rows: ResidualRow[]; scaleMode: ResidualScaleMode }];
  preview: [payload: { mode: PreviewMode; opacity: number; geojson: unknown | null }];
  'pan-residual': [merc: number[]];
}>();

const { t } = useTranslation();
const crsApi: CrsEstimationAPI | undefined = typeof window !== 'undefined' ? window.crs : undefined;

const estimating = ref(false);
const requestToken = ref(0);
const response = ref<CrsEstimationResponse | null>(null);
const resultGeneration = ref<number | null>(null);
const onshoreOnly = ref(true);
const selectedCandidate = ref<SelectedCrsCandidate | null>(null);
const candidateCache = new Map<string, SelectedCrsCandidate>();
const base3857Selected = ref<SelectedCrsCandidate | null>(null);
const previewMode = ref<PreviewMode>('original');
const previewOpacity = ref(0.7);
const previewFallbackNotice = ref(false);
const residualScale = ref<ResidualScaleMode>('1x');
const selectedSetup = ref<TransformSetupKey>('A');
const previewModes: PreviewMode[] = ['original', 'A', 'B', 'C'];

const usable = computed(() => usableEstimation(response.value));
const summary = computed(() => (usable.value ? buildPipelineSummary(usable.value, props.currentSetup) : null));
const failureItems = computed<DiagnosticItem[]>(() => {
  if (!response.value || response.value.status !== 'failed') return [];
  return [{ key: 'crs-failed', severity: 'danger', message: failureMessage.value }];
});
const failureMessage = computed(() => t('mapedit.crs_estimate_failed'));
const warningItems = computed<DiagnosticItem[]>(() => {
  if (!usable.value) return [];
  return warningMessageKeys(usable.value, props.gcps.length)
    .map((key) => ({ key, severity: 'warning' as const, message: t(key) }));
});
const setupUnavailableItems = computed<DiagnosticItem[]>(() => [
  { key: 'crs-setup-unavailable', severity: 'warning', message: t('mapedit.crs_setup_unavailable') },
]);
const previewFallbackItems = computed<DiagnosticItem[]>(() => [
  { key: 'crs-preview-fallback', severity: 'warning', message: t('mapedit.crs_preview_fallback_notice') },
]);
const birdeyeHelp = computed(() => t('mapedit.crs_birdeye_note'));
const comparisonMessage = computed(() => {
  if (!usable.value) return t('mapedit.crs_compare_unavailable');
  const best = usable.value.selected!;
  const state = compare3857(usable.value.base3857Score, best);
  if (state.kind === 'switch') {
    return t('mapedit.crs_switch_recommended', { crs: state.crsLabel, percent: state.percent.toFixed(1) });
  }
  if (state.kind === 'keep') {
    return t('mapedit.crs_keep_3857_recommended', { percent: state.percent.toFixed(1) });
  }
  return t('mapedit.crs_compare_unavailable');
});
const candidateTable = computed(() => (usable.value
  ? candidateRows(usable.value.ranked, usable.value.base3857Score)
  : []));
const selectedId = computed(() => selectedCandidate.value?.id ?? usable.value?.selected?.id ?? null);

const advice = computed(() => {
  const candidate = selectedCandidate.value ?? usable.value?.selected ?? null;
  if (!candidate) return null;
  return setupAdvice(estimationResultFor(candidate), props.vertexMode);
});
const setupCards = computed(() => advice.value?.cards ?? []);
const stale = computed(() => isEstimationStale(resultGeneration.value, props.editGeneration));

const manual = computed<CrsAdoptionSelection | null>(() => {
  const candidate = selectedCandidate.value ?? usable.value?.selected ?? null;
  return candidate ? manualSelection(candidate, selectedSetup.value) : null;
});
const adoptDisabled = computed(() => {
  if (!manual.value) return true;
  if (!manual.value.selected.coreCompatible) return true;
  return advice.value?.cards.find((card) => card.key === selectedSetup.value)?.disabled ?? false;
});
const adoptDisabledReasonKey = computed(() => {
  if (manual.value && !manual.value.selected.coreCompatible) return 'mapedit.crs_core_incompatible';
  return null;
});

const recommendedPlan = computed(() => {
  if (stale.value || !usable.value) return null;
  const verdict = adoptRecommendedPlan({
    response: response.value,
    base3857Selected: base3857Selected.value ?? (usable.value.selected?.authority === 'EPSG' && usable.value.selected?.code === '3857'
      ? usable.value.selected
      : null),
    vertexMode: props.vertexMode,
  });
  return verdict.plan;
});
const recommendedDisabledReason = computed<AdoptRecommendedDisabledReason | null>(() => {
  if (stale.value) return null;
  const verdict = adoptRecommendedPlan({
    response: response.value,
    base3857Selected: base3857Selected.value,
    vertexMode: props.vertexMode,
  });
  return verdict.disabled;
});
const recommendedDisabledHelp = computed(() => {
  switch (recommendedDisabledReason.value) {
    case 'no-base-score': return t('mapedit.crs_compare_unavailable');
    case 'core-incompatible': return t('mapedit.crs_core_incompatible');
    case 'unavailable': return t('mapedit.crs_setup_unavailable');
    default: return t('mapedit.crs_estimate_failed');
  }
});

const residualTable = computed<ResidualRow[]>(() => {
  const candidate = selectedCandidate.value ?? usable.value?.selected ?? null;
  if (!candidate) return [];
  return residualRows(candidate, props.gcps);
});

function previewModeLabelKey(mode: PreviewMode): string {
  if (mode === 'original') return 'mapedit.crs_compare_original';
  return setupLabelKey(mode);
}

function onOpacityInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) previewOpacity.value = value / 100;
}

async function runEstimate() {
  if (!crsApi) return;
  requestToken.value += 1;
  const token = requestToken.value;
  estimating.value = true;
  emit('estimating', true);
  try {
    const result = await crsApi.estimate({ gcps: props.gcps, onshoreOnly: onshoreOnly.value });
    if (token !== requestToken.value) return;
    applyResponse(result);
  } finally {
    if (token === requestToken.value) {
      estimating.value = false;
      emit('estimating', false);
    }
  }
}

async function cancelEstimate() {
  if (!crsApi || !estimating.value) return;
  requestToken.value += 1;
  estimating.value = false;
  emit('estimating', false);
  await crsApi.cancel();
}

function applyResponse(result: CrsEstimationResponse) {
  response.value = result;
  resultGeneration.value = props.editGeneration;
  candidateCache.clear();
  base3857Selected.value = null;
  const usableResult = usableEstimation(result);
  selectedCandidate.value = usableResult?.selected ?? null;
  if (usableResult?.selected) {
    candidateCache.set(usableResult.selected.id, usableResult.selected);
    const cards = setupAdvice(estimationResultFor(usableResult.selected), props.vertexMode)?.cards ?? [];
    selectedSetup.value = cards.find((card) => card.recommended)?.key ?? 'A';
  }
}

/** 候補行の選択（単体再推定。同一入力はキャッシュし、古い非同期応答は捨てる）。 */
async function selectCandidate(candidateId: string) {
  if (!crsApi || !usable.value) return;
  const cached = candidateCache.get(candidateId);
  if (cached) {
    selectedCandidate.value = cached;
    return;
  }
  requestToken.value += 1;
  const token = requestToken.value;
  estimating.value = true;
  emit('estimating', true);
  try {
    const result = await crsApi.estimateCandidate({
      gcps: props.gcps, onshoreOnly: onshoreOnly.value, candidateId,
    });
    if (token !== requestToken.value) return;
    const single = usableEstimation(result);
    if (single?.selected) {
      candidateCache.set(candidateId, single.selected);
      selectedCandidate.value = single.selected;
    }
  } finally {
    if (token === requestToken.value) {
      estimating.value = false;
      emit('estimating', false);
    }
  }
}

/** 「推奨のまま採用」が 3857 を採るとき、完全な `selected` を先に単体再推定で用意する。 */
async function ensureBase3857Selected() {
  if (base3857Selected.value || !usable.value || !crsApi) return;
  const selected = usable.value.selected!;
  if (selected.authority === 'EPSG' && selected.code === '3857') {
    base3857Selected.value = selected;
    return;
  }
  const row = usable.value.ranked.find((item) => item.authority === 'EPSG' && item.code === '3857');
  if (!row) return;
  const cached = candidateCache.get(row.id);
  if (cached) {
    base3857Selected.value = cached;
    return;
  }
  requestToken.value += 1;
  const token = requestToken.value;
  const result = await crsApi.estimateCandidate({
    gcps: props.gcps, onshoreOnly: onshoreOnly.value, candidateId: row.id,
  });
  if (token !== requestToken.value) return;
  const single = usableEstimation(result);
  if (single?.selected) {
    candidateCache.set(row.id, single.selected);
    base3857Selected.value = single.selected;
  }
}

function chooseSetup(key: TransformSetupKey) {
  selectedSetup.value = key;
  if (key === 'A' || key === 'B' || key === 'C') previewMode.value = key;
}

watch(usable, (value) => {
  if (value?.selected) void ensureBase3857Selected();
}, { immediate: true });

watch([residualTable, residualScale], () => {
  emit('residuals', { rows: residualTable.value, scaleMode: residualScale.value });
}, { deep: true, immediate: true });

// 比較プレビュー（A: 四隅ポリゴン / B・C: 一時ワーカーの三角網。表示専用で文書を一切変えない）
let previewToken = 0;
watch([previewMode, selectedCandidate, previewOpacity], async () => {
  const mode = previewMode.value;
  const candidate = selectedCandidate.value;
  emit('preview', { mode, opacity: previewOpacity.value, geojson: null });
  if (mode === 'original' || !candidate) {
    previewFallbackNotice.value = false;
    return;
  }
  const token = ++previewToken;
  if (mode === 'A') {
    const corners = props.layerIndex === 0
      ? [[0, 0], [props.width, 0], [props.width, props.height], [0, props.height]]
      : (props.bounds ?? []).map((point) => [point[0], point[1]]);
    const geojson = previewCornerPolygonMercator({
      worldFile: candidate.worldFile as WorldFile, crs: candidate.crs, pixelCorners: corners,
    });
    if (token !== previewToken) return;
    previewFallbackNotice.value = false;
    emit('preview', { mode, opacity: previewOpacity.value, geojson });
    return;
  }
  try {
    const gcpsNew: PointSet[] = candidate.gcpsNew.map((gcp: GcpPair) => [[gcp.pixel[0], gcp.pixel[1]], [gcp.geo[0], gcp.geo[1]]]);
    const edgesNew = reprojectLayerCoords([], props.edges, props.crs, candidate.crs).edges;
    const layerDoc = {
      crs: candidate.crs,
      worldFile: candidate.worldFile as WorldFile,
      ...(props.layerIndex === 0
        ? { width: props.width, height: props.height }
        : { bounds: props.bounds }),
    };
    const tinOptions = resolveTinBuildOptions(layerDoc, {
      strictMode: props.strictMode, vertexMode: props.vertexMode,
    }, mode);
    if (!tinOptions) return;
    const [, compiled, diagnostics] = await editorComputeBackend.updateTin({
      gcps: gcpsNew,
      edges: edgesNew as EdgeSet[],
      index: props.layerIndex,
      bounds: (props.layerIndex === 0 ? [props.width, props.height] : props.bounds) as never,
      strict: props.strictMode,
      vertex: props.vertexMode,
      tinOptions,
    });
    if (token !== previewToken) return;
    if (typeof compiled === 'string') {
      previewFallbackNotice.value = false;
      return;
    }
    const tin = new Tin(tinOptions);
    tin.setCompiled(compiled);
    const geojson = previewMeshMercator({ bakw: tin.tins?.bakw, yaxisMode: tin.yaxisMode, crs: candidate.crs });
    if (token !== previewToken) return;
    previewFallbackNotice.value = mode === 'B'
      && diagnostics?.requestedOuterTransform === 'worldFile'
      && diagnostics?.outerTransform === 'extrapolate';
    emit('preview', { mode, opacity: previewOpacity.value, geojson: geojson || null });
  } catch {
    if (token !== previewToken) return;
    previewFallbackNotice.value = false;
    emit('preview', { mode, opacity: previewOpacity.value, geojson: null });
  }
}, { deep: true, immediate: true });

onBeforeUnmount(() => {
  requestToken.value += 1;
  emit('residuals', { rows: [], scaleMode: residualScale.value });
  emit('preview', { mode: 'original', opacity: previewOpacity.value, geojson: null });
});

defineExpose({ runEstimate, cancelEstimate });
</script>

<style scoped>
.crs-estimation-panel {
  border-right: 1px solid var(--bs-border-color, #dee2e6);
}
</style>
