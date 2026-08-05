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

    <!-- M11-T10 (人間検証R3): 全量サマリバナーは廃止し Map/App と同じ
         「field 診断 + バナーは操作エラーのみ」の文法へ統一 -->
    <DiagnosticFeedback
      v-if="error"
      scope="operation"
      :items="[{ key: 'save-error', severity: 'danger', message: error }]"
    />
    <div v-if="conflictRevision !== null" class="alert alert-warning rounded-0 mb-0 py-2 d-flex align-items-center gap-2 flex-wrap">
      <span class="flex-grow-1">{{ t("common.revision_conflict") }}</span>
      <button type="button" class="btn btn-sm btn-outline-secondary" @click="reloadLatest">{{ t("common.reload") }}</button>
      <button type="button" class="btn btn-sm btn-warning" @click="keepCurrentEdit">{{ t("common.overwrite") }}</button>
    </div>
    <!-- M12-T11 (R5/D4): alert-info から DF section(info) へ -->
    <DiagnosticFeedback v-if="readOnly" scope="section" data-testid="basemap-editor-readonly" :items="[{ key: 'builtin-readonly', severity: 'info', message: t('basemap.master_detail.builtin_read_only') }]" />

    <div class="flex-grow-1 overflow-auto p-3" data-testid="basemap-editor">
      <!-- m6-t1: 種別軸（kind）選択 btn-group（フォームコンテナ先頭） -->
      <div class="mb-3">
        <div class="btn-group btn-group-sm" role="group" aria-label="basemap kind">
          <button
            v-for="k in KIND_OPTIONS"
            :key="k"
            type="button"
            class="btn"
            :class="document.kind === k ? 'btn-primary' : 'btn-outline-secondary'"
            :disabled="kindDisabled(k)"
            :title="kindDisabledReason(k) || undefined"
            :data-testid="'basemap-kind-' + k"
            @click="selectKind(k)"
          >{{ t('basemap.kind.label_' + k) }}</button>
        </div>
        <!-- 未選択時: 種別選択を促す案内文（フォーム本体は非表示） -->
        <div v-if="document.kind === null" class="text-muted small mt-2" data-testid="basemap-kind-prompt">
          {{ t("basemap.kind.select_prompt") }}
        </div>
        <!-- merc 無効理由（disabledReason 文法: text-danger 常時表示）。merc は選択不可のため常時表示 -->
        <div v-if="kindDisabledReason('merc')" class="text-danger small mt-2" data-testid="basemap-kind-merc-reason">
          {{ kindDisabledReason('merc') }}
        </div>
        <!-- provider-incomplete 診断（種別ボタン群直下の section 診断）: google 等 t4 未完了時 -->
        <DiagnosticFeedback
          v-if="validation.errors.includes('provider-incomplete')"
          scope="section"
          data-testid="basemap-kind-provider-incomplete"
          :items="[{ key: 'provider-incomplete', severity: 'danger', message: t('basemap.errors.provider_incomplete') }]"
        />
      </div>
      <div v-if="document.kind !== null" class="row g-3">
        <div class="col-12 col-xl-6">
          <EditorField :label="t('basemap.modal.title_label')" :diagnostics="titleDiagnostics">
            <LangResourceInput
              input-testid="basemap-title"
              :model-value="document.title"
              :active-lang="activeLang"
              :default-lang="document.defaultLang"
              :language-options="SUPPORTED_LANGUAGES"
              :disabled="readOnly || saving || sessionTransitionPending"
              :invalid="titleDiagnostics.length > 0"
              @update:model-value="updateResource('title', $event)"
              @select-language="activeLang = $event"
            />
          </EditorField>
        </div>
        <!-- M11-T7/AC7・§18b決定2: 先頭は タイトル → スラッグ (ID) → デフォルト言語 -->
        <div class="col-12 col-xl-6">
          <!-- M11-T7/AC1: 共通 SlugField(内蔵 label/help/可用性診断+予約 lifecycle)。
               入力中は slugLive(live 可用性確認)、blur 確定(@change)で従来どおり履歴 commit -->
          <SlugField
            ref="slugField"
            :model-value="slugLive"
            asset-kind="base-map"
            :asset-uid="document.uid"
            :draft-uid="document.uid"
            :original-slug="originalSlug"
            :required="true"
            :disabled="structuralDisabled"
            input-testid="basemap-slug"
            @update:model-value="slugLive = $event"
            @change="updateField('slug', $event.trim())"
            @state-change="slugFieldState = $event"
          />
        </div>
        <div class="col-12 col-lg-6">
          <label class="form-label fw-semibold">{{ t("editor_ui.default_lang_label") }}</label>
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
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.master_detail.label") }}</label>
          <LangResourceInput
            input-testid="basemap-label"
            :model-value="document.label"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="readOnly || saving || sessionTransitionPending"
            @update:model-value="updateResource('label', $event)"
            @select-language="activeLang = $event"
          />
        </div>
        <!-- m6-t2 (レビュー M2): 帰属・ライセンスを 3行 に再構成。
             1行目: 地図画像帰属 / データ帰属 / 2行目: 地図画像ライセンス / 補足 / 3行目: データライセンス / 補足。
             attr は必須 (地図側と同様) -->
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.modal.attr_label") }} <span class="text-danger">*</span></label>
          <LangResourceInput
            input-testid="basemap-attr"
            :model-value="document.attr"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="readOnly || saving || sessionTransitionPending"
            :invalid="attrDiagnostics.length > 0"
            @update:model-value="updateResource('attr', $event)"
            @select-language="activeLang = $event"
          />
          <DiagnosticFeedback v-if="attrDiagnostics.length" scope="field" :items="attrDiagnostics" />
        </div>
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.modal.data_attr_label") }}</label>
          <LangResourceInput
            input-testid="basemap-data-attr"
            :model-value="document.dataAttr"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="readOnly || saving || sessionTransitionPending"
            @update:model-value="updateResource('dataAttr', $event)"
            @select-language="activeLang = $event"
          />
        </div>
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.modal.license_label") }}</label>
          <LicenseSelect
            variant="image"
            allow-unset
            test-id="basemap-license"
            :model-value="document.license"
            :disabled="structuralDisabled"
            @update:model-value="updateField('license', $event)"
          />
        </div>
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.modal.license_note_label") }}</label>
          <LangResourceInput
            input-testid="basemap-license-note"
            :model-value="document.licenseNote"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="readOnly || saving || sessionTransitionPending"
            @update:model-value="updateResource('licenseNote', $event)"
            @select-language="activeLang = $event"
          />
        </div>
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.modal.data_license_label") }}</label>
          <LicenseSelect
            variant="data"
            allow-unset
            test-id="basemap-data-license"
            :model-value="document.dataLicense"
            :disabled="structuralDisabled"
            @update:model-value="updateField('dataLicense', $event)"
          />
        </div>
        <div class="col-12 col-xl-6">
          <label class="form-label fw-semibold">{{ t("basemap.modal.data_license_note_label") }}</label>
          <LangResourceInput
            input-testid="basemap-data-license-note"
            :model-value="document.dataLicenseNote"
            :active-lang="activeLang"
            :default-lang="document.defaultLang"
            :language-options="SUPPORTED_LANGUAGES"
            :disabled="readOnly || saving || sessionTransitionPending"
            @update:model-value="updateResource('dataLicenseNote', $event)"
            @select-language="activeLang = $event"
          />
        </div>

        <div class="col-12"><hr class="my-1"></div>
        <div class="col-12">
                  <template v-if="document.kind === 'tms'">
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
        </template>
        <template v-else-if="document.kind === 'mapbox' || document.kind === 'maplibre'">
          <EditorField :label="t('basemap.modal.style_label')" label-for="basemap-style-input" :diagnostics="styleFieldDiagnostics">
            <input
              id="basemap-style-input"
              :value="document.style || ''"
              type="text"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': styleFieldDiagnostics.length }"
              data-testid="basemap-style-url"
              :placeholder="document.kind === 'maplibre' ? 'https://.../style.json' : 'mapbox://styles/... or https://...'"
              :disabled="structuralDisabled"
              @change="updateField('style', ($event.target as HTMLInputElement).value.trim() || null)"
            >
          </EditorField>
          <p v-if="document.kind === 'maplibre'" class="form-text small text-muted" data-testid="basemap-style-maplibre-hint">
            {{ t('basemap.modal.style_maplibre_hint') }}
          </p>
        </template>
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
import SlugField from "../editor-ui/SlugField.vue";
import LicenseSelect from "../editor-ui/LicenseSelect.vue";
import type { DiagnosticItem, EditorSaveState } from "../editor-ui/editorUiTypes";
import { validationFieldDiagnostics } from "../editor-ui/validationDiagnostics";
import { useAssetDraftLifecycle } from "../../composables/useAssetDraftLifecycle";
import { useInitialDraftPersist } from "../../composables/useInitialDraftPersist";
import type { SlugFieldState } from "../../composables/useSlugAvailability";
import { UndoStack } from "../../services/editorUndoStack";
import {
  fromBaseMapCatalogItem,
  newBaseMapDocument,
  resolveBaseMapRuntimeText,
  toBaseMapSavePayload,
  validateBaseMapDocument,
  type BaseMapCatalogItem,
  type BaseMapEditDocument,
  type BaseMapKind,
} from "../../utils/baseMapEditorDocument";
import { envelopeToBbox } from "../../utils/appSourceModel";
import { isTranslationMode } from "../../utils/editorLanguageMode";
import { SUPPORTED_LANGUAGES, resolveEditorLanguage, type LangCode } from "../../utils/editorLanguages";
import { isEditableElement } from "../../utils/nativeTextUndo";
import type { BaseMapSaveResult } from "../../electron";

