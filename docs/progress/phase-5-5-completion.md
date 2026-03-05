# Phase 5-5 Completion Report

- Phase: 5-5
- Title: Skill Trigger Toggle + Guided Survey Input Model
- Status: Done
- Completed On: 2026-03-05

## Summary

- Added explicit skill trigger entry from chat input (`+`) and kept automatic LLM intent routing in background.
- Added session-level skill lock so routing does not oscillate after entering campaign-plan mode.
- Reworked campaign survey to explicit-choice-first flow with mandatory `직접 입력` option on every question.

## API Behavior Update

- `user_message` accepts optional `payload.skill_trigger` and prioritizes explicit trigger/skill lock routing.
- Survey answer parsing now prioritizes canonical options, supports index replies (`1`, `2`), and only uses LLM on direct-input path.
- Survey prompt messages now include structured metadata for UI-renderable choices and direct-input hint.

## UX Flow Update

- Chat input `+` menu lets users start campaign-plan mode directly with a deterministic trigger.
- Survey questions show quick-select options and a dedicated direct-input path instead of free-text-only ambiguity.
- Selecting `직접 입력` keeps the question pending until user sends concrete input (`직접입력: ...`).

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed.
- `pnpm --filter @repo/desktop type-check` and `build` passed.

## Follow-up

- Add strict canonical enum storage (`answer_enum` + `answer_raw`) for analytics-safe survey reporting.
- Extend same explicit-choice metadata contract to upcoming skills beyond `campaign_plan`.

### Decisions

[D-004]

Why this approach:
Explicit choice-first survey with a dedicated direct-input branch was chosen to prevent parser stalls and keep state transitions deterministic in production chat flows.

Alternatives considered:
- Pure free-text parsing only: rejected because repeated phrasing caused unresolved pending questions.
- LLM-first on every answer: rejected due to unnecessary latency/cost and lower deterministic behavior.

Blockers hit:
- Repeated `있음` replies failed to advance `content_source`; fixed by canonical option matching, direct-input gating, and targeted LLM fallback only for direct-input context.
