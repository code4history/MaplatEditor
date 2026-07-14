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
      :back-visible="backVisible"
      :discard-draft-visible="draftLifecycle.draftRestored.value || (isNew && dirty)"
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
      data-testid="asset-validation-summary"
    />
    <div v-if="conflictRevision !== null" class="alert alert-warning rounded-0 mb-0 py-2 d-flex align-items-center gap-2 flex-wrap">
      <span class="flex-grow-1">{{ t("common.revision_conflict") }}</span>
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="reloadLatest">{{ t("common.reload") }}</button>
      <button type="button" class="btn btn-sm btn-warning" @click="keepCurrentEdit">{{ t("common.overwrite") }}</button>
    </div>

    <div class="flex-grow-1 overflow-auto p-3">
      <div class="row g-3">
        <div class="col-12 col-xl-7">
          <EditorField :label="t('assetlist.title_label')" :diagnostics="titleDiagnostics">
            <LangResourceInput
              input-testid="asset-title"
              :model-value="document.title"
              :active-lang="activeLang"
              :default-lang="document.defaultLang"
              :language-options="SUPPORTED_LANGUAGES"
              :disabled="saving || picking"
              :invalid="titleDiagnostics.length > 0"
              @update:model-value="updateTitle"
              @select-language="activeLang = $event"
            />
          </EditorField>
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
                :text="t('editor_ui.slug_format_help')"
                :ariaLabel="t('editor_ui.slug_format_help')"
              />
            </template>
            <input
              id="asset-slug-input"
              :value="document.slug"
              type="text"
              class="form-control form-control-sm editor-ui-mono"
              :class="{ 'is-invalid': slugDiagnostics.length }"
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
          <DiagnosticFeedback
            v-if="sourceDiagnostics.length"
            scope="field"
            :items="sourceDiagnostics"
            data-testid="asset-source-repick-warning"
          />
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

const props = withDefaults(defineProps<{ uid: string; isNew: boolean; item: ImageAssetRow | null; backVisible?: boolean }>(), {
  backVisible: true,
});
const emit = defineEmits<{ back: []; saved: [uid: string]; changed: []; reload: [uid: string]; "draft-state": [uid: string, hasDraft: boolean]; flushed: [] }>();
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
// 既存 validation の error code → i18n キー（黄色バナー再利用の文言）。
const VALIDATION_MESSAGE_KEYS: Record<string, string> = {
  "slug-required": "assetlist.errors.slug_required",
  "slug-invalid": "assetlist.errors.slug_charset",
  "title-required": "assetlist.errors.title_required",
  "source-required": "assetlist.master_detail.reselect_required",
};
// 指定 code 集合を field 診断（danger）へ。全項目を即時表示する（dirty ゲートなし）。
function diagnosticsFor(codes: readonly string[]): DiagnosticItem[] {
  return validation.value.errors
    .filter((code) => codes.includes(code))
    .map((code) => ({ key: code, severity: "danger" as const, message: t(VALIDATION_MESSAGE_KEYS[code]) }));
}
const slugDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["slug-required", "slug-invalid"]));
const titleDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["title-required"]));
const sourceDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["source-required"]));
// section summary は全 validation error を同じ文法で併記する。
const sectionDiagnostics = computed<DiagnosticItem[]>(() =>
  validation.value.errors.map((code) => ({ key: code, severity: "danger" as const, message: t(VALIDATION_MESSAGE_KEYS[code]) })),
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
      if (sessionOpened) {
        await draftLifecycle.flush();
        // F8 Major-1: flush で store が確定した後に List のバッジ再照会契機を作る。
        emit("flushed");
      }
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
        establishDraftState(uid);
        return;
      }
      resetSession(props.item, uid);
      if (props.item) previewUrl.value = await window.imageAssets.getFilePath(uid).catch(() => null);
      await draftLifecycle.open(uid, itemRevision ?? null);
      sessionOpened = true;
      establishDraftState(uid);
    }).catch((cause) => {
      console.error("Failed to change image asset editor session", cause);
      error.value = t("assetlist.errors.internal");
    });
  },
  { immediate: true },
);

function pushCurrent(): void {
  // F4: 文書の変更で保存時 operation 診断（slug重複等）を解消する。
  error.value = "";
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
  // F4: Undo/Redo でも保存時 operation 診断を解消する。
  error.value = "";
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
  emit("flushed");
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
  // F5: 新規 draft の破棄は draft store から削除して選択解除（新規作成前の空状態）へ戻す。
  // F8 Major-1: discard は store を即時変更するため、List のバッジ再照会も即時に行う。
  emit("flushed");
  if (props.item) resetSession(props.item, props.uid);
  else emit("back");
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

// F8: dirty（下書きが存在する状態）の変化を「セッション確立済みの uid」に対してのみ通知する。
// Undo で checkpoint clean に戻れば dirty=false となりバッジが即時に消える。
// uid 切替中は旧 session の dirty を新 uid へ流さない（Major-1: transient誤バッジ防止）。
let draftStateUid: string | null = null;
watch(dirty, (hasDraft) => {
  if (draftStateUid !== null) emit("draft-state", draftStateUid, hasDraft);
});
watch(() => props.uid, () => { draftStateUid = null; });
function establishDraftState(uid: string): void {
  draftStateUid = uid;
  emit("draft-state", uid, dirty.value);
}

defineExpose({ prepareForDelete });
</script>

<style scoped>
.asset-edit { min-width: 0; }
.asset-preview { height: 16rem; display: grid; place-items: center; background: #f8f9fa; }
.asset-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
