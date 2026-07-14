<template>
  <section class="base-map-edit d-flex flex-column h-100 position-relative bg-white">
    <DraftConflictDialog
      :visible="!!draftLifecycle.conflictDraft.value"
      @discard="draftLifecycle.resolveConflict('discard')"
      @apply="draftLifecycle.resolveConflict('apply')"
    />
    <EditorActionHeader
      :title="displayTitle"
      :save-state="saveState"
      :active-lang="activeLang"
      :language-options="SUPPORTED_LANGUAGES"
      :can-undo="editable && canUndo"
      :can-redo="editable && canRedo"
      :save-disabled="!dirty || !validation.valid"
      :saving="saving"
      :actions-disabled="generatingIcon || conflictRevision !== null"
      :save-visible="editable"
      :back-visible="backVisible"
      :discard-draft-visible="editable && (draftLifecycle.draftRestored.value || (isNew && dirty))"
      @back="goBack"
      @update:active-lang="activeLang = $event"
      @undo="undo"
      @redo="redo"
      @save="save"
      @discard-draft="discardDraft"
    />

    <DiagnosticFeedback
      v-if="error"
      scope="operation"
      :items="[{ key: 'save-error', severity: 'danger', message: error }]"
    />
    <DiagnosticFeedback
      v-else-if="sectionDiagnostics.length"
      scope="section"
      :items="sectionDiagnostics"
      data-testid="basemap-validation-summary"
    />
    <div v-if="conflictRevision !== null" class="alert alert-warning rounded-0 mb-0 py-2 d-flex align-items-center gap-2 flex-wrap">
      <span class="flex-grow-1">{{ t("common.revision_conflict") }}</span>
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="reloadLatest">{{ t("common.reload") }}</button>
      <button type="button" class="btn btn-sm btn-warning" @click="keepCurrentEdit">{{ t("common.overwrite") }}</button>
    </div>
    <div v-if="readOnly" class="alert alert-info rounded-0 mb-0 py-2" data-testid="basemap-editor-readonly">{{ t("basemap.master_detail.builtin_read_only") }}</div>

    <div class="flex-grow-1 overflow-auto p-3" data-testid="basemap-editor">
      <div class="row g-3">
        <div class="col-12 col-xl-6">
          <EditorField :label="t('basemap.modal.title_label')" :diagnostics="titleDiagnostics">
            <LangResourceInput
              input-testid="basemap-title"
              :model-value="document.title"
              :active-lang="activeLang"
              :default-lang="document.defaultLang"
              :language-options="SUPPORTED_LANGUAGES"
              :disabled="readOnly || saving"
              :invalid="titleDiagnostics.length > 0"
              @update:model-value="updateResource('title', $event)"
              @select-language="activeLang = $event"
            />
          </EditorField>
        </div>
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.master_detail.label") }}</label>
          <LangResourceInput
            input-testid="basemap-label"
            :model-value="document.label"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="readOnly || saving"
            @update:model-value="updateResource('label', $event)"
            @select-language="activeLang = $event"
          />
        </div>
        <div class="col-12">
          <label class="form-label fw-semibold">{{ t("basemap.modal.attr_label") }}</label>
          <LangResourceInput
            input-testid="basemap-attr"
            :model-value="document.attr"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="readOnly || saving"
            @update:model-value="updateResource('attr', $event)"
            @select-language="activeLang = $event"
          />
        </div>

        <div class="col-12"><hr class="my-1"></div>
        <div class="col-12 col-lg-6">
          <EditorField
            :label="t('basemap.modal.id_label')"
            label-for="basemap-slug-input"
            :diagnostics="slugDiagnostics"
          >
            <template #help>
              <ContextHelp
                :text="t('editor_ui.slug_format_help')"
                :ariaLabel="t('editor_ui.slug_format_help')"
              />
            </template>
            <input
              id="basemap-slug-input"
              :value="document.slug"
              type="text"
              class="form-control form-control-sm editor-ui-mono"
              :class="{ 'is-invalid': slugDiagnostics.length }"
              data-testid="basemap-slug"
              :disabled="structuralDisabled"
              @change="updateField('slug', ($event.target as HTMLInputElement).value.trim())"
            >
          </EditorField>
        </div>
        <div class="col-12 col-lg-6">
          <label class="form-label fw-semibold">{{ t("basemap.master_detail.default_language") }}</label>
          <select
            :value="document.defaultLang"
            class="form-select form-select-sm"
            data-testid="basemap-default-language"
            :disabled="structuralDisabled"
            @change="changeDefaultLang(($event.target as HTMLSelectElement).value as LangCode)"
          >
            <option v-for="language in SUPPORTED_LANGUAGES" :key="language.code" :value="language.code">{{ language.nativeName }}</option>
          </select>
        </div>
        <div class="col-12">
          <EditorField :label="t('basemap.modal.url_label')" label-for="basemap-url-input" :diagnostics="urlDiagnostics">
            <input
              id="basemap-url-input"
              :value="document.url"
              type="text"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': urlDiagnostics.length }"
              data-testid="basemap-url"
              :disabled="structuralDisabled"
              @change="updateField('url', ($event.target as HTMLInputElement).value.trim())"
            >
          </EditorField>
        </div>
        <div class="col-6">
          <EditorField :label="t('basemap.modal.min_zoom_label')" label-for="basemap-min-zoom-input" :diagnostics="minZoomDiagnostics">
            <input
              id="basemap-min-zoom-input"
              :value="document.minZoom ?? ''"
              type="number"
              min="0"
              max="25"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': minZoomDiagnostics.length }"
              :disabled="structuralDisabled"
              @change="updateNumber('minZoom', ($event.target as HTMLInputElement).value)"
            >
          </EditorField>
        </div>
        <div class="col-6">
          <EditorField :label="t('basemap.modal.max_zoom_label')" label-for="basemap-max-zoom-input" :diagnostics="maxZoomDiagnostics">
            <input
              id="basemap-max-zoom-input"
              :value="document.maxZoom ?? ''"
              type="number"
              min="1"
              max="25"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': maxZoomDiagnostics.length }"
              :disabled="structuralDisabled"
              @change="updateNumber('maxZoom', ($event.target as HTMLInputElement).value)"
            >
          </EditorField>
        </div>

        <div class="col-12">
          <label class="form-label fw-semibold">{{ t("basemap.icon") }}</label>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <img v-if="thumbnailUrl" :src="thumbnailUrl" class="base-map-icon" :alt="document.slug">
            <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="structuralDisabled" @click="uploadIcon">{{ t("appedit.upload") }}</button>
            <button type="button" class="btn btn-sm btn-outline-primary" :disabled="structuralDisabled || !canGenerateIcon || generatingIcon" @click="generateIcon">
              {{ generatingIcon ? t("basemap.generating_icon") : t("basemap.generate_icon") }}
            </button>
          </div>
        </div>
        <div class="col-12">
          <label class="form-label fw-semibold">
            {{ t("basemap.coverage") }}
            <ContextHelp
              :title="t('basemap.coverage')"
              :text="t('basemap.coverage_help')"
              :ariaLabel="t('basemap.coverage_help')"
            />
          </label>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="small font-monospace">{{ coverageText }}</span>
            <button type="button" class="btn btn-sm btn-outline-primary" :disabled="structuralDisabled" @click="showEnvelopeModal = true">{{ t("appedit.envelope_pick") }}</button>
            <button v-if="document.coverageLngLats" type="button" class="btn btn-sm btn-outline-danger" :disabled="structuralDisabled" @click="updateField('coverageLngLats', null)">{{ t("appedit.envelope_clear") }}</button>
          </div>
        </div>
      </div>
    </div>

    <EnvelopeEditorModal
      v-if="showEnvelopeModal"
      :model-value="document.coverageLngLats"
      :overlay-tms="overlayTms"
      title-key="basemap.coverage_modal_title"
      help-key="basemap.coverage_modal_help"
      @update:model-value="updateField('coverageLngLats', $event)"
      @close="showEnvelopeModal = false"
    />
    <EditorBusyOverlay :visible="saving || generatingIcon" :label="saving ? t('editor_ui.save_state.saving') : t('basemap.generating_icon')" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import EnvelopeEditorModal from "../EnvelopeEditorModal.vue";
