<!-- SECTION 1: Header (logo, badges, title) -->
<p align="center">
  <img src="https://code4history.github.io/Maplat/page_imgs/maplat.png" alt="MaplatEditor logo" width="200" />
</p>

<h1 align="center">MaplatEditor</h1>

<p align="center">
  [![CI](https://github.com/code4history/MaplatEditor/actions/workflows/build.yml/badge.svg)](https://github.com/code4history/MaplatEditor/actions/workflows/build.yml)
  [![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
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

- Desktop application for authoring Maplat historical map data (Windows / macOS)
- GUI for map registration, control-point setting, and tile generation
- Creates data consumable by Maplat viewer libraries (`@maplat/ui` /
  `@maplat/core`)
- Bundles OpenLayers and the Maplat core libraries — no separate install needed
- Open-source (Apache 2.0 from version 0.7.0) — companion to the Maplat viewer
  ecosystem

<!-- SECTION 5: Quick Start -->
## Quick Start

> Release-dependent information (ADR-0012). The version `0.7.0` below is the
> current release; update it on each new release.

### Download

MaplatEditor is distributed as a desktop installer via GitHub Releases.

| Platform | Download |
|---|---|
| Windows (x64) | [MaplatEditor.Setup.0.7.0.exe](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor.Setup.0.7.0.exe) |
| macOS (Apple Silicon) | [MaplatEditor-0.7.0-arm64.dmg](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-0.7.0-arm64.dmg) |
| macOS (Intel x64) | [MaplatEditor-0.7.0.dmg](https://github.com/code4history/MaplatEditor/releases/download/v0.7.0/MaplatEditor-0.7.0.dmg) |

> See the [v0.7.0 release page](https://github.com/code4history/MaplatEditor/releases/tag/v0.7.0)
> for the full list of assets and release notes.

### Screenshots

#### MapList (map list)

![MapList](https://raw.githubusercontent.com/code4history/MaplatEditor/master/maplist.png)

#### MapEdit (map editing)

![MapEdit](https://raw.githubusercontent.com/code4history/MaplatEditor/master/mapedit.png)

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

<!-- SECTION 6: Prerequisites -->
## Prerequisites

> MaplatEditor is a desktop application built with Electron + Vite. There is
> no `engines` field in `package.json`; the versions below are the tested
> development environment.

- Node.js: v20 or v22 (LTS tested via GitHub Actions)
- pnpm: `>=9.0.0` (required; the project uses pnpm)

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
