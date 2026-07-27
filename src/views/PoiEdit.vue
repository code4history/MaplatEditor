<template>
  <div class="d-flex flex-column h-100 text-start position-relative">
    <DraftConflictDialog
      :visible="!!draftLifecycle.conflictDraft.value"
      @discard="draftLifecycle.resolveConflict('discard')"
      @apply="draftLifecycle.resolveConflict('apply')"
    />
    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-4">
      {{ t("poisource.loading") }}
    </div>

    <!-- Load error (not found 等): エラー表示 + 一覧へ戻る導線 (M11-T7/AC8: operation 診断) -->
    <div v-else-if="loadError" class="p-4">
      <DiagnosticFeedback
        scope="operation"
        :items="[{ key: 'load-error', severity: 'danger', message: loadError }]"
      />
      <button type="button" class="btn btn-outline-secondary mt-2" @click="router.push('/poisources')">
        {{ t("common.back") }}
      </button>
    </div>

    <template v-else-if="editState">
      <EditorActionHeader
        :title="displayTitle"
        :save-state="saveState"
        :active-lang="currentLang"
        :language-options="SUPPORTED_LANGUAGES"
        :can-undo="!readOnly && canUndo"
        :can-redo="!readOnly && canRedo"
        :save-disabled="!draftDirty || liveErrors.length > 0"
        :saving="saving"
        :actions-disabled="exporting || cloning"
        :save-visible="!readOnly"
        :discard-draft-visible="saveState === 'draft-restored'"
        @back="goBack"
        @update:active-lang="currentLang = $event"
        @undo="performUndo"
        @redo="performRedo"
        @save="saveSource"
        @discard-draft="discardRestoredDraft"
      >
        <template #actions="{ disabled }">
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn-sm btn-outline-primary"
            data-editor-action="export"
            :disabled="disabled || (!saveHandle.uid.value && liveErrors.length > 0)"
            @click="exportSource"
          >
            {{ t("editor_ui.export_button") }}
          </button>
          <button
            v-else
            type="button"
            class="btn btn-sm btn-primary"
            data-editor-action="clone"
            :disabled="disabled || cloning"
            @click="cloneSourceToLocal"
          >
            {{ t("poiedit.clone_to_local") }}
          </button>
        </template>
      </EditorActionHeader>

      <!-- title / slugは文書フィールドとしてworkspace上部に置く -->
      <div class="px-4 py-2 flex-shrink-0 bg-white border-bottom">
        <div class="row align-items-start g-2">
          <div class="col-5">
            <label class="form-label fw-bold small mb-0">{{ t("poisource.title_label") }}</label>
            <LangResourceInput
              v-if="!readOnly"
              data-testid="poi-title"
              :model-value="editState.title"
              :active-lang="currentLang"
              :language-options="SUPPORTED_LANGUAGES"
              @update:model-value="onTitleUpdate"
              @select-language="currentLang = $event"
            />
            <div v-else class="form-control-plaintext py-0">{{ displayTitle }}</div>
          </div>
          <div class="col-4">
            <!-- M11-T7/AC1: 共通 SlugField(内蔵 label/help/可用性診断+予約 lifecycle)。
                 入力中は slugInput(live 可用性確認)、blur 確定(@change)で session.commit -->
            <SlugField
              ref="slugField"
              :model-value="slugInput"
              asset-kind="poi-source"
              :asset-uid="saveHandle.uid.value ?? newPoiUid"
              :draft-uid="saveHandle.uid.value ?? newPoiUid"
              :original-slug="confirmedSlug"
              :required="true"
              :disabled="readOnly || translationMode"
              input-testid="poi-slug"
              @update:model-value="onSlugLiveInput"
              @change="onSlugChange"
              @state-change="slugFieldState = $event"
            />
          </div>
          <div class="col-3">
            <label class="form-label fw-bold small mb-0">{{ t("editor_ui.default_lang_label") }}</label>
            <select
              :value="editState.lang"
              class="form-select form-select-sm"
              data-editor-document-language
              :disabled="readOnly || translationMode"
              @change="onDefaultLanguageChange"
            >
              <option v-for="language in SUPPORTED_LANGUAGES" :key="language.code" :value="language.code">
                {{ language.nativeName }}
              </option>
            </select>
          </div>
        </div>
        <!-- M17-T1: layer metadata 編集フィールド (icon/selectedIcon) + featureCount/rawPane 統合 -->
        <div class="mt-1 mb-1">
          <span class="fw-bold small text-muted">{{ t("poiedit.layer_metadata") }}</span>
        </div>
        <div class="row align-items-start g-2">
          <div class="col-4" data-testid="layer-icon">
            <IconRefField
              ref="layerIconFieldRef"
              :model-value="layerIconValue"
              :label="t('poiedit.layer_icon')"
              :read-only="readOnly || translationMode"
              @update:model-value="onLayerIconChange"
            />
          </div>
          <div class="col-4" data-testid="layer-selected-icon">
            <IconRefField
              ref="layerSelectedIconFieldRef"
              :model-value="layerSelectedIconValue"
              :label="t('poiedit.layer_selected_icon')"
              :read-only="readOnly || translationMode"
              @update:model-value="onLayerSelectedIconChange"
            />
          </div>
          <div class="col-4 d-flex align-items-center justify-content-end gap-2">
            <span class="text-muted small">{{ featureCount }} {{ t("poisource.features") }}</span>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              :class="{ active: rawPaneOpen }"
              @click="toggleRawPane"
            >
              {{ t("poiedit.raw_pane") }}
            </button>
          </div>
        </div>
      </div>

      <!-- 診断領域 (内容があるときのみ表示)。M11-T7/AC8: T5 の DiagnosticFeedback 文法
           (section=検証まとめ・operation=保存エラー、即時表示)へ移行 -->
      <div
        v-if="readOnly || saveError || saveIssues.length || liveErrors.length || liveWarnings.length || missingAssetWarningItems.length"
        class="px-4 py-2 flex-shrink-0 overflow-auto"
        style="max-height: 40%;"
      >
        <DiagnosticFeedback
          v-if="readOnly"
          scope="section"
          :items="[{ key: 'read-only', severity: 'info', message: t('poiedit.read_only_notice') }]"
        />
        <DiagnosticFeedback
          v-if="saveError"
          scope="operation"
          dismissible
          :items="[{ key: 'save-error', severity: 'danger', message: saveError }]"
          @dismiss="saveError = null"
        />
        <!-- 保存 Invalid の issues 一覧 + error レベルの live issue (2026-07-11 ポリシー:
             フォームはエラー値も commit するため保存前に理由をライブ可視化する) -->
        <DiagnosticFeedback v-if="saveIssueItems.length" scope="section" :items="saveIssueItems" />
        <DiagnosticFeedback v-if="liveErrorItems.length" scope="section" :items="liveErrorItems" />
        <!-- POI-108 無コンテンツ警告 / POI-121 規模警告 -->
        <DiagnosticFeedback v-if="liveWarningItems.length" scope="section" :items="liveWarningItems" />
        <!-- M11-T9 AC14: Asset Reference 欠落警告（欠落UIDがある場合のみ表示） -->
        <DiagnosticFeedback v-if="missingAssetWarningItems.length" scope="section" :items="missingAssetWarningItems" />
      </div>

      <!-- 地図ペイン (主役、仕様 §3.3) + 右カラム: 属性フォーム (Task 7) の下に
           feature 一覧 (Task 8) の上下分割。一覧は残り高さで flex (min-height 確保) -->
      <div class="flex-grow-1 d-flex overflow-hidden">
        <!-- 中央カラム: 地図 (主役) + 下部の折りたたみ raw GeoJSON ペイン (POI-136)。
             raw ペインは v-show で mount を維持 (閉→開でローカル編集を失わない)。
             閉時の表示再生成停止は PoiRawPane が :visible で自律制御する -->
        <div class="flex-grow-1 d-flex flex-column overflow-hidden">
          <div class="flex-grow-1 position-relative overflow-hidden">
            <PoiEditMap ref="mapPane" :session="mapSession" :read-only="readOnly" />
          </div>
          <PoiRawPane
            v-show="rawPaneOpen"
            class="poi-raw-pane"
            :session="session"
            :read-only="readOnly"
            :translation-mode="translationMode"
            :visible="rawPaneOpen"
          />
        </div>
        <div class="poi-side-pane border-start bg-white flex-shrink-0 d-flex flex-column overflow-hidden">
          <div class="poi-form-area overflow-auto">
            <PoiAttributeForm
              ref="attrForm"
              :session="session"
              :read-only="readOnly"
              :active-lang="currentLang"
              :language-options="SUPPORTED_LANGUAGES"
              @select-language="currentLang = $event"
            />
          </div>
          <PoiFeatureList
            class="poi-list-area"
            :session="session"
            :read-only="readOnly"
            :active-lang="currentLang"
            @select="onListSelect"
            @create="createPoiAtMapCenter"
          />
        </div>
      </div>
    </template>

    <EditorBusyOverlay
      :visible="saving || exporting || cloning || importing"
      :label="saving ? t('poiedit.saving') : importing ? t('editor_ui.busy_importing') : exporting ? t('editor_ui.busy_exporting') : t('poiedit.clone_to_local')"
    />
  </div>
