# Phase 7-2.2 Patch Completion Report

- Phase: 7-2.2 Patch
- Title: Instagram Skill Routing + Generation Stability Patch
- Status: Done
- Completed On: 2026-03-05

## Summary

- Fixed Instagram generation failure handling so slots do not remain in `generating` on pipeline errors.
- Aligned slot-link status to scheduler contract by replacing invalid `draft` with `pending_approval`.
- Restored deterministic explicit skill routing and pinned-skill override behavior for cross-skill requests.
- Fixed `@repo/media-engine` ESM import/export specifiers to prevent desktop runtime module resolution failures.

## API Behavior Update

- `linkContentToSlot` now updates `schedule_slots.slot_status` to `pending_approval`.
- Generation pipeline now marks slot `failed` with error metadata when execution aborts.
- `routeSkill` now routes valid `skill_trigger` immediately in initial state and still supports pinned-skill intent override.
- 7-1b routing golden contract now asserts explicit-trigger initial routing.

## UX Flow Update

- Skill picker selection for Instagram now enters Instagram flow instead of generic assistant fallback.
- Failed generation no longer leaves scheduler items indefinitely in `generating`.
- Desktop dev runtime now loads media-engine without `ERR_MODULE_NOT_FOUND`.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed (67/67).
- `pnpm --filter @repo/media-engine build` passed.
- `pnpm --filter @repo/desktop type-check` passed.

## Follow-up

- 7-2c: add explicit retry UX for `failed` generation slots.
- 7-2c: add E2E regression for skill picker -> generation -> slot lifecycle.
- 7-2c: consolidate routing/actionability policy docs to avoid trigger-policy drift.

### Decisions

[D-013]

Why this approach:
Router must honor explicit skill selection deterministically; topic clarification and actionability checks belong in skill execution flow.

Alternatives considered:
Deferring explicit trigger to LLM gating was rejected because low-confidence misses produced wrong generic fallback despite explicit user intent.

Blockers hit:
`slot_status='draft'` violated scheduler constraints and left slots in `generating`; status target was corrected and failure fallback was added.

Tech debt introduced:
No new debt. Existing `DEBT-010` remains and affects Phase 7-2c.
