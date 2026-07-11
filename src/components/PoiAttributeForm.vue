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

      <!-- icon / selectedIcon (Phase 6 Task 4): 現在値の解釈表示 (parseIconRef →
           iconset はサムネ + setId:iconId、asset は slug/title 解決表示、URL は短縮表示。
           未登録 setId / 未存在 asset は警告 badge) + picker 選択 + クリア。
           参照文法 (POI-139) の直書きも引き続き可 (text 入力は残し、既存 onIconChange 経路) -->
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.icon") }}</label>
        <div
          v-if="iconDisplay.kind !== 'empty'"
          class="d-flex align-items-center gap-2 small mb-1"
        >
          <img
            v-if="iconDisplay.thumb"
            :src="iconDisplay.thumb"
            class="icon-thumb"
            alt=""
            @error="iconDisplay.thumb = null"
          />
          <span class="text-truncate">{{ iconDisplay.text }}</span>
          <span v-if="iconDisplay.warning" class="badge text-bg-warning">
            {{ t(iconDisplay.warning === "unresolved-set"
              ? "poiedit.icon_unresolved_set"
              : "poiedit.icon_asset_missing") }}
          </span>
        </div>
        <div class="d-flex align-items-center gap-1">
          <input
            v-model="iconInput"
            type="text"
            class="form-control form-control-sm"
            :disabled="readOnly"
            @change="onIconChange('icon', iconInput)"
          />
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn-sm btn-outline-secondary text-nowrap"
            @click="openIconPicker('icon')"
          >
            {{ t("poiedit.icon_pick") }}
          </button>
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn-sm btn-outline-secondary text-nowrap"
            @click="clearIcon('icon')"
          >
            {{ t("poiedit.icon_clear") }}
          </button>
        </div>
      </div>
      <div class="mb-2">
        <label class="form-label fw-bold small mb-0">{{ t("poiedit.selected_icon") }}</label>
        <div
          v-if="selectedIconDisplay.kind !== 'empty'"
          class="d-flex align-items-center gap-2 small mb-1"
        >
          <img
            v-if="selectedIconDisplay.thumb"
            :src="selectedIconDisplay.thumb"
            class="icon-thumb"
            alt=""
            @error="selectedIconDisplay.thumb = null"
          />
          <span class="text-truncate">{{ selectedIconDisplay.text }}</span>
          <span v-if="selectedIconDisplay.warning" class="badge text-bg-warning">
            {{ t(selectedIconDisplay.warning === "unresolved-set"
              ? "poiedit.icon_unresolved_set"
              : "poiedit.icon_asset_missing") }}
          </span>
        </div>
        <div class="d-flex align-items-center gap-1">
          <input
            v-model="selectedIconInput"
            type="text"
            class="form-control form-control-sm"
            :disabled="readOnly"
            @change="onIconChange('selectedIcon', selectedIconInput)"
          />
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn-sm btn-outline-secondary text-nowrap"
            @click="openIconPicker('selectedIcon')"
          >
            {{ t("poiedit.icon_pick") }}
          </button>
          <button
            v-if="!readOnly"
            type="button"
            class="btn btn-sm btn-outline-secondary text-nowrap"
            @click="clearIcon('selectedIcon')"
          >
            {{ t("poiedit.icon_clear") }}
          </button>
        </div>
      </div>

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

    <!-- icon / image 共用の参照 picker (仕様 §7)。選択値は既存の確定経路
         (onIconChange / onImageChange) に流す = 1 commit (Undo 粒度不変) -->
    <AssetPicker
      :mode="picker.mode"
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
import { computed, nextTick, reactive, ref, watch, type Ref } from "vue";
import { useTranslation } from "i18next-vue";
import i18next from "i18next";
import LangResourceInput from "./LangResourceInput.vue";
import AssetPicker from "./AssetPicker.vue";
import type { PoiEditSession } from "../composables/usePoiEditSession";
import { DISPLAY_ID_PATTERN, type PoiEditorFeature } from "../utils/poiGeoJson";
import { parseIconRef, isRegisteredIconSet, listIconSets } from "../utils/iconRefs";
import { localizeTitle as resolveLocalizedTitle } from "../utils/langResource";
import type { ImageAssetRow } from "../electron";

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
const iconInput = ref("");
const selectedIconInput = ref("");
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

// --- icon / selectedIcon: 確定経路は Phase 4 から不変 (picker / クリアもここへ流す = 1 commit) ---
const onIconChange = (key: "icon" | "selectedIcon", raw: string): void => {
  const id = uid.value;
  if (!id || props.readOnly) return;
  const next = raw.trim() === "" ? undefined : raw.trim();
  const current = feature.value?.properties?.[key];
  if (next === current) return;
  session.patchFeatureProperties(id, { [key]: next });
};

// --- icon / selectedIcon の解釈表示 (Phase 6 Task 4、仕様 §7) ---
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
const createIconDisplay = (input: Ref<string>): Ref<IconDisplay> => {
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
  watch(input, (value) => void resolve(value), { immediate: true });
  return display;
};

const iconDisplay = createIconDisplay(iconInput);
const selectedIconDisplay = createIconDisplay(selectedIconInput);

const clearIcon = (key: "icon" | "selectedIcon"): void => {
  if (key === "icon") iconInput.value = "";
  else selectedIconInput.value = "";
  onIconChange(key, "");
};

// --- AssetPicker (icon / image 共用モーダル) ---
const picker = reactive({
  visible: false,
  mode: "icon" as "icon" | "image",
  iconTarget: "icon" as "icon" | "selectedIcon",
  imageIndex: 0,
});

const openIconPicker = (key: "icon" | "selectedIcon"): void => {
  picker.mode = "icon";
  picker.iconTarget = key;
  picker.visible = true;
};

const openImagePicker = (index: number): void => {
  picker.mode = "image";
  picker.imageIndex = index;
  picker.visible = true;
};

// 選択結果を既存の確定経路に流す (Undo 粒度不変: picker で選択 = 1 commit)。
// image モードは確定前に picker.imageIndex の妥当性を再検証する (Phase 6 品質レビュー MAJOR-2:
// picker 表示中に行削除等で index が範囲外/行不在になり得るため、黙って捨てず警告してから no-op)
const onPickerSelect = (value: string): void => {
  if (picker.mode === "icon") {
    if (picker.iconTarget === "icon") iconInput.value = value;
    else selectedIconInput.value = value;
    onIconChange(picker.iconTarget, value);
  } else {
    if (picker.imageIndex < 0 || picker.imageIndex >= imageRows.value.length) {
      console.warn(
        `PoiAttributeForm: picker.imageIndex (${picker.imageIndex}) is out of range at select time; discarding selection`,
      );
      return;
    }
    onImageChange(picker.imageIndex, value);
  }
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
// (undo/redo/Delete/menu:undo/redo) を picker 表示中は抑止するために参照する)
const pickerOpen = computed(() => picker.visible);

defineExpose({ focusName, pickerOpen });
</script>

<style scoped>
.poi-attribute-form {
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
