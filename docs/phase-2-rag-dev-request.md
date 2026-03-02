# Phase 2 Development Request (Split)
## Marketing AI Agent Platform — RAG Knowledge Base

---

## Overview

This document defines the full scope of **Phase 2**: building the Retrieval-Augmented Generation (RAG) knowledge base that gives the AI agent deep, per-organization marketing context.

Phase 1 established the end-to-end skeleton — trigger → orchestrate → generate (stub) → publish (simulated). The orchestrator currently produces generic content because it has **no access to the organization's brand voice, past content patterns, or local marketing materials**.

Phase 2 solves this. When Phase 2 is complete, the AI agent behaves like a junior marketing employee who has studied the organization's entire history — brand tone, forbidden expressions, high-performing content patterns, and raw activity materials — before writing a single line of copy.

**Depends on:** Phase 1-7e (all Phase 1 sub-phases complete)

---

## Why Phase 2 Matters

The architecture document defines the product vision as "replacing a junior marketing employee." A junior employee who knows nothing about the organization is useless. RAG is what transforms the AI from a generic text generator into a context-aware marketing partner.

Without RAG:
- Content generation ignores brand tone and forbidden expressions
- The agent cannot reference past successful content patterns
- Local activity materials (reports, photos, documents) are invisible to the AI
- Every generation starts from zero — no accumulated learning

With RAG:
- Brand profile, tone, and constraints are always present in context
- Past high-performing content informs new generation
- Activity folder documents become content source material
- The system improves over time as more data accumulates (data moat)

---

## Architecture: Hybrid 2-Tier Retrieval

This project requires a hybrid approach, not pure vector search. Some context must **always** be present (brand tone, forbidden words — these cannot be missed), while other context should be **dynamically retrieved** based on the current task.

```
┌──────────────────────────────────────────────────────┐
│              Tier 1: Deterministic Context             │
│              (Always injected into every prompt)       │
│                                                        │
│  memory.md (auto-generated, auto-refreshed)            │
│  ├── Brand tone + forbidden words/topics               │
│  ├── Current active campaigns summary                  │
│  ├── Recent performance highlights                     │
│  └── Accumulated insights (best times, top CTAs)       │
│                                                        │
│  Source: org_brand_settings → assembled at runtime      │
│  Token budget: ~2,000 tokens                           │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│              Tier 2: Semantic Retrieval                │
│              (Dynamic search per task)                 │
│                                                        │
│  pgvector similarity search                            │
│  ├── Past content (similar topic/channel)              │
│  ├── Activity folder documents (related materials)     │
│  └── Chat history (relevant edit patterns)             │
│                                                        │
│  Query: current task description                       │
│  Retrieval: top-k search + performance-weighted rerank │
│  Token budget: ~4,000 tokens                           │
└──────────────────────────────────────────────────────┘
```

### Why Not Pure Vector Search?

Forbidden expressions and brand tone constraints are **safety-critical** — if the agent uses a banned word in published content, it damages the organization's reputation. Relying on vector similarity to surface these constraints would introduce a non-zero miss rate. Tier 1 guarantees they are always present.

Tier 2 handles everything else: "find me the 3 most similar past Instagram posts about volunteer recruitment" is a natural similarity search task.

---

## Global Decisions (Applied Across All Phase 2 Sub-phases)

1. **Embedding model options:** OpenAI `text-embedding-3-small` and `text-embedding-3-large` are both supported.
2. **Embedding dimensions:** `1536` is the default profile, with optional `768` and `512` retrieval profiles for latency/cost tuning.
3. **Embedding calls remain server-side only.** `apps/api` handles all embedding generation. Electron desktop never calls embedding APIs directly.
4. **Vector storage:** Supabase pgvector with HNSW index. No external vector DB - the expected scale (thousands of embeddings per org, not millions) does not justify the operational complexity.
5. **Backend-only retrieval RPC:** vector search RPC execute permission is restricted to `service_role`; `anon`/`authenticated` cannot call it directly.
6. **RLS + org isolation:** `org_rag_embeddings` uses org_id isolation and API-layer org scoping as defense-in-depth.
7. **Chunking is source-type-specific.** No single universal chunking strategy - each data source has its own optimal chunk boundaries.
8. **Token budgets are enforced.** RAG context injection has a hard ceiling to prevent prompt overflow and cost runaway.
9. **Embedding profile versioning is explicit.** model/dimension are persisted per vector, and migration/re-embedding policy is defined in Phase 2-1.

---

## Phase 2 Sub-phase Index

| Sub-phase | Title | Focus |
|-----------|-------|-------|
| 2-1 | RAG Infrastructure | `packages/rag`, pgvector schema, embedding pipeline |
| 2-2 | Brand Profile Ingestion | Onboarding data -> embeddings + memory.md generation |
| 2-3 | Orchestrator RAG Integration | Wire RAG retrieval into content generation prompts |
| 2-4 | Local File Indexing Pipeline | Watch folder documents -> text extraction -> embeddings |
| 2-5 | Content Feedback Loop | Published content + performance -> embeddings + memory.md refresh |

