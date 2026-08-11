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
      <!-- m6-t1: 種別軸（kind）選択（フォームコンテナ先頭）。m6-t9 §3.5: 無効理由の ContextHelp
           （btn-link ルートの button）を混在させると Bootstrap の .btn-group ボーダー結合/角丸
           セレクタに巻き込まれ見た目が崩れるため、.btn-group ではなく flex + gap の個別ボタン
           へ変更する（人間指摘のとおりレイアウトの厳密な連結は不要・許容範囲内） -->
      <div class="mb-3">
        <div class="d-flex flex-wrap align-items-center gap-1" role="group" aria-label="basemap kind">
          <template v-for="k in KIND_OPTIONS" :key="k">
            <button
              type="button"
              class="btn btn-sm"
              :class="document.kind === k ? 'btn-primary' : 'btn-outline-secondary'"
              :disabled="kindDisabled(k)"
              :title="kindDisabledReason(k) || undefined"
              :data-testid="'basemap-kind-' + k"
              @click="selectKind(k)"
            >{{ t('basemap.kind.label_' + k) }}</button>
            <!-- 無効理由をボタン右側の ContextHelp（? アイコン）で明示。:title は
                 m6-t6-api-key-tiers.spec.ts:133 が非空を assert しているため維持する -->
            <ContextHelp
              v-if="kindDisabledReason(k)"
              :text="kindDisabledReason(k)"
              :ariaLabel="t('basemap.kind.label_' + k)"
              :data-testid="'basemap-kind-' + k + '-reason'"
            />
          </template>
        </div>
        <!-- 未選択時: 種別選択を促す案内文（フォーム本体は非表示） -->
        <div v-if="document.kind === null" class="text-muted small mt-2" data-testid="basemap-kind-prompt">
          {{ t("basemap.kind.select_prompt") }}
        </div>
        <!-- provider-incomplete 診断（種別ボタン群直下の section 診断）: google 等 t4 未完了時 -->
        <DiagnosticFeedback
          v-if="validation.errors.includes('provider-incomplete')"
          scope="section"
          data-testid="basemap-kind-provider-incomplete"
          :items="[{ key: 'provider-incomplete', severity: 'danger', message: t('basemap.errors.provider_incomplete') }]"
        />
        <!-- m6-t4: Google プリセット選択（kind === "google" のとき） -->
        <div v-if="document.kind === 'google'" class="mt-3" data-testid="basemap-google-preset-group">
          <label class="form-label fw-semibold small">{{ t("basemap.google.preset_label") }}</label>
          <div class="d-flex flex-wrap align-items-center gap-1" role="group" aria-label="google preset">
            <template v-for="preset in GOOGLE_PRESETS" :key="preset.value">
              <button
                type="button"
                class="btn btn-sm"
                :class="document.maptype === preset.value ? 'btn-primary' : 'btn-outline-secondary'"
                :disabled="presetDisabled(preset.value) || structuralDisabled"
                :title="presetDisabledReason(preset.value) || undefined"
                :data-testid="'basemap-google-preset-' + preset.suffix"
                @click="selectGooglePreset(preset.value)"
              >{{ t(preset.labelKey) }}</button>
              <ContextHelp
                v-if="presetDisabledReason(preset.value)"
                :text="presetDisabledReason(preset.value)"
                :ariaLabel="t(preset.labelKey)"
                :data-testid="'basemap-google-preset-' + preset.suffix + '-reason'"
              />
            </template>
          </div>
          <DiagnosticFeedback
            v-if="validation.errors.includes('maptype-required')"
            scope="section"
            data-testid="basemap-google-maptype-required"
            :items="[{ key: 'maptype-required', severity: 'danger', message: t('basemap.errors.maptype_required') }]"
          />
        </div>
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
          <label class="form-label fw-semibold d-flex align-items-center gap-1">{{ t("basemap.master_detail.label") }} <ContextHelp :text="t('field_help.display_label')" :ariaLabel="t('field_help.display_label')" /></label>
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
          <label class="form-label fw-semibold d-flex align-items-center gap-1">{{ t("basemap.modal.attr_label") }} <span class="text-danger">*</span> <ContextHelp :text="t('field_help.image_attribution')" :ariaLabel="t('field_help.image_attribution')" /></label>
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
          <label class="form-label fw-semibold d-flex align-items-center gap-1">{{ t("basemap.modal.data_attr_label") }} <ContextHelp :text="t('field_help.data_attribution')" :ariaLabel="t('field_help.data_attribution')" /></label>
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
          <label class="form-label fw-semibold d-flex align-items-center gap-1">{{ t("basemap.modal.license_label") }} <ContextHelp :text="t('field_help.image_license')" :ariaLabel="t('field_help.image_license')" /></label>
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
          <label class="form-label fw-semibold d-flex align-items-center gap-1">{{ t("basemap.modal.license_note_label") }} <ContextHelp :text="t('field_help.image_license_note')" :ariaLabel="t('field_help.image_license_note')" /></label>
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
          <label class="form-label fw-semibold d-flex align-items-center gap-1">{{ t("basemap.modal.data_license_label") }} <ContextHelp :text="t('field_help.data_license')" :ariaLabel="t('field_help.data_license')" /></label>
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
          <label class="form-label fw-semibold d-flex align-items-center gap-1">{{ t("basemap.modal.data_license_note_label") }} <ContextHelp :text="t('field_help.data_license_note')" :ariaLabel="t('field_help.data_license_note')" /></label>
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
          <div class="mb-2">
            <label class="form-label fw-semibold mb-0">{{ t("basemap.tilejson.label") }}</label>
            <div class="d-flex gap-2">
              <input
                v-model="tileJsonUrlInput"
                type="text"
                class="form-control form-control-sm font-monospace"
                data-testid="basemap-tilejson-url-input"
                :disabled="structuralDisabled || importingTileJson"
              >
              <button
                type="button"
                class="btn btn-sm btn-outline-primary text-nowrap"
                data-testid="basemap-tilejson-import"
                :disabled="structuralDisabled || importingTileJson || !tileJsonUrlInput.trim()"
                @click="importTileJson"
              >{{ importingTileJson ? t("basemap.tilejson.importing") : t("basemap.tilejson.import") }}</button>
            </div>
          </div>
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
              data-testid="basemap-min-zoom"
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
              data-testid="basemap-max-zoom"
              :disabled="structuralDisabled"
              @change="updateNumber('maxZoom', ($event.target as HTMLInputElement).value)"
            >
          </EditorField>
        </div>

        <!-- m19-t2: サムネイル管理（地図管理 MapEdit.vue:4278-4310 と同型）。
             512px/52px のプレビューと置換操作を持つ。既存の「アップロード」「存在範囲から生成」は存置する -->
        <div class="col-12">
          <label class="form-label fw-semibold">{{ t("basemap.icon") }}</label>
          <div class="card">
            <div class="card-header bg-light fw-bold small py-1">{{ t("basemap.thumbnail_manage") }}</div>
            <div class="card-body py-2">
              <div class="d-flex gap-3 align-items-start flex-wrap">
                <div class="text-center">
                  <img v-if="thumbnail512Url" :src="thumbnail512Url" class="border rounded" style="width: 96px; height: 96px; object-fit: contain;" alt="512px">
                  <div v-else class="border rounded text-muted small d-flex align-items-center justify-content-center" style="width: 96px; height: 96px;">512px</div>
                  <div class="small text-muted mt-1">512px</div>
                </div>
                <div class="text-center">
                  <!-- .base-map-icon は既存クラス（52px 枠）。m6-t8 の E2E が可視性を assert している -->
                  <img v-if="thumbnail52Url" :src="thumbnail52Url" class="base-map-icon" :alt="document.slug">
                  <div v-else class="base-map-icon text-muted small d-flex align-items-center justify-content-center">52px</div>
                  <div class="small text-muted mt-1">52px</div>
                </div>
                <div class="flex-grow-1">
                  <div class="form-check mb-2">
                    <input
                      id="basemap-derive52"
                      v-model="derive52Model"
                      class="form-check-input"
                      type="checkbox"
                      data-testid="basemap-thumbnail-derive-52"
                      :disabled="structuralDisabled || derive52Forced"
                    >
                    <label class="form-check-label small" for="basemap-derive52">{{ t("basemap.thumbnail_derive_52") }}</label>
                  </div>
                  <div class="d-flex gap-2 flex-wrap">
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-testid="basemap-thumbnail-replace-512" :disabled="structuralDisabled || thumbnailReplaceDisabled" @click="replaceThumbnail('512')">{{ t("basemap.thumbnail_replace_512") }}</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-testid="basemap-thumbnail-replace-52" :disabled="structuralDisabled || thumbnailReplaceDisabled" @click="replaceThumbnail('52')">{{ t("basemap.thumbnail_replace_52") }}</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" :disabled="structuralDisabled || !canGenerateIcon || generatingIcon" @click="generateIcon">
                      {{ generatingIcon ? t("basemap.generating_icon") : t("basemap.generate_icon") }}
                    </button>
                  </div>
                  <!-- m19-t12 規則 T3: 書き込み先キーが未確定な理由を、押す前に見せる -->
                  <DiagnosticFeedback v-if="thumbnailReplaceDisabledReason" scope="section" :items="[{ key: 'thumb-disabled', severity: 'info', message: thumbnailReplaceDisabledReason }]" />
                  <DiagnosticFeedback v-if="thumbnailError" scope="section" :items="[{ key: 'thumb-error', severity: 'danger', message: thumbnailError }]" />
                </div>
              </div>
              <!-- m19-t12 規則 T1: 地図管理と同一の i18n キーで同一文言を出す -->
              <div class="small text-muted mt-2" data-testid="thumbnail-immediate-note">{{ t("editor_ui.thumbnail_immediate_note") }}</div>
            </div>
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
    <EditorBusyOverlay :visible="saving || generatingIcon || importingTileJson" :label="saving ? t('editor_ui.save_state.saving') : (importingTileJson ? t('basemap.tilejson.importing') : t('basemap.generating_icon'))" />
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
  normalizeKind,
  requiresProviderKey,
  resolveBaseMapRuntimeText,
  toBaseMapSavePayload,
  validateBaseMapDocument,
  type BaseMapCatalogItem,
  type BaseMapEditDocument,
  type BaseMapKind,
  type GoogleMapType,
} from "../../utils/baseMapEditorDocument";
import { applyGooglePresetDefaults, buildGooglePresetDefaults } from "../../utils/googlePresetDefaults";
import { envelopeToBbox } from "../../utils/appSourceModel";
import { isTranslationMode } from "../../utils/editorLanguageMode";
import { SUPPORTED_LANGUAGES, resolveEditorLanguage, type LangCode } from "../../utils/editorLanguages";
import { isEditableElement } from "../../utils/nativeTextUndo";
// m19-t12: サムネイル置換は地図管理と共有する単一実装を通す。
// 512px パスの派生（thumb512PathFor）も当該 composable の内部へ移った。
import { useThumbnailReplace } from "../../composables/useThumbnailReplace";
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
// m6-t7: TileJSON URL からの取り込み
const tileJsonUrlInput = ref("");
const importingTileJson = ref(false);
const conflictRevision = ref<number | null>(null);
const overwritePending = ref(false);
// 52px プレビューの生 URL（クエリなし）。初期値は一覧 IPC が解決した値。
// m19-t2: 52px は従来の解決経路を温存する（thumbnail からの再解決へ切り替えない）。
// resolveBaseMapListImage は thumbnail が空の旧ベースマップに対して tmbs/{mapID}_menu.jpg の
// レガシー補完を持っており、切り替えるとその補完で表示できていた文書のプレビューが消えるため。
const thumbnailUrl = ref<string | null>(props.item?.thumbnailUrl ?? null);
// m19-t12: サムネイル置換の state（nonce / 512px URL / エラー / derive52 / 52px 実体の有無）は
// useThumbnailReplace が所有する（下の「サムネイル管理」節で生成する）。ここで持つのは
// ホスト固有の thumbnailUrl（= raw52UrlRef。一覧 IPC のレガシー補完を温存する。m19-t2 §5.7）だけ。
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
  "maptype-required": "basemap.errors.maptype_required",
  "style-required": "basemap.errors.style_required",
  "style-mapbox-scheme-forbidden": "basemap.errors.style_mapbox_scheme_forbidden",
  "style-url-invalid": "basemap.errors.style_url_invalid",
};

