<template>
  <!-- 高さは親 (PoiEdit) の .poi-raw-pane { height: 40% } が与える。ここに h-100 を付けると
       Bootstrap の !important が 40% を打ち消して中央カラム全高を占有し、flex-shrink:0 と
       相まって地図ペイン (flex-grow) が 0px に潰れる (2026-07-11 実機バグ) -->
  <div class="d-flex flex-column overflow-hidden bg-white border-top text-start">
    <!-- ヘッダ行: タイトル + dirty notice + 破棄/適用ボタン -->
    <div class="d-flex align-items-center gap-2 px-3 py-1 border-bottom flex-shrink-0">
      <span class="fw-bold small">{{ t("poiedit.raw_pane") }}</span>
      <div class="ms-auto d-flex gap-1">
        <button
          v-if="localDirty"
          type="button"
          class="btn btn-sm btn-outline-secondary"
          @click="discard"
        >
          {{ t("poiedit.raw_discard") }}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="!canApply"
          @click="apply"
        >
          {{ t("poiedit.raw_apply") }}
        </button>
      </div>
    </div>

    <!-- 診断領域: 規模ガード / 構文エラー / validation エラー / 適用後 warning -->
    <!-- M12-T11 (R3/C36-C40, R5/D3): alert 直書きから DF section へ。warning は黄色三角で danger と区別 -->
    <div
      v-if="localDirty || sizeGuard || parseError || applyError || applyIssues.length || applyWarnings.length"
      class="px-3 py-1 flex-shrink-0 overflow-auto poi-raw-diagnostics"
    >
      <DiagnosticFeedback
        v-if="localDirty"
        scope="section"
        :items="[{ key: 'dirty', severity: 'warning', message: t('poiedit.raw_dirty_notice') + (editorUpdatedSinceDirty ? ' ' + t('poiedit.raw_stale_notice') : '') }]"
      />
      <DiagnosticFeedback v-if="sizeGuard" scope="section" :items="[{ key: 'size-guard', severity: 'warning', message: t('poiedit.raw_size_guard') }]" />
      <DiagnosticFeedback v-if="parseError" scope="section" :items="[{ key: 'parse', severity: 'danger', message: parseError }]" />
      <DiagnosticFeedback v-if="applyError" scope="section" :items="[{ key: 'apply', severity: 'danger', message: applyError }]" />
      <DiagnosticFeedback
        v-if="applyIssues.length"
        scope="section"
        :items="applyIssues.map((issue, index) => ({ key: `issue-${index}`, severity: 'danger', message: issueMessage(issue, t) }))"
      />
      <DiagnosticFeedback
        v-if="applyWarnings.length"
        scope="section"
        :items="applyWarnings.map((issue, index) => ({ key: `warn-${index}`, severity: 'warning', message: issueMessage(issue, t) }))"
      />
    </div>

    <!-- raw GeoJSON 本体。規模ガード (POI-141) / remote ReadOnly では readonly -->
    <textarea
      v-model="text"
      class="form-control flex-grow-1 font-monospace rounded-0 border-0 poi-raw-textarea"
      spellcheck="false"
      :readonly="isReadOnly"
      @input="onInput"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
