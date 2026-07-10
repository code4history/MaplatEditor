<template>
  <div class="lang-resource-input">
    <!-- 多言語モード: LANGS_MAP の 11 言語タブ -->
    <template v-if="expanded">
      <ul class="nav nav-tabs lang-tabs">
        <li v-for="(labelKey, code) in langsMap" :key="code" class="nav-item">
          <a
            href="#"
            class="nav-link py-0 px-2 small"
            :class="{ active: activeLang === code }"
            @click.prevent="activeLang = code"
          >
            {{ t("common." + labelKey) }}<span v-if="hasValue(code)" class="lang-filled">&#8226;</span>
          </a>
        </li>
      </ul>
      <textarea
        v-if="multiline"
        class="form-control form-control-sm"
        rows="3"
        :value="valueFor(activeLang)"
        :disabled="disabled"
        @change="onConfirm(($event.target as HTMLTextAreaElement).value)"
      />
      <input
        v-else
        type="text"
        class="form-control form-control-sm"
        :value="valueFor(activeLang)"
        :disabled="disabled"
        @change="onConfirm(($event.target as HTMLInputElement).value)"
      />
    </template>

    <!-- 単一言語モード: string 値はデフォルト言語 (ja) の単一欄 + 「他言語を追加」 -->
    <template v-else>
      <div class="d-flex align-items-start gap-1">
        <textarea
          v-if="multiline"
          class="form-control form-control-sm"
          rows="3"
          :value="valueFor(DEFAULT_LANG)"
          :disabled="disabled"
          @change="onConfirm(($event.target as HTMLTextAreaElement).value)"
        />
        <input
          v-else
          type="text"
          class="form-control form-control-sm"
          :value="valueFor(DEFAULT_LANG)"
          :disabled="disabled"
          @change="onConfirm(($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary text-nowrap"
          :disabled="disabled"
          @click="forceExpanded = true"
        >
          {{ t("poiedit.add_other_languages") }}
        </button>
      </div>
    </template>

    <!-- XSS 警告等 (POI-109): 非空値があるときのみ表示 -->
    <div v-if="warning && hasAnyValue" class="form-text small text-warning mb-0">
      {{ warning }}
    </div>
  </div>
</template>

<script setup lang="ts">
// LangResource (ADR-0005: string | {lang: text}) の言語別編集部品 (Phase 4 Task 5)。
// emit は change (blur 確定) 時のみ = 1 Undo 単位 (仕様 §5)。入力毎には emit しない。
// 空文字の言語エントリは emit 時に削除する (poiGeoJson / langResource の collapse 規約と整合)。
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import { LANGS_MAP, type LangCode } from "../utils/editorLanguages";

const props = defineProps<{
  modelValue?: string | Record<string, string>;
  /** desc/html 用 textarea */
  multiline?: boolean;
  /** html の XSS 警告文 (非空値があるときのみ表示) */
  warning?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string | Record<string, string> | undefined];
}>();

const { t } = useTranslation();

// POI editor のデフォルト言語 (ADR-0005 既定、poiGeoJson.DEFAULT_LANG と同一)
const DEFAULT_LANG: LangCode = "ja";
const langsMap = LANGS_MAP;

const activeLang = ref<LangCode>(DEFAULT_LANG);
// 「他言語を追加」で明示的にタブ表示へ切り替えたか (string 値のままでも保持)
const forceExpanded = ref(false);

const isObjectValue = computed(
  () => typeof props.modelValue === "object" && props.modelValue !== null,
);
const expanded = computed(() => isObjectValue.value || forceExpanded.value);

function valueFor(code: LangCode): string {
  if (isObjectValue.value) {
    return (props.modelValue as Record<string, string>)[code] ?? "";
  }
  return code === DEFAULT_LANG ? ((props.modelValue as string | undefined) ?? "") : "";
}

function hasValue(code: LangCode): boolean {
  return valueFor(code).trim() !== "";
}

const hasAnyValue = computed(() => {
  if (typeof props.modelValue === "string") return props.modelValue.trim() !== "";
  if (isObjectValue.value) {
    return Object.values(props.modelValue as Record<string, string>).some(
      (v) => typeof v === "string" && v.trim() !== "",
    );
  }
  return false;
});

// change (blur 確定) 時のみ呼ばれる。単一言語モードは string のまま、
// 多言語モードはオブジェクト化して空文字言語を削除して emit する
function onConfirm(raw: string): void {
  if (!expanded.value) {
    emit("update:modelValue", raw);
    return;
  }
  const base: Record<string, string> = isObjectValue.value
    ? { ...(props.modelValue as Record<string, string>) }
    : typeof props.modelValue === "string" && props.modelValue !== ""
      ? { [DEFAULT_LANG]: props.modelValue }
      : {};
  base[activeLang.value] = raw;
  const next = Object.fromEntries(
    Object.entries(base).filter(
      ([, v]) => typeof v === "string" && v.trim() !== "",
    ),
  );
  emit("update:modelValue", next);
}
</script>

<style scoped>
.lang-tabs {
  border-bottom: 0;
  flex-wrap: wrap;
}
.lang-tabs .nav-link {
  font-size: 0.75rem;
  border-bottom: 1px solid var(--bs-border-color);
}
.lang-filled {
  margin-left: 2px;
  color: var(--bs-primary);
}
</style>