// m6-t1: 種別軸（kind）選択の btn-group。UI 状態は document.kind のみから決まり、追加の
// component state を持たない（既存下書き復帰が自動で定まる）。
const KIND_OPTIONS: readonly BaseMapKind[] = ["tms", "google", "mapbox", "maplibre", "merc"];

// m6-t6 (§3.4): エディタ用キー未設定時、google/mapbox の種別選択を disabled にするための
// 読み込み。null = 「まだ取得できていない」（安全側 disabled）。取得完了で文字列（空文字含む）へ
const editorGoogleApiKey = ref<string | null>(null);
const editorMapboxToken = ref<string | null>(null);
// m6-t8 §3.10: merc マスタは url を保存していないため、file:// でのタイル解決に
// データフォルダの絶対パスが要る。既存の共通取得経路（SettingsService.get('saveFolder')）を使う
const dataFolderPath = ref<string | null>(null);
onMounted(async () => {
  editorGoogleApiKey.value = (await window.settings.get("editorGoogleApiKey")) || "";
  editorMapboxToken.value = (await window.settings.get("editorMapboxToken")) || "";
  dataFolderPath.value = (await window.settings.get("saveFolder")) || "";
});
function editorKeyFor(k: BaseMapKind): string | null {
  if (k === "google") return editorGoogleApiKey.value;
  if (k === "mapbox") return editorMapboxToken.value;
  return "";
}
// 未取得中(null)も含めて「非空文字列でなければキー無し」として扱う（安全側 disabled）
function hasEditorKey(k: BaseMapKind): boolean {
  return typeof editorKeyFor(k) === "string" && editorKeyFor(k) !== "";
}

