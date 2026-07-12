<template>
  <div class="poi-attribute-form p-3">
    <!-- 未選択時プレースホルダ -->
    <div v-if="!feature" class="text-muted small text-center py-4">
      {{ t("poiedit.select_poi") }}
    </div>

    <!-- :key=uid: 選択切替でローカル入力バッファと LangResourceInput の内部状態
         (activeLang / forceExpanded) を破棄する。同一 feature への commit では remount しない -->
    <div v-else :key="uid ?? ''">
      <!-- 表示 ID (Feature.id)。文字種違反 / ソース内重複でも commit する (2026-07-11
           ポリシー: エラーは committed 値から再判定して表示、保存側で堰き止め)。
           空のみ非 commit (表現不可能な入力) -->
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

      <!-- name (必須、POI-107)。空になる確定も commit する (properties から name が消える)。
           必須エラーは committed 値から再判定して表示、保存側で堰き止め -->
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
            <!-- picker (mode:'image'): 選択値は onImageChange の既存確定経路に流す (=1 commit) -->
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

      <!-- icon / selectedIcon (Phase 6 Task 4): 解釈表示 + AssetPicker (mode:'icon') +
           クリア + 手入力は共通部品 IconRefField (Phase 8 で抽出) に委譲。
           確定は従来どおり update:modelValue → onIconChange (session 1 commit) 経路 -->
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

      <!-- 座標直接入力 (仕様 §4/§6)。両方有限数値なら ±180/±90 域外でも moveFeature 1 回 =
           1 Undo で commit する (2026-07-11 ポリシー。域外エラーは committed 値から再判定して
           表示、保存側で堰き止め)。空・非数値のみ非 commit (geometry に入れられない) -->
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

    <!-- image 行用の参照 picker (仕様 §7)。選択値は既存の確定経路 (onImageChange) に流す
         = 1 commit (Undo 粒度不変)。icon 用 picker は IconRefField が内蔵する -->
    <AssetPicker
      mode="image"
      :visible="picker.visible"
      @select="onPickerSelect"
      @close="picker.visible = false"
    />
  </div>
</template>

<script setup lang="ts">
// POI 属性フォーム (Phase 4 Task 7, 仕様 §3.3/§6)。
// 確定粒度 = blur/change で patchFeatureProperties / moveFeature / commit 各 1 回 = 1 Undo
// (仕様 §5。入力毎には commit しない)。
// エラー値の commit ポリシー (2026-07-11 ユーザー決定で変更):
// - 表現可能ならエラーでも commit する (= 1 Undo 単位として積む)。座標域外 (±180/±90 外) /
//   表示 ID の文字種違反・ソース内重複 / name 空、いずれも commit し、保存・エクスポート側で
//   堰き止める (PoiEdit の liveErrors + backend Invalid)。理由 = Undo の直感 (エラー入力後の
//   Undo は直前の OK 値に戻るべき)。
// - 表現不可能な入力のみ非 commit (エラー表示のみ、欄は入力値のまま): 座標欄の空・非数値
//   (geometry に入れられない) / 表示 ID の空 (保存時に backend の ensureDisplayIds が自動採番し、
//   markSaved 後に DB と session が乖離する既知バグ類型 [Phase 5 M1 と同型] を踏むため)。
// - インラインエラーの判定源は committed 値 (computed): バッファ再初期化後もエラー状態が
//   正しく再現される (undo で OK 値に戻ればエラーが消え、redo でエラー値に進めばまた出る)。
// undo/redo 追随: 選択 feature の snapshot オブジェクト同一性を watch し、structural sharing
// により「当 feature の committed 内容が実際に変わった時だけ」ローカルバッファを再初期化する。
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import LangResourceInput from "./LangResourceInput.vue";
import AssetPicker from "./AssetPicker.vue";
import IconRefField from "./IconRefField.vue";
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

