<template>
  <div class="poi-attribute-form p-3">
    <!-- 未選択時プレースホルダ -->
    <div v-if="!feature" class="text-muted small text-center py-4">
      {{ t("poiedit.select_poi") }}
    </div>

    <div v-else :key="uid ?? ''">
      <!-- Content Mode 選択タブ -->
      <PoiContentModeEditor
        :model-value="contentMode"
        :has-incompatible-values="incompatibleFieldKeys.length > 0"
        :incompatible-field-names="incompatibleFieldKeys"
        :read-only="readOnly"
        @update:model-value="onModeChange"
      />

      <!-- 非互換フィールド診断（混在データがある場合に section diagnostic 表示） -->
      <DiagnosticFeedback
        v-if="incompatibleDiagnosticItems.length"
        scope="section"
        :items="incompatibleDiagnosticItems"
        class="mt-1 mb-2"
      />

      <!-- 表示 ID (Feature.id) -->
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.display_id") }}</label>
        <input
          v-model="displayIdInput"
          type="text"
          class="form-control form-control-sm"
          :class="{ 'is-invalid': !!displayIdError }"
          :disabled="readOnly"
          @change="onDisplayIdChange"
        />
        <div v-if="displayIdError" class="form-text small text-danger mb-0">
          {{ displayIdError }}
        </div>
      </div>

      <!-- name (必須) -->
      <div ref="nameWrap" class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.name") }}</label>
        <LangResourceInput
          :model-value="langValue('name')"
          :active-lang="activeLang"
          :language-options="languageOptions"
          :disabled="readOnly"
          @update:model-value="onNameUpdate"
          @select-language="(code) => emit('selectLanguage', code)"
        />
        <div v-if="nameError" class="form-text small text-danger mb-0">{{ nameError }}</div>
      </div>

      <!-- === standard mode: desc, address, image === -->
      <template v-if="shownMode === 'standard'">
        <div class="mb-2">
          <label class="form-label fw-bold small mb-0">{{ t("poiedit.desc") }}</label>
          <LangResourceInput
            :model-value="langValue('desc')"
            :active-lang="activeLang"
            :language-options="languageOptions"
            multiline
            :disabled="readOnly"
            @update:model-value="onLangUpdate('desc', $event)"
            @select-language="(code) => emit('selectLanguage', code)"
          />
        </div>

        <div class="mb-2">
          <label class="form-label fw-bold small mb-0">{{ t("poiedit.address") }}</label>
          <LangResourceInput
            :model-value="langValue('address')"
            :active-lang="activeLang"
            :language-options="languageOptions"
            :disabled="readOnly"
            @update:model-value="onLangUpdate('address', $event)"
            @select-language="(code) => emit('selectLanguage', code)"
          />
        </div>

        <!-- image リスト（standard mode: 表示用メディア） -->
        <div class="mb-2">
          <label class="form-label fw-bold small mb-0">{{ t("poiedit.images") }}</label>
          <div ref="imageRowsWrap">
            <div
              v-for="(row, index) in imageRows"
              :key="index"
              class="d-flex align-items-center gap-1 mb-1"
            >
              <input
                :value="row.text"
                type="text"
                class="form-control form-control-sm"
                :disabled="readOnly"
                @change="onImageChange(index, ($event.target as HTMLInputElement).value)"
              />
              <button
                v-if="!readOnly"
                type="button"
                class="btn btn-sm btn-outline-secondary text-nowrap"
                @click="openImagePicker(index)"
              >
                {{ t("poiedit.icon_pick") }}
              </button>
              <button
                v-if="!readOnly"
                type="button"
                class="btn btn-sm btn-outline-secondary"
                :aria-label="t('poiedit.remove_image')"
                @click="removeImageRow(index)"
              >
                &times;
              </button>
            </div>
          </div>
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            @click="addImageRow"
          >
            {{ t("poiedit.add_image") }}
          </button>
        </div>
      </template>

      <!-- === html mode: HTML + 参照素材 === -->
      <template v-if="shownMode === 'html'">
        <div class="mb-2">
          <label class="form-label fw-bold small mb-0">{{ t("poiedit.html") }}</label>
          <LangResourceInput
            ref="htmlInputRef"
            :model-value="langValue('html')"
            :active-lang="activeLang"
            :language-options="languageOptions"
            multiline
            :warning="t('poiedit.html_xss_warning')"
            :disabled="readOnly"
            @update:model-value="onLangUpdate('html', $event)"
            @select-language="(code) => emit('selectLanguage', code)"
          />
        </div>

        <!-- 参照素材 (Asset Reference URI 挿入UI) -->
        <div class="mb-2">
          <label class="form-label fw-bold small mb-0">{{ t("poiedit.reference_assets") }}</label>
          <div ref="referenceAssetsWrap">
            <div
              v-for="(row, index) in imageRows"
              :key="index"
              class="d-flex align-items-center gap-1 mb-1"
            >
              <input
                :value="row.text"
                type="text"
                class="form-control form-control-sm"
                :disabled="readOnly"
                @change="onImageChange(index, ($event.target as HTMLInputElement).value)"
              />
              <button
                v-if="!readOnly"
                type="button"
                class="btn btn-sm btn-outline-secondary text-nowrap"
                @click="copyAssetRef(index)"
              >
                {{ t("poiedit.copy_ref") }}
              </button>
              <button
                v-if="!readOnly"
                type="button"
                class="btn btn-sm btn-outline-secondary text-nowrap"
                @click="insertAssetRef(index)"
              >
                {{ t("poiedit.insert_image") }}
              </button>
              <button
                v-if="!readOnly"
                type="button"
                class="btn btn-sm btn-outline-secondary"
                :aria-label="t('poiedit.remove_image')"
                @click="removeImageRow(index)"
              >
                &times;
              </button>
            </div>
          </div>
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            @click="openReferenceAssetPicker"
          >
            {{ t("poiedit.add_reference_asset") }}
          </button>
        </div>
      </template>

      <!-- === url mode: URL only === -->
      <template v-if="shownMode === 'url'">
        <div class="mb-2">
          <label class="form-label fw-bold small mb-0">{{ t("poiedit.url") }}</label>
          <LangResourceInput
            :model-value="langValue('url')"
            :active-lang="activeLang"
            :language-options="languageOptions"
            :disabled="readOnly"
            @update:model-value="onLangUpdate('url', $event)"
            @select-language="(code) => emit('selectLanguage', code)"
          />
        </div>
      </template>

      <!-- icon / selectedIcon -->
      <IconRefField
        ref="iconFieldRef"
        :label="t('poiedit.icon')"
        :model-value="iconValue"
        :read-only="readOnly"
        @update:model-value="onIconChange('icon', $event)"
      />
      <IconRefField
        ref="selectedIconFieldRef"
        :label="t('poiedit.selected_icon')"
        :model-value="selectedIconValue"
        :read-only="readOnly"
        @update:model-value="onIconChange('selectedIcon', $event)"
      />

      <!-- 座標直接入力 -->
      <div class="mb-3">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.coordinates") }}</label>
        <div class="d-flex gap-1">
          <div class="flex-fill">
            <input
              v-model="lonInput"
              type="number"
              step="any"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': !!coordError }"
              :aria-label="t('mapedit.longitude')"
              :placeholder="t('mapedit.longitude')"
              :disabled="readOnly"
              @change="onCoordChange"
            />
          </div>
          <div class="flex-fill">
            <input
              v-model="latInput"
              type="number"
              step="any"
              class="form-control form-control-sm"
              :class="{ 'is-invalid': !!coordError }"
              :aria-label="t('mapedit.latitude')"
              :placeholder="t('mapedit.latitude')"
              :disabled="readOnly"
              @change="onCoordChange"
            />
          </div>
        </div>
        <div v-if="coordError" class="form-text small text-danger mb-0">{{ coordError }}</div>
      </div>

      <!-- 削除 -->
      <button
        v-if="!readOnly"
        type="button"
        class="btn btn-outline-danger btn-sm w-100"
        @click="deleteFeature"
      >
        {{ t("poiedit.delete_poi") }}
      </button>
    </div>

    <!-- image 行用の参照 picker (standard mode: 画像 picker + html mode: 素材追加 picker) -->
    <AssetPicker
      mode="image"
      :visible="pickerAssetVisible"
      @select="onPickerAssetSelect"
      @close="pickerAssetVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import LangResourceInput from "./LangResourceInput.vue";
