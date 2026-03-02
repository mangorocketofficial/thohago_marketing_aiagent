# Phase 2-3 Completion Report

- Phase: 2-3
- Title: Orchestrator RAG Integration
- Status: Done
- Completed On: 2026-03-02

## 1) Goals and Scope

- Goal:
  - Inject org-specific RAG context into orchestrator prompt pipeline.
  - Apply Tier-1 (memory.md) for campaign planning and Tier-1+Tier-2 for content generation.
  - Add forbidden-word post-check with bounded retry and metadata attribution.
- In Scope:
  - Internal memory service extraction (`getMemoryMdForOrg`) and route reuse.
  - Orchestrator RAG context assembler with fallback levels and token budgets.
  - AI function signature updates to include `orgId` and return `ragMeta`.
  - Service-layer forbidden check, retry flow, and metadata persistence.
  - Phase 2-3 env configuration and token truncation utility.
- Out of Scope:
  - New DB migration.
  - Tier-2 ingestion loops for `content/local_doc/chat_pattern`.
  - Layer-3 insight generation and approval UI warning rendering.

## 2) Completed Deliverables

- Dev request updated to implementation-safe v1.1:
  - `docs/phase-2-3-orchestrator-rag-integration-dev-request.md`
- Memory internal call refactor:
  - `apps/api/src/rag/memory-service.ts` (new)
  - `apps/api/src/routes/memory.ts`
- Orchestrator modules:
  - `apps/api/src/orchestrator/rag-context.ts` (new)
  - `apps/api/src/orchestrator/forbidden-check.ts` (new)
  - `apps/api/src/orchestrator/ai.ts`
  - `apps/api/src/orchestrator/service.ts`
  - `apps/api/src/orchestrator/types.ts`
- Config/runtime:
  - `apps/api/src/lib/env.ts`
  - `.env.example`
- RAG utility:
  - `packages/rag/src/token-counter.ts` (`truncateToTokenBudget`)

## 3) Key Implementation Decisions

- No self-HTTP for memory:
  - Orchestrator now calls `getMemoryMdForOrg(orgId)` directly in-process.
  - Memory route remains external API surface and reuses same service function.
- Context injection depth:
  - `generateCampaignPlan`: Tier-1 only.
  - `generateContentDraft`: Tier-1 + Tier-2 with graceful downgrade.
- Tier-2 retrieval strategy:
  - One query embedding per generation request.
  - Parallel `searchSimilar` for `brand_profile`, `content`, `local_doc`, `chat_pattern`.
- Budget enforcement:
  - Per-source sub-budget truncation.
  - Tier-2 total-budget truncation.
  - Final `(Tier1 + Tier2)` cap enforcement.
- Forbidden validation:
  - String-match post-check.
  - Retry count controlled by env (`RAG_FORBIDDEN_MAX_RETRIES`).
  - Final `passed` reflects final post-retry check result.
- Metadata attribution:
  - Persisted in both `contents.metadata` and `orchestrator_sessions.state` as `rag_context` / `forbidden_check`.

## 4) Validation and Test Results

- 2026-03-02 `pnpm --filter @repo/rag build` -> PASS
- 2026-03-02 `pnpm --filter @repo/api type-check` -> PASS
- 2026-03-02 `pnpm type-check` -> PASS
- 2026-03-02 `pnpm build` -> PASS
- 2026-03-02 `pnpm smoke:1-5a` -> PASS
- 2026-03-02 `pnpm smoke:2-2` -> PASS
  - report updated: `docs/reports/phase-2-2-test-result.json`
  - timestamped report: `docs/reports/phase-2-2-test-result-2026-03-02T09-14-52-248Z.json`

## 5) Risks and Follow-up

- A dedicated `smoke:2-3` scenario script is not yet added.
  - Existing smoke coverage confirms backward compatibility and Phase 2-2 stability after integration.
- Tier-2 source quality for `content/local_doc/chat_pattern` depends on future ingestion phases.
  - Current fallback behavior prevents orchestration failure when Tier-2 retrieval is sparse/unavailable.

## 6) Handoff

- Ready conditions:
  - Phase 2-3 RAG context integration is wired into orchestrator flow.
  - Self-HTTP memory access risk is removed via internal service extraction.
  - Forbidden-word safety checks and attribution metadata are persisted.
  - Build/type-check/smoke validations are passing.
