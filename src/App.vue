<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import Header from "./components/Header.vue";
import ProgressModal from "./components/ProgressModal.vue";
import { handleMenuTextUndoRedo } from "./utils/nativeTextUndo";

const { t } = useTranslation();

const modalVisible = ref(false);
const modalText = ref('');
const modalPercent = ref(0);
const modalProgressText = ref('');
const modalEnableClose = ref(false);
let removeTaskProgressListener: (() => void) | null = null;
let removeMigrationReportListener: (() => void) | null = null;
let removeMenuTextUndoListener: (() => void) | null = null;

// レガシー移行レポート (ADR-0007): 移行を実行した起動で一度だけ届き、
// slug改名(ID衝突のサフィックス解消)と警告件数を一覧表示する
interface MigrationRenamedSlug { kind: string; from: string; to: string }
const migrationReportVisible = ref(false);
const migrationRenamedSlugs = ref<MigrationRenamedSlug[]>([]);
const migrationWarningCount = ref(0);
let migrationReportShown = false;

onMounted(() => {
  // メニューの Cmd/Ctrl+Z アクセラレータがネイティブのテキスト undo を横取りするため、
  // 編集可能フィールドにフォーカスがある間はここでネイティブ undo/redo に振り分ける
  // (全画面共通。各ビューのセッション undo 側は編集フィールド内では発動しない)
  removeMenuTextUndoListener = window.appEvents.onMainProcessMessage((message) => {
    handleMenuTextUndoRedo(message);
  });
  removeTaskProgressListener = window.appEvents.onTaskProgress((progress) => {
    modalText.value = progress.text;
    modalPercent.value = progress.percent ?? 0;
    modalProgressText.value = progress.progress ?? '';
    modalEnableClose.value = modalPercent.value >= 100;
    modalVisible.value = true;
  });
  removeMigrationReportListener = window.appEvents.onMigrationReport((report) => {
    if (migrationReportShown) return;
    const renamed = Array.isArray(report?.renamedSlugs) ? report.renamedSlugs : [];
    const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
    // 通知すべき内容がなければモーダルは出さない (report ファイルは常に残る)
    if (renamed.length === 0 && warnings.length === 0) return;
    migrationRenamedSlugs.value = renamed;
    migrationWarningCount.value = warnings.length;
    migrationReportShown = true;
    migrationReportVisible.value = true;
  });
});

onUnmounted(() => {
  removeTaskProgressListener?.();
  removeMigrationReportListener?.();
  removeMenuTextUndoListener?.();
});
</script>

<template>
  <Header />
  <div class="main-content">
    <router-view />
  </div>
  <ProgressModal
    :visible="modalVisible"
    :text="modalText"
    :percent="modalPercent"
    :progress-text="modalProgressText"
    :enable-close="modalEnableClose"
    @close="modalVisible = false"
  />
  <!-- レガシー移行レポートモーダル (一度きり) -->
  <div
    v-if="migrationReportVisible"
    class="modal d-block"
    tabindex="-1"
    role="dialog"
    style="background: rgba(0,0,0,0.5);"
  >
    <div class="modal-dialog modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ t('database.migration_report_title') }}</h5>
        </div>
        <div class="modal-body">
          <template v-if="migrationRenamedSlugs.length > 0">
            <p>{{ t('database.migration_report_renamed') }}</p>
            <ul>
              <li v-for="item in migrationRenamedSlugs" :key="`${item.kind}:${item.from}`">
                <span class="badge bg-secondary me-1">{{ item.kind }}</span>
                <code>{{ item.from }}</code> &rarr; <code>{{ item.to }}</code>
              </li>
            </ul>
          </template>
          <p v-if="migrationWarningCount > 0" class="text-warning mb-0">
            {{ t('database.migration_report_warnings', { count: migrationWarningCount }) }}
          </p>
        </div>
        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-primary"
            @click="migrationReportVisible = false"
          >OK</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Global styles or minimal reset */
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: var(--editor-ui-font-base);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}
.main-content {
  margin-top: var(--editor-ui-header-height);
  height: calc(100vh - var(--editor-ui-header-height));
  overflow-y: auto;
  padding: 0; /* Remove padding here so scrollbar is at the edge */
  width: 100%;
}
</style>

<style>
/* Global reset to prevent body scroll */
html, body {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>
