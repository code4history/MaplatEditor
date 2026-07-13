<template>
  <div class="container-fluid p-3" @click="hideContextMenu">
    <DraftConflictDialog
      :visible="!!modalDraftLifecycle.conflictDraft.value"
      @discard="modalDraftLifecycle.resolveConflict('discard')"
      @apply="modalDraftLifecycle.resolveConflict('apply')"
    />
    <!-- Controls Row -->
    <div class="row mb-3 gx-2 align-items-center">
      <div class="col-auto">
        <button class="btn btn-light border shadow-sm px-4" @click="openAdd">
          {{ t("assetlist.add_image") }}
          <span v-if="newDrafts.length" class="badge bg-warning text-dark ms-1">{{ t('editor_ui.draft_badge') }}</span>
        </button>
      </div>
      <div class="col">
        <input
          type="text"
          class="form-control shadow-sm"
          :placeholder="t('assetlist.search_placeholder')"
          v-model="searchQuery"
          @input="handleSearch"
        />
      </div>
      <!-- 件数表示 -->
      <div class="col-auto text-muted">
        {{ t("assetlist.count_label", { num: items.length }) }}
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-3">
      {{ t("assetlist.loading") }}
    </div>

    <!-- Error -->
    <div v-else-if="error" class="alert alert-danger">
      {{ error }}
    </div>

    <!-- Empty -->
    <div v-else-if="items.length === 0" class="text-muted text-center py-3">
      {{ t("assetlist.no_assets_found") }}
    </div>

    <!-- Asset Grid (PoiSourceList のカードグリッド同型 + サムネイル) -->
    <div v-else class="d-flex flex-wrap justify-content-start align-items-start gap-4" style="padding-left: 5px;">
      <div v-for="asset in items" :key="asset.uid" class="asset-card-wrapper">
        <!-- アセットに詳細画面はないため、左クリックでも操作メニュー (rename/delete) を開く -->
        <div
          class="asset-card-inner"
          @click.stop="openContextMenu($event, asset)"
          @contextmenu.prevent="openContextMenu($event, asset)"
        >
          <div class="thumb-box">
            <img
              :src="thumbUrls[asset.uid] || noImage"
              loading="lazy"
              class="thumb-img"
              :alt="localizeAssetTitle(asset)"
              @error="onThumbError(asset.uid)"
            />
          </div>
          <div class="card-body py-2 px-3">
            <p class="mb-1 fw-medium text-break" style="font-size: 14px;">{{ localizeAssetTitle(asset) }}</p>
            <span v-if="hasDraft(asset.uid)" class="badge bg-warning text-dark">{{ t('editor_ui.draft_badge') }}</span>
            <small class="text-muted d-block text-break">{{ asset.slug }}</small>
            <small class="text-muted d-block">{{ formatMeta(asset) }}</small>
          </div>
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
        <a class="dropdown-item" href="#" @click.prevent="openRename">
          {{ t("assetlist.rename_item") }}
        </a>
      </li>
      <li>
        <a class="dropdown-item text-danger" href="#" @click.prevent="deleteAsset">
          {{ t("assetlist.delete_item") }}
        </a>
      </li>
    </ul>

    <!-- Add / Rename Modal (PoiSourceList の shared form 同型) -->
    <div v-if="modal.mode" class="modal show d-block" tabindex="-1" @click.self="closeModal">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ modalTitle }}</h5>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>
          <div class="modal-body">
            <!-- Add: picked file path (read-only display) -->
            <div v-if="modal.mode === 'add'" class="mb-3">
              <label class="form-label">{{ t("assetlist.add_modal.file_label") }}</label>
              <input
                type="text"
                class="form-control"
                :value="modal.fileName"
                readonly
              />
            </div>

            <!-- slug -->
            <label class="form-label">{{ t("assetlist.slug_label") }}</label>
            <input
              type="text"
              class="form-control"
              :class="{ 'is-invalid': slugError, 'is-valid': slugChecked && !slugError }"
              v-model="modal.slug"
              :placeholder="t('assetlist.slug_placeholder')"
              @input="onSlugInput"
            />
            <div v-if="slugError" class="invalid-feedback d-block">{{ slugError }}</div>

            <!-- title -->
            <label class="form-label mt-3">{{ t("assetlist.title_label") }}</label>
            <input
              type="text"
              class="form-control"
              v-model="modal.title"
              :placeholder="t('assetlist.title_placeholder')"
            />

            <!-- Feedback (error-code messages) -->
            <div v-if="modal.feedback" class="alert alert-danger mt-3 mb-0">
              <div style="white-space: pre-line;">{{ modal.feedback }}</div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeModal">
              {{ t("assetlist.cancel") }}
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
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import noImage from "../assets/img/no_image.png";
import DraftConflictDialog from "../components/editor-ui/DraftConflictDialog.vue";
import { localizeTitle as resolveLocalizedTitle } from "../utils/langResource";
import { resolveEditorLanguage, type LangCode } from "../utils/editorLanguages";
import { useAssetThumbnails } from "../composables/useAssetThumbnails";
import { useAssetDraftBadges } from "../composables/useAssetDraftBadges";
import { useAssetDraftLifecycle } from "../composables/useAssetDraftLifecycle";
import type {
  ImageAssetRow,
  ImageAssetSaveResult,
  ImageAssetReference,
} from "../electron";

