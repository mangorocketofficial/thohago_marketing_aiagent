# Codebase Update Plan (English, Initial Draft)

- Version: v0.1
- Date: 2026-03-03
- Inputs:
  - `docs/code-review-verified-needs-update.md`
  - Existing review documents and current codebase state

## 1. Objective

Stabilize the codebase for next-phase development by fixing high-risk correctness/security issues first, then reducing architectural debt and duplication without breaking existing onboarding/chat/workflow/RAG behavior.

## 2. Assumptions

1. Pinned onboarding brand review behavior is intentionally kept for now.
2. Existing end-to-end smoke flows must stay green during all cleanup work.
3. Changes should be incremental and mergeable in small PR units.

## 3. Workstreams and Phases

## Phase 0 - Baseline and Safety Gates

Goals:
- Lock current behavior and detect regressions quickly.

Tasks:
1. Record current pass status for:
   - `pnpm type-check`
   - `pnpm smoke:1-5a`
2. Add a lightweight pre-merge checklist document for required verification commands.

Acceptance:
1. Baseline results are documented.
2. Every following phase includes the same verification commands.

## Phase 4.1 - Correctness and Security (P0)

Goals:
- Remove immediate operational risks.

Tasks:
1. Fix orchestrator lock cleanup logic in `apps/api/src/orchestrator/service.ts`.
2. Update desktop Supabase client cache key strategy so token refresh is always reflected.
3. Stop exposing backend API token to renderer chat config.
4. Verify no renderer feature depends on that token field.
5. Refresh renderer chat runtime config when auth session/token changes to keep `supabaseAccessToken` synchronized.

Acceptance:
1. Lock queue does not grow indefinitely under repeated events.
2. Token refresh updates are reflected without app restart.
3. `apiToken` is not delivered to renderer runtime contract.
4. `type-check` and smoke validation remain green.
5. Auth state changes (`SIGNED_IN` / `TOKEN_REFRESHED` / `SIGNED_OUT`) trigger chat config refresh without restart.

## Phase 4.2 - Duplication Cleanup (P1)

Goals:
- Reduce repeated code and simplify future modifications.

Tasks:
1. Extract shared API parsing helpers:
   - `parseRequiredString`
   - `asString` / `asRecord` style helpers
2. Extract shared org membership check helper.
3. Consolidate duplicated workflow label maps and runtime shared types in desktop.
4. Remove dead hook (`useChat`) and unused CSS (`.queue-editor`).

Acceptance:
1. Duplicated helper implementations are removed from route files.
2. Dead code files/selectors are removed cleanly.
3. No behavior changes in dashboard/chat workflows.

## Phase 4.3 - Test Harness Consolidation (P1)

Goals:
- Make smoke test maintenance cheaper.

Tasks:
1. Create `scripts/lib/smoke-harness.mjs` for common process/env/health/report utilities.
2. Refactor `smoke-phase-*` scripts to consume shared harness.
3. Keep scenario-specific assertions only in each phase script.

Acceptance:
1. Shared harness is used by all maintained smoke scripts.
2. Existing smoke scripts still pass.

## Phase 4.4 - Orchestrator Modularization (P2)

Goals:
- Reduce complexity concentration in `orchestrator/service.ts`.

Tasks:
1. Split campaign step handlers into `orchestrator/steps/campaign.ts`.
2. Split content step handlers into `orchestrator/steps/content.ts`.
3. Move projection-related logic into `orchestrator/projection.ts`.
4. Move side-effects (RAG/memory/edit pattern hooks) into `orchestrator/side-effects.ts`.

Acceptance:
1. `service.ts` becomes a coordinator, not an all-in-one implementation.
2. Public behavior and API contracts remain unchanged.

## Phase 5 - Quality Gates and Portability (P2)

Goals:
- Improve long-term reliability and team velocity.

Tasks:
1. Replace echo-only lint placeholders with real lint rules.
2. Add initial unit tests for:
   - workflow transition matrix
   - idempotency replay behavior
3. Make `rag:reingest:review` script cross-platform.
4. Resolve preload contract drift risk (`preload.cjs` vs `preload.mjs`) by unifying source-of-truth.

Acceptance:
1. Lint runs real checks.
2. Unit tests run in CI/local with stable pass criteria.
3. Script works on Windows and non-Windows environments.
4. Only one authoritative preload contract path remains.

## 4. Suggested Delivery Strategy

1. Ship one phase per PR series.
2. Keep PRs small and behavior-preserving.
3. Run smoke checks after every phase.
4. Update `docs/progress` only after each phase is verified.

## 5. Verification Commands

```bash
pnpm type-check
pnpm smoke:1-5a
```

Add phase-specific commands when needed (for example, targeted script checks after smoke harness refactor).
