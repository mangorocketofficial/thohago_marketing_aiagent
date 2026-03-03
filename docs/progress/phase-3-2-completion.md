# Phase 3-2 Completion Report

- Phase: 3-2
- Title: Orchestrator Workflow Creation + Chat Action-Card Projection
- Status: Done
- Completed On: 2026-03-03

## 1) Goals and Scope

- Goal:
  - Emit workflow-linked approval proposals as chat-native action-card projections.
  - Keep `workflow_items` as canonical state and chat as projection-only surface.
  - Preserve existing resume API contracts and legacy text chat compatibility.
- In Scope:
  - `chat_messages` projection schema extension and constraints.
  - Deterministic projection key generation and idempotent write path.
  - Orchestrator proposal/approval/rejection projection integration.
  - Shared chat type updates and smoke validation extensions.
- Out of Scope:
  - Frontend inline action-card UI rendering (Phase 3-3).
  - Full approval queue UI replacement (Phase 3-4).

## 2) Implemented Deliverables

- DB migration:
  - `supabase/migrations/20260303143000_phase_3_2_chat_action_card_projection.sql`
    - added `message_type`, `metadata`, `workflow_item_id`, `projection_key`
    - action-card/system message integrity checks
    - unique `(org_id, projection_key)` index and workflow lookup index
- Workflow projection module:
  - `apps/api/src/workflow/projection.ts`
    - deterministic key: `wf_card:${channel}:${workflow_item_id}:${event_type}:v${expected_version}`
    - `campaign_plan` / `content_draft` card metadata builders
    - card status patch helper for approved/rejected resolution
- Orchestrator integration:
  - `apps/api/src/orchestrator/service.ts`
    - proposal points now emit `message_type='action_card'` with fallback `content`
    - projection upsert with `onConflict: org_id,projection_key` for replay safety
    - approval/rejection updates existing latest card metadata status
    - workflow-first ordering with post-projection `origin_chat_message_id` link
- Workflow link update:
  - `apps/api/src/workflow/repository.ts`
  - `apps/api/src/workflow/service.ts`
    - added `origin_chat_message_id` patch helper for projection linkage
- Shared types and schema readiness:
  - `packages/types/src/index.ts`
  - `apps/api/src/index.ts`
  - `apps/api/src/lib/errors.ts`
    - chat projection fields/types added and migration readiness reference updated

## 3) Key Decisions Applied

- Deterministic Projection Key:
  - Version-aware key supports replay dedupe and new-card emission on future re-proposal versions.
- Action Card Status Reflection:
  - Chosen policy: update existing card `metadata` on workflow transition (`approved`/`rejected`) rather than append-only replacement.
- Backward Compatibility:
  - `content` remains populated for legacy text renderers.
  - existing resume event contract unchanged (`campaign_approved`, `campaign_rejected`, `content_approved`, `content_rejected`).
- Channel Policy:
  - Dashboard projection path implemented for action-cards.
  - Non-interactive channels remain fallback-text compatible (no breaking change introduced).

## 4) Validation Executed

- `pnpm --filter @repo/api type-check` -> PASS
- `pnpm --filter @repo/desktop type-check` -> PASS
- `pnpm --filter @repo/api build` -> PASS
- `pnpm supabase:db:push` (local) -> PASS
- `pnpm smoke:1-5a` -> PASS
  - campaign/content action-card rows created
  - projection replay dedupe verified with repeated idempotency keys
  - card metadata `workflow_status` updated to `approved` on resolution
- `pnpm smoke:2-5a` -> PASS

## 5) Final Result

- Phase 3-2 backend projection foundation is complete.
- Orchestrator now emits workflow-linked, idempotent action-card chat projections.
- Resolved approval state is reflected on existing action cards via metadata updates.
- System is ready for Phase 3-3 chat inline action-card rendering/interaction work.

