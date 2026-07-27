# Concepts

Background on MaplatEditor: its role in the Maplat ecosystem, the data
formats it produces, and how it relates to the other Maplat libraries.

## Table of Contents

- [What MaplatEditor does](#what-maplateditor-does)
- [Data formats produced](#data-formats-produced)
- [Relationship to MaplatTin / MaplatTransform](#relationship-to-maplattin--maplattransform)
- [Relationship to the Maplat viewer](#relationship-to-the-maplat-viewer)
- [OpenLayers bundling](#openlayers-bundling)
- [See Also](#see-also)

---

## What MaplatEditor does

MaplatEditor is the **desktop data-authoring tool** for the Maplat viewer
ecosystem. It is an Electron + Vite application that runs on Windows and
macOS. Its job is to take a historical map image plus a set of ground control
points (GCPs) and produce the data files the
[Maplat](https://github.com/code4history/Maplat) viewer consumes.

MaplatEditor is **not published to npm** (`private: true` in `package.json`).
Binaries are distributed via GitHub Releases.

## Data formats produced

MaplatEditor produces two main kinds of data:

- **Map data** — placed under `maps/{mapID}.json`. Defines the coordinate
  correspondence between the historical image and the modern map (Web
  Mercator, SRID:3857). Can be either the human-editable **standard format**
  (with `gcps`) or the pre-computed **compiled format** (with `compiled`).
- **App data** — placed under `apps/{appID}.json`. Aggregates multiple map
  sources, POI definitions, and app-level settings (home position, default
  zoom, fake GPS for testing, etc.).
- **POI data** — managed as GeoJSON. A POI source exports as plain GeoJSON,
  or as a ZIP package when it includes image references (the images travel
  alongside the feature collection); importing a ZIP resolves those internal
  image references automatically back onto local assets. Legacy map/app data
  may instead embed POIs directly in the map or app document (inline `pois`
  entries); MaplatEditor preserves those untouched and offers an explicit,
  non-destructive "Convert to GeoJSON" action that copies them into a new
  editable POI source draft, so the map or app can be migrated to a POI
  source reference at the user's own pace.
- **Uploaded originals** — the original image files a user uploads (map
  images, POI/app assets) are stored under `originals/<uid>.<ext>`, named by
  a UUID assigned at upload time rather than by the user-facing slug. This
  keeps the on-disk filename stable even if the resource is later renamed,
  and existing slug-named files from before this convention are left in
  place rather than renamed (non-destructive).
- **Resource diagnostics** — the Map, App, and POI source lists attach
  UI-only badges derived from the same validation and preview/export helpers
  used by the editors. Yellow warning badges flag missing POI references,
  missing asset files, missing base-map thumbnail records, or unsupported app
  `pois` formats. Red danger badges flag `strict_error` map data and app map
  references that would make app save, preview, and export reject. These
  badges are not exported into `maps/*.json`, `apps/*.json`, or POI GeoJSON;
  they are a list-time summary of the current local database and files.

For the schema details of these formats, see the
[Maplat Wiki Concepts page](https://github.com/code4history/Maplat/wiki/Concepts)
(MaplatEditor produces the same formats the viewer consumes).

## Relationship to MaplatTin / MaplatTransform

MaplatEditor uses the Maplat coordinate-transform stack internally:

- [`@maplat/tin`](https://github.com/code4history/MaplatTin) — solves the TIN
  transform from the GCPs the user places.
- [`@maplat/transform`](https://github.com/code4history/MaplatTransform) —
  preprocessing utilities for tile generation and compiled-data production.

When the user clicks "Save", MaplatEditor runs `@maplat/tin`'s `updateTin()`
on the GCP set, checks `strict_status`, and serializes the result via
`getCompiled()` into the compiled map data file.

A compiled map whose `strict_status` is `strict_error` is still exportable as
map data, but it cannot be previewed and it causes any app that references it
to be rejected on save, preview, and export. The red resource-list badge uses
that same gate condition so the problem is visible before the user opens the
app editor or starts an export.

## Relationship to the Maplat viewer

The data MaplatEditor produces is consumed by
[Maplat](https://github.com/code4history/Maplat) (`@maplat/ui`) and
[MaplatCore](https://github.com/code4history/MaplatCore) (`@maplat/core`).
The viewer loads the app JSON, initializes the TIN transforms from the
compiled map data, and renders the historical maps with the homeomorphic
overlay guarantee.

This is the "end-to-end" of the Maplat ecosystem:

1. **Author** with MaplatEditor (place GCPs, generate tiles, configure app)
2. **Serve** the data files (static hosting, CDN, etc.)
3. **Render** with `@maplat/ui` (or `@maplat/core` for custom integration)

## OpenLayers bundling

Unlike `@maplat/core` and `@maplat/ui`, where OpenLayers is a **peer
dependency** the user must install separately, MaplatEditor bundles
OpenLayers (`ol`) as a regular `dependency` in its `package.json`. This is
because MaplatEditor is an end-user desktop application — the user should not
need to manage npm peer dependencies to use it.

For the same reason, MaplatEditor has no **Peer Dependencies** section in its
README and no `docs/api/` directory — it is a UI application, not a library
with a public API surface.

---

**[日本語版はこちら / Read this page in Japanese](Concepts.ja)**

## See Also

- [Home](Home)
- [Tutorials](Tutorials) — creating a map in MaplatEditor
- [FAQ](FAQ)
- [Maplat Wiki Concepts](https://github.com/code4history/Maplat/wiki/Concepts) — data format schemas
- [MaplatTin Wiki](https://github.com/code4history/MaplatTin/wiki) — TIN theory
- [README](../blob/master/README.md)
