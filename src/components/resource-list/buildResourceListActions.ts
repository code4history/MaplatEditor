import type {
  ResourceListAction,
  ResourceListItemViewModel,
  ResourceListKind,
} from "./resourceListTypes";

// view model の capability（actions）を UI 用の ResourceListAction[] へ写像する。
// i18n key の付与は primitive 層のこの関数だけが行い、adapter へ i18n 知識を漏らさない（D10）。
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
    if (capability === "duplicate") {
      actions.push({
        key: "duplicate",
        labelKey: "resource_list.menu_duplicate",
        destructive: false,
        enabled: true,
      });
    }
  }
  return actions;
}
