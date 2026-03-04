# Step S1 Development Plan (Session Foundation)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S1
- Status: Draft for implementation

## 1) Objective

Build a safe multi-session foundation before UI/session-selector work by:

1. Extending DB schema for workspace-aware sessions and session-scoped chat messages.
2. Adding session list/create/recommended APIs with explicit contracts.
3. Preserving runtime safety and current trigger behavior during the transition.

## 2) S1 Scope (Narrowed and Safe)

In S1, we will do only foundation work:

1. Schema changes (`orchestrator_sessions`, `chat_messages`) with backward compatibility.
2. New API contracts for session listing/creation/recommendation.
3. Service logic updates needed for DB safety (workspace-aware uniqueness checks).

Not in S1:

1. Lock model migration from `org:<orgId>` to `session:<sessionId>`.
2. Queue model migration to session-level workers.
3. Full frontend migration to session-scoped timeline UI.
4. Replacement of current Supabase message read path with a new API endpoint.

## 3) Key Risks and Decisions

### 3.1 Risk: dropping `uq_orchestrator_sessions_org_active` is unsafe

Current code depends on DB uniqueness and `23505` recovery semantics during concurrent trigger intake.

Decision:

1. Do not remove DB-level active-session protection without replacement.
2. Replace org-global active unique with workspace-scoped active unique:
   - `UNIQUE (org_id, workspace_key) WHERE status IN ('running', 'paused')`
3. Keep application fallback behavior:
   - if insert fails with `23505`, query and return existing active session for that workspace.

This preserves concurrency safety in multi-instance deployments where in-memory locks are insufficient.

### 3.2 Risk: `chat_messages.session_id` backfill ambiguity

Decision:

1. Introduce `chat_messages.session_id` as `NULL` first.
2. Backfill deterministic rows first (action cards with `metadata.session_id`).
3. For ambiguous legacy text rows, avoid time-guess mapping:
   - map to per-org legacy session, or keep `NULL` until explicit migration decision.
4. Enforce stricter constraints only after dual-write + backfill validation gates pass.

### 3.3 Risk: lock migration timing

Decision:

1. Keep lock key as `org:<orgId>` throughout S1.
2. Keep current enqueue/resume queue behavior unchanged in S1.
3. Move lock/queue migration to S3 when session-scoped reads/writes are already stable.

### 3.4 API and message-fetch choice for S1

Decision:

1. Keep desktop message reads on direct Supabase query pattern in S1.
2. Add `session_id` filter in that query during session-scoped rollout.
3. Do not force `GET /sessions/:sessionId/messages` adoption in S1.

## 4) Zero-Downtime Rollout Order for `chat_messages.session_id`

### Phase A: additive schema migration (safe)

1. Add column:
   - `chat_messages.session_id uuid null references orchestrator_sessions(id) on delete set null`
2. Add indexes:
   - `(org_id, session_id, created_at desc)` for session timeline reads
   - keep existing `(org_id, created_at desc)` until cutover is complete

### Phase B: dual-write deployment

1. Update server write paths so all new orchestrator-created messages include `session_id`.
2. Keep compatibility for old rows with `NULL session_id`.

### Phase C: deterministic backfill

1. Backfill action-card rows from `metadata.session_id`.
2. Backfill clearly attributable rows from workflow/session linkage where deterministic.
3. Route unresolved legacy text rows to legacy session (preferred) or keep `NULL`.

### Phase D: validation gates

1. Validate no new writes produce `NULL session_id`.
2. Validate read path correctness in canary orgs.
3. Validate realtime subscription behavior with `session_id` filters.

### Phase E: strictness hardening (post-gate)

1. Make `session_id` `NOT NULL` only after unresolved legacy strategy is complete.
2. If legacy `NULL` rows remain by design, keep nullable and enforce non-null for new rows at app level.

## 5) `orchestrator_sessions` Schema Plan

Add fields:

1. `workspace_type text not null default 'general'`
2. `scope_id text null`
3. `workspace_key text not null` (stored value)
4. `title text null`
5. `created_by_user_id uuid null`
6. `archived_at timestamptz null`

Index and constraint changes:

1. Add lookup indexes:
   - `(org_id, updated_at desc)`
   - `(org_id, workspace_type, scope_id, updated_at desc)`
   - `(org_id, status, updated_at desc)`