// raw GeoJSON 双方向ペイン (Phase 5 Task 2, 仕様 §3.3 POI-136/141)。
// 表示: session snapshot → toExportForm (roundCoordinates:false — 丸めた表示を書き戻すと
// Write Store の座標が静かに劣化するため) を pretty JSON で textarea へ。snapshot watch で
// 再生成するが、ユーザー編集中 (localDirty) は上書きせず、非表示 (visible=false) 中は
// 大規模 FC の JSON.stringify を毎 commit 走らせないため再生成を止める。
// Apply: ①JSON.parse ②fromExportForm (level==='error' があれば適用不可、warning のみは
// 適用可 + 警告表示) ③parsed.id→slug / parsed.name→title / 他トップレベル→layerMeta
// ④session.commit 1 回 (= 1 Undo、仕様 §5)。
import { computed, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import type { PoiEditSession, PoiEditState } from "../composables/usePoiEditSession";
import type { LangResource } from "../utils/langResource";
import { normalizeLangResource } from "../utils/langResource";
import {
  SCALE_BYTE_SIZE,
  SCALE_FEATURE_COUNT,
  fromExportForm,
  toExportForm,
  type PoiValidationIssue,
  resolvePoiSourceLanguage,
} from "../utils/poiGeoJson";
import { issueMessage } from "../utils/poiSourceMessages";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";

const props = defineProps<{
  session: PoiEditSession;
  /** remote ソース (エディタ全体が read-only) */
  readOnly: boolean;
  /** ペインが開いているか。false の間は表示再生成を止める */
  visible: boolean;
  /** 翻訳モードでは共通属性も含むRaw JSONのApplyを禁止する */
  translationMode: boolean;
}>();

const { t } = useTranslation();

// slug 文字種 (PoiEdit / PoiSourceList と同一ルール、仕様 §6)
const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/;

const text = ref("");
// textarea がユーザー編集で snapshot 表示から乖離しているか。true の間は再生成で上書きしない
const localDirty = ref(false);
// localDirty 化した時点の snapshot 参照 (shallowRef のオブジェクト同一性判定用)。以後 session.state.value
// が別参照に差し替わったら (= エディタ側で undo/redo・他ペイン編集等が起きた) stale notice を出す
// (Phase 5 品質レビュー MINOR)。Apply 自体は許可のまま、上書きのリスクだけを警告する
const dirtySnapshot = ref<PoiEditState | null>(null);
const editorUpdatedSinceDirty = computed(
  () => localDirty.value && props.session.state.value !== dirtySnapshot.value,
);
const parseError = ref<string | null>(null);
const applyError = ref<string | null>(null);
const applyIssues = ref<PoiValidationIssue[]>([]);
const applyWarnings = ref<PoiValidationIssue[]>([]);

// 規模ガード (POI-141): feature 数 or 表示 JSON サイズが POI-121 閾値超で textarea を read-only に。
// 閾値は poiGeoJson の export 定数 (再定義禁止)。判定の byte size は pretty-print された export 形
// (text.value、インデント込み) の文字列長。validateFeatureCollection 側の compact 内部形基準
// (JSON.stringify(fc)) より大きく出るため、実データの規模超過より先に安全側で発火する。
// guard 中は編集不可のため localDirty にはならない (text = 表示 JSON)
const sizeGuard = computed(() => {
  const state = props.session.state.value;
  if (!state) return false;
  return (
    state.features.length > SCALE_FEATURE_COUNT ||
    text.value.length > SCALE_BYTE_SIZE
  );
});

const isReadOnly = computed(() => props.readOnly || props.translationMode || sizeGuard.value);
const canApply = computed(() => localDirty.value && !isReadOnly.value);

function clearMessages(): void {
  parseError.value = null;
  applyError.value = null;
  applyIssues.value = [];
  applyWarnings.value = [];
}

// 現在 snapshot → export 形 pretty JSON。toExportForm は layerMeta (fc トップレベル foreign
// member) を pass-through するため、表示→Apply の往復で layer metadata は保存される
function regenerate(): void {
  const state = props.session.state.value;
  if (!state) {
    text.value = "";
    return;
  }
  const exportFc = toExportForm(props.session.toSaveFc(), state.slug, state.title, {
    roundCoordinates: false,
    defaultLang: state.lang,
  });
  text.value = JSON.stringify(exportFc, null, 2);
  localDirty.value = false;
  dirtySnapshot.value = null;
}

// snapshot (shallowRef 同一性) / 表示状態の watch。非表示中・ローカル編集中は再生成しない
watch(
  [() => props.session.state.value, () => props.visible],
  () => {
    if (!props.visible) return;
    if (localDirty.value) return;
    regenerate();
  },
  { immediate: true },
);

function onInput(): void {
  // dirty 化した瞬間の snapshot 参照のみを捕捉 (以後の入力では上書きしない)
  if (!localDirty.value) {
    dirtySnapshot.value = props.session.state.value;
  }
  localDirty.value = true;
  clearMessages();
}

// 「破棄して再生成」: ローカル編集を捨てて最新 snapshot 表示へ戻す
function discard(): void {
  clearMessages();
  regenerate();
}

// Apply (設計コントラクト 4 手順)。成功時は session.commit 1 回 = 1 Undo (仕様 §5)
function apply(): void {
  clearMessages();
  const state = props.session.state.value;
  if (!state || !canApply.value) return;

  // ① JSON.parse 失敗 → 構文エラー表示 (position 等のメッセージを添えて)、適用しない
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value);
  } catch (e) {
    parseError.value = `${t("poiedit.raw_parse_error")}: ${(e as Error).message}`;
    return;
  }

  // ② fromExportForm: Feature.id で UID 照合 + validate。level==='error' があれば適用不可、
  //    warning のみ (scale-* / no-content) なら適用は許して警告表示する
  const parsedRecord = parsed as Record<string, unknown>;
  const rawLang = resolvePoiSourceLanguage(parsedRecord.lang, state.lang);
  const { features, issues } = fromExportForm(parsed, state.features, rawLang);
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  if (errors.length > 0) {
    applyIssues.value = errors;
    return;
  }

  // ③ トップレベルの写像: id→slug (string のみ。文字種違反は適用不可。グローバル一意は
  //    保存時の Exist に委ねる) / name→title (normalizeLangResource で内部形へ) /
  //    その他 (type/features/id/name 除く) → layerMeta 全置換
  const rec = parsedRecord;
  let slug = state.slug;
  // id メンバー自体が無ければ現 slug を維持 (非対称: §2.3 の双方向読みで id 欠落=現 slug 維持 /
  // name 欠落=title クリア。name は空 title の正当な表現がある一方、slug 空は不正なため)。
  // id はあるが string でない場合はエラー化して適用不可にする (Phase 5 品質レビュー MINOR)
  if ("id" in rec && typeof rec.id !== "string") {
    applyError.value = t("poiedit.raw_id_not_string");
    return;
  }
  if (typeof rec.id === "string") {
    if (!SLUG_PATTERN.test(rec.id)) {
      applyError.value = t("poisource.errors.slug_charset");
      return;
    }
    slug = rec.id;
  }
  const title = normalizeLangResource(
    rec.name as LangResource | null | undefined,
    rawLang,
  );
  const layerMeta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (key === "type" || key === "features" || key === "id" || key === "name" || key === "lang") {
      continue;
    }
    layerMeta[key] = value;
  }

  // ④ commit 1 回で features/slug/title/layerMeta を差し替え (= 1 Undo、仕様 §5)。
  //    slug 変更時は PoiEdit 側の slug 欄 watch (editState.slug) が追随して checkSlug する
  props.session.commit((draft) => {
    draft.features = features;
    draft.lang = rawLang;
    draft.slug = slug;
    draft.title = title;
    draft.layerMeta = layerMeta;
  });

  // 適用後はローカル dirty を解除して適用結果の snapshot から再生成 (warning は残す)
  regenerate();
  applyWarnings.value = warnings;
}
</script>

<style scoped>
.poi-raw-textarea {
  resize: none;
  font-size: 0.8rem;
  min-height: 0;
}

.poi-raw-diagnostics {
  max-height: 40%;
}
</style>