import AssetPicker from "./AssetPicker.vue";
import IconRefField from "./IconRefField.vue";
import PoiContentModeEditor from "./PoiContentModeEditor.vue";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import type { DiagnosticItem } from "./editor-ui/editorUiTypes";
import type { PoiEditSession } from "../composables/usePoiEditSession";
import { DISPLAY_ID_PATTERN, type PoiEditorFeature } from "../utils/poiGeoJson";
import type { LangCode } from "../utils/editorLanguages";
import {
  incompatibleFieldsForMode,
  type PoiContentMode,
  CONTENT_MODE_VALUES,
} from "../utils/poiContentMode";

const props = defineProps<{
  session: PoiEditSession;
  readOnly: boolean;
  activeLang: LangCode;
  languageOptions: readonly { code: LangCode; nativeName: string }[];
}>();

const emit = defineEmits<{
  selectLanguage: [code: LangCode];
}>();

const { t } = useTranslation();
const session = props.session;

const uid = computed(() => session.selectedUid.value);

const feature = computed<PoiEditorFeature | null>(() => {
  const id = uid.value;
  if (!id) return null;
  return (
    session.state.value?.features.find((f) => f.properties?._maplatUid === id) ?? null
  );
});

// --- Content Mode ---
const contentMode = computed<PoiContentMode | undefined>(() => {
  const mode = feature.value?.properties?._maplatContentMode;
  if (typeof mode === "string" && CONTENT_MODE_VALUES.includes(mode as PoiContentMode)) {
    return mode as PoiContentMode;
  }
  return undefined;
});

