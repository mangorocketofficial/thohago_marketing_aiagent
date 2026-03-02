# Phase 1-7 Patch: Historical Content Persistence
## Ddohago — Save Crawled Channel Posts for RAG Content Pipeline

---

## Problem

During onboarding, the crawler collects real posts from the organization's channels:

- **Naver Blog:** up to 24 recent posts (title, content snippet, URL, publish date)
- **Instagram:** up to 12 recent posts (caption, likes, timestamp, media type)

This data is currently used **only once** — as input to the brand review synthesis prompt. After synthesis completes, the individual post data lives only inside `org_brand_settings.crawl_payload` as a giant JSONB blob. It is never structured, never individually queryable, and never available for RAG embedding.

This means when the orchestrator generates content in Phase 2-3, the Tier 2 search for "유사 과거 콘텐츠" returns **zero results** until the organization has published enough content through the platform itself. For a new organization with 100 Instagram posts and 50 blog articles, none of that history is available to the AI.

---

## Solution

After synthesis completes, extract individual posts from `crawl_result` and insert them into the `contents` table with `status: 'historical'`. These rows are then picked up by the Phase 2-5a content embedding pipeline as `content` source type — keeping the 4 RAG source types cleanly separated:

| RAG Source Type | What Goes In | Source |
|----------------|-------------|--------|
| `brand_profile` | Brand review chunks, interview answers | Phase 2-2 (already done) |
| **`content`** | **Historical crawled posts + platform-published posts** | **This patch + Phase 2-5a** |
| `local_doc` | Activity folder documents (PDF, DOCX, etc.) | Phase 2-4 |
| `chat_pattern` | User edit patterns from content review | Phase 2-5a |

Historical posts go into `content` source type, not `brand_profile`. Brand profile contains the **analysis** of the channels; content contains the **actual posts** themselves. The orchestrator uses them differently: brand_profile for strategy guidance, content for tone/structure reference.

---

## Scope

This is a **patch to Phase 1-7**, not a new phase. Changes are minimal and backward-compatible.

**In scope:**
- DB migration to extend `contents` check constraints
- Post extraction logic in `POST /onboarding/synthesize`
- Bulk insert of historical posts into `contents` table
- Shared type updates

**Out of scope:**
- RAG embedding of historical posts (Phase 2-5a)
- Website page storage (structural data, not individual posts — already covered by `brand_profile`)
- Re-crawling or additional API calls
- UI changes

---

## 1. Database Migration

The `contents` table has check constraints on `status` and `created_by` that need extension.

**Migration file:** `supabase/migrations/2026MMDD_phase_1_7_historical_content.sql`

```sql
-- Phase 1-7 Patch: Allow historical crawled content in contents table

-- Extend status to include 'historical' for pre-platform content
alter table public.contents
  drop constraint if exists contents_status_check;

alter table public.contents
  add constraint contents_status_check
  check (status in (
    'draft', 'pending_approval', 'approved', 'published', 'rejected',
    'historical'   -- crawled from existing channels during onboarding
  ));

-- Extend created_by to include 'onboarding_crawl'
alter table public.contents
  drop constraint if exists contents_created_by_check;

alter table public.contents
  add constraint contents_created_by_check
  check (created_by in (
    'ai', 'user',
    'onboarding_crawl'   -- bulk-imported from crawler output
  ));

-- Index for efficient historical content queries
-- Phase 2-5a will query: org_id + status IN ('published', 'historical') + embedded_at IS NULL
create index if not exists idx_contents_org_status_historical
  on public.contents (org_id, status)
  where status in ('published', 'historical');
```

**Why `historical` status instead of `published`?** These posts were published on external platforms, but marking them as `published` in our system would be misleading — they weren't published through our pipeline. `historical` clearly communicates "imported reference data, not platform output." This distinction matters for:
- Phase 2-5b Layer 3 insights: separate platform performance from historical baseline
- UI: historical posts should not appear in the "published by platform" list
- Analytics: platform-published content metrics vs. historical reference

---