### Delivery Order

1. Complete 2-1 (infrastructure must exist before anything else).
2. Complete 2-2 (brand profile is the highest-impact data source).
3. Complete 2-3 (orchestrator can immediately use brand context).
4. 2-4 and 2-5 can proceed in parallel after 2-3.

---

## Phase 2-1: RAG Infrastructure

### Objectives

- [ ] Enable pgvector extension in Supabase project
- [ ] Create `org_rag_embeddings` table with HNSW index and RLS
- [ ] Scaffold `packages/rag` shared package
- [ ] Implement embedding generation module with provider interface + OpenAI adapter
- [ ] Support embedding model selection (`text-embedding-3-small`, `text-embedding-3-large`)
- [ ] Support embedding dimension profiles (default `1536`, optional `768`/`512`)
- [ ] Implement chunking module with source-type-specific strategies
- [ ] Implement vector store module (insert, upsert, delete by source)
- [ ] Implement retriever module (similarity search + metadata filtering + reranking)
- [ ] Add `@repo/rag` to `apps/api` dependency graph
- [ ] Enforce backend-only RPC execution privilege (service_role only)
- [ ] Define re-embedding migration policy for model/dimension changes
- [ ] Verify end-to-end: text in -> embedding stored -> query returns ranked results

### 1. Database Schema

**Migration file:** `supabase/migrations/2026MMDD_phase_2_1_rag_embeddings.sql`

```sql
-- Enable pgvector
create extension if not exists vector with schema extensions;

-- RAG embeddings table
create table public.org_rag_embeddings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  source_type     text not null
                  check (source_type in (
                    'brand_profile',
                    'content',
                    'local_doc',
                    'chat_pattern'
                  )),
  source_id       text not null,                 -- origin record key (required for idempotent upsert)
  chunk_index     int not null default 0,
  content         text not null,                 -- original text chunk
  metadata        jsonb not null default '{}'::jsonb,
  embedding_model text not null
                  check (embedding_model in (
                    'text-embedding-3-small',
                    'text-embedding-3-large'
                  )),
  embedding_dim   smallint not null
                  check (embedding_dim in (512, 768, 1536)),
  embedding       vector not null,
  check (vector_dims(embedding) = embedding_dim),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- HNSW indexes by embedding dimension (partial indexes)
create index idx_rag_embeddings_hnsw_1536
  on public.org_rag_embeddings
  using hnsw (embedding vector_cosine_ops)
  where embedding_dim = 1536
  with (m = 16, ef_construction = 64);

create index idx_rag_embeddings_hnsw_768
  on public.org_rag_embeddings
  using hnsw (embedding vector_cosine_ops)
  where embedding_dim = 768
  with (m = 16, ef_construction = 64);

create index idx_rag_embeddings_hnsw_512
  on public.org_rag_embeddings
  using hnsw (embedding vector_cosine_ops)
  where embedding_dim = 512
  with (m = 16, ef_construction = 64);

-- Composite index for org-scoped + source/profile filtered queries
create index idx_rag_embeddings_org_source
  on public.org_rag_embeddings (org_id, source_type, embedding_model, embedding_dim);

-- Unique constraint for upsert by source+profile
create unique index uq_rag_embeddings_org_source_chunk
  on public.org_rag_embeddings (
    org_id,
    source_type,
    source_id,
    chunk_index,
    embedding_model,
    embedding_dim
  );

-- Trigger for updated_at
drop trigger if exists org_rag_embeddings_updated_at on public.org_rag_embeddings;
create trigger org_rag_embeddings_updated_at
  before update on public.org_rag_embeddings
  for each row execute function public.update_updated_at();

-- RLS
alter table public.org_rag_embeddings enable row level security;
alter table public.org_rag_embeddings force row level security;

create policy "org members can read own embeddings"
  on public.org_rag_embeddings for select
  using (
    org_id in (
      select om.org_id from public.organization_members om
      where om.user_id = auth.uid()
    )
  );

-- Service role manages writes (API server only)
-- No insert/update/delete policy for authenticated role

-- RPC execute privilege is restricted to backend only (service_role).
-- See match_rag_embeddings() section for explicit revoke/grant.
```

### 2. Package Structure

```
packages/rag/
├── src/
│   ├── index.ts              # public API re-exports
│   ├── types.ts              # RAG-specific types
│   ├── embedder.ts           # provider interface only (vendor-agnostic)
│   ├── embedder-openai.ts    # OpenAI adapter implementation
│   ├── embedder-voyage.ts    # Voyage adapter (optional/placeholder)
│   ├── chunker.ts            # document -> chunks (source-type strategies)
│   ├── store.ts              # CRUD for org_rag_embeddings
│   ├── retriever.ts          # similarity search + reranking
│   └── memory-builder.ts     # org_brand_settings -> memory.md assembly
├── package.json
└── tsconfig.json
```

