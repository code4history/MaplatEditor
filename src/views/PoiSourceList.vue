<template>
  <div class="container-fluid p-3" @click="hideContextMenu">
    <!-- Controls Row -->
    <div class="row mb-3 gx-2 align-items-center">
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="openCreateLocal">
          {{ t("poisource.create_local") }}
        </button>
      </div>
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="openImport">
          {{ t("poisource.import_file") }}
        </button>
      </div>
      <!-- リモート登録はユーザー決定 (2026-07-11) により UI 抑制中: 望む形式のリモートデータが
           実在せず、htmlTemplate 対応 (POI-007/109) までは実用にならないため。backend の
           registerRemote/refreshRemote/ReadOnly/cloneToLocal ロジックは温存 (フラグで再表示可) -->
      <div v-if="REMOTE_POI_REGISTRATION_ENABLED" class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="openRegisterRemote">
          {{ t("poisource.register_remote") }}
        </button>
      </div>
      <div class="col">
        <input
          type="text"
          class="form-control shadow-sm"
          :placeholder="t('poisource.search_placeholder')"
          v-model="searchQuery"
          @input="handleSearch"
        />
      </div>
      <div class="col-auto">
        <div class="btn-group shadow-sm" role="group">
          <button class="btn btn-light border" :disabled="!hasPrev" @click="prevPage">&lt;</button>
          <button class="btn btn-light border" :disabled="!hasNext" @click="nextPage">&gt;</button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("poisource.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <!-- Empty -->
    <div v-else-if="items.length === 0" class="text-muted text-center py-3">
      {{ t("poisource.no_sources_found") }}
    </div>

    <!-- Source Grid -->
    <div v-else class="d-flex flex-wrap justify-content-start align-items-start gap-4" style="padding-left: 5px;">
      <div v-for="source in items" :key="source.uid" class="source-card-wrapper">
        <div class="source-card-inner">
          <router-link
            :to="`/poisources/${source.uid}`"
            class="text-decoration-none text-dark d-block"
            @contextmenu.prevent="openContextMenu($event, source)"
          >
            <div class="card-body py-2 px-3">
              <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                <span class="badge" :class="source.mode === 'local' ? 'bg-primary' : 'bg-info'">
                  {{ source.mode === 'local' ? t("poisource.local") : t("poisource.remote") }}
                </span>
                <span v-if="hasDraft(source.uid)" class="badge bg-warning text-dark">{{ t('editor_ui.draft_badge') }}</span>
              </div>
              <p class="mb-1 fw-medium text-break" style="font-size: 14px;">{{ localizeTitle(source) }}</p>
              <small class="text-muted d-block text-break">{{ source.slug }}</small>
              <small class="text-muted d-block">{{ source.featureCount }} {{ t("poisource.features") }}</small>
            </div>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <ul
      v-if="contextMenu.visible"
      class="dropdown-menu show ctx-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
    >
      <li class="dropdown-header">{{ contextMenu.title }}</li>
      <li>
        <a class="dropdown-item text-danger" href="#" @click.prevent="deleteSource">
          {{ t("poisource.delete_item") }}
        </a>
      </li>
    </ul>

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
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import { usePoiSourceList, type PoiSourceListRow } from "../composables/usePoiSourceList";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { localizeTitle as resolveLocalizedTitle } from "../utils/langResource";
import { ERROR_CODE_KEYS, issueMessage as resolveIssueMessage } from "../utils/poiSourceMessages";
import type {
  PoiSourceSaveResult,
  PoiValidationIssue,
  PoiSourceReference,
} from "../electron";

const { t } = useTranslation();
const router = useRouter();
const { hasDraft, refreshDrafts } = useAssetDraftBadges('poi');

// リモート登録 UI の抑制フラグ (ユーザー決定 2026-07-11)。望む形式のリモート POI データが
// 実在せず、htmlTemplate 対応 (POI-007/109) までは実用にならないため UI のみ隠す。
// backend (registerRemote/refreshRemote/ReadOnly/cloneToLocal) は温存 — true に戻せば復活する
const REMOTE_POI_REGISTRATION_ENABLED = false;

const {
  items,
  loading,
  error,
  searchQuery,
  currentPage,
  hasNext,
  hasPrev,
  loadSources,
  search,
  nextPage,
  prevPage,
} = usePoiSourceList();

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

// LangResource 内部形 {lang: text} → 表示テキスト (現在言語 → ja → en → 任意 → slug)
const localizeTitle = (row: PoiSourceListRow): string =>
  resolveLocalizedTitle(row.title, i18next.language) || row.slug;

// --- Context menu / delete ---
const contextMenu = reactive({ visible: false, x: 0, y: 0, uid: "", title: "" });

const openContextMenu = (event: MouseEvent, source: PoiSourceListRow) => {
  contextMenu.visible = true;
  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.uid = source.uid;
  contextMenu.title = localizeTitle(source);
};

const hideContextMenu = () => {
  contextMenu.visible = false;
};

const deleteSource = async () => {
  const { uid, title } = contextMenu;
  hideContextMenu();
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
    // 削除前の状態でページ末尾の最後の1件かどうかを判定し、削除後に空ページへ残らないようにする
    const wasLastItemOnPage = items.value.length === 1 && hasPrev.value;
    await window.poiSources.delete(uid);
    await window.assetDrafts.remove('poi', uid);
    if (wasLastItemOnPage) {
      await loadSources(currentPage.value - 1);
    } else {
      await loadSources(currentPage.value);
    }
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
      result = await window.poiSources.createLocal({ slug, title });
    } else if (modal.mode === "import") {
      result = await window.poiSources.importFile({ slug, title, filePath: modal.filePath });
    } else if (modal.mode === "remote") {
      result = await window.poiSources.registerRemote({ slug, title, url: modal.url.trim() });
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

const handleSearch = () => {
  search(searchQuery.value);
};

// Escape: コンテキストメニューが開いていれば閉じる。開いていなければ、モーダルが
// 開いていて送信中でない場合に閉じる (MapList.vue の同型ハンドラに整合)
const onKeyDown = (e: KeyboardEvent) => {
  if (e.isComposing) return; // IME 変換取り消しの Escape でモーダルが閉じないようにする
  if (e.key !== "Escape") return;
  if (contextMenu.visible) {
    hideContextMenu();
    return;
  }
  if (modal.mode && !modal.submitting) {
    closeModal();
  }
};

onMounted(() => {
  loadSources(1);
  refreshDrafts();
  window.addEventListener("keydown", onKeyDown);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));
</script>

<style scoped>
.source-card-wrapper {
    width: 240px;
    background: transparent;
    flex-shrink: 0;
}
.source-card-inner {
    background: #fff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 4px;
    padding: 4px;
    transition: box-shadow 0.2s;
    width: 100%;
}
.source-card-inner:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}
.ctx-menu {
    position: fixed;
    z-index: 9999;
    min-width: 160px;
}
.modal {
    background: rgba(0, 0, 0, 0.4);
}
</style>
