<script setup lang="ts">
import { watch } from 'vue';
import { useTranslation } from 'i18next-vue';

export interface DeleteReference { kind: string; slug: string; title?: string }
const { t } = useTranslation();
const props = defineProps<{
  visible: boolean;
  title: string;
  references?: DeleteReference[];
  referencesUnavailable?: boolean;
  deleting: boolean;
  body?: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

watch(() => props.visible, async (visible, _previous, onCleanup) => {
  if (!visible || props.deleting) return;
  let active = true;
  onCleanup(() => { active = false; });
  const detail = [props.body ?? t('resource_list.delete_irreversible')];
  if (props.references?.length) {
    detail.push(t('resource_list.delete_referenced_by'));
    detail.push(...props.references.map((ref) => `${ref.kind}: ${ref.title || ref.slug}`));
  }
  if (props.referencesUnavailable) detail.push(t('resource_list.delete_references_unavailable'));
  try {
    const { response } = await (window as any).dialog.showMessageBox({
      type: 'warning', message: props.title, detail: detail.join('\n'),
      buttons: [t('resource_list.menu_delete'), t('common.cancel')], defaultId: 1, cancelId: 1,
    });
    if (active) {
      if (response === 0) emit('confirm');
      else emit('cancel');
    }
  } catch (error) {
    console.error('Delete confirmation failed', error);
    if (active) emit('cancel');
  }
}, { immediate: true });
</script>

<template>
  <!-- 確認の表示はネイティブのダイアログ（showMessageBox）が担当する。画面には何も描かない -->
  <span hidden></span>
</template>