</template>

<script setup lang="ts">
// POI エディタ (Phase 4 Task 5-8, 仕様 43 §3.3/§4/§5/§6)。
// 地図ペインは PoiEditMap (base map selector + マーカー + contextmenu 追加/削除 +
// Modify ドラッグ移動 + クリック選択)。右カラムは属性フォーム (PoiAttributeForm) +
// feature 一覧 (PoiFeatureList: フィルタ + 自前 windowing + 選択同期)。
// 保存は useRevisionedAssetSave (revision 楽観ロック、ADR-0007)、編集は usePoiEditSession
// (明示 commit = 1 Undo 単位) に委譲する。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import LangResourceInput from "../components/LangResourceInput.vue";
import PoiAttributeForm from "../components/PoiAttributeForm.vue";
import PoiEditMap from "../components/PoiEditMap.vue";
import PoiFeatureList from "../components/PoiFeatureList.vue";
import PoiRawPane from "../components/PoiRawPane.vue";
import IconRefField from "../components/IconRefField.vue";
import SlugField from "../components/editor-ui/SlugField.vue";
import DiagnosticFeedback from "../components/editor-ui/DiagnosticFeedback.vue";
import type { DiagnosticItem } from "../components/editor-ui/editorUiTypes";
import { checkSlugAvailability, type SlugFieldState } from "../composables/useSlugAvailability";
import DraftConflictDialog from "../components/editor-ui/DraftConflictDialog.vue";
import EditorActionHeader from "../components/editor-ui/EditorActionHeader.vue";
import EditorBusyOverlay from "../components/editor-ui/EditorBusyOverlay.vue";
import type { EditorSaveState } from "../components/editor-ui/editorUiTypes";
import {
  usePoiEditSession,
  type PoiEditSession,
  type PoiEditState,
} from "../composables/usePoiEditSession";
import { useRevisionedAssetSave } from "../composables/useRevisionedAssetSave";
import { useAssetDraftLifecycle } from "../composables/useAssetDraftLifecycle";
import { useInitialDraftPersist } from "../composables/useInitialDraftPersist";
import { runEditorExportDecision } from "../composables/useEditorExportDecision";
import { localizeTitle } from "../utils/langResource";
import { guardedReleaseThenFallback, runGuardedPoiImport } from "../utils/initGenerationGuard";
import { validateFeatureCollection, type PoiEditorFC } from "../utils/poiGeoJson";
import { collectAssetRefsInFc, collectImageAssetUids } from "../utils/poiContentMode";
import { ERROR_CODE_KEYS, issueMessage } from "../utils/poiSourceMessages";
import { isEditableElement } from "../utils/nativeTextUndo";
import { isTranslationMode } from "../utils/editorLanguageMode";
import { navigateBackToList } from "../utils/listBackNavigation";
import {
  SUPPORTED_LANGUAGES,
  resolveEditorLanguage,
  type LangCode,
} from "../utils/editorLanguages";
import type { PoiSourceSaveResult, PoiValidationIssue } from "../electron";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const currentLang = ref<LangCode>(resolveEditorLanguage(i18next.language));

const session = usePoiEditSession();
const { state: editState, isDirty, canUndo, canRedo, patchLayerMeta } = session;
const translationMode = computed(() =>
  isTranslationMode(currentLang.value, editState.value?.lang),
);

// M17-T1: layer metadata 編集フィールド (icon/selectedIcon/hide)
const layerIconFieldRef = ref<InstanceType<typeof IconRefField> | null>(null);
const layerSelectedIconFieldRef = ref<InstanceType<typeof IconRefField> | null>(null);

const layerIconValue = computed<string>(() => {
  const v = editState.value?.layerMeta?.icon;
  return typeof v === "string" ? v : "";
});
const layerSelectedIconValue = computed<string>(() => {
  const v = editState.value?.layerMeta?.selectedIcon;
  return typeof v === "string" ? v : "";
});