const kindDisabled = (k: BaseMapKind): boolean => {
  if (structuralDisabled.value) return true;
  if (document.value.kind === null) {
    if (k === "merc") return true; // 未選択時: merc のみ不可
    if (requiresProviderKey(k) && !hasEditorKey(k)) return true; // m6-t6: エディタ用キー未設定
    return false;
  }
  return true; // 選択後は5つとも不可（登録後に変更できない）
};
const kindDisabledReason = (k: BaseMapKind): string => {
  if (k === "merc" && document.value.kind !== "merc") return t("basemap.kind.merc_disabled_reason");
  if (document.value.kind === null && requiresProviderKey(k) && !hasEditorKey(k)) {
    return t("basemap.kind.key_required_reason", { provider: t(`basemap.kind.label_${k}`) });
  }
  return "";
};
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

// m6-t4: Google プリセット（2段目）
const GOOGLE_PRESETS = [
  { value: "google_roadmap" as const, suffix: "roadmap", labelKey: "basemap.google.preset_roadmap" },
  { value: "google_satellite" as const, suffix: "satellite", labelKey: "basemap.google.preset_satellite" },
  { value: "google_hybrid" as const, suffix: "hybrid", labelKey: "basemap.google.preset_hybrid" },
  { value: "google_terrain" as const, suffix: "terrain", labelKey: "basemap.google.preset_terrain" },
] as const;

