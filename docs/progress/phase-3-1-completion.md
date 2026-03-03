# Phase 3-1 Completion Report

- Phase: 3-1
- Title: Workflow Item State Machine (Source of Truth) Foundation
- Status: Done
- Completed On: 2026-03-03

## 1) Goals and Scope

- Goal:
  - Introduce `workflow_items` as the canonical approval state machine.
  - Keep Chat and Approval Queue behavior compatible while removing dual ownership risk.
  - Preserve existing approval API contracts and Phase 2-5a feedback loop side effects.
- In Scope:
  - DB migration for `workflow_items` and `workflow_events`.
  - API workflow domain module (types/repository/service).
  - Orchestrator adapter integration for approve/reject actions.
  - Shared type updates for workflow references in session state.
- Out of Scope:
  - Chat action-card rendering and UI redesign (planned in next phases).
  - Dashboard approval queue UX changes.

## 2) Implemented Deliverables

- DB migration:
  - `supabase/migrations/20260303120000_phase_3_1_workflow_state_machine.sql`
    - `workflow_items`, `workflow_events`
    - indexes, version field, event idempotency unique key
    - updated_at trigger and RLS policies
- API workflow module:
  - `apps/api/src/workflow/types.ts`
  - `apps/api/src/workflow/errors.ts`
  - `apps/api/src/workflow/repository.ts`
  - `apps/api/src/workflow/service.ts`
- Orchestrator integration:
  - `apps/api/src/orchestrator/service.ts`
    - approval/rejection paths now call workflow actions
    - `contents.status`/`campaigns.status` mirrored from workflow status for compatibility
    - existing RAG side effects preserved for `content_approved`
  - `apps/api/src/orchestrator/types.ts`
    - added `campaign_workflow_item_id`, `content_workflow_item_id` to session state
- Shared types:
  - `packages/types/src/index.ts`
    - workflow item/event/action/status types
    - orchestrator state workflow reference fields
- Schema readiness updates:
  - `apps/api/src/index.ts`
  - `apps/api/src/lib/errors.ts`

## 3) Key Decisions Applied

- Source of Truth:
  - Workflow state is canonical; legacy content/campaign status is mirror-only.
- Idempotency:
  - Workflow transitions are recorded in `workflow_events` with unique `(org_id, idempotency_key)`.
- Concurrency:
  - Transition writes enforce optimistic lock via workflow `version`.
- Compatibility:
  - Existing `/sessions/:id/resume` event contracts remain unchanged.
  - `content_approved` still triggers:
    - publish mirror update
    - `onContentPublished`
    - `onContentEdited` (when edited)
    - `invalidateMemoryCache`

## 4) Validation Executed

- `pnpm --filter @repo/api type-check` -> PASS
- `pnpm --filter @repo/api build` -> PASS
- `pnpm --filter @repo/desktop type-check` -> PASS
- Approval flow smoke:
  - `pnpm smoke:1-5a` -> PASS
  - `pnpm smoke:2-5a` -> PASS
    - `content_approved_with_edited_body_flow` check: PASS
- Post-smoke DB verification:
  - recent `workflow_items` and `workflow_events` rows confirmed for campaign/content approval transitions

## 5) Final Result

- Phase 3-1 backend foundation is complete.
- Approval domain is now state-machine based and auditable.
- Existing user-facing approval flow remains operational without frontend contract changes.
- System is ready for Phase 3-2 projection work (workflow -> chat action-card model).