**Boundary rule:**
- `embedder.ts` contains contracts (`Embedder`, `EmbeddingProfile`, factory signatures) and no direct vendor SDK calls.
- `embedder-openai.ts` contains OpenAI-specific key handling and API invocation.
- `embedder-voyage.ts` is an optional adapter slot for future provider switch/evaluation.
- `apps/api` chooses provider + profile via env/config and injects the implementation into RAG services.

### 3. Shared Types

Add to `packages/types/src/index.ts`:

```typescript
// --- RAG types ---

export type RagEmbeddingModel = 'text-embedding-3-small' | 'text-embedding-3-large';
export type RagEmbeddingDim = 512 | 768 | 1536;

export type RagEmbeddingProfile = {
  model: RagEmbeddingModel;
  dimensions: RagEmbeddingDim;
};

export type RagSourceType =
  | 'brand_profile'
  | 'content'
  | 'local_doc'
  | 'chat_pattern';

export type RagChunk = {
  content: string;
  source_type: RagSourceType;
  source_id: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
};

export type RagEmbedding = {
  id: string;
  org_id: string;
  source_type: RagSourceType;
  source_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding_model: RagEmbeddingModel;
  embedding_dim: RagEmbeddingDim;
  embedding: number[];
  created_at: string;
  updated_at: string;
};

export type RagSearchResult = {
  id: string;
  content: string;
  source_type: RagSourceType;
  source_id: string;
  metadata: Record<string, unknown>;
  similarity: number;          // cosine similarity score (0-1)
  weighted_score: number;      // after reranking (performance boost etc.)
};

export type RagSearchOptions = {
  embedding_profile?: RagEmbeddingProfile; // default: { model: 'text-embedding-3-small', dimensions: 1536 }
  source_types?: RagSourceType[];
  top_k?: number;              // default: 5
  min_similarity?: number;     // default: 0.65
  metadata_filter?: Record<string, unknown>; // exact-match JSON filter (e.g. { channel: 'instagram' })
  boost?: {
    field: string;             // e.g. 'metadata.performance_score'
    weight: number;            // multiplier, e.g. 1.5
  };
};

export type MemoryMd = {
  markdown: string;
  token_estimate: number;
  generated_at: string;
};
```

### 4. Chunking Strategies

```typescript
// packages/rag/src/chunker.ts

export type ChunkStrategy = 'heading_split' | 'single_doc' | 'sliding_window' | 'structured';

// Source-type -> strategy mapping
const STRATEGY_MAP: Record<RagSourceType, ChunkStrategy> = {
  brand_profile: 'heading_split',     // split by markdown headings
  content:       'single_doc',        // one post = one chunk
  local_doc:     'sliding_window',    // 500-800 char windows, 100 char overlap
  chat_pattern:  'structured',        // extract decision patterns as structured chunks
};
```

**Chunking rules per source type:**

| Source Type | Strategy | Chunk Size | Overlap | Notes |
|-------------|----------|------------|---------|-------|
| `brand_profile` | Heading split | Variable (by section) | None | Each markdown H2/H3 section becomes a chunk |
| `content` | Single doc | Entire post | None | One published post = one chunk. Prepend channel/date as metadata header |
| `local_doc` | Sliding window | 500-800 chars | 100 chars | Korean text; ~200-300 tokens per chunk |
| `chat_pattern` | Structured | Variable | None | Extract edit patterns: original -> modified pairs |

### 5. Retriever: Similarity Search + Reranking

```typescript
// packages/rag/src/retriever.ts

// Core search function
export async function searchSimilar(
  orgId: string,
  queryEmbedding: number[], // must match options.embedding_profile.dimensions
  options: RagSearchOptions
): Promise<RagSearchResult[]> {
  // 1. pgvector cosine similarity search with org_id + source_type + embedding profile filter
  // 2. Apply min_similarity threshold
  // 3. Apply metadata_filter (server-side, JSON containment)
  // 4. If boost specified, compute weighted_score = similarity * (1 + boost.weight * metadata_value)
  // 5. Re-sort by weighted_score descending
  // 6. Return top_k results
}
```

**Supabase RPC function for vector search:**

```sql
-- Create a server-side function for efficient vector search
create or replace function public.match_rag_embeddings(
  query_embedding vector,
  query_org_id uuid,
  query_embedding_model text,
  query_embedding_dim int,
  query_source_types text[] default null,
  query_metadata_filter jsonb default '{}'::jsonb,
  match_threshold float default 0.65,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  source_type text,
  source_id text,
  metadata jsonb,
  similarity float
)
language sql stable
security invoker
set search_path = public
as $$
  select
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.org_rag_embeddings e
  where e.org_id = query_org_id
    and e.embedding_model = query_embedding_model
    and e.embedding_dim = query_embedding_dim
    and (query_source_types is null or e.source_type = any(query_source_types))
    and (query_metadata_filter = '{}'::jsonb or e.metadata @> query_metadata_filter)
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- Backend-only execution: do not expose RPC to client roles
revoke all on function public.match_rag_embeddings(vector, uuid, text, int, text[], jsonb, float, int)
  from public, anon, authenticated;
grant execute on function public.match_rag_embeddings(vector, uuid, text, int, text[], jsonb, float, int)
  to service_role;
```

