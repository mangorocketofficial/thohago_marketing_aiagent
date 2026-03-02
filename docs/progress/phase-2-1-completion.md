# Phase 2-1 Completion Report

- Phase: 2-1
- Title: RAG Infrastructure
- Status: Done
- Completed On: 2026-03-02

## 1) Goals and Scope

- Goal:
  - Build the base RAG infrastructure for org-scoped retrieval.
  - Introduce provider-abstracted embedding architecture.
  - Enforce backend-only vector search RPC execution and org isolation.
- In Scope:
  - `packages/rag` shared package scaffold and core modules.
  - Supabase migration for `org_rag_embeddings` + `match_rag_embeddings` RPC.
  - API env/config integration for embedding model/dimension profiles.
  - Phase 2-1 smoke validation (migration, RPC, RLS).
- Out of Scope:
  - Onboarding-triggered brand profile ingestion (Phase 2-2).
  - Orchestrator prompt-time RAG context integration (Phase 2-3).
  - Local document indexing pipeline and feedback loop (Phase 2-4/2-5).

## 2) Completed Deliverables

- RAG package scaffold and modules:
  - `packages/rag/src/embedder.ts` (provider interface, profile resolver)
  - `packages/rag/src/embedder-openai.ts` (OpenAI embeddings implementation)
  - `packages/rag/src/embedder-voyage.ts` (placeholder adapter)
  - `packages/rag/src/chunker.ts`
  - `packages/rag/src/store.ts`
  - `packages/rag/src/retriever.ts`
  - `packages/rag/src/memory-builder.ts`
  - `packages/rag/src/index.ts`
- Shared type contracts:
  - `packages/types/src/index.ts` (RAG model/profile/chunk/search/memory types)
- API integration:
  - `apps/api/package.json` (`@repo/rag` workspace dependency)
  - `apps/api/src/lib/env.ts` (RAG provider/model/dimension env parsing)
  - `apps/api/src/lib/rag.ts` (ragStore/ragRetriever/embedder bootstrap)
- Database migration:
  - `supabase/migrations/20260302130000_phase_2_1_rag_embeddings.sql`
- Smoke test script:
  - `scripts/smoke-phase-2-1.mjs`
  - `package.json` script entry: `smoke:2-1`
- Env template updates:
  - `.env.example` (OpenAI + RAG vars)

## 3) Key Implementation Decisions

- Provider boundary separation:
  - `embedder.ts` defines vendor-agnostic contracts.
  - Provider logic is isolated in `embedder-openai.ts` / `embedder-voyage.ts`.
- Model and profile support:
  - Model options: `text-embedding-3-small`, `text-embedding-3-large`.
  - Profile dimensions: `1536` (default), `768`, `512`.
- Storage/index compatibility:
  - pgvector index constraints require fixed dimension, so storage uses `vector(1536)`.
  - `768`/`512` vectors are zero-padded to `1536` on write/query.
  - Original profile dimension remains explicit in `embedding_dim`.
- Security model:
  - `match_rag_embeddings` is `security invoker`.
  - RPC execute revoked from `public/anon/authenticated`, granted only to `service_role`.
  - Table RLS allows org members read-only access; authenticated write remains blocked by policy.
- Idempotency:
  - `source_id` is `NOT NULL`.
  - Upsert uniqueness key includes org/source/chunk + model/profile.

## 4) Runtime Env Notes

- Required RAG/OpenAI env (API):
  - `OPENAI_API_KEY`
  - `RAG_EMBEDDING_PROVIDER`
  - `RAG_EMBEDDING_MODEL`
  - `RAG_EMBEDDING_DIMENSIONS`
  - `RAG_ALLOWED_EMBEDDING_DIMENSIONS`
- Local Supabase CLI workflow used for validation:
  - `pnpm supabase:start`
  - `pnpm supabase:db:push`

## 5) Validation and Test Results

- `pnpm supabase:db:push` -> PASS
  - Applied: `20260302130000_phase_2_1_rag_embeddings.sql`
- `pnpm smoke:2-1` -> PASS
  - Service RPC returns expected rows for `1536` and `768` profiles
  - RLS read isolation validated (own org readable, other org blocked)
  - Authenticated write blocked
  - Authenticated RPC execution blocked (service-role only)
- `pnpm --filter @repo/rag type-check` -> PASS
- `pnpm --filter @repo/api type-check` -> PASS
- `pnpm --filter @repo/api build` -> PASS
- `pnpm type-check` (workspace) -> PASS

## 6) Risks and Follow-up

- Remaining risks:
  - Zero-padding profile strategy should be benchmarked with real Korean corpora for retrieval quality.
  - Migration currently drops/recreates `org_rag_embeddings`; production rollout needs a non-destructive migration path.
- Follow-up recommendations:
  - Add a dedicated profile migration/backfill script for model/dimension transitions.
  - Add retrieval quality metrics logging (top-k hit quality by source/profile).
  - Implement Phase 2-2 ingestion triggers using this infrastructure.

## 7) Handoff

- Ready conditions:
  - Core RAG schema, store, retriever, and provider abstraction are in place.
  - Backend-only RPC permission and org-scoped RLS behavior validated.
  - Phase progress docs updated for 2-1 completion.