const onLayerIconChange = (value: string): void => {
  if (value === layerIconValue.value) return;
  patchLayerMeta({ icon: value });
};
const onLayerSelectedIconChange = (value: string): void => {
  if (value === layerSelectedIconValue.value) return;
  patchLayerMeta({ selectedIcon: value });
};

// M17-T1: pickerOpen 中のグローバルキー抑止
const isIconPickerOpen = computed(
  () =>
    !!layerIconFieldRef.value?.pickerOpen ||
    !!layerSelectedIconFieldRef.value?.pickerOpen,
);

// 地図ペイン (panTo / fitInitialView を expose。Task 8 の一覧選択からも使う)
const mapPane = ref<InstanceType<typeof PoiEditMap> | null>(null);
// 属性フォーム (focusName を expose。新規追加直後の name フォーカスに使う)
const attrForm = ref<InstanceType<typeof PoiAttributeForm> | null>(null);

// 新規追加時のフォーカス配線: addFeature 直後に selectedUid が新 uid になったら name 入力へ。
// PoiEditMap の contextmenu 追加 (addPoiAt) はこの wrapper 経由で addFeature を呼ぶため連動する
// (Task 8 の一覧「新規作成」も同じ wrapper を使うこと)。addFeature 以外は素通し
const mapSession: PoiEditSession = {
  ...session,
  addFeature: (lngLat) => {
    const uid = session.addFeature(lngLat);
    void nextTick().then(() => {
      if (session.selectedUid.value === uid) attrForm.value?.focusName();
    });
    return uid;
  },
};

// raw GeoJSON ペイン (POI-136) の開閉。開閉で地図高さが変わるため OL へ updateSize を通知する
const rawPaneOpen = ref(false);
function toggleRawPane(): void {
  rawPaneOpen.value = !rawPaneOpen.value;
  void nextTick().then(() => mapPane.value?.updateSize());
}

const loading = ref(true);
const loadError = ref<string | null>(null);
const readOnly = ref(false);
const saveError = ref<string | null>(null);
const saveIssues = ref<PoiValidationIssue[]>([]);
const cloning = ref(false);

// --- slug 入力 (M11-T7: 共通 SlugField。可用性確認・予約 lifecycle は SlugField 内蔵) ---
const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;
const slugInput = ref("");
const slugField = ref<InstanceType<typeof SlugField> | null>(null);
const slugFieldState = ref<SlugFieldState>("idle");

// M11-T10b: 未作成モードの事前採番 uid（draft キーと保存 create uid を兼ねる。
// MapEdit の newMapUid と同型）。初期化（onMounted / 同一コンポーネントでの new 再突入）
// ごとに採番し直すため ref で持ち、既存 draftUid が route にあれば引き継ぐ。
// newModeActive は「未作成モードとして初期化済み」のフラグで、既存→新規の再初期化判定に使う
const newPoiUid = ref("");
const newModeActive = ref(false);

// M11-T10b (順序契約 #2): 文書操作系 dirty。Undo 履歴の isDirty とは分離し、
// slug live 入力の diverged（session 未 commit）も「保存すべき変更」として扱う。
// 保存ボタン / Cmd+S / saveState / export / draft persist の全入口をこれに揃える
const draftDirty = computed(
  () =>
    isDirty.value ||
    (!!editState.value && slugInput.value.trim() !== editState.value.slug),
);

const draftLifecycle = useAssetDraftLifecycle<PoiEditState>({
  kind: "poi",
  serialize: () => {
    if (!editState.value) throw new Error("POI draft requested before load");
    // M11-T10b (順序契約 #3): draft の slug は live 値を正本とする
    // （予約 slug と下書きカード表示・復元内容を一致させる）
    return { ...structuredClone(editState.value), slug: slugInput.value };
  },
  shouldPersist: () => draftDirty.value,
  apply: (payload) => {
    session.reset(payload, true);
    slugInput.value = payload.slug;
  },
  onRestored: async () => {
    await nextTick();
    mapPane.value?.fitInitialView();
  },
});

// AC6: 新規 asset の slug 予約成功時に初期 draft を即時保存し、予約のGC保護を確立する。
useInitialDraftPersist({
  slugState: slugFieldState,
  isNewAsset: () => !saveHandle.uid.value,
  flushDraft: () => draftLifecycle.flush(),
});