const props = withDefaults(defineProps<{
  uid: string;
  isNew: boolean;
  item: BaseMapCatalogItem | null;
  backVisible?: boolean;
  /** M11-T10 複製(案A): 新規モードで複製元の catalog item を受け取り、エディタ側で複製浄化して初期化する */
  duplicateSourceItem?: BaseMapCatalogItem | null;
  /** M11-T10 複製: 一覧側で予約済みの slug（複製浄化で元slugを上書きする） */
  presetSlug?: string;
}>(), {
  backVisible: true,
  duplicateSourceItem: null,
  presetSlug: "",
});

// M11-T10 複製浄化: uid は新規採番値へ、slug は予約値へ上書き、scope は user 固定（builtin 複製も user になる）
function duplicateInitial(source: BaseMapCatalogItem, uid: string): BaseMapEditDocument {
  const doc = fromBaseMapCatalogItem(source);
  return { ...doc, uid, scope: "user", slug: props.presetSlug || `${doc.slug}-copy` };
}
const emit = defineEmits<{ back: []; saved: [uid: string]; changed: []; reload: [uid: string]; "draft-state": [uid: string, hasDraft: boolean]; flushed: [] }>();
const { t } = useTranslation();

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const initial = props.item
  ? fromBaseMapCatalogItem(props.item)
  : props.isNew && props.duplicateSourceItem
    ? duplicateInitial(props.duplicateSourceItem, props.uid)
    : newBaseMapDocument(props.uid, resolveEditorLanguage(i18next.language));
