<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import SlugField from '../editor-ui/SlugField.vue';
import EditorField from '../editor-ui/EditorField.vue';

// m6-t8 §3.8: 既存 merc マスタが1件以上あるときのみ開く（0件は呼び出し側が黙って新規作成する）。
// ExportKeyPromptModal.vue と同型の Vue モーダル（値をどこにも保存せず emit で親へ渡すのみ）。
export interface MercExistingEntry {
  uid: string;
  title: string;
  slug: string;
}

const props = defineProps<{
  visible: boolean;
  existingEntries: readonly MercExistingEntry[];
  defaultTitle: string;
  defaultSlug: string;
  // 新規作成モード用に事前採番された UID（SlugField の予約 lifecycle に必要）
  newUid: string;
}>();
const emit = defineEmits<{
  'select-existing': [string];
  'create-new': [{ uid: string; slug: string; title: string; attr: string }];
  cancel: [];
}>();
const { t } = useTranslation();

const mode = ref<'select' | 'new'>('select');
const slugLive = ref('');
const title = ref('');
const attr = ref('');

// モーダルを開き直すたびに新規作成フォームを初期値へ戻す
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      mode.value = 'select';
      slugLive.value = props.defaultSlug;
      title.value = props.defaultTitle;
      attr.value = '';
    }
  },
);

function startNew(): void {
  mode.value = 'new';
}

function backToSelect(): void {
  mode.value = 'select';
}

function selectExisting(uid: string): void {
  emit('select-existing', uid);
}

function confirmNew(): void {
  const slug = slugLive.value.trim();
  if (!slug || !title.value.trim()) return;
  emit('create-new', { uid: props.newUid, slug, title: title.value.trim(), attr: attr.value });
}

function cancel(): void {
  emit('cancel');
}
</script>

<template>
  <div v-if="visible" class="modal show d-block" tabindex="-1" role="dialog" aria-modal="true" data-testid="merc-tile-set-modal">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5">{{ t('merc.modal_title') }}</h2>
        </div>
        <div class="modal-body">
          <template v-if="mode === 'select'">
            <p>{{ t('merc.modal_select_description') }}</p>
            <div class="list-group mb-3">
              <button
                v-for="entry in existingEntries"
                :key="entry.uid"
                type="button"
                class="list-group-item list-group-item-action"
                :data-testid="`merc-existing-${entry.uid}`"
                @click="selectExisting(entry.uid)"
              >
                <div class="fw-semibold">{{ entry.title }}</div>
                <div class="text-muted small editor-ui-mono">{{ entry.slug }}</div>
              </button>
            </div>
            <button type="button" class="btn btn-outline-primary" data-testid="merc-start-new" @click="startNew">
              {{ t('merc.modal_create_new') }}
            </button>
          </template>
          <template v-else>
            <EditorField :label="t('basemap.modal.title_label')" label-for="mercNewTitle">
              <input id="mercNewTitle" type="text" class="form-control form-control-sm" data-testid="merc-new-title" v-model="title" />
            </EditorField>
            <SlugField
              :model-value="slugLive"
              asset-kind="base-map"
              :asset-uid="newUid"
              :required="true"
              input-testid="merc-new-slug"
              @update:model-value="slugLive = $event"
              @change="slugLive = $event.trim()"
            />
            <EditorField :label="t('basemap.modal.attr_label')" label-for="mercNewAttr">
              <input id="mercNewAttr" type="text" class="form-control form-control-sm" data-testid="merc-new-attr" v-model="attr" />
              <template #help>
                <span class="text-muted small">{{ t('merc.modal_attr_help') }}</span>
              </template>
            </EditorField>
          </template>
        </div>
        <div class="modal-footer">
          <button v-if="mode === 'new' && existingEntries.length > 0" type="button" class="btn btn-outline-secondary" data-testid="merc-back-to-select" @click="backToSelect">
            {{ t('common.back') }}
          </button>
          <button type="button" class="btn btn-outline-secondary" data-testid="merc-modal-cancel" @click="cancel">
            {{ t('common.cancel') }}
          </button>
          <button
            v-if="mode === 'new'"
            type="button"
            class="btn btn-primary"
            data-testid="merc-modal-confirm"
            :disabled="!slugLive.trim() || !title.trim()"
            @click="confirmNew"
          >
            {{ t('merc.modal_create_confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-if="visible" class="modal-backdrop show"></div>
</template>