import LangResourceInput from "../LangResourceInput.vue";
import DraftConflictDialog from "../editor-ui/DraftConflictDialog.vue";
import EditorActionHeader from "../editor-ui/EditorActionHeader.vue";
import EditorBusyOverlay from "../editor-ui/EditorBusyOverlay.vue";
import EditorField from "../editor-ui/EditorField.vue";
import DiagnosticFeedback from "../editor-ui/DiagnosticFeedback.vue";
import ContextHelp from "../editor-ui/ContextHelp.vue";
import type { DiagnosticItem, EditorSaveState } from "../editor-ui/editorUiTypes";
import { useAssetDraftLifecycle } from "../../composables/useAssetDraftLifecycle";
import { UndoStack } from "../../services/editorUndoStack";
import {
  fromBaseMapCatalogItem,
  newBaseMapDocument,
  resolveBaseMapRuntimeText,
  toBaseMapSavePayload,
  validateBaseMapDocument,
  type BaseMapCatalogItem,
  type BaseMapEditDocument,
} from "../../utils/baseMapEditorDocument";
import { envelopeToBbox } from "../../utils/appSourceModel";
import { isTranslationMode } from "../../utils/editorLanguageMode";
import { SUPPORTED_LANGUAGES, resolveEditorLanguage, type LangCode } from "../../utils/editorLanguages";
import { isEditableElement } from "../../utils/nativeTextUndo";
import type { BaseMapSaveResult } from "../../electron";

