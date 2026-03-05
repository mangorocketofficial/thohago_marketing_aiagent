# Phase 7-2.2 Completion Report

- Phase: 7-2.2
- Title: Template Schema Redesign (Strict Render Contract)
- Status: Done
- Completed On: 2026-03-05

## Summary

- Locked Instagram template rendering schema to `size/photos/texts` with optional non-rendering `meta`.
- Removed runtime styling branches (`overlays`, `badge`, `header`, `font_style`) and baked decorations into `background.png`.
- Unified overlay text persistence and transport to `overlay_texts` only across API, orchestrator, and desktop flows.

## API Behavior Update

- Template list contract now returns flattened `photos`, `texts`, and optional `meta`.
- Instagram metadata patch validates image selection using template required/min-max slot counts.
- Generation prompt/parser now uses `overlay_texts` JSON keyed by template text-slot IDs.

## UX Flow Update

- Editor overlay text fields are rendered dynamically from `texts[]`.
- Image controls now enforce template max slots and required slot count consistently.
- Chat generation card and editor seed both read overlay text from `overlay_texts` only.

## Validation

- `pnpm --filter @repo/media-engine build` passed.
- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed.
- `pnpm --filter @repo/desktop type-check` passed.

## Follow-up

- 7-2c: add visual regression snapshot gates for composed image parity.
- 7-2c: complete approval/revision workflow migration on the `overlay_texts`-only contract.
- 7-2c: expand template preset catalog after asset QA on the strict schema.

### Decisions

[D-012]

Why this approach:
Keeping runtime render contract minimal (`photos/texts`) prevents template-style growth from creating composer/editor branch complexity.

Alternatives considered:
- Keeping `overlays/badge/header` as runtime fields was rejected because each new visual pattern required additional rendering logic and UI coupling.

Blockers hit:
- Legacy dual-field writes (`overlay_main/sub` + `overlay_texts`) created drift risk; removed legacy write path and standardized on `overlay_texts`.

Tech debt introduced:
- No new debt. Existing `DEBT-010` remains and affects Phase 7-2c.