const registeredPresets = ref<Set<string>>(new Set());
let registeredPresetsToken = 0;

async function refreshRegisteredPresets(): Promise<void> {
  if (document.value.kind !== "google") {
    registeredPresets.value = new Set();
    return;
  }
  const token = ++registeredPresetsToken;
  const catalog = await window.baseMaps.list();
  if (token !== registeredPresetsToken) return;
  if (document.value.kind !== "google") {
    registeredPresets.value = new Set();
    return;
  }
  const googleItems = catalog.filter(
    (item) => item.scope === "user" && normalizeKind(item.data?.kind) === "google",
  );
  registeredPresets.value = new Set(
    googleItems
      .filter((item) => item.uid !== document.value.uid)
      .map((item) => item.data?.maptype as string)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );
}

const presetDisabled = (maptype: string): boolean => registeredPresets.value.has(maptype);

const presetDisabledReason = (maptype: string): string => {
  if (!presetDisabled(maptype)) return "";
  const preset = GOOGLE_PRESETS.find((p) => p.value === maptype);
  const name = preset ? t(preset.labelKey) : maptype;
  return t("basemap.google.preset_already_registered", { name });
};

function isGoogleDefaultThumbnail(path: string): boolean {
  return GOOGLE_PRESETS.some((p) => `basemap_icons/google_${p.suffix}.png` === path);
}