### 6. Embedding Configuration

```typescript
// packages/rag/src/embedder.ts

export type Embedder = {
  generateEmbedding(text: string, profile: RagEmbeddingProfile): Promise<number[]>;
  generateEmbeddings(texts: string[], profile: RagEmbeddingProfile): Promise<number[][]>;
};

export const DEFAULT_EMBEDDING_PROFILE: RagEmbeddingProfile = {
  model: 'text-embedding-3-small',
  dimensions: 1536
};

export const SEARCH_EMBEDDING_PROFILES: Record<'default' | 'balanced' | 'fast', RagEmbeddingProfile> = {
  default: { model: 'text-embedding-3-small', dimensions: 1536 },
  balanced: { model: 'text-embedding-3-small', dimensions: 768 },
  fast: { model: 'text-embedding-3-small', dimensions: 512 }
};
```

`embedder-openai.ts` implements the interface above using OpenAI SDK.

### 7. Environment Variables

Add to `.env.example`:

```bash
# RAG / Embedding
OPENAI_API_KEY=                      # required for OpenAI embedder adapter
RAG_EMBEDDING_PROVIDER=openai
RAG_EMBEDDING_MODEL=text-embedding-3-small      # text-embedding-3-small | text-embedding-3-large
RAG_EMBEDDING_DIMENSIONS=1536                   # default profile: 1536
RAG_ALLOWED_EMBEDDING_DIMENSIONS=512,768,1536  # searchable profiles
RAG_DEFAULT_TOP_K=5
RAG_DEFAULT_MIN_SIMILARITY=0.65
RAG_TIER1_TOKEN_BUDGET=2000
RAG_TIER2_TOKEN_BUDGET=4000
```

### 8. Re-embedding and Profile Migration Strategy (Defined in 2-1)

- Every stored vector includes `embedding_model` + `embedding_dim`.
- Retrieval must use the same profile as the query embedding.
- When org/default profile changes:
  1. Mark org profile transition state (`pending_reembed`).
  2. Backfill embeddings by source in batches (idempotent upsert by profile key).
  3. Switch read profile only after backfill reaches 100%.
  4. Optionally retain previous profile for rollback window, then garbage-collect old profile rows.

### Acceptance Criteria (2-1)

- [ ] pgvector extension enabled in Supabase project
- [ ] `org_rag_embeddings` table created with HNSW index and RLS
- [ ] `match_rag_embeddings` RPC function deployed
- [ ] RPC execute permission restricted to `service_role` only (`anon`/`authenticated` denied)
- [ ] `packages/rag` builds and type-checks
- [ ] `packages/rag` uses interface/adapter boundary (`embedder.ts` contract, `embedder-openai.ts` implementation)
- [ ] `embedder-openai.ts` generates vectors from Korean text for profiles `1536` (default), `768`, `512`
- [ ] Model selection works for `text-embedding-3-small` and `text-embedding-3-large`
- [ ] `chunker.ts` splits a sample brand review markdown into heading-based chunks
- [ ] `store.ts` inserts and upserts embeddings with conflict resolution (`source_id` non-null idempotency guaranteed)
- [ ] `retriever.ts` returns ranked results for a sample query with source/profile/metadata filters against seeded data
- [ ] Cross-org access attempt via RPC is blocked by role grants + API org scoping
- [ ] Re-embedding migration runbook/script exists for model/dimension profile changes
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

---

## Phase 2-2: Brand Profile Ingestion

### Objectives

- [ ] Implement onboarding-completion hook that triggers brand profile embedding
- [ ] Chunk the brand review markdown (from `org_brand_settings.result_document.review_markdown`) by section headings
- [ ] Chunk interview answers into structured text blocks
- [ ] Embed and store all chunks as `source_type: 'brand_profile'`
- [ ] Implement `memory-builder.ts` that assembles memory.md from `org_brand_settings`
- [ ] Store generated memory.md in `org_brand_settings` (new JSONB field or dedicated column)
- [ ] Re-generate memory.md when brand settings change
- [ ] Add API endpoint `GET /orgs/:orgId/memory` for orchestrator consumption

### 1. Data Flow

```
Onboarding completion (existing Phase 1-7 flow)
        │
        ▼
org_brand_settings row updated
        │
        ├──► Brand Review Markdown
        │      │
        │      ▼
        │    Heading-based chunking
        │    (H2 sections: 종합요약, 채널별분석, 일관성분석, etc.)
        │      │
        │      ▼
        │    embedder.generateEmbeddings(chunks)
        │      │
        │      ▼
        │    store.upsertBySource(org_id, 'brand_profile', 'review', chunks)
        │
        ├──► Interview Answers
        │      │
        │      ▼
        │    Structured text conversion:
        │      "브랜드 톤: [detected_tone]. [tone_description]"
        │      "타겟 오디언스: [target_audience.join(', ')]"
        │      "금지 표현: [forbidden_words.join(', ')]"
        │      "금지 주제: [forbidden_topics.join(', ')]"
        │      "캠페인 시즌: [campaign_seasons.join(', ')]"
        │      │
        │      ▼
        │    embedder.generateEmbeddings(structured_chunks)
        │      │
        │      ▼
        │    store.upsertBySource(org_id, 'brand_profile', 'interview', chunks)
        │
        └──► memory.md Generation
               │
               ▼
             Assemble from org_brand_settings fields:
               - Long-term: mission, tone, forbidden list
               - Short-term: current campaigns (query campaigns table)
               - Insights: (empty until Phase 2-5)
               │
               ▼
             Store as org_brand_settings.memory_md (text column)
```

