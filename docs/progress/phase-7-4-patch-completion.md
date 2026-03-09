# Phase 7-4 Patch Completion Report

- Phase: 7-4 Patch
- Title: Instagram Carousel Planning Backfill
- Status: Done
- Completed On: 2026-03-09

## Summary

- Instagram generation no longer depends on the first LLM draft to volunteer a `slides` array before becoming a carousel.
- Carousel planning now defaults toward 4-slide feed output, while preserving explicit single-image requests.
- Template-family carousel rendering and editor/runtime tests were tightened around multi-template slide sequences.

## API Behavior Update

- Generation now runs a carousel repair/backfill step when the initial Instagram draft resolves to 0-1 slide.
- If repair still omits `slides`, a deterministic 4-slide fallback is synthesized so saved metadata stays carousel-shaped.
- Explicit single-image phrases such as `한 장` or `single image` still keep the draft on one slide.

## UX Flow Update

- “인스타그램 포스팅 작성” style requests now route into Instagram generation more reliably instead of drifting toward blog wording.
- Carousel drafts can reuse one base template family while varying slide templates for cover, story, stats, and CTA cards.
- Editor/runtime loading now preserves those per-slide template assignments instead of flattening everything back to slide 0 assumptions.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api exec tsx --test tests/phase-7-4-instagram-carousel.test.ts tests/phase-7-4-instagram-carousel-planner.test.ts tests/phase-7-4-instagram-template-assignment.test.ts tests/phase-7-4-instagram-slide-image-gaps.test.ts` passed.
- `pnpm --filter @repo/api test:unit` still has the pre-existing `Phase 5-3 campaign chain` failures.

## Follow-up

- Add an explicit user-facing carousel vs single-image control instead of relying only on prompt heuristics and repair logic.
- Replace deterministic fallback overlay copy with template-aware, role-aware localized microcopy when repair planning misses.
- Add desktop smoke coverage for multi-template carousel generation from chat trigger through editor preview.

### Decisions

[D-019]

Why this approach:
Carousel storage/editor support was already in place, so the missing piece was generation reliability; adding repair/backfill after the first draft fixed the real user-visible failure without changing downstream contracts.

Alternatives considered:
- Relying only on a stronger first prompt was rejected because live testing already showed that the model could still return a single-image draft intermittently.

Blockers hit:
- The first LLM pass could legally omit `slides`, which collapsed the whole flow to one image; this was resolved by a second repair prompt plus deterministic fallback synthesis.

Tech debt introduced:
- DEBT-015 deterministic carousel fallback copy can become semantically generic when the repair prompt also misses -> affects Phase 7-4 polish.
