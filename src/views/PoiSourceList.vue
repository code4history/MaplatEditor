<template>
  <div class="poi-source-list h-100 d-flex flex-column">
    <ResourceListShell
      kind="poi-source"
      kind-name-key="resource_list.kind_poi_source"
      variant="grid"
      :query="query"
      :state="state"
      :total="total"
      :loaded="loaded"
      @create="openCreateLocal"
      @update:query="updateQuery"
      @retry="retry"
      @load-more="loadMore"
    >
      <template #secondary>
        <button class="btn btn-outline-secondary btn-sm" data-poi-import @click="openImport">
          {{ t("poisource.import_file") }}
        </button>
        <!-- リモート登録 UI は 2026-07-11 決定により抑制中（D13）。表示条件を変えず slot 内へ移設。
             backend (registerRemote/refreshRemote/ReadOnly/cloneToLocal) は温存 — true に戻せば復活する -->
        <button v-if="REMOTE_POI_REGISTRATION_ENABLED" class="btn btn-outline-secondary btn-sm" @click="openRegisterRemote">
          {{ t("poisource.register_remote") }}
        </button>
      </template>

      <div class="d-flex flex-wrap justify-content-start align-items-start gap-4 p-3">
        <ResourceGridCard
          v-for="vm in viewModels"
          :key="vm.uid"
          :item="vm"
          kind="poi-source"
          :to="`/poisources/${vm.uid}`"
          :fallback-image="noImage"
          :draft-label="t('editor_ui.draft_badge')"
          @action="onAction"
        />
      </div>
    </ResourceListShell>

    <!-- Create Local / Import / Register Remote Modal (shared form) -->
    <div v-if="modal.mode" class="modal show d-block" tabindex="-1" @click.self="closeModal">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ modalTitle }}</h5>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>
          <div class="modal-body">
            <!-- Import: picked file path (read-only display) -->
            <div v-if="modal.mode === 'import'" class="mb-3">
              <label class="form-label">{{ t("poisource.import_modal.file_label") }}</label>
              <input
                type="text"
                class="form-control"
                :value="modal.fileName"
                readonly
              />
            </div>

            <!-- slug -->
            <label class="form-label">{{ t("poisource.slug_label") }}</label>
            <input
              type="text"
              class="form-control"
              :class="{ 'is-invalid': slugError, 'is-valid': slugChecked && !slugError }"
              v-model="modal.slug"
              :placeholder="t('poisource.slug_placeholder')"
              @input="onSlugInput"
            />
            <div v-if="slugError" class="invalid-feedback d-block">{{ slugError }}</div>

            <!-- title -->
            <label class="form-label mt-3">{{ t("poisource.title_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="modal.title"
              :placeholder="t('poisource.title_placeholder')"
            />

            <label class="form-label mt-3">{{ t("mapedit.set_default") }}</label>
            <select v-model="modal.lang" class="form-select" data-poi-source-language @change="modal.langEdited = true">
              <option v-for="language in SUPPORTED_LANGUAGES" :key="language.code" :value="language.code">
                {{ language.nativeName }}
              </option>
            </select>

            <!-- Register remote: url -->
            <template v-if="modal.mode === 'remote'">
              <label class="form-label mt-3">{{ t("poisource.url_label") }}</label>
              <input
                type="url"
                class="form-control"
                v-model="modal.url"
                :placeholder="t('poisource.url_placeholder')"
                @input="onUrlInput"
              />
            </template>

            <!-- Feedback (validation issues / error-code messages) -->
            <div v-if="modal.feedback" class="alert mt-3 mb-0" :class="modal.feedbackRetry ? 'alert-warning' : 'alert-danger'">
              <div style="white-space: pre-line;">{{ modal.feedback }}</div>
              <button
                v-if="modal.feedbackRetry"
                type="button"
                class="btn btn-sm btn-outline-secondary mt-2"
                @click="submitModal"
              >
                {{ t("poisource.retry") }}
              </button>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeModal">
              {{ t("poisource.cancel") }}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="!canSubmit"
              @click="submitModal"
            >
              {{ submitLabel }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import noImage from "../assets/img/no_image.png";
import { useInfiniteResourceList } from "../composables/useInfiniteResourceList";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import ResourceListShell from "../components/resource-list/ResourceListShell.vue";
import ResourceGridCard from "../components/resource-list/ResourceGridCard.vue";
import { createPoiSourceListAdapter } from "./resource-adapters/poiSourceListAdapter";
import type { PoiSourceListRow } from "../electron";
import type { ResourceListItemViewModel } from "../components/resource-list/resourceListTypes";
import { ERROR_CODE_KEYS, issueMessage as resolveIssueMessage } from "../utils/poiSourceMessages";
import type {
  PoiSourceSaveResult,
  PoiValidationIssue,
  PoiSourceReference,
} from "../electron";
import {
  SUPPORTED_LANGUAGES,
  resolveEditorLanguage,
  type LangCode,
} from "../utils/editorLanguages";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { hasDraft, refreshDrafts } = useAssetDraftBadges('poi');

// リモート登録 UI の抑制フラグ (ユーザー決定 2026-07-11)。望む形式のリモート POI データが
// 実在せず、htmlTemplate 対応 (POI-007/109) までは実用にならないため UI のみ隠す。
// backend (registerRemote/refreshRemote/ReadOnly/cloneToLocal) は温存 — true に戻せば復活する
const REMOTE_POI_REGISTRATION_ENABLED = false;

const query = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const adapter = createPoiSourceListAdapter({
  hasDraft,
  selectedUid: () => null,
  featuresLabel: (count) => `${count} ${t("poisource.features")}`,
  localLabel: t("poisource.local"),
  remoteLabel: t("poisource.remote"),
});
const { items, total, loaded, state, loadFirst, loadMore, retry, applyDeletion } =
  useInfiniteResourceList<PoiSourceListRow, number>(adapter, { filter: () => ({ q: query.value, bbox: null }), activeLang: () => i18next.language });
const viewModels = computed<ResourceListItemViewModel[]>(() => items.value.map((item) => adapter.toViewModel(item, i18next.language)));

function updateQuery(value: string): void {
  void router.replace({ query: { ...route.query, q: value.trim() ? value : undefined } });
}

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

// --- delete（右クリックメニュー導線は ResourceActionMenu に一本化。参照チェックは維持）---
async function onAction(key: string, vm: ResourceListItemViewModel): Promise<void> {
  if (key !== "delete") return;
  await deleteSourceByUid(vm.uid, vm.title);
}

const deleteSourceByUid = async (uid: string, title: string) => {
  // AID-006: 削除前に参照(app/map)を提示。references は Phase 7 まで空だが表示線を先に敷く
  let references: PoiSourceReference[] = [];
  let referencesUnavailable = false;
  try {
    references = await window.poiSources.findReferences(uid);
  } catch (e) {
    console.error("Failed to resolve POI source references", e);
    referencesUnavailable = true;
  }
  let message = t("poisource.delete_confirm", { name: title });
  if (referencesUnavailable) {
    message += "\n\n" + t("poisource.errors.references_unavailable");
  } else if (references.length > 0) {
    const appCount = references.filter((r) => r.kind === "app").length;
    const mapCount = references.filter((r) => r.kind === "map").length;
    message +=
      "\n\n" +
      t("poisource.delete_referenced", { app: appCount, map: mapCount }) +
      "\n" +
      references.map((r) => `- ${t(`poisource.ref_kind.${r.kind}`)}: ${r.slug}`).join("\n");
  }
  if (!confirm(message)) return;
  try {
    await window.poiSources.delete(uid);
    await window.assetDrafts.remove('poi', uid);
    await applyDeletion(uid); // D9: UID除去 + 最終page再取得 dedupe
    await refreshDrafts();
  } catch (e) {
    console.error("Failed to delete POI source", e);
    alert(t("poisource.delete_error"));
  }
};

// --- Shared modal (create local / import / register remote) ---
type ModalMode = "local" | "import" | "remote" | null;
const modal = reactive({
  mode: null as ModalMode,
  slug: "",
  title: "",
  url: "",
  filePath: "",
  fileName: "",
  feedback: "",
  feedbackRetry: false,
  submitting: false,
  lang: resolveEditorLanguage(i18next.language) as LangCode,
  langEdited: false,
  // slug 欄をユーザーが手入力したら true。以後 title からの自動提案で上書きしない
  slugEdited: false,
});

const slugChecked = ref(false);
const slugAvailable = ref(false);
let slugCheckToken = 0;

const slugError = computed<string | null>(() => {
  const slug = modal.slug.trim();
  if (!slug) return null;
  if (!SLUG_PATTERN.test(slug)) return t("poisource.errors.slug_charset");
  if (slugChecked.value && !slugAvailable.value) return t("poisource.errors.slug_taken");
  return null;
});

const modalTitle = computed(() => {
  if (modal.mode === "local") return t("poisource.create_local_modal.title");
  if (modal.mode === "import") return t("poisource.import_modal.title");
  if (modal.mode === "remote") return t("poisource.register_remote_modal.title");
  return "";
});

const submitLabel = computed(() => {
  if (modal.mode === "local") return t("poisource.create_local_modal.create");
  if (modal.mode === "import") return t("poisource.import_modal.import");
  if (modal.mode === "remote") return t("poisource.register_remote_modal.register");
  return "";
});

const canSubmit = computed(() => {
  if (modal.submitting) return false;
  const slug = modal.slug.trim();
  if (!slug || !SLUG_PATTERN.test(slug)) return false;
  if (slugChecked.value && !slugAvailable.value) return false;
  if (!modal.title.trim()) return false;
  if (modal.mode === "remote" && !modal.url.trim()) return false;
  if (modal.mode === "import" && !modal.filePath) return false;
  return true;
});

const resetModal = () => {
  modal.slug = "";
  modal.title = "";
  modal.url = "";
  modal.filePath = "";
  modal.fileName = "";
  modal.feedback = "";
  modal.feedbackRetry = false;
  modal.submitting = false;
  modal.slugEdited = false;
  modal.lang = resolveEditorLanguage(i18next.language);
  modal.langEdited = false;
  slugChecked.value = false;
  slugAvailable.value = false;
  // in-flight の slug チェック応答を無効化 (MINOR-1)
  slugCheckToken++;
};

const closeModal = () => {
  modal.mode = null;
  resetModal();
};

// slug 自動生成 (title or ファイル名 → [A-Za-z0-9_-])。可用性チェックは checkSlug に委ねる
const suggestSlug = (base: string): string =>
  base
    .normalize("NFKD")
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const checkSlug = async () => {
  // early-return する場合でも in-flight の旧応答を無効化しておく (MINOR-1)
  const token = ++slugCheckToken;
  const slug = modal.slug.trim();
  slugChecked.value = false;
  slugAvailable.value = false;
  if (!slug || !SLUG_PATTERN.test(slug)) return;
  try {
    const available = await window.assets.checkSlug({ slug });
    if (token !== slugCheckToken) return; // 後発の入力に上書きされた
    slugChecked.value = true;
    slugAvailable.value = available;
  } catch (e) {
    console.error("Failed to check slug availability", e);
  }
};

const onSlugInput = () => {
  // 手入力されたら title からの自動提案を止める (空に戻したら提案を再開)
  modal.slugEdited = modal.slug.trim() !== "";
  modal.feedback = "";
  modal.feedbackRetry = false;
  checkSlug();
};

const onUrlInput = () => {
  modal.feedback = "";
  modal.feedbackRetry = false;
};

// slug 自動生成初期値の提示 (43 §3.2): local 作成 / remote 登録では title 入力に追随して
// slug 候補を提示し、そのまま可用性チェックを回す。ユーザーが slug を手入力したら追随を止める。
// import はファイル名由来の提案 (openImport) を維持するため対象外
watch(
  () => modal.title,
  (title) => {
    // MAJOR-1: title 編集時は常に古いフィードバック(特に retry 状態)を破棄する
    modal.feedback = "";
    modal.feedbackRetry = false;
    if (modal.mode !== "local" && modal.mode !== "remote") return;
    if (modal.slugEdited) return;
    const suggested = suggestSlug(title);
    if (suggested === modal.slug) return;
    modal.slug = suggested;
    checkSlug();
  }
);

const openCreateLocal = () => {
  resetModal();
  modal.mode = "local";
};

const openRegisterRemote = () => {
  resetModal();
  modal.mode = "remote";
};

const openImport = async () => {
  try {
    const picked = await window.poiSources.pickImportFile();
    if (!picked) return; // canceled
    resetModal();
    modal.mode = "import";
    modal.filePath = picked.filePath;
    modal.fileName = picked.fileName;
    modal.slug = suggestSlug(picked.fileName);
    modal.title = picked.fileName.replace(/\.[^.]+$/, "");
    modal.lang = resolveEditorLanguage(
      await window.poiSources.detectImportLanguage(modal.filePath, modal.lang),
    );
    modal.langEdited = false;
    checkSlug();
  } catch (e) {
    console.error("Failed to pick import file", e);
    // MINOR-5: モーダルが開いていれば feedback で、開いていなければ alert で通知する
    if (modal.mode) {
      modal.feedback = t("poisource.errors.pick_failed");
    } else {
      alert(t("poisource.errors.pick_failed"));
    }
  }
};

// PoiSourceSaveResult を解釈し、成功時はエディタへ遷移、失敗時は modal に feedback を出す
const handleSaveResult = (result: PoiSourceSaveResult): boolean => {
  if ("error" in result) {
    // result.error === 'revision-conflict'
    modal.feedback = t("poisource.errors.revision_conflict");
    return false;
  }
  switch (result.result) {
    case "Success": {
      const uid = result.uid;
      closeModal();
      router.push(`/poisources/${uid}`);
      return true;
    }
    case "Exist":
      modal.feedback = t("poisource.errors.slug_taken");
      return false;
    case "Invalid": {
      const issues = result.issues;
      const errors = issues.filter((i) => i.level === "error");
      modal.feedback = (errors.length ? errors : issues)
        .map((i) => issueMessage(i))
        .join("\n");
      if (!modal.feedback) modal.feedback = t("poisource.errors.invalid");
      return false;
    }
    case "ReadOnly":
      // save 専用の結果 (create/import/register からは到達不能だが型上は網羅する)
      modal.feedback = t("poisource.errors.internal");
      return false;
    case "Error": {
      // code → i18n key の写像は PoiEdit と共用 (utils/poiSourceMessages)。挙動は Phase 3 と同一:
      // network のみ再試行導線、invalid-request/internal は message を優先する
      const code = result.code;
      const key = ERROR_CODE_KEYS[code] ?? "poisource.errors.internal";
      if (code === "network") {
        modal.feedback = t(key);
        modal.feedbackRetry = true;
        return false;
      }
      if (code === "http-status" || code === "parse" || code === "not-found") {
        modal.feedback = t(key);
        return false;
      }
      modal.feedback = result.message || t(key);
      return false;
    }
  }
};

// 検証 issue の人間可読化は PoiEdit と共用 (utils/poiSourceMessages)
const issueMessage = (issue: PoiValidationIssue): string => resolveIssueMessage(issue, t);

const submitModal = async () => {
  // MAJOR-1: canSubmit のみで判定する (feedbackRetry によるバイパスを廃止)
  if (!canSubmit.value) return;
  const slug = modal.slug.trim();
  const title = modal.title.trim();
  modal.submitting = true;
  modal.feedback = "";
  modal.feedbackRetry = false;
  try {
    let result: PoiSourceSaveResult;
    if (modal.mode === "local") {
      result = await window.poiSources.createLocal({ slug, title, lang: modal.lang });
    } else if (modal.mode === "import") {
      result = await window.poiSources.importFile({
        slug, title, filePath: modal.filePath, lang: modal.lang, langOverride: modal.langEdited,
      });
    } else if (modal.mode === "remote") {
      result = await window.poiSources.registerRemote({
        slug, title, url: modal.url.trim(), lang: modal.lang, langOverride: modal.langEdited,
      });
    } else {
      return;
    }
    handleSaveResult(result);
  } catch (e) {
    console.error("Failed to submit POI source", e);
    modal.feedback = t("poisource.errors.internal");
  } finally {
    modal.submitting = false;
  }
};

// Escape: モーダルが開いていて送信中でない場合に閉じる (MapList.vue の同型ハンドラに整合)
const onKeyDown = (e: KeyboardEvent) => {
  if (e.isComposing) return; // IME 変換取り消しの Escape でモーダルが閉じないようにする
  if (e.key !== "Escape") return;
  if (modal.mode && !modal.submitting) {
    closeModal();
  }
};

onMounted(async () => {
  await loadFirst();
  await refreshDrafts();
  window.addEventListener("keydown", onKeyDown);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));
// route.q 変更で再取得（filter generation）
watch(query, () => { void loadFirst(); });
</script>

<style scoped>
.modal {
    background: rgba(0, 0, 0, 0.4);
}
</style>