## 2. Shared Type Updates

```typescript
// packages/types/src/index.ts

// Extend existing ContentStatus (if defined as union type)
// Add 'historical' to the status union
// Add 'onboarding_crawl' to the created_by union

export type ContentStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'historical';        // NEW: crawled from existing channels

export type ContentCreatedBy =
  | 'ai'
  | 'user'
  | 'onboarding_crawl';  // NEW: bulk-imported during onboarding
```

If these are not currently explicit union types, add them. The `Content` type should reference them.

---

## 3. Post Extraction and Insertion

### Where in the code

In `apps/api/src/routes/onboarding.ts`, inside the `POST /onboarding/synthesize` handler. After the successful `org_brand_settings` upsert and before the `enqueueRagIngestion` call:

```
Current flow:
  1. Parse and validate request
  2. Generate brand review markdown
  3. Extract brand profile
  4. Build onboarding document
  5. Upsert org_brand_settings          ← existing
  6. Return response to client          ← existing
  7. enqueueRagIngestion (async)        ← existing (Phase 2-2)

Updated flow:
  1-5. unchanged
  6. Return response to client
  7. persistHistoricalContent (async)   ← NEW
  8. enqueueRagIngestion (async)        ← existing
```

Both step 7 and 8 are fire-and-forget. Historical content insertion failure does NOT break onboarding.

### Extraction Logic

```typescript
// apps/api/src/routes/onboarding.ts (or extract to a helper module)

type HistoricalPost = {
  org_id: string;
  channel: string;
  content_type: string;
  status: 'historical';
  body: string;
  metadata: Record<string, unknown>;
  published_at: string | null;
  created_by: 'onboarding_crawl';
};

function extractHistoricalPosts(
  orgId: string,
  crawlResult: Record<string, unknown>
): HistoricalPost[] {
  const posts: HistoricalPost[] = [];
  const sources = parseObject(crawlResult.sources ?? {}, 'sources');

  // ── Naver Blog Posts ──
  const naverSource = parseObject(sources.naver_blog ?? {}, 'naver_blog');
  const naverStatus = parseOptionalString(naverSource.status);
  const naverData = parseObject(naverSource.data ?? {}, 'naver_blog.data');

  if ((naverStatus === 'done' || naverStatus === 'partial') && Array.isArray(naverData.recent_posts)) {
    for (const post of naverData.recent_posts) {
      if (!post || typeof post !== 'object') continue;
      const row = post as Record<string, unknown>;

      // Must have meaningful text content
      const title = parseOptionalString(row.title) ?? '';
      const snippet = parseOptionalString(row.content_snippet)
        ?? parseOptionalString(row.summary)
        ?? '';
      const body = [title, snippet].filter(Boolean).join('\n\n').trim();
      if (body.length < 20) continue;  // skip trivially short entries

      const url = parseOptionalString(row.url) ?? parseOptionalString(row.link) ?? null;
      const publishedAt = parseOptionalString(row.publish_date)
        ?? parseOptionalString(row.date)
        ?? null;

      posts.push({
        org_id: orgId,
        channel: 'naver_blog',
        content_type: 'text',
        status: 'historical',
        body,
        metadata: {
          origin: 'onboarding_crawl',
          original_url: url,
          original_title: title,
          crawl_source: 'naver_blog',
          has_engagement: row.comment_count ? Number(row.comment_count) > 0 : null,
        },
        published_at: publishedAt ? normalizeToTimestamptz(publishedAt) : null,
        created_by: 'onboarding_crawl',
      });
    }
  }

  // ── Instagram Posts ──
  const igSource = parseObject(sources.instagram ?? {}, 'instagram');
  const igStatus = parseOptionalString(igSource.status);
  const igData = parseObject(igSource.data ?? {}, 'instagram.data');

  if ((igStatus === 'done' || igStatus === 'partial') && Array.isArray(igData.recent_posts)) {
    for (const post of igData.recent_posts) {
      if (!post || typeof post !== 'object') continue;
      const row = post as Record<string, unknown>;

      const caption = parseOptionalString(row.caption) ?? '';
      if (caption.length < 10) continue;  // skip posts with no meaningful caption

      const permalink = parseOptionalString(row.permalink)
        ?? parseOptionalString(row.url)
        ?? null;
      const timestamp = parseOptionalString(row.timestamp) ?? null;
      const mediaType = parseOptionalString(row.media_type) ?? null;

      posts.push({
        org_id: orgId,
        channel: 'instagram',
        content_type: mediaType === 'VIDEO' ? 'video' : 'text',
        status: 'historical',
        body: caption,
        metadata: {
          origin: 'onboarding_crawl',
          original_url: permalink,
          crawl_source: 'instagram',
          like_count: typeof row.like_count === 'number' ? row.like_count : null,
          comment_count: typeof row.comment_count === 'number' ? row.comment_count : null,
          media_type: mediaType,
          shortcode: parseOptionalString(row.shortcode) ?? null,
        },
        published_at: timestamp ? normalizeToTimestamptz(timestamp) : null,
        created_by: 'onboarding_crawl',
      });
    }
  }

  return posts;
}
```

