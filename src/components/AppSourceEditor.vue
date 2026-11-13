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
import { computed, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import EnvelopeEditorModal from "./EnvelopeEditorModal.vue";
import LangResourceInput from "./LangResourceInput.vue";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import ContextHelp from "./editor-ui/ContextHelp.vue";
import type { DiagnosticItem } from "./editor-ui/editorUiTypes";
import type { LangCode } from "../utils/editorLanguages";
import {
  bboxToEnvelope,
  envelopeToBbox,
  type AppSource,
} from "../utils/appSourceModel";
import {
  bboxEquals,
  COORD_FIELDS,
  evaluateCoordInputs,
  NO_COORD_INVALID,
  round6,
  type CoordField,
} from "../utils/envelopeCoordInput";
import { isProviderKind, resolveBaseMapRuntimeText } from "../utils/baseMapEditorDocument";
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
  // #85: アプリのオフライン表示（キャッシュ）が働くか。判定は親（AppEdit の cacheUsable）の 1 か所だけ。
  // 偽のとき「オフライン表示から外す」は不活性にし、理由を ? で出す（値は消さない）
  cacheEnabled?: boolean;
}>();
const emit = defineEmits<{
  // nov26-m6-t4（#26）: source は prop なので子からは書き換えない。変更は新しいオブジェクトを
  // 組んで親へ渡す（v-model:source 相当。親は v-for の別名なので @update:source で受ける）
  (e: "update:source", value: AppSource & { thumbnail?: string }): void;
  (e: "change"): void;
  (e: "select-language", language: LangCode): void;
}>();

const { t } = useTranslation();
const showEnvelopeModal = ref(false);

