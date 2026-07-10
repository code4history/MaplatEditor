<template>
  <div class="poi-attribute-form p-3">
    <!-- 未選択時プレースホルダ -->
    <div v-if="!feature" class="text-muted small text-center py-4">
      {{ t("poiedit.select_poi") }}
    </div>

    <!-- :key=uid: 選択切替でローカル入力バッファと LangResourceInput の内部状態
         (activeLang / forceExpanded) を破棄する。同一 feature への commit では remount しない -->
    <div v-else :key="uid ?? ''">
      <!-- 表示 ID (Feature.id)。文字種違反 / ソース内重複はエラー表示して commit しない
           (欄は入力値のまま。選択切替で破棄) -->
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

      <!-- name (必須、POI-107)。空になった確定はエラー表示して commit しない -->
      <div ref="nameWrap" class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.name") }}</label>
        <LangResourceInput
          :model-value="langValue('name')"
          :disabled="readOnly"
          @update:model-value="onNameUpdate"
        />
        <div v-if="nameError" class="form-text small text-danger mb-0">{{ nameError }}</div>
      </div>

      <!-- desc / html (multiline)。html は非空時に XSS 警告 (POI-109、サニタイズはしない) -->
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.desc") }}</label>
        <LangResourceInput
          :model-value="langValue('desc')"
          multiline
          :disabled="readOnly"
          @update:model-value="onLangUpdate('desc', $event)"
        />
      </div>
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.html") }}</label>
        <LangResourceInput
          :model-value="langValue('html')"
          multiline
          :warning="t('poiedit.html_xss_warning')"
          :disabled="readOnly"
          @update:model-value="onLangUpdate('html', $event)"
        />
      </div>

      <!-- address / url (1行) -->
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.address") }}</label>
        <LangResourceInput
          :model-value="langValue('address')"
          :disabled="readOnly"
          @update:model-value="onLangUpdate('address', $event)"
        />
      </div>
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.url") }}</label>
        <LangResourceInput
          :model-value="langValue('url')"
          :disabled="readOnly"
          @update:model-value="onLangUpdate('url', $event)"
        />
      </div>

      <!-- image リスト (POI-110: string | array | {src,desc} を許容)。行の確定/削除 = 1 commit。
           object entry ({src,desc}) は src のみ編集し他キーは保持する -->
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

      <!-- icon / selectedIcon: 短期はプレーン text 入力 (参照文法 POI-139 のまま)。
           Phase 6 で Assets タブの icon picker に差し替える -->
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.icon") }}</label>
        <input
          v-model="iconInput"
          type="text"
          class="form-control form-control-sm"
          :disabled="readOnly"
          @change="onIconChange('icon', iconInput)"
        />
      </div>
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.selected_icon") }}</label>
        <input
          v-model="selectedIconInput"
          type="text"
          class="form-control form-control-sm"
          :disabled="readOnly"
          @change="onIconChange('selectedIcon', selectedIconInput)"
        />
      </div>

      <!-- 座標直接入力 (仕様 §4/§6)。±180/±90 域外・非有限はエラー表示して commit しない。
           有効なら moveFeature 1 回 = 1 Undo -->
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

      <!-- 削除 (確認なし: Undo で戻せる)。ReadOnly では非表示 -->
      <button
        v-if="!readOnly"
        type="button"
        class="btn btn-outline-danger btn-sm w-100"
        @click="deleteFeature"
      >
        {{ t("poiedit.delete_poi") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// POI 属性フォーム (Phase 4 Task 7, 仕様 §3.3/§6)。
// 確定粒度 = blur/change で patchFeatureProperties / moveFeature / commit 各 1 回 = 1 Undo
// (仕様 §5。入力毎には commit しない)。表示 ID 文字種・重複 / name 空 / 座標域外の確定は
// エラー表示のみで commit しない (欄は入力値のまま、選択切替で破棄)。
// undo/redo 追随: 選択 feature の snapshot オブジェクト同一性を watch し、structural sharing
// により「当 feature の committed 内容が実際に変わった時だけ」ローカルバッファを再初期化する。
import { computed, nextTick, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import LangResourceInput from "./LangResourceInput.vue";
import type { PoiEditSession } from "../composables/usePoiEditSession";
import { DISPLAY_ID_PATTERN, type PoiEditorFeature } from "../utils/poiGeoJson";

const props = defineProps<{
  session: PoiEditSession;
  readOnly: boolean;
}>();

const { t } = useTranslation();
// session は PoiEdit が一度だけ生成する不変オブジェクト (中の ref がリアクティブ)
const session = props.session;

const uid = computed(() => session.selectedUid.value);

// 選択中 feature の現在 snapshot 上のオブジェクト。usePoiEditSession は structural sharing の
// shallowRef なので、この computed の値 (同一性) は「選択変更」か「当 feature への commit /
// undo/redo による実変更」の時だけ変わる
const feature = computed<PoiEditorFeature | null>(() => {
  const id = uid.value;
  if (!id) return null;
  return (
    session.state.value?.features.find((f) => f.properties?._maplatUid === id) ?? null
  );
});

// --- ローカル編集バッファ (committed 値と分離。エラー時 non-commit で入力値を保持する) ---
const displayIdInput = ref("");
const displayIdError = ref<string | null>(null);
const nameError = ref<string | null>(null);
const iconInput = ref("");
const selectedIconInput = ref("");
const lonInput = ref("");
const latInput = ref("");
const coordError = ref<string | null>(null);

interface ImageRow {
  text: string;
  /** committed 側の元 entry ({src,desc} object の他キー保持用)。新規行は undefined */
  original?: unknown;
}
const imageRows = ref<ImageRow[]>([]);
// committed 値が配列だった場合は 1 件になっても配列形を保つ (round-trip 最小差分)
let committedImageWasArray = false;

const imageRowFrom = (entry: unknown): ImageRow => {
  if (typeof entry === "string") return { text: entry, original: entry };
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const src = (entry as Record<string, unknown>).src;
    return { text: typeof src === "string" ? src : "", original: entry };
  }
  return { text: "", original: entry };
};

// committed feature からローカルバッファを再初期化 (選択切替 / commit / undo/redo 追随)
const reinitBuffers = (f: PoiEditorFeature | null): void => {
  displayIdError.value = null;
  nameError.value = null;
  coordError.value = null;
  if (!f) {
    displayIdInput.value = "";
    iconInput.value = "";
    selectedIconInput.value = "";
    lonInput.value = "";
    latInput.value = "";
    imageRows.value = [];
    committedImageWasArray = false;
    return;
  }
  displayIdInput.value = typeof f.id === "string" ? f.id : String(f.id ?? "");
  const icon = f.properties?.icon;
  iconInput.value = typeof icon === "string" ? icon : "";
  const selectedIcon = f.properties?.selectedIcon;
  selectedIconInput.value = typeof selectedIcon === "string" ? selectedIcon : "";
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

// --- LangResource フィールド (name/desc/html/address/url) ---
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

// name は必須 (POI-107): 空になる確定はエラー表示のみで commit しない
const onNameUpdate = (value: string | Record<string, string> | undefined): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  if (isLangEmpty(value)) {
    nameError.value = t("poisource.errors.name_required");
    return;
  }
  nameError.value = null;
  session.patchFeatureProperties(id, { name: value });
};

// desc/html/address/url: 空になった確定はフィールドごと落とす (undefined は保存時の
// JSON round-trip で削除される。externalizeLangFields の空フィールド削除規約と整合)
const onLangUpdate = (
  key: "desc" | "html" | "address" | "url",
  value: string | Record<string, string> | undefined,
): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  session.patchFeatureProperties(id, { [key]: isLangEmpty(value) ? undefined : value });
};

// --- 表示 ID (Feature.id)。patchFeatureProperties では書けないため commit 直接 (1 Undo) ---
const onDisplayIdChange = (): void => {
  const f = feature.value;
  const id = uid.value;
  if (!f || !id || props.readOnly) return;
  const value = displayIdInput.value;
  if (value === f.id) {
    displayIdError.value = null;
    return;
  }
  // (a) 文字種 [A-Za-z0-9_-]+ (POI-140。空文字も違反)
  if (!DISPLAY_ID_PATTERN.test(value)) {
    displayIdError.value = t("poisource.errors.display_id_charset");
    return;
  }
  // (b) ソース内一意 (自分以外との重複)
  const duplicated = session.state.value?.features.some(
    (o) => o.id === value && o.properties?._maplatUid !== id,
  );
  if (duplicated) {
    displayIdError.value = t("poisource.errors.display_id_duplicate");
    return;
  }
  displayIdError.value = null;
  session.commit((draft) => {
    const index = draft.features.findIndex((o) => o.properties?._maplatUid === id);
    if (index < 0) return;
    const cloned = structuredClone(draft.features[index]) as PoiEditorFeature;
    cloned.id = value;
    draft.features[index] = cloned;
  });
};

// --- image リスト ---
// ローカル行 → properties.image の値へ。空行は落とし、object entry は src のみ差し替え。
// 0 件 = undefined (フィールド削除) / 1 件 = 元が配列でなければ単数形を維持 / 複数 = 配列
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

// 各確定 (行の変更 / 削除) = 1 commit。committed 値と等価なら commit しない
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

// 追加はローカル行のみ (空のまま commit しない)。値の確定 (blur) 時に 1 commit になる
const imageRowsWrap = ref<HTMLElement | null>(null);
const addImageRow = (): void => {
  imageRows.value.push({ text: "" });
  void nextTick().then(() => {
    const inputs = imageRowsWrap.value?.querySelectorAll<HTMLInputElement>("input");
    inputs?.[inputs.length - 1]?.focus();
  });
};

// --- icon / selectedIcon (短期プレーン text。Phase 6 で picker 差し替え) ---
const onIconChange = (key: "icon" | "selectedIcon", raw: string): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  const next = raw.trim() === "" ? undefined : raw.trim();
  const current = feature.value?.properties?.[key];
  if (next === current) return;
  session.patchFeatureProperties(id, { [key]: next });
};

// --- 座標直接入力: 域外/非有限はエラーで commit しない。有効なら moveFeature 1 回 ---
const onCoordChange = (): void => {
  const f = feature.value;
  const id = uid.value;
  if (!f || !id || props.readOnly) return;
  const lonRaw = lonInput.value.trim();
  const latRaw = latInput.value.trim();
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  if (
    lonRaw === "" ||
    latRaw === "" ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    coordError.value = t("poisource.errors.coord_range");
    return;
  }
  coordError.value = null;
  const coords = f.geometry?.coordinates;
  if (Array.isArray(coords) && coords[0] === lon && coords[1] === lat) return;
  session.moveFeature(id, [lon, lat]);
};

// --- 削除 (確認なし。Undo で戻せる) ---
const deleteFeature = (): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  session.removeFeature(id);
};

// --- 新規追加直後の name フォーカス (PoiEdit が addFeature 後に呼ぶ) ---
const nameWrap = ref<HTMLElement | null>(null);
const focusName = (): void => {
  nameWrap.value?.querySelector<HTMLElement>("input, textarea")?.focus();
};

defineExpose({ focusName });
</script>

<style scoped>
.poi-attribute-form {
  font-size: 0.875rem;
}
</style>