const props = withDefaults(defineProps<{ uid: string; isNew: boolean; item: BaseMapCatalogItem | null; backVisible?: boolean }>(), {
  backVisible: true,
});
const emit = defineEmits<{ back: []; saved: [uid: string]; changed: []; reload: [uid: string]; "draft-state": [uid: string, hasDraft: boolean] }>();
const { t } = useTranslation();

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const initial = props.item
  ? fromBaseMapCatalogItem(props.item)
  : newBaseMapDocument(props.uid, resolveEditorLanguage(i18next.language));
const document = ref<BaseMapEditDocument>(clone(initial));
let history = new UndoStack<BaseMapEditDocument>(clone(initial));
const historyVersion = ref(0);
const revision = ref<number | null>(props.item?.revision ?? null);
const activeLang = ref<LangCode>(document.value.defaultLang);
const saving = ref(false);
const generatingIcon = ref(false);
const error = ref("");
const conflictRevision = ref<number | null>(null);
const overwritePending = ref(false);
const thumbnailUrl = ref<string | null>(props.item?.thumbnailUrl ?? null);
const showEnvelopeModal = ref(false);
const readOnly = computed(() => document.value.scope === "builtin");
const editable = computed(() => !readOnly.value);
const translationMode = computed(() => isTranslationMode(activeLang.value, document.value.defaultLang));
const structuralDisabled = computed(() => readOnly.value || translationMode.value || saving.value);
const dirty = computed(() => (historyVersion.value, history.isDirty()));
const canUndo = computed(() => (historyVersion.value, history.canUndo()));
const canRedo = computed(() => (historyVersion.value, history.canRedo()));
const validation = computed(() => validateBaseMapDocument(document.value));
// 既存 validation の error code → i18n キー（黄色バナー再利用の文言）。
const VALIDATION_MESSAGE_KEYS: Record<string, string> = {
  "slug-required": "basemap.errors.id_required",
  "slug-invalid": "basemap.errors.id_invalid",
  "title-required": "basemap.errors.title_required",
  "url-required": "basemap.errors.url_required",
  "url-invalid": "basemap.errors.url_invalid",
  "min-zoom-invalid": "basemap.errors.min_zoom_invalid",
  "max-zoom-invalid": "basemap.errors.max_zoom_invalid",
  "zoom-range": "basemap.errors.zoom_order_invalid",
};
// 指定 code 集合を field 診断（danger）へ。全項目を即時表示する（dirty ゲートなし）。
function diagnosticsFor(codes: readonly string[]): DiagnosticItem[] {
  return validation.value.errors
    .filter((code) => codes.includes(code))
    .map((code) => ({ key: code, severity: "danger" as const, message: t(VALIDATION_MESSAGE_KEYS[code]) }));
}
const slugDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["slug-required", "slug-invalid"]));
const titleDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["title-required"]));
const urlDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["url-required", "url-invalid"]));
const minZoomDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["min-zoom-invalid"]));
const maxZoomDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["max-zoom-invalid"]));
// section summary は全 validation error を同じ文法で併記する。
const sectionDiagnostics = computed<DiagnosticItem[]>(() =>
  validation.value.errors.map((code) => ({ key: code, severity: "danger" as const, message: t(VALIDATION_MESSAGE_KEYS[code]) })),
);
const displayTitle = computed(() => resolveBaseMapRuntimeText(document.value.title, activeLang.value, document.value.defaultLang) || document.value.slug || t("basemap.master_detail.untitled"));
const saveState = computed<EditorSaveState>(() => saving.value ? "saving" : draftLifecycle.draftRestored.value ? "draft-restored" : dirty.value ? "dirty" : "saved");