const document = ref<BaseMapEditDocument>(clone(initial));
let history = new UndoStack<BaseMapEditDocument>(clone(initial));
const historyVersion = ref(0);
const revision = ref<number | null>(props.item?.revision ?? null);
// M11-T7: SlugField 連携。slugLive=入力中の live 値(可用性確認用)、originalSlug=保存済み slug
// (未変更判定・元 slug 復帰 release 用。保存成功まで更新しない)。
const slugField = ref<InstanceType<typeof SlugField> | null>(null);
const slugLive = ref(initial.slug);
const originalSlug = ref<string | undefined>(props.item?.mapID);
const slugFieldState = ref<SlugFieldState>("idle");
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
const structuralDisabled = computed(() => readOnly.value || translationMode.value || saving.value || sessionTransitionPending.value);
const dirty = computed(() => (historyVersion.value, history.isDirty()));
const canUndo = computed(() => (historyVersion.value, history.canUndo()));
const canRedo = computed(() => (historyVersion.value, history.canRedo()));
const validation = computed(() => validateBaseMapDocument(document.value));
// 既存 validation の error code → i18n キー（黄色バナー再利用の文言）。
const VALIDATION_MESSAGE_KEYS: Record<string, string> = {
  "slug-required": "basemap.errors.id_required",
  "slug-invalid": "basemap.errors.id_invalid",
  "title-required": "basemap.errors.title_required",
  "attr-required": "basemap.errors.attr_required",
  "url-required": "basemap.errors.url_required",
  "url-invalid": "basemap.errors.url_invalid",
  "min-zoom-invalid": "basemap.errors.min_zoom_invalid",
  "max-zoom-invalid": "basemap.errors.max_zoom_invalid",
  "zoom-range": "basemap.errors.zoom_order_invalid",
  // m6-t1: kind 関連。kind-required は案内文で置き換えるため field 診断としては使わないが、
  // provider-incomplete はボタン群直下の section 診断で表示する。
  "kind-required": "basemap.errors.kind_required",
  "provider-incomplete": "basemap.errors.provider_incomplete",
  "style-required": "basemap.errors.style_required",
  "style-mapbox-scheme-forbidden": "basemap.errors.style_mapbox_scheme_forbidden",
  "style-url-invalid": "basemap.errors.style_url_invalid",
};

