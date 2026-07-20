<template>
  <!-- icon / image 参照の選択モーダル (Phase 6 Task 4、仕様 §7: picker は icon / image で共用)。
       emit する値は POI-139 の参照文法文字列 (iconset → `{setId}:{iconId}` / asset → uid /
       URL → 入力値そのまま)。呼び出し側が既存の確定経路 (onIconChange / image 行) に流す -->
  <div v-if="visible" class="modal show d-block asset-picker" tabindex="-1" @click.self="onCancel">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            {{ mode === "icon" ? t("poiedit.picker.title_icon") : t("poiedit.picker.title_image") }}
          </h5>
          <button type="button" class="btn-close" @click="onCancel"></button>
        </div>
        <div class="modal-body">
          <!-- タブ: Icon set は mode:'icon' のみ (image は参照文法対象外、asset uid か URL) -->
          <ul class="nav nav-tabs mb-3">
            <li v-if="mode === 'icon'" class="nav-item">
              <button
                type="button"
                class="nav-link"
                :class="{ active: activeTab === 'iconset' }"
                @click="activeTab = 'iconset'"
              >
                {{ t("poiedit.picker.tab_iconset") }}
              </button>
            </li>
            <li class="nav-item">
              <button
                type="button"
                class="nav-link"
                :class="{ active: activeTab === 'assets' }"
                @click="activeTab = 'assets'"
              >
                {{ t("poiedit.picker.tab_assets") }}
              </button>
            </li>
            <li class="nav-item">
              <button
                type="button"
                class="nav-link"
                :class="{ active: activeTab === 'url' }"
                @click="activeTab = 'url'"
              >
                {{ t("poiedit.picker.tab_url") }}
              </button>
            </li>
          </ul>

          <!-- Icon set タブ: registry (listIconSets) → previewUrl サムネグリッド -->
          <div v-if="activeTab === 'iconset'">
            <div v-for="set in iconSets" :key="set.setId" class="mb-2">
              <div class="fw-bold small mb-1">{{ t(set.titleKey) }}</div>
              <div class="d-flex flex-wrap gap-2">
                <button
                  v-for="iconId in set.iconIds"
                  :key="iconId"
                  type="button"
                  class="btn btn-light border pick-cell"
                  :title="`${set.setId}:${iconId}`"
                  @click="pickIconSet(set.setId, iconId)"
                >
                  <img :src="set.previewUrl(iconId)" class="pick-thumb" :alt="iconId" />
                  <span class="d-block small text-truncate">{{ iconId }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Assets タブ: imageAssets.search + サムネグリッド (AssetList と共用 composable) -->
          <div v-else-if="activeTab === 'assets'">
            <input
              type="text"
              class="form-control mb-2"
              :placeholder="t('assetlist.search_placeholder')"
              v-model="assets.searchQuery.value"
              @input="assets.loadAssets()"
            />
            <div v-if="assets.loading.value" class="text-muted text-center py-3">
              {{ t("assetlist.loading") }}
            </div>
            <!-- M12-T11 (R3/C41): alert 直書きから DF section へ -->
            <DiagnosticFeedback v-else-if="assets.error.value" scope="section" :items="[{ key: 'assets-load', severity: 'danger', message: assets.error.value }]" />
            <div v-else-if="assets.items.value.length === 0" class="text-muted text-center py-3">
              {{ t("poiedit.picker.no_assets") }}
            </div>
            <div v-else class="d-flex flex-wrap gap-2 asset-grid">
              <button
                v-for="asset in assets.items.value"
                :key="asset.uid"
                type="button"
                class="btn btn-light border pick-cell"
                :title="asset.slug"
                @click="pickAsset(asset.uid)"
              >
                <img
                  :src="assets.thumbUrls[asset.uid] || noImage"
                  loading="lazy"
                  class="pick-thumb"
                  :alt="localizeAssetTitle(asset)"
                  @error="assets.onThumbError(asset.uid)"
                />
                <span class="d-block small text-truncate">{{ localizeAssetTitle(asset) }}</span>
                <span class="d-block small text-muted text-truncate">{{ asset.slug }}</span>
              </button>
            </div>
          </div>

          <!-- URL タブ: テキスト入力 + 決定 (空は不可) -->
          <div v-else-if="activeTab === 'url'">
            <div class="d-flex gap-2">
              <input
                type="text"
                class="form-control"
                :placeholder="t('poiedit.picker.url_placeholder')"
                v-model="urlInput"
                @keydown.enter.prevent="pickUrl"
              />
              <button
                type="button"
                class="btn btn-primary"
                :disabled="urlInput.trim() === ''"
                @click="pickUrl"
              >
                {{ t("poiedit.picker.url_apply") }}
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="onCancel">
            {{ t("assetlist.cancel") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import noImage from "../assets/img/no_image.png";
import { localizeTitle as resolveLocalizedTitle } from "../utils/langResource";
import { listIconSets, formatIconRef } from "../utils/iconRefs";
import { useAssetThumbnails } from "../composables/useAssetThumbnails";
import type { ImageAssetRow } from "../electron";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";

const props = defineProps<{
  /** icon: Icon set / Assets / URL の3タブ。image: Assets / URL のみ (参照文法対象外) */
  mode: "icon" | "image";
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "select", ref: string): void;
  (e: "close"): void;
}>();

const { t } = useTranslation();

const iconSets = listIconSets();

const localizeAssetTitle = (row: ImageAssetRow): string =>
  resolveLocalizedTitle(row.title, i18next.language) || row.slug;

type PickerTab = "iconset" | "assets" | "url";
const activeTab = ref<PickerTab>("assets");
const urlInput = ref("");

// asset 一覧 + サムネイル (AssetList と共用の composable。token ガード込み)
const assets = useAssetThumbnails();

// 二重 emit 防止: クリック連打・Enter 連打でも select は開いてから 1 回のみ
let picked = false;

// 開くたびに状態をリセットして一覧を読み込む (前回の検索語 / URL 入力は持ち越さない)
watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    picked = false;
    activeTab.value = props.mode === "icon" ? "iconset" : "assets";
    urlInput.value = "";
    assets.searchQuery.value = "";
    assets.loadAssets();
  },
  { immediate: true }
);

const emitSelect = (value: string): void => {
  if (picked) return;
  picked = true;
  emit("select", value);
  emit("close");
};

const pickIconSet = (setId: string, iconId: string): void => {
  emitSelect(formatIconRef({ kind: "iconset", setId, iconId }));
};

const pickAsset = (uid: string): void => {
  emitSelect(formatIconRef({ kind: "asset", uid }));
};

const pickUrl = (): void => {
  const url = urlInput.value.trim();
  if (url === "") return; // 空は不可
  emitSelect(url);
};

const onCancel = (): void => {
  emit("close");
};

// Escape で閉じる (選択せず close のみ)
const onKeyDown = (e: KeyboardEvent): void => {
  if (e.isComposing) return; // IME 変換取り消しの Escape でモーダルが閉じないようにする
  if (e.key !== "Escape" || !props.visible) return;
  onCancel();
};

onMounted(() => window.addEventListener("keydown", onKeyDown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));
</script>

<style scoped>
.asset-picker {
  background: rgba(0, 0, 0, 0.4);
}
.pick-cell {
  width: 108px;
  padding: 4px;
  text-align: center;
}
.pick-thumb {
  max-width: 96px;
  max-height: 64px;
  width: auto;
  height: auto;
  object-fit: contain;
}
.asset-grid {
  max-height: 50vh;
  overflow-y: auto;
}
</style>
