<template>
  <!-- POI Content Mode 選択タブ (M11-T9)。
       EditorTabs の DOM 構成（ul.nav.nav-tabs.nav-fill）に準拠しつつ、
       非互換フィールドがある場合の確認ダイアログを内蔵する。 -->
  <ul v-if="tabItems.length" class="nav nav-tabs nav-fill bg-white flex-shrink-0 editor-ui-content-mode-tabs" role="tablist">
    <li v-for="tab in tabItems" :key="tab.key" class="nav-item" role="presentation">
      <a
        class="nav-link"
        :class="{ active: currentValue === tab.key,
                  disabled: readOnly && currentValue !== tab.key }"
        href="#"
        role="tab"
        :aria-selected="currentValue === tab.key ? 'true' : 'false'"
        :data-testid="`poi-content-mode-tab-${tab.key}`"
        @click.prevent="switchTo(tab.key)"
      >
        {{ t(tab.labelKey) }}
      </a>
    </li>
  </ul>

  <!-- 非互換フィールド削除の確認ダイアログ。Bootstrap Modal -->
  <div
    v-if="confirmVisible"
    class="modal d-block"
    tabindex="-1"
    role="dialog"
    style="background: rgba(0,0,0,0.5);"
  >
    <div class="modal-dialog modal-sm">
      <div class="modal-content">
        <div class="modal-header border-0 pb-0">
          <h6 class="modal-title">{{ t("poiedit.content_mode_switch_title") }}</h6>
        </div>
        <div class="modal-body">
          <p class="mb-0 small">{{ confirmMessage }}</p>
        </div>
        <div class="modal-footer border-0 pt-0">
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            data-testid="poi-content-mode-cancel"
            @click="cancelSwitch"
          >
            {{ t("poiedit.content_mode_cancel") }}
          </button>
          <button
            type="button"
            class="btn btn-sm btn-danger"
            data-testid="poi-content-mode-confirm"
            @click="confirmSwitch"
          >
            {{ t("poiedit.content_mode_confirm") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import type { PoiContentMode } from "../utils/poiContentMode";
import { CONTENT_MODE_VALUES } from "../utils/poiContentMode";

interface ContentModeTabItem {
  key: string;
  labelKey: string;
}

const TAB_ITEMS: ContentModeTabItem[] = [
  { key: "standard", labelKey: "poiedit.content_mode_standard" },
  { key: "html", labelKey: "poiedit.content_mode_html" },
  { key: "url", labelKey: "poiedit.content_mode_url" },
];

const props = withDefaults(
  defineProps<{
    modelValue: PoiContentMode | undefined;
    hasIncompatibleValues: boolean;
    incompatibleFieldNames: string[];
    readOnly?: boolean;
  }>(),
  { readOnly: false },
);

const emit = defineEmits<{
  "update:modelValue": [mode: PoiContentMode];
}>();

const { t } = useTranslation();

const tabItems = TAB_ITEMS;

// modelValue が undefined → standard として表示（legacy データ）
const currentValue = computed<PoiContentMode>(
  () => (props.modelValue && CONTENT_MODE_VALUES.includes(props.modelValue as PoiContentMode))
    ? props.modelValue as PoiContentMode
    : "standard",
);

const pendingMode = ref<PoiContentMode | null>(null);
const confirmVisible = ref(false);

const confirmMessage = computed(() => {
  const fields = props.incompatibleFieldNames;
  if (fields.length === 0) return "";
  const names = fields.map((f) => {
    const displayNames: Record<string, string> = {
      desc: t("poiedit.desc"),
      address: t("poiedit.address"),
      html: t("poiedit.html"),
      url: t("poiedit.url"),
      image: t("poiedit.images"),
    };
    return displayNames[f] || f;
  });
  return t("poiedit.content_mode_switch_warning", {
    fields: names.join(" / "),
  });
});

function switchTo(mode: string): void {
  if (props.readOnly) return;
  const target = mode as PoiContentMode;
  if (target === currentValue.value) return;
  if (!CONTENT_MODE_VALUES.includes(target)) return;

  if (props.hasIncompatibleValues) {
    pendingMode.value = target;
    confirmVisible.value = true;
  } else {
    emit("update:modelValue", target);
  }
}

function confirmSwitch(): void {
  if (pendingMode.value) {
    emit("update:modelValue", pendingMode.value);
  }
  confirmVisible.value = false;
  pendingMode.value = null;
}

function cancelSwitch(): void {
  confirmVisible.value = false;
  pendingMode.value = null;
}
</script>