const draftLifecycle = useAssetDraftLifecycle<BaseMapEditDocument>({
  kind: "base-map",
  serialize: () => clone(document.value),
  apply: (payload) => { document.value = clone(payload); },
  onRestored: () => {
    activeLang.value = document.value.defaultLang;
    history = new UndoStack(clone(document.value));
    history.markDirty();
    historyVersion.value++;
  },
  shouldPersist: () => editable.value && dirty.value,
});

function resetSession(item: BaseMapCatalogItem | null, uid: string): void {
  const next = item ? fromBaseMapCatalogItem(item) : newBaseMapDocument(uid, resolveEditorLanguage(i18next.language));
  document.value = clone(next);
  history = new UndoStack(clone(next));
  historyVersion.value++;
  revision.value = item?.revision ?? null;
  activeLang.value = next.defaultLang;
  thumbnailUrl.value = item?.thumbnailUrl ?? null;
  error.value = "";
  conflictRevision.value = null;
  overwritePending.value = false;
}

let sessionOpened = false;
let sessionTransition = Promise.resolve();
let pendingSavedIdentity: { uid: string; revision: number } | null = null;
watch(
  () => [props.uid, props.item?.revision, props.isNew] as const,
  ([uid, itemRevision, isNew]) => {
    sessionTransition = sessionTransition.then(async () => {
      if (sessionOpened) await draftLifecycle.flush();
      if (uid !== props.uid || itemRevision !== props.item?.revision || isNew !== props.isNew) return;
      if (
        pendingSavedIdentity &&
        !isNew &&
        uid === pendingSavedIdentity.uid &&
        itemRevision === pendingSavedIdentity.revision
      ) {
        pendingSavedIdentity = null;
        await draftLifecycle.open(uid, itemRevision);
        sessionOpened = true;
        return;
      }
      resetSession(props.item, uid);
      if (props.item?.scope !== "builtin") await draftLifecycle.open(uid, itemRevision ?? null);
      sessionOpened = props.item?.scope !== "builtin";
    }).catch((cause) => {
      console.error("Failed to change base map editor session", cause);
      error.value = t("basemap.errors.load_failed");
    });
  },
  { immediate: true },
);

function commit(next: BaseMapEditDocument): void {
  if (readOnly.value) return;
  // F4: 文書の変更で保存時 operation 診断（ID重複等）を解消する。
  error.value = "";
  document.value = clone(next);
  history.push(clone(next));
  historyVersion.value++;
  draftLifecycle.schedule(true);
  emit("changed");
}

