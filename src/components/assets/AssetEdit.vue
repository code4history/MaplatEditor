<template>
  <section class="asset-edit d-flex flex-column h-100 position-relative bg-white">
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
      :can-undo="canUndo"
      :can-redo="canRedo"
      :save-disabled="!dirty || !validation.valid"
      :saving="saving"
      :actions-disabled="picking || conflictRevision !== null"
      :discard-draft-visible="!isNew && draftLifecycle.draftRestored.value"
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
    <div v-else-if="dirty && validationMessages.length" class="alert alert-warning rounded-0 mb-0 py-2">
      <ul class="mb-0"><li v-for="message in validationMessages" :key="message">{{ message }}</li></ul>
    </div>
    <div v-if="conflictRevision !== null" class="alert alert-warning rounded-0 mb-0 py-2 d-flex align-items-center gap-2 flex-wrap">
      <span class="flex-grow-1">{{ t("common.revision_conflict") }}</span>
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="reloadLatest">{{ t("common.reload") }}</button>
      <button type="button" class="btn btn-sm btn-warning" @click="keepCurrentEdit">{{ t("common.overwrite") }}</button>
    </div>

    <div class="flex-grow-1 overflow-auto p-3">
      <div class="row g-3">
        <div class="col-12 col-xl-7">
          <label class="form-label fw-semibold">{{ t("assetlist.title_label") }}</label>
          <LangResourceInput
            input-testid="asset-title"
            :model-value="document.title"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="saving || picking"
            @update:model-value="updateTitle"
            @select-language="activeLang = $event"
          />
        </div>
        <div class="col-12 col-xl-5">
          <label class="form-label fw-semibold">{{ t("assetlist.master_detail.default_language") }}</label>
          <select
            :value="document.defaultLang"
            class="form-select form-select-sm"
            :disabled="structuralDisabled"
            @change="changeDefaultLang(($event.target as HTMLSelectElement).value as LangCode)"
          >
            <option v-for="language in SUPPORTED_LANGUAGES" :key="language.code" :value="language.code">{{ language.nativeName }}</option>
          </select>
        </div>
        <div class="col-12">
          <EditorField
            :label="t('assetlist.slug_label')"
            label-for="asset-slug-input"
            :diagnostics="slugDiagnostics"
          >
            <template #help>
              <ContextHelp
                mode="tooltip"
                :text="t('editor_ui.slug_format_help')"
                :ariaLabel="t('editor_ui.slug_format_help')"
              />
            </template>
            <input
              id="asset-slug-input"
              :value="document.slug"
              type="text"
              class="form-control form-control-sm editor-ui-mono"
              data-testid="asset-slug"
              :disabled="structuralDisabled"
              @change="updateDocument({ ...document, slug: ($event.target as HTMLInputElement).value.trim() })"
            >
          </EditorField>
        </div>

        <div class="col-12"><hr class="my-1"></div>
        <div class="col-12">
          <label class="form-label fw-semibold">{{ t("assetlist.add_modal.file_label") }}</label>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <button v-if="isNew" type="button" class="btn btn-sm btn-outline-primary" data-testid="asset-pick-file" :disabled="structuralDisabled" @click="pickImageFile">
              {{ t("assetlist.master_detail.select_image") }}
            </button>
            <span class="small">{{ volatileSource?.sourceName || document.sourceName || t("assetlist.master_detail.no_source") }}</span>
          </div>
          <div v-if="isNew && !volatileSource" class="form-text text-warning" data-testid="asset-source-repick-warning">{{ t("assetlist.master_detail.reselect_required") }}</div>
        </div>

        <div v-if="previewUrl" class="col-12 col-xl-5">
          <div class="asset-preview border rounded p-2"><img :src="previewUrl" :alt="displayTitle"></div>
        </div>
        <div class="col-12" :class="previewUrl ? 'col-xl-7' : ''">
          <dl class="row small mb-0">
            <dt class="col-4">{{ t("assetlist.master_detail.source_name") }}</dt><dd class="col-8 text-break">{{ document.sourceName || "-" }}</dd>
            <dt class="col-4">MIME</dt><dd class="col-8">{{ document.mime || "-" }}</dd>
            <dt class="col-4">{{ t("assetlist.master_detail.dimensions") }}</dt><dd class="col-8">{{ dimensions }}</dd>
            <dt class="col-4">{{ t("assetlist.master_detail.file_size") }}</dt><dd class="col-8">{{ fileSize }}</dd>
          </dl>
        </div>
      </div>
    </div>

    <EditorBusyOverlay :visible="saving || picking" :label="saving ? t('editor_ui.save_state.saving') : t('assetlist.master_detail.selecting')" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
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
import type { ImageAssetRow, ImageAssetSaveResult } from "../../electron";
import {
  applyImageAssetDraft,
  fromImageAssetRow,
  newImageAssetDocument,
  toImageAssetDraft,
  validateImageAssetDocument,
  type ImageAssetEditDocument,
} from "../../utils/imageAssetEditorDocument";
import { isTranslationMode } from "../../utils/editorLanguageMode";
import { SUPPORTED_LANGUAGES, resolveEditorLanguage, type LangCode } from "../../utils/editorLanguages";
import { localizeTitle } from "../../utils/langResource";
import { isEditableElement } from "../../utils/nativeTextUndo";

