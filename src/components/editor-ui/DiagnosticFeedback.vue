<template>
  <div
    v-if="visibleItems.length"
    class="editor-diagnostic"
    :class="[`editor-diagnostic--${scope}`, scope !== 'field' ? `editor-diagnostic--sev-${topSeverity}` : null]"
    :data-diagnostic-scope="scope"
    :data-diagnostic-severity="topSeverity"
    :role="hasDanger ? 'alert' : 'status'"
  >
    <ul class="editor-diagnostic__list">
      <li
        v-for="item in visibleItems"
        :key="item.key"
        class="editor-diagnostic__item"
        :class="`editor-diagnostic__item--${item.severity}`"
      >
        <i :class="['bi', iconFor(item.severity)]" aria-hidden="true"></i>
        <span class="editor-diagnostic__message">{{ item.message }}</span>
      </li>
    </ul>
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
}>(), {
  dismissible: false,
});

const emit = defineEmits<{ dismiss: [] }>();

const { t } = useTranslation();
const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { danger: 3, warning: 2, success: 1, info: 0 };
const visibleItems = computed(() => props.items.filter((item) => item.message.trim() !== ""));
const hasDanger = computed(() => visibleItems.value.some((item) => item.severity === "danger"));
const topSeverity = computed<DiagnosticSeverity>(() =>
  visibleItems.value.reduce<DiagnosticSeverity>(
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

.editor-diagnostic__list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1 1 auto;
  min-width: 0;
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
