# Phase 2-3 Development Request (v1.1)
## Marketing AI Agent Platform - Orchestrator RAG Integration

- Version: v1.1
- Phase: 2-3
- Depends on: Phase 2-2 (brand_profile ingestion + memory endpoint)
- Updated: 2026-03-02

---

## 0) What Changed in v1.1

This version fixes implementation-risk gaps from v1.0 and is the single source of truth for coding.

1. Internal memory access changed from self-HTTP to direct function call.
2. All code examples now match current repo APIs/signatures.
3. Forbidden-check retry result persistence fixed (`passed` reflects final check, not retry attempt existence).
4. Token budget model clarified and enforced with both per-source sub-budgets and total context budget.
5. Runtime base URL ambiguity removed for internal memory read path (no API_BASE needed internally).
6. Metadata/type mismatch removed (no undeclared `ragMeta.forbidden_violations` mutation).

---

## 1) Goal

Wire RAG context into orchestrator generation so campaign/content outputs are brand-aware and resilient:

- `campaign_plan`: Tier 1 only (`memory.md`)
- `content_generate`: Tier 1 + Tier 2 retrieval
- post-generation forbidden string check before approval queue
- graceful fallback (`full` -> `tier1_only` -> `no_context`)

---

## 2) Key Design Decisions

1. Single query embedding call per content generation for all Tier 2 searches.
2. Parallel Tier 2 retrieval via `Promise.all`.
3. Only non-empty Tier 2 sections are injected.
4. Per-source sub-budgets + total context budget both enforced.
5. Detect step remains unchanged (no RAG) to avoid trigger latency.
6. Internal API module calls `getMemoryMdForOrg(orgId)` directly (no self-fetch).
7. If RAG fails, orchestrator still returns usable outputs.
8. Forbidden check retries up to configured limit, then forwards with warning metadata.

---

## 3) Files to Modify

- `apps/api/src/rag/memory-service.ts` (new): extract memory core logic.
- `apps/api/src/routes/memory.ts`: keep auth/HTTP concerns only, call memory service.
- `apps/api/src/orchestrator/rag-context.ts` (new): Tier 1 + Tier 2 context assembly.
- `apps/api/src/orchestrator/forbidden-check.ts` (new): forbidden validation.
- `apps/api/src/orchestrator/types.ts`: add context/meta types and state fields.
- `apps/api/src/orchestrator/ai.ts`: inject context into plan/content prompts.
- `apps/api/src/orchestrator/service.ts`: new signatures + forbidden retry + metadata persistence.
- `apps/api/src/lib/env.ts`: add Phase 2-3 env parsing.
- `.env.example`: add Phase 2-3 env keys.
- `packages/rag/src/token-counter.ts`: add budget truncation utility.

---

## 4) Internal Memory Access (No Self-HTTP)

### Problem (v1.0)

Calling `fetch(/orgs/:orgId/memory)` inside the same API process adds avoidable overhead and failure complexity.

### v1.1 requirement

Extract memory core logic as:

```ts
// apps/api/src/rag/memory-service.ts
export type MemoryMdResponse = {
  memory_md: string;
  token_count: number;
  generated_at: string;
  freshness_key: string;
  cache_hit: boolean;
};

export async function getMemoryMdForOrg(orgId: string): Promise<MemoryMdResponse>
```

Usage:
- route layer (`memory.ts`): auth + membership + response envelope
- internal orchestrator (`rag-context.ts`): direct call to `getMemoryMdForOrg(orgId)`

---

## 5) Types

```ts
// apps/api/src/orchestrator/types.ts
export type ContextLevel = 'full' | 'tier1_only' | 'no_context';

export type RagContextMeta = {
  context_level: ContextLevel;
  memory_md_generated_at: string | null;
  tier2_sources: Array<{
    id: string;
    source_type: string;
    source_id: string;
    similarity: number;
  }>;
  total_context_tokens: number;
  retrieval_avg_similarity: number | null;
};

export type ForbiddenCheckMeta = {
  passed: boolean;
  violations: string[];
  regenerated: boolean;
};

// SessionState extension
rag_context?: RagContextMeta;
forbidden_check?: ForbiddenCheckMeta;
```

---

## 6) RAG Context Assembler

### 6.1 Tier 1

- Call `getMemoryMdForOrg(orgId)` directly.
- If it fails: context level `no_context`.

### 6.2 Tier 2 (content generation only)

- Build one query embedding from `channel + topic + activityFolder`.
- Run `ragRetriever.searchSimilar` in parallel:
  - `brand_profile`
  - `content`
  - `local_doc`
  - `chat_pattern`
- If Tier 2 retrieval fails: context level `tier1_only`.

### 6.3 Budget policy (must enforce both)