// 非互換フィールド（現在のモードに合わないフィールドで非空の値を持つもの）
const incompatibleFieldKeys = computed<string[]>(() => {
  const mode = contentMode.value;
  if (!mode) return [];
  const f = feature.value;
  if (!f) return [];
  const incompatible = incompatibleFieldsForMode(mode);
  return incompatible.filter((key) => {
    const value = f.properties[key];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "object" && !Array.isArray(value)) {
      return Object.values(value as Record<string, unknown>).some(
        (v) => typeof v === "string" && v.trim() !== "",
      );
    }
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
});

const incompatibleDiagnosticItems = computed<DiagnosticItem[]>(() => {
  if (incompatibleFieldKeys.value.length === 0) return [];
  const fieldNames = incompatibleFieldKeys.value.map((k) => {
    const displayNames: Record<string, string> = {
      desc: t("poiedit.desc"),
      address: t("poiedit.address"),
      html: t("poiedit.html"),
      url: t("poiedit.url"),
      image: t("poiedit.images"),
    };
    return displayNames[k] || k;
  });
  return [
    {
      key: "content-mode-mismatch",
      severity: "warning",
      message: t("poiedit.content_mode_mismatch", { fields: fieldNames.join(" / ") }),
    },
  ];
});

// モード切替ハンドラ。PoiContentModeEditor は確認後に emit する
const onModeChange = (mode: PoiContentMode): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  if (mode === contentMode.value) return;

  // 非互換フィールド削除 + mode 変更 = 1 Undo unit
  session.commit((draft) => {
    const index = draft.features.findIndex((f) => f.properties?._maplatUid === id);
    if (index < 0) return;
    const cloned = structuredClone(draft.features[index]) as PoiEditorFeature;
    // 新しい mode の非互換フィールドを削除
    const incompatible = incompatibleFieldsForMode(mode);
    for (const key of incompatible) {
      delete cloned.properties[key];
    }
    cloned.properties._maplatContentMode = mode;
    draft.features[index] = cloned;
  });
};

// UI表示用のモード（undefined → standard）
const shownMode = computed<PoiContentMode>(
  () => contentMode.value ?? "standard",
);

// --- ローカル編集バッファ ---
const displayIdInput = ref("");
const displayIdTransientError = ref<string | null>(null);
const lonInput = ref<string | number>("");
const latInput = ref<string | number>("");
const coordTransientError = ref<string | null>(null);

interface ImageRow {
  text: string;
  original?: unknown;
}
const imageRows = ref<ImageRow[]>([]);
let committedImageWasArray = false;

const imageRowFrom = (entry: unknown): ImageRow => {
  if (typeof entry === "string") return { text: entry, original: entry };
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const src = (entry as Record<string, unknown>).src;
    return { text: typeof src === "string" ? src : "", original: entry };
  }
  return { text: "", original: entry };
};

const reinitBuffers = (f: PoiEditorFeature | null): void => {
  displayIdTransientError.value = null;
  coordTransientError.value = null;
  if (!f) {
    displayIdInput.value = "";
    lonInput.value = "";
    latInput.value = "";
    imageRows.value = [];
    committedImageWasArray = false;
    return;
  }
  displayIdInput.value = typeof f.id === "string" ? f.id : String(f.id ?? "");
  const coords = f.geometry?.coordinates;
  lonInput.value = Array.isArray(coords) && coords[0] !== undefined ? String(coords[0]) : "";
  latInput.value = Array.isArray(coords) && coords[1] !== undefined ? String(coords[1]) : "";
  const image = f.properties?.image;
  if (image === undefined || image === null) {
    imageRows.value = [];
    committedImageWasArray = false;
  } else if (Array.isArray(image)) {
    imageRows.value = image.map(imageRowFrom);
    committedImageWasArray = true;
  } else {
    imageRows.value = [imageRowFrom(image)];
    committedImageWasArray = false;
  }
};