// --- 保存フロー (revision 楽観ロック → conflict は composable が担う) ---
// saveSource が捕捉した送信内容 (snapshot) を send クロージャへ渡す一時変数 (MapEdit の
// pendingSave と同パターン)。保存中の編集で editState が差し替わっても、send (revision-conflict
// の「上書き」再送含む) は捕捉時と同一の snapshot を送る。applySuccess は snapshot 同一性で
// markSaved するかを判定する (保存中の新編集を誤ってクリーン化しない)
let pendingSave: {
  capturedState: PoiEditState;
  payload: { slug: string; title: Record<string, string> | string; fc: PoiEditorFC };
} | null = null;
let poiSaveSucceeded = false;
const saveHandle = useRevisionedAssetSave<PoiSourceSaveResult>({
  send: async ({ uid, expectedRevision }) => {
    // saveSource が pendingSave を設定した後にしか到達しない
    const { payload } = pendingSave!;
    if (uid == null) {
      // M11-T10b: 未作成モードの初回保存は createLocal(fc付き) で単一作成。
      // （空行を作ってから save する2段書き込みは行わない。予約 promote は createSource 経路で成立）
      const created = await window.poiSources.createLocal({
        slug: payload.slug,
        title: payload.title,
        lang: payload.fc.lang,
        uid: newPoiUid.value,
        fc: payload.fc,
      });
      if (!created) {
        saveError.value = t("poiedit.error_saving");
        return null;
      }
      return created;
    }
    const result = await window.poiSources.save(uid, { ...payload, expectedRevision });
    if (!result) {
      // IPC が結果を返さなかった: 表示のみで安全終了
      saveError.value = t("poiedit.error_saving");
      return null;
    }
    return result;
  },
  applySuccess: async (result) => {
    poiSaveSucceeded = true;
    // 保存で既存行の編集モードへ移行（new 再突入時の initializeEditor 再呼出しを有効にする）
    newModeActive.value = false;
    // uid/revision/confirmedSlug は composable が反映済み。以下は画面固有処理。
    // markSaved は保存中に編集が入っていない (snapshot 同一、shallowRef のオブジェクト同一性)
    // 場合のみ。編集が入っていたら isDirty のまま残して再保存を促す
    if (editState.value === pendingSave!.capturedState) {
      session.markSaved();
    }
    // M11-T10b（実装レビュー Major/再）: markSaved → rebase → flush の順序。
    // ① markSaved: 復元下書きが保存で消費されたため draftRestored/conflictDraft を必ずリセットし、
    //    旧 identity の下書きを store から除去（復元表示と破棄操作が残らない）
    // ② rebase: identity を保存済み行の (uid, revision) へ再構成（restore 判定なし。
    //    追加編集の下書きが新規カード化・復元 conflict しない）
    // ③ flush: shouldPersist(draftDirty) に従い、追加編集があれば新 baseRevision で永続化、
    //    なければ除去済みのまま（保存中の追加編集は失われない）
    await draftLifecycle.markSaved();
    draftLifecycle.rebase(result.uid, result.revision);
    await draftLifecycle.flush();
    saveIssues.value = [];
    saveError.value = null;
    // slug 欄を保存結果 (confirmedSlug) に同期。ただし markSaved と同じ snapshot 同一性判定を
    // 通した場合のみ: 保存中に editState が差し替わっていたら (raw pane Apply 等の新編集)、
    // ここで上書きすると乖離した slug を表示してしまうため editState.slug watch の追随に
    // 委ねる (Phase 5 品質レビュー MINOR)
    if (editState.value === pendingSave!.capturedState) {
      slugInput.value = result.slug;
    }
    // path param 正準 (/poisources/:sourceId): uid 変化時のみ追随 (履歴は汚さない)
    if (route.params.sourceId !== result.uid) {
      router.replace({ path: `/poisources/${result.uid}` });
    }
    await (window as any).dialog.showMessageBox({
      type: "info",
      buttons: ["OK"],
      message: t("poiedit.success_save"),
    });
  },
  reloadFromStore: async () => {
    const uid = saveHandle.uid.value;
    if (uid) await load(uid);
  },
  isDirty: () => isDirty.value,
  onFailure: async (result) => {
    if (result.result === "Exist") {
      // 保存レースで slug を先取りされた: 重複を operation 診断へ(field 表示は SlugField が担う)
      saveError.value = t("poisource.errors.slug_taken");
    } else if (result.result === "Invalid") {
      saveIssues.value = result.issues;
    } else if (result.result === "ReadOnly") {
      // remote ソースへの save 拒否 (通常は UI が防ぐが、並行 refresh 等のレース)
      readOnly.value = true;
      saveError.value = t("poiedit.read_only_notice");
    } else {
      // Error: PoiSourceErrorCode 別文言 (PoiSourceList の写像を共用)
      const key = ERROR_CODE_KEYS[result.code] ?? "poisource.errors.internal";
      saveError.value =
        result.code === "invalid-request" || result.code === "internal"
          ? result.message || t(key)
          : t(key);
    }
  },
  // ダイアログ表示時点の言語で t() されるよう getter で渡す (MapEdit/AppEdit と同じ)
  messages: {
    get conflict() { return t("common.revision_conflict"); },
    get discard() { return t("poiedit.confirm_no_save"); },
    get reload() { return t("common.reload"); },
    get overwrite() { return t("common.overwrite"); },
  },
});
const { confirmedSlug, saving, performSave } = saveHandle;
const exporting = ref(false);

async function discardRestoredDraft() {
  const uid = saveHandle.uid.value;
  if (!draftLifecycle.draftRestored.value) return;
  // M11-T10b: 未作成（保存済み行なし）下書きの破棄は完全削除（MapEdit 型）。
  // 予約 teardown: ① slugField.release() 成功後にのみ進む（失敗時は診断して中止）→
  // ② 一覧由来の未 acquire 予約を direct API で冪等解放 → ③ draft 削除 → 一覧へ
  if (!uid) {
    const result = await (window as any).dialog.showMessageBox({
      type: "warning",
      buttons: [t("editor_ui.delete_draft"), t("common.cancel")],
      defaultId: 1,
      cancelId: 1,
      message: t("editor_ui.delete_draft_confirm", { name: displayTitle.value || slugInput.value || t("editor_ui.draft_badge") }),
    });
    if (result.response !== 0) return;
    try {
      await slugField.value?.release();
    } catch (cause) {
      console.error("[PoiEdit] Failed to release slug reservation for new source draft", cause);
      saveError.value = t("poisource.errors.internal");
      return;
    }
    await releaseReservedSlugForNew();
    await draftLifecycle.discard();
    await router.push("/poisources");
    return;
  }
  const result = await (window as any).dialog.showMessageBox({
    type: "warning",
    buttons: [t("editor_ui.discard_draft"), t("common.cancel")],
    defaultId: 1,
    cancelId: 1,
    message: t("editor_ui.discard_draft_confirm"),
  });
  if (result.response !== 0) return;
  await draftLifecycle.discard();
  await load(uid);
}

// タイトル空のフォールバックは EditorActionHeader 共通(editor_ui.untitled)。slug 代用はしない(M11-T10)
const displayTitle = computed(() => {
  const state = editState.value;
  if (!state) return "";
  return localizeTitle(state.title, currentLang.value);
});
const saveState = computed<EditorSaveState>(() => {
  if (saving.value) return "saving";
  if (draftLifecycle.draftRestored.value) return "draft-restored";
  return draftDirty.value ? "dirty" : "saved";
});

const featureCount = computed(() => editState.value?.features.length ?? 0);

const slugError = computed<string | null>(() => {
  const slug = slugInput.value.trim();
  if (!slug) return t("poiedit.no_slug");
  if (!SLUG_PATTERN.test(slug)) return t("poisource.errors.slug_charset");
  // 他者予約/registry 重複は SlugField の state で判定する(field 表示は SlugField 内蔵)
  if (slugFieldState.value === "reserved-by-other") return t("poisource.errors.slug_taken");
  return null;
});

// 診断領域のライブ検証。判定は poiGeoJson.validateFeatureCollection に委譲 (重複実装しない)
const liveIssues = computed<PoiValidationIssue[]>(() => {
  if (!editState.value) return [];
  return validateFeatureCollection(session.toSaveFc());
});

// error レベルの live issue (2026-07-11 ポリシー変更: フォームはエラー値も Undo 履歴に commit
// するため、診断領域に issueMessage でライブ表示し、保存ボタンの disabled 条件にも使う)
const liveErrors = computed<PoiValidationIssue[]>(() =>
  liveIssues.value.filter((issue) => issue.level === "error"),
);

// warning レベル: POI-108 無コンテンツ / POI-121 規模 (>1000 features or serialize >5MB)
const liveWarnings = computed<string[]>(() => {
  const issues = liveIssues.value;
  const keys: string[] = [];
  if (issues.some((i) => i.code === "no-content")) {
    keys.push("poiedit.no_content_warning");
  }
  if (issues.some((i) => i.code === "scale-feature-count" || i.code === "scale-byte-size")) {
    keys.push("poiedit.size_warning");
  }
  return keys;
});

