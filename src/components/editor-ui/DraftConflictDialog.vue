<script setup lang="ts">
import { watch } from 'vue';
import { useTranslation } from 'i18next-vue';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ discard: []; apply: [] }>();
const { t } = useTranslation();
watch(() => props.visible, async (visible, _previous, onCleanup) => {
  if (!visible) return;
  let active = true;
  onCleanup(() => { active = false; });
  try {
    const { response } = await (window as any).dialog.showMessageBox({
      type: 'warning',
      message: t('editor_ui.draft_conflict.title'),
      detail: t('editor_ui.draft_conflict.message'),
      buttons: [t('editor_ui.draft_conflict.discard'), t('editor_ui.draft_conflict.apply')],
      defaultId: 1, cancelId: 1,
    });
    if (!active) return;
    if (response === 0) emit('discard');
    else emit('apply');
  } catch (error) {
    // 確認を出せなかったときは、下書きを捨てない側（cancelId と同じ）に倒す
    console.error('Draft conflict confirmation failed', error);
    if (active) emit('apply');
  }
}, { immediate: true });
</script>

<template>
  <!-- 確認の表示はネイティブのダイアログ（showMessageBox）が担当する。画面には何も描かない -->
  <span hidden></span>
</template>