watch(feature, (f) => reinitBuffers(f), { immediate: true });

// --- LangResource フィールド ---
const langValue = (key: string): string | Record<string, string> | undefined => {
  const value = feature.value?.properties?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return undefined;
};

const isLangEmpty = (value: string | Record<string, string> | undefined): boolean => {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return !Object.values(value).some((v) => typeof v === "string" && v.trim() !== "");
};

const nameError = computed<string | null>(() =>
  feature.value && isLangEmpty(langValue("name"))
    ? t("poisource.errors.name_required")
    : null,
);

const onNameUpdate = (value: string | Record<string, string> | undefined): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  session.patchFeatureProperties(id, { name: isLangEmpty(value) ? undefined : value });
};

const onLangUpdate = (
  key: "desc" | "html" | "address" | "url",
  value: string | Record<string, string> | undefined,
): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  session.patchFeatureProperties(id, { [key]: isLangEmpty(value) ? undefined : value });
};

// --- 表示 ID ---
const displayIdError = computed<string | null>(() => {
  const f = feature.value;
  const id = uid.value;
  if (displayIdTransientError.value) return displayIdTransientError.value;
  if (!f || !id) return null;
  const value = typeof f.id === "string" ? f.id : String(f.id ?? "");
  if (!DISPLAY_ID_PATTERN.test(value)) {
    return t("poisource.errors.display_id_charset");
  }
  const duplicated = session.state.value?.features.some(
    (o) => o.id === value && o.properties?._maplatUid !== id,
  );
  if (duplicated) return t("poisource.errors.display_id_duplicate");
  return null;
});

const onDisplayIdChange = (): void => {
  const f = feature.value;
  const id = uid.value;
  if (!f || !id || props.readOnly) return;
  const value = displayIdInput.value;
  if (value === f.id) {
    displayIdTransientError.value = null;
    return;
  }
  if (value === "") {
    // 表示 ID 空は commit しない: 空のまま保存すると ensureDisplayIds が保存時に別 ID を
    // 採番し、markSaved 後に DB と session が乖離するため (transient エラー表示に留める)
    displayIdTransientError.value = t("poisource.errors.display_id_charset");
    return;
  }
  displayIdTransientError.value = null;
  session.commit((draft) => {
    const index = draft.features.findIndex((o) => o.properties?._maplatUid === id);
    if (index < 0) return;
    const cloned = structuredClone(draft.features[index]) as PoiEditorFeature;
    cloned.id = value;
    draft.features[index] = cloned;
  });
};

// --- image リスト（standard モードでは表示用、html モードでは参照素材） ---
const buildImageValue = (): unknown => {
  const entries: unknown[] = [];
  for (const row of imageRows.value) {
    const text = row.text.trim();
    if (text === "") continue;
    const original = row.original;
    if (typeof original === "object" && original !== null && !Array.isArray(original)) {
      const src = (original as Record<string, unknown>).src;
      entries.push(
        typeof src === "string" && src === text
          ? original
          : { ...(original as Record<string, unknown>), src: text },
      );
    } else {
      entries.push(text);
    }
  }
  if (entries.length === 0) return undefined;
  if (entries.length === 1 && !committedImageWasArray) return entries[0];
  return entries;
};

const commitImages = (): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  const next = buildImageValue();
  const current = feature.value?.properties?.image;
  if (JSON.stringify(next ?? null) === JSON.stringify(current ?? null)) return;
  session.patchFeatureProperties(id, { image: next });
};

const onImageChange = (index: number, text: string): void => {
  const row = imageRows.value[index];
  if (!row) return;
  row.text = text;
  commitImages();
};

const removeImageRow = (index: number): void => {
  imageRows.value.splice(index, 1);
  commitImages();
};

const imageRowsWrap = ref<HTMLElement | null>(null);
const addImageRow = (): void => {
  imageRows.value.push({ text: "" });
  void nextTick().then(() => {
    const inputs = imageRowsWrap.value?.querySelectorAll<HTMLInputElement>("input");
    inputs?.[inputs.length - 1]?.focus();
  });
};

// --- icon / selectedIcon ---
const iconValue = computed<string>(() => {
  const icon = feature.value?.properties?.icon;
  return typeof icon === "string" ? icon : "";
});
const selectedIconValue = computed<string>(() => {
  const selectedIcon = feature.value?.properties?.selectedIcon;
  return typeof selectedIcon === "string" ? selectedIcon : "";
});
const iconFieldRef = ref<InstanceType<typeof IconRefField> | null>(null);
const selectedIconFieldRef = ref<InstanceType<typeof IconRefField> | null>(null);

