# Phase 6-4b Completion Report

- Phase: 6-4b
- Title: Campaign Survey Interaction Upgrade + Scheduler Card Compaction
- Status: Done
- Completed On: 2026-03-07

## Summary

- Campaign survey now starts with required campaign naming and uses that value as the finalized campaign title.
- Survey interaction in chat supports staged multi-select submission to prevent accidental first-click sends.
- Scheduler cards were compacted with channel logo icons, overflow-safe chip layout, and toolbar create-button removal.
- Campaign Plan became a dedicated top-level page with list/detail review and scheduler handoff.

## API Behavior Update

- `SurveyQuestionId` now includes `campaign_name`, and completion gating enforces it as required.
- Survey parser accepts free-text campaign names and Korean goal mappings (`인지도`, `참여`) while keeping conversion flow.
- Campaign finalization now writes `campaigns.title` from survey answers instead of fixed fallback naming.
- Survey prompt output was restructured into explicit progress/question/choice guidance blocks.

## UX Flow Update

- Main navigation now exposes `campaign-plan` and wires page-context routing/localized labels end-to-end.
- Global/workspace chat survey options now support selected-state toggling and explicit `다중 선택 전송` action.
- Scheduler board/day drawer channel identity switched from long text labels to service logos.
- Scheduler board headline is now `스케줄러`, and `+ Content` CTA was removed from the toolbar.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed (72 tests, 0 failures).
- `pnpm --filter @repo/desktop type-check` passed.

## Follow-up

- Phase 6-4c: add slot time-level controls to complement date-only drag reschedule.
- Phase 7-3: connect Campaign Plan board actions to approval/editor pipelines beyond scheduler handoff.
- Phase 7-3: add E2E snapshot checks for multi-select survey chips and scheduler overflow behavior.

### Decisions

[D-015]

Why this approach:
We made campaign naming explicit up front and moved scheduler channel identity to icon-first cards to reduce ambiguity and card-density issues at the same time.

Alternatives considered:
- Keep goal-first survey and infer title later - rejected due generic campaign titles and weak project traceability.
- Keep text-based channel pills in scheduler cards - rejected because long labels caused overflow and visual noise.

Blockers hit:
- Multi-select survey answers were being sent on first click; resolved by staged client selection state and explicit submit action.
