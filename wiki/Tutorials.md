# Tutorials

Step-by-step guides for using MaplatEditor.

> **Note (2026-07)**: This page's [Legacy Tutorial](#legacy-tutorial-01x-era-archived)
> section is based on the legacy Wiki content (0.1.x era, circa 2018) and is kept
> for historical reference. The [Current workflow](#current-workflow-070) section
> above it covers the present (0.7.0) UI. For the latest quick start and
> download links, see the [README](../blob/master/README.md).

## Table of Contents

- [Current workflow (0.7.0+)](#current-workflow-070)
  - [1. Creating a map and setting ground control points](#1-creating-a-map-and-setting-ground-control-points)
  - [2. Adding and editing POIs](#2-adding-and-editing-pois)
  - [3. Building an app](#3-building-an-app)
  - [4. Drafts and saving](#4-drafts-and-saving)
  - [5. Exporting and importing](#5-exporting-and-importing)
- [Legacy Tutorial (0.1.x era, archived)](#legacy-tutorial-01x-era-archived)
  - [1. Create a new map](#1-create-a-new-map)
  - [2. Upload the map image](#2-upload-the-map-image)
  - [3. Set ground control points (GCPs)](#3-set-ground-control-points-gcps)
  - [4. Edit and delete markers](#4-edit-and-delete-markers)
  - [5. Save](#5-save)
  - [Development setup (legacy)](#development-setup-legacy)
- [See Also](#see-also)

---

## Current workflow (0.7.0+)

The current desktop application (0.7.0) has a substantially larger feature set
than the legacy 0.1.x editor described below: a POI editor, five
resource lists (Map / App / POI / Base Map / Asset) with full-text search
across all five, plus bounding-box range search for four of them (Map, POI,
Base Map, and App), auto-saving drafts, and app-level export/import. This
section walks through the current workflow; the step-by-step legacy tutorial
is preserved further down for historical reference.

### 1. Creating a map and setting ground control points

MaplatEditor opens on the **Manage Maps** screen, listing every saved map plus
a **New** button to start one and an **Import** button to bring in a
previously exported map (`.zip`). A map that is created but not yet saved
shows up here as an orange **Draft** card instead of being written to disk —
see [Drafts and saving](#4-drafts-and-saving) below.

Saved rows in the Map, App, and POI source lists may also show diagnostic
badges before you open the editor. Yellow warning badges point to export or
preview problems such as missing POI source references, missing asset files,
missing base-map thumbnails, or an app whose legacy `pois` value is in an
unsupported format. Red danger badges identify stricter gate failures:
a map whose compiled data is in `strict_error`, or an app that references a
missing or `strict_error` map. Those app-level danger states are the same
conditions that block saving, previewing, and exporting the app, while the
map's own package export remains available so the broken map data can still
be carried out for repair.

![Map list, with two saved maps and one unsaved draft card](images/current-1-map-list.png)

Opening a map (new or existing) shows the **Edit GCP** tab, which places the
historical map image on the left and an accurate modern map on the right.
Ground control points (GCPs) are the corresponding-location pairs that let
Maplat warp the historical image onto real-world coordinates; the numbered
markers and connecting lines in the screenshot below show four such pairs.
The modern-map side includes geocoder-assisted address search and a
one-click button to estimate the map's home position and zoom level from the
GCPs already placed. Right-clicking a correspondence line inserts a midpoint
GCP and splits the line — a workflow inherited from the original editor.

![Map editor GCP tab, showing GCP markers on the historical and modern maps, with the Export button visible in the header](images/current-2-map-edit-gcp.png)

*Modern map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.*

### 2. Adding and editing POIs

The POI editor lets you add, move, and delete points of interest directly on
a map, and edit multilingual name/description/HTML/address/URL/icon fields for
each one. Three content modes are available per POI — **Standard**, **HTML**,
and **Web Page** — plus inline image references that resolve to assets
uploaded through the shared Assets picker. A **Raw** toggle exposes the
underlying GeoJSON for direct editing, and all edits support undo/redo
(Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z or Y).

![POI editor, showing the map, the content-mode tabs (Standard / HTML / Web Page), and the feature list](images/current-3-poi-editor.png)

*Background map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.*

Older map/app data may carry POIs embedded directly inside the map or app
document (legacy inline `pois` entries). These are preserved as-is: the POI
data tab groups them into panes per viewer layer and shows them read-only,
with an item count and badges distinguishing **Map-embedded POI** and
**External URL reference** entries, and they are passed through unchanged on
save and export. To edit them, use the explicit per-layer **Convert to
GeoJSON** action (one convert button per layer — a single-layer array
converts as a whole, while in a multi-layer list each FeatureCollection card
converts on its own) — this creates a new POI source draft (with an
automatically numbered slug) without changing the original data; you can
then edit and save the draft from the POI list, and delete the original
embedded entries (with a confirmation dialog) once you have switched the map
or app over to the new POI source reference. While embedded data remains in
the list, GeoJSON POI sources cannot be added alongside it, because the
viewer cannot mix the two forms in one list.

### 3. Building an app

The app editor combines a base map, one or more registered maps as sources,
and a POI source, then lets you draw a coverage area and set PWA/OGP metadata
(icons, splash image, keywords, canonical URL). The **Preview** tab renders
the app exactly as an end user would see it, using the sources and POIs
selected on the other tabs.

![App editor preview tab, showing the selected base map and a POI marker](images/current-4-app-editor-preview.png)

### 4. Drafts and saving

Edits auto-save as local drafts every few seconds and are restored if you
close and reopen a resource. Map, App, POI, Base Map, and Asset all follow the
same "not created until saved" flow: an abandoned new-resource draft is never
written to disk, and instead shows up as a draft card in the resource list
(visible in the [map list screenshot](#1-creating-a-map-and-setting-ground-control-points)
above) that you can resume or discard. Deleting a map moves it to a trash
location instead of deleting it immediately.

### 5. Exporting and importing

- Maps are exported with the **Export** button in the map editor's header
  (visible in the [GCP tab screenshot](#1-creating-a-map-and-setting-ground-control-points)
  above); it is available regardless of which editor tab is active. A new map
  is imported from a previously exported file with the **Import** button on
  the **Manage Maps** list (visible in the [map list screenshot](#1-creating-a-map-and-setting-ground-control-points)
  above).
- POI sources export as GeoJSON, or as a ZIP package when they include image
  references, and can be imported back with internal image references
  resolved automatically. Apps export as a single ZIP (`{appID}.zip`),
  optionally including a static, PWA-ready build. Both use the same **Export**
  button pattern in their own editor headers (visible in the
  [POI editor](#2-adding-and-editing-pois) and
  [app editor](#3-building-an-app) screenshots above).
- A map with unresolved ground-control-point errors cannot be previewed, but
  exporting the map itself still succeeds; an app that includes such a map,
  or that references a map missing from the database (e.g. deleted), is
  blocked from saving, previewing, and exporting until the issue is fixed.
  The same app-blocking state appears earlier as a red badge in the App list.
  Yellow list badges do not block the save gate by themselves, but they mark
  references or assets that preview/export would drop or warn about.
  (Quoted from the README's [Export and Import](../blob/master/README.md#export-and-import)
  section — see there for the complete, up-to-date wording.)

---

## Legacy Tutorial (0.1.x era, archived)

> The steps below are preserved from the legacy (0.1.x, circa 2018) Wiki
> content for historical reference. They describe an older, simpler editor
> (single map list + GCP-setting tab) and do not reflect the POI editor,
> master-detail resource lists, drafts, or export/import features added since.
> The current workflow is described in the
> [Current workflow](#current-workflow-070) section above; the current
> development setup is documented in the
> [README § Development](../blob/master/README.md#development).

### 1. Create a new map

When MaplatEditor starts, the map list is shown. Click the **New** button to
create a new map.

![Create new](images/howtouse1createnew.png)

Fill in the metadata form. Three fields are required:

- **Map ID** — becomes the filename. Half-width alphanumeric only. Use the
  **Uniqueness check** button to verify no duplicate exists.
- **Map name** — the human-readable title.
- **Map image copyright** — the attribution string shown in the viewer.

![Mandatory metadata](images/howtouse3mandatorymeta.png)

Once the required fields are filled, the **Save** button becomes available.
After saving, the map appears in the list on the next launch.

![Save button](images/howtouse4savebutton.png)

### 2. Upload the map image

Click the **Map upload** button on the edit screen.

![Upload button](images/howtouse5uploadbutton.png)

Select a JPEG image in the file dialog (only `.jpg` is supported in the
legacy UI; check the README for the current supported formats).

![Upload select](images/howtouse6uploadselect.png)

After upload completes (may take a while for large images), the **GCP setting**
tab becomes available.

![Upload finish](images/howtouse7uploadfinish.png)

### 3. Set ground control points (GCPs)

The GCP setting tab shows the historical map on the left and an accurate
modern map on the right.

![Mapping start](images/howtouse8mappingstart.png)

Use the magnifier button on the right map to search by place name and
narrow the region.

![Place search](images/howtouse9placesearch.png)

Use the top-right button on the right map to switch the base layer
(OpenStreetMap / GSI / historical aerial photos / 今昔マップ on Web etc.).
Older aerial photos and historical maps are useful when modern roads and
rivers no longer match the historical image.

![Base map select](images/howtouse10basemapselect.png)

**Right-click** on either map at the desired location and choose
**Add marker**. Place markers alternately on the left and right maps — each
pair becomes a single GCP.

![Add marker](images/howtouse11addmarker.png)

### 4. Edit and delete markers

- **Move** — left-click and drag a marker to reposition it.
- **Delete** — right-click a marker and choose **Delete marker**. Both halves
  of the GCP pair are removed at once.
- **Show pair** — right-click and choose **Show corresponding marker** to
  locate the other half of the GCP pair. Useful when the map is crowded.

![Show pairs](images/howtouse13showpairs.png)

### 5. Save

Press **Save** at any point to persist the GCPs and metadata.

![Added markers](images/howtouse12addedmarkers.png)

### Development setup (legacy)

> The instructions below are the legacy Electron + ImageMagick + submodule
> sparse-checkout flow from 0.1.x. The current development setup uses
> Vite + pnpm and is documented in the
> [README § Development](../blob/master/README.md#development).

The legacy setup required:

- Node.js + Electron
- ImageMagick (for the `convert` command used by the tile generator)
- Repository clone with submodule sparse-checkout (to slim the bundled
  Maplat source)

These steps are no longer required for end users — download the desktop
installer from the [README](../blob/master/README.md) instead.

---

**[日本語版はこちら / Read this page in Japanese](Tutorials.ja)**

## See Also

- [Home](Home)
- [Concepts](Concepts) — Maplat data formats and MaplatEditor's role
- [FAQ](FAQ)
- [README](../blob/master/README.md) — download and development setup
