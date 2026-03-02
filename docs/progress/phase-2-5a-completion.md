# Phase 2-5a Completion Report

- Phase: 2-5a
- Title: Content Feedback Loop (Core)
- Status: Done
- Completed On: 2026-03-02

## 1) Goals and Scope

- Goal:
  - Close the generation feedback loop by embedding published/historical content and user edit patterns into RAG.
  - Keep memory freshness aligned with publish/edit events.
- In Scope:
  - `contents.embedded_at` tracking + pending-content backfill route.
  - Publish-time `content` embedding and edited-approval `chat_pattern` embedding.
  - Basic accumulated insights computation from content/edit signals.
  - Desktop approval payload extension for edited draft body.
  - Manual backfill script and Phase 2-5a smoke coverage.
- Out of Scope:
  - AI-generated deep insights (planned for 2-5b).
  - Performance-score backfill / reranking boost.
  - Weekly scheduled batch jobs.

## 2) Completed Deliverables

- DB migration:
  - `supabase/migrations/20260302223000_phase_2_5a_content_feedback.sql`
    - `contents.embedded_at` column
    - pending/recent indexes
    - trigger to reset `embedded_at` on meaningful content changes
- API RAG modules:
  - `apps/api/src/rag/ingest-content.ts`
  - `apps/api/src/rag/ingest-edit-pattern.ts`
  - `apps/api/src/rag/compute-insights.ts`
  - `apps/api/src/rag/memory-service.ts` (`invalidateMemoryCache` export)
- API integration:
  - `apps/api/src/orchestrator/service.ts`
    - `content_approved` now supports `edited_body`
    - publish -> content embed
    - edit -> chat pattern embed
    - memory cache invalidation
  - `apps/api/src/routes/rag.ts`
    - `POST /rag/embed-pending-content`
  - `apps/api/src/routes/onboarding.ts`
    - historical content re-persist + stale embedding cleanup
    - internal backfill execution (no self-HTTP + sleep dependency)
- Desktop integration:
  - `apps/desktop/electron/main.mjs`
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/global.d.ts`
  - `apps/desktop/src/styles.css`
  - Approval queue now allows draft editing before approve; edited body is forwarded.
- Scripts and commands:
  - `scripts/embed-pending-content.mjs`
  - `scripts/smoke-phase-2-5a.mjs`
  - `package.json`
    - `smoke:2-5a`
    - `rag:embed:content`

## 3) Key Implementation Decisions

- DB-level `embedded_at` reset:
  - Enforced by trigger (`body/channel/content_type/metadata/published_at/status`) to avoid app-only drift.
- Backfill route compatibility:
  - Reused existing secret auth and subscription gates.
  - Added `batch_limit` with bounded processing and `remaining` reporting.
- Stale historical embedding mitigation:
  - During re-onboarding historical replace, previous historical content embeddings are explicitly cleaned.
- Edit signal persistence model:
  - `chat_pattern` uses append (`insertBatch` semantics) to keep each user correction as an independent learning point.
- Insights query efficiency:
  - Edit-pattern stats use direct table reads (`org_rag_embeddings`) instead of dummy-vector RPC.

## 4) Validation and Test Results

- 2026-03-02 `pnpm --filter @repo/api type-check` -> PASS
- 2026-03-02 `pnpm --filter @repo/desktop type-check` -> PASS
- 2026-03-02 `pnpm type-check` -> PASS
- 2026-03-02 `pnpm build` -> PASS
- 2026-03-02 `pnpm smoke:2-5a` -> PASS
  - report: `docs/reports/phase-2-5a-test-result.json`
- Regression checks:
  - 2026-03-02 `pnpm smoke:1-5a` -> PASS
  - 2026-03-02 `pnpm smoke:2-2` -> PASS
  - 2026-03-02 `pnpm smoke:2-4` -> PASS

## 5) Handoff

- Ready conditions:
  - Published/historical content is now embedded as `content` source with `channel` metadata.
  - Edited approvals are captured as `chat_pattern` embeddings and included in future retrieval.
  - Historical backfill is runnable via route/script and no longer depends on delayed self-HTTP.
  - Memory cache can be invalidated on publish/edit events for fresher `memory.md` generation.