### 2. memory.md Template

```typescript
// packages/rag/src/memory-builder.ts

export function buildMemoryMd(brandSettings: OrgBrandSettings, activeCampaigns: Campaign[]): MemoryMd {
  const sections: string[] = [];

  sections.push(`# ${brandSettings.brand_summary ? extractOrgName(brandSettings) : 'Organization'} Marketing Memory`);
  sections.push('');

  // --- Long-term memory (stable) ---
  sections.push('## Long-term Memory');
  sections.push('');

  if (brandSettings.brand_summary) {
    sections.push(`### Organization Summary`);
    sections.push(brandSettings.brand_summary);
    sections.push('');
  }

  sections.push('### Brand Voice');
  sections.push(`- Tone: ${brandSettings.detected_tone || 'not set'}`);
  if (brandSettings.tone_description) {
    sections.push(`- Description: ${brandSettings.tone_description}`);
  }
  sections.push('');

  if (brandSettings.forbidden_words.length > 0 || brandSettings.forbidden_topics.length > 0) {
    sections.push('### Forbidden List (NEVER USE)');
    if (brandSettings.forbidden_words.length > 0) {
      sections.push(`- Words: ${brandSettings.forbidden_words.join(', ')}`);
    }
    if (brandSettings.forbidden_topics.length > 0) {
      sections.push(`- Topics: ${brandSettings.forbidden_topics.join(', ')}`);
    }
    sections.push('');
  }

  sections.push('### Target Audience');
  sections.push(brandSettings.target_audience.join(', ') || 'not set');
  sections.push('');

  sections.push('### Key Themes');
  sections.push(brandSettings.key_themes.join(', ') || 'not set');
  sections.push('');

  // --- Short-term memory (frequently updated) ---
  sections.push('## Short-term Memory');
  sections.push('');

  if (activeCampaigns.length > 0) {
    sections.push('### Active Campaigns');
    for (const c of activeCampaigns) {
      sections.push(`- ${c.title} (${c.status}) — channels: ${c.channels.join(', ')}`);
    }
  } else {
    sections.push('### Active Campaigns');
    sections.push('No active campaigns.');
  }
  sections.push('');

  if (brandSettings.campaign_seasons.length > 0) {
    sections.push('### Campaign Seasons');
    sections.push(brandSettings.campaign_seasons.join(', '));
    sections.push('');
  }

  // --- Accumulated insights (populated by Phase 2-5) ---
  sections.push('## Accumulated Insights');
  sections.push('');
  sections.push('_Insights will accumulate as content is published and performance data is collected._');

  const markdown = sections.join('\n');
  return {
    markdown,
    token_estimate: Math.ceil(markdown.length / 3.5), // rough Korean char → token estimate
    generated_at: new Date().toISOString(),
  };
}
```

### 3. Schema Update

```sql
-- Add memory_md column to org_brand_settings
alter table public.org_brand_settings
  add column if not exists memory_md text,
  add column if not exists memory_md_generated_at timestamptz;
```

### 4. API Endpoint

```
GET /orgs/:orgId/memory
Authorization: Bearer {user_jwt} or x-trigger-token
Response: {
  memory_md: string,
  token_estimate: number,
  generated_at: string
}
```

The orchestrator calls this endpoint before every content generation task.

### Acceptance Criteria (2-2)

- [ ] Onboarding completion triggers brand profile embedding
- [ ] Brand review markdown split into heading-based chunks and embedded
- [ ] Interview answers converted to structured text and embedded
- [ ] `memory-builder.ts` generates correct memory.md from real org data
- [ ] memory.md stored in `org_brand_settings.memory_md`
- [ ] `GET /orgs/:orgId/memory` returns valid memory.md
- [ ] Brand settings update triggers memory.md regeneration
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

---

## Phase 2-3: Orchestrator RAG Integration

### Objectives

- [ ] Modify orchestrator content generation step to inject Tier 1 context (memory.md)
- [ ] Add Tier 2 retrieval before content generation (similar past content, related materials)
- [ ] Modify campaign planning step to use brand context
- [ ] Enforce token budget limits for RAG context injection
- [ ] Add context source attribution in generated content metadata

### 1. Modified Orchestrator Flow

```
BEFORE (Phase 1 — no context):
  trigger → detect → campaign stub → content stub → publish

AFTER (Phase 2 — RAG-augmented):
  trigger → detect
    → [Tier 1] load memory.md
    → campaign planning (with brand context)
    → [Tier 2] search similar past content + related local docs
    → content generation (with full RAG context)
    → publish