function selectGooglePreset(maptype: GoogleMapType): void {
  if (presetDisabled(maptype) || structuralDisabled.value) return;
  const current = document.value;
  const nextThumb =
    !current.thumbnail || isGoogleDefaultThumbnail(current.thumbnail)
      ? `basemap_icons/google_${maptype.replace("google_", "")}.png`
      : current.thumbnail;
  // m6-t4b: 帰属・ライセンス・ズーム既定を §4.2 ポリシーでマージ（1 commit = 1 undo）
  const defaults = buildGooglePresetDefaults(current.defaultLang);
  const merged = applyGooglePresetDefaults(current, defaults);
  commit({
    ...merged,
    maptype,
    thumbnail: nextThumb,
  });
}

watch(
  [() => document.value.kind, () => document.value.uid],
  ([kind]) => {
    if (kind === "google") void refreshRegisteredPresets();
    else registeredPresets.value = new Set();
  },
  { immediate: true },
);
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
  // m6-t4: 前セッションの登録済みプリセットと in-flight list を無効化
  registeredPresetsToken++;
  registeredPresets.value = new Set();
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
    // m6-t4: Google maptype 一意制約（複製経路の最終防衛。UI disabled だけでは不十分）
    if (document.value.kind === "google" && document.value.maptype) {
      await refreshRegisteredPresets();
      if (presetDisabled(document.value.maptype)) {
        const preset = GOOGLE_PRESETS.find((p) => p.value === document.value.maptype);
        const name = preset ? t(preset.labelKey) : String(document.value.maptype);
        error.value = t("basemap.google.preset_already_registered", { name });
        return;
      }
    }
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
    // m19-t2: 新規作成では backend が 52px/512px を暫定名（slug 名）から uid 名へ付け替え、
    // thumbnail の実効値が変わる。renderer が payload の値を持ち続けると、そこから導く
    // 512px パス（暫定名から導かれる側）が実体を失い、初回保存の直後に 512px プレビューが
    // 消える。uid の書き換えと同じ形で history ごと実効値へ寄せる。
    const savedThumbnail = typeof result.thumbnail === "string" ? result.thumbnail : null;
    const relocatedThumbnail = savedThumbnail && savedThumbnail !== captured.thumbnail ? savedThumbnail : null;
    const snapshot = history.snapshot();
    history = UndoStack.fromSnapshot({
      ...snapshot,
      history: snapshot.history.map((state) => ({
        ...state,
        uid: result.uid,
        // 付け替え前の値を持つ段だけを実効値へ寄せる（別の値を持つ段は触らない）
        thumbnail: relocatedThumbnail && state.thumbnail === captured.thumbnail ? relocatedThumbnail : state.thumbnail,
      })),
    });
    document.value = clone(history.current());
    if (relocatedThumbnail) {
      // 52px の生 URL も付け替え後の実体へ張り直す（旧 URL は移動済みで解決できない）。
      // ここは「たった今書かれた 52px の所在」が確定している経路であり、§5.7 が温存を
      // 決めた一覧側のレガシー補完経路とは別物である。
      try {
        const url52 = await window.appAssets.fileUrl(relocatedThumbnail);
        if (url52) thumbnailUrl.value = url52;
      } catch (cause) {
        console.error("Failed to resolve relocated base map thumbnail", cause);
      }
      thumbnailNonce.value++;
      await refreshThumbnails();
    }
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
  // m6-t8 §3.10: merc は url が保存されていないため、実行時に file:// を都度導出する（保存はしない）
  if (document.value.kind === "merc") {
    if (!document.value.uid || !dataFolderPath.value) return null;
    return {
      url: `file://${dataFolderPath.value}/merc/${document.value.uid}/{z}/{x}/{y}.png`,
      minZoom: document.value.minZoom ?? undefined,
      maxZoom: document.value.maxZoom ?? undefined,
    };
  }
  const url = document.value.url.trim();
  if (!(url.includes("{z}") && url.includes("{x}") && (url.includes("{y}") || url.includes("{-y}")))) return null;
  return { url, minZoom: document.value.minZoom ?? undefined, maxZoom: document.value.maxZoom ?? undefined };
});
const canGenerateIcon = computed(() => overlayTms.value !== null && document.value.coverageLngLats !== null && !!document.value.slug);
const iconFileKey = () => revision.value === null ? document.value.slug : document.value.uid;

