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

      <!-- 診断領域 (内容があるときのみ表示) -->
      <div
        v-if="readOnly || saveError || saveIssues.length || liveWarnings.length"
        class="px-4 py-2 flex-shrink-0 overflow-auto"
        style="max-height: 40%;"
      >
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

      <!-- 地図ペイン (主役、仕様 §3.3) + 右カラム: 属性フォーム (Task 7) の下に
           feature 一覧 (Task 8) の上下分割。一覧は残り高さで flex (min-height 確保) -->
      <div class="flex-grow-1 d-flex overflow-hidden">
        <div class="flex-grow-1 position-relative overflow-hidden">
          <PoiEditMap ref="mapPane" :session="mapSession" :read-only="readOnly" />
        </div>
        <div class="poi-side-pane border-start bg-white flex-shrink-0 d-flex flex-column overflow-hidden">
          <div class="poi-form-area overflow-auto">
            <PoiAttributeForm ref="attrForm" :session="session" :read-only="readOnly" />
          </div>
          <PoiFeatureList
            class="poi-list-area"
            :session="session"
            :read-only="readOnly"
            @select="onListSelect"
            @create="createPoiAtMapCenter"
          />
        </div>
      </div>
    </template>
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
import {
  usePoiEditSession,
  type PoiEditSession,
  type PoiEditState,
} from "../composables/usePoiEditSession";
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
// saveSource が捕捉した送信内容 (snapshot) を send クロージャへ渡す一時変数 (MapEdit の
// pendingSave と同パターン)。保存中の編集で editState が差し替わっても、send (revision-conflict
// の「上書き」再送含む) は捕捉時と同一の snapshot を送る。applySuccess は snapshot 同一性で
// markSaved するかを判定する (保存中の新編集を誤ってクリーン化しない)
let pendingSave: {
  capturedState: PoiEditState;
  payload: { slug: string; title: Record<string, string> | string; fc: PoiEditorFC };
} | null = null;
const saveHandle = useRevisionedAssetSave<PoiSourceSaveResult>({
  send: async ({ uid, expectedRevision }) => {
    // saveSource が pendingSave を設定した後にしか到達しない
    const { payload } = pendingSave!;
    const result = await window.poiSources.save(uid!, { ...payload, expectedRevision });
    if (!result) {
      // IPC が結果を返さなかった: 表示のみで安全終了
      saveError.value = t("poiedit.error_saving");
      return null;
    }
    return result;
  },
  applySuccess: async (result) => {
    // uid/revision/confirmedSlug は composable が反映済み。以下は画面固有処理。
    // markSaved は保存中に編集が入っていない (snapshot 同一、shallowRef のオブジェクト同一性)
    // 場合のみ。編集が入っていたら isDirty のまま残して再保存を促す
    if (editState.value === pendingSave!.capturedState) {
      session.markSaved();
    }
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
  if (saveHandle.saving.value) return; // 保存中の snapshot 差し替えを防ぐ (markSaved 判定と対)
  if (readOnly.value || !canUndo.value) return;
  session.undo();
}

function performRedo(): void {
  if (saveHandle.saving.value) return; // 保存中の snapshot 差し替えを防ぐ (markSaved 判定と対)
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
  if (isInputTarget(event)) return;
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

// 選択中 feature の Delete キー削除 (仕様 §4)。ReadOnly では無効。
// macOS のフルキーボードでない Delete キーは event.key === "Backspace" なので両方受ける
const onDeleteKeydown = (event: KeyboardEvent) => {
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
  window.addEventListener("keydown", onDeleteKeydown);
  removeMainProcessListener = window.appEvents.onMainProcessMessage(onMainProcessMessage);
  load(route.params.sourceId as string);
});

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

/* フォームは内容高さ基準 (必要なら縮んで内部スクロール)、一覧が残り高さを取る */
.poi-form-area {
  flex: 0 1 auto;
  min-height: 0;
}

.poi-list-area {
  flex: 1 1 auto;
  min-height: 180px;
}
</style>