```

### 2. Content Generation Prompt Structure

```typescript
// apps/api/src/orchestrator/ai.ts

async function buildContentGenerationPrompt(
  orgId: string,
  task: ContentTask
): Promise<string> {

  // --- Tier 1: Always present ---
  const memoryResponse = await fetch(`${API_BASE}/orgs/${orgId}/memory`);
  const { memory_md } = await memoryResponse.json();

  // --- Tier 2: Task-specific retrieval ---
  const queryText = `${task.channel} ${task.topic} ${task.activityFolder}`;
  const queryEmbedding = await embedder.generateEmbedding(queryText);

  const similarContent = await retriever.searchSimilar(orgId, queryEmbedding, {
    source_types: ['content'],
    top_k: 3,
    min_similarity: 0.7,
    boost: { field: 'metadata.performance_score', weight: 1.5 },
  });

  const relatedDocs = await retriever.searchSimilar(orgId, queryEmbedding, {
    source_types: ['local_doc'],
    top_k: 2,
    min_similarity: 0.65,
  });

  // --- Token budget enforcement ---
  const tier1Tokens = estimateTokens(memory_md);
  let tier2Content = formatSearchResults(similarContent, relatedDocs);
  const tier2Tokens = estimateTokens(tier2Content);

  if (tier1Tokens + tier2Tokens > TOTAL_RAG_BUDGET) {
    tier2Content = truncateToTokenBudget(tier2Content, TOTAL_RAG_BUDGET - tier1Tokens);
  }

  return `
=== ORGANIZATION CONTEXT (always apply) ===
${memory_md}

=== REFERENCE: Similar Past Content ===
${similarContent.length > 0
  ? similarContent.map(r =>
      `[${r.metadata.channel}/${r.metadata.date}] score:${r.metadata.performance_score ?? 'n/a'}\n${r.content}`
    ).join('\n---\n')
  : 'No similar past content found.'}

=== REFERENCE: Related Activity Materials ===
${relatedDocs.length > 0
  ? relatedDocs.map(r =>
      `[${r.metadata.file_name}/${r.metadata.activity_folder}]\n${r.content}`
    ).join('\n---\n')
  : 'No related materials found.'}

=== TASK ===
Channel: ${task.channel}
Topic: ${task.topic}
Activity: ${task.activityFolder}
Content type: ${task.contentType}
Special instructions: ${task.instructions || 'none'}

Generate content that matches the organization's brand voice and references the provided materials where relevant.
CRITICAL: Never use any forbidden words or topics listed in the organization context.
  `.trim();
}
```

### 3. Context Attribution

Every generated content record stores which RAG sources were used:

```typescript
// Added to contents.metadata
{
  rag_context: {
    memory_md_version: string,       // generated_at timestamp
    tier2_sources: [
      { id: string, source_type: string, similarity: number }
    ],
    total_context_tokens: number
  }
}
```

### Acceptance Criteria (2-3)

- [ ] Content generation prompt includes memory.md (Tier 1)
- [ ] Content generation prompt includes relevant past content and local docs (Tier 2)
- [ ] Campaign planning step uses brand context for channel/tone decisions
- [ ] Token budget is enforced — prompt never exceeds configured limit
- [ ] Generated content metadata includes RAG source attribution
- [ ] Content quality visibly improves compared to Phase 1 stub generation
- [ ] Forbidden words from brand settings never appear in generated content
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

---

## Phase 2-4: Local File Indexing Pipeline

### Objectives

- [ ] Implement text extraction from local documents (PDF, DOCX, TXT, XLSX)
- [ ] Implement Electron → API indexing pipeline for new/changed files
- [ ] Implement chunking and embedding for extracted text
- [ ] Implement metadata-only indexing for non-text files (images, videos)
- [ ] Implement incremental indexing (only changed files, not full re-scan)
- [ ] Implement deletion handling (remove embeddings when files are removed)

### 1. Architecture

```
Electron Main Process (apps/desktop)
        │
        │  chokidar detects new/changed file
        │
        ▼
File Type Router
        │
        ├── Text-extractable (PDF, DOCX, TXT, XLSX, HWP)
        │     │
        │     ▼
        │   Text extraction (Electron main process)
        │   - PDF: pdf-parse or pdfjs-dist
        │   - DOCX: mammoth
        │   - TXT: direct read
        │   - XLSX: SheetJS (cell text concat)
        │   - HWP: hwp.js or fallback to filename-only
        │     │
        │     ▼
        │   POST /rag/index-document
        │   Body: { org_id, source_id, activity_folder, file_name, file_type, extracted_text }
        │
        └── Non-text (JPG, PNG, MP4, MOV, ZIP)
              │
              ▼
            POST /rag/index-document
            Body: { org_id, source_id, activity_folder, file_name, file_type, extracted_text: null }
            → Metadata-only embedding: "Image file: {file_name} in activity: {activity_folder}"