// M11-T9 AC14: Asset Reference 欠落診断。
// HTML内の maplat-asset:<UID> (collectAssetRefsInFc) と、画像欄のアセットUID直接参照
// (collectImageAssetUids、人間検証Round1で標準表示の画像が未検査だった穴を解消) を合算し、
// window.imageAssets.getFilePath で1件ずつ存在照会して解決できない UID のみ warning を立てる。
// 参照が1件もない場合は何も表示しない（有効な参照だけならノイズ警告しない）。
const missingAssetRefUids = ref<string[]>([]);
const assetRefCheckSeq = ref(0);

watch(
  () => session.state.value?.features,
  (features) => {
    // load() 前は toSaveFc() が throw し watcher ごと停止するため、state 未初期化時はスキップする
    if (!features) {
      missingAssetRefUids.value = [];
      return;
    }
    const seq = ++assetRefCheckSeq.value;
    const fc = session.toSaveFc();
    const uidSet = collectAssetRefsInFc(fc);
    for (const f of (fc as { features?: Array<{ properties?: Record<string, unknown> }> }).features ?? []) {
      for (const uid of collectImageAssetUids(f?.properties?.image)) uidSet.add(uid);
    }
    const uids = [...uidSet];
    if (uids.length === 0) {
      missingAssetRefUids.value = [];
      return;
    }
    // 非同期で各UIDの存在を確認
    Promise.all(uids.map(async (uid) => {
      try {
        const path = await window.imageAssets.getFilePath(uid);
        return path ? null : uid; // null = resolved
      } catch {
        return uid; // error = missing
      }
    })).then((results) => {
      if (seq !== assetRefCheckSeq.value) return; // stale
      const missing = results.filter((uid): uid is string => uid !== null);
      missingAssetRefUids.value = missing;
    });
  },
  { immediate: true, deep: true },
);

const missingAssetWarningItems = computed<DiagnosticItem[]>(() => {
  if (missingAssetRefUids.value.length === 0) return [];
  return [{
    key: "missing-asset-ref",
    severity: "warning" as const,
    message: t("poiedit.missing_asset_refs", { count: missingAssetRefUids.value.length }),
  }];
});

// M11-T7/AC8: 診断領域の DiagnosticFeedback items(T5 文法 DiagnosticItem = {key, severity, message})
const saveIssueItems = computed<DiagnosticItem[]>(() =>
  saveIssues.value.map((issue, index) => ({
    key: `save-issue-${index}`,
    severity: "danger" as const,
    message: issueMessage(issue, t),
  })),
);
const liveErrorItems = computed<DiagnosticItem[]>(() =>
  liveErrors.value.map((issue, index) => ({
    key: `live-error-${index}`,
    severity: "danger" as const,
    message: issueMessage(issue, t),
  })),
);
const liveWarningItems = computed<DiagnosticItem[]>(() =>
  liveWarnings.value.map((key) => ({ key, severity: "warning" as const, message: t(key) })),
);

// --- 読込 ---
// M11-T10b（実装レビュー Minor）: 世代 token。既存→new 再初期化や連続した load の間に
// 遅い旧応答が新しい session を上書きするのを防ぐ
let loadGeneration = 0;