### Why NOT Website Pages

Website crawl data contains structural information (headings, paragraphs, navigation, meta tags, CTA buttons). These are **not individual content posts** — they're architectural elements of the site. This data is already captured in the brand review markdown, which is embedded as `brand_profile` source type in Phase 2-2.

Storing website paragraphs as "historical content" would pollute the `content` source type with non-post data, making Tier 2 retrieval less precise.

### Insertion

```typescript
// apps/api/src/routes/onboarding.ts

async function persistHistoricalContent(
  orgId: string,
  crawlResult: Record<string, unknown>
): Promise<{ inserted: number; skipped: number }> {
  const posts = extractHistoricalPosts(orgId, crawlResult);

  if (posts.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  // Deduplicate: check if historical content already exists for this org
  // (handles re-onboarding scenario)
  const { data: existing } = await supabaseAdmin
    .from('contents')
    .select('id, metadata')
    .eq('org_id', orgId)
    .eq('status', 'historical')
    .eq('created_by', 'onboarding_crawl');

  const existingUrls = new Set(
    (existing ?? [])
      .map(row => (row.metadata as Record<string, unknown>)?.original_url)
      .filter(Boolean)
  );

  const newPosts = posts.filter(p => {
    const url = (p.metadata as Record<string, unknown>)?.original_url;
    return !url || !existingUrls.has(url);
  });

  if (newPosts.length === 0) {
    return { inserted: 0, skipped: posts.length };
  }

  const { error } = await supabaseAdmin
    .from('contents')
    .insert(newPosts);

  if (error) {
    console.error(`[HISTORICAL_CONTENT] Failed to insert for org ${orgId}: ${error.message}`);
    return { inserted: 0, skipped: posts.length };
  }

  console.log(`[HISTORICAL_CONTENT] Inserted ${newPosts.length} posts for org ${orgId} (skipped ${posts.length - newPosts.length} duplicates)`);
  return { inserted: newPosts.length, skipped: posts.length - newPosts.length };
}
```

### Wiring Into Synthesize Handler

```typescript
// In the synthesize route handler, after res.json() and before enqueueRagIngestion:

res.json({
  ok: true,
  org_id: orgId,
  brand_profile: profile,
  onboarding_result_document: { ...document, synthesis_mode: synthesisMode },
  review_markdown: reviewMarkdown,
  synthesis_debug: synthesisDebug,
});

// NEW: Persist crawled posts as historical content (fire-and-forget)
void persistHistoricalContent(orgId, crawlResult).catch((err) => {
  console.warn(
    `[Onboarding] Historical content persistence failed for org ${orgId}: ${
      err instanceof Error ? err.message : 'unknown'
    }`
  );
});

// EXISTING: RAG ingestion
void enqueueRagIngestion(orgId).catch((queueError) => {
  // ... existing error handling
});
```

---

## 4. Re-Onboarding Safety