const { t } = useTranslation();
const { hasDraft, draftSummaries, refreshDrafts } = useAssetDraftBadges('image-asset');
const newDrafts = computed(() => draftSummaries.value.filter((draft) => draft.baseRevision === null));

const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

// LangResource 内部形 {lang: text} → 表示テキスト (現在言語 → ja → en → 任意 → slug)
const localizeAssetTitle = (row: ImageAssetRow): string =>
  resolveLocalizedTitle(row.title, i18next.language) || row.slug;

// 寸法 / mime のメタ表示 (decode 不能画像は width/height が null)
const formatMeta = (row: ImageAssetRow): string => {
  const dims = row.width !== null && row.height !== null ? `${row.width}×${row.height} · ` : "";
  return `${dims}${row.mime}`;
};

// --- 一覧 (search + サムネイル)。実装は AssetPicker と共用の composable へ抽出
// (Phase 6 Task 4。token ガード / getFilePath 並行解決 / noImage フォールバックは不変) ---
const { items, loading, error, searchQuery, thumbUrls, loadAssets, onThumbError } =
  useAssetThumbnails();

const handleSearch = () => {
  loadAssets();
};

// --- Context menu (rename / delete) ---
const contextMenu = reactive({ visible: false, x: 0, y: 0, title: "" });
const contextRow = ref<ImageAssetRow | null>(null);

const openContextMenu = (event: MouseEvent, asset: ImageAssetRow) => {
  contextMenu.visible = true;
  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.title = localizeAssetTitle(asset);
  contextRow.value = asset;
};

const hideContextMenu = () => {
  contextMenu.visible = false;
};

// --- 削除 (AID-006 / BM-121-A 同型): 参照 poi_source を確認ダイアログに列挙してから削除。
// 参照ありでも削除自体は可能 (POI 側は未解決 asset として picker の解釈表示が警告する) ---
const deleteAsset = async () => {
  const row = contextRow.value;
  hideContextMenu();
  if (!row) return;
  const title = localizeAssetTitle(row);
  let references: ImageAssetReference[] = [];
  let referencesUnavailable = false;
  try {
    const result = await window.imageAssets.findReferences(row.uid);
    references = result.poiSources;
  } catch (e) {
    console.error("Failed to resolve image asset references", e);
    // findReferences 失敗時は「参照情報を取得できませんでした」を添えて続行 (Phase 3 同型)
    referencesUnavailable = true;
  }
  let message = t("assetlist.delete_confirm", { name: title });
  if (referencesUnavailable) {
    message += "\n\n" + t("assetlist.errors.references_unavailable");
  } else if (references.length > 0) {
    message +=
      "\n\n" +
      t("assetlist.delete_referenced", { num: references.length }) +
      "\n" +
      references
        .map((r) => `- ${r.slug}: ${resolveLocalizedTitle(r.title, i18next.language) || r.slug}`)
        .join("\n");
  }
  if (!confirm(message)) return;
  try {
    await window.imageAssets.delete(row.uid);
    await window.assetDrafts.remove('image-asset', row.uid);
    await loadAssets();
  } catch (e) {
    console.error("Failed to delete image asset", e);
    alert(t("assetlist.delete_error"));
  }
};