// m6-t1: 種別軸（kind）選択の btn-group。UI 状態は document.kind のみから決まり、追加の
// component state を持たない（既存下書き復帰が自動で定まる）。
const KIND_OPTIONS: readonly BaseMapKind[] = ["tms", "google", "mapbox", "maplibre", "merc"];
const kindDisabled = (k: BaseMapKind): boolean => {
  if (structuralDisabled.value) return true;
  if (document.value.kind === null) return k === "merc"; // 未選択時: merc のみ不可
  return true; // 選択後は5つとも不可（登録後に変更できない）
};
const kindDisabledReason = (k: BaseMapKind): string =>
  k === "merc" && document.value.kind !== "merc" ? t("basemap.kind.merc_disabled_reason") : "";
function selectKind(k: BaseMapKind): void {
  if (kindDisabled(k)) return;
  updateField("kind", k);
  if (k === "mapbox" || k === "maplibre") {
    // AC23-c: provider へ入るとき tms の url を消す（非表示になるためユーザーが消せず、
    // 古い URL が payload に残るのを防ぐ。provider から離れるときの style クリアと対称）
    updateField("url", "");
    const def = k === "mapbox" ? "basemap_icons/mapbox.png" : "basemap_icons/maplibre.png";
    const cur = document.value.thumbnail;
    if (!cur || cur === "basemap_icons/mapbox.png" || cur === "basemap_icons/maplibre.png") {
      updateField("thumbnail", def);
    }
  } else {
    updateField("style", null);
  }
}
// field 診断（danger）への変換は共通 validationFieldDiagnostics(M11-T10)。全項目を即時表示（dirtyゲートなし）。
// slug-required/slug-invalid は SlugField(required + 形式診断内蔵)が field 側で表示する。
const diagnosticsFor = (codes: readonly string[]): DiagnosticItem[] =>
  validationFieldDiagnostics(validation.value.errors, VALIDATION_MESSAGE_KEYS, t, codes);
const titleDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["title-required"]));
const attrDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["attr-required"]));
const urlDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["url-required", "url-invalid"]));
// m6-t5 v1.3 AC23-a: style 診断は field 側のみ（URL と同パターン。section 二重表示は撤去）
const styleFieldDiagnostics = computed<DiagnosticItem[]>(() =>
  diagnosticsFor(["style-required", "style-mapbox-scheme-forbidden", "style-url-invalid"]),
);
const minZoomDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["min-zoom-invalid"]));
// zoom-range(min/max の大小逆転)は max 側 field に表示する(サマリバナー廃止に伴う field 化)
const maxZoomDiagnostics = computed<DiagnosticItem[]>(() => diagnosticsFor(["max-zoom-invalid", "zoom-range"]));
// タイトル空のフォールバックは EditorActionHeader 共通(editor_ui.untitled)。slug 代用はしない(M11-T10)
const displayTitle = computed(() => resolveBaseMapRuntimeText(document.value.title, activeLang.value, document.value.defaultLang));
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
  const next = item
    ? fromBaseMapCatalogItem(item)
    : props.isNew && props.duplicateSourceItem
      ? duplicateInitial(props.duplicateSourceItem, uid)
      : newBaseMapDocument(uid, resolveEditorLanguage(i18next.language));
  document.value = clone(next);
  history = new UndoStack(clone(next));
  // M11-T10: 複製内容はどこにも永続化されていないため dirty 扱いにする(即保存可能)
  if (!item && props.isNew && props.duplicateSourceItem) history.markDirty();
  historyVersion.value++;
  revision.value = item?.revision ?? null;
  originalSlug.value = item?.mapID;
  activeLang.value = next.defaultLang;
  thumbnailUrl.value = item?.thumbnailUrl ?? null;
  error.value = "";
  conflictRevision.value = null;
  overwritePending.value = false;
}

let sessionOpened = false;
let sessionTransition = Promise.resolve();
const sessionTransitionPending = ref(false);
let pendingSavedIdentity: { uid: string; revision: number } | null = null;
watch(
  () => [props.uid, props.item?.revision, props.isNew] as const,
  ([uid, itemRevision, isNew]) => {
    sessionTransitionPending.value = true;
    sessionTransition = sessionTransition.then(async () => {
      // AC6: asset/session identity切替時に初期draft保存のone-shot状態をresetする
      resetInitialDraftPersist();
      if (sessionOpened) {
        await draftLifecycle.flush();
        // F8 Major-1: flush で store が確定した後に List のバッジ再照会契機を作る。
        emit("flushed");
      }
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
        establishDraftState(uid);
        return;
      }
      resetSession(props.item, uid);
      if (props.item?.scope !== "builtin") await draftLifecycle.open(uid, itemRevision ?? null);
      sessionOpened = props.item?.scope !== "builtin";
      establishDraftState(uid);
    }).catch((cause) => {
      console.error("Failed to change base map editor session", cause);
      error.value = t("basemap.errors.load_failed");
    }).finally(() => {
      sessionTransitionPending.value = false;
    });
  },
  { immediate: true },
);

