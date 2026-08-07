<script setup lang="ts">
// アプリ内ソースのrole別ピンポイント設定フォーム。
// - maplat: 設定項目なし（map.json 側で設定する想定）
// - builtin(osm/gsi/gsi_ortho) / tms: 同一のフォーム
//
// m6-t10 (ADR-0018): 保持するのは「マスタ値からの上書き差分」だけである。
// 未上書きのフィールドは入力欄が空で、placeholder にマスタの実効値を薄く出す。
//
// m6-t10 v1.4 (§3.8-2・IR-H-1): 提示モデルは「入力があればそれを指定、消せば既定＝マスタ値」。
// 独立した「マスタに戻す」ボタンは置かない。× は MapList/AppList の既存デザイン2種を
// 欄の種別ごとに踏襲する（新規デザインは起こさない）:
//   - 言語別テキスト → 検索バー方式（type="search" の native ×。LangResourceInput の clearable）
//   - 数値 / thumbnail / envelope → 範囲フィルタ方式（値があるときだけ隣に bi-x-lg ボタン）
//   - license / dataLicense → LicenseSelect の allowUnset（空選択肢＝マスタに従う）
//
// m6-t10 (ADR-0017): builtin の文字列出力を廃止したため、builtin への上書きも
// viewer へ届くようになった。∴ tms と別扱いする理由が無くなり、フォームを共通化した。
//
// 上書き可能フィールドの正本は appSourceModel の APP_SOURCE_OVERRIDABLE_KEYS /
// APP_SOURCE_OWNED_KEYS。各操作子に data-testid="app-source-override-<key>" を付け、
// smoke（AC7）が宣言テーブルとの一致を機械照合する。
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import EnvelopeEditorModal from "./EnvelopeEditorModal.vue";
import LangResourceInput from "./LangResourceInput.vue";
import ContextHelp from "./editor-ui/ContextHelp.vue";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import LicenseSelect from "./editor-ui/LicenseSelect.vue";
import { LICENSE_VOCABULARY } from "../utils/licenseVocabulary";
import type { LangCode } from "../utils/editorLanguages";
import {
  bboxToEnvelope,
  envelopeToBbox,
  type AppSource,
} from "../utils/appSourceModel";
import { resolveBaseMapRuntimeText } from "../utils/baseMapEditorDocument";
import type { LangResource } from "../utils/langResource";

const props = defineProps<{
  source: AppSource & { thumbnail?: string };
  currentLang: LangCode;
  defaultLang: LangCode;
  languageOptions: readonly { code: LangCode; nativeName: string }[];
  translationMode?: boolean;
  fallbackCenter?: [number, number];
  // アプリ提供範囲(参考)。利用範囲ピッカーの薄緑ガイド+スナップ対象
  appCoverageLngLats?: [number, number][] | null;
  // m6-t10: マスタの生 data。**プレースホルダ（上書きしなかった場合に効く値）専用**であり、
  // マージ結果ではない。null = マスタ欠落（§3.6 で欠落表示になる）
  masterData?: Record<string, any> | null;
}>();
const emit = defineEmits<{
  (e: "change"): void;
  (e: "select-language", language: LangCode): void;
}>();

const { t } = useTranslation();
const showEnvelopeModal = ref(false);
const uploadError = ref<string | null>(null);

const overrides = computed(() => {
  if (!props.source.overrides) props.source.overrides = {};
  return props.source.overrides as Record<string, any>;
});

const masterMissing = computed(() => props.masterData === null);
const master = computed(() => props.masterData ?? {});
const masterLang = computed(() => String(master.value.lang || master.value.defaultLang || "en"));

