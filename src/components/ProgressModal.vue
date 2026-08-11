<template>
  <!-- 静的バックドロップ（ESC・外クリックで閉じない）→ 旧実装 data-backdrop="static" 相当 -->
  <div
    v-if="visible"
    class="modal d-block"
    tabindex="-1"
    role="dialog"
    style="background: rgba(0,0,0,0.5);"
  >
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-body">
          <!-- テキスト行 -->
          <div class="row mb-2">
            <div class="col-12">{{ localText }}</div>
          </div>
          <!-- プログレスバー行: 旧実装 progress-bar-info 相当 -->
          <div class="row mb-2">
            <div class="col-12">
              <div class="progress">
                <div
                  class="progress-bar bg-info"
                  role="progressbar"
                  :style="{ width: `${percent}%` }"
                >{{ progressText }}</div>
              </div>
            </div>
          </div>
          <!-- OKボタン行: 旧実装 btn-default 相当 -->
          <div class="row text-center">
            <div>
              <button
                type="button"
                class="btn btn-secondary"
                :disabled="!enableClose"
                @click="$emit('close')"
              >OK</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
// @ts-ignore
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation();

interface Props {
  visible: boolean;
  /** i18nキーのみ (M13-T1: §2/§4 AC-T1-4)。翻訳済み文字列を渡してはならない —
   *  ここで t(props.text) を通すため、呼び出し側が既に翻訳した文字列を渡すと二重翻訳になる */
  text: string;
  /** M5-T6: i18n の補間パラメータ（{{key}} に流し込む値）。
   *  数値入りの文言を出すために追加した。呼び出し側で t() を通す回避策は採らない —
   *  M13-T1 の「キーのみを渡す」契約を壊さずに拡張するための口である
   *  (m13-t1-strict-export-guard-smoke.mjs が modalShow(t( / modalFinish(t( の
   *  両方をゼロ件で監視している) */
  textParams?: Record<string, unknown>;
  /** 0〜100 */
  percent: number;
  /** "(current/total)" 形式の文字列 */
  progressText: string;
  /** true になったら OK ボタンが有効化される */
  enableClose: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  text: '',
  textParams: undefined,
  percent: 0,
  progressText: '',
  enableClose: false,
});

defineEmits<{
  (e: 'close'): void;
}>();

/**
 * 旧実装では langObj.tr(arg.text) で翻訳してから渡していた。
 * 新実装では i18n キーをそのまま渡し、ここで翻訳する。
 * 翻訳できなかった場合はそのまま表示する。
 */
const localText = computed(() => {
  if (!props.text) return '';
  const translated = t(props.text, props.textParams ?? {});
  // i18next はキーが見つからない場合キーそのものを返すが、
  // ドット区切りのキーが無い場合も同様なので、そのまま表示する
  return translated;
});
</script>