// AC6: 新規 asset の slug 予約成功時に初期 draft を即時保存し、予約のGC保護を確立する。
const { initialPersisted: _initialPersisted, reset: resetInitialDraftPersist } = useInitialDraftPersist({
  slugState: slugFieldState,
  isNewAsset: () => revision.value === null,
  flushDraft: () => draftLifecycle.flush(),
});

// document.slug の外部変化(Undo/Redo/draft 復元/セッション切替)を SlugField の live 値へ同期する。
// 元 slug へ復帰した場合は SlugField 内部の予約 release が発火する(AC15)。
watch(() => document.value.slug, (slug) => {
  if (slugLive.value.trim() !== slug) slugLive.value = slug;
});

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
  // 翻訳モード (structuralDisabled) では構造項目 (title/label/attr/license/dataLicense) は編集不可。
  // 言語別フィールド (dataAttr/licenseNote/dataLicenseNote) は編集可能。設計 §4.2。
  if (structuralDisabled.value && !(["title", "label", "attr", "dataAttr", "licenseNote", "dataLicenseNote"] as string[]).includes(key)) return;
  commit({ ...document.value, [key]: clone(value) });
}

function updateResource(key: "title" | "label" | "attr" | "dataAttr" | "licenseNote" | "dataLicenseNote", value: string | Record<string, string> | undefined): void {
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

async function goBack(): Promise<void> {
  await sessionTransition;
  if (editable.value) {
    await draftLifecycle.flush();
    emit("flushed");
  }
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
  if (props.isNew) {
    try {
      await slugField.value?.release();
    } catch (cause) {
      console.error("Failed to release base map slug reservation", cause);
      error.value = t("basemap.errors.save_failed");
      return;
    }
  }
  await draftLifecycle.discard();
  // F8 Major-1: discard は store を即時変更するため、List のバッジ再照会も即時に行う。
  emit("flushed");
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
    // M11-T7: 保存直前の予約再確認(§7.1 confirmForSave)。他者予約なら保存中断(D7)。
    // registry 重複は backend の unique 制約(Exist)が最終防衛。
    const slugOk = await slugField.value?.confirmForSave() ?? true;
    if (!slugOk) { error.value = t("basemap.errors.id_duplicate"); return; }
    const captured = document.value;
    const capturedVersion = historyVersion.value;
    const payload = toBaseMapSavePayload(captured, revision.value);
    if (revision.value === null && captured.uid) {
      // AC6: 新規 = 事前採番 uid + create 明示合図(§7.2b)。予約帰属(asset_uid)と行 uid を一致させる
      payload.uid = captured.uid;
      payload.create = true;
    }
    const result = await window.baseMaps.saveUser(payload);
    if (!("result" in result)) {
      conflictRevision.value = result.current;
      error.value = "";
      return;
    }
    if (result.result !== "Success") { error.value = saveFailure(result); return; }
    revision.value = result.revision;
    // 保存成功(saved)で初めて originalSlug を確定 slug へ更新する(AC16 と同型の残作業引き継ぎ規約)
    originalSlug.value = captured.slug;
    const snapshot = history.snapshot();
    history = UndoStack.fromSnapshot({
      ...snapshot,
      history: snapshot.history.map((state) => ({ ...state, uid: result.uid })),
    });
    document.value = clone(history.current());
    if (capturedVersion === historyVersion.value) {
      history.save();
      historyVersion.value++;
    }
    // M12-T29: draftLifecycle cleanup は保存成功時常に実行（capturedVersion に関わらず）。
    // 旧 draftUid のドラフト削除（markSaved）→ 新 (uid, revision) へ identity 再構成（rebase）
    // → flush。保存中に別編集が入った場合 shouldPersist が true なので新 uid で persist される。
    // PoiEdit.vue m11-t10b と同じ markSaved → rebase → flush パターン。
    await draftLifecycle.markSaved();
    draftLifecycle.rebase(result.uid, result.revision);
    await draftLifecycle.flush();
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
