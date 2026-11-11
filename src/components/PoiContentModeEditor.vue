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
  { key: "link", labelKey: "poiedit.content_mode_link" },
];

const props = withDefaults(
  defineProps<{
    modelValue: PoiContentMode | undefined;
    // 切替先の形で削除される欄のうち、値が入っているもの。空でなければ確認の窓を出す
    droppedFieldsFor: (mode: PoiContentMode) => string[];
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
const pendingFields = ref<string[]>([]);
const confirmVisible = ref(false);

const confirmMessage = computed(() => {
  const fields = pendingFields.value;
  if (fields.length === 0) return "";
  const names = fields.map((f) => {
    const displayNames: Record<string, string> = {
      desc: t("poiedit.desc"),
      address: t("poiedit.address"),
      html: t("poiedit.html"),
      url: t("poiedit.url"),
      image: t("poiedit.images"),
      directgo: t("poiedit.directgo_href"),
    };
    return displayNames[f] || f;
  });
  return t("poiedit.content_mode_switch_warning", {
    fields: names.join(" / "),
  });
});

async function switchTo(mode: string): Promise<void> {
  if (props.readOnly || confirmVisible.value) return;
  const target = mode as PoiContentMode;
  if (target === currentValue.value) return;
  if (!CONTENT_MODE_VALUES.includes(target)) return;

  // 切替で値の入った欄が消えるときだけ、消える欄を挙げて確認する
  const dropped = props.droppedFieldsFor(target);
  if (dropped.length > 0) {
    pendingMode.value = target;
    pendingFields.value = dropped;
    confirmVisible.value = true;
    try {
      const { response } = await (window as any).dialog.showMessageBox({
        type: 'warning',
        message: t('poiedit.content_mode_switch_title'),
        detail: confirmMessage.value,
        buttons: [t('poiedit.content_mode_confirm'), t('poiedit.content_mode_cancel')],
        defaultId: 1, cancelId: 1,
      });
      if (response === 0 && !props.readOnly) confirmSwitch();
      else cancelSwitch();
    } catch (error) {
      console.error('Content mode confirmation failed', error);
      cancelSwitch();
    }
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
  pendingFields.value = [];
}

function cancelSwitch(): void {
  confirmVisible.value = false;
  pendingMode.value = null;
  pendingFields.value = [];
}
</script>