interface VolatileSource { sourcePath: string; sourceName: string }
interface AssetEditHistoryState { document: ImageAssetEditDocument; volatileSource: VolatileSource | null }

const props = defineProps<{ uid: string; isNew: boolean; item: ImageAssetRow | null }>();
const emit = defineEmits<{ back: []; saved: [uid: string]; changed: []; reload: [uid: string] }>();
const { t } = useTranslation();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const initialDocument = props.item
  ? fromImageAssetRow(props.item)
  : newImageAssetDocument(props.uid, resolveEditorLanguage(i18next.language));
const document = ref<ImageAssetEditDocument>(clone(initialDocument));
const volatileSource = shallowRef<VolatileSource | null>(null);
let history = new UndoStack<AssetEditHistoryState>({ document: clone(initialDocument), volatileSource: null });
const historyVersion = ref(0);
const revision = ref<number | null>(props.item?.revision ?? null);
const activeLang = ref<LangCode>(document.value.defaultLang);
const saving = ref(false);
const picking = ref(false);
const error = ref("");
const previewUrl = ref<string | null>(null);
const conflictRevision = ref<number | null>(null);
const overwritePending = ref(false);

const translationMode = computed(() => isTranslationMode(activeLang.value, document.value.defaultLang));
const structuralDisabled = computed(() => translationMode.value || saving.value || picking.value);
const dirty = computed(() => (historyVersion.value, history.isDirty()));
const canUndo = computed(() => (historyVersion.value, history.canUndo()));
const canRedo = computed(() => (historyVersion.value, history.canRedo()));
const validation = computed(() => validateImageAssetDocument(document.value, volatileSource.value !== null));
const validationMessages = computed(() => validation.value.errors.map((code) => t({
  "slug-required": "assetlist.errors.slug_required",
  "slug-invalid": "assetlist.errors.slug_charset",
  "title-required": "assetlist.errors.title_required",
  "source-required": "assetlist.master_detail.reselect_required",
}[code])));
// slug 形式エラーだけを field 診断へ（既存 validation を再利用）
const SLUG_ERROR_MESSAGE_KEYS: Record<string, string> = {
  "slug-required": "assetlist.errors.slug_required",
  "slug-invalid": "assetlist.errors.slug_charset",
};
const slugDiagnostics = computed<DiagnosticItem[]>(() =>
  validation.value.errors
    .filter((code) => code === "slug-required" || code === "slug-invalid")
    .map((code) => ({ key: code, severity: "danger" as const, message: t(SLUG_ERROR_MESSAGE_KEYS[code]) })),
);
const displayTitle = computed(() => localizeTitle(document.value.title, activeLang.value) || document.value.slug || t("assetlist.master_detail.untitled"));
const saveState = computed<EditorSaveState>(() => saving.value ? "saving" : draftLifecycle.draftRestored.value ? "draft-restored" : dirty.value ? "dirty" : "saved");
const dimensions = computed(() => document.value.width !== null && document.value.height !== null ? `${document.value.width}×${document.value.height}` : "-");
const fileSize = computed(() => document.value.byteSize === null ? "-" : `${Math.max(1, Math.round(document.value.byteSize / 1024))} KB`);