When a user re-runs onboarding (brand re-review), old historical content should be replaced:

```typescript
// Option A (recommended): Delete old historical content before re-inserting
// Add to the beginning of persistHistoricalContent:

async function persistHistoricalContent(
  orgId: string,
  crawlResult: Record<string, unknown>
): Promise<{ inserted: number; deleted: number }> {

  // Clear previous crawl-imported content for this org
  const { count: deleted } = await supabaseAdmin
    .from('contents')
    .delete()
    .eq('org_id', orgId)
    .eq('status', 'historical')
    .eq('created_by', 'onboarding_crawl');

  const posts = extractHistoricalPosts(orgId, crawlResult);
  if (posts.length === 0) {
    return { inserted: 0, deleted: deleted ?? 0 };
  }

  const { error } = await supabaseAdmin
    .from('contents')
    .insert(posts);

  if (error) {
    console.error(`[HISTORICAL_CONTENT] Insert failed: ${error.message}`);
    return { inserted: 0, deleted: deleted ?? 0 };
  }

  return { inserted: posts.length, deleted: deleted ?? 0 };
}
```

This follows the same `delete-all-then-insert` pattern established in Phase 2-2 for `replaceBySource`. When Phase 2-5a later embeds these contents, the RAG store also uses `replaceBySource` — so stale embeddings for deleted historical content are cleaned up automatically.

---

## 5. Timestamp Normalization

Crawled timestamps come in various formats. A normalizer is needed:

```typescript
function normalizeToTimestamptz(raw: string): string | null {
  if (!raw) return null;

  // Instagram uses Unix timestamp (number or numeric string)
  const asNum = Number(raw);
  if (!isNaN(asNum) && asNum > 1_000_000_000 && asNum < 2_000_000_000) {
    return new Date(asNum * 1000).toISOString();
  }

  // ISO string or other parseable date
  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // Korean date format "2025.12.03." or "2025-12-03"
  const korean = raw.replace(/\./g, '-').replace(/-$/, '');
  const koreanDate = new Date(korean);
  if (!isNaN(koreanDate.getTime())) {
    return koreanDate.toISOString();
  }

  return null;
}
```

---

## 6. Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  POST /onboarding/synthesize                                 │
│                                                              │
│  crawl_result: {                                             │
│    sources: {                                                │
│      website:    { status, data: { headings, paragraphs } }  │
│      naver_blog: { status, data: { recent_posts: [...] } }  │
│      instagram:  { status, data: { recent_posts: [...] } }  │
│    }                                                         │
│  }                                                           │
│                                                              │
│  ┌─ EXISTING FLOW ───────────────────────────────────────┐   │
│  │ crawl_result → brand review synthesis → brand_profile │   │
│  │ brand_profile → org_brand_settings upsert             │   │
│  │ → response to client                                  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ NEW: HISTORICAL CONTENT (async, fire-and-forget) ───┐   │
│  │                                                       │   │
│  │  naver_blog.data.recent_posts[]                       │   │
│  │    ├── Filter: body.length >= 20                      │   │
│  │    └── Insert → contents table                        │   │
│  │         channel: 'naver_blog'                         │   │
│  │         status: 'historical'                          │   │
│  │         created_by: 'onboarding_crawl'                │   │
│  │         metadata.origin: 'onboarding_crawl'           │   │
│  │         metadata.original_url: post.url               │   │
│  │                                                       │   │
│  │  instagram.data.recent_posts[]                        │   │
│  │    ├── Filter: caption.length >= 10                   │   │
│  │    └── Insert → contents table                        │   │
│  │         channel: 'instagram'                          │   │
│  │         status: 'historical'                          │   │
│  │         created_by: 'onboarding_crawl'                │   │
│  │         metadata.origin: 'onboarding_crawl'           │   │
│  │         metadata.original_url: post.permalink         │   │
│  │         metadata.like_count: ...                      │   │
│  │                                                       │   │
│  │  website.data → NOT stored as content                 │   │
│  │    (structural data, covered by brand_profile RAG)    │   │
│  │                                                       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ EXISTING: RAG INGESTION (async) ────────────────────┐   │
│  │  enqueueRagIngestion(orgId)                           │   │
│  │  → brand review → brand_profile embeddings            │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Phase 2-5a (future):
  contents WHERE status IN ('published', 'historical')
    → embed as source_type: 'content'
    → available in Tier 2 retrieval
