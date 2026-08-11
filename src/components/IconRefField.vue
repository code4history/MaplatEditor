<template>
  <div class="icon-ref-field mb-2">
    <label class="form-label fw-bold small mb-0">{{ label }}</label>
    <div
      v-if="display.kind !== 'empty'"
      class="d-flex align-items-center gap-2 small mb-1"
    >
      <img
        v-if="display.thumb"
        :src="display.thumb"
        class="icon-thumb"
        alt=""
        @error="display.thumb = null"
      />
      <span class="text-truncate">{{ display.text }}</span>
      <span v-if="display.warning" class="badge text-bg-warning">
        {{ t(display.warning === "unresolved-set"
          ? "poiedit.icon_unresolved_set"
          : "poiedit.icon_asset_missing") }}
      </span>
    </div>
    <div class="d-flex align-items-center gap-1">
      <input
        v-model="input"
        type="text"
        class="form-control form-control-sm"
        :disabled="readOnly"
        @change="commit(input)"
      />
      <button
        v-if="!readOnly"
        type="button"
        class="btn btn-sm btn-outline-secondary text-nowrap"
        @click="openPicker"
      >
        {{ t("poiedit.icon_pick") }}
      </button>
      <button
        v-if="!readOnly"
        type="button"
        class="btn btn-sm btn-outline-secondary text-nowrap"
        @click="clear"
      >
        {{ t("poiedit.icon_clear") }}
      </button>
    </div>

    <!-- 参照 picker (仕様 §7)。選択値は既存の確定経路 (commit → update:modelValue) に流す
         = 呼び出し側で 1 commit (Undo 粒度不変) -->
    <AssetPicker
      mode="icon"
      :visible="pickerVisible"
      @select="onPickerSelect"
      @close="pickerVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
// icon 参照 1 欄の共通部品 (Phase 8 Task 2 で PoiAttributeForm から挙動不変で抽出)。
// 現在値の解釈表示 (parseIconRef → iconset はサムネ + setId:iconId、asset は slug/title
// 解決表示、URL は短縮表示。未登録 setId / 未存在 asset は警告 badge) + AssetPicker
// (mode:'icon') + クリア + 参照文法 (POI-139) の手入力を提供する。
// 確定粒度は呼び出し側の責務: change/選択/クリアのたびに update:modelValue を emit し、
// PoiAttributeForm は onIconChange (session 1 commit)、PoiReferenceEditor は pois 配列差し替え
// につなぐ。modelValue (committed 値) の変化でローカル入力バッファを再初期化する。
import { ref, watch, type Ref } from "vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import AssetPicker from "./AssetPicker.vue";
import { parseIconRef, isRegisteredIconSet, listIconSets } from "../utils/iconRefs";
import { localizeTitle as resolveLocalizedTitle } from "../utils/langResource";
import type { ImageAssetRow } from "../electron";

const props = defineProps<{
  modelValue?: string;
  readOnly?: boolean;
  label: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const { t } = useTranslation();

// ローカル編集バッファ (committed 値 = modelValue と分離)。committed 値の変化で再初期化する
const input = ref(props.modelValue ?? "");
watch(
  () => props.modelValue,
  (value) => {
    input.value = value ?? "";
  },
);

const commit = (raw: string): void => {
  if (props.readOnly) return;
  emit("update:modelValue", raw);
};

const clear = (): void => {
  input.value = "";
  commit("");
};

// --- 解釈表示 (Phase 6 Task 4、仕様 §7) ---
// 入力バッファを parseIconRef で判別し、iconset は registry の previewUrl サムネ +
// `setId:iconId` (未登録 setId は警告 badge — URL とはみなさない)、asset は imageAssets.get
// で slug/title を解決表示 (未存在は警告)、URL は短縮表示 (CSS truncate) する。
interface IconDisplay {
  kind: "empty" | "iconset" | "asset" | "url";
  text: string;
  thumb: string | null;
  warning: "unresolved-set" | "asset-missing" | null;
}

const EMPTY_ICON_DISPLAY: IconDisplay = { kind: "empty", text: "", thumb: null, warning: null };

// asset 解決 (imageAssets.get / getFilePath) は非同期のため、後着優先トークンで
// 古い応答が新しい入力の表示を上書きしないようにする (useAssetThumbnails と同方式)
const createIconDisplay = (source: Ref<string>): Ref<IconDisplay> => {
  const display = ref<IconDisplay>({ ...EMPTY_ICON_DISPLAY });
  let token = 0;
  const resolve = async (raw: string): Promise<void> => {
    const current = ++token;
    const value = raw.trim();
    if (value === "") {
      display.value = { ...EMPTY_ICON_DISPLAY };
      return;
    }
    const parsed = parseIconRef(value);
    if (parsed.kind === "iconset") {
      const registered = isRegisteredIconSet(parsed.setId);
      const set = registered
        ? listIconSets().find((s) => s.setId === parsed.setId)
        : undefined;
      display.value = {
        kind: "iconset",
        text: `${parsed.setId}:${parsed.iconId}`,
        thumb: set ? set.previewUrl(parsed.iconId) : null,
        warning: registered ? null : "unresolved-set",
      };
      return;
    }
    if (parsed.kind === "asset") {
      // 解決中は uid のまま表示 (解決後に slug/title へ差し替え)
      display.value = { kind: "asset", text: value, thumb: null, warning: null };
      let row: ImageAssetRow | null = null;
      let thumb: string | null = null;
      try {
        row = await window.imageAssets.get(parsed.uid);
        if (row) thumb = await window.imageAssets.getFilePath(parsed.uid).catch(() => null);
      } catch (e) {
        console.error("Failed to resolve icon asset reference", e);
      }
      if (current !== token) return; // 後発の入力に上書きされた
      display.value = row
        ? {
            kind: "asset",
            text: `${row.slug}: ${resolveLocalizedTitle(row.title, i18next.language) || row.slug}`,
            thumb,
            warning: null,
          }
        : { kind: "asset", text: value, thumb: null, warning: "asset-missing" };
      return;
    }
    display.value = { kind: "url", text: parsed.url, thumb: null, warning: null };
  };
  watch(source, (value) => void resolve(value), { immediate: true });
  return display;
};

const display = createIconDisplay(input);

// --- AssetPicker (mode:'icon' 固定) ---
const pickerVisible = ref(false);

const openPicker = (): void => {
  pickerVisible.value = true;
};

const onPickerSelect = (value: string): void => {
  input.value = value;
  commit(value);
};

// picker 表示中かどうか (Phase 6 品質レビュー MAJOR-2): 呼び出し側 (PoiAttributeForm) が
// グローバルキー (undo/redo/Delete/menu:undo/redo) の抑止判定に集約する
defineExpose({ pickerOpen: pickerVisible });
</script>

<style scoped>
.icon-ref-field {
  font-size: 0.875rem;
}
.icon-thumb {
  max-width: 24px;
  max-height: 24px;
  width: auto;
  height: auto;
  object-fit: contain;
}
</style>
