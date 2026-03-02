# Phase 2-2 Completion Report

- Phase: 2-2
- Title: Brand Profile Ingestion + Self-Evolving Memory
- Status: Done
- Completed On: 2026-03-02

## 1) Goals and Scope

- Goal:
  - Ingest onboarding brand profile artifacts into org-scoped RAG embeddings asynchronously.
  - Introduce `memory.md` generation/cache endpoint with freshness-key based invalidation.
  - Keep onboarding response non-blocking while ingestion runs in background with retries.
- In Scope:
  - `org_brand_settings` schema extension for memory cache and ingestion status tracking.
  - Brand review markdown + interview-derived chunk ingestion pipeline (`brand_profile` source).
  - `GET /orgs/:orgId/memory` API with JWT/internal-token auth and cache behavior.
  - Token-accurate memory builder (`tiktoken`) and priority truncation behavior.
  - Phase 2-2 smoke test automation and JSON report artifacts.
- Out of Scope:
  - Orchestrator prompt-time RAG injection (Phase 2-3).
  - local_doc / chat_pattern ingestion loops (Phase 2-4/2-5).
  - Layer-3 insight generation pipeline (Phase 2-5; only rendering slot was implemented).

## 2) Completed Deliverables

- Database migration:
  - `supabase/migrations/20260302183000_phase_2_2_brand_profile_ingestion.sql`
- API routes and wiring:
  - `apps/api/src/routes/memory.ts`
  - `apps/api/src/routes/onboarding.ts` (enqueue async ingestion after synthesize, pinned review-file support)
  - `apps/api/src/index.ts` (worker start + memory route mount)
  - `apps/api/src/lib/auth.ts` (`hasValidApiSecret`)
  - `apps/api/src/lib/env.ts` (`ONBOARDING_PINNED_REVIEW_PATH`)
- Ingestion/data modules:
  - `apps/api/src/rag/ingest-brand-profile.ts`
  - `apps/api/src/rag/data.ts`
- RAG package enhancements:
  - `packages/rag/src/store.ts` (`replaceBySource`, `deleteBySourceType`)
  - `packages/rag/src/chunker.ts` (heading chunk + channel tagging)
  - `packages/rag/src/memory-builder.ts` (freshness key + truncation + 3-layer structure)
  - `packages/rag/src/token-counter.ts` (`cl100k_base` via `tiktoken`)
  - `packages/rag/src/types.ts`, `packages/rag/src/index.ts`, `packages/rag/package.json`
- Shared type updates:
  - `packages/types/src/index.ts` (`OrgBrandSettings`/`MemoryMd`/`AccumulatedInsights`/`RagIngestionStatus`)
- Scripts and command entries:
  - `scripts/smoke-phase-2-2.mjs`
  - `scripts/reingest-brand-review-from-file.ts`
  - `package.json` scripts: `smoke:2-2`, `rag:reingest:review`
- Brand review source file (pinned baseline):
  - `docs/브랜드리뷰_2026-03-01-05.md`

## 3) Key Implementation Decisions

- Async ingestion is fire-and-forget:
  - `POST /onboarding/synthesize` returns immediately, then enqueues ingestion.
- Replace strategy for re-index:
  - `replaceBySource` uses delete-then-insert to avoid stale chunks after chunk-count shrink.
- Interview dedupe against review markdown:
  - Interview chunks are skipped when equivalent content is already covered in review markdown.
- Memory serving model:
  - Method B (request-time generation + persisted cache + freshness-key compare).
- Token accounting:
  - `tiktoken` (`cl100k_base`) with conservative fallback on encoder errors.
- Operational resilience:
  - retry/backoff, failed-status recording, stale-processing recovery loop.
- Pinned review baseline:
  - onboarding can use `docs/브랜드리뷰_2026-03-01-05.md` as canonical review source.

## 4) Validation and Test Results

- 2026-03-02 `pnpm --filter @repo/api type-check` -> PASS
- 2026-03-02 `pnpm type-check` -> PASS
- 2026-03-02 `pnpm smoke:2-2` -> PASS
  - report: `docs/reports/phase-2-2-test-result.json`
  - key checks:
    - synthesize 200 response and non-blocking behavior
    - ingestion status transition `pending -> processing -> done`
    - `brand_profile` embeddings inserted (`review` + deduped `interview`)
    - memory first-call miss / second-call hit
    - freshness invalidation on source update
    - outsider access blocked (403), internal token path valid
- 2026-03-02 `pnpm rag:reingest:review` -> PASS
  - org: `a1b2c3d4-0000-0000-0000-000000000001`
  - report: `docs/reports/phase-2-2-reingest-result.json`
  - result: `final_status = done`, `brand_profile/review = 29` chunks

## 5) Risks and Follow-up

- Current pinned-review behavior intentionally prioritizes fixed review markdown for onboarding consistency.
  - If dynamic generation is needed per org/run, disable pinning via env/config policy.
- Anthropic credit outages do not block Phase 2-2 due to fallback flow, but synthesis quality can vary.
- Suggested follow-up:
  - Add admin/status endpoint for ingestion monitoring at org level.
  - Add integration tests for `onBrandReReview` entry path in API surface.

## 6) Handoff

- Ready conditions:
  - Phase 2-2 schema, ingestion worker, memory endpoint, and smoke/reingest tooling are in place.
  - Seed org reindexed with the designated baseline brand review file.
  - Phase progress docs updated to mark 2-2 complete.
