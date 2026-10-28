<template>
  <div class="iiif-import-backdrop" data-testid="iiif-import-dialog">
    <div class="card shadow-sm p-3 iiif-import-dialog" role="dialog" aria-modal="true">
      <h2 class="h5 mb-2">{{ t("iiif_import.title") }}</h2>
      <label class="form-label" for="iiif-import-url">{{ t("iiif_import.url_label") }}</label>
      <div class="d-flex gap-2">
        <input
          id="iiif-import-url"
          v-model="url"
          class="form-control"
          type="url"
          :placeholder="t('iiif_import.url_placeholder')"
          data-testid="iiif-import-url"
          @keyup.enter="inspect"
        >
        <button
          type="button"
          class="btn btn-primary text-nowrap"
          data-testid="iiif-import-inspect"
          :disabled="busy || !url.trim()"
          @click="inspect"
        >{{ t("iiif_import.inspect") }}</button>
      </div>

      <p v-if="error" class="text-danger small mt-2 mb-0" data-testid="iiif-import-error">{{ t(error) }}</p>

      <div v-if="canvases.length > 0" class="mt-3">
        <p class="small text-muted mb-1">{{ t("iiif_import.canvas_heading") }}</p>
        <div class="d-flex flex-wrap gap-2">
          <button
            v-for="(canvas, index) in canvases"
            :key="canvas.id"
            type="button"
            class="btn btn-outline-secondary btn-sm"
            data-testid="iiif-canvas-option"
            :disabled="busy"
            @click="selectCanvas(index)"
          >{{ canvasLabel(canvas.label) }}</button>
        </div>
      </div>

      <div v-if="verdict" class="mt-3" data-testid="iiif-verdict">
        <p class="fw-bold mb-1" data-testid="iiif-verdict-kind">{{ t(verdictKindKey) }}</p>
        <template v-if="verdict.kind === 'deliverable'">
          <p class="small mb-1" data-testid="iiif-verdict-detail">
            {{ t("iiif_import.detail", { version: verdict.info.version, level: verdict.info.level, tiling: verdict.info.tiling }) }}
          </p>
          <p class="mb-2" data-testid="iiif-verdict-size">
            {{ t("iiif_import.size", { width: verdict.info.width, height: verdict.info.height }) }}
          </p>
        </template>
        <p v-else class="small mb-2" data-testid="iiif-verdict-reason">{{ t(verdict.message) }}</p>

        <p v-if="warning" class="small text-warning mb-2" data-testid="iiif-thumbnail-warning">{{ warning }}</p>

        <div class="d-flex flex-wrap gap-2">
          <button
            v-if="verdict.kind === 'deliverable'"
            type="button"
            class="btn btn-primary btn-sm"
            data-testid="iiif-deliverable"
            :disabled="busy"
            @click="chooseDeliverable"
          >{{ t("iiif_import.verdict.deliverable") }}</button>
          <button
            type="button"
            class="btn btn-outline-primary btn-sm"
            data-testid="iiif-metadata-only"
            :disabled="busy"
            @click="chooseMetadataOnly"
          >{{ t("iiif_import.verdict.metadata_only") }}</button>
        </div>
      </div>

      <div class="mt-3">
        <button
          type="button"
          class="btn btn-outline-secondary btn-sm"
          data-testid="iiif-cancel"
          :disabled="busy"
          @click="cancel"
        >{{ t("iiif_import.cancel") }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
// @ts-ignore
import { listIiifCanvases } from '@maplat/core/src/iiif/manifest';
import { verdictOf, type IiifFetchFacts, type IiifImportReason, type IiifImportVerdict } from '../../utils/iiifImportVerdict';
import { iiifThumbnailUrls } from '../../utils/iiifThumbnailUrl';

const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const router = useRouter();

const url = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const warning = ref<string | null>(null);
const canvases = ref<Array<{ id: string; label: unknown; width: number; height: number; imageService?: string }>>([]);
const verdict = ref<IiifImportVerdict | null>(null);
const facts = ref<IiifFetchFacts | null>(null);
const selectedIndex = ref<number | null>(null);
const directInfo = ref(false);
const stagedDraftId = ref<string | null>(null);

const verdictKindKey = computed(() =>
  verdict.value?.kind === 'deliverable'
    ? 'iiif_import.verdict.deliverable'
    : 'iiif_import.verdict.metadata_only',
);

/** 理由の語を i18n の鍵にする。 */
function reasonKey(reason: string): string {
  return 'iiif_import.reason.' + reason;
}

/** canvas の label（文字列か言語ごとの表）から 1 つ選ぶ。 */
function canvasLabel(label: unknown): string {
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') {
    const table = label as Record<string, string>;
    return table.ja ?? table.en ?? Object.values(table)[0] ?? '';
  }
  return '';
}

/** 入力と判定の状態を戻す（URL は残す）。 */
function resetResult(): void {
  error.value = null;
  warning.value = null;
  canvases.value = [];
  verdict.value = null;
  facts.value = null;
  selectedIndex.value = null;
  directInfo.value = false;
}

/** 取得の結果から、判定に渡す事実だけを取り出す。 */
function factsOf(result: { requestedUrl: string; finalUrl: string; accessControlAllowOrigin?: string; json: unknown }): IiifFetchFacts {
  return {
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    accessControlAllowOrigin: result.accessControlAllowOrigin,
    infoJson: result.json,
  };
}