// --- Shared modal (add / rename)。PoiSourceList の shared form と同じ流儀 ---
type ModalMode = "add" | "rename" | null;
const modal = reactive({
  mode: null as ModalMode,
  slug: "",
  title: "",
  sourcePath: "",
  fileName: "",
  lang: "ja" as LangCode,
  feedback: "",
  submitting: false,
  // slug 欄をユーザーが手入力したら true。以後 title からの自動提案で上書きしない
  slugEdited: false,
  // rename 対象
  uid: "",
  expectedRevision: 0,
});
// rename 時に他言語エントリを保持するため、編集前の title 内部形を控えておく
let renameOriginalTitle: Record<string, string> = {};
interface ImageAssetMetadataDraft {
  slug: string;
  title: string;
  originalTitle: Record<string, string>;
}
const modalDraftReady = ref(false);
const modalDraftLifecycle = useAssetDraftLifecycle<ImageAssetMetadataDraft>({
  kind: 'image-asset',
  serialize: () => ({
    slug: modal.slug,
    title: modal.title,
    originalTitle: { ...renameOriginalTitle },
  }),
  apply: (payload) => {
    modal.slug = payload.slug;
    modal.title = payload.title;
    renameOriginalTitle = { ...payload.originalTitle };
  },
});

const slugChecked = ref(false);
const slugAvailable = ref(false);
let slugCheckToken = 0;

const slugError = computed<string | null>(() => {
  const slug = modal.slug.trim();
  if (!slug) return null;
  if (!SLUG_PATTERN.test(slug)) return t("assetlist.errors.slug_charset");
  if (slugChecked.value && !slugAvailable.value) return t("assetlist.errors.slug_taken");
  return null;
});

const modalTitle = computed(() => {
  if (modal.mode === "add") return t("assetlist.add_modal.title");
  if (modal.mode === "rename") return t("assetlist.rename_modal.title");
  return "";
});

const submitLabel = computed(() => {
  if (modal.mode === "add") return t("assetlist.add_modal.add");
  if (modal.mode === "rename") return t("assetlist.rename_modal.save");
  return "";
});

const canSubmit = computed(() => {
  if (modal.submitting) return false;
  const slug = modal.slug.trim();
  if (!slug || !SLUG_PATTERN.test(slug)) return false;
  if (slugChecked.value && !slugAvailable.value) return false;
  if (!modal.title.trim()) return false;
  if (modal.mode === "add" && !modal.sourcePath) return false;
  return true;
});

const resetModal = () => {
  modal.slug = "";
  modal.title = "";
  modal.sourcePath = "";
  modal.fileName = "";
  modal.lang = resolveEditorLanguage(i18next.language);
  modal.feedback = "";
  modal.submitting = false;
  modal.slugEdited = false;
  modal.uid = "";
  modal.expectedRevision = 0;
  renameOriginalTitle = {};
  slugChecked.value = false;
  slugAvailable.value = false;
  // in-flight の slug チェック応答を無効化 (Phase 3 MINOR-1)
  slugCheckToken++;
};

const closeModal = async () => {
  if (modalDraftReady.value) await modalDraftLifecycle.flush();
  modalDraftReady.value = false;
  modal.mode = null;
  resetModal();
};

