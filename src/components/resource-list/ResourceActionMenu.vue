<template>
  <span v-if="actions.length" class="resource-action-menu-host">
    <button
      ref="triggerRef"
      type="button"
      class="btn btn-sm btn-link text-secondary p-0 resource-action-menu__trigger"
      data-resource-action-trigger
      :aria-label="t('resource_list.menu_label')"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      @click.stop="toggle"
      @keydown="onTriggerKeydown"
    >
      <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
    </button>

    <ul
      v-if="open"
      ref="menuRef"
      class="dropdown-menu show resource-action-menu"
      role="menu"
      :style="{ top: position.y + 'px', left: position.x + 'px' }"
      @click.stop
    >
      <li v-for="action in actions" :key="action.key" role="none">
        <button
          type="button"
          role="menuitem"
          class="dropdown-item"
          :class="{ 'text-danger': action.destructive, disabled: !action.enabled }"
          :disabled="!action.enabled"
          :title="!action.enabled && action.reasonKey ? t(action.reasonKey) : undefined"
          :data-resource-action="action.key"
          @click="choose(action)"
        >
          {{ t(action.labelKey) }}
        </button>
      </li>
    </ul>
  </span>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useTranslation } from "i18next-vue";
import type { ResourceListAction } from "./resourceListTypes";

const props = defineProps<{ actions: ResourceListAction[] }>();
const emit = defineEmits<{ select: [key: string] }>();

const { t } = useTranslation();
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const open = ref(false);
const position = ref({ x: 0, y: 0 });

async function openAt(x: number, y: number): Promise<void> {
  if (!props.actions.length) return;
  position.value = { x, y };
  open.value = true;
  document.addEventListener("click", onOutside, true);
  document.addEventListener("keydown", onGlobalKeydown, true);
  await nextTick();
  // menu幅・高さを測定し、viewport境界内へclampする(Major 1修正)
  const menu = menuRef.value;
  if (menu) {
    const menuRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    // 右端はみ出し補正
    if (nx + menuRect.width > vw - 4) nx = Math.max(4, vw - menuRect.width - 4);
    // 下端はみ出し補正
    if (ny + menuRect.height > vh - 4) ny = Math.max(4, vh - menuRect.height - 4);
    // 左端はみ出し補正
    if (nx < 4) nx = 4;
    // 上端はみ出し補正
    if (ny < 4) ny = 4;
    position.value = { x: nx, y: ny };
  }
  (menuRef.value?.querySelector('[role="menuitem"]:not(:disabled)') as HTMLElement | null)?.focus();
}

function close(restoreFocus = true): void {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener("click", onOutside, true);
  document.removeEventListener("keydown", onGlobalKeydown, true);
  if (restoreFocus) triggerRef.value?.focus();
}

function toggle(): void {
  if (open.value) { close(); return; }
  const rect = triggerRef.value?.getBoundingClientRect();
  void openAt(rect ? rect.right : 0, rect ? rect.bottom : 0);
}

function choose(action: ResourceListAction): void {
  if (!action.enabled) return;
  emit("select", action.key);
  close();
}

function onTriggerKeydown(event: KeyboardEvent): void {
  // Shift+F10 でも menu を開く（右クリック等価）。Enter/Space は既定の click で開く。
  if ((event.shiftKey && event.key === "F10") || event.key === "ArrowDown") {
    event.preventDefault();
    const rect = triggerRef.value?.getBoundingClientRect();
    void openAt(rect ? rect.right : 0, rect ? rect.bottom : 0);
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") { event.stopPropagation(); close(); }
}

function onOutside(event: MouseEvent): void {
  const target = event.target as Node;
  if (menuRef.value?.contains(target) || triggerRef.value?.contains(target)) return;
  close(false);
}

// 親（card/row）の contextmenu / Shift+F10 から座標付きで開かせるための公開 API。
defineExpose({ openAt, close });

onBeforeUnmount(() => close(false));
</script>

<style scoped>
.resource-action-menu-host { display: inline-flex; }
</style>