function updateField<K extends keyof BaseMapEditDocument>(key: K, value: BaseMapEditDocument[K]): void {
  if (structuralDisabled.value && !(["title", "label", "attr"] as string[]).includes(key)) return;
  commit({ ...document.value, [key]: clone(value) });
}

function updateResource(key: "title" | "label" | "attr", value: string | Record<string, string> | undefined): void {
  const normalized = typeof value === "object" && value ? value : value ? { [document.value.defaultLang]: value } : {};
  updateField(key, normalized);
}

function updateNumber(key: "minZoom" | "maxZoom", raw: string): void {
  updateField(key, raw === "" ? null : Number(raw));
}

function changeDefaultLang(lang: LangCode): void {
  updateField("defaultLang", lang);
  activeLang.value = lang;
}

function applyHistory(): void {
  // F4: Undo/Redo でも保存時 operation 診断を解消する。
  error.value = "";
  document.value = clone(history.current());
  historyVersion.value++;
  draftLifecycle.schedule(dirty.value);
}
function undo(): void { history.undo(); applyHistory(); }
function redo(): void { history.redo(); applyHistory(); }

function onEditorKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    if (!saving.value && conflictRevision.value === null && editable.value && dirty.value && validation.value.valid) void save();
    return;
  }
  if (isEditableElement(event.target as Element | null) || saving.value || generatingIcon.value || conflictRevision.value !== null) return;
  if (key === "z" && event.shiftKey) {
    event.preventDefault();
    redo();
  } else if (key === "z") {
    event.preventDefault();
    undo();
  } else if (key === "y") {
    event.preventDefault();
    redo();
  }
}

onMounted(() => window.addEventListener("keydown", onEditorKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onEditorKeydown));

// F8: dirty（下書きが存在する状態）の変化を親 List へ即時通知する。
// Undo で checkpoint clean に戻れば dirty=false となりバッジが即時に消える。
watch(
  () => [props.uid, dirty.value] as const,
  ([uid, hasDraft]) => emit("draft-state", uid, hasDraft),
  { immediate: true },
);

async function goBack(): Promise<void> {
  await sessionTransition;
  if (editable.value) await draftLifecycle.flush();
  emit("back");
}

async function discardDraft(): Promise<void> {
  const result = await (window as any).dialog.showMessageBox({
    type: "warning",
    buttons: [t("editor_ui.discard_draft"), t("common.cancel")],
    defaultId: 1,
    cancelId: 1,
    message: t("editor_ui.discard_draft_confirm"),
  });
  if (result.response !== 0) return;
  await draftLifecycle.discard();
  if (props.item) resetSession(props.item, props.uid);
  else emit("back");
  emit("changed");
}

function saveFailure(result: BaseMapSaveResult): string {
  if ("error" in result) return t("common.revision_conflict");
  if (result.result === "Exist") return t("basemap.errors.id_duplicate");
  if (result.result === "Error") return result.message || t("basemap.errors.save_failed");
  return t("basemap.errors.save_failed");
}

