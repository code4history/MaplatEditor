<template>
  <div class="d-flex flex-column h-100 text-start">
    <!-- Loading -->
    <div v-if="loading" class="text-muted text-center py-4">
      {{ t("poisource.loading") }}
    </div>

    <!-- Load error (not found 等): エラー表示 + 一覧へ戻る導線 -->
    <div v-else-if="loadError" class="p-4">
      <div class="alert alert-danger">{{ loadError }}</div>
      <button type="button" class="btn btn-outline-secondary" @click="router.push('/poisources')">
        {{ t("common.back") }}
      </button>
    </div>

    <template v-else-if="editState">
      <!-- Header: 戻る / title / slug / Undo/Redo / 保存 -->
      <div class="px-4 py-2 flex-shrink-0 bg-white border-bottom">
        <div class="row w-100 align-items-start g-2">
          <div class="col-4 d-flex align-items-start gap-2">
            <h4 class="mb-0 pt-3">
              <a href="#" class="text-decoration-none" @click.prevent="goBack">&lt;&lt;</a>
            </h4>
            <div class="flex-grow-1">
              <label class="form-label fw-bold small mb-0">{{ t("poisource.title_label") }}</label>
              <!-- title 変更は session.commit 経由 = 1 Undo 単位 (仕様 §5) -->
              <LangResourceInput
                v-if="!readOnly"
                :model-value="editState.title"
                @update:model-value="onTitleUpdate"
              />
              <div v-else class="form-control-plaintext py-0">{{ displayTitle }}</div>
            </div>
          </div>
          <div class="col-3">
            <label class="form-label fw-bold small mb-0">{{ t("poisource.slug_label") }}</label>
            <input
              v-model="slugInput"
              type="text"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': !!slugError }"
              :disabled="readOnly"
              @input="onSlugInput"
              @change="onSlugChange"
            />
            <div v-if="slugError" class="form-text small text-danger mb-0">{{ slugError }}</div>
            <div
              v-else-if="slugChecked && slugAvailable && slugInput.trim() !== confirmedSlug"
              class="form-text small text-success mb-0"
            >
              {{ t("poiedit.slug_available") }}
            </div>
          </div>
          <div class="col-2 pt-4 text-muted small">
            {{ featureCount }} {{ t("poisource.features") }}
          </div>
          <div class="col-3 pt-3 d-flex gap-1 justify-content-end">
            <template v-if="!readOnly">
              <button
                type="button"
                class="btn btn-outline-secondary"
                :disabled="!canUndo"
                @click="performUndo"
              >
                {{ t("menu.undo") }}
              </button>
              <button
                type="button"
                class="btn btn-outline-secondary"
                :disabled="!canRedo"
                @click="performRedo"
              >
                {{ t("menu.redo") }}
              </button>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="!isDirty || saving"
                @click="saveSource"
              >
                {{ t("common.save") }}
              </button>
            </template>
            <!-- ReadOnly (remote): 編集の代わりに「ローカルへ複製」導線 (Phase 3 cloneToLocal) -->
            <button
              v-else
              type="button"
              class="btn btn-primary"
              :disabled="cloning"
              @click="cloneSourceToLocal"
            >
              {{ t("poiedit.clone_to_local") }}
            </button>
          </div>
        </div>
      </div>

      <!-- 診断領域 -->
      <div class="px-4 py-2 flex-grow-1 overflow-auto">
        <div v-if="readOnly" class="alert alert-info">
          {{ t("poiedit.read_only_notice") }}
        </div>
        <div v-if="saveError" class="alert alert-danger alert-dismissible">
          {{ saveError }}
          <button type="button" class="btn-close" @click="saveError = null"></button>
        </div>
        <!-- 保存 Invalid の issues 一覧 -->
        <div v-if="saveIssues.length" class="alert alert-danger">
          <div class="fw-bold">{{ t("poiedit.save_issues") }}</div>
          <ul class="mb-0">
            <li v-for="(issue, index) in saveIssues" :key="index">{{ issueMessage(issue, t) }}</li>
          </ul>
        </div>
        <!-- POI-108 無コンテンツ警告 / POI-121 規模警告 -->
        <div v-for="key in liveWarnings" :key="key" class="alert alert-warning">
          {{ t(key) }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// POI エディタ骨格 (Phase 4 Task 5, 仕様 43 §3.3/§5/§6)。
// 地図ペイン (Task 6) / 属性フォーム (Task 7) / feature 一覧 (Task 8) はこの時点では未マウント。
// 保存は useRevisionedAssetSave (revision 楽観ロック、ADR-0007)、編集は usePoiEditSession
// (明示 commit = 1 Undo 単位) に委譲する。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import LangResourceInput from "../components/LangResourceInput.vue";
import { usePoiEditSession } from "../composables/usePoiEditSession";
import { useRevisionedAssetSave } from "../composables/useRevisionedAssetSave";
import { localizeTitle } from "../utils/langResource";
import { validateFeatureCollection, type PoiEditorFC } from "../utils/poiGeoJson";
import { ERROR_CODE_KEYS, issueMessage } from "../utils/poiSourceMessages";
import type { PoiSourceSaveResult, PoiValidationIssue } from "../electron";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();

const session = usePoiEditSession();
const { state: editState, isDirty, canUndo, canRedo } = session;

const loading = ref(true);
const loadError = ref<string | null>(null);
const readOnly = ref(false);
const saveError = ref<string | null>(null);
const saveIssues = ref<PoiValidationIssue[]>([]);
const cloning = ref(false);

// --- slug 入力 (checkSlug excludeUid + 一意性表示、AppEdit/PoiSourceList と同 UX) ---
const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;
const slugInput = ref("");
const slugChecked = ref(false);
const slugAvailable = ref(false);
let slugCheckToken = 0;

// --- 保存フロー (revision 楽観ロック → conflict は composable が担う) ---
const saveHandle = useRevisionedAssetSave<PoiSourceSaveResult>({
  send: async ({ uid, expectedRevision }) => {
    // adoptLoaded 後にしか到達しない (保存 UI は editState 確定後のみ表示)
    const state = editState.value!;
    // IPC 前に JSON ラウンドトリップ (AppEdit と同様、非 clone 可能値の混入防止)
    const payload = JSON.parse(
      JSON.stringify({ slug: state.slug, title: state.title, fc: session.toSaveFc() }),
    ) as { slug: string; title: Record<string, string> | string; fc: PoiEditorFC };
    const result = await window.poiSources.save(uid!, { ...payload, expectedRevision });
    if (!result) {
      // IPC が結果を返さなかった: 表示のみで安全終了
      saveError.value = t("poiedit.error_saving");
      return null;
    }
    return result;
  },
  applySuccess: async (result) => {
    // uid/revision/confirmedSlug は composable が反映済み。以下は画面固有処理
    session.markSaved();
    saveIssues.value = [];
    saveError.value = null;
    // slug 欄を保存結果 (confirmedSlug) に同期
    slugInput.value = result.slug;
    slugChecked.value = false;
    slugAvailable.value = false;
    slugCheckToken++;
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
      // 保存レースで slug を先取りされた: 重複表示 + 一意性再チェックを要求
      slugChecked.value = true;
      slugAvailable.value = false;
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

const displayTitle = computed(() => {
  const state = editState.value;
  if (!state) return "";
  return localizeTitle(state.title, i18next.language) || state.slug;
});

const featureCount = computed(() => editState.value?.features.length ?? 0);

const slugError = computed<string | null>(() => {
  const slug = slugInput.value.trim();
  if (!slug) return t("poiedit.no_slug");
  if (!SLUG_PATTERN.test(slug)) return t("poisource.errors.slug_charset");
  if (slugChecked.value && !slugAvailable.value) return t("poisource.errors.slug_taken");
  return null;
});

// 診断領域: POI-108 無コンテンツ / POI-121 規模 (>1000 features or serialize >5MB)。
// 判定は poiGeoJson.validateFeatureCollection に委譲 (重複実装しない)
const liveWarnings = computed<string[]>(() => {
  if (!editState.value) return [];
  const issues = validateFeatureCollection(session.toSaveFc());
  const keys: string[] = [];
  if (issues.some((i) => i.code === "no-content")) {
    keys.push("poiedit.no_content_warning");
  }
  if (issues.some((i) => i.code === "scale-feature-count" || i.code === "scale-byte-size")) {
    keys.push("poiedit.size_warning");
  }
  return keys;
});

// --- 読込 ---
async function load(sourceId: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  saveError.value = null;
  saveIssues.value = [];
  try {
    const detail = await window.poiSources.get(sourceId);
    if (!detail) {
      loadError.value = t("poiedit.not_found");
      return;
    }
    saveHandle.adoptLoaded({ uid: detail.uid, slug: detail.slug, revision: detail.revision });
    readOnly.value = detail.readOnly;
    // fc は Phase 2 get 経由で _maplatUid 付与済みの内部形
    session.load({
      slug: detail.slug,
      title: detail.title,
      fc: (detail.fc ?? { type: "FeatureCollection", features: [] }) as PoiEditorFC,
    });
    slugInput.value = detail.slug;
    slugChecked.value = false;
    slugAvailable.value = false;
    slugCheckToken++;
  } catch (e) {
    console.error("[PoiEdit] Failed to load POI source:", e);
    loadError.value = t("poisource.errors.internal");
  } finally {
    loading.value = false;
  }
}

// クローン遷移等で :sourceId が変わったら読み直す (保存後の replace は uid 一致のため対象外)
watch(
  () => route.params.sourceId,
  (next) => {
    if (typeof next !== "string" || next === "") return;
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

// slug の編集を検知して一意性を再チェック (ADR-0007)。
// 永続化済み slug (confirmedSlug) に戻った場合は自分自身なので確認済み扱い
async function onSlugInput(): Promise<void> {
  saveError.value = null;
  const token = ++slugCheckToken;
  const slug = slugInput.value.trim();
  slugChecked.value = false;
  slugAvailable.value = false;
  if (!slug || !SLUG_PATTERN.test(slug)) return;
  if (confirmedSlug.value && slug === confirmedSlug.value) {
    slugChecked.value = true;
    slugAvailable.value = true;
    return;
  }
  try {
    const available = await window.assets.checkSlug({
      slug,
      excludeUid: saveHandle.uid.value ?? undefined,
    });
    if (token !== slugCheckToken) return; // 後発の入力に上書きされた
    slugChecked.value = true;
    slugAvailable.value = available;
  } catch (e) {
    console.error("[PoiEdit] Failed to check slug availability:", e);
  }
}

// change (blur) 確定時に 1 Undo 単位として commit する
function onSlugChange(): void {
  const state = editState.value;
  if (!state || readOnly.value) return;
  const slug = slugInput.value.trim();
  slugInput.value = slug;
  if (slug === state.slug) return;
  session.commit((draft) => {
    draft.slug = slug;
  });
}

// undo/redo/読込で session 側の slug が変わったら入力欄と一意性表示を追随させる
watch(
  () => editState.value?.slug,
  (next) => {
    if (typeof next !== "string") return;
    if (next !== slugInput.value) {
      slugInput.value = next;
      onSlugInput();
    }
  },
);

// --- 保存 ---
async function saveSource(): Promise<void> {
  if (readOnly.value || saving.value) return;
  saveError.value = null;
  saveIssues.value = []; // 前回 Invalid の issues を持ち越さない
  if (slugError.value) {
    saveError.value = slugError.value;
    return;
  }
  await performSave();
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
      if (await window.assets.checkSlug({ slug: candidate })) break;
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

// --- Undo/Redo (ボタン + キーボード + menu:undo/redo IPC、MapEdit と同パターン) ---
function performUndo(): void {
  if (readOnly.value || !canUndo.value) return;
  session.undo();
}

function performRedo(): void {
  if (readOnly.value || !canRedo.value) return;
  session.redo();
}

const onHistoryKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  const isInput =
    target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
  if (isInput) return;
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
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

let removeMainProcessListener: (() => void) | undefined;

const onMainProcessMessage = (message: string) => {
  if (message === "menu:undo") {
    performUndo();
  } else if (message === "menu:redo") {
    performRedo();
  }
};

// --- 離脱確認 (goBack ボタン方式、ルートガードは使わない) ---
async function goBack(): Promise<void> {
  if (isDirty.value) {
    const response = await (window as any).dialog.showMessageBox({
      type: "info",
      buttons: ["OK", "Cancel"],
      cancelId: 1,
      message: t("poiedit.confirm_no_save"),
    });
    if (response.response !== 0) return;
  }
  router.push("/poisources");
}

onMounted(() => {
  window.addEventListener("keydown", onHistoryKeydown);
  removeMainProcessListener = window.appEvents.onMainProcessMessage(onMainProcessMessage);
  load(route.params.sourceId as string);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onHistoryKeydown);
  removeMainProcessListener?.();
  removeMainProcessListener = undefined;
});
</script>
