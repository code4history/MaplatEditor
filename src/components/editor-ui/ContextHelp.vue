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
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Tooltip, Popover } from "bootstrap";

const props = withDefaults(defineProps<{
  mode: "tooltip" | "popover";
  text: string;
  title?: string;
  placement?: "top" | "bottom" | "left" | "right";
  ariaLabel: string;
}>(), {
  placement: "top",
});

const triggerRef = ref<HTMLButtonElement | null>(null);
const fallbackTitle = ref<string>("");
let instance: Tooltip | Popover | null = null;

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && instance) (instance as Popover).hide();
}

function onOutsideClick(event: MouseEvent) {
  if (!triggerRef.value) return;
  if (!triggerRef.value.contains(event.target as Node)) (instance as Popover)?.hide();
}

onMounted(() => {
  const el = triggerRef.value;
  if (!el) return;
  try {
    if (props.mode === "tooltip") {
      instance = new Tooltip(el, {
        title: props.text,
        placement: props.placement,
        trigger: "hover focus",
      });
    } else {
      instance = new Popover(el, {
        content: props.text,
        title: props.title ?? "",
        placement: props.placement,
        trigger: "click",
      });
      document.addEventListener("keydown", onKeydown);
      document.addEventListener("click", onOutsideClick, true);
    }
  } catch (cause) {
    // 初期化失敗時は title 属性へフォールバック（表示欠落で操作を止めない）
    console.warn("ContextHelp init failed; falling back to title attribute", cause);
    fallbackTitle.value = props.text;
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("click", onOutsideClick, true);
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
