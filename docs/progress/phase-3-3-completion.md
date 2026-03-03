# Phase 3-3 Completion Report

- Phase: 3-3
- Title: Inline Approve / Revise / Reject Handling in Chat
- Status: Done
- Completed On: 2026-03-03

## 1) Goals and Scope

- Goal:
  - Make dashboard chat action-cards executable inline for approve/revision/reject decisions.
  - Keep `workflow_items` as canonical state and maintain chat as projection/interactions layer.
  - Add revision loops with version-safe, idempotent action handling and stale-card recovery.
- In Scope:
  - Revision-mode backend branching (`payload.mode='revision'`) with `request_revision -> resubmitted`.
  - Revision-aware campaign/content regeneration and new versioned action-card projections.
  - Renderer inline action-card UI, content edited-body inline editor, and collapsed historical versions.
  - Structured version conflict details and dispatch-level idempotency normalization.
  - Smoke coverage for revision replay and stale expected-version conflicts.
- Out of Scope:
  - Telegram inline card interactivity.
  - Full approval queue removal and bulk approval UX redesign.

## 2) Implemented Deliverables

- Dev request updates:
  - `docs/phase3/phase-3-3-inline-chat-approval-actions-dev-request.md`
    - finalized regeneration scope for `campaign_plan` and `content_draft`
    - explicit `version_conflict` response contract and recovery behavior
    - backend-first delivery order and collapsed old-version card policy
- API contracts and validation:
  - `apps/api/src/routes/sessions.ts`
    - payload validation for `mode='revision'`, required revision reason, and `expected_version`
    - error body now includes optional `details` for recoverable conflicts
  - `apps/api/src/lib/errors.ts`
    - `HttpError` extended with structured `details`
- Workflow concurrency contract:
  - `apps/api/src/workflow/service.ts`
    - `version_conflict` now returns `workflow_item_id`, `expected_version`, `current_version`, `workflow_status`
- Orchestrator revision loops:
  - `apps/api/src/orchestrator/service.ts`
    - implemented non-terminal revision flows for campaign/content rejects
    - `request_revision -> regenerate -> resubmitted` on same workflow item with incremented version
    - projection emit helpers reused for new versioned action cards
    - terminal reject path preserved for non-revision reject actions
  - `apps/api/src/orchestrator/ai.ts`
    - revision-aware prompts for campaign/content generation using previous output + revision reason
- Action-card projection metadata:
  - `apps/api/src/workflow/projection.ts`
    - actions disabled for resolved/non-proposed statuses (including `revision_requested`)
    - `content_draft` card now includes `card_data.body_full` for inline full-body editing UX
- Desktop runtime and IPC:
  - `apps/desktop/electron/main.mjs`
    - new `chat:dispatch-action` IPC handler with standardized idempotency format
    - editable input normalization and structured error propagation for stale recovery
  - `apps/desktop/electron/preload.mjs`
  - `apps/desktop/electron/preload.cjs`
  - `apps/desktop/src/global.d.ts`
    - new `dispatchAction` bridge contract and payload typing
- Desktop chat UI:
  - `apps/desktop/src/pages/AgentChat.tsx`
    - action-card timeline rendering with inline approve/revise/reject
    - revision reason input and content full-body edited textarea (collapsible)
    - default-collapsed previous versions, latest version primary expanded card
  - `apps/desktop/src/App.tsx`
    - card action dispatch integration and stale `version_conflict` refresh path
    - realtime chat subscription now handles insert/update/delete events
  - `apps/desktop/src/styles.css`
    - action-card layout/states/editor/chip styles
- Shared types:
  - `packages/types/src/index.ts`
    - `ChatActionCardDispatchInput` added
    - type guards `isWorkflowActionCardMetadata` and `isActionCardMessage`
- Dev runtime propagation fix:
  - `turbo.json`
    - added `globalEnv` propagation for `API_PORT`, `ORCHESTRATOR_API_BASE`
- Smoke validation extension:
  - `scripts/smoke-phase-1-5a.mjs`
    - campaign/content revision loop assertions
    - revision replay idempotency assertions
    - stale `expected_version` conflict assertions with detail checks
    - edited-body persistence assertion after approval

## 3) Key Decisions Applied

- Regeneration Strategy:
  - `campaign_plan`: regenerate via LLM from previous plan + revision reason + existing context.
  - `content_draft`: regenerate via LLM from previous body + revision reason + existing context.
  - both keep same `workflow_item_id`; version increments through workflow transitions.
- Revision Routing:
  - preserve existing external events; map revision via reject event + `payload.mode='revision'`.
- Conflict Recovery:
  - keep optimistic locking with `expected_version` and return structured `version_conflict` details.
- Timeline Clutter Control (3-3 MVP):
  - collapse old card versions by default; keep latest proposed card as active decision surface.
- Backward Compatibility:
  - existing approve/reject APIs remain callable; queue flows are not removed in this phase.

## 4) Validation Executed

- `pnpm --filter @repo/types build` -> PASS
- `pnpm --filter @repo/api type-check` -> PASS
- `pnpm --filter @repo/desktop type-check` -> PASS
- `pnpm --filter @repo/api build` -> PASS
- `pnpm smoke:1-5a` -> PASS
  - campaign revision: new card version emitted, old card marked `revision_requested`
  - campaign revision replay: idempotent, no duplicate projection cards
  - campaign stale approve: `409 version_conflict` + details
  - content revision: new card version emitted, old card marked `revision_requested`
  - content revision replay: idempotent, no duplicate projection cards
  - content stale approve: `409 version_conflict` + details
  - edited-body approval persisted to final published content

## 5) Final Result

- Phase 3-3 inline action-card execution is implemented end-to-end (backend, IPC, desktop renderer).
- Revision loops are operational with workflow-version correctness and replay safety.
- Stale-card conflicts are recoverable via structured `version_conflict` responses and renderer refresh handling.
- System is ready for Phase 3-4 queue simplification and multi-card/bulk approval tuning.