```

### 2. API Routes

```
POST /rag/index-document
Authorization: x-trigger-token (same as pipeline trigger)
Body: {
  org_id: string,
  source_id: string,              // relative_path as unique key
  activity_folder: string,
  file_name: string,
  file_type: 'document' | 'image' | 'video',
  extracted_text: string | null,  // null for non-text files
}
Response: { indexed: true, chunk_count: number }

DELETE /rag/index-document
Authorization: x-trigger-token
Body: {
  org_id: string,
  source_id: string,
}
Response: { deleted: true, removed_count: number }
```

### 3. Indexing Logic

```typescript
// apps/api/src/routes/rag.ts

async function indexDocument(req: IndexDocumentRequest) {
  const { org_id, source_id, activity_folder, file_name, file_type, extracted_text } = req.body;

  // Remove existing embeddings for this source_id (idempotent re-index)
  await ragStore.deleteBySource(org_id, 'local_doc', source_id);

  let chunks: RagChunk[];

  if (extracted_text && extracted_text.length > 50) {
    // Text-extractable file: chunk and embed
    chunks = chunker.chunk(extracted_text, 'sliding_window', {
      metadata: { activity_folder, file_name, file_type, indexed_at: new Date().toISOString() }
    });
  } else {
    // Non-text file: metadata-only embedding
    const metadataText = [
      `File: ${file_name}`,
      `Type: ${file_type}`,
      `Activity: ${activity_folder}`,
    ].join('\n');
    chunks = [{
      content: metadataText,
      source_type: 'local_doc',
      source_id,
      chunk_index: 0,
      metadata: { activity_folder, file_name, file_type, text_extracted: false },
    }];
  }

  const embeddings = await embedder.generateEmbeddings(chunks.map(c => c.content));
  await ragStore.insertBatch(org_id, chunks, embeddings);

  return { indexed: true, chunk_count: chunks.length };
}
```

### 4. Electron Integration

```javascript
// apps/desktop/electron/rag-indexer.mjs