// 読むだけ。直す前は未定義のとき {} を prop へ生やしていたが（computed の副作用）、
// 書き込み側（writeOverride / clearOverride）が overrides を必ず持つ新しいオブジェクトを渡すので、
// 保存される形（overrides が空なら {} を残す）は変わらない
const overrides = computed(() => (props.source.overrides ?? {}) as Record<string, any>);

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
//
// nov26-m6-t4（#26）: prop を直接書き換えず、新しいオブジェクトを update:source で渡してから
// change を出す（親の recordHistory が変更後の値を記録する順序は直す前と同じ）。
// 直す前の形に合わせる: 直す前は builtin / tms の分岐を描くたびに computed が overrides: {} を
// 生やしていた ∴ maplat 以外のソースは書き込み後に必ず overrides を持つ（空なら {}）。
// maplat の分岐は overrides を読まないので生えない（ここでも生やさない）。
function copySource(): AppSource & { thumbnail?: string } {
  if (props.source.sourceType === "maplat") return { ...props.source };
  return { ...props.source, overrides: { ...overrides.value } };
}
function commitSource(next: AppSource & { thumbnail?: string }) {
  emit("update:source", next);
  emit("change");
}
function writeOverride(key: string, value: any) {
  const next = copySource();
  if (key === "label") next.label = value;
  else next.overrides = { ...next.overrides, [key]: value };
  commitSource(next);
}
function clearOverride(key: string) {
  const next = copySource();
  if (key === "label") delete next.label;
  else if (next.overrides) delete next.overrides[key];
  commitSource(next);
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

// 書誌の表の出し方（maplat のソースだけ）。「既定」を選ぶとキーごと外し、
// Viewer の既定（"hidden"）に委ねる。
function setIiifMetadata(raw: string) {
  const next = copySource();
  if (raw === "hidden" || raw === "all") next.iiifMetadata = raw;
  else delete next.iiifMetadata;
  commitSource(next);
}

// #85: オフライン表示から外す。アプリ所有の値なのでトップレベルに置き、true だけを持つ
// （外すとキーごと消す ＝ 既定の出力を変えない）。
function setNoCache(checked: boolean) {
  const next = copySource();
  if (checked) next.noCache = true;
  else delete next.noCache;
  commitSource(next);
}

// 欄を出すのは、Viewer が Weiwudi へ登録しうる地図だけ: Maplat の地図と、provider でないベースマップ
// （組み込み・tms）。provider（Google・Mapbox・MapLibre）は元から登録されないので出さない。
// マスタが引けないソースは欠落の表示だけにする（他の欄と同じ）。
const showNoCache = computed(() =>
  props.source.sourceType === "maplat" || (!masterMissing.value && !isProviderKind(master.value.kind)),
);

// 数値（mercator シフト 2 欄）。空欄＝上書きなしなので解除へ倒す
function setNumber(key: string, raw: string) {
  const value = raw === "" ? undefined : Number(raw);
  if (value === undefined || Number.isNaN(value)) clearOverride(key);
  else writeOverride(key, value);
}

const bbox = computed(() => envelopeToBbox(overrides.value.envelopeLngLats));

// 利用範囲の 4 欄（西・南・東・北）。小窓（EnvelopeEditorModal）と同じ検査・同じ並びで扱う。
// 入力途中の文字列を失わないよう、反映は Enter か欄から離れたときだけに限る
const coordTexts = ref<Record<CoordField, string>>({ west: "", south: "", east: "", north: "" });
// 入力の検証エラー（保存せず理由だけ出す）と、存在範囲へ切り詰めた事実の通知
const coordDiagnostics = ref<DiagnosticItem[]>([]);
const coordInvalid = ref<Record<CoordField, boolean>>({ ...NO_COORD_INVALID });
const cropNotice = ref(false);
// 自分で反映した矩形。自分の反映と、他の操作（undo・「存在範囲からコピー」等）の変化を見分ける
const appliedBbox = ref<[number, number, number, number] | null>(null);
// 前に範囲から欄へ同期したときの文字列。欄が同期のときから変わっていなければ、
// Enter や欄から離れても何も書き込まない（保存済みの値の桁や非矩形の形を黙って変えない）
const syncedTexts = ref<Record<CoordField, string>>({ west: "", south: "", east: "", north: "" });

// マスタの存在範囲。小窓と同じく、入れた値はその内側へ切り詰める
const coverageBbox = computed<[number, number, number, number] | null>(() =>
  envelopeToBbox(master.value.coverageLngLats ?? null),
);

function syncFieldsFromBbox(value: [number, number, number, number] | null) {
  for (const field of COORD_FIELDS) {
    const index = field === "west" ? 0 : field === "south" ? 1 : field === "east" ? 2 : 3;
    coordTexts.value[field] = value ? String(round6(value[index])) : "";
  }
  syncedTexts.value = { ...coordTexts.value };
}

function textsUnchangedSinceSync(): boolean {
  return COORD_FIELDS.every((field) => coordTexts.value[field] === syncedTexts.value[field]);
}

// 外からの操作（「地図で指定」の確定・「存在範囲からコピー」）で範囲を決めたとき、
// 欄を範囲から同期し直し、残っていた理由と切り詰めの通知を消す。値が今と同じだと
// watch(bbox) は動かないため、ここで直接そろえる
function resetCoordFieldsTo(value: [number, number][] | null) {
  appliedBbox.value = null;
  cropNotice.value = false;
  setCoordFeedback([], NO_COORD_INVALID);
  syncFieldsFromBbox(envelopeToBbox(value));
}

function setCoordFeedback(items: DiagnosticItem[], invalid: Record<CoordField, boolean>) {
  coordDiagnostics.value = items;
  coordInvalid.value = { ...invalid };
}

// 矩形の変化を入力欄へ反映する（反映・クリア・undo・「存在範囲からコピー」すべて）
watch(bbox, (value, previous) => {
  // 値の変わらない再計算（他の欄の編集でソースごと差し替わる等）では入力途中の文字列を消さない
  const sameValue = (value == null && previous == null)
    || (value != null && previous != null && bboxEquals(value, previous));
  if (sameValue) return;
  syncFieldsFromBbox(value);
  // 自分で反映した直後は欄の表記を半角へ直すだけで、切り詰めの通知は残す
  if (value != null && appliedBbox.value != null && bboxEquals(value, appliedBbox.value)) return;
  appliedBbox.value = null;
  cropNotice.value = false;
  setCoordFeedback([], NO_COORD_INVALID);
}, { immediate: true });

// 経緯度の入力を反映する（Enter か欄から離れたとき）。小窓と同じ検査・同じ挙動
function applyFieldInputs() {
  // 欄が前の同期から変わっていなければ何もしない（書き込みも undo の履歴も増やさない）。
  // 入れ直して元の文字へ戻した場合に残る理由だけは消す
  if (textsUnchangedSinceSync()) {
    setCoordFeedback([], NO_COORD_INVALID);
    return;
  }
  const outcome = evaluateCoordInputs(coordTexts.value, coverageBbox.value, t);
  if (outcome.kind === "clear") {
    // 欄が空 = 範囲なし。「範囲をクリア」（×）と同じ扱いにする（未設定なら何もしない）
    if (bbox.value) clearEnvelope();
    else {
      cropNotice.value = false;
      setCoordFeedback([], NO_COORD_INVALID);
    }
    return;
  }
  if (outcome.kind === "invalid") {
    // 正しくない値は保存せず、理由だけ出す（保存済みの値は消さない）。
    // 前の切り詰めの通知は、いま出す理由と関係が無いので下ろす
    cropNotice.value = false;
    setCoordFeedback(outcome.diagnostics, outcome.invalid);
    return;
  }
  // 今の範囲を 6 桁へ丸めた値と同じなら書き込まない（Enter 直後に change が来ても二度反映しない。
  // 保存済みの値が 7 桁以上でも、非矩形の形でも、同じ範囲を入れ直しただけなら変えない。
  // 切り詰めた通知も消さない）
  if (bbox.value && bboxEquals(roundBbox(bbox.value), outcome.cropped)) {
    syncFieldsFromBbox(bbox.value);
    setCoordFeedback([], NO_COORD_INVALID);
    return;
  }
  appliedBbox.value = outcome.cropped;
  cropNotice.value = outcome.wasCropped;
  writeOverride("envelopeLngLats", bboxToEnvelope(outcome.cropped));
  setCoordFeedback([], NO_COORD_INVALID);
}

function roundBbox(value: [number, number, number, number]): [number, number, number, number] {
  return [round6(value[0]), round6(value[1]), round6(value[2]), round6(value[3])];
}

const diagnosticItems = computed<DiagnosticItem[]>(() => [
  ...coordDiagnostics.value,
  ...(cropNotice.value ? [{ key: "cropped", severity: "warning" as const, message: t("appedit.envelope_coord_cropped") }] : []),
]);

function clearEnvelope() {
  appliedBbox.value = null;
  cropNotice.value = false;
  setCoordFeedback([], NO_COORD_INVALID);
  clearOverride("envelopeLngLats");
}

function onEnvelopeUpdate(value: [number, number][] | null) {
  resetCoordFieldsTo(value);
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
  const copied = coverage.map((point: [number, number]) => [...point] as [number, number]);
  resetCoordFieldsTo(copied);
  writeOverride("envelopeLngLats", copied);
}
</script>

<template>
  <div>
    <!-- maplat: label のみ編集可（他のメタデータは map.json 側で設定する）。
         m6-t10 hotfix (2026-08-07): §3.8-6 の label 操作子移設で maplat 分岐が空になり、
         maplat ソースの label 編集が消えていた退行の復旧。
         nov26-m6-t4（#108）: maplat にはベースマップのマスタは無いが、viewer はアプリの label が
         無ければ地図の設定の label を使う。∴ 親が masterData に地図の文書（label / lang）を渡し、
         ベースマップの分岐と同じくその label をプレースホルダに出す。空にする＝label を外す
         （viewer は地図の label へフォールバックする）。testid は override- 接頭辞にしない
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
          :placeholder="masterText('label')"
          clearable
          input-testid="app-source-maplat-label"
          @update:model-value="setLangResource('label', $event)"
          @select-language="emit('select-language', $event)"
        />
      </div>
      <!-- IIIF から書誌を写した地図は、アプリにその書誌の表を出させられる。
           出し方はマスタ（地図）に対応物が無いアプリ所有の設定なので、上書きの差分
           （overrides）ではなくソースのトップレベルに置く。testid も override- 接頭辞にしない。 -->
      <div class="col-md-6">
        <label class="form-label small mb-0">{{ t("appedit.source_iiif_metadata") }}</label>
        <select
          class="form-select form-select-sm"
          :value="source.iiifMetadata ?? ''"
          :disabled="translationMode"
          data-testid="app-source-iiif-metadata"
          @change="setIiifMetadata(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ t("appedit.source_iiif_metadata_default") }}</option>
          <option value="hidden">{{ t("appedit.source_iiif_metadata_hidden") }}</option>
          <option value="all">{{ t("appedit.source_iiif_metadata_all") }}</option>
        </select>
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
        <!-- 経緯度の直接入力。並び・検査・理由の出し方は小窓（EnvelopeEditorModal）と同じ:
             経度（西・東）と緯度（南・北）の 2 組、反映は Enter か欄から離れたときだけ。
             正しくない値は保存せず理由を出し、存在範囲があれば内側へ切り詰めて知らせる -->
        <div class="d-flex align-items-end gap-3 flex-wrap" data-testid="app-source-override-envelopeLngLats">
          <div>
            <div class="form-label small mb-1">{{ t("mapedit.longitude") }}</div>
            <div class="d-flex gap-2">
              <div class="envelope-input">
                <span class="small text-muted">{{ t("appedit.envelope_west") }}</span>
                <input
                  v-model="coordTexts.west"
                  type="text"
                  inputmode="decimal"
                  class="form-control form-control-sm"
                  :class="{ 'is-invalid': coordInvalid.west }"
                  :disabled="translationMode"
                  data-testid="app-source-envelope-west"
                  @change="applyFieldInputs"
                  @keydown.enter="applyFieldInputs"
                >
              </div>
              <div class="envelope-input">
                <span class="small text-muted">{{ t("appedit.envelope_east") }}</span>
                <input
                  v-model="coordTexts.east"
                  type="text"
                  inputmode="decimal"
                  class="form-control form-control-sm"
                  :class="{ 'is-invalid': coordInvalid.east }"
                  :disabled="translationMode"
                  data-testid="app-source-envelope-east"
                  @change="applyFieldInputs"
                  @keydown.enter="applyFieldInputs"
                >
              </div>
            </div>
          </div>
          <div>
            <div class="form-label small mb-1">{{ t("mapedit.latitude") }}</div>
            <div class="d-flex gap-2">
              <div class="envelope-input">
                <span class="small text-muted">{{ t("appedit.envelope_south") }}</span>
                <input
                  v-model="coordTexts.south"
                  type="text"
                  inputmode="decimal"
                  class="form-control form-control-sm"
                  :class="{ 'is-invalid': coordInvalid.south }"
                  :disabled="translationMode"
                  data-testid="app-source-envelope-south"
                  @change="applyFieldInputs"
                  @keydown.enter="applyFieldInputs"
                >
              </div>
              <div class="envelope-input">
                <span class="small text-muted">{{ t("appedit.envelope_north") }}</span>
                <input
                  v-model="coordTexts.north"
                  type="text"
                  inputmode="decimal"
                  class="form-control form-control-sm"
                  :class="{ 'is-invalid': coordInvalid.north }"
                  :disabled="translationMode"
                  data-testid="app-source-envelope-north"
                  @change="applyFieldInputs"
                  @keydown.enter="applyFieldInputs"
                >
              </div>
            </div>
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
        <DiagnosticFeedback v-if="diagnosticItems.length" scope="field" :items="diagnosticItems" data-testid="app-source-envelope-diagnostics" />
      </div>

    </div>

    <!-- #85: オフライン表示から外す（Maplat の地図とベースマップで同じ 1 つの欄）。
         アプリ所有の値なので testid は override- 接頭辞にしない（AC7 の照合集合に入れない）。
         アプリのキャッシュが働かないときは不活性にする。? は説明の 1 つだけで、使える条件は説明の文の末尾に書く
         （同じ画面の「オフライン表示（キャッシュ）」の欄と同じ形。赤字にしない） -->
    <div v-if="showNoCache" class="row g-2 mt-1">
      <div class="col-12">
        <label class="form-check d-inline-flex align-items-center gap-1 mb-0">
          <input
            type="checkbox"
            class="form-check-input mt-0"
            data-testid="app-source-no-cache"
            :checked="source.noCache === true"
            :disabled="translationMode || !cacheEnabled"
            @change="setNoCache(($event.target as HTMLInputElement).checked)"
          >
          {{ t("appedit.source_no_cache") }}
          <ContextHelp
            data-testid="app-source-no-cache-help"
            :text="t('appedit.source_no_cache_note')"
            :ariaLabel="t('editor_ui.help_about', { name: t('appedit.source_no_cache') })"
          />
        </label>
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
