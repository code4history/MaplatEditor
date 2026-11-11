<script setup lang="ts">
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import ContextHelp from "./editor-ui/ContextHelp.vue";
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { PoiEditorFeature } from '../utils/poiGeoJson';
import type { PoiImportIssue, PoiImportParseResult } from '../utils/poiImportRows';
import { planPoiMerge, type PoiMergeMode } from '../utils/poiMerge';
import { issueMessage } from '../utils/poiSourceMessages';

// 開いているソースへの取り込み（追記・上書き）のプレビュー。モードを切り替えるたびに合流を計算し直す。
// 確定は親へ mode を渡すだけ（親が確定時に状態を確かめ直し、現在の features で合流を計算し直して commit する）。
const ISSUE_LIMIT = 200;
const props = defineProps<{
  visible: boolean;
  fileName: string;
  parse: PoiImportParseResult | null;
  existing: readonly PoiEditorFeature[];
  defaultLang: string;
}>();
const emit = defineEmits<{ submit: [PoiMergeMode | null] }>();
const { t } = useTranslation();

const mode = ref<PoiMergeMode>('append');
watch(
  () => props.visible,
  (visible) => {
    if (visible) mode.value = 'append';
  },
);

const plan = computed(() =>
  props.parse && !props.parse.fatal
    ? planPoiMerge({ existing: props.existing, rows: props.parse.rows, mode: mode.value, defaultLang: props.defaultLang })
    : null,
);

const summary = computed(() => {
  const p = plan.value;
  const parseSkipped = props.parse ? props.parse.totalRecords - props.parse.rows.length : 0;
  return {
    added: p?.summary.added ?? 0,
    updated: p?.summary.updated ?? 0,
    unchanged: p?.summary.unchanged ?? 0,
    kept: p?.summary.keptExisting ?? 0,
    renamed: p?.summary.renamed ?? 0,
    skipped: (p?.summary.skippedRows ?? 0) + parseSkipped,
  };
});

// 解析の issue と合流の issue を結合し、行（物理行）で整列する。行の無いもの（見出しの警告など）は先頭
const issues = computed<PoiImportIssue[]>(() => {
  const all = [...(props.parse?.issues ?? []), ...(plan.value?.issues ?? [])];
  return all
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => (a.issue.line ?? 0) - (b.issue.line ?? 0) || a.index - b.index)
    .map((x) => x.issue);
});
const shownIssues = computed(() => issues.value.slice(0, ISSUE_LIMIT));
const hiddenCount = computed(() => Math.max(0, issues.value.length - ISSUE_LIMIT));

const preview = computed(() =>
  (props.parse?.rows ?? []).slice(0, 3).map((row) => {
    const name = row.name?.[props.defaultLang] ?? Object.values(row.name ?? {})[0] ?? '';
    return [row.id, name].filter((x) => x !== '').join(' / ');
  }),
);

const canImport = computed(() => !!props.parse && !props.parse.fatal && props.parse.rows.length > 0);

function messageOf(issue: PoiImportIssue): string {
  const base = issueMessage({ ...issue, featureId: undefined }, t as unknown as (key: string) => string);
  return issue.swapped ? `${base} — ${t('poiio.issues.coord_swapped')}` : base;
}
</script>

<template>
  <div v-if="visible && parse" class="modal show d-block" tabindex="-1" role="dialog" aria-modal="true" data-testid="poi-merge-import-dialog">
    <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5">{{ t('poiio.import_title') }} <ContextHelp :text="t('poiio.import_geojson_hint')" :ariaLabel="t('poiio.import_title')" /></h2>
        </div>
        <div class="modal-body">
          <dl class="row small mb-2">
            <dt class="col-3">{{ t('poiio.import_file_label') }}</dt>
            <dd class="col-9 text-break" data-testid="poi-merge-file">{{ fileName }}</dd>
            <dt class="col-3">{{ t('poiio.import_encoding_label') }}</dt>
            <dd class="col-9" data-testid="poi-merge-encoding" :data-encoding="parse.encoding ?? ''">{{ parse.encoding ?? '-' }}</dd>
          </dl>

          <DiagnosticFeedback v-if="parse.fatal" scope="section" :items="[{ key: 'parse-fatal', severity: 'danger', message: t('poiio.import_fatal') }]" data-testid="poi-merge-fatal" />

          <template v-else>
            <fieldset class="mb-2">
              <legend class="fs-6 fw-bold">{{ t('poiio.import_mode_label') }}</legend>
              <div class="form-check">
                <input id="poiMergeModeAppend" v-model="mode" class="form-check-input" type="radio" value="append" data-testid="poi-merge-mode-append" />
                <label class="form-check-label" for="poiMergeModeAppend">{{ t('poiio.import_mode_append') }}</label>
              </div>
              <div class="form-check">
                <input id="poiMergeModeOverwrite" v-model="mode" class="form-check-input" type="radio" value="overwrite" data-testid="poi-merge-mode-overwrite" />
                <label class="form-check-label" for="poiMergeModeOverwrite">{{ t('poiio.import_mode_overwrite') }}</label>
                <ContextHelp class="ms-1" :text="t('poiio.import_overwrite_note')" :ariaLabel="t('poiio.import_mode_overwrite')" data-testid="poi-merge-overwrite-note" />
              </div>
            </fieldset>

            <p
              class="fw-bold mb-2"
              data-testid="poi-merge-summary"
              :data-added="summary.added"
              :data-updated="summary.updated"
              :data-unchanged="summary.unchanged"
              :data-kept="summary.kept"
              :data-renamed="summary.renamed"
              :data-skipped="summary.skipped"
            >
              {{ t('poiio.import_summary', summary) }}
            </p>

            <div v-if="preview.length" class="small mb-2" data-testid="poi-merge-preview">
              <div class="text-muted">{{ t('poiio.import_preview_title') }}</div>
              <div v-for="(line, i) in preview" :key="i" class="text-break">{{ line }}</div>
            </div>
            <p v-if="!canImport" class="text-muted small">{{ t('poiio.import_nothing') }}</p>
          </template>

          <div v-if="shownIssues.length" class="mt-2" data-testid="poi-merge-issues">
            <div class="fw-bold small mb-1">{{ t('poiio.import_issues_title') }}</div>
            <table class="table table-sm small align-middle mb-1">
              <tbody>
                <tr
                  v-for="(issue, i) in shownIssues"
                  :key="i"
                  data-testid="poi-merge-issue-row"
                  :data-line="issue.line ?? ''"
                  :data-code="issue.code"
                  :data-level="issue.level"
                  :class="issue.level === 'error' ? 'table-danger' : 'table-warning'"
                >
                  <td class="text-nowrap">{{ issue.line ? t('poiio.import_line', { line: issue.line }) : '' }}</td>
                  <td class="text-break">{{ messageOf(issue) }}</td>
                  <td class="text-break text-muted">{{ issue.column ?? '' }}<template v-if="issue.value && issue.code !== 'ignored-columns'"> ({{ issue.value }})</template></td>
                </tr>
              </tbody>
            </table>
            <div v-if="hiddenCount > 0" class="small text-muted">{{ t('poiio.import_issues_more', { count: hiddenCount }) }}</div>
          </div>

        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-testid="poi-merge-cancel" @click="emit('submit', null)">
            {{ t('common.cancel') }}
          </button>
          <button type="button" class="btn btn-primary" data-testid="poi-merge-confirm" :disabled="!canImport" @click="emit('submit', mode)">
            {{ t('poiio.import_confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-if="visible && parse" class="modal-backdrop show"></div>
</template>