// マスタ側の実効値（プレースホルダ表示用）。言語別フィールドは現在言語で解決する。
function masterText(key: string): string {
  return resolveBaseMapRuntimeText(
    master.value[key] as LangResource | undefined,
    props.currentLang,
    masterLang.value,
  );
}
// m6-t10 IR2-H-1: ライセンス欄の空選択肢へ併記する「マスタに従ったときの実効値」。
// 保存値（ASCII）ではなく語彙のローカライズ済みラベルを出す（選択肢の表示と揃える）。
// マスタが未設定なら、マスタ編集フォームが同じ状態に使う文言をそのまま入れる
// （viewer 側に license のフォールバック規則は無く、空は本当に「未設定」を意味する）。
function masterLicenseLabel(key: "license" | "dataLicense"): string {
  const value = String(master.value[key] ?? "");
  if (!value) return t("mapedit.license_unset");
  const option = LICENSE_VOCABULARY.find((item) => item.value === value);
  // 語彙外の値（旧データ等）は保存値をそのまま見せる。黙って「未設定」に潰さない
  return option ? t(option.labelKey) : value;
}

function masterNumber(key: string): string {
  const value = master.value[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

// ---- 上書きの読み書き（label だけは歴史的にトップレベル。設計 §3.1）----
function readOverride(key: string): any {
  return key === "label" ? props.source.label : overrides.value[key];
}
function writeOverride(key: string, value: any) {
  if (key === "label") props.source.label = value;
  else overrides.value[key] = value;
  emit("change");
}
function clearOverride(key: string) {
  if (key === "label") delete (props.source as any).label;
  else delete overrides.value[key];
  emit("change");
}
function isOverridden(key: string): boolean {
  const value = readOverride(key);
  return value !== undefined && value !== null && value !== "";
}

// 言語別フィールド（label/title/attr/dataAttr/licenseNote/dataLicenseNote）は
// LangResourceInput が現在言語で読み書きする（マスタ編集フォームと同一部品・§3.8-8）。
// 保存は編集した言語のみ（設計 §3.5.5）。出力側でマスタとマージされる。
type LangKey = "label" | "title" | "attr" | "dataAttr" | "licenseNote" | "dataLicenseNote";

// 全言語が空になったら上書きごと解除する（空文字の上書きに意味が無いため。設計 §3.8-2）。
// LangResourceInput は全言語が空のとき {} または "" を返すので、そこで解除へ倒す。
function setLangResource(key: LangKey, value: string | Record<string, string> | undefined) {
  const isEmpty =
    value === undefined ||
    value === "" ||
    (typeof value === "object" && Object.keys(value).length === 0);
  if (isEmpty) {
    clearOverride(key);
    return;
  }
  // **上書きは必ず言語オブジェクトで保存する。** LangResourceInput は「現在言語＝既定言語 かつ
  // 既存値が文字列でない」ときプレーン文字列を emit するが、それをそのまま保存してはならない。
  // 交換形の平文は「その文書の既定言語の値」を意味し（ADR-0005・設計 §3.5.5）、
  // アプリ側の上書きの既定言語は**アプリ文書の lang**、出力時の解釈基準は**マスタの lang** である。
  // 両者が違うソース（例: アプリ ja / builtin osm は lang: "en"）では、平文で保存すると
  // 出力側が en の値として解釈し、ja を上書きしたつもりが en を書き換えてしまう。
  // 実測で確認した実害: osm の title を ja で上書きしても viewer の title.ja がマスタ値のまま残る。
  const normalized = typeof value === "string" ? { [props.currentLang]: value } : value;
  writeOverride(key, normalized);
}

// スカラー（license / dataLicense）。空文字＝「マスタに従う」なので解除へ倒す
function setScalar(key: string, value: string) {
  if (value === "") clearOverride(key);
  else writeOverride(key, value);
}
function scalarValue(key: string): string {
  const value = readOverride(key);
  return typeof value === "string" ? value : "";
}

function setNumber(key: string, raw: string) {
  const value = raw === "" ? undefined : Number(raw);
  if (value === undefined || Number.isNaN(value)) clearOverride(key);
  else writeOverride(key, value);
}

const bbox = computed(() => envelopeToBbox(overrides.value.envelopeLngLats));

function setBboxPart(index: number, raw: string) {
  const current: [number, number, number, number] = bbox.value ? [...bbox.value] as any : [0, 0, 0, 0];
  const value = Number(raw);
  if (Number.isNaN(value)) return;
  current[index] = value;
  writeOverride("envelopeLngLats", bboxToEnvelope(current));
}

function clearEnvelope() {
  clearOverride("envelopeLngLats");
}

function onEnvelopeUpdate(value: [number, number][] | null) {
  if (value) writeOverride("envelopeLngLats", value);
  else clearOverride("envelopeLngLats");
}

async function uploadThumbnail() {
  uploadError.value = null;
  // tmsソースのmapUidはTMS地図ID(登録地図のuidとは別体系。サムネイルはtmbs/{id}_menu.jpg命名のまま)
  const result = await window.appAssets.uploadTmsThumbnail(props.source.mapUid);
  if (result.err === "Canceled") return;
  if (result.err) {
    uploadError.value = t("appedit.error_invalid_image");
    return;
  }
  // m6-t10: アプリ専用アセットのアップロードは thumbnail の上書きとして保存する
  // （round4 M-5 が「二分原則で機械的にマスタ側へ倒れる」と指摘した問題は、
  //   差分保持モデルでは「ユーザーが操作子を使った ＝ 上書き」として自然に解ける）
  writeOverride("thumbnail", result.path);
  (props.source as any).thumbnail = result.fileUrl;
}
</script>

<template>
  <div>
    <!-- maplat: label のみ編集可（他のメタデータは map.json 側で設定する）。
         m6-t10 hotfix (2026-08-07): §3.8-6 の label 操作子移設で maplat 分岐が空になり、
         maplat ソースの label 編集が消えていた退行の復旧。maplat にはマスタ（ベースマップ）が
         無いためプレースホルダは出さない。空にする＝label を外す（viewer は設定ファイルの
         year へフォールバックする従来挙動）。testid は override- 接頭辞にしない
         （AC7 の照合集合は「マスタ対応の上書き可フィールド」であり、maplat の label は
         マスタとの差分ではないため） -->
    <div v-if="source.sourceType === 'maplat'" class="row g-2 mt-1">
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("appedit.source_label") }}</label>
        <LangResourceInput
          :model-value="source.label"
          :active-lang="currentLang"
          :default-lang="defaultLang"
          :language-options="languageOptions"
          :disabled="translationMode"
          clearable
          input-testid="app-source-maplat-label"
          @update:model-value="setLangResource('label', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>
    </div>

    <!-- m6-t10 §3.6: マスタが引けないソース。削除以外の操作を無効化する -->
    <DiagnosticFeedback
      v-else-if="masterMissing"
      scope="field"
      :items="[{ key: 'base-map-master-missing', severity: 'danger', message: t('appedit.error_missing_base_map_master') }]"
    />

    <!-- builtin / tms: 共通のピンポイント設定 -->
    <div v-else class="row g-2 mt-1">
      <!-- 言語別テキスト欄と帰属・ライセンス欄。**配置順はマスタ編集フォーム（BaseMapEdit:175-250）
           に揃える**（§3.8-8）: attr → dataAttr → license → licenseNote → dataLicense → dataLicenseNote。
           clearable = 検索バーと同じ native ×（§3.8-2）。空にする＝マスタへ戻る。
           アンカーは v-for で回さず**リテラルで書く**（AC7 の抽出は文字列リテラルを要求するため、
           動的バインドにすると照合から漏れる。設計レビュー round4 Info 1） -->
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("appedit.source_label") }}</label>
        <LangResourceInput
          :model-value="source.label"
          :active-lang="currentLang"
          :default-lang="defaultLang"
          :language-options="languageOptions"
          :placeholder="masterText('label')"
          :disabled="translationMode"
          clearable
          input-testid="app-source-override-label"
          @update:model-value="setLangResource('label', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("appedit.source_title") }}</label>
        <LangResourceInput
          :model-value="overrides.title"
          :active-lang="currentLang"
          :default-lang="defaultLang"
          :language-options="languageOptions"
          :placeholder="masterText('title')"
          :disabled="translationMode"
          clearable
          input-testid="app-source-override-title"
          @update:model-value="setLangResource('title', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("appedit.source_attr") }}</label>
        <LangResourceInput
          :model-value="overrides.attr"
          :active-lang="currentLang"
          :default-lang="defaultLang"
          :language-options="languageOptions"
          :placeholder="masterText('attr')"
          :disabled="translationMode"
          clearable
          input-testid="app-source-override-attr"
          @update:model-value="setLangResource('attr', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("basemap.modal.data_attr_label") }}</label>
        <LangResourceInput
          :model-value="overrides.dataAttr"
          :active-lang="currentLang"
          :default-lang="defaultLang"
          :language-options="languageOptions"
          :placeholder="masterText('dataAttr')"
          :disabled="translationMode"
          clearable
          input-testid="app-source-override-dataAttr"
          @update:model-value="setLangResource('dataAttr', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("basemap.modal.license_label") }}</label>
        <LicenseSelect
          variant="image"
          allow-unset
          unset-label-key="appedit.license_inherit"
          :unset-label-value="masterLicenseLabel('license')"
          data-testid="app-source-override-license"
          :model-value="scalarValue('license')"
          :disabled="translationMode"
          @update:model-value="setScalar('license', $event)"
        />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("basemap.modal.license_note_label") }}</label>
        <LangResourceInput
          :model-value="overrides.licenseNote"
          :active-lang="currentLang"
          :default-lang="defaultLang"
          :language-options="languageOptions"
          :placeholder="masterText('licenseNote')"
          :disabled="translationMode"
          clearable
          input-testid="app-source-override-licenseNote"
          @update:model-value="setLangResource('licenseNote', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("basemap.modal.data_license_label") }}</label>
        <LicenseSelect
          variant="data"
          allow-unset
          unset-label-key="appedit.license_inherit"
          :unset-label-value="masterLicenseLabel('dataLicense')"
          data-testid="app-source-override-dataLicense"
          :model-value="scalarValue('dataLicense')"
          :disabled="translationMode"
          @update:model-value="setScalar('dataLicense', $event)"
        />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("basemap.modal.data_license_note_label") }}</label>
        <LangResourceInput
          :model-value="overrides.dataLicenseNote"
          :active-lang="currentLang"
          :default-lang="defaultLang"
          :language-options="languageOptions"
          :placeholder="masterText('dataLicenseNote')"
          :disabled="translationMode"
          clearable
          input-testid="app-source-override-dataLicenseNote"
          @update:model-value="setLangResource('dataLicenseNote', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>

      <!-- 数値2欄。× は範囲フィルタ方式（値があるときだけ隣に bi-x-lg ボタン）。§3.8-2。
           type="search" にしないのは min/max/スピナー/数値入力モードを失うため -->
      <div class="col-md-3">
        <label class="form-label small mb-0">{{ t("appedit.min_zoom") }}</label>
        <div class="d-flex align-items-center gap-1">
          <input :value="overrides.minZoom ?? ''" type="number" min="0" max="25" class="form-control form-control-sm" :placeholder="masterNumber('minZoom')" :disabled="translationMode" data-testid="app-source-override-minZoom" @change="setNumber('minZoom', ($event.target as HTMLInputElement).value)">
          <button v-if="isOverridden('minZoom')" type="button" class="btn btn-outline-secondary btn-sm" :disabled="translationMode" :title="t('appedit.override_reset')" :aria-label="t('appedit.override_reset')" data-testid="app-source-clear-minZoom" @click="clearOverride('minZoom')">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="col-md-3">
        <label class="form-label small mb-0">{{ t("appedit.max_zoom") }}</label>
        <div class="d-flex align-items-center gap-1">
          <input :value="overrides.maxZoom ?? ''" type="number" min="1" max="25" class="form-control form-control-sm" :placeholder="masterNumber('maxZoom')" :disabled="translationMode" data-testid="app-source-override-maxZoom" @change="setNumber('maxZoom', ($event.target as HTMLInputElement).value)">
          <button v-if="isOverridden('maxZoom')" type="button" class="btn btn-outline-secondary btn-sm" :disabled="translationMode" :title="t('appedit.override_reset')" :aria-label="t('appedit.override_reset')" data-testid="app-source-clear-maxZoom" @click="clearOverride('maxZoom')">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <!-- m6-t10 §3.3: url の上書き欄は撤去した。ベースマップの同一性そのものを変える操作であり、
           マスタ側で別のベースマップを作るべきもの。provider では m6-t9 §3.1 で既に非表示だった -->
      <div class="col-md-6 d-flex align-items-end" data-testid="app-source-url-note">
        <ContextHelp :text="t('appedit.source_url_master_note')" :ariaLabel="t('appedit.source_url_master_note')" />
      </div>
      <div class="col-md-6">
        <label class="form-label small mb-0 d-flex align-items-center gap-1">
          {{ t("appedit.thumbnail") }}
          <ContextHelp :text="t('appedit.thumbnail_note')" :ariaLabel="t('appedit.thumbnail_note')" />
        </label>
        <div class="d-flex align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="translationMode" data-testid="app-source-override-thumbnail" @click="uploadThumbnail">
            {{ t("appedit.upload") }}
          </button>
          <button v-if="isOverridden('thumbnail')" type="button" class="btn btn-outline-secondary btn-sm" :disabled="translationMode" :title="t('appedit.override_reset')" :aria-label="t('appedit.override_reset')" data-testid="app-source-clear-thumbnail" @click="clearOverride('thumbnail')">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
        <DiagnosticFeedback v-if="uploadError" scope="field" :items="[{ key: 'thumbnail-upload', severity: 'danger', message: uploadError }]" />
      </div>

      <!-- overlay専用設定（マスタに対応物が無く、常にアプリ所有） -->
      <template v-if="source.role === 'overlay'">
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_x_shift") }}</label>
          <input :value="overrides.mercatorXShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" :disabled="translationMode" data-testid="app-source-override-mercatorXShift" @change="setNumber('mercatorXShift', ($event.target as HTMLInputElement).value)">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-0">{{ t("appedit.mercator_y_shift") }}</label>
          <input :value="overrides.mercatorYShift ?? ''" type="number" step="0.01" class="form-control form-control-sm" :disabled="translationMode" data-testid="app-source-override-mercatorYShift" @change="setNumber('mercatorYShift', ($event.target as HTMLInputElement).value)">
        </div>
      </template>

      <!-- 利用範囲(envelopeLngLats): base/overlay共通。既定は空で、設定時のみViewerへ渡る(ADR-0004)。
           m6-t10 §3.8-4: プレースホルダにマスタの存在範囲(coverageLngLats)は出さない。
           存在範囲と利用範囲は別概念であり、未設定時に効くのは「範囲指定なし」であって存在範囲ではない。
           v1.4 §3.8-2: 解除は範囲フィルタ方式の×へ揃える（MapList/AppList の範囲フィルタ解除と同型） -->
      <div class="col-12">
        <label class="form-label small mb-0">{{ t("appedit.envelope") }}</label>
        <div class="d-flex align-items-center gap-2 flex-wrap" data-testid="app-source-override-envelopeLngLats">
          <div v-for="(labelKey, index) in ['envelope_west', 'envelope_south', 'envelope_east', 'envelope_north']" :key="labelKey" class="envelope-input">
            <span class="small text-muted">{{ t(`appedit.${labelKey}`) }}</span>
            <input
              :value="bbox ? bbox[index] : ''"
              type="number"
              step="0.000001"
              class="form-control form-control-sm"
              :disabled="translationMode"
              @change="setBboxPart(index, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <button type="button" class="btn btn-sm btn-outline-primary" :disabled="translationMode" @click="showEnvelopeModal = true">
            {{ t("appedit.envelope_pick") }}
          </button>
          <button v-if="bbox" type="button" class="btn btn-outline-secondary btn-sm" :disabled="translationMode" :title="t('appedit.envelope_clear')" :aria-label="t('appedit.envelope_clear')" data-testid="app-source-clear-envelopeLngLats" @click="clearEnvelope">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>

    <EnvelopeEditorModal
      v-if="showEnvelopeModal"
      :model-value="overrides.envelopeLngLats ?? null"
      :coverage-lng-lats="master.coverageLngLats ?? null"
      :app-coverage-lng-lats="appCoverageLngLats ?? null"
      :fallback-center="fallbackCenter"
      @update:model-value="onEnvelopeUpdate"
      @close="showEnvelopeModal = false"
    />
  </div>
</template>

<style scoped>
.envelope-input {
  display: flex;
  align-items: center;
  gap: 4px;
}
.envelope-input input {
  width: 8.5rem;
}
</style>