// ===== m19-t2: サムネイル管理（512px / 52px）=====
//
// 【不変条件 INV-T】document.thumbnail は常に 52px サムネイルの所在である。
// 512px の所在は thumb512PathFor(document.thumbnail) からのみ導く。
// 512px パスを thumbnail へ書くと (a) 派生が _512_512 になり、(b) 書き出しの uuid 一致から
// 外れて viewer 出力へ uid 名が漏れる（ADR-0007 の export 契約違反）。

// 規則 K（§6.2.2）: 置換の書き込みキーと拡張子は **document.thumbnail から**採る。
// iconFileKey() から採ると、アイコン生成後に slug を変えた未保存文書でキーの出所が割れ、
// 置換が無言の no-op になって孤児ファイルだけが残る。
const THUMBNAIL_KEY_PATTERN = /^tmbs\/(.+)\.([A-Za-z0-9]+)$/;
const thumbnailKeyParts = computed<{ fileKey: string; ext: string } | null>(() => {
  const match = THUMBNAIL_KEY_PATTERN.exec(document.value.thumbnail ?? "");
  return match ? { fileKey: match[1], ext: match[2] } : null; // null = K2（新たに tmbs/ 配下へ作る）
});

// m19-t12: 置換の実装本体は useThumbnailReplace（地図管理と共有する**単一実装**）。
// ここが持つのはベースマップ固有の注入値だけである。
//
//   - rel52         : ベースマップだけが「指し先」を文書属性として持つ（地図は uid 規約パス）
//   - writeTarget   : 規則 K（K1 = thumbnail から採る）／K2（iconFileKey）／規則 K0（空なら null）
//   - forceDerive52 : §6.5 の述語（下記）
//   - raw52UrlRef   : 一覧 IPC が解決した値を温存する（m19-t2 §5.7。設計 §4.3.3）
//   - onPointerMoved: 規則 T2（指し先の移動は文書編集だが undo の対象にしない）
const {
  thumbnail512Url,
  thumbnail52Url,
  thumbnailError,
  thumbnailNonce,
  derive52Model,
  derive52Forced,
  replaceDisabled: thumbnailReplaceDisabled,
  replaceDisabledReason: thumbnailReplaceDisabledReason,
  refreshThumbnails,
  replaceThumbnail,
} = useThumbnailReplace({
  rel52: () => document.value.thumbnail || null,
  writeTarget: () => {
    const parts = thumbnailKeyParts.value;
    if (parts) return parts; // K1: キーと拡張子は document.thumbnail から採る（規則 K）
    const fileKey = iconFileKey(); // K2: 新たに tmbs/ 配下へ作る
    // 規則 K0: 未保存かつ slug 未入力で fileKey が空になる場合は書かない（uploadIcon と同じガード）。
    // 書いてしまうと tmbs/.png が生じ、その値は K1 にも relocateBaseMapIcon の正規表現にも
    // 一致しないため保存まで残り続ける。m19-t12 の規則 T3 により、この状態はボタンの
    // disabled + 理由表示として押す前に見える。
    return fileKey ? { fileKey, ext: "png" } : null;
  },
  disabledReason: () => t("basemap.errors.id_required"),
  // §6.5: parity から意図的に逸脱する唯一の点。
  // ベースマップは thumbnail を文書属性として持つ（地図は uid 規約で暗黙）ため、52px の実体が
  // 無いまま thumbnail を tmbs/{key}.{ext} へ向けると一覧・書き出し・viewer のアイコンが空になる。
  // ∴ 規則 K が K2 に落ちる場合（または K1 でも実体が無い場合）は 52px の派生を強制する。
  //
  // **K1 判定（thumbnailKeyParts !== null）の連言を落としてはならない。** 落とすと K2
  // （thumbnail がプリセット basemap_icons/*.png）でも fileUrl が同梱リソースを truthy で
  // 解決するため「52px の実体あり」と誤判定し、強制 ON が外れる。その状態で derive OFF の
  // 512px 単独置換を行うと 512px だけが tmbs/ に生じ、m19-t2 が §6.5 で塞いだ孤児 512px が
  // 再発する（E2E の E6 / AC6b がこの退行を捕らえる番人である）。
  forceDerive52: ({ exists52 }) => !(thumbnailKeyParts.value !== null && exists52),
  raw52UrlRef: thumbnailUrl,
  onPointerMoved: (next) => { rebaseThumbnailPointer(next); },
});

