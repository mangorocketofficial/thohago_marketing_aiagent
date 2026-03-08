# Phase 7-4 Completion Report

- Phase: 7-4
- Title: Instagram Multi-Image Carousel Support
- Status: Done
- Completed On: 2026-03-08

## Summary

- Added canonical `slides[]` support for Instagram drafts so carousel content can store per-slide role, overlay text, and image-slot arrays.
- Added carousel-aware compose and cache/download flow in Electron while preserving legacy `composed.png` compatibility for slide 0.
- Added scheduler editor slide navigation and per-slide text/image editing on top of the existing template-aware Instagram editor.

## API Behavior Update

- Instagram draft parsing now accepts LLM `slides` output and synthesizes single-slide fallback when absent.
- Instagram persistence and metadata patch APIs now store canonical `slides` plus derived top-level compatibility fields.
- Image selection count is no longer capped to single-image assumptions and now supports carousel-safe totals.

## UX Flow Update

- Instagram editor now opens carousel drafts as slide-aware state instead of flattening everything into one preview.
- Users can switch slides, edit overlay text per slide, swap images per slide, and download all rendered slides together.
- Existing single-image drafts still load through the same editor without migration or separate UI.

## Validation

- `pnpm --filter @repo/media-engine type-check` passed.
- `pnpm --filter @repo/desktop type-check` passed.
- `pnpm --filter @repo/api exec tsx --test tests/phase-7-2a-golden.test.ts tests/phase-7-2a-instagram-intent.test.ts tests/phase-7-2a-instagram-survey.test.ts tests/phase-7-4-instagram-carousel.test.ts` passed.
- `pnpm --filter @repo/api type-check` currently fails on unrelated channel-typing errors in `service-helpers.ts` and `scheduled-content-query.ts`.
- `pnpm --filter @repo/api test:unit` still has pre-existing Phase 5-3 failures unrelated to 7-4.

## Follow-up

- Extend chat completion cards and other lightweight single-image readers to surface carousel count and non-slide-0 previews.
- Add Playwright smoke coverage for multi-slide compose, navigation, and download-directory flow.
- Add localized slide role labels and schedule-board carousel badges from the remaining 7-4 polish scope.

### Decisions

[D-017]

Why this approach:
`slides[]` was made the canonical Instagram carousel model, while top-level overlay/image fields remain derived compatibility fields from slide 0.

Alternatives considered:
- Reusing flat top-level `image_file_ids` across all slides was rejected because it breaks once a template has multiple photo slots per slide.

Blockers hit:
- Existing Electron compose/download flow assumed one cache artifact; this was resolved by adding `slide-{n}.png` plus a compatibility alias to `composed.png`.

Tech debt introduced:
- DEBT-013 lightweight carousel read surfaces still collapse to slide 0 metadata/preview -> affects Phase 7-4 polish.
