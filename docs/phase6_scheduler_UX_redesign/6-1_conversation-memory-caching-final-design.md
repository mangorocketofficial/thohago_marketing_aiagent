# Conversation Memory and Caching Final Design

- Date: 2026-03-04
- Scope: Session continuity + token efficiency for the marketing AI agent
- Status: Final implementation design
- Applies to: `apps/api/src/orchestrator/*`, `apps/api/src/lib/env.ts`, Supabase migrations

## 1) Goals

1. Preserve conversational continuity within a session.
2. Prevent linear token growth as chat length increases.
3. Keep responses aligned with org brand memory and user preferences.
4. Reduce repeated model cost/latency with deterministic caching.

## 2) Non-Goals

1. Replacing existing RAG document retrieval.
2. Full user identity graph across products.
3. Multi-org shared memory.

## 3) Current Gaps (Confirmed)

1. Stateless model calls for chat replies (`generateGeneralAssistantReply` uses only system + current user message).
2. No rolling session summary (episodic memory).
3. No explicit long-term preference learning from conversations.
4. No provider-level or app-level prompt/response caching for chat continuity paths.

## 4) Final Architecture (1-2-3-4)

### 4.1 Working Memory (Recent Turns)

Use recent session turns as short-term memory at inference time.

- Source: `chat_messages`
- Filter:
  - `org_id = ?`
  - `session_id = ?`
  - `message_type in ('text','system')`
  - `role in ('user','assistant')`
- Exclude large boilerplate/system notifications by default.
- Build a sliding window by token budget, not fixed count.

Recommended defaults:

- `WORKING_MEMORY_MAX_TURNS = 12`
- `WORKING_MEMORY_TOKEN_BUDGET = 900`
- Keep newest turns first; trim oldest first.

### 4.2 Episodic Memory (Rolling Session Summary)

Maintain a compact running summary for each session.

- Trigger:
  - every 4 new chat turns, or
  - when assembled working memory exceeds threshold (example: 1200 tokens before trim)
- Storage: dedicated session memory table (see schema below)
- Summary format: structured JSON then rendered to markdown/text for prompt injection.

Recommended summary schema:

```json
{
  "session_goal": "string",
  "decisions_made": ["string"],
  "open_questions": ["string"],
  "constraints": ["string"],
  "approved_assets": ["string"],
  "pending_actions": ["string"],
  "tone_preferences_observed": ["string"],
  "last_updated_at": "ISO-8601"
}
```

### 4.3 Long-Term Memory (Preference Learning)

Persist stable preference signals derived from conversations.

- Scope: org-level + optional user-level (`created_by_user_id` if available)
- Candidate signals:
  - channel preference
  - length preference
  - tone/style preferences
  - forbidden wording
  - CTA style preference
  - approval criteria
- Write policy:
  - only persist when confidence >= threshold (example: 0.75)
  - track evidence count and last_seen_at
  - TTL/decay for stale preferences (example: 90 days)

Priority at inference:

1. Current explicit user instruction
2. Session episodic summary
3. Long-term preference memory
4. Organization `memory.md`

### 4.4 Prompt Caching (Provider + App Layer)

Use two cache layers:

1. Provider cache (Anthropic, where used):
   - Add `cache_control` to stable prompt blocks (system/rules/brand memory)
   - Keep cacheable blocks deterministic (no random IDs/timestamps)
2. Application cache (all chat providers):
   - Key: `sha256(model + system_hash + context_hash + user_message_hash + temperature + max_tokens)`
   - TTL: short (example 2-10 minutes)
   - Use for retries, duplicate submits, and network retry bursts.

## 5) Data Model Changes

Add three tables (or equivalent extension columns if preferred).

### 5.1 `session_memory`

```sql
create table if not exists public.session_memory (
  session_id uuid primary key references public.orchestrator_sessions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  rolling_summary_json jsonb not null default '{}'::jsonb,
  rolling_summary_text text not null default '',
  source_message_count integer not null default 0,
  last_compacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_session_memory_org_updated
  on public.session_memory (org_id, updated_at desc);
```

### 5.2 `conversation_preferences`

```sql
create table if not exists public.conversation_preferences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid null references public.users(id) on delete set null,
  preference_key text not null,
  preference_value text not null,
  confidence numeric(4,3) not null default 0.5,
  evidence_count integer not null default 1,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, preference_key, preference_value)
);

create index if not exists idx_conversation_preferences_org_user
  on public.conversation_preferences (org_id, user_id, last_seen_at desc);
```

### 5.3 `llm_response_cache`

