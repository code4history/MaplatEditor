<script setup lang="ts">
// アプリ内ソースのrole別ピンポイント設定フォーム。
// - maplat: 表示ラベルのみ（他のメタデータは map.json 側で設定する想定）
// - builtin(osm/gsi/gsi_ortho) / tms: 同一のフォーム
//
// m6-t10 (ADR-0018): 保持するのは「マスタ値からの上書き差分」だけである。
// 未上書きのフィールドは入力欄が空で、placeholder にマスタの実効値を薄く出す。
//
// m19-t3 (m19 §4.4 の凍結契約): アプリ文書がベースマップマスタに対して持てる上書きは
// **表示ラベル 1 個**へ縮んだ。表題・帰属・ライセンス・ズーム範囲・サムネイルはマスタが正本
// であり、アプリごとに固定するとマスタ側の訂正（とくにライセンス表記）が既存アプリへ届かない。
// ∴ 操作子ごと撤去した。残るのは表示ラベル（唯一の上書き）と、マスタに対応物が無い
// アプリ所有 3 キー（利用範囲 / mercator シフト 2 欄）だけである。
//
// url の上書き欄は m6-t10 §3.3 で撤去済みで、その旨の注記（appedit.source_url_master_note /
// data-testid="app-source-url-note"）が残っていたが、**人間の指示により削除した**（m19-t3）。
// 上書き欄がすべて消えた画面では「変更できない」注記だけが浮き、隣接する欄の説明と誤読される。
// 代替の説明は UI へ置かない。url がマスタ管理であることは ADR-0018 と ADR-0017 が正本である。
//
// 提示モデルは「入力があればそれを指定、消せば既定＝マスタ値」。独立した「マスタに戻す」
// ボタンは置かない。× は MapList/AppList の既存デザインを欄の種別ごとに踏襲する:
//   - 言語別テキスト → 検索バー方式（type="search" の native ×。LangResourceInput の clearable）
//   - 利用範囲 → 範囲フィルタ方式（値があるときだけ隣に bi-x-lg ボタン）
//
// **translationMode の適用範囲（m19-t3・人間検証 AC15）**: 翻訳モード（活性言語 ≠ 文書の既定言語）
// で無効化するのは**言語に依存しない構造的な値だけ**である。言語別テキスト（表示ラベル）は
// 翻訳モードでこそ編集する対象なので無効化してはならない。これはリポジトリ共通の規律であり、
// BaseMapEdit.vue が構造的な欄（structuralDisabled = readOnly || translationMode || …）と
// 言語別欄（translationMode を意図的に外した式）で disabled を書き分けているのが原型である。
// MapEdit.vue の map-title / map-label、AppEdit.vue の app-title / app-manifest-name も同様に
// disabled を持たない。本コンポーネントだけが表示ラベルへ translationMode を掛けており、
// 「チップは出るのに翻訳を入力できない」欠陥になっていた（base 74c3806 から存在）。
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
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import ContextHelp from "./editor-ui/ContextHelp.vue";
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
  // アプリ対象範囲。利用範囲ピッカーの薄緑ガイド+スナップ対象
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
// ---- 上書きの書き込み（label だけは歴史的にトップレベル。設計 §3.1）----
// m19-t3: 読み出し側の `readOverride` は唯一の利用者だった isOverridden / scalarValue が
// 廃止されて未使用になった（vue-tsc の noUnusedLocals が検出）。§4.5 (a) と同じ判断で削除する。
// 読み出しは template が `overrides.xxx` / `source.label` を直接見る形へ一本化されている。
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
// 言語別フィールド（m19-t3 以後は label のみ）は LangResourceInput が現在言語で読み書きする
// （マスタ編集フォームと同一部品・§3.8-8）。保存は編集した言語のみ（設計 §3.5.5）。
// 出力側でマスタとマージされる。
type LangKey = "label";

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

// 数値（mercator シフト 2 欄）。空欄＝上書きなしなので解除へ倒す
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

// m19-t3: 「存在範囲からコピー」。マスタの存在範囲（coverageLngLats）を利用範囲へ写す。
// ADR-0004 が退けたのは coverage の**自動継承**であり、ユーザーの明示操作は想定内である
// （ADR 自身が「usage = coverage は 1 回の大きなドラッグ」と述べている。t3 はそれを 1 クリックにする）。
// 活性条件は BaseMapEdit の「存在範囲から生成」（basemap.generate_icon）の先例に揃え、
// v-if ではなく :disabled にする（存在範囲を登録すれば使えることを見せる必要があるため）。
const coverageAvailable = computed(
  () => Array.isArray(master.value.coverageLngLats) && master.value.coverageLngLats.length > 0,
);

function copyCoverageToEnvelope() {
  const coverage = master.value.coverageLngLats;
  if (!Array.isArray(coverage) || coverage.length === 0) return;
  // 生の 4 隅をそのまま写す（bbox へ潰すと非矩形の存在範囲で情報が落ちる）。
  // マスタ配列の参照をアプリ文書へ差し込まないよう深いコピーを渡す。
  // EnvelopeEditorModal の確定（onEnvelopeUpdate）と同じ writeOverride 経路を通し、
  // 履歴（change emit → recordHistory）も同一に保つ。
  writeOverride("envelopeLngLats", coverage.map((point: [number, number]) => [...point]));
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
          clearable
          input-testid="app-source-override-label"
          @update:model-value="setLangResource('label', $event)"
          @select-language="emit('select-language', $event)"
        />
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
        <label class="form-label small mb-0 d-flex align-items-center gap-1">
          {{ t("appedit.envelope") }}
          <ContextHelp
            data-testid="app-source-envelope-help"
            :title="t('appedit.envelope')"
            :text="t('appedit.envelope_help')"
            :ariaLabel="t('appedit.envelope_help')"
          />
        </label>
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
          <!-- m19-t3: マスタの存在範囲を利用範囲へ写す。存在範囲が未登録でもボタンは見せ、
               :disabled で不活性にする（BaseMapEdit の「存在範囲から生成」と同じ形）。
               接頭辞は app-source-copy- — envelopeLngLats の補助操作であって独立キーではないため、
               AC7 の照合集合（app-source-override-*）へは混入させない -->
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            :disabled="translationMode || !coverageAvailable"
            data-testid="app-source-copy-coverage-envelopeLngLats"
            @click="copyCoverageToEnvelope"
          >
            {{ t("appedit.envelope_copy_coverage") }}
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
