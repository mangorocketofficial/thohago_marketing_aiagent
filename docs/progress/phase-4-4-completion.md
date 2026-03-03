# Phase 4-4 Completion Report

- Phase: 4-4
- Title: Orchestrator Modularization (P2)
- Status: Done
- Completed On: 2026-03-03

## 1) Goals and Scope

- Goal:
  - Reduce complexity concentration in `apps/api/src/orchestrator/service.ts` and make orchestrator changes safer.
- In Scope:
  - Split campaign/content step handlers into dedicated modules.
  - Move projection/chat action-card logic out of orchestrator service.
  - Move asynchronous side-effects (content embed/edit-pattern/memory invalidation) out of orchestrator service.
  - Keep idempotency/version/session-transition behavior unchanged.
- Out of Scope:
  - Workflow state-machine contract redesign.
  - API route contract changes.
  - CI pipeline changes.

## 2) Requested Refinements Applied

1. `service.ts` coordinator-only direction applied:
   - `resumeSession`, lock/queue management, state loading, and event routing remain in `service.ts`.
   - Step implementations moved to dedicated `steps/*` modules.
2. Projection module naming conflict avoided:
   - Used `orchestrator/chat-projection.ts` (not `orchestrator/projection.ts`) to avoid confusion with `workflow/projection`.
3. Acceptance criteria hardened by invariants:
   - Verified unchanged behavior for idempotency replay.
   - Verified unchanged `expected_version` conflict handling.
   - Verified unchanged trigger/session status transitions through smoke.

## 3) Implemented Deliverables

- Added orchestrator projection module:
  - `apps/api/src/orchestrator/chat-projection.ts`
  - moved:
    - chat message insert/upsert (`projection_key` idempotent path)
    - action-card metadata status patch update
    - campaign/content action-card projection emission

- Added orchestrator side-effects module:
  - `apps/api/src/orchestrator/side-effects.ts`
  - moved:
    - `onContentPublished`
    - `onContentEdited`
    - `invalidateMemoryCache`

- Added orchestrator step modules:
  - `apps/api/src/orchestrator/steps/campaign.ts`
    - `applyUserMessageStep`
    - `applyCampaignApprovedStep`
    - `applyCampaignRevisionStep`
    - `applyCampaignRejectStep`
  - `apps/api/src/orchestrator/steps/content.ts`
    - `applyContentApprovedStep`
    - `applyContentRevisionStep`
    - `applyContentRejectStep`

- Refactored service into coordinator:
  - `apps/api/src/orchestrator/service.ts`
  - step/projection/side-effect internals removed from in-file implementation and wired through dependency-based step calls.
  - file size reduced from ~1756 lines to ~838 lines while preserving public behavior.

## 4) Validation Executed

- `pnpm type-check` -> PASS
- `pnpm smoke:2-5a` -> PASS
- `pnpm smoke:1-5a` -> PASS

## 5) Acceptance Check

1. `service.ts` acts as coordinator instead of all-in-one implementation -> Met.
2. Public behavior/API contracts remain unchanged -> Met.
3. Idempotency/expected-version/status-transition invariants remain unchanged -> Met (smoke + type-check green).

## 6) Final Result

- Phase 4-4 orchestrator modularization is complete.
- Orchestrator maintenance complexity is significantly reduced with behavior-preserving module boundaries.