- `RAG_TIER2_TOTAL_BUDGET`
- source sub-budgets:
  - `RAG_TIER2_BRAND_PROFILE_BUDGET`
  - `RAG_TIER2_CONTENT_BUDGET`
  - `RAG_TIER2_LOCAL_DOC_BUDGET`
  - `RAG_TIER2_CHAT_PATTERN_BUDGET`
- total context cap:
  - `RAG_CONTEXT_TOTAL_BUDGET`

Enforcement order:
1. truncate each source block to sub-budget
2. join non-empty blocks
3. enforce final Tier2 budget
4. enforce `(Tier1 + Tier2) <= RAG_CONTEXT_TOTAL_BUDGET`

### 6.4 Return contracts

```ts
buildCampaignPlanContext(orgId)
=> { contextLevel, memoryMd, meta }

buildContentGenerationContext(orgId, channel, topic, activityFolder)
=> { contextLevel, memoryMd, tier2Sections, meta }
```

---

## 7) AI Function Changes

```ts
generateCampaignPlan(orgId, activityFolder, userMessage)
=> { plan, ragMeta }

generateContentDraft(orgId, activityFolder, channel, topic)
=> { draft, ragMeta }
```

- `generateDetectMessage` unchanged.
- Prompt assembly is dynamic: inject only available sections.
- If LLM output parse fails, fallback output is returned with same `ragMeta`.

---

## 8) Forbidden Word Post-Check

```ts
checkForbiddenWords(orgId, content)
=> { passed, violations }
```

Service behavior:
1. generate content
2. run check
3. if failed, retry up to `RAG_FORBIDDEN_MAX_RETRIES`
4. persist final result in metadata

Important:
- `passed` must represent final post-retry check result.
- if still violating after retries, keep draft for human approval with warning flag.

---

## 9) Service Layer Requirements

- `applyUserMessageStep`: pass `org_id` into `generateCampaignPlan`, store `state.rag_context`.
- `applyCampaignApprovedStep`:
  - pass `org_id` into `generateContentDraft`
  - run forbidden-check retry loop
  - store both `rag_context` and `forbidden_check` in:
    - `contents.metadata`
    - `orchestrator_sessions.state`

Metadata shape:

```ts
metadata: {
  phase: '2-3',
  source: 'orchestrator',
  rag_context: RagContextMeta,
  forbidden_check: ForbiddenCheckMeta,
}
```

---

## 10) Environment Variables

Add to `.env.example`:

```bash
# Phase 2-3 RAG Context
RAG_CONTEXT_TOTAL_BUDGET=6000
RAG_TIER2_TOTAL_BUDGET=4000
RAG_TIER2_BRAND_PROFILE_BUDGET=800
RAG_TIER2_CONTENT_BUDGET=1500
RAG_TIER2_LOCAL_DOC_BUDGET=1200
RAG_TIER2_CHAT_PATTERN_BUDGET=500
RAG_FORBIDDEN_CHECK_ENABLED=true
RAG_FORBIDDEN_MAX_RETRIES=1
```

Compatibility note:
- Existing `RAG_TIER2_TOKEN_BUDGET` may remain as fallback for legacy envs.

---

## 11) Acceptance Criteria

### Core Integration
- [ ] campaign plan uses Tier 1 context when available
- [ ] content draft uses Tier 1 + Tier 2 when available
- [ ] one embedding call per content generation
- [ ] four source retrieval calls run in parallel
- [ ] empty source sections are omitted

### Budget & Types
- [ ] per-source sub-budgets enforced
- [ ] total context budget enforced
- [ ] token counting/truncation uses tiktoken-based utility
- [ ] all code compiles with current repo APIs/types

### Resilience
- [ ] Tier1 failure => `no_context` fallback
- [ ] Tier2 failure => `tier1_only` fallback
- [ ] orchestrator does not crash from RAG failure

### Forbidden Check
- [ ] violations detected by string match
- [ ] retries follow `RAG_FORBIDDEN_MAX_RETRIES`
- [ ] final `passed` reflects final check result
- [ ] violations and regenerated flag are persisted

### Compatibility
- [ ] detect step unchanged
- [ ] `pnpm --filter @repo/api type-check` passes
- [ ] `pnpm type-check` passes

---

## 12) Out of Scope

- new DB migration for this phase
- Tier2 ingestion loops for `content/local_doc/chat_pattern`
- Layer 3 insight generation
- approval UI changes
- multi-draft generation per session

---

## 13) Implementation Order

1. Extract memory service and refactor memory route.
2. Add rag-context + forbidden-check modules.
3. Update orchestrator ai/types/service.
4. Add env parsing + `.env.example` entries + token truncation utility.
5. Run type-check and fix residuals.
