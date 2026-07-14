<template>
  <!-- Edit v1 §9 の tab primitive (M11-T7/AC9)。現行 nav-tabs と同等の DOM
       (ul.nav.nav-tabs.nav-fill + li.nav-item > a.nav-link、active/disabled class、
       href="#"、click.prevent)を出力しつつ、role/aria-selected/roving tabindex と
       ArrowLeft/Right/Home/End の focus 移動、disabled 理由 tooltip、狭幅 overflow を
       共通化する。screenshot 回帰を壊さないため class 構成は現行を保つ。 -->
  <ul class="nav nav-tabs nav-fill bg-white flex-shrink-0 border-bottom-0 editor-ui-tabs" role="tablist">
    <li v-for="tab in tabs" :key="tab.key" class="nav-item" role="presentation">
      <a
        :ref="(el) => setLinkRef(tab.key, el)"
        class="nav-link"
        :class="{ active: modelValue === tab.key, disabled: tab.disabled }"
        href="#"
        role="tab"
        :aria-selected="modelValue === tab.key ? 'true' : 'false'"
        :aria-disabled="tab.disabled ? 'true' : undefined"
        :tabindex="tabindexFor(tab)"
        :title="tab.disabled && tab.disabledReasonKey ? t(tab.disabledReasonKey) : undefined"
        :data-testid="tab.testid"
        @click.prevent="select(tab)"
        @keydown="onKeydown($event, tab)"
      >
        {{ t(tab.labelKey) }}
      </a>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useTranslation } from "i18next-vue";
import type { ComponentPublicInstance } from "vue";

export interface EditorTabItem {
  key: string;
  labelKey: string;
  disabled?: boolean;
  // disabled の理由 tooltip 用 i18n キー
  disabledReasonKey?: string;
  // 既存 E2E 互換の data-testid 透過
  testid?: string;
}

const props = defineProps<{
  tabs: EditorTabItem[];
  modelValue: string;
}>();

const emit = defineEmits<{ "update:modelValue": [string] }>();

const { t } = useTranslation();

const linkRefs = new Map<string, HTMLAnchorElement>();
function setLinkRef(key: string, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLAnchorElement) linkRefs.set(key, el);
  else linkRefs.delete(key);
}

// roving tabindex (WAI-ARIA tabs): active(無ければ先頭の enabled)のみ 0、他は -1。
// disabled は常に -1(現行 gcpsEditReady disabled の挙動を包含)。
function tabindexFor(tab: EditorTabItem): number {
  if (tab.disabled) return -1;
  if (props.modelValue === tab.key) return 0;
  const active = props.tabs.find((item) => item.key === props.modelValue && !item.disabled);
  if (!active) {
    const firstEnabled = props.tabs.find((item) => !item.disabled);
    if (firstEnabled?.key === tab.key) return 0;
  }
  return -1;
}

function select(tab: EditorTabItem): void {
  if (tab.disabled) return;
  if (props.modelValue !== tab.key) emit("update:modelValue", tab.key);
}

// ArrowLeft/Right/Home/End で enabled tab 間を focus 移動し、そのまま選択する
// (v-show パネル前提の automatic activation)。disabled は skip する。
function onKeydown(event: KeyboardEvent, tab: EditorTabItem): void {
  const enabled = props.tabs.filter((item) => !item.disabled);
  if (enabled.length === 0) return;
  const index = enabled.findIndex((item) => item.key === tab.key);
  let next: EditorTabItem | undefined;
  if (event.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
  else if (event.key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
  else if (event.key === "Home") next = enabled[0];
  else if (event.key === "End") next = enabled[enabled.length - 1];
  else return;
  event.preventDefault();
  if (!next) return;
  select(next);
  linkRefs.get(next.key)?.focus();
}
</script>

<style scoped>
/* 狭幅では折り返さず横 overflow スクロールにする(§9) */
.editor-ui-tabs {
  flex-wrap: nowrap;
  overflow-x: auto;
}

.editor-ui-tabs .nav-link {
  white-space: nowrap;
}
</style>