async function save(): Promise<void> {
  await sessionTransition;
  if (!editable.value || !dirty.value || !validation.value.valid) return;
  if (overwritePending.value) {
    const confirmation = await (window as any).dialog.showMessageBox({
      type: "warning",
      buttons: [t("common.overwrite"), t("common.cancel")],
      defaultId: 1,
      cancelId: 1,
      message: t("basemap.master_detail.overwrite_confirm"),
    });
    if (confirmation.response !== 0) return;
    overwritePending.value = false;
  }
  error.value = "";
  saving.value = true;
  try {
    const available = await window.assets.checkSlug({ slug: document.value.slug, excludeUid: revision.value === null ? undefined : document.value.uid });
    if (!available) { error.value = t("basemap.errors.id_duplicate"); return; }
    const captured = document.value;
    const capturedVersion = historyVersion.value;
    const result = await window.baseMaps.saveUser(toBaseMapSavePayload(captured, revision.value));
    if (!("result" in result)) {
      conflictRevision.value = result.current;
      error.value = "";
      return;
    }
    if (result.result !== "Success") { error.value = saveFailure(result); return; }
    revision.value = result.revision;
    const snapshot = history.snapshot();
    history = UndoStack.fromSnapshot({
      ...snapshot,
      history: snapshot.history.map((state) => ({ ...state, uid: result.uid })),
    });
    document.value = clone(history.current());
    if (capturedVersion === historyVersion.value) {
      history.save();
      historyVersion.value++;
      await draftLifecycle.markSaved();
    }
    pendingSavedIdentity = { uid: result.uid, revision: result.revision };
    emit("saved", result.uid);
  } catch (cause) {
    console.error("Failed to save base map", cause);
    error.value = t("basemap.errors.save_failed");
  } finally {
    saving.value = false;
  }
}

async function reloadLatest(): Promise<void> {
  await draftLifecycle.discard();
  sessionOpened = false;
  conflictRevision.value = null;
  emit("reload", document.value.uid);
}

function keepCurrentEdit(): void {
  if (conflictRevision.value === null) return;
  revision.value = conflictRevision.value;
  conflictRevision.value = null;
  overwritePending.value = true;
}

async function prepareForDelete(): Promise<void> {
  await sessionTransition;
  if (sessionOpened) await draftLifecycle.discard();
  sessionOpened = false;
}

defineExpose({ prepareForDelete });

const overlayTms = computed(() => {
  const url = document.value.url.trim();
  if (!(url.includes("{z}") && url.includes("{x}") && (url.includes("{y}") || url.includes("{-y}")))) return null;
  return { url, minZoom: document.value.minZoom ?? undefined, maxZoom: document.value.maxZoom ?? undefined };
});
const canGenerateIcon = computed(() => overlayTms.value !== null && document.value.coverageLngLats !== null && !!document.value.slug);
const iconFileKey = () => revision.value === null ? document.value.slug : document.value.uid;

async function uploadIcon(): Promise<void> {
  const key = iconFileKey();
  if (!key) { error.value = t("basemap.errors.id_required"); return; }
  try {
    const result = await window.appAssets.uploadTmsThumbnail(key);
    if (result.err === "Canceled") return;
    if (result.err || !result.path) { error.value = t("appedit.error_invalid_image"); return; }
    thumbnailUrl.value = result.fileUrl ?? null;
    updateField("thumbnail", result.path);
  } catch (cause) {
    console.error("Failed to upload base map icon", cause);
    error.value = t("appedit.error_invalid_image");
  }
}

async function generateIcon(): Promise<void> {
  if (!overlayTms.value || !document.value.coverageLngLats) return;
  generatingIcon.value = true;
  error.value = "";
  try {
    const result = await window.appAssets.generateTmsThumbnail(iconFileKey(), clone(overlayTms.value), clone(document.value.coverageLngLats));
    if (result.err || !result.path) { error.value = t("basemap.errors.icon_generate_failed"); return; }
    thumbnailUrl.value = result.fileUrl ? `${result.fileUrl}?t=${Date.now()}` : null;
    updateField("thumbnail", result.path);
  } catch (cause) {
    console.error("Failed to generate base map icon", cause);
    error.value = t("basemap.errors.icon_generate_failed");
  } finally {
    generatingIcon.value = false;
  }
}

const coverageText = computed(() => {
  const bbox = envelopeToBbox(document.value.coverageLngLats);
  return bbox ? `W${bbox[0]} S${bbox[1]} E${bbox[2]} N${bbox[3]}` : "-";
});
</script>

<style scoped>
.base-map-edit { min-width: 0; }
.base-map-icon { width: 52px; height: 52px; object-fit: contain; background: #f8f9fa; border: 1px solid var(--bs-border-color); }
</style>
