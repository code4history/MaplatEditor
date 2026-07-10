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
      <div class="col-auto">
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
                <span
                  v-if="hasValidationState(source)"
                  class="badge"
                  :class="{
                    'bg-success': validationStateOf(source) === 'ready',
                    'bg-warning': validationStateOf(source) === 'warning',
                    'bg-danger': validationStateOf(source) === 'invalid'
                  }"
                >
                  {{ t(`poisource.validation.${validationStateOf(source)}`) }}
                </span>
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
import { ref, reactive, computed, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import { usePoiSourceList, type PoiSourceListRow } from "../composables/usePoiSourceList";

const { t } = useTranslation();
const router = useRouter();

const {
  items,
  loading,
  error,
  searchQuery,
  hasNext,
  hasPrev,
  loadSources,
  search,
  nextPage,
  prevPage,
} = usePoiSourceList();

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

// LangResource 内部形 {lang: text} → 表示テキスト (現在言語 → ja → en → 任意 → slug)
const localizeTitle = (row: PoiSourceListRow): string => {
  const title = row.title as Record<string, string> | string | null | undefined;
  if (typeof title === "string") return title || row.slug;
  if (title && typeof title === "object") {
    const lang = i18next.language;
    const picked =
      title[lang] ||
      title[lang?.split("-")[0]] ||
      title.ja ||
      title.en ||
      Object.values(title).find((v) => typeof v === "string" && v !== "");
    if (picked) return picked;
  }
  return row.slug;
};

// 一覧行が validation 状態を持つ場合のみバッジ表示 (PoiSourceListRow は現状 status を持たないため
// 将来の拡張に備えた任意フィールド読み取り。持たない行はバッジ非表示)
const hasValidationState = (row: PoiSourceListRow): boolean =>
  typeof (row as any).validationState === "string";
const validationStateOf = (row: PoiSourceListRow): string =>
  String((row as any).validationState ?? "ready");

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
  let references: Array<{ kind: "map" | "app"; slug: string }> = [];
  try {
    references = await window.poiSources.findReferences(uid);
  } catch (e) {
    console.error("Failed to resolve POI source references", e);
  }
  let message = t("poisource.delete_confirm", { name: title });
  if (references.length > 0) {
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
    await loadSources();
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
  const slug = modal.slug.trim();
  slugChecked.value = false;
  slugAvailable.value = false;
  if (!slug || !SLUG_PATTERN.test(slug)) return;
  const token = ++slugCheckToken;
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
  checkSlug();
};

// slug 自動生成初期値の提示 (43 §3.2): local 作成 / remote 登録では title 入力に追随して
// slug 候補を提示し、そのまま可用性チェックを回す。ユーザーが slug を手入力したら追随を止める。
// import はファイル名由来の提案 (openImport) を維持するため対象外
watch(
  () => modal.title,
  (title) => {
    if (modal.mode !== "local" && modal.mode !== "remote") return;
    if (modal.slugEdited) return;
    const suggested = suggestSlug(title);
    if (suggested === modal.slug) return;
    modal.slug = suggested;
    modal.feedback = "";
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
  }
};

// PoiSourceSaveResult を解釈し、成功時はエディタへ遷移、失敗時は modal に feedback を出す
const handleSaveResult = (result: any): boolean => {
  if (result && result.result === "Success") {
    const uid = result.uid;
    closeModal();
    router.push(`/poisources/${uid}`);
    return true;
  }
  if (result && result.result === "Exist") {
    modal.feedback = t("poisource.errors.slug_taken");
    return false;
  }
  if (result && result.result === "Invalid") {
    const issues = Array.isArray(result.issues) ? result.issues : [];
    const errors = issues.filter((i: any) => i.level === "error");
    modal.feedback = (errors.length ? errors : issues)
      .map((i: any) => issueMessage(i))
      .join("\n");
    if (!modal.feedback) modal.feedback = t("poisource.errors.invalid");
    return false;
  }
  if (result && result.error === "revision-conflict") {
    modal.feedback = t("poisource.errors.revision_conflict");
    return false;
  }
  if (result && result.result === "Error") {
    const code = result.code as string;
    if (code === "network") {
      modal.feedback = t("poisource.errors.network");
      modal.feedbackRetry = true;
      return false;
    }
    if (code === "http-status") {
      modal.feedback = t("poisource.errors.http_status");
      return false;
    }
    if (code === "parse") {
      modal.feedback = t("poisource.errors.parse");
      return false;
    }
    if (code === "not-found") {
      modal.feedback = t("poisource.errors.not_found");
      return false;
    }
    if (code === "invalid-request") {
      modal.feedback = result.message || t("poisource.errors.invalid");
      return false;
    }
    modal.feedback = result.message || t("poisource.errors.internal");
    return false;
  }
  modal.feedback = t("poisource.errors.internal");
  return false;
};

// poiGeoJson.ts の検証 code → i18n key の写像。非 Point (geometry-not-point) は POI-104 専用文言。
const ISSUE_CODE_KEYS: Record<string, string> = {
  "geometry-not-point": "poisource.errors.non_point",
  "not-feature-collection": "poisource.errors.not_feature_collection",
  "coord-range": "poisource.errors.coord_range",
  "name-required": "poisource.errors.name_required",
  "display-id-duplicate": "poisource.errors.display_id_duplicate",
  "display-id-charset": "poisource.errors.display_id_charset",
  "no-content": "poisource.errors.no_content",
  "scale-feature-count": "poisource.errors.scale_feature_count",
  "scale-byte-size": "poisource.errors.scale_byte_size",
};

// 検証 issue を人間可読に。既知 code は専用文言、未知は code/message をそのまま出す
const issueMessage = (issue: any): string => {
  const key = ISSUE_CODE_KEYS[issue.code];
  const base = key ? t(key) : issue.message || issue.code || t("poisource.errors.invalid");
  return issue.featureId ? `${issue.featureId}: ${base}` : base;
};

const submitModal = async () => {
  if (!canSubmit.value && !modal.feedbackRetry) return;
  const slug = modal.slug.trim();
  const title = modal.title.trim();
  modal.submitting = true;
  modal.feedback = "";
  modal.feedbackRetry = false;
  try {
    let result: any;
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

onMounted(() => {
  loadSources(1);
});
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