2. Replace unique index:
   - drop `uq_orchestrator_sessions_org_active`
   - add `uq_orchestrator_sessions_org_workspace_active` on `(org_id, workspace_key)` for active statuses

Compatibility rule:

1. Existing sessions are backfilled to `workspace_type='general'`, `scope_id='default'`, `workspace_key='general:default'`.

## 6) API Contract (S1, concrete)

### 6.1 `GET /orgs/:orgId/sessions`

Purpose:

1. List sessions with stable pagination and filtering.

Query parameters:

1. `limit` (default `20`, max `50`)
2. `cursor` (opaque; contains `(updated_at,id)` checkpoint)
3. `workspace_type` (optional)
4. `scope_id` (optional)
5. `status` (optional, multi-value)
6. `archived` (`false` by default)

Behavior:

1. Sort by `updated_at desc, id desc`.
2. Return `next_cursor` when more rows exist.

### 6.2 `POST /orgs/:orgId/sessions`

Purpose:

1. Create a new session for explicit user action.

Body:

1. `workspace_type` (required)
2. `scope_id` (optional)
3. `title` (optional)
4. `start_paused` (optional, default `true` for user-created sessions in S1)

Rules:

1. `workspace_key` is computed server-side.
2. `created_by_user_id` is injected server-side from authenticated user context.
3. If active session already exists for same `(org_id, workspace_key)` and policy is "resume", return existing session.

### 6.3 `GET /orgs/:orgId/sessions/recommended`

Purpose:

1. Recommend an existing session for a workspace.

Query parameters:

1. `workspace_type` (required)
2. `scope_id` (optional)

Selection rules:

1. Match by exact `workspace_key`.
2. Exclude archived sessions.
3. Prefer active statuses (`running`, `paused`), otherwise most recently updated.
4. Tie-breaker: newest `updated_at`, then `id`.

### 6.4 Existing endpoint posture

1. Keep `GET /orgs/:orgId/sessions/active` for compatibility in S1.
2. Mark as deprecated in docs and prepare frontend migration path.

## 7) Service Behavior Changes in S1

1. Trigger flow remains workspace-default:
   - trigger-created sessions use `workspace_key='general:default'` until S5 folder routing.
2. `enqueueTrigger` conflict handling remains idempotent via DB uniqueness (`23505`) + read-existing path.
3. No lock key migration in S1; retain `org:<orgId>`.

## 8) Implementation Work Breakdown

1. Migration M1 (additive):
   - session workspace columns, chat `session_id`, indexes
2. API A1:
   - list/create/recommended endpoints with validation and pagination
3. Service S1:
   - workspace-aware session create/get helpers
   - updated conflict fallback logic for workspace scope
4. Data B1:
   - deterministic backfill script for `chat_messages.session_id`
5. Desktop D1 (minimal):
   - keep Supabase reads; add optional `session_id` filter path behind feature flag if needed
6. Validation V1:
   - type-check, smoke tests, concurrency test for duplicate session prevention

## 9) Acceptance Criteria for Step S1

1. No downtime during schema and service rollout.
2. Concurrent creates cannot produce duplicate active sessions for the same workspace.
3. New chat messages written by orchestrator include `session_id`.
4. Backfill is deterministic and auditable; ambiguous legacy rows are explicitly handled.
5. Session list/create/recommended APIs return stable, documented behavior.
6. Current trigger and resume flows keep existing correctness/idempotency behavior.
7. Lock model remains org-scoped in S1 with no regression.

## 10) Rollback Plan

1. Keep additive columns/indexes backward compatible until final hardening.
2. If needed, route traffic back to old read/write behavior without dropping new columns.
3. Re-enable old endpoint usage (`/sessions/active`) as primary fallback.
4. Delay strict constraints (`NOT NULL`) until post-validation readiness is proven.

## 11) Explicit Mapping to the Four Additional Proposals

1. `uq_orchestrator_sessions_org_active` risk:
   - addressed with workspace-scoped active unique + `23505` recovery path.
2. `chat_messages.session_id` backfill:
   - addressed with nullable-first, deterministic backfill, legacy-safe handling.
3. Lock transition timing (`org` -> `session`):
   - explicitly deferred to S3, not included in S1.
4. Message fetch path choice:
   - keep Supabase direct query pattern in S1, add session filter incrementally.