async function load(sourceId: string): Promise<void> {
  const generation = ++loadGeneration;
  newModeActive.value = false;
  loading.value = true;
  loadError.value = null;
  saveError.value = null;
  saveIssues.value = [];
  try {
    const detail = await window.poiSources.get(sourceId);
    if (generation !== loadGeneration) return; // 旧 load 応答は破棄
    if (!detail) {
      loadError.value = t("poiedit.not_found");
      return;
    }
    saveHandle.adoptLoaded({ uid: detail.uid, slug: detail.slug, revision: detail.revision });
    readOnly.value = detail.readOnly;
    // fc は Phase 2 get 経由で _maplatUid 付与済みの内部形
    session.load({
      lang: resolveEditorLanguage(detail.lang || i18next.language),
      slug: detail.slug,
      title: detail.title,
      fc: (detail.fc ?? { type: "FeatureCollection", features: [] }) as PoiEditorFC,
    });
    currentLang.value = resolveEditorLanguage(detail.lang || i18next.language);
    slugInput.value = detail.slug;
    await draftLifecycle.open(detail.uid, detail.revision, {
      shouldApply: () => generation === loadGeneration,
    });
    if (generation !== loadGeneration) return; // open 中の遷移も破棄
  } catch (e) {
    if (generation !== loadGeneration) return;
    console.error("[PoiEdit] Failed to load POI source:", e);
    loadError.value = t("poisource.errors.internal");
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
  if (!loadError.value) {
    // 初期表示: features があれば全体が入る extent へ fit、無ければ日本付近デフォルト。
    // 初回は PoiEditMap の onMounted が同じ処理を行うが、route 変化による再読込では
    // マウント済みの地図に対して明示的に呼ぶ必要がある
    await nextTick();
    mapPane.value?.fitInitialView();
  }
}

// クローン遷移等で :sourceId が変わったら読み直す (保存後の replace は uid 一致のため対象外)
watch(
  () => route.params.sourceId,
  (next) => {
    if (typeof next !== "string" || next === "") return;
    if (next === "new") {
      // 既に未作成モードとして初期化済みなら何もしない（draftUid replace 等の自己遷移）。
      // 既存→新規の再突入は initializeEditor で再初期化する（M11-T10b）
      if (!newModeActive.value) void initializeEditor();
      return;
    }
    if (next === saveHandle.uid.value) return;
    load(next);
  },
);

// --- title / slug (どちらも session.commit 経由 = 1 Undo 単位、仕様 §5) ---
function onTitleUpdate(value: string | Record<string, string> | undefined): void {
  if (readOnly.value) return;
  session.commit((draft) => {
    draft.title = value ?? {};
  });
}

function onDefaultLanguageChange(event: Event): void {
  if (readOnly.value || translationMode.value) return;
  const lang = resolveEditorLanguage((event.target as HTMLSelectElement).value);
  session.commit((draft) => { draft.lang = lang; });
  currentLang.value = lang;
}

// slug の live 入力(M11-T7)。可用性確認・予約 lifecycle は SlugField 内蔵のため、
// ここでは保存 operation 診断の解消と live 値の保持のみ行う
function onSlugLiveInput(value: string): void {
  saveError.value = null;
  slugInput.value = value;
}

// change (blur) 確定時に 1 Undo 単位として commit する
function onSlugChange(value: string): void {
  const state = editState.value;
  if (!state || readOnly.value || translationMode.value) return;
  const slug = value.trim();
  slugInput.value = slug;
  if (slug === state.slug) return;
  session.commit((draft) => {
    draft.slug = slug;
  });
}

// undo/redo/読込で session 側の slug が変わったら入力欄を追随させる(可用性は SlugField が再確認)
watch(
  () => editState.value?.slug,
  (next) => {
    if (typeof next !== "string") return;
    if (next !== slugInput.value) slugInput.value = next;
  },
);

// M11-T10b（設計レビュー Minor）: 新規で予約成立後に live 入力を空欄へ戻した場合、
// draftDirty は false（draft は除去される）のに held 予約だけが lease/GC まで残る孤児になる。
// 空欄復帰で予約を即時解放し、同じ slug がすぐ available へ戻るようにする。
// 既存行は SlugField の元 slug 復帰 release が担うため対象外（新規のみ）。
watch(slugInput, async (value, oldValue) => {
  if (saveHandle.uid.value) return;
  if (value.trim() !== "" || !oldValue || oldValue.trim() === "") return;
  try {
    await slugField.value?.release();
  } catch (cause) {
    // SlugField 内部の releaseFailed 警告状態に委譲（再予約は次回入力で行われる）
    console.error("[PoiEdit] Failed to release slug reservation on empty revert", cause);
  }
  try {
    await window.slugReservations.release({ slug: oldValue.trim(), assetUid: newPoiUid.value });
  } catch (cause) {
    // lease/GC が最終回収するため log のみ
    console.error("[PoiEdit] Failed to direct-release slug reservation on empty revert", cause);
  }
});
watch(
  [editState, slugInput],
  () => draftLifecycle.schedule(draftDirty.value),
  { deep: true, flush: "post" },
);

// --- 保存 ---
async function saveSource(): Promise<boolean> {
  poiSaveSucceeded = false;
  if (readOnly.value || saving.value) return false;
  saveError.value = null;
  saveIssues.value = []; // 前回 Invalid の issues を持ち越さない
  // M11-T10b (順序契約 #6): live slug を session へ確定してから捕捉する。
  // blur 前の Cmd+S / 保存クリックが古い session slug を送ることを防ぐ（1 Undo 単位）
  const liveSlug = slugInput.value.trim();
  if (editState.value && liveSlug !== "" && liveSlug !== editState.value.slug) {
    session.commit((draft) => {
      draft.slug = liveSlug;
    });
  }
  if (slugError.value) {
    saveError.value = slugError.value;
    return false;
  }
  // M11-T7: 保存直前の予約再確認(§7.1 confirmForSave)。他者予約なら保存中断(D7)
  const slugOk = await slugField.value?.confirmForSave() ?? true;
  if (!slugOk) {
    saveError.value = t("poisource.errors.slug_taken");
    return false;
  }
  // 送信内容をここで一度だけ捕捉 (JSON ラウンドトリップは AppEdit と同様、非 clone 可能値の
  // 混入防止)。conflict 後の「上書き」再送も同一 snapshot を送る (MapEdit と同セマンティクス)
  const capturedState = editState.value!;
  pendingSave = {
    capturedState,
    payload: JSON.parse(
      JSON.stringify({
        slug: capturedState.slug,
        title: capturedState.title,
        fc: session.toSaveFc(),
      }),
    ) as { slug: string; title: Record<string, string> | string; fc: PoiEditorFC },
  };
  await performSave();
  return poiSaveSucceeded;
}

async function choosePoiExport(hasSaved: boolean) {
  const buttons = hasSaved
    ? [
        t("editor_ui.export_save_and_run"),
        t("editor_ui.export_saved_only"),
        t("common.cancel"),
      ]
    : [t("editor_ui.export_save_and_run"), t("common.cancel")];
  const result = await (window as any).dialog.showMessageBox({
    type: "info",
    buttons,
    cancelId: buttons.length - 1,
    message: t("editor_ui.export_dirty_prompt"),
  });
  if (result.response === 0) return "save" as const;
  if (hasSaved && result.response === 1) return "saved" as const;
  return "cancel" as const;
}

async function exportSavedSource(): Promise<boolean> {
  const uid = saveHandle.uid.value;
  if (!uid) return false;
  const result = await window.poiSources.exportFile(uid);
  if (result.result === "Canceled") return false;
  if (result.result === "Error") {
    await (window as any).dialog.showMessageBox({
      type: "error",
      buttons: ["OK"],
      message: t("editor_ui.export_failed"),
      detail: result.message || "",
    });
    return false;
  }
  await (window as any).dialog.showMessageBox({
    type: "info",
    buttons: ["OK"],
    message: t("editor_ui.export_success"),
  });
  return true;
}

async function exportSource(): Promise<void> {
  if (readOnly.value || saving.value || exporting.value) return;
  exporting.value = true;
  try {
    await runEditorExportDecision({
      dirty: draftDirty.value,
      hasSaved: !!saveHandle.uid.value,
      choose: choosePoiExport,
      save: saveSource,
      exportSaved: exportSavedSource,
    });
  } finally {
    exporting.value = false;
  }
}

// --- ReadOnly (remote) → ローカル複製 (Phase 3 cloneToLocal) して新 uid へ遷移 ---
async function cloneSourceToLocal(): Promise<void> {
  if (cloning.value) return;
  const uid = saveHandle.uid.value;
  const state = editState.value;
  if (!uid || !state) return;
  cloning.value = true;
  saveError.value = null;
  try {
    // 空き slug を探索して自動提案 (ローカル側の slug はエディタでいつでも変更できる)
    const base =
      (confirmedSlug.value || state.slug).replace(/[^A-Za-z0-9_-]+/g, "-") || "poi";
    let candidate = `${base}-local`;
    for (let i = 2; i <= 50; i++) {
      // M11-T7/AC17: 生 checkSlug ではなく sanctioned wrapper(registry AND 予約合成)で探索する
      if (await checkSlugAvailability({ slug: candidate })) break;
      candidate = `${base}-local${i}`;
    }
    const result = await window.poiSources.cloneToLocal(uid, { slug: candidate });
    if ("error" in result || result.result !== "Success") {
      console.error("[PoiEdit] cloneToLocal failed:", result);
      saveError.value = t("poiedit.clone_failed");
      return;
    }
    // 新 uid へ遷移 (route watcher が新ソースを読込む)
    router.push(`/poisources/${result.uid}`);
  } catch (e) {
    console.error("[PoiEdit] cloneToLocal failed:", e);
    saveError.value = t("poiedit.clone_failed");
  } finally {
    cloning.value = false;
  }
}

// --- feature 一覧 (Task 8): 選択・新規作成の実行責務は PoiEdit 側に置く ---
// 行クリック = 選択 + 地図 pan (仕様 §3.3。可視範囲内でも明示 pan する)
function onListSelect(uid: string): void {
  session.selectedUid.value = uid;
  mapPane.value?.panTo(uid);
}

// 一覧の「新規作成」= 地図中央に配置 + フォームフォーカス (仕様 §3.3)。
// 必ず mapSession (wrapper) の addFeature を使う (生 session では name フォーカスが飛ばない)
function createPoiAtMapCenter(): void {
  if (readOnly.value) return;
  const center = mapPane.value?.getCenterLngLat();
  if (!center) return;
  const uid = mapSession.addFeature(center);
  session.selectedUid.value = uid;
}

// --- Undo/Redo (ボタン + キーボード + menu:undo/redo IPC、MapEdit と同パターン) ---
function performUndo(): void {
  if (saveHandle.saving.value || exporting.value) return; // 保存中の snapshot 差し替えを防ぐ (markSaved 判定と対)
  if (readOnly.value || !canUndo.value) return;
  session.undo();
}

function performRedo(): void {
  if (saveHandle.saving.value || exporting.value) return; // 保存中の snapshot 差し替えを防ぐ (markSaved 判定と対)
  if (readOnly.value || !canRedo.value) return;
  session.redo();
}

// 入力要素 focus 中はグローバルキー操作 (undo/redo/Delete) を無視する。
// onHistoryKeydown と Delete キー削除で同一の判定を共有する (Task 6 要件)
const isInputTarget = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement | null;
  return (
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    !!target?.isContentEditable
  );
};