// --- ローカル編集バッファ (committed 値と分離。表現不可能な入力の non-commit 時に入力値を保持) ---
const displayIdInput = ref("");
// transient エラー = 表現不可能な入力による非 commit (空 ID / 空・非数値座標)。
// バッファ再初期化 (選択切替 / commit / undo/redo 追随) でクリアする。
// 表現可能なエラー (域外・文字種違反・重複・name 空) は commit されるため transient に持たず、
// committed 値からの computed (displayIdError / nameError / coordError) で再判定する
const displayIdTransientError = ref<string | null>(null);
// type="number" の v-model は数値 (または空文字) を返すため string | number で持つ
const lonInput = ref<string | number>("");
const latInput = ref<string | number>("");
const coordTransientError = ref<string | null>(null);

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
  // transient (非 commit) エラーのみクリア。committed 値由来のエラーは computed が
  // 再初期化後の committed 値から自動再判定する
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

// name は必須 (POI-107) だが、空になる確定も commit する (properties から name が消える。
// 2026-07-11 ポリシー: 保存側 name-required 検証で堰き止め)。エラーは committed 値から再判定
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
// committed 値からのエラー再判定: 文字種 [A-Za-z0-9_-]+ (POI-140) → ソース内一意 (自分以外)
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
  // 空 ID のみ非 commit (表現不可能な入力): 空のまま commit すると保存時に backend の
  // ensureDisplayIds が自動採番し、markSaved 後に DB と session が乖離する既知バグ類型
  // (Phase 5 M1 と同型) を踏むため。文字種違反・重複は commit し、committed 値からの
  // computed (displayIdError) が保存まで表示を維持する (2026-07-11 ポリシー)
  if (value === "") {
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

// --- icon / selectedIcon: 確定経路は Phase 4 から不変 (IconRefField の picker /
// クリア / 手入力もすべてここへ流す = 1 commit)。解釈表示・picker・クリアの UI は
// 共通部品 IconRefField (Phase 8 で抽出) が担い、committed 値を modelValue で渡す ---
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

// --- AssetPicker (image 行用モーダル。icon 用は IconRefField 内蔵) ---
const picker = reactive({
  visible: false,
  imageIndex: 0,
});

const openImagePicker = (index: number): void => {
  picker.imageIndex = index;
  picker.visible = true;
};

// 選択結果を既存の確定経路に流す (Undo 粒度不変: picker で選択 = 1 commit)。
// 確定前に picker.imageIndex の妥当性を再検証する (Phase 6 品質レビュー MAJOR-2:
// picker 表示中に行削除等で index が範囲外/行不在になり得るため、黙って捨てず警告してから no-op)
const onPickerSelect = (value: string): void => {
  if (picker.imageIndex < 0 || picker.imageIndex >= imageRows.value.length) {
    console.warn(
      `PoiAttributeForm: picker.imageIndex (${picker.imageIndex}) is out of range at select time; discarding selection`,
    );
    return;
  }
  onImageChange(picker.imageIndex, value);
};

// --- 座標直接入力 ---
// committed 値からの域外エラー再判定 (±180/±90、非有限も含む。validateFeatureCollection の
// coord-range と同判定)。域外値も commit されるため、undo/redo での再現はここが担う
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

// 空・非数値 (表現不可能) のみ非 commit。両方有限数値なら域外でも moveFeature で commit する
// (2026-07-11 ポリシー。域外の範囲判定は commit を止めず、committed 値の coordError 表示 +
// 保存側 coord-range 検証で堰き止める)
const onCoordChange = (): void => {
  const f = feature.value;
  const id = uid.value;
  if (!f || !id || props.readOnly) return;
  // type="number" の v-model は数値を返す (2026-07-11 実機バグ: .trim() 直呼びで TypeError →
  // moveFeature に到達せず座標入力が丸ごと無反応だった)。String 化してから正規化する
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

// picker 表示中かどうか (Phase 6 品質レビュー MAJOR-2: PoiEdit がグローバルキー
// (undo/redo/Delete/menu:undo/redo) を picker 表示中は抑止するために参照する)。
// image 行 picker + IconRefField 内蔵の icon picker ×2 をここで集約する
const pickerOpen = computed(
  () =>
    picker.visible ||
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
