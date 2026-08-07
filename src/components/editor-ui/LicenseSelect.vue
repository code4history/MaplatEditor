<template>
  <select
    class="form-select form-select-sm"
    :value="modelValue"
    :disabled="disabled"
    :data-testid="testId"
    @change="onChange"
  >
    <!-- allowUnset のとき先頭に「未設定」空選択肢を置く (ベースマップ専用。地図側は既存の既定値運用を変えない) -->
    <option v-if="allowUnset" value="">{{ t(unsetLabelKey) }}</option>
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ t(option.labelKey) }}
    </option>
  </select>
</template>

<script setup lang="ts">
// m6-t2: ライセンス選択の共通 select。地図編集 (MapEdit) とベースマップ編集 (BaseMapEdit) の
// 両方がこの部品を使う。選択肢の集合は licenseVocabulary.ts の単一の正本から供給される。
// variant で IMAGE_LICENSE_OPTIONS / DATA_LICENSE_OPTIONS を出し分ける (PD の非対称は語彙側で温存)。
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import {
  DATA_LICENSE_OPTIONS,
  IMAGE_LICENSE_OPTIONS,
} from "../../utils/licenseVocabulary";

const props = withDefaults(defineProps<{
  modelValue: string;
  variant: "image" | "data";
  allowUnset?: boolean;
  disabled?: boolean;
  testId?: string;
  // m6-t10 v1.4 (§4.1b): allowUnset の空選択肢のラベルキー。
  // マスタ編集では「未設定」だが、アプリソース編集では「マスタに従う」を意味する。
  // 既定は現行のハードコード値と同一なので MapEdit / BaseMapEdit の表示は変わらない
  unsetLabelKey?: string;
}>(), {
  allowUnset: false,
  disabled: false,
  testId: "",
  unsetLabelKey: "mapedit.license_unset",
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { t } = useTranslation();

const options = computed(() =>
  props.variant === "image" ? IMAGE_LICENSE_OPTIONS : DATA_LICENSE_OPTIONS,
);

function onChange(event: Event): void {
  emit("update:modelValue", (event.target as HTMLSelectElement).value);
}
</script>
