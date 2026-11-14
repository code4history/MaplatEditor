<!-- SECTION 1: Header (logo, badges, title) -->
<p align="center">
  <img src="page_imgs/maplat.png" alt="MaplatEditor logo" width="200" />
</p>

<h1 align="center">MaplatEditor</h1>

<p align="center">
  <a href="https://github.com/code4history/MaplatEditor/actions/workflows/build.yml"><img src="https://github.com/code4history/MaplatEditor/actions/workflows/build.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
</p>

<!-- SECTION 2: Elevator Pitch -->
## About MaplatEditor

MaplatEditor is the desktop data-authoring tool for the
[Maplat](https://github.com/code4history/Maplat) historical map viewer. It
provides a GUI for registering maps, setting ground control points, generating
tiles, and assembling the app data consumed by the Maplat viewer libraries
(`@maplat/ui` / `@maplat/core`). MaplatEditor runs on Windows and macOS.

MaplatEditor is open-source under the Apache License 2.0 (from version 0.7.0).
The package is **not published to npm** (`private: true` in `package.json`);
binaries are distributed via GitHub Releases.

## Caution

> ⚠ **Map positions and the map data format version change.**

<!-- SECTION 3: Language switch link -->
**[Read this document in Japanese / 日本語で読む](README.ja.md)**

<!-- SECTION 4: Key Features -->
## Key Features

### Map and App Data Authoring

- Desktop application for authoring Maplat historical map data (Windows / macOS)
- GUI for map registration, ground control point (GCP) placement, and tile
  generation, with geocoder-assisted address search and one-click estimation
  of home position/zoom from GCPs or app sources
- Right-click a correspondence line to insert a midpoint GCP and split the
  line, restoring a workflow from the original editor
- The dialogs for drawing a rectangular extent (usage extent, coverage, and
  so on) also accept the west, south, east, and north longitude/latitude
  typed directly; the rectangle follows the values, an invalid value shows
  the reason next to the fields, and a value outside the coverage is cropped
  to it (with a notice)
- App editor covers base map and POI source selection, per-source settings
  (built-in / TMS / WMTS), a coverage drawing tool, and PWA/OGP metadata
  (icons, splash image, keywords, canonical URL)
- Creates data consumable by Maplat viewer libraries (`@maplat/ui` /
  `@maplat/core`); bundles OpenLayers and the Maplat core libraries so no
  separate install is needed

### Map Metadata

- Every map has a required **Title** — shown as the card name in resource
  lists and as the header on the map's edit screen — and an optional
  **Display label**, a short name shown in the viewer's map switcher. The
  15-character length limit these fields had in earlier versions has been
  removed; only Title being non-empty is still required
- The display label is written to the map's exported `map.json` as `label`

### Importing from IIIF

- **Import from IIIF** on the map list takes the URL of an IIIF Manifest or
  `info.json`, lets you choose a canvas, and creates a new map in one of two
  ways: **Deliver from IIIF** or **Bibliographic data only from IIIF**. With
  **Deliver from IIIF**, the image is served from the IIIF image server and
  no tiles are generated. It is available only when, among other checks, the
  server uses https, allows CORS for `*`, and uses a supported IIIF version
  and tiling, the image is not too large, its size matches the map record,
  and the address is not blocked; otherwise the reason is shown. With
  **Bibliographic data only from IIIF**, you choose the image file yourself
  and tiles are generated as usual
- On the metadata tab of a map linked to a Manifest, you choose for each
  field whether it is copied from IIIF and whether the value comes from the
  Manifest or from the canvas, and press **Copy from IIIF**. **Compare with IIIF
  again** fetches the Manifest again and lists the current value, the value
  copied earlier, and the new value, labelled "Unchanged", "Edited by hand",
  or "Changed in IIIF"; only the rows you select are overwritten, so hand
  edits stay unless you pick them. The Manifest's and the canvas's own
  bibliographic data are shown read-only. If copying fails — for example
  because the image service's size no longer matches the map — nothing in
  the map changes
- Maps delivered from IIIF are exported without tiles (both in app ZIPs and
  in single-map ZIPs); maps that only take their bibliographic data from
  IIIF export their tiles as usual
- Each map in an app has an **IIIF bibliographic table** setting that
  decides whether the viewer shows a table of all bibliographic fields
  (default: not shown)

### App Delivery Settings

- New apps default to PWA off, tile cache off, and Marker List UI on;
  existing and imported apps keep their previously saved values (a missing
  key falls back to the pre-1.0 defaults: PWA on, cache on, Marker List UI
  off). Tile cache can only be enabled while PWA is enabled — turning PWA
  off also turns the cache off
- When an app references a map, the only per-app override available is the
  map's **Display label**; all other map attributes come from the map itself
  (per-app settings such as **Exclude from offline viewing** below belong to
  the app, not to the map)
- Each map — and each built-in or TMS base map — in an app can be marked
  **Exclude from offline viewing**: its tiles are not kept on the device and
  are loaded from the provider every time, for providers that do not allow
  bulk downloads (such as the official OpenStreetMap tiles). The mark is
  exported as `noCache: true` on that source and can only be changed while
  PWA and tile cache are on
- Each app chooses the **MapLibre GL JS version** used for MapLibre base
  maps in the preview and in the exported app: **5** (5.6.2, the default)
  or **6** (6.16.0). Version 6 supports newer style features, but the
  browsers that open the exported app need import maps and WebGL 2 (older
  browsers such as Safari 16.3 do not show the map); switching to 6 asks
  for confirmation. The editor checks each MapLibre base map's style and
  shows the result under the Style URL in the base map editor; if an app on
  5 uses a base map that needs 6, a warning with a **Switch to version 6**
  button appears on the app screen and above the preview, and export asks
  before continuing. The check never changes the version by itself

### POI Editor

- Add, move, and delete points of interest (POIs) directly on the map, edit
  multilingual name/description/HTML/address/URL/icon fields, and undo/redo
  changes (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z or Y)
- Four content modes per POI — Standard, HTML, Web Page, and Link — plus
  inline image references (`maplat-asset:<uid>`) that resolve to uploaded
  assets. **Link** edits the viewer's `directgo`: clicking the POI jumps
  straight to an http/https URL or a relative path such as a
  `#!s:<mapID>/…` map position, optionally in a new tab (links do not open
  in the editor's preview). Links to a `#!s:` map position work only while
  the app's **State URL** setting is on. Outside Link mode, a `directgo`
  that holds only whitespace or `{ href: "" }` is kept as is but shown as a
  warning with the POI's ID
- An Assets tab manages shared images (search, rename, reference-checked
  delete) through the same icon/asset/URL picker used for icon and image
  fields
- A "Raw" toggle exposes the underlying GeoJSON for direct editing (each
  Apply is one undo step); sources over 1,000 features or 5 MB switch to
  read-only for performance
- Remote (registered) POI sources are read-only; a "copy locally" action
  creates an editable local copy
- Each managed POI source carries its own layer metadata — a Layer Icon and
  Layer Selected Icon, edited on the POI source's own screen — used as that
  source's default icon and selected-state icon
- Each POI source reference in a map or app can carry per-reference overrides
  — title, icon, selected icon, and a "hidden by default" flag. The flag hides
  that layer when the map/app is first opened (viewers can turn it back on)
  without modifying the POI source itself, so the same source can start
  visible in one app and hidden in another. These overrides share attribute
  names with the source's own layer metadata above but apply at a different
  level: the source's Layer Icon/Layer Selected Icon are its defaults, while
  a reference's icon/selected-icon override replaces them for that one
  map/app only
- A map or app's `pois` field accepts six historical forms defined by the
  Maplat viewer: a URL string, an inline FeatureCollection, an array of
  FeatureCollections, an array of legacy POI objects, an old layer-name-keyed
  dictionary, and a layer-ref wrapper (`{ layer, hide?, title?, icon?,
  selectedIcon? }`). The layer-ref wrapper — used by managed POI source
  references — is the current form; the URL string, inline FeatureCollection,
  FeatureCollection array, and legacy POI object array are legacy but still
  opened as read-only/convertible data by the editor (see below). The old
  layer-name-keyed dictionary is the one exception: **MaplatEditor does not
  support it at all** — the POI panel shows no entries and editing in that
  tab is disabled, though the original data is preserved unchanged rather
  than lost
- Legacy map/app-embedded POIs (inline `pois` entries) are preserved as-is:
  the POI data tab shows them read-only, grouped into panes per viewer
  layer, with item counts and badges distinguishing "Map-embedded POI" and
  "External URL reference" entries, and an explicit "Convert to GeoJSON"
  action — one per layer: a single-layer array converts as a whole, while
  in a multi-layer list each FeatureCollection card converts on its own —
  turns a layer into an editable POI source draft without touching the
  original data; while such embedded data remains, GeoJSON POI sources
  cannot be added to the same list (delete the embedded entries — with
  confirmation — or convert them first)

### Resource Management

- Five resource lists (Map / App / POI / Base Map / Asset) use infinite
  scroll and full-text search across all five types, plus filter area search
  for Map, POI, Base Map, and App
- Map, App, and POI source lists show diagnostic badges for strict map
  errors, missing map/base-map/POI/asset references, and unsupported app POI
  formats, using the same checks as save, preview, and export
- Base map and image asset editing use left-list/right-edit master-detail
  screens (replacing the previous modal editors), with the selected item
  reflected in the URL for direct links
- User-created base maps support optional, multilingual creation dates,
  target eras, owners/contributors, mappers, references, and descriptions
  in the collapsible "Source information (optional)" section. Saved values
  are included in exported settings files and shown in the viewer's information
  dialog. Unset fields are omitted; built-in base maps are not editable
- Every edit screen validates the slug (ID) automatically as you type — no
  separate "check availability" step — and renaming a map's slug now edits
  the same map in place instead of prompting to copy or move it
- Duplicate and delete (with a reference list) are available from a common
  list menu for every resource type; import is available from the Map and
  POI source lists

### Drafts and Data Safety

- Edits auto-save as local drafts every few seconds and are restored when
  you reopen a resource; uploaded map images are also kept in an
  app-managed draft area, so they survive OS restarts and temp-folder
  cleanup; if a save conflicts with a newer revision, a dialog lets you
  resolve it
- Map, App, POI, Base Map, and Asset all follow the same "not created until
  saved" flow — an abandoned new-resource draft is never written to the
  data folder, and shows up as a draft card in the list that you can resume
  or discard (discarding also releases the draft's image storage)
- Switching the data folder discards all unsaved drafts (draft cards and
  their staging tiles); already-saved data is not affected. Drafts are
  app-global and do not travel between data folders
- Deleting a map moves its original images to the operating system's Trash
  (via Electron's `shell.trashItem`) instead of deleting them immediately,
  so you can rescue them with the OS's standard "Put Back" operation
- MaplatEditor migrates the data folder to the current format automatically
  on first launch after an upgrade — legacy data import, thumbnail
  generation, and originals renaming — without deleting existing data; see
  [Prerequisites](#prerequisites) for details
- Importing a map image is subject to JPEG decode limits. By default, both
  "JPEG decode memory limit" and "JPEG resolution limit" on the Settings
  page are blank, meaning the required amount is determined automatically
  per image; entering a number instead sets an upper **cap** on that
  automatic value (values beyond what this app can handle are lowered
  automatically). An image whose automatic requirement exceeds the
  configured cap is detected before decoding, and the error tells you **how
  much is needed, what is currently configured, and what to set**. Very
  large images (over 100 MP) also show a confirmation dialog before import,
  since decoding takes a long time at that size (roughly 5 minutes at
  100 MP, over an hour at 400 MP) and cannot be canceled once started.
  These are arithmetic thresholds that guard against decompression
  blow-ups; they **do not reserve actual memory**, so raising them will not
  help if the machine runs out of physical memory
- Only one instance of MaplatEditor runs at a time; launching a second
  instance brings the existing window to the front instead of opening a new
  one
- If the data folder's database cannot be opened, the resource lists show
  why — no permission, a read-only location (such as a disk image), a
  folder that cannot be found, or another error — together with how to fix
  it; the fix for a missing permission is worded separately for macOS,
  Windows, and Linux. A database that opens but cannot
  be written to is detected when it is opened, not at the first save

### Export and Import

File dialogs remember the last folder separately for imports, exports, and
image selection, including after restarting the app. Cancelling a dialog
leaves the remembered folder unchanged. If that folder is no longer
available, the dialog opens in Documents. The data storage folder picker
uses the currently configured storage folder when it is available, or
Documents otherwise.

- Apps export as a single ZIP (`{appID}.zip`), optionally including a
  static, PWA-ready build (manifest, icons, splash image); each map/base-map
  source is referenced by a `settingFile` (`maps/<slug>.json`) rather than
  embedded inline, and any base maps the app uses get their own
  `maps/<slug>.json` written into the export alongside the maps'
- POI sources are exported with **Export** on the POI source screen. A
  dialog lets you choose the format — GeoJSON, CSV, or JSON — and, for
  GeoJSON only, whether to include images (a ZIP when there are images to
  bundle). GeoJSON and ZIP keep every field and can be imported back as a
  new source. Image references are resolved automatically only from a ZIP;
  GeoJSON exported without images keeps the asset UUIDs as plain values.
  CSV (UTF-8 with
  BOM, for spreadsheets) keeps only the ID, name, description, address,
  image URL, and coordinates, and tells you which fields were left out;
  JSON is an array of POIs that keeps HTML, custom fields, and asset
  references
- **Import into this source…** reads a CSV or KML file into an existing POI
  source, either by **Append** (every row becomes a new POI; an ID already
  in use gets `-2`, `-3`, ...) or by **Overwrite** (POIs with the same ID
  are updated and the rest are added; empty cells change nothing, and POIs
  not in the file are kept). CSV may be UTF-8 or Shift_JIS; from KML, Point
  placemarks are read (KMZ is not supported). The dialog previews the first
  rows and lists rows that need attention, and one Undo reverts the whole
  import. CSV and KML can also be imported as a new source with **Import
  File** in the list
- Maps export as a ZIP containing the map definition, tiles, both standard
  and 512px thumbnails, and a `pois/` directory holding one `*.geojson` file
  per POI layer together with the images they reference — POI data always
  leaves the map definition as an external file, referenced through a
  layer-ref wrapper; importing such a ZIP restores those layers as managed
  POI sources
- If an imported map's ID collides with an existing one, the import no longer
  fails: the map is assigned the next free ID (`{ID}-2`, `{ID}-3`, ...). The
  existing map is never overwritten — the import adds a separate map. IDs are
  unique across maps, apps, POI sources, and image assets, so the same rule
  applies to every kind of import
- Imported ZIPs (maps and POI packages) are checked before anything is
  extracted: a ZIP file over 2 GiB, too many entries, sizes that do not
  match the data, or an excessive total expansion are refused. Map ZIPs
  may hold up to 50,000 entries; POI packages up to 512 entries and
  100 MiB in total after expansion. Also refused are ZIPs with
  entry names that cannot be stored on every OS (Windows reserved names,
  trailing dots or spaces, control characters, `<>:"|?*`, or names that
  differ only in letter case or Unicode normalization). Exports keep the
  letter case of names and number names that differ only in case
  (`foo-2`), so such an exported ZIP can still be imported back
- A map with unresolved ground-control-point errors cannot be previewed, but
  exporting the map itself still succeeds; an app that includes such a map,
  or that references a map missing from the database (e.g. deleted), is
  blocked from saving, previewing, and exporting until the issue is fixed

### Thumbnails and Localization

- 512px high-definition thumbnails for maps, base maps, and apps are
  generated automatically on upload, and backfilled for existing data on
  first launch after upgrading. A map thumbnail whose longer side is 512px
  or less is kept at its own size (never enlarged); base map and app
  thumbnails, and images chosen with **Replace 512px…**, are scaled to 512px
  on the longer side even when smaller. The backfill
  covers every existing map that has tiles — in any tile format, such as
  TIFF — but no 512px thumbnail; maps that already have one, including
  manually replaced ones, are left untouched
- Maps, base maps, and apps also keep a 52px icon alongside the 512px
  thumbnail; both can be replaced manually (**Replace 512px…** / **Replace
  52px…**) from the Thumbnail management panel, with **Also create 52px
  from 512px** checked by default so a single 512px replacement updates
  both. For base maps, **Generate from coverage** produces the 512px
  thumbnail and the 52px icon together from the same crop. Built-in base
  maps cannot have their thumbnails replaced or generated
- Thumbnail replacement bypasses Save and Undo — a replaced image is
  written to file immediately; to revert, replace the image again
- UI available in 11 languages: English, Japanese, German, Korean,
  Vietnamese, Chinese (Simplified), Chinese (Traditional), French, Spanish,
  Thai, and Indonesian. The 9 languages beyond English/Japanese are machine
  translated and have not undergone human quality review
- Open-source (Apache 2.0 from version 0.7.0) — companion to the Maplat
  viewer ecosystem

### Settings and Application Menu

- The Settings screen has three tabs: **Basic settings**, **Base map
  settings** and **MCP server** (a former tab for original-map settings has
  been removed)
- The **MCP server** tab turns on an optional, read-only local server for MCP
  clients such as Claude Code (off by default). See
  [Connecting MCP clients](docs/mcp.md)
- Packaged (distributed) builds no longer show the **Development** menu in
  the application menu; it still appears when running from source or under
  E2E test automation
- The About window shows the copyright notice shared by the Maplat
  repositories (`Copyright 2019-2026 Kohei Otsuka, Code for History / Nayuta, Inc.`) and
  its version line is read from the running app rather than hard-coded

<!-- SECTION 5: Quick Start -->
## Quick Start

<!-- release-pinned:start -->
> **Current release: `v1.2.0`** — This block is the only place in
> this repository that carries a release version; everything outside it is
> written against the 1.0 release.

### Download

MaplatEditor is distributed as a desktop installer via GitHub Releases.

| Platform | Installer |
|---|---|
| Windows (x64) | [MaplatEditor-Windows-1.2.0-x64-Setup.exe](https://github.com/code4history/MaplatEditor/releases/download/v1.2.0/MaplatEditor-Windows-1.2.0-x64-Setup.exe) |
| Windows (arm64) | [MaplatEditor-Windows-1.2.0-arm64-Setup.exe](https://github.com/code4history/MaplatEditor/releases/download/v1.2.0/MaplatEditor-Windows-1.2.0-arm64-Setup.exe) |
| macOS (Apple Silicon) | [MaplatEditor-Mac-1.2.0-arm64.dmg](https://github.com/code4history/MaplatEditor/releases/download/v1.2.0/MaplatEditor-Mac-1.2.0-arm64.dmg) |
| macOS (Intel) | [MaplatEditor-Mac-1.2.0-x64.dmg](https://github.com/code4history/MaplatEditor/releases/download/v1.2.0/MaplatEditor-Mac-1.2.0-x64.dmg) |
| Linux (x86_64) | [MaplatEditor-Linux-1.2.0-x86_64.AppImage](https://github.com/code4history/MaplatEditor/releases/download/v1.2.0/MaplatEditor-Linux-1.2.0-x86_64.AppImage) |
| Linux (arm64) | [MaplatEditor-Linux-1.2.0-arm64.AppImage](https://github.com/code4history/MaplatEditor/releases/download/v1.2.0/MaplatEditor-Linux-1.2.0-arm64.AppImage) |

> Release notes and checksums are on the
> [v1.2.0 release page](https://github.com/code4history/MaplatEditor/releases/tag/v1.2.0).
<!-- release-pinned:end -->

### Screenshots

> Current-version screenshots of the MapList and MapEdit screens are in the
> [Wiki Gallery](https://github.com/code4history/MaplatEditor/wiki/Gallery),
> alongside the legacy Wiki tutorial images.

### Development

#### Setup
Clone the repository and install dependencies.

```bash
git clone https://github.com/code4history/MaplatEditor.git
cd MaplatEditor
pnpm install
```

#### Development Server
Start the development server with hot reload.

```bash
pnpm dev
```

#### Build desktop installer

```bash
pnpm build         # Build the Vite app
pnpm dist          # Build desktop installer for the current OS
pnpm dist:mac      # macOS (universal)
pnpm dist:win      # Windows
pnpm dist:linux    # Linux
```

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Cmd/Ctrl+S | Save |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y | Redo |

The Map/App/POI editors and the POI-on-map editing pane share this set.

<!-- SECTION 6: Prerequisites -->
## Prerequisites

> MaplatEditor is a desktop application built with Electron + Vite. There is
> no `engines` field in `package.json`; the versions below are the tested
> development environment.

- Node.js: v20 or v22 (LTS tested via GitHub Actions)
- pnpm: `>=9.0.0` (required; the project uses pnpm)

> **Note**: On first launch after upgrading, MaplatEditor automatically
> migrates the data folder to the current format (legacy data import,
> thumbnail generation, and originals renaming to UUID filenames). No
> existing map data is deleted, and each step resumes safely if
> interrupted; startup may take longer than usual on that first run.

<!-- Known Limitations: not one of the 11 template sections; added here as a
     MaplatEditor-specific note. -->
## Known Limitations

- A map with unresolved ground-control-point errors cannot be previewed
  (exporting the map itself still works); an app that includes such a map,
  or that references a map missing from the database (e.g. deleted), cannot
  be saved, previewed, or exported until the issue is fixed.
- When a map is deleted, its original images go to the operating system's
  Trash; managing that Trash (restoring or emptying) is left to the OS and
  to you, like any other trashed file. Restoring a file from the Trash
  brings back the image file only — the map itself does not reappear in
  MaplatEditor.
- The 9 UI languages added beyond English/Japanese are machine translated
  and have not undergone human quality review.
- The interface currently renders in light mode only, even when the OS is
  set to dark mode.
- The viewer bundled with MaplatEditor (`@maplat/ui`), which is used for
  the preview and copied into exported apps, cannot yet draw maps delivered
  from IIIF. Such maps are not shown in the preview or in exported apps
  until the bundled viewer is a version that supports IIIF delivery.

<!-- SECTION 7 Peer Dependencies: omitted (OpenLayers is bundled as a regular dependency) -->

<!-- SECTION 8: Ecosystem / Related Repositories -->
## Ecosystem

MaplatEditor is part of the Maplat ecosystem by [Code for History](https://github.com/code4history).
See the full ecosystem map (8 repositories + product/corporate sites):

📖 **Ecosystem Map** — *(the diagram is currently kept in a private planning
repository; the Sister repositories table below is the public substitute)*

### Sister repositories

| Repository | License | npm | Role |
|---|---|---|---|
| [Maplat](https://github.com/code4history/Maplat) | Apache 2.0 | `@maplat/ui` | Main viewer |
| [MaplatCore](https://github.com/code4history/MaplatCore) | Apache 2.0 | `@maplat/core` | Core library |
| [MaplatTin](https://github.com/code4history/MaplatTin) | Apache 2.0 | `@maplat/tin` | TIN conversion |
| [MaplatTransform](https://github.com/code4history/MaplatTransform) | Apache 2.0 | `@maplat/transform` | Coordinate transform |
| [MaplatEditor](https://github.com/code4history/MaplatEditor) | Apache 2.0 | — | Data authoring tool (desktop) |
| [Chuci](https://github.com/code4history/Chuci) | MIT | `@c4h/chuci` | Multimedia swiper/viewer components |
| [Quyuan](https://github.com/code4history/Quyuan) | MIT | `@c4h/quyuan` | GeoJSON template extractor |
| [Weiwudi](https://github.com/code4history/Weiwudi) | MIT | `@c4h/weiwudi` | Tile cache Service Worker |

> MaplatEditor is the data authoring tool used to create the maps and POIs
> that the viewers above render. The Maplat ecosystem is end-to-end:
> author with MaplatEditor, serve with any of the viewer libraries.

<!-- SECTION 9: Nayuta links -->
## Links

| Audience | Link | Purpose |
|---|---|---|
| Project info / features / cases | <https://www.maplat.jp/en/> | Product site |
| Sponsor / business inquiry | <https://www.nayuta-inc.co.jp/en/> | Corporate site (Nayuta, Inc.) |

> Apache-licensed repositories (this one) link to both sites.
> MIT-licensed sister repos (Weiwudi / Quyuan / Chuci) carry no Nayuta link.

<!-- SECTION 10: License -->
## License

Apache License 2.0 — see [LICENSE](LICENSE).

```
Copyright 2019-2026 Kohei Otsuka, Code for History / Nayuta, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