// slug 自動生成 (ファイル名 → [A-Za-z0-9_-])。可用性チェックは checkSlug に委ねる
const suggestSlug = (base: string): string =>
  base
    .normalize("NFKD")
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const checkSlug = async () => {
  // early-return する場合でも in-flight の旧応答を無効化しておく (Phase 3 MINOR-1)
  const token = ++slugCheckToken;
  const slug = modal.slug.trim();
  slugChecked.value = false;
  slugAvailable.value = false;
  if (!slug || !SLUG_PATTERN.test(slug)) return;
  try {
    // rename では自分自身の slug を「使用中」と誤判定しないよう excludeUid を渡す
    const available = await window.assets.checkSlug({
      slug,
      excludeUid: modal.mode === "rename" ? modal.uid : undefined,
    });
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

// add では title 入力に追随して slug 候補を提示する (PoiSourceList の watch 同型)。
// rename は既存 slug を保持するため対象外
watch(
  () => modal.title,
  (title) => {
    modal.feedback = "";
    if (modal.mode !== "add") return;
    if (modal.slugEdited) return;
    const suggested = suggestSlug(title);
    if (suggested === modal.slug) return;
    modal.slug = suggested;
    checkSlug();
  }
);

const openAdd = async () => {
  try {
    modalDraftReady.value = false;
    const pendingDraft = newDrafts.value.at(-1);
    const picked = await window.imageAssets.pickImageFile();
    if (!picked) return; // canceled
    resetModal();
    modal.mode = "add";
    modal.sourcePath = picked.filePath;
    modal.fileName = picked.fileName;
    modal.lang = resolveEditorLanguage(i18next.language);
    modal.slug = suggestSlug(picked.fileName);
    modal.title = picked.fileName.replace(/\.[^.]+$/, "");
    await modalDraftLifecycle.open(pendingDraft?.assetUid ?? crypto.randomUUID(), null);
    modalDraftReady.value = true;
    checkSlug();
  } catch (e) {
    console.error("Failed to pick image file", e);
    // Phase 3 MINOR-5: モーダルが開いていれば feedback で、開いていなければ alert で通知する
    if (modal.mode) {
      modal.feedback = t("assetlist.errors.pick_failed");
    } else {
      alert(t("assetlist.errors.pick_failed"));
    }
  }
};

const openRename = async () => {
  const row = contextRow.value;
  hideContextMenu();
  if (!row) return;
  resetModal();
  modal.mode = "rename";
  modal.uid = row.uid;
  modal.expectedRevision = row.revision;
  modal.lang = row.lang as LangCode;
  modal.slug = row.slug;
  modal.title = localizeAssetTitle(row);
  // rename では slug の自動提案追随をしない (既存 slug の維持が既定)
  modal.slugEdited = true;
  renameOriginalTitle = { ...row.title };
  checkSlug();
  await modalDraftLifecycle.open(row.uid, row.revision);
  modalDraftReady.value = true;
};

watch(
  () => [modal.slug, modal.title],
  () => {
    if (modal.mode && modalDraftReady.value) modalDraftLifecycle.schedule(true);
  },
  { flush: 'post' },
);

// localizeTitle の解決優先順位 (現在言語 → basename → ja → en → 任意) と同じ順序で
// 「表示に使われた言語キー」を求める。rename の編集値はこのキーへ書き戻し、他言語は保持する
const resolveTitleKey = (title: Record<string, string>, lang: string): string => {
  if (title[lang]) return lang;
  const base = lang?.split("-")[0];
  if (base && title[base]) return base;
  if (title.ja) return "ja";
  if (title.en) return "en";
  const first = Object.keys(title).find((k) => title[k]);
  return first ?? base ?? lang ?? "ja";
};

// ImageAssetSaveResult を解釈する。add / rename 共通 (Phase 3 handleSaveResult と同じ流儀)
const handleSaveResult = async (result: ImageAssetSaveResult): Promise<void> => {
  if ("error" in result) {
    // result.error === 'revision-conflict' (rename の楽観ロック衝突)。
    // 「読み直す/上書き」の選択 UI までは作らず、他で更新済みの旨を表示して一覧再読込に
    // 留める — rename は slug/title のみで再読込後にすぐやり直せるため、一覧画面の
    // 軽量版としてはこれで妥当 (計画書 Task 3 の判断)
    closeModal();
    await loadAssets();
    alert(t("assetlist.errors.revision_conflict"));
    return;
  }
  switch (result.result) {
    case "Success":
      await modalDraftLifecycle.markSaved();
      modalDraftReady.value = false;
      await closeModal();
      await loadAssets();
      await refreshDrafts();
      return;
    case "Exist":
      modal.feedback = t("assetlist.errors.slug_taken");
      return;
    case "Error": {
      // code 別文言 (poiSourceMessages の写像パターンと同じ流儀)。message には service 由来の
      // 機械可読識別子が入ることがあり、payload-too-large (20MB 超 / 1億px 超) は専用文言
      let message: string;
      if (result.message === "payload-too-large") {
        message = t("assetlist.errors.payload_too_large");
      } else {
        switch (result.code) {
          case "not-found":
            message = t("assetlist.errors.not_found");
            break;
          case "invalid-request":
            message = t("assetlist.errors.invalid");
            break;
          case "internal":
            message = t("assetlist.errors.internal");
            break;
        }
      }
      // add 失敗の回復導線 (Phase 2 引き継ぎ③の最小対応): ファイル確認 → 再追加を案内
      modal.feedback =
        modal.mode === "add" ? `${message}\n${t("assetlist.errors.add_failed_hint")}` : message;
      return;
    }
  }
};

const submitModal = async () => {
  if (!canSubmit.value) return; // canSubmit ゲートのみで判定 (Phase 3 MAJOR-1 同型)
  const slug = modal.slug.trim();
  const title = modal.title.trim();
  modal.submitting = true;
  modal.feedback = "";
  try {
    let result: ImageAssetSaveResult;
    if (modal.mode === "add") {
      result = await window.imageAssets.add({
        slug,
        title,
        lang: modal.lang,
        sourceName: modal.fileName,
        sourcePath: modal.sourcePath,
      });
    } else if (modal.mode === "rename") {
      // 表示言語のエントリのみ書き換え、他言語エントリは保持する (LangResource 内部形)
      const key = resolveTitleKey(renameOriginalTitle, i18next.language);
      const mergedTitle = { ...renameOriginalTitle, [key]: title };
      result = await window.imageAssets.updateMetadata(modal.uid, {
        slug,
        title: mergedTitle,
        lang: modal.lang,
        expectedRevision: modal.expectedRevision,
      });
    } else {
      return;
    }
    await handleSaveResult(result);
  } catch (e) {
    console.error("Failed to submit image asset", e);
    modal.feedback = t("assetlist.errors.internal");
  } finally {
    modal.submitting = false;
  }
};

// Escape: コンテキストメニューが開いていれば閉じる。開いていなければ、モーダルが
// 開いていて送信中でない場合に閉じる (Phase 3 MINOR-8 / PoiSourceList の同型ハンドラ)
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
  loadAssets();
  refreshDrafts();
  window.addEventListener("keydown", onKeyDown);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));
</script>

<style scoped>
.asset-card-wrapper {
    width: 240px;
    background: transparent;
    flex-shrink: 0;
}
.asset-card-inner {
    background: #fff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    border: 1px solid rgba(0,0,0,0.1);
    border-radius: 4px;
    padding: 4px;
    transition: box-shadow 0.2s;
    width: 100%;
    cursor: pointer;
}
.asset-card-inner:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}
.thumb-box {
    height: 140px;
    background: #f8f9fa;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 3px;
}
.thumb-img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
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