const onHistoryKeydown = (event: KeyboardEvent) => {
  if (attrForm.value?.pickerOpen || isIconPickerOpen.value) return; // picker 表示中はグローバルキーを抑止 (Phase 6 品質レビュー MAJOR-2 + M17-T1)
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    if (!readOnly.value && !saving.value && !exporting.value && draftDirty.value && liveErrors.value.length === 0) {
      void saveSource();
    }
    return;
  }
  if (isInputTarget(event)) return;
  if (saving.value || exporting.value) return;
  if (key === "z" && event.shiftKey) {
    event.preventDefault();
    performRedo();
  } else if (key === "z") {
    event.preventDefault();
    performUndo();
  } else if (key === "y") {
    event.preventDefault();
    performRedo();
  }
};

// 選択中 feature の Delete キー削除 (仕様 §4)。ReadOnly では無効。
// macOS のフルキーボードでない Delete キーは event.key === "Backspace" なので両方受ける
const onDeleteKeydown = (event: KeyboardEvent) => {
  if (attrForm.value?.pickerOpen || isIconPickerOpen.value) return; // picker 表示中はグローバルキーを抑止 (Phase 6 品質レビュー MAJOR-2 + M17-T1)
  if (saveHandle.saving.value || exporting.value || cloning.value) return; // Busy中は編集操作を抑止
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (isInputTarget(event)) return;
  if (readOnly.value) return;
  const uid = session.selectedUid.value;
  if (!uid) return;
  event.preventDefault();
  session.removeFeature(uid);
};

let removeMainProcessListener: (() => void) | undefined;

const onMainProcessMessage = (message: string) => {
  if (attrForm.value?.pickerOpen || isIconPickerOpen.value) return; // picker 表示中はグローバルキーを抑止 (Phase 6 品質レビュー MAJOR-2 + M17-T1)
  // 編集可能フィールドにフォーカス中はネイティブのテキスト undo が対象
  // (App.vue のグローバルリスナーが実行済み。セッション undo は発動しない)
  if (isEditableElement(document.activeElement)) return;
  if (saving.value || exporting.value || cloning.value) return;
  if (message === "menu:undo") {
    performUndo();
  } else if (message === "menu:redo") {
    performRedo();
  }
};

// --- 離脱確認 (goBack ボタン方式、ルートガードは使わない) ---
async function goBack(): Promise<void> {
  await draftLifecycle.flush();
  // m12-t31: 一覧への遷移は navigateBackToList（router.push 一本）に統一する
  // （preview iframe 内の Maplat viewer が joint session history を汚染するため）。
  await navigateBackToList(router, "/poisources");
}

onMounted(() => {
  window.addEventListener("keydown", onHistoryKeydown);
  window.addEventListener("keydown", onDeleteKeydown);
  removeMainProcessListener = window.appEvents.onMainProcessMessage(onMainProcessMessage);
  void initializeEditor();
});

// M11-T10b: 未作成モード（/poisources/new）の初期化分岐。
// 空 / 複製（duplicateFrom）/ インポート（import=1）/ 下書き復元（draftUid）の4経路。
// onMounted 初回と、同一コンポーネントのまま既存→新規へ遷移した場合の再初期化の双方で呼ばれる
async function initializeEditor(): Promise<void> {
  const generation = ++loadGeneration;
  const sourceId = route.params.sourceId as string;
  if (sourceId !== "new") {
    newModeActive.value = false;
    await load(sourceId);
    return;
  }
  // 未作成モード: save handle を未作成状態へ戻す（既存→新規の再初期化で uid が残らないように）
  saveHandle.uid.value = undefined;
  saveHandle.revision.value = undefined;
  saveHandle.confirmedSlug.value = undefined;
  newModeActive.value = true;
  newPoiUid.value = typeof route.query.draftUid === "string" && route.query.draftUid
    ? route.query.draftUid
    : crypto.randomUUID();
  // readOnly なし・load 済み扱いで session を直接初期化する
  readOnly.value = false;
  loading.value = false;
  saveError.value = null;
  saveIssues.value = [];
  const duplicateFrom = typeof route.query.duplicateFrom === "string" && route.query.duplicateFrom
    ? route.query.duplicateFrom
    : null;
  if (duplicateFrom) {
    // 複製（案A: エディタ側ロード）。複製浄化: uid/revision/readOnly は写さず、
    // slug は予約値で上書き。title/lang/fc（layerMeta 含む）を複製し dirty で開く
    let source: Awaited<ReturnType<typeof window.poiSources.get>> | null = null;
    try {
      source = await window.poiSources.get(duplicateFrom);
    } catch {
      source = null;
    }
    if (source) {
      if (generation !== loadGeneration) return; // 遅い複製元応答は新しい session を上書きしない
      const reservedSlug = typeof route.query.slug === "string" ? route.query.slug : source.slug;
      const lang = resolveEditorLanguage(source.lang);
      session.load(
        { lang, slug: reservedSlug, title: source.title, fc: source.fc as PoiEditorFC },
        { dirty: true },
      );
      slugInput.value = reservedSlug;
      currentLang.value = lang;
    } else {
      // 元消失（並行削除等）: 予約を解放してから空初期化 + operation 診断（予約 teardown 契約）。
      // M12-T2: release の await 前後で generation を確認し、stale なら解放後の
      // （空初期化 + duplicate_failed 診断）副作用を行わない（新 session の上書き防止）
      await guardedReleaseThenFallback({
        isCurrent: () => generation === loadGeneration,
        release: () => releaseReservedSlugForNew(),
        onFallback: () => {
          initializeEmptySession();
          saveError.value = t("resource_list.duplicate_failed");
        },
      });
    }
  } else {
    initializeEmptySession();
  }
  // 新規の draft キー = 事前採番 uid。予約帰属・create uid と一致させる（M11-T7 と同型）
  if (route.query.draftUid !== newPoiUid.value) {
    await router.replace({ query: { ...route.query, draftUid: newPoiUid.value } });
  }
  if (generation !== loadGeneration) return; // 初期化中の遷移は以降の副作用ごと破棄
  await draftLifecycle.open(newPoiUid.value, null, {
    shouldApply: () => generation === loadGeneration,
  });
  if (generation !== loadGeneration) return; // open 中の遷移も破棄
  // インポート自動起動（複製と併用しない）。draft 復元があっても importFile 成功時に張り直す
  if (route.query.import === "1" && !duplicateFrom) {
    void nextTick(() => {
      void importAutoRun(generation);
    });
  }
  await nextTick();
  mapPane.value?.fitInitialView();
}

