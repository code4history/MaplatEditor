<template>
  <div class="lang-resource-input">
    <div class="d-flex align-items-start gap-1">
      <textarea
        v-if="multiline"
        class="form-control form-control-sm"
        :class="{ 'is-invalid': invalid }"
        rows="3"
        :data-testid="inputTestid"
        :value="valueFor(activeLang)"
        :disabled="disabled"
        @change="onConfirm(($event.target as HTMLTextAreaElement).value)"
      />
      <input
        v-else
        type="text"
        :data-testid="inputTestid"
        class="form-control form-control-sm"
        :class="{ 'is-invalid': invalid }"
        :value="valueFor(activeLang)"
        :disabled="disabled"
        @change="onConfirm(($event.target as HTMLInputElement).value)"
      />
      <LangValueChips
        :model-value="modelValue"
        :active-lang="activeLang"
        :default-lang="defaultLang"
        :language-options="languageOptions"
        @select-language="(code) => emit('selectLanguage', code)"
      />
    </div>

    <!-- M12-T11 (R5/D7): form-text 警告から DF field(warning) へ。黄色三角アイコンで danger と区別 -->
    <DiagnosticFeedback v-if="warning && hasAnyValue" scope="field" :items="[{ key: 'warning', severity: 'warning', message: warning }]" />
  </div>
</template>

<script setup lang="ts">
// 親editorが管理する共通言語だけを表示する。change (blur確定) ごとに1 Undo単位。
import { computed } from "vue";
import LangValueChips from "./editor-ui/LangValueChips.vue";
import DiagnosticFeedback from "./editor-ui/DiagnosticFeedback.vue";
import {
  SUPPORTED_LANGUAGES,
  type LangCode,
} from "../utils/editorLanguages";

const props = withDefaults(defineProps<{
  modelValue?: string | Record<string, string>;
  activeLang?: LangCode;
  languageOptions?: readonly {
    code: LangCode;
    nativeName: string;
  }[];
  defaultLang?: LangCode;
  multiline?: boolean;
  warning?: string;
  disabled?: boolean;
  invalid?: boolean;
  inputTestid?: string;
}>(), {
  activeLang: "ja",
  languageOptions: () => SUPPORTED_LANGUAGES,
  defaultLang: "ja",
  multiline: false,
  warning: undefined,
  disabled: false,
  invalid: false,
  inputTestid: undefined,
});

const emit = defineEmits<{
  "update:modelValue": [value: string | Record<string, string> | undefined];
  "selectLanguage": [code: LangCode];
}>();

const isObjectValue = computed(
  () => typeof props.modelValue === "object" && props.modelValue !== null,
);

function valueFor(code: LangCode): string {
  if (isObjectValue.value) {
    return (props.modelValue as Record<string, string>)[code] ?? "";
  }
  return code === props.defaultLang
    ? ((props.modelValue as string | undefined) ?? "")
    : "";
}

const hasAnyValue = computed(() => {
  if (typeof props.modelValue === "string") return props.modelValue.trim() !== "";
  if (!isObjectValue.value) return false;
  return Object.values(props.modelValue as Record<string, string>).some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
});

function onConfirm(raw: string): void {
  if (!isObjectValue.value && props.activeLang === props.defaultLang) {
    emit("update:modelValue", raw);
    return;
  }

  const base: Record<string, string> = isObjectValue.value
    ? { ...(props.modelValue as Record<string, string>) }
    : typeof props.modelValue === "string" && props.modelValue !== ""
      ? { [props.defaultLang]: props.modelValue }
      : {};
  base[props.activeLang] = raw;
  const next = Object.fromEntries(
    Object.entries(base).filter(
      ([, value]) => typeof value === "string" && value.trim() !== "",
    ),
  );
  emit("update:modelValue", next);
}
</script>