```sql
create table if not exists public.llm_response_cache (
  cache_key text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  model text not null,
  request_hash text not null,
  response_text text not null,
  prompt_tokens integer null,
  completion_tokens integer null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_llm_response_cache_org_exp
  on public.llm_response_cache (org_id, expires_at);
```

## 6) Prompt Assembly Contract

Final input composition for general chat:

1. System instructions (stable)
2. Workspace context (existing)
3. Episodic summary (`session_memory.rolling_summary_text`)
4. Long-term preferences (top K, concise bullet list)
5. Working memory (recent turns within budget)
6. Current user message

Token budget policy (example):

- System + guardrails: 200
- Workspace context: 200
- Episodic summary: 250
- Long-term preferences: 150
- Working memory: 900
- User message: 150

Total target input: about 1850 tokens.

## 7) Runtime Flow (General Chat)

1. Persist user message to `chat_messages` (already implemented).
2. Build context package:
   - load working memory window
   - load session episodic summary
   - load long-term preferences
3. Compute app cache key and try cache read.
4. On cache miss:
   - call provider
   - persist response cache with TTL
5. Persist assistant message to `chat_messages`.
6. If summarization trigger met, update `session_memory`.
7. Optionally enqueue preference extraction async job.

## 8) Implementation Plan

### Phase A: Working Memory Injection

Files:

- `apps/api/src/orchestrator/ai.ts`
- `apps/api/src/orchestrator/service.ts`
- new: `apps/api/src/orchestrator/conversation-memory.ts`

Tasks:

1. Add chat history loader by `org_id + session_id`.
2. Build token-aware sliding window using existing token counter utilities.
3. Feed messages to `callOpenAiGeneralChat` as multi-turn array.

### Phase B: Episodic Memory

Files:

- new migration under `supabase/migrations/*`
- new: `apps/api/src/orchestrator/session-memory-repository.ts`
- update `service.ts` post-reply flow

Tasks:

1. Create `session_memory` table.
2. Implement summarize-and-upsert logic.
3. Inject summary into prompt assembly.

### Phase C: Long-Term Preferences

Files:

- new migration
- new: `apps/api/src/orchestrator/preference-memory.ts`

Tasks:

1. Extract preference candidates from latest turns + summary.
2. Upsert confidence-based records.
3. Add concise preference formatter for prompts.

### Phase D: Caching

Files:

- new migration
- new: `apps/api/src/orchestrator/llm-cache.ts`
- update provider wrappers in `ai.ts`

Tasks:

1. Add app-level cache read/write.
2. Add expiration cleanup job (or lazy delete on read).
3. Add Anthropic `cache_control` blocks where Anthropic APIs are used.

## 9) Env Configuration

Add variables in `apps/api/src/lib/env.ts`:

- `WORKING_MEMORY_MAX_TURNS` (default `12`)
- `WORKING_MEMORY_TOKEN_BUDGET` (default `900`)
- `SESSION_SUMMARY_TOKEN_BUDGET` (default `250`)
- `SESSION_SUMMARY_UPDATE_EVERY_TURNS` (default `4`)
- `PREFERENCE_MEMORY_MAX_ITEMS` (default `8`)
- `LLM_RESPONSE_CACHE_TTL_SECONDS` (default `300`)
- `LLM_RESPONSE_CACHE_ENABLED` (default `true`)

## 10) Observability and KPIs

Log and monitor:

1. cache hit ratio (provider/app separately)
2. prompt token reduction vs baseline
3. average latency and p95 latency
4. summary update success/failure count
5. preference extraction write count and confidence distribution
6. response quality regression signals (manual QA + approval metrics)

## 11) Risk and Mitigation

1. Over-compression loses important context.
   - Mitigation: preserve explicit user constraints and unresolved questions in summary schema.
2. Preference drift from ambiguous chats.
   - Mitigation: confidence threshold + decay + evidence_count.
3. Cache serving stale responses.
   - Mitigation: short TTL + include context hash in key.
4. Prompt growth due to additive memory blocks.
   - Mitigation: strict per-block token caps and truncation.

## 12) Acceptance Criteria

1. Multi-turn continuity works within one session without repeating user context.
2. Input tokens for long sessions remain bounded by configured budgets.
3. Session summary is generated and reused after threshold.
4. Long-term preference memory changes output style when user preference is stable.
5. Cache hit ratio is measurable and non-zero in repeated request patterns.
6. No regression in existing workflow approval steps and chat projection behavior.

## 13) Immediate Next Build Target

Implement Phases A and B first as the minimum production baseline:

1. Working memory injection
2. Session rolling summary

Then enable C and D incrementally behind feature flags.