// 未作成モードの空初期化（lang は UI 言語 = POI ソース既定言語の新規ルール）
function initializeEmptySession(): void {
  const lang = resolveEditorLanguage(i18next.language);
  session.load({
    lang,
    slug: "",
    title: {},
    fc: { type: "FeatureCollection", features: [] } as PoiEditorFC,
  });
  slugInput.value = "";
  currentLang.value = lang;
}

// 一覧の reserveCopySlug 由来など SlugField 未 acquire の予約を冪等解放する
// （DELETE 冪等のため重複実行も安全。失敗時は lease/GC が最終回収）
async function releaseReservedSlugForNew(): Promise<void> {
  const slug = typeof route.query.slug === "string" && route.query.slug
    ? route.query.slug
    : slugInput.value.trim();
  if (!slug) return;
  try {
    await window.slugReservations.release({ slug, assetUid: newPoiUid.value });
  } catch (cause) {
    console.error("[PoiEdit] Failed to release reserved slug for new source", cause);
  }
}

// --- インポート自動起動（/poisources/new?import=1）---
const importing = ref(false);

// M12-T2: generation 引数化。スケジュール後の世代切替（stale）では picker 表示・importFile・
// loadSaved/replaceRoute を行わない（runGuardedPoiImport が各ステップ間で isCurrent を確認する。
// 残留物ポリシー: importFile 成功後 stale でも自世代 uid の draft cleanup のみ実行される）
async function importAutoRun(generation: number): Promise<void> {
  if (importing.value || saveHandle.uid.value || generation !== loadGeneration) return;
  importing.value = true;
  try {
    // flow 開始時に自世代 uid を固定（importFile と cleanup が同じ uid を使い、
    // 世代切替後に新世代 uid の draft を誤消しない）
    const importUid = newPoiUid.value;
    const outcome = await runGuardedPoiImport({
      isCurrent: () => generation === loadGeneration,
      newUid: () => importUid,
      pickImportFile: () => window.poiSources.pickImportFile(),
      detectImportLanguage: (filePath, fallback) => window.poiSources.detectImportLanguage(filePath, fallback),
      importFile: (input) => window.poiSources.importFile(input),
      removeDraft: (uid) => window.assetDrafts.remove("poi", uid),
      loadSaved: (uid) => load(uid),
      replaceRoute: async (uid) => { await router.replace({ path: `/poisources/${uid}` }); },
    });
    if (outcome.outcome === "failed") {
      // PoiSourceSaveResult failure は saveSource の onFailure と同じ語彙で診断へ
      const result = outcome.failure as any;
      if (result && "result" in result && result.result === "Exist") {
        saveError.value = t("poisource.errors.slug_taken");
      } else if (result && "result" in result && result.result === "Invalid") {
        saveIssues.value = result.issues;
      } else if (result && "result" in result && result.result === "Error") {
        const key = ERROR_CODE_KEYS[result.code as keyof typeof ERROR_CODE_KEYS] ?? "poisource.errors.internal";
        saveError.value =
          result.code === "invalid-request" || result.code === "internal"
            ? result.message || t(key)
            : t(key);
      } else {
        saveError.value = t("poisource.errors.internal");
      }
    }
    // outcome "current-saved" / "cancelled" / "stale" は追加処理なし
  } catch (e: any) {
    // pickImportFile / detectImportLanguage / importFile 自身の throw（IPC 不達・main 例外）も
    // 同じ operation 診断へ収束させる（silent 失敗禁止。stale では表示しない）
    console.error("[PoiEdit] import failed", e);
    if (generation === loadGeneration) {
      saveError.value = e?.message || t("poisource.errors.internal");
    }
  } finally {
    importing.value = false;
  }
}

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onHistoryKeydown);
  window.removeEventListener("keydown", onDeleteKeydown);
  removeMainProcessListener?.();
  removeMainProcessListener = undefined;
});
</script>

<style scoped>
/* 右カラム (属性フォーム + feature 一覧)。地図が主役の比率を保つ固定幅 */
.poi-side-pane {
  width: 340px;
}

/* フォーム優先の固定分配 (Phase 8 Task 1): 旧 flex: 0 1 auto + min-height: 0 は
   大量 feature 時に一覧 (flex-grow) がフォームを 0 まで押し潰していた。
   フォームは内容高さ基準で伸び、最大 55% で内部スクロール (overflow-auto は template 側)。
   一覧は残り高さを取り、min-height でフォームが大きくても常に操作可能を保証する */
.poi-form-area {
  flex: 0 0 auto;
  max-height: 55%;
}

.poi-list-area {
  flex: 1 1 0;
  min-height: 160px;
}

/* raw GeoJSON ペイン (POI-136): 開時は地図の下に ~40% (地図が主役の比率維持) */
.poi-raw-pane {
  height: 40%;
  flex-shrink: 0;
}

</style>
