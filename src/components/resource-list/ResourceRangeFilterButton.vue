<template>
  <!-- M12-T10 v2.0 HM3: 範囲コントロール共有コンポーネント。
       ResourceSelectorList の toolbar（検索ボックス直下）に配置。
       state: 'none' | 'auto' | 'manual'。manual 時は clear ボタンを横に表示。
       旧「地域指定」ボタン行・spatial-toggle に代わる唯一の範囲コントロール正本。 -->
  <div class="resource-range-filter-button d-flex gap-2 mt-2">
    <button
      type="button"
      class="btn btn-outline-secondary btn-sm flex-grow-1"
      :data-testid="testId"
      @click="emit('open')"
    >
      <i class="bi bi-bounding-box me-1" aria-hidden="true"></i>{{ currentLabel }}
    </button>
    <button
      v-if="state === 'manual'"
      type="button"
      class="btn btn-outline-secondary btn-sm"
      :data-testid="clearTestId"
      :title="clearTitle"
      @click="emit('clear')"
    >
      <i class="bi bi-x-lg" aria-hidden="true"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  // 'none' = 範囲未指定（ボタンラベルは「範囲を指定して絞り込む」）
  // 'auto' = GCP 範囲で絞り込み中
  // 'manual' = 手動設定範囲で絞り込み中（clear ボタン表示）
  state: "none" | "auto" | "manual";
  autoLabel: string;
  manualLabel: string;
  noneLabel: string;
  clearTitle?: string;
  testId?: string;
  clearTestId?: string;
}>(), { clearTitle: "", testId: undefined, clearTestId: undefined });

const emit = defineEmits<{
  open: [];
  clear: [];
}>();

const currentLabel = computed(() => {
  if (props.state === "auto") return props.autoLabel;
  if (props.state === "manual") return props.manualLabel;
  return props.noneLabel;
});
</script>
