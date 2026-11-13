<template>
  <div
    v-if="shownItems.length"
    class="editor-diagnostic"
    :class="[`editor-diagnostic--${scope}`, scope !== 'field' ? `editor-diagnostic--sev-${topSeverity}` : null]"
    :data-diagnostic-scope="scope"
    :data-diagnostic-severity="topSeverity"
    :role="hasDanger ? 'alert' : 'status'"
  >
    <!-- 行は「固定する行（headerItems）」と「一覧（items）」に分ける。一覧だけがスクロールし、
         見出しや件数など要点はスクロールの外（上）に置いて、行が増えても隠れないようにする。
         閉じるボタンも同じ理由で一覧の外にある。縦に積むための受け皿（__body）を挟む -->
    <div class="editor-diagnostic__body">
      <ul
        v-for="section in sections"
        :key="section.name"
        :class="section.name === 'header' ? 'editor-diagnostic__header' : 'editor-diagnostic__list'"
      >
        <li
          v-for="item in section.items"
          :key="item.key"
          class="editor-diagnostic__item"
          :class="`editor-diagnostic__item--${item.severity}`"
        >
          <i :class="['bi', iconFor(item.severity)]" aria-hidden="true"></i>
          <span class="editor-diagnostic__message">{{ item.message }}</span>
        </li>
      </ul>
    </div>
    <button
      v-if="scope === 'operation' && dismissible"
      type="button"
      class="btn-close editor-diagnostic__close"
      data-diagnostic-dismiss
      :aria-label="t('common.close')"
      @click="emit('dismiss')"
    ></button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import {
  DIAGNOSTIC_SEVERITY_ICON,
  type DiagnosticItem,
  type DiagnosticScope,
  type DiagnosticSeverity,
} from "./editorUiTypes";

const props = withDefaults(defineProps<{
  scope: DiagnosticScope;
  items: DiagnosticItem[];
  dismissible?: boolean;
  /** スクロールの外（上）に固定して出す行。見出しや件数など、一覧が長くても隠したくないもの */
  headerItems?: DiagnosticItem[];
}>(), {
  dismissible: false,
  headerItems: () => [],
});

const emit = defineEmits<{ dismiss: [] }>();

const { t } = useTranslation();
const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { danger: 3, warning: 2, success: 1, info: 0 };
const isShown = (item: DiagnosticItem) => item.message.trim() !== "";
const visibleHeaderItems = computed(() => props.headerItems.filter(isShown));
const visibleItems = computed(() => props.items.filter(isShown));
const shownItems = computed(() => [...visibleHeaderItems.value, ...visibleItems.value]);
// 一覧だけをスクロールさせるため、固定する行と一覧を別の ul に分ける
const sections = computed(() => [
  ...(visibleHeaderItems.value.length ? [{ name: 'header' as const, items: visibleHeaderItems.value }] : []),
  ...(visibleItems.value.length ? [{ name: 'list' as const, items: visibleItems.value }] : []),
]);
const hasDanger = computed(() => shownItems.value.some((item) => item.severity === "danger"));
const topSeverity = computed<DiagnosticSeverity>(() =>
  shownItems.value.reduce<DiagnosticSeverity>(
    (top, item) => (SEVERITY_RANK[item.severity] > SEVERITY_RANK[top] ? item.severity : top),
    "info",
  ),
);
const iconFor = (severity: DiagnosticSeverity) => DIAGNOSTIC_SEVERITY_ICON[severity];
</script>

<style scoped>
.editor-diagnostic {
  display: flex;
  align-items: flex-start;
  gap: var(--editor-ui-space-2);
  font-size: var(--editor-ui-font-size-sm);
}

/* 固定する行と一覧を縦に積むための受け皿（横並びにしないため） */
.editor-diagnostic__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.editor-diagnostic__header,
.editor-diagnostic__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.editor-diagnostic__item {
  display: flex;
  align-items: flex-start;
  gap: var(--editor-ui-space-1);
}

.editor-diagnostic__item--info { color: var(--editor-ui-diag-info-fg); }
.editor-diagnostic__item--success { color: var(--editor-ui-diag-success-fg); }
.editor-diagnostic__item--warning { color: var(--editor-ui-diag-warning-fg); }
.editor-diagnostic__item--danger { color: var(--editor-ui-diag-danger-fg); }

/* field scope: 背景なし、枠下短文 */
.editor-diagnostic--field {
  margin-top: var(--editor-ui-space-1);
}

/* operation scope: 行が多いとき（移行レポート・書き出しの警告の detail）は、バナーを伸ばさず一覧をスクロールする。
   固定する行（headerItems）と閉じるボタンは一覧の外なので、スクロールしても見えたまま */
.editor-diagnostic--operation .editor-diagnostic__list {
  max-height: var(--editor-ui-diag-operation-max-height);
  overflow-y: auto;
}

/* section / operation scope: compact summary（summary-bg + summary-padding + border） */
.editor-diagnostic--section,
.editor-diagnostic--operation {
  padding: var(--editor-ui-diag-summary-padding);
  border-radius: var(--editor-ui-radius);
  border: var(--editor-ui-border-width) solid transparent;
}

.editor-diagnostic--sev-info {
  background: var(--editor-ui-diag-summary-bg-info);
  border-color: var(--editor-ui-diag-info-border);
}
.editor-diagnostic--sev-success {
  background: var(--editor-ui-diag-summary-bg-success);
  border-color: var(--editor-ui-diag-success-border);
}
.editor-diagnostic--sev-warning {
  background: var(--editor-ui-diag-summary-bg-warning);
  border-color: var(--editor-ui-diag-warning-border);
}
.editor-diagnostic--sev-danger {
  background: var(--editor-ui-diag-summary-bg-danger);
  border-color: var(--editor-ui-diag-danger-border);
}
</style>
