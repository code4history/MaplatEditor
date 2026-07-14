import type {
  ResourceListAction,
  ResourceListItemViewModel,
  ResourceListKind,
} from "./resourceListTypes";

// view model の capability（actions）を UI 用の ResourceListAction[] へ写像する。
// i18n key の付与は primitive 層のこの関数だけが行い、adapter へ i18n 知識を漏らさない（D10）。
// T6 は "delete" のみ。"duplicate" は T10 で追加する。
export function buildResourceListActions(
  _kind: ResourceListKind,
  viewModel: ResourceListItemViewModel,
): ResourceListAction[] {
  const actions: ResourceListAction[] = [];
  for (const capability of viewModel.actions) {
    if (capability === "delete") {
      actions.push({
        key: "delete",
        labelKey: "resource_list.menu_delete",
        destructive: true,
        enabled: true,
      });
    }
    // "duplicate" は T10。
  }
  return actions;
}