// 規則 T2（m19-t12 §4.4）: 指し先の移動は「文書編集」だが「undo の対象」ではない。
// 履歴の全段へ同じ値を焼き、pointer / basePointer を動かさない（＝ undo/redo で戻らない）。
// これは save() の付け替え追随（初回保存で backend が暫定名→uid 名へ寄せる処理）で
// m19-t2 が採用済みの同型パターンである。
//
// push しない理由: push すると undo 1 段で指し先だけが戻り、実ファイル（既に書き換わっている）と
// 食い違う。全段へ焼けば undo/redo のどの位置からも指し先は新しいままになる。
// markDirty する理由: rebase は pointer を動かさないため isDirty() が false のままになりうる。
// それでは指し先が保存されず、書いた 512px が再オープン後に見えない（機能欠落）。
function rebaseThumbnailPointer(next: string): void {
  // 旧 updateField 経路（指し先を直接 commit していた形）が持っていたガードを保つ。
  // thumbnail は updateField の翻訳モード例外リストに含まれない構造項目である
  if (structuralDisabled.value) return;
  if (document.value.thumbnail === next) return; // 規則 U の同値ガードは維持
  const snapshot = history.snapshot();
  history = UndoStack.fromSnapshot({
    ...snapshot,
    history: snapshot.history.map((state) => ({ ...state, thumbnail: next })),
  });
  history.markDirty();
  document.value = clone(history.current());
  historyVersion.value++;
  draftLifecycle.schedule(true); // 下書きにも新しい指し先を載せる
  emit("changed");
}

// 文書ロード・props.item 差し替え・undo/redo による thumbnail の変化に追随する
watch(
  () => [props.uid, document.value.thumbnail] as const,
  () => { void refreshThumbnails(); },
  { immediate: true },
);

