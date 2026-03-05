# Phase 6-1 Completion Report

- Phase: 6-1
- Title: Conversation Memory and Caching Foundation
- Status: Done
- Completed On: 2026-03-05

## 1) Scope Completed

1. Working memory foundation added for session chat continuity:
   - `apps/api/src/orchestrator/conversation-memory.ts`
   - Recent session history load + token-budget sliding window + normalized prompt injection blocks.
2. Episodic memory foundation added:
   - `session_memory` table migration + rolling summary upsert path.
   - Summary refresh trigger wired through chat message persistence and pre-reply refresh.
3. Long-term preference memory foundation added:
   - `apps/api/src/orchestrator/preference-memory.ts`
   - Preference signal extraction from user chat + upsert/read formatter for prompt context.
4. App-level LLM cache foundation added:
   - `apps/api/src/orchestrator/llm-cache.ts`
   - Deterministic request hashing + read/write cache path for OpenAI/Anthropic wrappers.
5. Anthropic prompt caching compatibility path added:
   - Request mode with `cache_control` enabled + automatic fallback to non-cached payload on compatibility error.

## 2) Integration Changes

1. General assistant reply pipeline upgraded:
   - `apps/api/src/orchestrator/ai.ts`
   - Prompt assembly now includes workspace context + session summary + preference context + recent turns.
2. Chat projection write path upgraded:
   - `apps/api/src/orchestrator/chat-projection.ts`
   - Post-insert async hooks now refresh session memory and update preference memory.
3. Session/service wiring updated:
   - `apps/api/src/orchestrator/service.ts`
   - `orgId/sessionId/userId` propagated to reply generation and user-message insert path.
4. Skill typing and call-site updates:
   - `apps/api/src/orchestrator/skills/types.ts`
   - campaign-plan and campaign-survey skill paths now pass memory context identifiers.
5. Config and bootstrap updates:
   - `apps/api/src/lib/env.ts`, `.env.example`, `apps/api/src/index.ts`
   - Added memory/cache env flags and required-table probes for new tables.

## 3) Database/Migration

1. Migration added:
   - `supabase/migrations/20260305100000_phase_6_1_conversation_memory_cache.sql`
2. New tables:
   - `session_memory`
   - `conversation_preferences`
   - `llm_response_cache`
3. Added indexes, updated_at triggers, and org-scoped RLS policies for all three tables.

## 4) Validation Executed

1. `pnpm --filter @repo/api type-check` -> PASS
2. `pnpm type-check` -> PASS (workspace-wide)

## 5) Acceptance Check

1. Session context continuity path is now multi-turn (working memory) -> Met.
2. Session rolling summary persistence/reuse path exists -> Met.
3. Long-term preference extraction + prompt injection path exists -> Met.
4. App-level LLM response caching path exists for OpenAI/Anthropic wrappers -> Met.
5. Anthropic prompt caching compatibility fallback path exists -> Met.
6. Existing orchestration flow remains type-safe after integration -> Met.

## 6) Final Result

- Phase 6-1 is complete.
- The backend now has production-ready scaffolding for conversation continuity and token-efficiency optimization:
  - short-term memory (recent turns),
  - episodic memory (rolling summaries),
  - long-term preference memory,
  - response caching and provider prompt caching hooks.

## 7) Follow-up

1. Apply migration `20260305100000_phase_6_1_conversation_memory_cache.sql` on target Supabase environments.
2. Add runtime metrics dashboard for cache hit ratio, summary refresh frequency, and token/latency deltas.
3. Add focused API unit tests for memory assembly, cache-key stability, and fallback behavior.

### Decisions

**Why this approach:**
Memory and cache were integrated as additive, fallback-safe layers to avoid destabilizing existing workflow orchestration. This allows immediate continuity gains while keeping failure modes non-blocking.

**Alternatives considered:**
- Single large in-session JSON state memory only — reduced DB writes but weak queryability and difficult RLS boundaries.
- Full vector-memory rollout first — higher complexity and delayed delivery for core continuity needs.

**Blockers hit:**
- Anthropic cached payload compatibility uncertainty → implemented cached request first, then automatic non-cached retry on 400 for safe rollout.

**Tech debt introduced:**
- Preference extraction is heuristic-only (keyword/rule based) for now — acceptable for bootstrap, but should move to model-assisted extraction with confidence calibration → affects Phase 6.2
