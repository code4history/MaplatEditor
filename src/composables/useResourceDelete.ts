// M11-T10: 共通削除 flow composable。
import { ref } from "vue";

export interface DeleteAction {
  uid: string;
  slug: string;
  title: string;
}

export interface DeleteReference {
  kind: string;
  slug: string;
  title?: string;
}

export function useResourceDelete(options: {
  onDelete: (uid: string) => Promise<void>;
  onDraftRemove: (uid: string) => Promise<void>;
  onDeleted: (uid: string) => void;
  onError: (uid: string, message: string) => void;
}) {
  const deleting = ref(false);

  async function requestDelete(uid: string): Promise<void> {
    deleting.value = true;
    try {
      await options.onDelete(uid);
      await options.onDraftRemove(uid);
      options.onDeleted(uid);
    } catch (e: any) {
      const msg = e?.message || String(e);
      options.onError(uid, msg);
      console.error("Delete failed", e);
    } finally {
      deleting.value = false;
    }
  }

  return { deleting, requestDelete };
}