const draftLifecycle = useAssetDraftLifecycle<ReturnType<typeof toImageAssetDraft>>({
  kind: "image-asset",
  serialize: () => toImageAssetDraft(document.value),
  apply: (payload) => { document.value = applyImageAssetDraft(document.value, payload); },
  onRestored: () => {
    activeLang.value = document.value.defaultLang;
    history = new UndoStack({ document: clone(document.value), volatileSource: null });
    history.markDirty();
    historyVersion.value++;
  },
  shouldPersist: () => dirty.value,
});

function resetSession(item: ImageAssetRow | null, uid: string): void {
  const next = item ? fromImageAssetRow(item) : newImageAssetDocument(uid, resolveEditorLanguage(i18next.language));
  document.value = clone(next);
  volatileSource.value = null;
  history = new UndoStack({ document: clone(next), volatileSource: null });
  historyVersion.value++;
  revision.value = item?.revision ?? null;
  activeLang.value = next.defaultLang;
  error.value = "";
  conflictRevision.value = null;
  overwritePending.value = false;
  previewUrl.value = null;
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
        props.item &&
        !isNew &&
        uid === pendingSavedIdentity.uid &&
        itemRevision === pendingSavedIdentity.revision
      ) {
        pendingSavedIdentity = null;
        const persisted = fromImageAssetRow(props.item);
        const snapshot = history.snapshot();
        history = UndoStack.fromSnapshot({
          ...snapshot,
          history: snapshot.history.map((entry) => ({
            ...entry,
            document: {
              ...entry.document,
              uid,
              sourceName: persisted.sourceName,
              mime: persisted.mime,
              ext: persisted.ext,
              width: persisted.width,
              height: persisted.height,
              byteSize: persisted.byteSize,
            },
          })),
        });
        document.value = clone(history.current().document);
        previewUrl.value = await window.imageAssets.getFilePath(uid).catch(() => null);
        historyVersion.value++;
        await draftLifecycle.open(uid, itemRevision);
        sessionOpened = true;
        return;
      }
      resetSession(props.item, uid);
      if (props.item) previewUrl.value = await window.imageAssets.getFilePath(uid).catch(() => null);
      await draftLifecycle.open(uid, itemRevision ?? null);
      sessionOpened = true;
    }).catch((cause) => {
      console.error("Failed to change image asset editor session", cause);
      error.value = t("assetlist.errors.internal");
    });
  },
  { immediate: true },
);

function pushCurrent(): void {
  history.push({ document: clone(document.value), volatileSource: clone(volatileSource.value) });
  historyVersion.value++;
  draftLifecycle.schedule(true);
  emit("changed");
}

function updateDocument(next: ImageAssetEditDocument): void {
  document.value = clone(next);
  pushCurrent();
}

function updateTitle(value: string | Record<string, string> | undefined): void {
  const title = typeof value === "object" && value ? value : value ? { [document.value.defaultLang]: value } : {};
  updateDocument({ ...document.value, title });
}

function changeDefaultLang(lang: LangCode): void {
  updateDocument({ ...document.value, defaultLang: lang });
  activeLang.value = lang;
}

function applyHistory(): void {
  const current = history.current();
  document.value = clone(current.document);
  volatileSource.value = clone(current.volatileSource);
  historyVersion.value++;
  draftLifecycle.schedule(dirty.value);
}
function undo(): void { history.undo(); applyHistory(); }
function redo(): void { history.redo(); applyHistory(); }

const suggestSlug = (name: string) => name.normalize("NFKD").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

async function pickImageFile(): Promise<void> {
  if (!props.isNew || structuralDisabled.value) return;
  picking.value = true;
  error.value = "";
  try {
    const picked = await window.imageAssets.pickImageFile();
    if (!picked) return;
    volatileSource.value = { sourcePath: picked.filePath, sourceName: picked.fileName };
    const stem = picked.fileName.replace(/\.[^.]+$/, "");
    const title = Object.keys(document.value.title).length ? document.value.title : { [document.value.defaultLang]: stem };
    document.value = {
      ...document.value,
      sourceName: picked.fileName,
      slug: document.value.slug || suggestSlug(picked.fileName),
      title,
    };
    pushCurrent();
  } catch (cause) {
    console.error("Failed to pick image file", cause);
    error.value = t("assetlist.errors.pick_failed");
  } finally {
    picking.value = false;
  }
}