/** URL を読む。Manifest なら canvas の一覧、info.json なら判定を出す。 */
async function inspect(): Promise<void> {
  const entered = url.value.trim();
  if (!entered || busy.value) return;
  resetResult();
  busy.value = true;
  try {
    const result = await window.iiifImport.inspect({ manifestUrl: entered });
    if (!result.ok) {
      verdict.value = verdictOf({ failure: { reason: result.reason as IiifImportReason } });
      error.value = reasonKey(result.reason);
      return;
    }
    const nextFacts = factsOf(result);
    let listed: ReturnType<typeof listIiifCanvases>;
    try {
      listed = listIiifCanvases(result.json);
    } catch (_error) {
      listed = { ok: false, reason: 'not-manifest' };
    }
    if (listed.ok) {
      canvases.value = listed.canvases;
      return;
    }
    // Manifest として読めないときは、同じ応答を info.json として判定する。
    directInfo.value = true;
    facts.value = nextFacts;
    verdict.value = verdictOf({ facts: nextFacts });
  } catch (_error) {
    error.value = 'iiif_import.error.inspect_failed';
  } finally {
    busy.value = false;
  }
}

/** canvas を選んで、その画像サービスの info.json を判定する。 */
async function selectCanvas(index: number): Promise<void> {
  if (busy.value) return;
  const canvas = canvases.value[index];
  if (!canvas) return;
  if (!canvas.imageService) {
    error.value = 'iiif_import.error.no_image_service';
    return;
  }
  selectedIndex.value = index;
  verdict.value = null;
  warning.value = null;
  error.value = null;
  busy.value = true;
  try {
    const result = await window.iiifImport.inspect({ serviceUrl: canvas.imageService });
    if (!result.ok) {
      verdict.value = verdictOf({ failure: { reason: result.reason as IiifImportReason } });
      error.value = reasonKey(result.reason);
      return;
    }
    const nextFacts = factsOf(result);
    facts.value = nextFacts;
    verdict.value = verdictOf({ facts: nextFacts });
  } catch (_error) {
    error.value = 'iiif_import.error.inspect_failed';
  } finally {
    busy.value = false;
  }
}

/** 選んだ canvas の Manifest の URL（直接 info.json を入れたときは無い）。 */
function manifestUrl(): string | null {
  return directInfo.value ? null : url.value.trim();
}

/** 画像サービスの URL（判定の結果があればそれを、無ければ取ってきた URL から）。 */
function serviceUrlOf(): string | null {
  if (verdict.value?.kind === 'deliverable') return verdict.value.info.serviceUrl;
  const finalUrl = facts.value?.finalUrl;
  if (typeof finalUrl === 'string') return finalUrl.replace(/\/info\.json$/, '');
  return null;
}

/** 結び付きの記録（取れた範囲だけ）。 */
function iiifOf(): Record<string, unknown> {
  const iiif: Record<string, unknown> = {};
  const manifest = manifestUrl();
  const canvas = selectedIndex.value === null ? null : canvases.value[selectedIndex.value];
  if (manifest) iiif.manifest = manifest;
  if (canvas) iiif.canvas = canvas.id;
  const image = serviceUrlOf();
  if (image) iiif.image = image;
  return iiif;
}

/** 「IIIF から配信」を選んだ。預けて、サムネイルを取って、編集画面へ。 */
async function chooseDeliverable(): Promise<void> {
  const current = verdict.value;
  if (!current || current.kind !== 'deliverable' || busy.value) return;
  busy.value = true;
  error.value = null;
  warning.value = null;
  try {
    const draftId = await window.iiifImport.stageDraft({
      delivery: { type: 'iiifImage', url: current.info.serviceUrl },
      iiif: iiifOf(),
      width: current.info.width,
      height: current.info.height,
    });
    if (!draftId) {
      error.value = 'iiif_import.error.stage_failed';
      return;
    }
    stagedDraftId.value = draftId;

    const thumbnailUrls = facts.value ? iiifThumbnailUrls(facts.value.infoJson) : null;
    if (!thumbnailUrls) {
      warning.value = t('iiif_import.thumbnail_unavailable');
    } else {
      const saved = await window.iiifImport.thumbnails({ draftId, ...thumbnailUrls });
      if (!saved.ok) {
        await window.iiifImport.discardDraft(draftId);
        stagedDraftId.value = null;
        error.value = 'iiif_import.error.thumbnail_failed';
        return;
      }
    }
    await router.push(`/mapedit?new=1&import=iiif&draft=${encodeURIComponent(draftId)}`);
  } catch (_error) {
    error.value = 'iiif_import.error.stage_failed';
  } finally {
    busy.value = false;
  }
}

/** 「書誌だけ IIIF から」を選んだ。iiif だけを預けて、編集画面へ。 */
async function chooseMetadataOnly(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const draftId = await window.iiifImport.stageDraft({ iiif: iiifOf() });
    if (!draftId) {
      error.value = 'iiif_import.error.stage_failed';
      return;
    }
    stagedDraftId.value = draftId;
    await router.push(`/mapedit?new=1&import=1&draft=${encodeURIComponent(draftId)}`);
  } catch (_error) {
    error.value = 'iiif_import.error.stage_failed';
  } finally {
    busy.value = false;
  }
}

/** やめる。預けたものがあれば捨てる。 */
async function cancel(): Promise<void> {
  if (stagedDraftId.value) {
    const draftId = stagedDraftId.value;
    stagedDraftId.value = null;
    await window.iiifImport.discardDraft(draftId);
  }
  emit('close');
}
</script>

<style scoped>
.iiif-import-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1050;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.35);
}

.iiif-import-dialog {
  width: min(640px, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
}
</style>