// Called when chokidar detects add/change at depth 2
async function onFileIndexable(filePath, activityFolder, fileName) {
  const fileType = classifyFileType(fileName);
  let extractedText = null;

  if (isTextExtractable(fileName)) {
    try {
      extractedText = await extractText(filePath, fileName);
    } catch (err) {
      console.warn(`Text extraction failed for ${fileName}:`, err.message);
      // Continue with metadata-only indexing
    }
  }

  const relativePath = path.relative(watchPath, filePath);

  await fetch(`${API_BASE}/rag/index-document`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-trigger-token': API_SECRET,
    },
    body: JSON.stringify({
      org_id: orgId,
      source_id: relativePath,
      activity_folder: activityFolder,
      file_name: fileName,
      file_type: fileType,
      extracted_text: extractedText,
    }),
  });
}
```

### 5. Incremental Indexing Strategy

| Event | Action |
|-------|--------|
| File added | Extract + embed (full index) |
| File changed | Delete old embeddings → re-extract → re-embed |
| File deleted | Delete embeddings by `source_id` |
| Initial scan on app launch | Compare local file list vs stored `source_id` set, index delta only |

### Acceptance Criteria (2-4)

- [ ] PDF text extraction works for Korean content
- [ ] DOCX text extraction works via mammoth
- [ ] TXT/XLSX extraction works
- [ ] Non-text files indexed with metadata-only embeddings
- [ ] New file in watch folder → embeddings appear in `org_rag_embeddings` within 30 seconds
- [ ] File deletion → corresponding embeddings removed
- [ ] File change → embeddings updated (not duplicated)
- [ ] Initial scan indexes only files not already in store
- [ ] Retriever returns local_doc results when querying related topics
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

---

## Phase 2-5: Content Feedback Loop

### Objectives

- [ ] Embed published content into RAG store with performance metadata
- [ ] Implement performance score attachment when analytics data arrives
- [ ] Implement edit pattern extraction from content revision history
- [ ] Implement periodic memory.md refresh (accumulated insights section)
- [ ] Implement reranking boost based on performance scores

### 1. Content Publication → Embedding

When content status transitions to `published`:

```typescript
// Triggered in orchestrator after publish step
async function onContentPublished(orgId: string, content: Content) {
  const chunks = chunker.chunk(content.body, 'single_doc', {
    metadata: {
      channel: content.channel,
      campaign_id: content.campaign_id,
      published_at: content.published_at,
      content_type: content.content_type,
      performance_score: null,  // populated later by Phase 4 analytics
    }
  });

  const embeddings = await embedder.generateEmbeddings(chunks.map(c => c.content));
  await ragStore.upsertBySource(orgId, 'content', content.id, chunks, embeddings);
}
```

### 2. Edit Pattern Extraction

When a user modifies an agent-generated draft before approving:

```typescript
// Triggered when content transitions from pending_approval → approved with edits
async function onContentEdited(orgId: string, original: string, edited: string, channel: string) {
  const pattern = `
Channel: ${channel}
Original draft: ${original.substring(0, 500)}
User-edited version: ${edited.substring(0, 500)}
Edit type: ${classifyEdit(original, edited)}
  `.trim();

  const chunks: RagChunk[] = [{
    content: pattern,
    source_type: 'chat_pattern',
    source_id: `edit_${Date.now()}`,
    chunk_index: 0,
    metadata: { channel, edit_type: classifyEdit(original, edited), recorded_at: new Date().toISOString() },
  }];

  const embeddings = await embedder.generateEmbeddings([pattern]);
  await ragStore.insertBatch(orgId, chunks, embeddings);
}
```

### 3. memory.md Refresh Triggers

| Trigger Event | Action | Sections Updated |
|---------------|--------|------------------|
| Content published | Regenerate | Short-term (recent activity) |
| Campaign created/completed | Regenerate | Short-term (active campaigns) |
| Brand settings updated | Regenerate | Long-term (tone, forbidden list) |
| Weekly batch (cron) | Regenerate | Accumulated insights |
| Performance data received (Phase 4) | Regenerate | Accumulated insights |

### 4. Performance Score Backfill

When performance analytics arrive (Phase 4 integration point):

```typescript
// Called by Phase 4 analytics module
async function backfillPerformanceScore(orgId: string, contentId: string, score: number) {
  await ragStore.updateMetadata(orgId, 'content', contentId, {
    performance_score: score,
  });
}
```

The retriever's boost mechanism then automatically prioritizes high-performing content in similarity searches.

### Acceptance Criteria (2-5)

- [ ] Published content automatically embedded with channel/campaign metadata
- [ ] Edit patterns extracted and stored as `chat_pattern` source type
- [ ] memory.md regenerated on content publish, campaign change, and brand settings update
- [ ] Accumulated insights section populated after sufficient content history
- [ ] Performance score backfill updates existing embedding metadata
- [ ] Retriever boosts high-performance content in search results
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

---

## Cost and Performance Considerations

### Embedding Costs (Estimated)

| Source | Chunks per org (initial) | Chunks per org (6 months) | Cost per org/month |
|--------|--------------------------|---------------------------|--------------------|
| Brand profile | 10–20 | 10–20 (stable) | ~$0.001 |
| Published content | 0 | 50–200 | ~$0.01 |
| Local documents | 20–100 | 50–300 | ~$0.02 |
| Chat patterns | 0 | 20–100 | ~$0.005 |
| **Total** | **30–120** | **130–620** | **~$0.04** |

At text-embedding-3-small pricing ($0.02 / 1M tokens), embedding costs are negligible even at hundreds of organizations.

### Query Performance

- Expected corpus: <5,000 embeddings per org at maturity
- pgvector HNSW at this scale: <10ms query time
- No external vector DB needed until >100K embeddings per org (unlikely in this domain)

### Token Budget Allocation

| Context Layer | Budget | Content |
|---------------|--------|---------|
| System prompt | ~500 tokens | Role, task instructions |
| Tier 1 (memory.md) | ~2,000 tokens | Brand profile, forbidden list, campaigns |
| Tier 2 (retrieved) | ~4,000 tokens | Similar content, local docs |
| Task description | ~500 tokens | Channel, topic, instructions |
| **Total context** | **~7,000 tokens** | Leaves room for generation in 128K window |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Korean text embedding quality is poor | Low relevance retrieval | Evaluate Voyage 3 as alternative; add retrieval quality logging |
| Large PDF extraction fails | Missing local doc context | Graceful fallback to metadata-only; log extraction failures |
| HWP format extraction unreliable | Common Korean doc format missed | Accept filename/metadata-only fallback; recommend PDF export |
| Token budget exceeded | API errors or truncated context | Hard enforcement with truncation; prioritize Tier 1 over Tier 2 |
| Stale memory.md | Agent uses outdated brand info | Event-driven regeneration; add staleness check before use |
| Embedding model deprecation | Migration effort | Abstract behind `embedder.ts` interface; re-embed script ready |

---

## Out of Scope for Phase 2

- Fine-tuning or custom model training
- Cross-org benchmark embeddings (Phase 4 — data moat)
- Image/video content understanding (CLIP, video transcription)
- Telegram RAG query interface
- Multi-language support beyond Korean
- Real-time streaming RAG (all retrieval is request-time batch)

---

## Delivery Summary

| Sub-phase | Estimated Effort | Key Deliverable |
|-----------|-----------------|-----------------|
| 2-1 | Infrastructure | `packages/rag` + pgvector schema + HNSW index |
| 2-2 | Ingestion | Brand profile embeddings + memory.md generator |
| 2-3 | Integration | Orchestrator uses RAG context for content generation |
| 2-4 | File Pipeline | Local documents auto-indexed into RAG store |
| 2-5 | Feedback Loop | Published content feeds back; memory.md auto-refreshes |

When Phase 2 is complete, the orchestrator transitions from generating generic stubs to producing **context-aware, brand-aligned marketing content** — the core product differentiator.

---

*Document version: v1.0*
*Phase: 2 — RAG Knowledge Base*
*Depends on: Phase 1-7e (all Phase 1 sub-phases complete)*
*Created: 2026-03-02*