async function goBack(): Promise<void> {
  await sessionTransition;
  await draftLifecycle.flush();
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
  emit("changed");
}

function saveFailure(result: ImageAssetSaveResult): string {
  if ("error" in result) return t("common.revision_conflict");
  if (result.result === "Exist") return t("assetlist.errors.slug_taken");
  if (result.result === "Error") {
    if (result.message === "payload-too-large") return t("assetlist.errors.payload_too_large");
    const message = result.code === "not-found"
      ? t("assetlist.errors.not_found")
      : result.code === "invalid-request"
        ? t("assetlist.errors.invalid")
        : t("assetlist.errors.internal");
    return props.isNew ? `${message}\n${t("assetlist.errors.add_failed_hint")}` : message;
  }
  return t("assetlist.errors.internal");
}

async function save(): Promise<void> {
  await sessionTransition;
  if (!dirty.value || !validation.value.valid) return;
  if (overwritePending.value) {
    const confirmation = await (window as any).dialog.showMessageBox({
      type: "warning",
      buttons: [t("common.overwrite"), t("common.cancel")],
      defaultId: 1,
      cancelId: 1,
      message: t("assetlist.master_detail.overwrite_confirm"),
    });
    if (confirmation.response !== 0) return;
    overwritePending.value = false;
  }
  error.value = "";
  saving.value = true;
  try {
    const available = await window.assets.checkSlug({ slug: document.value.slug, excludeUid: revision.value === null ? undefined : document.value.uid });
    if (!available) { error.value = t("assetlist.errors.slug_taken"); return; }
    const capturedVersion = historyVersion.value;
    let result: ImageAssetSaveResult;
    if (props.isNew) {
      if (!volatileSource.value) { error.value = t("assetlist.master_detail.reselect_required"); return; }
      result = await window.imageAssets.add({
        slug: document.value.slug,
        title: clone(document.value.title),
        lang: document.value.defaultLang,
        sourceName: volatileSource.value.sourceName,
        sourcePath: volatileSource.value.sourcePath,
      });
    } else {
      result = await window.imageAssets.updateMetadata(document.value.uid, {
        slug: document.value.slug,
        title: clone(document.value.title),
        lang: document.value.defaultLang,
        expectedRevision: revision.value as number,
      });
    }
    if (!("result" in result)) { conflictRevision.value = result.current; return; }
    if (result.result !== "Success") { error.value = saveFailure(result); return; }
    revision.value = result.revision;
    const snapshot = history.snapshot();
    history = UndoStack.fromSnapshot({
      ...snapshot,
      history: snapshot.history.map((entry) => ({ ...entry, document: { ...entry.document, uid: result.uid } })),
    });
    document.value = clone(history.current().document);
    if (capturedVersion === historyVersion.value) {
      history.save();
      historyVersion.value++;
      await draftLifecycle.markSaved();
    }
    pendingSavedIdentity = { uid: result.uid, revision: result.revision };
    emit("saved", result.uid);
  } catch (cause) {
    console.error("Failed to save image asset", cause);
    error.value = t("assetlist.errors.internal");
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

function onEditorKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    if (!saving.value && !picking.value && conflictRevision.value === null && dirty.value && validation.value.valid) void save();
    return;
  }
  if (isEditableElement(event.target as Element | null) || saving.value || picking.value || conflictRevision.value !== null) return;
  if (key === "z" && event.shiftKey) { event.preventDefault(); redo(); }
  else if (key === "z") { event.preventDefault(); undo(); }
  else if (key === "y") { event.preventDefault(); redo(); }
}
onMounted(() => window.addEventListener("keydown", onEditorKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onEditorKeydown));

defineExpose({ prepareForDelete });
</script>

<style scoped>
.asset-edit { min-width: 0; }
.asset-preview { height: 16rem; display: grid; place-items: center; background: #f8f9fa; }
.asset-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
