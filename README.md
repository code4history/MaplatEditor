<!-- SECTION 1: Header (logo, badges, title) -->
<p align="center">
  <img src="https://code4history.github.io/Maplat/page_imgs/maplat.png" alt="MaplatEditor logo" width="200" />
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
- App editor covers base map and POI source selection, per-source settings
  (built-in / TMS / WMTS), a coverage-area drawing tool, and PWA/OGP metadata
  (icons, splash image, keywords, canonical URL)
- Creates data consumable by Maplat viewer libraries (`@maplat/ui` /
  `@maplat/core`); bundles OpenLayers and the Maplat core libraries so no
  separate install is needed

### POI Editor

- Add, move, and delete points of interest (POIs) directly on the map, edit
  multilingual name/description/HTML/address/URL/icon fields, and undo/redo
  changes (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z or Y)
- Three content modes per POI — Standard, HTML, and Web Page — plus inline
  image references (`maplat-asset:<uid>`) that resolve to uploaded assets
- An Assets tab manages shared images (search, rename, reference-checked
  delete) through the same icon/asset/URL picker used for icon and image
  fields
- A "Raw" toggle exposes the underlying GeoJSON for direct editing (each
  Apply is one undo step); sources over 1,000 features or 5 MB switch to
  read-only for performance
- Remote (registered) POI sources are read-only; a "copy locally" action
  creates an editable local copy
- Each POI source reference in a map or app can carry per-reference overrides
  — title, icon, selected icon, and a "hidden by default" flag. The flag hides
  that layer when the map/app is first opened (viewers can turn it back on)
  without modifying the POI source itself, so the same source can start
  visible in one app and hidden in another
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
  scroll and full-text search across all five types, plus bounding-box range
  search for Map, POI, Base Map, and App
- Map, App, and POI source lists show diagnostic badges for strict map
  errors, missing map/base-map/POI/asset references, and unsupported app POI
  formats, using the same checks as save, preview, and export
- Base map and image asset editing use left-list/right-edit master-detail
  screens (replacing the previous modal editors), with the selected item
  reflected in the URL for direct links
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
- Importing a map image is subject to JPEG decode limits (8192 MB of memory
  and 800 MP of resolution by default). An image above the limits is
  detected before decoding, and the error tells you **how much is needed,
  what is currently configured, and what to set**. Raise "JPEG decode memory
  limit" / "JPEG resolution limit" on the Settings page. These are
  arithmetic thresholds that guard against decompression blow-ups; they
  **do not reserve actual memory**, so raising them will not help if the
  machine runs out of physical memory
- Only one instance of MaplatEditor runs at a time; launching a second
  instance brings the existing window to the front instead of opening a new
  one

### Export and Import

- Apps export as a single ZIP (`{appID}.zip`), optionally including a
  static, PWA-ready build (manifest, icons, splash image)
- POI sources export as GeoJSON, or as a ZIP package when they include image
  references, and can be imported back with internal image references
  resolved automatically
- A map with unresolved ground-control-point errors cannot be previewed, but
  exporting the map itself still succeeds; an app that includes such a map,
  or that references a map missing from the database (e.g. deleted), is
  blocked from saving, previewing, and exporting until the issue is fixed

### Thumbnails and Localization

- 512px high-definition thumbnails for maps, base maps, and apps are
  generated automatically on upload, and backfilled for existing data on
  first launch after upgrading
- UI available in 11 languages: English, Japanese, German, Korean,
  Vietnamese, Chinese (Simplified), Chinese (Traditional), French, Spanish,
  Thai, and Indonesian. The 9 languages beyond English/Japanese are machine
  translated and have not undergone human quality review
- Open-source (Apache 2.0 from version 0.7.0) — companion to the Maplat
  viewer ecosystem

<!-- SECTION 5: Quick Start -->
## Quick Start

> Release-dependent information (ADR-0012). The version `0.7.0` below is the
> current release; update it on each new release.

### Download

MaplatEditor is distributed as a desktop installer via GitHub Releases.

| Platform | Download |
|---|---|
| Windows (x64) | [MaplatEditor-Windows-0.7.0-x64-Setup.exe](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-Windows-0.7.0-x64-Setup.exe) |
| macOS (Apple Silicon) | [MaplatEditor-Mac-0.7.0-arm64.dmg](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-Mac-0.7.0-arm64.dmg) |
| macOS (Intel x64) | [MaplatEditor-Mac-0.7.0-x64.dmg](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-Mac-0.7.0-x64.dmg) |

> See the [v0.7.0 release page](https://github.com/code4history/MaplatEditor/releases/tag/v0.7.0)
> for the full list of assets (including Linux AppImage and Windows arm64)
> and release notes.

### Screenshots

> Screenshots of the MapList and MapEdit screens are pending. The legacy Wiki
> tutorial images are preserved in the
> [Wiki Gallery](https://github.com/code4history/MaplatEditor/wiki/Gallery).

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
     MaplatEditor-specific note (design decision recorded in m14-t2 task
     design §5 #4). -->
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

> MaplatEditor is the data authoring tool used to create the maps and POIs
> that the viewers above render. The Maplat ecosystem is end-to-end:
> author with MaplatEditor, serve with any of the viewer libraries.

<!-- SECTION 9: Nayuta links -->
## Links

| Audience | Link | Purpose |
|---|---|---|
| Project info / features / cases | <https://www.maplat.jp/en/> | Product site |
| Sponsor / business inquiry | <https://www.nayuta-inc.co.jp/en/> | Corporate site (Nayuta, Inc.) |

> ADR-0013: Apache-licensed repositories (this one) link to both sites.
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
