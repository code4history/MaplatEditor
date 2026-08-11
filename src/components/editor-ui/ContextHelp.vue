<template>
  <button
    ref="triggerRef"
    type="button"
    class="btn btn-link p-0 context-help"
    data-editor-help
    :aria-label="ariaLabel"
    :title="fallbackTitle"
  >
    <i class="bi bi-question-circle" aria-hidden="true"></i>
  </button>
</template>

<script setup lang="ts">
// v3: 同じ ? アイコンは同じ挙動（人間決定 2026-07-14）。
// Bootstrap Popover を trigger 'hover focus' で単一化し、title 有無で見た目の階層だけ変える。
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Popover } from "bootstrap";

const props = withDefaults(defineProps<{
  text: string;
  title?: string;
  placement?: "top" | "bottom" | "left" | "right";
  ariaLabel: string;
}>(), {
  placement: "top",
});

const triggerRef = ref<HTMLButtonElement | null>(null);
const fallbackTitle = ref<string>("");
let instance: Popover | null = null;

onMounted(() => {
  const el = triggerRef.value;
  if (!el) return;
  try {
    instance = new Popover(el, {
      content: props.text,
      title: props.title ?? "",
      placement: props.placement,
      trigger: "hover focus",
      // customClass は Bootstrap の型定義に未収録だが実行時に有効なオプション。
      customClass: "editor-ui-help-popover",
    } as ConstructorParameters<typeof Popover>[1]);
  } catch (cause) {
    // 初期化失敗時は title 属性へフォールバック（表示欠落で操作を止めない）
    console.warn("ContextHelp init failed; falling back to title attribute", cause);
    fallbackTitle.value = props.text;
  }
});

onBeforeUnmount(() => {
  instance?.dispose();
  instance = null;
});
</script>

<style scoped>
.context-help {
  line-height: 1;
  vertical-align: baseline;
}
</style>