// m19-t2: 旧「アップロード」（uploadIcon / uploadTmsThumbnail 経由）は撤去した。
// 新設の replaceThumbnail('52') と機能が重複するうえ、書き込みキーを iconFileKey() から採り
// 拡張子を .png に固定するため、規則 K（キーと拡張子を document.thumbnail から採る）を通らない。
// 実害: merc 継承で thumbnail が tmbs/{uid}.jpg のベースマップに対して tmbs/{uid}.png を書いて
// thumbnail を張り替えるため、そこから導く 512px（png 側）が実体を持たず、実在する
// 512px（jpg 側）が参照不能になる。replaceThumbnail('52') は拡張子を thumbnail から採るため対で整合する。
// uploadTmsThumbnail 自体は AppSourceEditor.vue が唯一の呼び出し元として残るため存置する。
// m6-t7: TileJSON URL からの tms マスタ取り込み。attribution/name はプレーン文字列
// (多言語非対応) のため document.defaultLang のスロットにのみ書き込む（他言語スロットは変更しない）。
// 実装レビュー M-1: selectGooglePreset（:602-617、m6-t4b「1 commit = 1 undo」）と同型に、
// 変更後の文書を1回組み立てて commit() を1回だけ呼ぶ（updateField の多重呼び出しは undo が
// フィールド数だけ積まれてしまうため使わない）。
async function importTileJson(): Promise<void> {
  if (structuralDisabled.value) return;
  const url = tileJsonUrlInput.value.trim();
  if (!url) return;
  importingTileJson.value = true;
  error.value = "";
  try {
    const result = await window.baseMaps.importTileJson(url);
    if (!result.ok) {
      error.value = t(`basemap.errors.tilejson_${result.code.replace(/-/g, "_")}`);
      return;
    }
    const current = document.value;
    commit({
      ...current,
      url: result.fields.url,
      minZoom: result.fields.minZoom,
      maxZoom: result.fields.maxZoom,
      // AC4: フィールドが無ければ（undefined）既存フォーム値を保持する
      attr: result.fields.attr !== undefined ? { ...current.attr, [current.defaultLang]: result.fields.attr } : current.attr,
      title: result.fields.title !== undefined ? { ...current.title, [current.defaultLang]: result.fields.title } : current.title,
      coverageLngLats: result.fields.coverageLngLats !== undefined ? result.fields.coverageLngLats : current.coverageLngLats,
      tileJsonSourceUrl: result.sourceUrl,
    });
  } catch (cause) {
    console.error("Failed to import TileJSON", cause);
    error.value = t("basemap.errors.tilejson_unknown");
  } finally {
    importingTileJson.value = false;
  }
}

async function generateIcon(): Promise<void> {
  if (!overlayTms.value || !document.value.coverageLngLats) return;
  generatingIcon.value = true;
  error.value = "";
  try {
    const result = await window.appAssets.generateTmsThumbnail(iconFileKey(), clone(overlayTms.value), clone(document.value.coverageLngLats));
    if (result.err || !result.path) { error.value = t("basemap.errors.icon_generate_failed"); return; }
    // m19-t2: キャッシュバスターは ?v={nonce} へ一本化する（旧 ?t=Date.now() を廃止）。
    // 生成は 512px も同時に作るため、512px プレビューの再解決も要る（下の refreshThumbnails）
    thumbnailUrl.value = result.fileUrl ?? null;
    // m19-t12 §4.5: 生成もファイルを即時に書く資源操作である。同一カード内で置換と異なる
    // 意味論（dirty + undo 1 段）を持たせないため、置換と同じ rebase 経路へ寄せる。
    // 副作用: K2 で生成した直後に undo でプリセットへ戻す経路は失われる（規則 T2 の帰結）。
    rebaseThumbnailPointer(result.path);
  } catch (cause) {
    console.error("Failed to generate base map icon", cause);
    error.value = t("basemap.errors.icon_generate_failed");
  } finally {
    generatingIcon.value = false;
    thumbnailNonce.value++;
    await refreshThumbnails();
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