```

---

## 7. How This Connects to the 4 RAG Source Types

```
RAG Source Types (clean separation)
│
├── brand_profile (Phase 2-2 — DONE)
│     Source: brand review markdown + interview answers
│     Purpose: brand strategy, channel analysis, tone guidance
│     NOT for: individual post content
│
├── content (Phase 2-5a — uses THIS patch's data)
│     Source: contents table WHERE status IN ('published', 'historical')
│     ├── historical (from THIS patch): crawled naver blog + instagram posts
│     └── published (from Phase 2-5a): platform-generated content
│     Purpose: tone/structure reference, "이전에 이런 식으로 썼었다"
│
├── local_doc (Phase 2-4)
│     Source: activity folder files (PDF, DOCX, etc.)
│     Purpose: content raw material from local documents
│
└── chat_pattern (Phase 2-5a)
      Source: user edit patterns when modifying AI drafts
      Purpose: preference learning, "유저가 이런 식으로 고치더라"
```

Each source type has a distinct origin and purpose. Historical crawled posts belong firmly in `content` because they ARE content — real posts that the organization published on their channels.

---

## 8. Expected Data Volume

| Channel | Max Posts per Crawl | Typical Body Size | Storage Impact |
|---------|-------------------|-------------------|----------------|
| Naver Blog | 24 | 200-600 chars (snippet) | ~15KB per org |
| Instagram | 12 | 50-300 chars (caption) | ~4KB per org |
| **Total** | **~36 rows** | — | **~20KB per org** |

This is negligible storage. No batching or rate limiting needed for the insert.

---

## Error Handling

| Failure | Impact | Handling |
|---------|--------|---------|
| Post extraction throws | No historical content saved | Caught by fire-and-forget wrapper; log warning; onboarding succeeds |
| Bulk insert fails | No historical content saved | Log error; onboarding succeeds; can retry via re-onboarding |
| Crawl source `failed`/`skipped` | No posts for that channel | Extraction function skips that source cleanly |
| All posts filtered out (too short) | Zero rows inserted | Normal case; log count; no error |
| Duplicate re-onboarding | Old posts re-inserted | Delete-then-insert pattern handles this |

---

## Acceptance Criteria

- [ ] Migration adds `'historical'` to `contents.status` check constraint
- [ ] Migration adds `'onboarding_crawl'` to `contents.created_by` check constraint
- [ ] After successful synthesis, Naver Blog posts extracted and inserted as `historical` content
- [ ] After successful synthesis, Instagram posts extracted and inserted as `historical` content
- [ ] Website data is NOT inserted into contents (confirmed: no rows with `metadata.crawl_source = 'website'`)
- [ ] Each historical content row has `metadata.origin = 'onboarding_crawl'` and `metadata.original_url`
- [ ] `published_at` populated from crawled timestamp (normalized to timestamptz)
- [ ] Posts with trivially short body/caption are filtered out
- [ ] Historical content insertion failure does not break onboarding
- [ ] Re-onboarding deletes old historical content before re-inserting (no duplicates)
- [ ] Existing smoke tests still pass (`pnpm smoke:1-5a`, `pnpm smoke:2-2`)
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

---

## Out of Scope

- RAG embedding of historical content (Phase 2-5a)
- Website page storage as content
- Additional crawling or API calls
- Historical content UI display
- Performance score backfill for historical posts
- Facebook/YouTube/Threads post storage (no crawlers for these channels yet)

---

*Document version: v1.0*
*Patch target: Phase 1-7 (onboarding synthesis)*
*Depends on: Phase 1-7b completion (Instagram crawler operational)*
*Created: 2026-03-02*
