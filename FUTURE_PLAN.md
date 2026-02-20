# MaplatEditor-next Future Plan

This document outlines potential future enhancements, features, and UI/UX improvements identified during the modernization of MaplatEditor to MaplatEditor-next.

## 1. Map-Specific Base Map Configuration UI
**Current state**: Base maps are appended via `tmsList.json` and map-specific suppression rules are defined in `tmsList.[mapID].json`. Both currently require manual JSON file editing inside the `settings` directory.
**Proposed improvement**: 
- Create a dedicated UI panel (e.g., in `MapEdit.vue` or a new `Settings.vue` tab) to let users visually toggle which base maps should be visible/available for the currently edited historical map.
- Migrate this configuration storage from standalone JSON files to the main database (e.g., NeDB or its successor) to ensure data integrity and easier querying.

## 2. Global Base Map Management UI
**Current state**: The global list of custom base maps (`tms_list.json` in project root or `tmsList.json` in settings) is managed by manual file edits.
**Proposed improvement**:
- Build a "Base Map Manager" interface allowing users to Add/Edit/Delete custom TMS endpoints, complete with preview functionality and attribution fields.

## 3. General UI/UX Modernization
**Current state**: The UI is being ported from a legacy Bootstrap 3/jQuery design to Vue 3/Bootstrap 5.
**Proposed improvements**:
- State management: Use Pinia for complex state sharing across components instead of heavy prop drilling or global window variables.
- Componentization: Break down monolithic files like `MapEdit.vue` into smaller, reusable components (e.g., `LayerSettings.vue`, `CoordinateEditor.vue`, `MapToolbar.vue`).

_Note: This document should be updated continuously as more areas for improvement are discovered during the porting process._
