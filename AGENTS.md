# Repository Guidelines

## Core Operating Principles

These principles govern how an AI coding agent should operate in this repository, regardless of which tool (Claude Code, Codex, or others) is used.

1. **Response Language Discipline**: Follow this repository's working-language convention when responding to the user (for this repository, Japanese), and keep responses polite and concise. This rule governs the language the agent uses when *talking with the user* — it is a separate axis from the language this document itself is written in (English, see "Documentation Language" below), and separate from the bilingual (English/Japanese) convention that applies to README and Wiki pages.
2. **Respect for Existing Behavior**: Do not invent your own implementation or make unsupported leaps of inference. Prioritize faithfully reproducing and porting the logic of the existing implementation — the migration source, the specification, or prior commits — over introducing a novel design.
3. **Root-Cause Analysis**: When a problem or bug occurs, do not keep patching based on guesses. Always compare against the existing implementation or specification and investigate the root cause thoroughly before applying a fix.
4. **The Human Gate Is Sovereign**: Never decide on your own that it is fine to move on to the next step without an explicit response from the user to a question or confirmation request. The agent privately concluding that something is fine is not a substitute for the user confirming it — the user must obtain that assurance for themselves. Whether to proceed to the next step is always the user's exclusive prerogative. Proceeding without a response usurps that prerogative and must be treated as the equivalent of a coup — a grave violation, never a minor process slip.

### Documentation Language

This document (`AGENTS.md`) itself is written in English, independent of principle 1 above.

## Operational Rules & History

- Repository-specific operating rules for AI coding agents are recorded under `docs/superpowers/rules/`.

## Project Structure

Application code lives in `src/` (`components/`, `composables/`, `libs/`, `router/`, `services/`, `types/`, `utils/`, `views/`, `workers/`, plus `App.vue`/`main.ts`/`i18n.ts`). Electron main-process and IPC code lives in `electron/` (`adapters/`, `ipc/`, `main.ts`); an experimental Electrobun runtime lives in `electrobun/` (`bun/`, `shared/`, `view/`). Smoke and Playwright end-to-end tests live in `tests/` (`e2e/`, `fixtures/`); static assets live in `public/`. Release/build helper scripts live in `scripts/`.

### Modernization Scope Discipline
When working in this repository, stay within the current task's scope. If you notice an unrelated improvement idea (UI change, backend efficiency, new feature), do not implement it immediately — record it in `./FUTURE_PLAN.md` instead.

## Build, Test, and Development Commands

`pnpm dev` starts the Vite/Electron dev environment (`predev` ensures the bundled Electron binary is present). `pnpm build` runs `vue-tsc` (type checking) followed by `vite build`. `pnpm preview` serves the built renderer locally. `pnpm electrobun:dev` / `pnpm electrobun:build` run the experimental Electrobun runtime. `pnpm dist` (and its `dist:mac`/`dist:win`/`dist:linux` variants, each with `:x64`/`:arm64`/`:universal` where applicable) build and package the desktop app via `electron-builder`.

Technology stack (from `package.json`, measured 2026-07-25): `pnpm` as package manager, Electron `^39.8.5`, Vue `^3.5.32`, TypeScript `^5.9.3`, Bootstrap `^5.3.8`, Vite `^7.3.0`, with Electrobun `^1.18.1` as an additional experimental runtime.

## Coding Style & Naming Conventions

TypeScript with `strict: true` in `tsconfig.json`. This repository has no ESLint configuration file and no `lint` script; do not assume ESLint is available. Type checking is handled by `vue-tsc` as part of `pnpm build`; the Electrobun-specific surface has its own check via `pnpm typecheck:m2-electrobun` (`tsc -p tsconfig.electrobun.json --noEmit`). Match the existing Vue 3 `<script setup>` composition-API style used throughout `src/components/` and `src/composables/`.

## Testing Guidelines

This repository has no unified `test` script. Task-scoped smoke tests live under `scripts/` and run individually as `pnpm smoke:<task-id>` (dozens of scripts, one per implementation task, e.g. `pnpm smoke:m12-t22-data-io-dormant-preservation`). Playwright end-to-end specs live in `tests/e2e/` and run individually as `pnpm test:e2e:<task-id>` (e.g. `pnpm test:e2e:m11-t6`); most of these scripts run `scripts/ensure-electron.mjs` and `pnpm build` first. When adding a new task's tests, follow this per-task naming convention rather than introducing a shared `test` script.

## Commit & Pull Request Guidelines

Commits in this repository are predominantly task-ID-prefixed (e.g. `m12-t22:`, `m14-t3:`, `m13-t2:`), reflecting this project's internal task tracking; occasional Conventional-Commit-style fallbacks appear (`fix(smoke):`) for changes outside a tracked task. Keep commits scoped to one concern. Pull requests should describe the affected editor behavior, list which smoke/e2e scripts were run, and confirm `pnpm build` (which includes type checking) succeeds locally before requesting review.

## Release & Configuration Tips

Desktop builds are produced with `electron-builder` via `pnpm dist` and its per-platform variants (`electron-builder.config.cjs`); each publishes with `--publish never` by default. `postinstall`/`predev`/`predist` all run `scripts/ensure-electron.mjs` to guarantee a compatible bundled Electron binary before building. Keep secrets and any local map data out of the repository.

### Development Tooling Suggestions
Suggestions for improving the AI-assisted development workflow in this repository (skills, sub-agents, MCP integrations, or equivalent tooling for whichever AI coding tool is in use) are welcome. Research the option thoroughly, including setup and configuration steps, before proposing it.