const onIconChange = (key: "icon" | "selectedIcon", raw: string): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  const next = raw.trim() === "" ? undefined : raw.trim();
  const current = feature.value?.properties?.[key];
  if (next === current) return;
  session.patchFeatureProperties(id, { [key]: next });
};

// --- AssetPicker (image 行用) ---
const pickerAssetVisible = ref(false);
let pickerCallback: ((value: string) => void) | null = null;

const openImagePicker = (index: number): void => {
  pickerCallback = (value: string) => {
    onImageChange(index, value);
  };
  pickerAssetVisible.value = true;
};

// html モードの参照素材追加
const referenceAssetsWrap = ref<HTMLElement | null>(null);
const openReferenceAssetPicker = (): void => {
  pickerCallback = (value: string) => {
    // 参照素材行として追加し、先頭 commit
    imageRows.value.push({ text: value });
    commitImages();
  };
  pickerAssetVisible.value = true;
};

const onPickerAssetSelect = (value: string): void => {
  pickerAssetVisible.value = false;
  if (pickerCallback) {
    pickerCallback(value);
    pickerCallback = null;
  }
};

// --- Asset Reference URI 操作 (html mode) ---
const htmlInputRef = ref<InstanceType<typeof LangResourceInput> | null>(null);

function getHtmlTextarea(): HTMLTextAreaElement | null {
  if (!htmlInputRef.value) return null;
  const el = htmlInputRef.value.$el as HTMLElement | undefined;
  if (!el) return null;
  return el.querySelector<HTMLTextAreaElement>("textarea");
}

const ASSET_REF_PREFIX = "maplat-asset:";
const ASSET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function copyAssetRef(index: number): void {
  const row = imageRows.value[index];
  if (!row || !row.text) return;
  const uid = row.text.trim();
  if (!ASSET_UUID_RE.test(uid)) return; // legacy path では参照を生成しない
  const refValue = `${ASSET_REF_PREFIX}${uid}`;
  void navigator.clipboard.writeText(refValue);
}

function insertAssetRef(index: number): void {
  const row = imageRows.value[index];
  if (!row || !row.text) return;
  const uid = row.text.trim();
  if (!ASSET_UUID_RE.test(uid)) return; // legacy path では参照を生成しない
  const refValue = `${ASSET_REF_PREFIX}${uid}`;
  const imgTag = `<img src="${refValue}" />`;
  const textarea = getHtmlTextarea();
  if (textarea) {
    const start = textarea.selectionStart;
    const current = langValue("html");
    const currentStr = typeof current === "string" ? current : "";
    const newValue = currentStr.slice(0, start) + imgTag + currentStr.slice(textarea.selectionEnd);
    onLangUpdate("html", newValue);
  } else {
    // textarea が取れない場合は末尾に追加
    const current = langValue("html");
    const currentStr = typeof current === "string" ? current : "";
    onLangUpdate("html", currentStr + (currentStr ? "\n" : "") + imgTag);
  }
}

// --- 座標直接入力 ---
const coordError = computed<string | null>(() => {
  if (coordTransientError.value) return coordTransientError.value;
  const coords = feature.value?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lon, lat] = coords as number[];
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    return t("poisource.errors.coord_range");
  }
  return null;
});

const onCoordChange = (): void => {
  const f = feature.value;
  const id = uid.value;
  if (!f || !id || props.readOnly) return;
  const lonRaw = String(lonInput.value ?? "").trim();
  const latRaw = String(latInput.value ?? "").trim();
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  if (lonRaw === "" || latRaw === "" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    coordTransientError.value = t("poisource.errors.coord_range");
    return;
  }
  coordTransientError.value = null;
  const coords = f.geometry?.coordinates;
  if (Array.isArray(coords) && coords[0] === lon && coords[1] === lat) return;
  session.moveFeature(id, [lon, lat]);
};

// --- 削除 ---
const deleteFeature = (): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  session.removeFeature(id);
};

// --- 新規追加直後の name フォーカス ---
const nameWrap = ref<HTMLElement | null>(null);
const focusName = (): void => {
  nameWrap.value?.querySelector<HTMLElement>("input, textarea")?.focus();
};

// --- pickerOpen ---
const pickerOpen = computed(
  () =>
    pickerAssetVisible.value ||
    !!iconFieldRef.value?.pickerOpen ||
    !!selectedIconFieldRef.value?.pickerOpen,
);

defineExpose({ focusName, pickerOpen });
</script>

<style scoped>
.poi-attribute-form {
  font-size: 0.875rem;
}
</style>